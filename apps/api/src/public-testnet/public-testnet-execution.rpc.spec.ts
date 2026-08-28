jest.mock('rpc-websockets', () => ({ CommonClient: class {}, WebSocket: jest.fn() }));

import { Keypair } from '@solana/web3.js';
import type { PublicKey } from '@solana/web3.js';

import {
  PUBLIC_TESTNET_COLLATERAL_MINT,
  PUBLIC_TESTNET_GENESIS_HASH,
  PUBLIC_TESTNET_LENDING_MARKET,
  PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY,
  PUBLIC_TESTNET_LENDING_PROGRAM,
  PUBLIC_TESTNET_LENDING_PROGRAM_DATA,
  PUBLIC_TESTNET_LENDING_PROGRAM_DEPLOYMENT_SLOT,
  PUBLIC_TESTNET_LENDING_PROGRAM_UPGRADE_AUTHORITY,
  PUBLIC_TESTNET_RESERVE_COLLATERAL_SUPPLY,
  PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY,
  PUBLIC_TESTNET_RPC_ENDPOINT,
  PUBLIC_TESTNET_TOKEN_PROGRAM,
  PUBLIC_TESTNET_UPGRADEABLE_LOADER,
  PUBLIC_TESTNET_WRAPPED_SOL_MINT,
  derivePublicTestnetAssociatedTokenAddress,
} from './public-testnet-execution.constants';
import type { PublicTestnetExecutionConfig } from './public-testnet-execution.config';
import {
  FixedSolanaDevnetExecutionRpc,
  PublicTestnetEvidenceMismatchError,
  PublicTestnetPreflightRejectedError,
} from './public-testnet-execution.rpc';
import { buildPublicTestnetUnsignedTransaction } from './public-testnet-execution.service';

const CONFIG = Object.freeze({
  mode: 'enabled' as const,
  rpcEndpoint: PUBLIC_TESTNET_RPC_ENDPOINT,
  genesisHash: PUBLIC_TESTNET_GENESIS_HASH,
  requestTimeoutMilliseconds: 7_000 as const,
  responseMaximumBytes: 262_144 as const,
}) satisfies PublicTestnetExecutionConfig;
const BLOCKHASH = '11111111111111111111111111111111';
const SLOT = 100;
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      const value = (digits[index] ?? 0) * 256 + carry;
      digits[index] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = '';
  for (let index = 0; index < bytes.length - 1 && bytes[index] === 0; index += 1) result += '1';
  for (let index = digits.length - 1; index >= 0; index -= 1)
    result += ALPHABET[digits[index] ?? 0];
  return result;
}

function writeKey(data: Buffer, offset: number, key: PublicKey): void {
  key.toBuffer().copy(data, offset);
}

function mintData(supply: bigint): Buffer {
  const data = Buffer.alloc(82);
  data.writeBigUInt64LE(supply, 36);
  data[44] = 9;
  data[45] = 1;
  return data;
}

function tokenData(mint: PublicKey, owner: PublicKey, amount: bigint): Buffer {
  const data = Buffer.alloc(165);
  writeKey(data, 0, mint);
  writeKey(data, 32, owner);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data;
}

function account(owner: PublicKey, data: Buffer, executable = false): Record<string, unknown> {
  return {
    data: [data.toString('base64'), 'base64'],
    executable,
    lamports: 1,
    owner: owner.toBase58(),
    rentEpoch: 0,
  };
}

function programDataHeader(): Buffer {
  const data = Buffer.alloc(45);
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(PUBLIC_TESTNET_LENDING_PROGRAM_DEPLOYMENT_SLOT, 4);
  data[12] = 1;
  writeKey(data, 13, PUBLIC_TESTNET_LENDING_PROGRAM_UPGRADE_AUTHORITY);
  return data;
}

