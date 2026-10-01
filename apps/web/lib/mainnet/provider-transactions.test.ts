// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { type Connection, type VersionedTransaction } from '@solana/web3.js';
import { BridgeEthereum } from './bridge-ethereum.server';
import { MainnetTestRpc } from './rpc.server';
import { marketCall } from '../lending/evm-markets';
import { BridgeSolana } from './bridge-solana.server';
import { SolanaLendingMarkets, type SolanaMarketState } from './solana-markets.server';

it('prepares other Ethereum lenders independently of Aave while checking gas, account code and pending nonce', async () => {
  const wallet = '0x1111111111111111111111111111111111111111';
  const rpc = new MainnetTestRpc();
  const aave = vi.spyOn(rpc, 'inspect').mockRejectedValue(new Error('Aave unavailable'));
  vi.spyOn(rpc, 'anchor').mockResolvedValue({
    number: '0x1',
    hash: `0x${'11'.repeat(32)}`,
    baseFee: 1_000_000_000n,
  });
  vi.spyOn(rpc, 'recheck').mockResolvedValue(undefined);
  vi.spyOn(rpc, 'batch').mockResolvedValue(['0x186a0', '0x5f5e100']);
  let code = '0x',
    nonce = '0x1',
    balance = '0xde0b6b3a7640000';
  const pair = vi
    .spyOn(rpc, 'pair')
    .mockImplementation(async (calls) =>
      calls[0]?.[0] === 'eth_getBalance' ? [balance, code, '0x1', nonce] : ['0x'],
    );
  const transport = new BridgeEthereum(rpc);
  const call = { from: wallet, ...marketCall('euler', wallet, 'supply', 1_000_000n, 0n) } as const;
  expect((await transport.prepare(call, 'LENDING_SUPPLY')).transaction).toMatchObject({
    ...call,
    nonce: '0x1',
    chainId: '0x1',
  });
  expect(aave).not.toHaveBeenCalled();
  expect(pair.mock.calls.some(([calls]) => calls[0]?.[0] === 'eth_call')).toBe(true);
  nonce = '0x2';
  await expect(transport.prepare(call, 'LENDING_SUPPLY')).rejects.toThrow(/pending transaction/);
  nonce = '0x1';
  code = '0xef0100';
  await expect(transport.prepare(call, 'LENDING_SUPPLY')).rejects.toThrow(/delegated account code/);
  code = '0x';
  balance = '0x0';
  await expect(transport.prepare(call, 'LENDING_SUPPLY')).rejects.toThrow(/needs gas/);
});

it.each([
  [{ blockHeight: 990, absoluteSlot: 1200 }, /expiring/],
  [{ blockHeight: 980, absoluteSlot: 99 }, /stale/],
  [{ blockHeight: undefined, absoluteSlot: 1200 }, /unavailable/],
])(
  'rejects additional Solana lender simulations with expired or unbound block heights',
  async (epoch, message) => {
    const connection = {
      getEpochInfo: vi.fn().mockResolvedValue(epoch),
      simulateTransaction: vi.fn(),
    };
    const service = new SolanaLendingMarkets(
      new BridgeSolana([connection, connection] as unknown as [Connection, Connection]),
    );
    await expect(
      service.simulate(
        { slot: 100 } as SolanaMarketState,
        '11111111111111111111111111111111',
        {
          transaction: {} as VersionedTransaction,
          serialized: '',
          lifetime: { blockhash: '', contextSlot: 100, lastValidBlockHeight: 1000 },
        },
        'supply',
        1000n,
      ),
    ).rejects.toThrow(message);
    expect(connection.simulateTransaction).not.toHaveBeenCalled();
    expect(connection.getEpochInfo).toHaveBeenCalledWith({
      commitment: 'confirmed',
      minContextSlot: 100,
    });
  },
);
