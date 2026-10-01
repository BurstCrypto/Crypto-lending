// @vitest-environment node
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KAMINO_COLLATERAL_MINT,
  kaminoUsdcSupplyInstructions,
} from '../../../../onchain/src/destination-lending';
import { SOLANA_USDC, TOKEN_PROGRAM } from '../../../../onchain/src/source-plan';
import { BridgeSolana } from '../mainnet/bridge-solana.server';
import type { BridgeStep } from '../mainnet/bridge-types';

const wallet = Keypair.fromSeed(new Uint8Array(32).fill(23)).publicKey;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function account(mint: PublicKey, amount: bigint, owner = wallet) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return {
    owner: TOKEN_PROGRAM.toBase58(),
    data: [data.toString('base64'), 'base64'],
    executable: false,
    lamports: 2_039_280,
    rentEpoch: 0,
  };
}
function sources() {
  const connections = [
    new Connection('http://127.0.0.1:1'),
    new Connection('http://127.0.0.1:2'),
  ] as const;
  for (const [index, connection] of connections.entries()) {
    vi.spyOn(connection, 'getLatestBlockhashAndContext').mockResolvedValue({
      context: { slot: 110 - index * 10 },
      value: {
        blockhash: `${index === 0 ? 'newer' : 'older'}-hash`,
        lastValidBlockHeight: 1000 - index * 10,
      },
    });
    vi.spyOn(connection, 'isBlockhashValid').mockImplementation(async (hash) => ({
      context: { slot: 110 },
      value: hash === 'older-hash',
    }));
    vi.spyOn(connection, 'getEpochInfo').mockResolvedValue({
      absoluteSlot: 110,
      blockHeight: 900,
      epoch: 0,
      slotIndex: 110,
      slotsInEpoch: 432000,
    });
    vi.spyOn(connection, 'simulateTransaction').mockResolvedValue({
      context: { slot: 110 },
      value: {
        err: null,
        unitsConsumed: 150_000,
        logs: [],
        accounts: [account(SOLANA_USDC, 4_000_000n), account(KAMINO_COLLATERAL_MINT, 900_000n)],
      },
    });
  }
  return connections;
}
const serialized = () =>
  Buffer.from(
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet,
        recentBlockhash: wallet.toBase58(),
        instructions: [...kaminoUsdcSupplyInstructions({ user: wallet, principal: 1_000_000n })],
      }).compileToV0Message(),
    ).serialize(),
  ).toString('base64');