function deploymentAccounts(wallet: PublicKey): readonly (Record<string, unknown> | null)[] {
  const program = Buffer.alloc(36);
  program.writeUInt32LE(2, 0);
  writeKey(program, 4, PUBLIC_TESTNET_LENDING_PROGRAM_DATA);
  const market = Buffer.alloc(290);
  market[0] = 1;
  writeKey(market, 66, PUBLIC_TESTNET_TOKEN_PROGRAM);
  const reserve = Buffer.alloc(619);
  reserve[0] = 1;
  writeKey(reserve, 10, PUBLIC_TESTNET_LENDING_MARKET);
  writeKey(reserve, 42, PUBLIC_TESTNET_WRAPPED_SOL_MINT);
  reserve[74] = 9;
  writeKey(reserve, 75, PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY);
  writeKey(reserve, 227, PUBLIC_TESTNET_COLLATERAL_MINT);
  writeKey(reserve, 267, PUBLIC_TESTNET_RESERVE_COLLATERAL_SUPPLY);
  return [
    account(PUBLIC_TESTNET_UPGRADEABLE_LOADER, program, true),
    account(PUBLIC_TESTNET_LENDING_PROGRAM, market),
    account(PUBLIC_TESTNET_LENDING_PROGRAM, reserve),
    account(PUBLIC_TESTNET_TOKEN_PROGRAM, mintData(1_000_000_000n)),
    account(
      PUBLIC_TESTNET_TOKEN_PROGRAM,
      tokenData(
        PUBLIC_TESTNET_WRAPPED_SOL_MINT,
        PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY,
        19_000_000_000_000n,
      ),
    ),
    account(PUBLIC_TESTNET_TOKEN_PROGRAM, mintData(1_000_000_000n)),
    account(
      PUBLIC_TESTNET_TOKEN_PROGRAM,
      tokenData(
        PUBLIC_TESTNET_COLLATERAL_MINT,
        PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY,
        900_000_000n,
      ),
    ),
    null,
    account(PUBLIC_TESTNET_TOKEN_PROGRAM, tokenData(PUBLIC_TESTNET_COLLATERAL_MINT, wallet, 7n)),
  ];
}

function rpcFetch(
  resolver: (method: string, params: readonly unknown[]) => unknown,
): jest.MockedFunction<typeof fetch> {
  return jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: readonly unknown[];
    };
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: resolver(request.method, request.params),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as jest.MockedFunction<typeof fetch>;
}

function preflightResolver(wallet: PublicKey): (method: string) => unknown {
  return (method) => {
    switch (method) {
      case 'getGenesisHash':
        return PUBLIC_TESTNET_GENESIS_HASH;
      case 'getLatestBlockhash':
        return {
          context: { slot: SLOT },
          value: { blockhash: BLOCKHASH, lastValidBlockHeight: 250 },
        };
      case 'getMultipleAccounts':
        return { context: { slot: SLOT }, value: deploymentAccounts(wallet) };
      case 'getAccountInfo':
        return {
          context: { slot: SLOT },
          value: account(PUBLIC_TESTNET_UPGRADEABLE_LOADER, programDataHeader()),
        };
      case 'getBalance':
        return { context: { slot: SLOT }, value: 20_000_000 };
      case 'getBlockTime':
        return 1_787_832_000;
      default:
        throw new Error(`Unexpected method: ${method}`);
    }
  };
}

