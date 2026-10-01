// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComputeBudgetInstruction, ComputeBudgetProgram, Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { decodeFunctionData, encodeFunctionData, maxUint256, type Hex } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LENDING_ROUTER_ABI } from '../lending/ethereum-router';
import { KAMINO_PROGRAM } from '../../../../onchain/src/destination-lending';
import { SOLANA_USDC } from '../../../../onchain/src/source-plan';
import { GET, POST } from '../../app/api/local-mainnet/route';
import { BridgeWallets, validateReviewedStep } from '../mainnet/bridge-client';
import { BridgeJournal, fingerprint } from '../mainnet/bridge-journal.server';
import { LocalBridgeService } from '../mainnet/bridge-service.server';
import { BRIDGE_ETHEREUM as ETH, BRIDGE_SOLANA as SOL, type BridgeStep, type LocalWalletConfig } from '../mainnet/bridge-types';
import { MAINNET_TEST as P, POOL_ABI, TOKEN_ABI } from '../mainnet/policy';
import * as runtime from './runtime.server';
import { readLocalWalletConfig, writeLocalWalletConfig } from './bridge-config.server';

// Deterministic signers for isolated tests only; the fetch double never broadcasts.
const signer = Keypair.fromSeed(new Uint8Array(32).fill(11));
const config: LocalWalletConfig = { ethereumWallet: '0x1111111111111111111111111111111111111111', solanaWallet: signer.publicKey.toBase58(),
  ethereumTreasury: '0x2222222222222222222222222222222222222222', solanaTreasury: Keypair.fromSeed(new Uint8Array(32).fill(12)).publicKey.toBase58(),
  ethereumSourceRouter: null, ethereumSupplyRouter: null, ethereumLendingRouter: '0x3333333333333333333333333333333333333333', solanaLookupTables: [] };
const capability = 'a'.repeat(64), hash = `0x${'12'.repeat(32)}` as Hex;
let service: LocalBridgeService, journal: BridgeJournal, path: string;
const snapshot = () => ({ wallet: config.ethereumWallet!, blockNumber: '100', blockHash: hash, observedAt: Date.now(), usdc: '5000000', supplied: '0', allowance: '1000000', eth: '10000000000000000', totalDebt: '0' });
const inspection = (changes: Partial<ReturnType<typeof snapshot>> = {}) => ({ snapshot: { ...snapshot(), ...changes }, nonce: '0x0' as Hex,
  head: { number: '0x64' as Hex, hash, baseFee: 1n }, active: true, frozen: false, paused: false });
function request(operation: string, fields: Record<string, unknown> = {}, token = capability) {
  return new Request(`${P.origin}/api/local-mainnet`, { method: 'POST', headers: { host: '127.0.0.1:3000', origin: P.origin, 'content-type': 'application/json', 'x-local-mainnet-setup': token }, body: JSON.stringify({ operation, ...fields }) });
}
function save(selected: LocalWalletConfig) { writeFileSync(path, JSON.stringify(selected)); return selected; }
function signStep(step: BridgeStep) { const tx = VersionedTransaction.deserialize(Buffer.from(step.solana!.serialized, 'base64')); tx.sign([signer]); return Buffer.from(tx.serialize()).toString('base64'); }
function refingerprint(step: BridgeStep) { return { ...step, fingerprint: fingerprint({ ethereum: step.ethereum, solana: step.solana, evidence: step.evidence }) }; }
// Model Phantom's fee enhancement: a compute limit alone does not stop it from
// inserting a price. Only an existing SetComputeUnitPrice instruction does.
function phantomPriorityFee(tx: VersionedTransaction) {
  const message = TransactionMessage.decompile(tx.message);
  const priced = message.instructions.some((ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ComputeBudgetInstruction.decodeInstructionType(ix) === 'SetComputeUnitPrice');
  if (priced) return tx;
  message.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25_000 }));
  return new VersionedTransaction(message.compileToV0Message());
}
beforeEach(() => {
  path = join(tmpdir(), `bonsai-direct-lending-${randomUUID()}.json`); save(config);
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('LOCAL_MAINNET_TEST_MODE', 'enabled'); vi.stubEnv('LOCAL_MAINNET_TEST_LAUNCH_TOKEN', capability);
  vi.stubEnv('LOCAL_MAINNET_TEST_CONFIG', path); vi.stubEnv('DEPLOYMENT_TARGET', undefined); vi.stubEnv('LOCAL_DEMO_MODE', 'disabled');
  journal = new BridgeJournal(':memory:'); service = new LocalBridgeService(journal, undefined, undefined, { read: readLocalWalletConfig, write: writeLocalWalletConfig }); vi.spyOn(runtime, 'localMainnetService').mockReturnValue(service);
  vi.spyOn(service.ethereum.rpc, 'inspect').mockResolvedValue(inspection());
  vi.spyOn(service.ethereum, 'prepare').mockImplementation(async (call) => ({ transaction: { ...call, value: '0x0', chainId: '0x1', type: '0x2', nonce: '0x0', gas: '0x186a0', maxFeePerGas: '0x3b9aca00', maxPriorityFeePerGas: '0x1' }, cost: '100000000000000', snapshot: snapshot() }));
  vi.spyOn(service.ethereum, 'validateLendingRouter').mockResolvedValue(undefined);
  vi.spyOn(service.ethereum, 'allowance').mockResolvedValue(1_001_000n);
  vi.spyOn(service.solana, 'routingFeeAccount').mockResolvedValue({ balance: 0n, rent: 0n });
  vi.spyOn(service.ethereum, 'revalidate').mockResolvedValue(undefined);
  vi.spyOn(service.ethereum, 'receipt').mockResolvedValue({ state: 'FINALIZED', matched: true, receipt: { blockHash: hash }, contractAddress: null });
  vi.spyOn(service.ethereum, 'events').mockReturnValue([{ address: P.pool, name: 'Supply', args: { reserve: P.usdc, user: config.ethereumLendingRouter, onBehalfOf: config.ethereumWallet, amount: 1_000_000n } },
    { address: config.ethereumLendingRouter!, name: 'Lent', args: { user: config.ethereumWallet, target: P.pool, principal: 1_000_000n, fee: 1000n } },
    { address: P.usdc, name: 'Transfer', args: { from: config.ethereumWallet, to: config.ethereumLendingRouter, value: 1_001_000n } },
    { address: P.usdc, name: 'Transfer', args: { from: config.ethereumLendingRouter, to: config.ethereumTreasury, value: 1000n } }]);
  vi.spyOn(service.ethereum, 'call').mockResolvedValue('0x0f4240');
  vi.spyOn(service.solana, 'inspect').mockResolvedValue({ supplied: '0', receiptExchangeRate: '1200000000000000000', usdc: '5000000', collateral: '0', lamports: '100000000', circleFeeRecipient: config.solanaTreasury, minimumFeeBps: 0, slot: 100 });
  vi.spyOn(service.solana, 'blockhash').mockResolvedValue({ blockhash: Keypair.fromSeed(new Uint8Array(32).fill(13)).publicKey.toBase58(), lastValidBlockHeight: 1000, contextSlot: 100 });
  vi.spyOn(service.solana, 'simulate').mockResolvedValue({ usdc: '3999000', collateral: '900000' });
  vi.spyOn(service.solana, 'lendingCost').mockResolvedValue(2_044_280n);
  vi.spyOn(service.solana, 'receipt').mockResolvedValue({ state: 'FINALIZED', receipt: { meta: {} } } as never);
  vi.spyOn(service.solana, 'tokenChange').mockImplementation((_meta, wallet, mint) => wallet === config.solanaTreasury ? 1000n : mint === SOLANA_USDC.toBase58() ? -1_001_000n : 900_000n);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); journal.close(); unlinkSync(path); });

