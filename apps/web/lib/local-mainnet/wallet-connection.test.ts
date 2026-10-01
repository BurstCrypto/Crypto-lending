// @vitest-environment node
import { Keypair } from '@solana/web3.js';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeWallets, type BridgeWalletChoice } from '../mainnet/bridge-client';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach((stop) => stop()); vi.useRealTimers(); vi.restoreAllMocks(); });

function walletFixture(seed: number) {
  const key = Keypair.fromSeed(new Uint8Array(32).fill(seed));
  const account: WalletAccount = { address: key.publicKey.toBase58(), publicKey: key.publicKey.toBytes(), chains: ['solana:mainnet'], features: ['solana:signTransaction'] };
  let accounts = [account];
  const connect = vi.fn(async () => ({ accounts: accounts.map((a) => ({ ...a })) }));
  const signTransaction = vi.fn();
  const wallet: Wallet = {
    version: '1.0.0', name: `Test wallet ${seed}`, icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: ['solana:mainnet'],
    // Wallet Standard accounts are data objects; their JS identity need not persist across reads.
    get accounts() { return accounts.map((a) => ({ ...a })); },
    features: { 'standard:connect': { version: '1.0.0', connect }, 'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction } },
  };
  const unregister = getWallets().register(wallet); cleanup.push(unregister);
  return { account, wallet, connect, signTransaction, unregister, setAccounts: (next: WalletAccount[]) => { accounts = next; } };
}

function connector() {
  const wallets = new BridgeWallets();
  let choices: BridgeWalletChoice[] = [];
  cleanup.push(wallets.start((next) => { choices = next; }));
  return { wallets, selection: (wallet: Wallet) => choices.find((choice) => choice.name === wallet.name)!.id };
}

describe('local wallet connection lifecycle', () => {
  it('accepts refreshed account objects and rejects a disconnected or changed Solana account', async () => {
    const phantom = walletFixture(7), other = walletFixture(8), { wallets, selection } = connector();
    const fetch = vi.spyOn(globalThis, 'fetch');
    const expected = { ethereumWallet: null, solanaWallet: phantom.account.address };
    expect(await wallets.selectAccounts('', selection(phantom.wallet))).toEqual(expected);
    await expect(wallets.check(expected)).resolves.toBeUndefined();
    phantom.setAccounts([other.account]);
    await expect(wallets.check(expected)).rejects.toThrow(/configured Solana mainnet wallet/);
    phantom.setAccounts([]);
    await expect(wallets.check(expected)).rejects.toThrow(/configured Solana mainnet wallet/);
    expect(phantom.connect).toHaveBeenCalledTimes(1);
    expect(phantom.signTransaction).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the selected provider stable when another wallet unregisters', async () => {
    const first = walletFixture(7), second = walletFixture(8), { wallets, selection } = connector();
    const firstId = selection(first.wallet), secondId = selection(second.wallet);
    first.unregister();
    expect(selection(second.wallet)).toBe(secondId);
    await expect(wallets.selectAccounts('', firstId)).rejects.toThrow(/installed Solana wallet/);
    expect(second.connect).not.toHaveBeenCalled();
    await expect(wallets.selectAccounts('', secondId)).resolves.toEqual({ ethereumWallet: null, solanaWallet: second.account.address });
  });

  it('times out a stuck popup and ignores its late result after a successful new connection', async () => {
    vi.useFakeTimers();
    const first = walletFixture(7), second = walletFixture(8), { wallets, selection } = connector();
    let finish: (result: { accounts: WalletAccount[] }) => void;
    first.connect.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = expect(wallets.selectAccounts('', selection(first.wallet))).rejects.toThrow(/connection timed out/);
    await vi.advanceTimersByTimeAsync(60_000); await pending;
    const expected = { ethereumWallet: null, solanaWallet: second.account.address };
    expect(await wallets.selectAccounts('', selection(second.wallet))).toEqual(expected);
    finish!({ accounts: [first.account] });
    await vi.advanceTimersByTimeAsync(0);
    await expect(wallets.check(expected)).resolves.toBeUndefined();
    expect(first.signTransaction).not.toHaveBeenCalled(); expect(second.signTransaction).not.toHaveBeenCalled();
  });

  it.each([{ code: 4001, message: /did not approve the connection request \(4001\).*Extension connection error/ }, { code: -32002, message: /wallet request is already open/ }])('explains wallet connection error $code without requesting a signature', async ({ code, message }) => {
    const phantom = walletFixture(7), { wallets, selection } = connector();
    phantom.connect.mockRejectedValue({ code, message: 'Extension connection error' });
    await expect(wallets.selectAccounts('', selection(phantom.wallet))).rejects.toThrow(message);
    expect(phantom.signTransaction).not.toHaveBeenCalled();
  });
});