describe('FixedSolanaDevnetExecutionRpc', () => {
  it('pins the full genesis and validates the fixed reserve deployment at finalized commitment', async () => {
    const wallet = Keypair.generate().publicKey;
    const fetchMock = rpcFetch(preflightResolver(wallet));
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);
    await expect(rpc.preflight(wallet)).resolves.toEqual({
      slot: 100n,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: 250n,
      observedAt: new Date(1_787_832_000_000).toISOString(),
      reserveLiquidityAtomic: 19_000_000_000_000n,
      nativeBalanceLamports: 20_000_000n,
      collateralBalanceBeforeAtomic: 7n,
      sourceLiquidityAccount: derivePublicTestnetAssociatedTokenAddress(
        wallet,
        PUBLIC_TESTNET_WRAPPED_SOL_MINT,
      ),
      destinationCollateralAccount: derivePublicTestnetAssociatedTokenAddress(
        wallet,
        PUBLIC_TESTNET_COLLATERAL_MINT,
      ),
    });
    const slicedRequest = fetchMock.mock.calls
      .map((call) => JSON.parse(String(call[1]?.body)) as { method: string; params: unknown[] })
      .find((call) => call.method === 'getAccountInfo');
    expect(slicedRequest?.params).toEqual([
      PUBLIC_TESTNET_LENDING_PROGRAM_DATA.toBase58(),
      {
        commitment: 'finalized',
        encoding: 'base64',
        dataSlice: { offset: 0, length: 45 },
        minContextSlot: SLOT,
      },
    ]);
  });

  it('fails closed if the RPC is not the fixed Devnet genesis', async () => {
    const wallet = Keypair.generate().publicKey;
    const fetchMock = rpcFetch((method) =>
      method === 'getGenesisHash'
        ? '11111111111111111111111111111111'
        : { context: { slot: SLOT }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 250 } },
    );
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);
    await expect(rpc.preflight(wallet)).rejects.toBeInstanceOf(PublicTestnetPreflightRejectedError);
  });

  it('verifies only the exact finalized signed message and its SOL/cSOL token deltas', async () => {
    const wallet = Keypair.generate();
    const source = derivePublicTestnetAssociatedTokenAddress(
      wallet.publicKey,
      PUBLIC_TESTNET_WRAPPED_SOL_MINT,
    );
    const destination = derivePublicTestnetAssociatedTokenAddress(
      wallet.publicKey,
      PUBLIC_TESTNET_COLLATERAL_MINT,
    );
    const transaction = buildPublicTestnetUnsignedTransaction(
      wallet.publicKey,
      source,
      destination,
      BLOCKHASH,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    );
    transaction.sign(wallet);
    const signatureBytes = transaction.signature;
    expect(signatureBytes).not.toBeNull();
    const signature = encodeBase58(signatureBytes!);
    const keys = transaction.compileMessage().accountKeys;
    const destinationIndex = keys.findIndex((key) => key.equals(destination));
    const vaultIndex = keys.findIndex((key) => key.equals(PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY));
    const resolver = (method: string): unknown => {
      if (method === 'getSignatureStatuses') {
        return {
          context: { slot: 101 },
          value: [{ slot: 101, confirmations: null, err: null, confirmationStatus: 'finalized' }],
        };
      }
      if (method === 'getTransaction') {
        return {
          slot: 101,
          blockTime: 1_787_832_001,
          transaction: [transaction.serialize().toString('base64'), 'base64'],
          meta: {
            err: null,
            logMessages: [
              `Program ${PUBLIC_TESTNET_LENDING_PROGRAM.toBase58()} invoke [1]`,
              'Program log: Instruction: Deposit Reserve Liquidity',
              `Program ${PUBLIC_TESTNET_LENDING_PROGRAM.toBase58()} success`,
            ],
            preTokenBalances: [
              {
                accountIndex: destinationIndex,
                mint: PUBLIC_TESTNET_COLLATERAL_MINT.toBase58(),
                owner: wallet.publicKey.toBase58(),
                uiTokenAmount: { amount: '7', decimals: 9 },
              },
              {
                accountIndex: vaultIndex,
                mint: PUBLIC_TESTNET_WRAPPED_SOL_MINT.toBase58(),
                owner: PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY.toBase58(),
                uiTokenAmount: { amount: '19000000000000', decimals: 9 },
              },
            ],
            postTokenBalances: [
              {
                accountIndex: destinationIndex,
                mint: PUBLIC_TESTNET_COLLATERAL_MINT.toBase58(),
                owner: wallet.publicKey.toBase58(),
                uiTokenAmount: { amount: '9000007', decimals: 9 },
              },
              {
                accountIndex: vaultIndex,
                mint: PUBLIC_TESTNET_WRAPPED_SOL_MINT.toBase58(),
                owner: PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY.toBase58(),
                uiTokenAmount: { amount: '19000010000000', decimals: 9 },
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    };
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, rpcFetch(resolver));
    await expect(
      rpc.verifyFinalizedDeposit(signature, {
        wallet: wallet.publicKey,
        sourceLiquidityAccount: source,
        destinationCollateralAccount: destination,
        expectedMessageBase64: transaction.serializeMessage().toString('base64'),
        preflightSlot: 100n,
      }),
    ).resolves.toEqual({
      status: 'VERIFIED',
      slot: 101n,
      collateralBalanceBeforeAtomic: 7n,
      collateralBalanceAfterAtomic: 9_000_007n,
      increaseAtomic: 9_000_000n,
    });

    await expect(
      rpc.verifyFinalizedDeposit(signature, {
        wallet: wallet.publicKey,
        sourceLiquidityAccount: source,
        destinationCollateralAccount: destination,
        expectedMessageBase64: Buffer.from('wrong').toString('base64'),
        preflightSlot: 100n,
      }),
    ).rejects.toBeInstanceOf(PublicTestnetEvidenceMismatchError);
  });

  it('keeps a known but not-finalized signature pending without reading a transaction', async () => {
    const wallet = Keypair.generate().publicKey;
    const fetchMock = rpcFetch((method) => {
      if (method !== 'getSignatureStatuses') throw new Error('Unexpected transaction read');
      return {
        context: { slot: 101 },
        value: [{ slot: 101, confirmations: 1, err: null, confirmationStatus: 'confirmed' }],
      };
    });
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);
    await expect(
      rpc.verifyFinalizedDeposit('1'.repeat(64), {
        wallet,
        sourceLiquidityAccount: wallet,
        destinationCollateralAccount: wallet,
        expectedMessageBase64: 'x',
        preflightSlot: 100n,
      }),
    ).resolves.toEqual({ status: 'PENDING' });
  });
});