describe('direct lending on each chain', () => {
  it('prepares, verifies and recovers Ethereum lending setup with only an Ethereum wallet', async () => {
    const selected = save({ ...config, solanaWallet: null, ethereumLendingRouter: null });
    const step = await service.lending.prepare(selected, ETH, 'supply', '1', {}, 'aave');
    expect(step.kind).toBe('DEPLOY_LENDING'); expect(step.ethereum?.to).toBeUndefined();
    await expect(validateReviewedStep(step, selected)).resolves.toBeUndefined();
    const changed = refingerprint({ ...step, ethereum: { ...step.ethereum!, data: `${step.ethereum!.data.slice(0, -2)}ff` as Hex } });
    await expect(validateReviewedStep(changed, selected)).rejects.toThrow(/setup/);
    await service.reserve(step.id); journal.changeStep(step.id, ['RESERVED'], { state: 'SUBMITTED', transactionId: hash });
    vi.mocked(service.ethereum.receipt).mockResolvedValue({ state: 'FINALIZED', matched: true, receipt: {}, contractAddress: config.ethereumLendingRouter! });
    expect((await service.reconcile(step.id)).state).toBe('FINALIZED');
    expect(readLocalWalletConfig().ethereumLendingRouter).toBe(config.ethereumLendingRouter);
    expect(service.ethereum.validateLendingRouter).toHaveBeenCalled();
  });
  it.each([ETH, SOL])('requires both principal and fee and rejects substituted fee reviews on %s', async (network) => {
    if (network === ETH) vi.mocked(service.ethereum.rpc.inspect).mockResolvedValue(inspection({ usdc: '1000000' }));
    else vi.mocked(service.solana.inspect).mockResolvedValue({ ...(await service.solana.inspect({ solanaWallet: config.solanaWallet!, solanaTreasury: config.solanaTreasury })), usdc: '1000000' });
    await expect(service.lending.prepare(config, network, 'supply', '1')).rejects.toThrow(/routing fee/);
    vi.mocked(service.ethereum.rpc.inspect).mockResolvedValue(inspection());
    vi.mocked(service.solana.inspect).mockResolvedValue({ supplied: '0', receiptExchangeRate: '1200000000000000000', usdc: '5000000', collateral: '0', lamports: '100000000', circleFeeRecipient: config.solanaTreasury, minimumFeeBps: 0, slot: 100 });
    const step = await service.lending.prepare(config, network, 'supply', '1');
    for (const change of [{ platformFee: '0' }, { routingFeeBps: '20' }, { feeTreasury: step.wallet }]) {
      await expect(validateReviewedStep(refingerprint({ ...step, evidence: { ...step.evidence, ...change } }), config)).rejects.toThrow(/routing fee/);
    }
    if (network === SOL) {
      const original = VersionedTransaction.deserialize(Buffer.from(step.solana!.serialized, 'base64'));
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: original.message.recentBlockhash,
        instructions: TransactionMessage.decompile(original.message).instructions.slice(0, -1) }).compileToV0Message());
      const altered = refingerprint({ ...step, solana: { ...step.solana!, serialized: Buffer.from(tx.serialize()).toString('base64'), message: Buffer.from(tx.message.serialize()).toString('base64') } });
      await expect(validateReviewedStep(altered, config)).rejects.toThrow(/instructions/);
    }
  });
  it.each([ETH, SOL])('does not report success if the exact treasury fee is missing on %s', async (network) => {
    const step = await service.lending.prepare(config, network, 'supply', '1'); await service.reserve(step.id);
    journal.changeStep(step.id, ['RESERVED'], { state: 'SUBMITTED', transactionId: hash });
    if (network === ETH) {
      const events = service.ethereum.events({});
      vi.mocked(service.ethereum.events).mockReturnValue(events.filter((e) => e.args.to !== config.ethereumTreasury));
    } else vi.mocked(service.solana.tokenChange).mockImplementation((_meta, wallet, mint) => wallet === config.solanaTreasury ? 0n : mint === SOLANA_USDC.toBase58() ? -1_001_000n : 900_000n);
    await expect(service.reconcile(step.id)).rejects.toThrow(/routing fee/);
    expect(journal.step(step.id).state).toBe('SUBMITTED');
  });
  it.each([ETH, SOL])('prepares %s with its wallet and an atomic 0.10% routing fee', async (network) => {
    const selected = save({ ...config, ethereumWallet: network === ETH ? config.ethereumWallet : null, solanaWallet: network === SOL ? config.solanaWallet : null });
    const response = await POST(request('lending-prepare', { network, action: 'supply', amount: '1' }));
    expect(response.status).toBe(200); expect(response.headers.has('set-cookie')).toBe(false);
    const step = await response.json() as BridgeStep;
    expect(step).toMatchObject({ kind: 'LENDING_SUPPLY', state: 'PREPARED', bridgeId: null, sourcePrincipal: '1000000', evidence: { asset: 'USDC', amount: '1000000', platformFee: '1000', totalSourceDebit: '1001000' } });
    await expect(validateReviewedStep(step, selected)).resolves.toBeUndefined();
    expect(journal.bridges()).toEqual([]);
    if (network === ETH) {
      expect(step.ethereum?.to).toBe(config.ethereumLendingRouter);
      expect(decodeFunctionData({ abi: LENDING_ROUTER_ABI, data: step.ethereum!.data })).toMatchObject({ functionName: 'supply', args: [0, 1_000_000n] });
      expect(service.solana.inspect).not.toHaveBeenCalled();
    } else {
      expect(service.ethereum.rpc.inspect).not.toHaveBeenCalled();
      const tx = VersionedTransaction.deserialize(Buffer.from(step.solana!.serialized, 'base64'));
      expect(tx.message.addressTableLookups).toEqual([]); expect(tx.signatures.every((sig) => sig.every((byte) => byte === 0))).toBe(true);
      const instructions = TransactionMessage.decompile(tx.message).instructions;
      expect(instructions).toHaveLength(6);
      const deposit = instructions[3]!; expect(deposit.programId.equals(KAMINO_PROGRAM)).toBe(true); expect(deposit.data.readBigUInt64LE(8)).toBe(1_000_000n);
      expect(deposit.keys[0]!.pubkey.toBase58()).toBe(config.solanaWallet);
    }
    const state = await GET(new Request(`${P.origin}/api/local-mainnet`, { headers: { host: '127.0.0.1:3000', 'x-local-mainnet-setup': capability } }));
    expect(await state.json()).toMatchObject({ authenticated: false, steps: [], bridges: [], lendingSteps: [{ id: step.id }] });
  });
  it.each(['0', '2000000'])('requires an exact Aave allowance and handles an existing allowance (%s)', async (allowance) => {
    vi.mocked(service.ethereum.allowance).mockResolvedValue(BigInt(allowance));
    const step = await service.lending.prepare(config, ETH, 'supply', '1');
    expect(step.kind).toBe(allowance === '0' ? 'LENDING_APPROVAL' : 'LENDING_REVOKE');
    expect(step.sourcePrincipal).toBe('0'); expect(step.evidence.lendAmount).toBe('1000000');
    const decoded = decodeFunctionData({ abi: TOKEN_ABI, data: step.ethereum!.data });
    expect(decoded.functionName).toBe('approve'); expect(String(decoded.args![0]).toLowerCase()).toBe(config.ethereumLendingRouter);
    expect(decoded.args![1]).toBe(allowance === '0' ? 1_001_000n : 0n);
    await expect(validateReviewedStep(step, { ...config, solanaWallet: null })).resolves.toBeUndefined();
  });
  it.each([ETH, SOL])('withdraws the full position back to the same %s wallet, including when deposits are paused', async (network) => {
    journal.pause(true);
    vi.mocked(service.ethereum.rpc.inspect).mockResolvedValue(inspection({ supplied: '1500000' }));
    vi.mocked(service.solana.inspect).mockResolvedValue({ supplied: '1500000', receiptExchangeRate: '1666666666666666666', usdc: '5000000', collateral: '900000', lamports: '100000000', circleFeeRecipient: config.solanaTreasury, minimumFeeBps: 0, slot: 100 });
    vi.mocked(service.solana.simulate).mockResolvedValue({ usdc: '6500000', collateral: '0' });
    const selected = save({ ...config, ethereumWallet: network === ETH ? config.ethereumWallet : null, solanaWallet: network === SOL ? config.solanaWallet : null });
    const step = await service.lending.prepare(selected, network, 'withdraw', 'all');
    expect(step.sourcePrincipal).toBe('0'); expect(step.evidence).toMatchObject({ amount: '1500000', withdrawAll: 'true', platformFee: '0' });
    await expect(validateReviewedStep(step, selected)).resolves.toBeUndefined();
    if (network === ETH) expect(decodeFunctionData({ abi: POOL_ABI, data: step.ethereum!.data })).toMatchObject({ functionName: 'withdraw', args: [expect.any(String), maxUint256, config.ethereumWallet] });
    else {
      const instructions = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(step.solana!.serialized, 'base64')).message).instructions;
      expect(instructions[3]!.data.readBigUInt64LE(8)).toBe(900_000n); expect(step.evidence.collateralAmount).toBe('900000');
    }
    await expect(service.reserve(step.id)).resolves.toMatchObject({ state: 'RESERVED' });
    await expect(service.reserve(step.id)).rejects.toThrow(/expired|already/);
  });
  it('rejects unsupported assets/amounts, missing wallets, and unbacked Solana balance previews', async () => {
    for (const amount of ['0', '1.0000001', '1e0', '-1']) await expect(service.lending.prepare(config, ETH, 'supply', amount)).rejects.toThrow();
    await expect(service.lending.prepare({ ...config, ethereumWallet: null }, ETH, 'supply', '1')).rejects.toThrow(/Connect/);
    await expect(service.lending.prepare(config, 'eip155:8453', 'supply', '1')).rejects.toThrow(/Choose/);
    vi.mocked(service.solana.simulate).mockResolvedValue({ usdc: '3998999', collateral: '900000' });
    await expect(service.lending.prepare(config, SOL, 'supply', '1')).rejects.toThrow(/simulated/);
    expect(journal.steps()).toEqual([]);
  });
  it('enforces funding, debt, expiry, and changed balances before reservation', async () => {
    for (const change of [{ usdc: '1' }, { totalDebt: '1' }]) {
      vi.mocked(service.ethereum.rpc.inspect).mockResolvedValue(inspection(change));
      await expect(service.lending.prepare(config, ETH, 'supply', '1')).rejects.toThrow();
    }
    vi.mocked(service.ethereum.rpc.inspect).mockResolvedValue(inspection());
    const step = await service.lending.prepare(config, ETH, 'supply', '1');
    vi.mocked(service.ethereum.allowance).mockResolvedValue(0n);
    await expect(service.reserve(step.id)).rejects.toThrow(/changed/); expect(journal.step(step.id).state).toBe('PREPARED');
    vi.spyOn(Date, 'now').mockReturnValue(step.expiresAt + 1);
    await expect(service.reserve(step.id)).rejects.toThrow(/expired/);
  });
  it('rejects substituted recipients, spenders, networks, and changed fingerprints in the browser review', async () => {
    const step = await service.lending.prepare(config, ETH, 'supply', '1');
    const redirected = { ...step, ethereum: { ...step.ethereum!, data: encodeFunctionData({ abi: POOL_ABI, functionName: 'supply', args: [P.usdc, 1_000_000n, config.ethereumTreasury, 0] }) } };
    await expect(validateReviewedStep(redirected, config)).rejects.toThrow(/changed/);
    await expect(validateReviewedStep(refingerprint(redirected), config)).rejects.toThrow(/does not match/);
    await expect(validateReviewedStep(refingerprint({ ...step, ethereum: { ...step.ethereum!, chainId: '0x2' } as never }), config)).rejects.toThrow(/policy/);
    const approval = refingerprint({ ...step, kind: 'LENDING_APPROVAL', ethereum: { ...step.ethereum!, to: P.usdc, data: encodeFunctionData({ abi: TOKEN_ABI, functionName: 'approve', args: [config.ethereumTreasury, 1_000_000n] }) } });
    await expect(validateReviewedStep(approval, config)).rejects.toThrow(/allowance/);
  });
  it.each([ETH, SOL])('requires finalized and exact lending evidence on %s before reporting completion', async (network) => {
    const step = await service.lending.prepare(config, network, 'supply', '1'); await service.reserve(step.id);
    journal.changeStep(step.id, ['RESERVED'], { state: 'SUBMITTED', transactionId: network === ETH ? hash : 'saved-solana-signature' });
    if (network === ETH) {
      vi.mocked(service.ethereum.receipt).mockResolvedValueOnce({ state: 'CONFIRMED', matched: true, receipt: {}, contractAddress: null });
      expect((await service.reconcile(step.id)).state).toBe('CONFIRMED');
      vi.mocked(service.ethereum.events).mockReturnValueOnce([]);
    } else vi.mocked(service.solana.tokenChange).mockReturnValueOnce(-1_001_001n);
    await expect(service.reconcile(step.id)).rejects.toThrow(/verified/);
    expect(journal.step(step.id).state).not.toBe('FINALIZED');
    expect((await service.reconcile(step.id)).state).toBe('FINALIZED');
    expect((await service.reconcile(step.id)).state).toBe('FINALIZED');
  });
  it('verifies a withdrawal credited the original wallet before calling it complete', async () => {
    vi.mocked(service.ethereum.rpc.inspect).mockResolvedValue(inspection({ supplied: '1000000' }));
    const step = await service.lending.prepare(config, ETH, 'withdraw', 'all'); await service.reserve(step.id);
    journal.changeStep(step.id, ['RESERVED'], { state: 'SUBMITTED', transactionId: hash });
    const withdrawal = { address: P.pool, name: 'Withdraw', args: { reserve: P.usdc, user: config.ethereumWallet, to: config.ethereumWallet, amount: 1_000_001n } };
    vi.mocked(service.ethereum.events).mockReturnValue([withdrawal]);
    await expect(service.reconcile(step.id)).rejects.toThrow(/withdrawal/);
    vi.mocked(service.ethereum.events).mockReturnValue([withdrawal, { address: P.usdc, name: 'Transfer', args: { from: P.aToken, to: config.ethereumWallet, value: 1_000_001n } }]);
    expect((await service.reconcile(step.id)).state).toBe('FINALIZED');
  });
  it('accepts Kamino receipt-token rounding and records the actual finalized USDC debit', async () => {
    vi.mocked(service.solana.simulate).mockResolvedValue({ usdc: '4999000', collateral: '832' });
    const step = await service.lending.prepare(config, SOL, 'supply', '0.001');
    expect(step.evidence).toMatchObject({ amount: '1000', expectedDebit: '999', expectedReceived: '832' });
    expect(step.sourcePrincipal).toBe('1000'); await service.reserve(step.id);
    journal.changeStep(step.id, ['RESERVED'], { state: 'SUBMITTED', transactionId: 'saved-solana-signature' });
    vi.mocked(service.solana.tokenChange).mockImplementation((_meta, wallet, mint) => wallet === config.solanaTreasury ? 1n : mint === SOLANA_USDC.toBase58() ? -1000n : 832n);
    expect(await service.reconcile(step.id)).toMatchObject({ state: 'FINALIZED', outcome: { usdcAmount: '999', receiptTokens: '832' } });
  });
  it('requires both the Kamino collateral burn and a positive wallet USDC credit for withdrawal', async () => {
    vi.mocked(service.solana.inspect).mockResolvedValue({ supplied: '998', receiptExchangeRate: '1200000000000000000', usdc: '5000000', collateral: '832', lamports: '100000000', circleFeeRecipient: config.solanaTreasury, minimumFeeBps: 0, slot: 100 });
    vi.mocked(service.solana.simulate).mockResolvedValue({ usdc: '5000998', collateral: '0' });
    const step = await service.lending.prepare(config, SOL, 'withdraw', 'all'); await service.reserve(step.id);
    journal.changeStep(step.id, ['RESERVED'], { state: 'SUBMITTED', transactionId: 'saved-solana-signature' });
    vi.mocked(service.solana.tokenChange).mockImplementation((_meta, _wallet, mint) => mint === SOLANA_USDC.toBase58() ? 0n : -832n);
    await expect(service.reconcile(step.id)).rejects.toThrow(/not verified/);
    vi.mocked(service.solana.tokenChange).mockImplementation((_meta, _wallet, mint) => mint === SOLANA_USDC.toBase58() ? 998n : -832n);
    expect(await service.reconcile(step.id)).toMatchObject({ state: 'FINALIZED', outcome: { usdcAmount: '998', receiptTokens: '832' } });
  });
});