describe('Solana lending RPC agreement', () => {
  it('shares identical in-flight reads, preserves independent sources and never caches completed evidence', async () => {
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ jsonrpc: '2.0', id: request.id, result: 'mainnet-genesis' });
    });
    vi.stubGlobal('fetch', transport);
    const rpc = new BridgeSolana();
    expect(
      await Promise.all([
        rpc.connections[0].getGenesisHash(),
        rpc.connections[0].getGenesisHash(),
        rpc.connections[1].getGenesisHash(),
      ]),
    ).toEqual(['mainnet-genesis', 'mainnet-genesis', 'mainnet-genesis']);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(new Set(transport.mock.calls.map(([url]) => String(url))).size).toBe(2);
    await rpc.connections[0].getGenesisHash();
    expect(transport).toHaveBeenCalledTimes(3);
    await expect(rpc.connections[0].sendRawTransaction(new Uint8Array(10))).rejects.toThrow(
      /cannot broadcast/,
    );
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('uses the actual message fee and rent only for a missing token account, without a blanket SOL minimum', async () => {
    const connections = sources(),
      rpc = new BridgeSolana(connections);
    for (const c of connections) {
      vi.spyOn(c, 'getFeeForMessage').mockResolvedValue({ context: { slot: 110 }, value: 5000 });
      vi.spyOn(c, 'getMinimumBalanceForRentExemption').mockResolvedValue(2_039_280);
      vi.spyOn(c, 'getAccountInfo').mockResolvedValue(null);
    }
    expect(await rpc.lendingCost(wallet.toBase58(), 'supply', 100, serialized())).toBe(2_044_280n);
    const existing = account(KAMINO_COLLATERAL_MINT, 1n);
    for (const c of connections)
      vi.mocked(c.getAccountInfo).mockResolvedValue({
        ...existing,
        owner: TOKEN_PROGRAM,
        data: Buffer.from(existing.data[0]!, 'base64'),
      });
    expect(await rpc.lendingCost(wallet.toBase58(), 'supply', 100, serialized())).toBe(5000n);
    vi.mocked(connections[1].getFeeForMessage).mockResolvedValue({
      context: { slot: 110 },
      value: 6000,
    });
    await expect(rpc.lendingCost(wallet.toBase58(), 'supply', 100, serialized())).rejects.toThrow(
      /changed/,
    );
  });
  it('selects a finalized blockhash shared by RPCs when one source is ahead', async () => {
    const connections = sources(),
      rpc = new BridgeSolana(connections);
    expect(await rpc.blockhash(90)).toEqual({
      blockhash: 'older-hash',
      lastValidBlockHeight: 990,
      contextSlot: 100,
    });
    for (const c of connections)
      expect(c.isBlockhashValid).toHaveBeenCalledWith('older-hash', {
        commitment: 'finalized',
        minContextSlot: 100,
      });
    vi.mocked(connections[1].isBlockhashValid).mockResolvedValue({
      context: { slot: 110 },
      value: false,
    });
    await expect(rpc.blockhash(90)).rejects.toThrow(/both sources/);
  });
  it('previews the actual post-simulation token accounts and rejects inconsistent or substituted balances', async () => {
    const connections = sources(),
      rpc = new BridgeSolana(connections);
    expect(await rpc.simulate(serialized(), 1000, 100, wallet.toBase58())).toEqual({
      usdc: '4000000',
      collateral: '900000',
    });
    vi.mocked(connections[1].simulateTransaction).mockResolvedValue({
      context: { slot: 110 },
      value: {
        err: null,
        logs: [],
        unitsConsumed: 150_000,
        accounts: [account(SOLANA_USDC, 3_999_999n), account(KAMINO_COLLATERAL_MINT, 900_000n)],
      },
    });
    await expect(rpc.simulate(serialized(), 1000, 100, wallet.toBase58())).rejects.toThrow(
      /disagree/,
    );
    vi.mocked(connections[1].simulateTransaction).mockResolvedValue({
      context: { slot: 110 },
      value: {
        err: null,
        logs: [],
        unitsConsumed: 150_000,
        accounts: [
          account(SOLANA_USDC, 4_000_000n, PublicKey.default),
          account(KAMINO_COLLATERAL_MINT, 900_000n),
        ],
      },
    });
    await expect(rpc.simulate(serialized(), 1000, 100, wallet.toBase58())).rejects.toThrow(
      /token accounts/,
    );
  });
  it('rejects expired blockhashes and failed simulations before requesting any signature', async () => {
    const connections = sources(),
      rpc = new BridgeSolana(connections);
    vi.mocked(connections[0].getEpochInfo).mockResolvedValue({
      absoluteSlot: 110,
      blockHeight: 995,
      epoch: 0,
      slotIndex: 110,
      slotsInEpoch: 432000,
    });
    await expect(rpc.simulate(serialized(), 1000, 100, wallet.toBase58())).rejects.toThrow(
      /expiring/,
    );
    expect(connections[0].simulateTransaction).not.toHaveBeenCalled();
    vi.mocked(connections[0].getEpochInfo).mockResolvedValue({
      absoluteSlot: 110,
      blockHeight: 900,
      epoch: 0,
      slotIndex: 110,
      slotsInEpoch: 432000,
    });
    vi.mocked(connections[0].simulateTransaction).mockResolvedValue({
      context: { slot: 110 },
      value: { err: { InstructionError: [1, 'InsufficientFunds'] }, logs: [], unitsConsumed: 1 },
    });
    await expect(rpc.simulate(serialized(), 1000, 100, wallet.toBase58())).rejects.toThrow(
      /simulation failed/,
    );
  });
  it('requires the exact simulated fee credit to the configured treasury on both RPC sources', async () => {
    const connections = sources(),
      rpc = new BridgeSolana(connections),
      treasury = Keypair.fromSeed(new Uint8Array(32).fill(24)).publicKey;
    const fee = { treasury: treasury.toBase58(), balance: 123n, amount: 1000n };
    const result = {
      context: { slot: 110 },
      value: {
        err: null,
        unitsConsumed: 180_000,
        logs: [],
        accounts: [
          account(SOLANA_USDC, 3_999_000n),
          account(KAMINO_COLLATERAL_MINT, 900_000n),
          account(SOLANA_USDC, 1123n, treasury),
        ],
      },
    };
    for (const connection of connections)
      vi.mocked(connection.simulateTransaction).mockResolvedValue(result);
    await expect(
      rpc.simulate(serialized(), 1000, 100, wallet.toBase58(), fee),
    ).resolves.toMatchObject({ usdc: '3999000' });
    vi.mocked(connections[1].simulateTransaction).mockResolvedValue({
      ...result,
      value: {
        ...result.value,
        accounts: [...result.value.accounts.slice(0, 2), account(SOLANA_USDC, 1122n, treasury)],
      },
    });
    await expect(rpc.simulate(serialized(), 1000, 100, wallet.toBase58(), fee)).rejects.toThrow(
      /treasury/,
    );
  });
  it('clears only expired wallet requests with complete matching finalized histories, and recovers a landed transaction', async () => {
    const connections = sources(),
      rpc = new BridgeSolana(connections);
    vi.spyOn(rpc, 'chain').mockResolvedValue(100);
    const transaction = VersionedTransaction.deserialize(Buffer.from(serialized(), 'base64'));
    const step = {
      state: 'RESERVED',
      transactionId: null,
      wallet: wallet.toBase58(),
      solana: {
        contextSlot: 100,
        lastValidBlockHeight: 1000,
        serialized: serialized(),
        message: Buffer.from(transaction.message.serialize()).toString('base64'),
      },
    } as BridgeStep;
    for (const connection of connections) {
      vi.spyOn(connection, 'getSignaturesForAddress').mockResolvedValue([]);
      vi.spyOn(connection, 'getTransaction').mockResolvedValue(null);
    }
    await expect(rpc.recoverExpiredWalletRequest(step)).rejects.toThrow(/still open/);
    expect(connections[0].getSignaturesForAddress).not.toHaveBeenCalled();
    for (const connection of connections)
      vi.mocked(connection.getEpochInfo).mockResolvedValue({
        absoluteSlot: 1500,
        blockHeight: 1200,
        epoch: 0,
        slotIndex: 1500,
        slotsInEpoch: 432000,
      });
    await expect(rpc.recoverExpiredWalletRequest(step)).resolves.toBeNull();
    const signature = '1'.repeat(64),
      history = [{ signature, slot: 110, err: null, memo: null }];
    vi.mocked(connections[0].getSignaturesForAddress).mockResolvedValue(history);
    await expect(rpc.recoverExpiredWalletRequest(step)).rejects.toThrow(/disagree/);
    vi.mocked(connections[1].getSignaturesForAddress).mockResolvedValue(history);
    await expect(rpc.recoverExpiredWalletRequest(step)).rejects.toThrow(/not available/);
    for (const connection of connections)
      vi.mocked(connection.getTransaction).mockResolvedValue({
        transaction: { message: transaction.message, signatures: [signature] },
      } as never);
    await expect(rpc.recoverExpiredWalletRequest(step)).resolves.toBe(signature);
    await expect(
      rpc.recoverExpiredWalletRequest({ ...step, state: 'SIGNED', transactionId: signature }),
    ).rejects.toThrow(/unsigned wallet request/);
  });
  it.each(['SIGNED', 'SUBMITTED'] as const)(
    'requires expired finalized heights and fresh absence evidence from both sources for %s',
    async (state) => {
      const connections = sources(),
        rpc = new BridgeSolana(connections);
      vi.spyOn(rpc, 'chain').mockResolvedValue(100);
      const step = {
        state,
        transactionId: '1'.repeat(64),
        wallet: wallet.toBase58(),
        solana: { contextSlot: 100, lastValidBlockHeight: 1000 },
      } as BridgeStep;
      for (const c of connections) {
        vi.spyOn(c, 'getSignatureStatuses').mockResolvedValue({
          context: { slot: 1500 },
          value: [null],
        });
        vi.spyOn(c, 'getTransaction').mockResolvedValue(null);
      }
      expect(await rpc.expiredSignedRequest(step)).toBe(false);
      expect(connections[0].getSignatureStatuses).not.toHaveBeenCalled();
      for (const c of connections)
        vi.mocked(c.getEpochInfo).mockResolvedValue({
          absoluteSlot: 1500,
          blockHeight: 1200,
          epoch: 0,
          slotIndex: 1500,
          slotsInEpoch: 432000,
        });
      expect(await rpc.expiredSignedRequest(step)).toBe(true);
      expect(connections[0].getSignatureStatuses).toHaveBeenCalledWith([step.transactionId], {
        searchTransactionHistory: true,
      });
      vi.mocked(connections[1].getSignatureStatuses).mockResolvedValue({
        context: { slot: 1500 },
        value: [{ slot: 1100, confirmations: null, err: null, confirmationStatus: 'finalized' }],
      });
      expect(await rpc.expiredSignedRequest(step)).toBe(false);
      vi.mocked(connections[1].getSignatureStatuses).mockResolvedValue({
        context: { slot: 1499 },
        value: [null],
      });
      expect(await rpc.expiredSignedRequest(step)).toBe(false);
      vi.mocked(connections[1].getSignatureStatuses).mockResolvedValue({
        context: { slot: 1500 },
        value: [null],
      });
      vi.mocked(connections[1].getTransaction).mockResolvedValue({ slot: 1100 } as never);
      expect(await rpc.expiredSignedRequest(step)).toBe(false);
      vi.mocked(connections[1].getTransaction).mockRejectedValue(new Error('RPC unavailable'));
      await expect(rpc.expiredSignedRequest(step)).rejects.toThrow('RPC unavailable');
    },
  );
});
