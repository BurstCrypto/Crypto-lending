// @vitest-environment node
import { createPrivateKey, sign } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BridgeWallets } from '../mainnet/bridge-client';
import { BridgeJournal } from '../mainnet/bridge-journal.server';
import { BRIDGE_ETHEREUM as ETH, BRIDGE_SOLANA as SOL } from '../mainnet/bridge-types';
import { walletSignInMessage } from '../mainnet/wallet-sign-in';
import { walletSignInChallenge, verifyWalletSignIn } from '../mainnet/wallet-sign-in.server';

const origin = 'http://127.0.0.1:3000', capability = 'a'.repeat(64);
const key = Keypair.fromSeed(new Uint8Array(32).fill(37));
const account = { address: key.publicKey.toBase58(), publicKey: key.publicKey.toBytes(), chains: ['solana:mainnet'], features: ['solana:signTransaction'] };
const signMessage = (message: Uint8Array) => sign(null, message, createPrivateKey({ format: 'der', type: 'pkcs8', key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), key.secretKey.subarray(0, 32)]) }));
let journal: BridgeJournal;
beforeEach(() => {
  journal = new BridgeJournal(':memory:');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    expect(new Headers(options?.headers).get('x-local-mainnet-setup')).toBe(capability);
    try {
      if (body.operation === 'wallet-sign-in-challenge') return Response.json(walletSignInChallenge(journal, body.network, origin));
      if (body.operation === 'wallet-connection-error') return Response.json({ recorded: true });
      expect(body.operation).toBe('wallet-sign-in-verify');
      return Response.json(await verifyWalletSignIn(journal, body.id, body.wallet, body.message, body.signature, origin));
    } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  });
});
afterEach(() => { vi.restoreAllMocks(); journal.close(); });

it.each(['messages-rejected', 'no-message-support'])('connects Phantom/Ledger through the UI entry point without a sign-in or spending signature: %s', async (mode) => {
  let approve!: () => void, connected = false;
  const connect = vi.fn(() => new Promise<{ accounts: typeof account[] }>((resolve) => { approve = () => { connected = true; resolve({ accounts: [account] }); }; }));
  const nativeSignIn = vi.fn().mockRejectedValue({ code: 4001, message: 'User rejected the request.' });
  const messageSigning = vi.fn().mockRejectedValue(new Error('Ledger device: UNKNOWN_ERROR (0x6a81)'));
  const signTransaction = vi.fn(), wallets = new BridgeWallets();
  Object.assign(wallets, { options: new Map([['phantom', { name: 'Phantom', get accounts() { return connected ? [account] : []; }, features: {
    'standard:connect': { connect }, 'solana:signTransaction': { signTransaction },
    ...(mode === 'messages-rejected' ? { 'solana:signIn': { signIn: nativeSignIn }, 'solana:signMessage': { signMessage: messageSigning } } : {}),
  } }]]) });
  const pending = wallets.connectWallets('', 'phantom', capability);
  expect(connect).toHaveBeenCalledWith({ silent: false });
  await expect(wallets.check({ ethereumWallet: null, solanaWallet: account.address })).rejects.toThrow(/configured/);
  approve();
  await expect(pending).resolves.toEqual({ ethereumWallet: null, solanaWallet: account.address });
  await expect(wallets.check({ ethereumWallet: null, solanaWallet: account.address })).resolves.toBeUndefined();
  expect(nativeSignIn).not.toHaveBeenCalled(); expect(messageSigning).not.toHaveBeenCalled(); expect(signTransaction).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); expect(journal.steps()).toEqual([]);
});

it('keeps a declined connection disconnected without falling back to signing or retrying', async () => {
  const connect = vi.fn().mockRejectedValue({ code: 4001, message: 'Permission request closed.' });
  const nativeSignIn = vi.fn(), messageSigning = vi.fn(), signTransaction = vi.fn(), wallets = new BridgeWallets();
  Object.assign(wallets, { options: new Map([['phantom', { name: 'Phantom', accounts: [account], features: {
    'standard:connect': { connect }, 'solana:signIn': { signIn: nativeSignIn }, 'solana:signMessage': { signMessage: messageSigning }, 'solana:signTransaction': { signTransaction },
  } }]]) });
  await expect(wallets.connectWallets('', 'phantom', capability)).rejects.toThrow(/Phantom did not approve the connection request \(4001\).*Permission request closed/);
  await expect(wallets.check({ ethereumWallet: null, solanaWallet: account.address })).rejects.toThrow(/configured/);
  expect(connect).toHaveBeenCalledOnce(); expect(nativeSignIn).not.toHaveBeenCalled(); expect(messageSigning).not.toHaveBeenCalled(); expect(signTransaction).not.toHaveBeenCalled();
  const calls = vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
  expect(calls).toEqual([{ operation: 'wallet-connection-error', network: SOL, stage: 'connect', code: 4001, elapsedMs: expect.any(Number) }]);
});

it('connects Ethereum through wallet permissions without requiring message signing', async () => {
  const ethereum = privateKeyToAccount(`0x${'19'.repeat(32)}`);
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ethereum.address];
    if (method === 'eth_chainId') return '0x1';
    if (method === 'wallet_switchEthereumChain') return null;
    if (method === 'personal_sign') throw new Error(`Message signing is unsupported: ${String(params?.[0])}`);
    throw new Error('No spending request is allowed during sign-in.');
  });
  const wallets = new BridgeWallets(); Object.defineProperty(wallets.discovery, 'select', { value: () => ({ provider: { request } }) });
  await expect(wallets.connectWallets('ethereum', '', capability)).resolves.toEqual({ ethereumWallet: ethereum.address.toLowerCase(), solanaWallet: null });
  expect(request.mock.calls.filter(([value]) => value.method === 'personal_sign')).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
  expect(journal.steps()).toEqual([]);
});

it('rejects replayed, expired, cross-origin and invalid sign-in proofs', async () => {
  const challenge = walletSignInChallenge(journal, SOL, origin);
  const message = Buffer.from(walletSignInMessage(challenge.input, account.address));
  const signature = signMessage(message).toString('base64');
  const verify = (site = origin) => verifyWalletSignIn(journal, challenge.id, account.address, message.toString('base64'), signature, site);
  await expect(verify('https://different.example')).rejects.toThrow(/invalid/);
  await expect(verifyWalletSignIn(journal, challenge.id, account.address, message.toString('base64'), Buffer.alloc(64).toString('base64'), origin)).rejects.toThrow(/verified/);
  await expect(verify()).resolves.toMatchObject({ verified: true });
  await expect(verify()).rejects.toThrow(/expired/);
  const expired = walletSignInChallenge(journal, ETH, origin);
  journal.db.prepare('UPDATE challenges SET expires=0 WHERE id=?').run(expired.id);
  await expect(verifyWalletSignIn(journal, expired.id, account.address, '', '', origin)).rejects.toThrow(/expired/);
});