describe('local capability and wallet execution', () => {
  it('sends an Ethereum-only deposit through its wallet with no message login', async () => {
    const selected = save({ ...config, solanaWallet: null }); const step = await service.lending.prepare(selected, ETH, 'supply', '1');
    const walletRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x1'; if (method === 'eth_accounts') return [config.ethereumWallet];
      if (method === 'eth_sendTransaction') { expect(journal.step(step.id).state).toBe('RESERVED'); return hash; }
      throw new Error(`Unexpected wallet request: ${method}`);
    });
    const wallets = new BridgeWallets(); Object.assign(wallets, { ethereum: { request: walletRequest } }); vi.stubGlobal('localStorage', { setItem: vi.fn() });
    const operations: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const { operation, ...fields } = JSON.parse(String(options?.body)); operations.push(operation);
      expect(new Headers(options?.headers).get('x-local-mainnet-setup')).toBe(capability); return POST(request(operation, fields));
    });
    const remember = vi.fn(); await wallets.send(step, selected, undefined, remember, capability);
    expect(operations).toEqual(['lending-reserve', 'lending-submitted']); expect(remember).toHaveBeenCalledWith(hash);
    expect(walletRequest.mock.calls.map(([arg]) => arg.method)).not.toContain('personal_sign'); expect(journal.step(step.id).state).toBe('FINALIZED');
  });
  it('requires the current local capability and origin and separates lending step operations from bridge steps', async () => {
    const fields = { network: ETH, action: 'supply', amount: '1' };
    for (const token of ['', 'b'.repeat(64)]) expect((await POST(request('lending-prepare', fields, token))).status).toBe(401);
    const foreign = request('lending-prepare', fields); foreign.headers.set('origin', 'https://example.com'); expect((await POST(foreign)).status).toBe(404);
    vi.stubEnv('NODE_ENV', 'production'); expect((await POST(request('lending-prepare', fields))).status).toBe(404); vi.stubEnv('NODE_ENV', 'development');
    expect(service.ethereum.prepare).not.toHaveBeenCalled();
    const step = await service.lending.prepare(config, ETH, 'supply', '1');
    expect((await POST(request('reserve', { id: step.id }, ''))).status).toBe(401);
    expect((await POST(request('reserve', { id: step.id }))).status).toBe(400);
    const get = await GET(new Request(`${P.origin}/api/local-mainnet`, { headers: { host: '127.0.0.1:3000' } })); expect(get.status).toBe(401);
    const bridgeStep = refingerprint({ ...step, id: randomUUID(), kind: 'DEPLOY_SOURCE' }); service.cancelStep(step.id); journal.createStep(bridgeStep);
    expect((await POST(request('lending-reserve', { id: bridgeStep.id }))).status).toBe(400); expect(journal.step(bridgeStep.id).state).toBe('PREPARED');
  });
  it('refreshes the blockhash, survives Phantom fee enhancement, and dispatches the saved signed bytes once', async () => {
    const selected = save({ ...config, ethereumWallet: null });
    const step = await service.lending.prepare(selected, SOL, 'supply', '1');
    const freshHash = Keypair.fromSeed(new Uint8Array(32).fill(14)).publicKey.toBase58();
    vi.mocked(service.solana.blockhash).mockResolvedValue({ blockhash: freshHash, lastValidBlockHeight: 1200, contextSlot: 200 });
    vi.mocked(service.solana.simulate).mockImplementation(async (serialized, height) => {
      if (height < 1200) throw new Error('The Solana transaction is expiring. Prepare a fresh review.');
      expect(VersionedTransaction.deserialize(Buffer.from(serialized, 'base64')).message.recentBlockhash).toBe(freshHash);
      return { usdc: '3999000', collateral: '900000' };
    });
    const account = { address: config.solanaWallet!, chains: ['solana:mainnet'] };
    const signTransaction = vi.fn(async ({ transaction }: { transaction: Uint8Array }) => {
      expect(journal.step(step.id).state).toBe('RESERVED');
      const tx = phantomPriorityFee(VersionedTransaction.deserialize(transaction));
      expect(tx.message.recentBlockhash).toBe(freshHash);
      expect(journal.step(step.id).fingerprint).not.toBe(step.fingerprint);
      tx.sign([signer]); return [{ signedTransaction: tx.serialize() }];
    });
    const wallets = new BridgeWallets(); Object.assign(wallets, { solana: { accounts: [account], features: { 'solana:signTransaction': { supportedTransactionVersions: [0], signTransaction } } }, account });
    const storage = new Map<string, string>(); vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => storage.set(key, value) });
    const operations: string[] = [], broadcasts: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      const body = JSON.parse(String(options?.body));
      if (url === '/api/mainnet') {
        operations.push(body.operation); expect(new Headers(options?.headers).get('x-local-mainnet-setup')).toBe(capability);
        const { operation, ...fields } = body; return POST(request(operation, fields));
      }
      expect(url).toBe('https://solana-rpc.publicnode.com');
      if (body.method === 'getGenesisHash') return Response.json({ id: 1, result: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' });
      expect(body.method).toBe('sendTransaction'); broadcasts.push(body.params[0]); return Response.json({ id: 1, result: journal.step(step.id).transactionId });
    });
    const remember = vi.fn(), status = vi.fn(); await wallets.send(step, selected, undefined, remember, capability, status);
    expect(signTransaction).toHaveBeenCalledTimes(1); expect(remember).toHaveBeenCalledTimes(1); expect(broadcasts).toEqual([journal.signedPayload(step.id)]);
    expect(status.mock.calls.map(([message]) => message)).toEqual(expect.arrayContaining([expect.stringMatching(/Checking balances/), expect.stringMatching(/Waiting for approval/)]));
    expect(operations).toEqual(['lending-reserve', 'lending-signed', 'lending-dispatch-solana', 'lending-reconcile']);
    expect(journal.step(step.id).state).toBe('FINALIZED');
    await expect(wallets.send(step, selected, undefined, remember, capability)).rejects.toThrow(/already|expired/); expect(signTransaction).toHaveBeenCalledTimes(1);
    await expect(service.dispatchSolana(step.id)).rejects.toThrow(/already/);
  });
  it('reproduces the unpriced Phantom mismatch and requires the explicit reviewed price', async () => {
    const step = await service.lending.prepare(config, SOL, 'supply', '1');
    const original = VersionedTransaction.deserialize(Buffer.from(step.solana!.serialized, 'base64'));
    const message = TransactionMessage.decompile(original.message);
    const [price] = message.instructions.splice(1, 1);
    expect(ComputeBudgetInstruction.decodeSetComputeUnitPrice(price!)).toEqual({ microLamports: 0n });
    const old = new VersionedTransaction(message.compileToV0Message());
    const oldStep = refingerprint({ ...step, solana: { ...step.solana!, serialized: Buffer.from(old.serialize()).toString('base64'), message: Buffer.from(old.message.serialize()).toString('base64') } });
    const enhanced = phantomPriorityFee(old); enhanced.sign([signer]);
    expect(() => service.solana.verifySigned(oldStep, Buffer.from(enhanced.serialize()).toString('base64'))).toThrow(/changed/);
    await expect(validateReviewedStep(oldStep, config)).rejects.toThrow(/instructions/);
    await expect(validateReviewedStep(step, config)).resolves.toBeUndefined();
    expect(Buffer.from(phantomPriorityFee(original).message.serialize()).toString('base64')).toBe(step.solana!.message);
  });
  it.each(['principal', 'routing fee', 'treasury', 'priority fee'] as const)('still rejects a signed change to the %s', async (field) => {
    const step = await service.lending.prepare(config, SOL, 'supply', '1'); await service.reserve(step.id);
    const original = VersionedTransaction.deserialize(Buffer.from(step.solana!.serialized, 'base64'));
    const message = TransactionMessage.decompile(original.message);
    if (field === 'principal') message.instructions[3]!.data.writeBigUInt64LE(2_000_000n, 8);
    if (field === 'routing fee') message.instructions.at(-1)!.data.writeBigUInt64LE(2_000n, 1);
    if (field === 'treasury') message.instructions.at(-1)!.keys[2]!.pubkey = signer.publicKey;
    if (field === 'priority fee') message.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25_000 });
    const changed = new VersionedTransaction(message.compileToV0Message()); changed.sign([signer]);
    await expect(service.signed(step.id, Buffer.from(changed.serialize()).toString('base64'))).rejects.toThrow(/changed/);
    expect(journal.signedPayload(step.id)).toBeNull();
    expect(journal.step(step.id).state).toBe('RESERVED');
    await expect(service.dispatchSolana(step.id)).rejects.toThrow(/already/);
  });
  it('never refreshes signed, reserved or expired reviews and rolls back an instruction change', async () => {
    const step = await service.lending.prepare(config, SOL, 'supply', '1');
    const transaction = VersionedTransaction.deserialize(Buffer.from(step.solana!.serialized, 'base64'));
    transaction.message.compiledInstructions[3]!.data[8] = transaction.message.compiledInstructions[3]!.data[8]! ^ 1;
    const changed = { ...step.solana!, serialized: Buffer.from(transaction.serialize()).toString('base64'), message: Buffer.from(transaction.message.serialize()).toString('base64') };
    expect(() => journal.reserveStep(step.id, Date.now(), changed)).toThrow(/differs/);
    expect(journal.step(step.id)).toEqual(step);
    expect(() => journal.reserveStep(step.id, step.expiresAt + 1, step.solana)).toThrow(/reserved/);
    await service.reserve(step.id);
    expect(() => journal.reserveStep(step.id, Date.now(), step.solana)).toThrow(/reserved/);
    await service.signed(step.id, signStep(journal.step(step.id)));
    await expect(service.reserve(step.id)).rejects.toThrow(/reserved/);
    expect(journal.step(step.id).state).toBe('SIGNED');
  });
  it('does not open the wallet if reservation changes the reviewed Solana instructions', async () => {
    const step = await service.lending.prepare(config, SOL, 'supply', '1');
    const account = { address: config.solanaWallet!, chains: ['solana:mainnet'] }, signTransaction = vi.fn();
    const wallets = new BridgeWallets(); Object.assign(wallets, { solana: { accounts: [account], features: { 'solana:signTransaction': { supportedTransactionVersions: [0], signTransaction } } }, account });
    vi.spyOn(wallets, 'check').mockResolvedValue(undefined);
    vi.stubGlobal('localStorage', { setItem: vi.fn() });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === 'https://solana-rpc.publicnode.com') return Response.json({ id: 1, result: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' });
      const reserved = await service.reserve(step.id);
      const transaction = VersionedTransaction.deserialize(Buffer.from(reserved.solana!.serialized, 'base64'));
      transaction.message.compiledInstructions[3]!.data[8] = transaction.message.compiledInstructions[3]!.data[8]! ^ 1;
      const altered = refingerprint({ ...reserved, solana: { ...reserved.solana!, serialized: Buffer.from(transaction.serialize()).toString('base64'), message: Buffer.from(transaction.message.serialize()).toString('base64') } });
      return Response.json(altered);
    });
    await expect(wallets.send(step, config, undefined, vi.fn(), capability)).rejects.toThrow(/differs/);
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it('rejects altered or unsigned Solana payloads while retaining their reservation for recovery', async () => {
    const step = await service.lending.prepare(config, SOL, 'supply', '1'); await service.reserve(step.id);
    await expect(service.signed(step.id, step.solana!.serialized)).rejects.toThrow(/signature/);
    const tx = VersionedTransaction.deserialize(Buffer.from(signStep(step), 'base64')); tx.message.recentBlockhash = signer.publicKey.toBase58(); tx.sign([signer]);
    await expect(service.signed(step.id, Buffer.from(tx.serialize()).toString('base64'))).rejects.toThrow(/changed/);
    expect(journal.step(step.id).state).toBe('RESERVED');
    const signed = await service.signed(step.id, signStep(step)); expect(signed.state).toBe('SIGNED');
    expect((await service.dispatchSolana(step.id)).step.state).toBe('SUBMITTED');
    await expect(service.dispatchSolana(step.id)).rejects.toThrow(/already/);
  });
  it.each([403, 429])('detects an HTTP %s browser RPC failure before reserving or requesting a signature', async (status) => {
    const step = await service.lending.prepare(config, SOL, 'supply', '1');
    const wallets = new BridgeWallets(); vi.spyOn(wallets, 'check').mockResolvedValue(undefined);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: { code: status } }, { status }));
    await expect(wallets.send(step, config, undefined, vi.fn(), capability)).rejects.toThrow(`connection check failed (HTTP ${status}). No transaction was sent`);
    expect(journal.step(step.id).state).toBe('PREPARED');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).method).toBe('getGenesisHash');
  });
  it('never retries or switches RPCs after an ambiguous send result', async () => {
    const step = await service.lending.prepare(config, SOL, 'supply', '1'); await service.reserve(step.id);
    const signed = await service.signed(step.id, signStep(step)), wallets = new BridgeWallets();
    vi.spyOn(wallets, 'check').mockResolvedValue(undefined);
    let broadcasts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      const body = JSON.parse(String(options?.body));
      if (url === '/api/mainnet') { const { operation, ...fields } = body; return POST(request(operation, fields)); }
      expect(url).toBe('https://solana-rpc.publicnode.com');
      if (body.method === 'getGenesisHash') return Response.json({ id: 1, result: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' });
      expect(body.method).toBe('sendTransaction'); broadcasts++;
      expect(body.params[0]).toBe(journal.signedPayload(step.id));
      throw new Error('Connection lost after upload');
    });
    await expect(wallets.dispatch(signed, config, capability)).rejects.toThrow(/submission is unconfirmed/);
    expect(journal.step(step.id)).toMatchObject({ state: 'SUBMITTED', transactionId: signed.transactionId });
    await expect(wallets.dispatch(signed, config, capability)).rejects.toThrow(/already dispatched/);
    expect(broadcasts).toBe(1);
  });
  it('preserves signed bytes and closes an expired deposit only after on-chain absence is verified', async () => {
    const step = await service.lending.prepare(config, SOL, 'supply', '1'); await service.reserve(step.id);
    const signed = await service.signed(step.id, signStep(step)), payload = journal.signedPayload(step.id);
    vi.mocked(service.solana.receipt).mockResolvedValue({ state: 'SUBMITTED', receipt: null });
    const expired = vi.spyOn(service.solana, 'expiredSignedRequest').mockResolvedValue(false);
    expect((await service.reconcile(step.id)).state).toBe('SUBMITTED');
    expired.mockResolvedValue(true);
    expect(await service.reconcile(step.id)).toMatchObject({ state: 'CANCELLED', transactionId: signed.transactionId, walletError: '' });
    expect(journal.signedPayload(step.id)).toBe(payload);
    expect((await service.lending.prepare(config, SOL, 'supply', '1')).state).toBe('PREPARED');
  });
  it('allows repeated wallet-funded deposits beyond the former 5 USDC daily cap', async () => {
    for (let i = 0; i < 5; i++) { const step = await service.lending.prepare(config, ETH, 'supply', '1'); await service.reserve(step.id); journal.changeStep(step.id, ['RESERVED'], { state: 'FAILED' }); }
    const last = await service.lending.prepare(config, ETH, 'supply', '1'); expect((await service.reserve(last.id)).state).toBe('RESERVED');
  });
  it('recovers an expired wallet prompt without losing a real transaction or sending again', async () => {
    const step = await service.lending.prepare(config, SOL, 'supply', '1'); await service.reserve(step.id);
    const recovery = vi.spyOn(service.solana, 'recoverExpiredWalletRequest').mockRejectedValue(new Error('The request is still open.'));
    await expect(service.recoverWalletRequest(step.id)).rejects.toThrow(/still open/);
    expect(journal.step(step.id).state).toBe('RESERVED');
    recovery.mockResolvedValue(null);
    expect((await service.recoverWalletRequest(step.id)).state).toBe('CANCELLED');
    const next = await service.lending.prepare(config, SOL, 'supply', '1'); await service.reserve(next.id);
    recovery.mockResolvedValue('saved-solana-signature');
    expect(await service.recoverWalletRequest(next.id)).toMatchObject({ state: 'FINALIZED', transactionId: 'saved-solana-signature' });
    expect(service.solana.receipt).toHaveBeenCalledWith(expect.objectContaining({ id: next.id }), 'saved-solana-signature');
  });
});
