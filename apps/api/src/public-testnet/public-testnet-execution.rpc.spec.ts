jest.mock('rpc-websockets', () => ({ CommonClient: class {}, WebSocket: jest.fn() }));

import {
  ComputeBudgetProgram,
  Keypair,
  TransactionInstruction,
  type PublicKey,
  type Transaction,
} from '@solana/web3.js';

import {
  PUBLIC_TESTNET_COLLATERAL_MINT,
  PUBLIC_TESTNET_GENESIS_HASH,
  PUBLIC_TESTNET_LENDING_MARKET,
  PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY,
  PUBLIC_TESTNET_LENDING_PROGRAM,
  PUBLIC_TESTNET_LENDING_PROGRAM_DATA,
  PUBLIC_TESTNET_LENDING_PROGRAM_DEPLOYMENT_SLOT,
  PUBLIC_TESTNET_LENDING_PROGRAM_UPGRADE_AUTHORITY,
  PUBLIC_TESTNET_MAX_TRANSACTION_BYTES,
  PUBLIC_TESTNET_MINIMUM_BROADCAST_REMAINING_BLOCK_HEIGHTS,
  PUBLIC_TESTNET_RESERVE_COLLATERAL_SUPPLY,
  PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY,
  PUBLIC_TESTNET_RPC_ENDPOINT,
  PUBLIC_TESTNET_TOKEN_PROGRAM,
  PUBLIC_TESTNET_UPGRADEABLE_LOADER,
  PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT,
  PUBLIC_TESTNET_WALLET_MAX_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  PUBLIC_TESTNET_WRAPPED_SOL_MINT,
  derivePublicTestnetAssociatedTokenAddress,
} from './public-testnet-execution.constants';
import type { PublicTestnetExecutionConfig } from './public-testnet-execution.config';
import {
  FixedSolanaDevnetExecutionRpc,
  PublicTestnetBroadcastAmbiguousError,
  PublicTestnetBroadcastRejectedError,
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
const WAD = 1_000_000_000_000_000_000n;
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

function writeU128(data: Buffer, offset: number, value: bigint): void {
  data.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  data.writeBigUInt64LE(value >> 64n, offset + 8);
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

function deploymentAccounts(
  wallet: PublicKey,
  mutateReserve?: (reserve: Buffer) => void,
): readonly (Record<string, unknown> | null)[] {
  const program = Buffer.alloc(36);
  program.writeUInt32LE(2, 0);
  writeKey(program, 4, PUBLIC_TESTNET_LENDING_PROGRAM_DATA);
  const market = Buffer.alloc(290);
  market[0] = 1;
  writeKey(market, 66, PUBLIC_TESTNET_TOKEN_PROGRAM);
  const reserve = Buffer.alloc(619);
  reserve[0] = 1;
  reserve.writeBigUInt64LE(95n, 1);
  writeKey(reserve, 10, PUBLIC_TESTNET_LENDING_MARKET);
  writeKey(reserve, 42, PUBLIC_TESTNET_WRAPPED_SOL_MINT);
  reserve[74] = 9;
  writeKey(reserve, 75, PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY);
  reserve.writeBigUInt64LE(19_000_000_000_000n, 171);
  writeU128(reserve, 179, 1_000_000_000_000n * WAD);
  writeKey(reserve, 227, PUBLIC_TESTNET_COLLATERAL_MINT);
  reserve.writeBigUInt64LE(1_000_000_000n, 259);
  writeKey(reserve, 267, PUBLIC_TESTNET_RESERVE_COLLATERAL_SUPPLY);
  reserve[299] = 80;
  reserve[303] = 0;
  reserve[304] = 12;
  reserve[305] = 150;
  reserve[372] = 20;
  reserve[470] = 90;
  reserve.writeBigUInt64LE(500n, 471);
  mutateReserve?.(reserve);
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

function preflightResolver(
  wallet: PublicKey,
  mutateReserve?: (reserve: Buffer) => void,
): (method: string) => unknown {
  return (method) => {
    switch (method) {
      case 'getGenesisHash':
        return PUBLIC_TESTNET_GENESIS_HASH;
      case 'getSlot':
        return SLOT;
      case 'getLatestBlockhash':
        return {
          context: { slot: SLOT },
          value: { blockhash: BLOCKHASH, lastValidBlockHeight: 250 },
        };
      case 'getMultipleAccounts':
        return { context: { slot: SLOT }, value: deploymentAccounts(wallet, mutateReserve) };
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

interface FinalizedDepositFixture {
  readonly expectation: {
    readonly wallet: PublicKey;
    readonly sourceLiquidityAccount: PublicKey;
    readonly destinationCollateralAccount: PublicKey;
    readonly expectedMessageBase64: string;
    readonly preflightSlot: bigint;
    readonly lastValidBlockHeight: bigint;
  };
  readonly rpc: FixedSolanaDevnetExecutionRpc;
  readonly signature: string;
  readonly transaction: Transaction;
  readonly transactionResult: () => Readonly<Record<string, unknown>>;
}

function finalizedDepositFixture(
  mutate?: (transaction: Transaction, wallet: PublicKey) => void,
): FinalizedDepositFixture {
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
  const expectedMessageBase64 = transaction.serializeMessage().toString('base64');
  mutate?.(transaction, wallet.publicKey);
  transaction.sign(wallet);
  const signatureBytes = transaction.signature;
  if (signatureBytes === null) throw new Error('Test signature is missing');
  const signature = encodeBase58(signatureBytes);
  const keys = transaction.compileMessage().accountKeys;
  const destinationIndex = keys.findIndex((key) => key.equals(destination));
  const vaultIndex = keys.findIndex((key) => key.equals(PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY));
  if (destinationIndex < 0 || vaultIndex < 0) throw new Error('Test account index is missing');
  const transactionResult = (): Readonly<Record<string, unknown>> =>
    Object.freeze({
      slot: 101,
      blockTime: 1_787_832_001,
      transaction: [
        transaction
          .serialize({ requireAllSignatures: true, verifySignatures: false })
          .toString('base64'),
        'base64',
      ],
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
    });
  const resolver = (method: string): unknown => {
    if (method === 'getSignatureStatuses') {
      return {
        context: { slot: 101 },
        value: [{ slot: 101, confirmations: null, err: null, confirmationStatus: 'finalized' }],
      };
    }
    if (method === 'getTransaction') {
      return transactionResult();
    }
    throw new Error(`Unexpected method: ${method}`);
  };
  return {
    expectation: {
      wallet: wallet.publicKey,
      sourceLiquidityAccount: source,
      destinationCollateralAccount: destination,
      expectedMessageBase64,
      preflightSlot: 100n,
      lastValidBlockHeight: 250n,
    },
    rpc: new FixedSolanaDevnetExecutionRpc(CONFIG, rpcFetch(resolver)),
    signature,
    transaction,
    transactionResult,
  };
}

function prependObservedWalletComputeBudget(transaction: Transaction): void {
  transaction.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 375_000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT }),
  );
}

describe('FixedSolanaDevnetExecutionRpc', () => {
  it('pins finalized state before fetching a fresh confirmed transaction blockhash', async () => {
    const wallet = Keypair.generate().publicKey;
    const freshBlockhash = Keypair.generate().publicKey.toBase58();
    const baseResolver = preflightResolver(wallet);
    const fetchMock = rpcFetch((method) =>
      method === 'getLatestBlockhash'
        ? {
            context: { slot: SLOT + 8 },
            value: { blockhash: freshBlockhash, lastValidBlockHeight: 300 },
          }
        : baseResolver(method),
    );
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);
    await expect(rpc.preflight(wallet)).resolves.toEqual({
      slot: 100n,
      blockhash: freshBlockhash,
      lastValidBlockHeight: 300n,
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
    const requests = fetchMock.mock.calls.map(
      (call) => JSON.parse(String(call[1]?.body)) as { method: string; params: unknown[] },
    );
    const slicedRequest = requests.find((call) => call.method === 'getAccountInfo');
    expect(slicedRequest?.params).toEqual([
      PUBLIC_TESTNET_LENDING_PROGRAM_DATA.toBase58(),
      {
        commitment: 'finalized',
        encoding: 'base64',
        dataSlice: { offset: 0, length: 45 },
        minContextSlot: SLOT,
      },
    ]);
    expect(requests.find((call) => call.method === 'getSlot')?.params).toEqual([
      { commitment: 'finalized' },
    ]);
    expect(requests.find((call) => call.method === 'getLatestBlockhash')?.params).toEqual([
      { commitment: 'confirmed', minContextSlot: SLOT },
    ]);
    expect(requests.findIndex((call) => call.method === 'getLatestBlockhash')).toBeGreaterThan(
      requests.findIndex((call) => call.method === 'getBalance'),
    );
  });

  it('reads the derived cSOL position and computes the current finalized reserve APY', async () => {
    const wallet = Keypair.generate().publicKey;
    const fetchMock = rpcFetch(preflightResolver(wallet));
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

    const result = await rpc.readPosition(wallet);

    expect(result).toEqual({
      slot: 100n,
      observedAt: new Date(1_787_832_000_000).toISOString(),
      collateralBalanceAtomic: 7n,
      suppliedLiquidityAtomic: 140_000n,
      supplyApyBasisPoints: 3,
      utilizationBasisPoints: 500,
      reserveLastUpdatedSlot: 95n,
      reserveMarkedStale: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    const accountRead = fetchMock.mock.calls
      .map((call) => JSON.parse(String(call[1]?.body)) as { method: string; params: unknown[] })
      .find((call) => call.method === 'getMultipleAccounts');
    expect((accountRead?.params[0] as string[]).at(-1)).toBe(
      derivePublicTestnetAssociatedTokenAddress(wallet, PUBLIC_TESTNET_COLLATERAL_MINT).toBase58(),
    );
  });

  it('tolerates an unrelated token donation above reserve-accounted liquidity', async () => {
    const wallet = Keypair.generate().publicKey;
    const rpc = new FixedSolanaDevnetExecutionRpc(
      CONFIG,
      rpcFetch(
        preflightResolver(wallet, (reserve) => {
          reserve.writeBigUInt64LE(18_000_000_000_000n, 171);
        }),
      ),
    );

    await expect(rpc.readPosition(wallet)).resolves.toMatchObject({ slot: 100n });
  });

  it('fails the position read closed when the token vault is below reserve-accounted liquidity', async () => {
    const wallet = Keypair.generate().publicKey;
    const rpc = new FixedSolanaDevnetExecutionRpc(
      CONFIG,
      rpcFetch(
        preflightResolver(wallet, (reserve) => {
          reserve.writeBigUInt64LE(20_000_000_000_000n, 171);
        }),
      ),
    );

    await expect(rpc.readPosition(wallet)).rejects.toMatchObject({
      code: 'RESERVE_UNAVAILABLE',
    });
  });

  it('uses reserve-accounted collateral supply after a holder burns receipt tokens', async () => {
    const wallet = Keypair.generate().publicKey;
    const rpc = new FixedSolanaDevnetExecutionRpc(
      CONFIG,
      rpcFetch(
        preflightResolver(wallet, (reserve) => {
          reserve.writeBigUInt64LE(1_100_000_000n, 259);
        }),
      ),
    );

    await expect(rpc.readPosition(wallet)).resolves.toMatchObject({
      collateralBalanceAtomic: 7n,
      suppliedLiquidityAtomic: 127_272n,
    });
  });

  it('rejects collateral mint supply above reserve-accounted issuance', async () => {
    const wallet = Keypair.generate().publicKey;
    const rpc = new FixedSolanaDevnetExecutionRpc(
      CONFIG,
      rpcFetch(
        preflightResolver(wallet, (reserve) => {
          reserve.writeBigUInt64LE(900_000_000n, 259);
        }),
      ),
    );

    await expect(rpc.readPosition(wallet)).rejects.toMatchObject({
      code: 'RESERVE_UNAVAILABLE',
    });
  });

  it('reads an existing position without write-specific liquidity, blockhash, or funding checks', async () => {
    const wallet = Keypair.generate().publicKey;
    const baseResolver = preflightResolver(wallet, (reserve) => {
      reserve.writeBigUInt64LE(1n, 171);
    });
    const fetchMock = rpcFetch((method) => {
      if (method === 'getSlot' || method === 'getLatestBlockhash' || method === 'getBalance') {
        throw new Error(`Unexpected write-preflight method: ${method}`);
      }
      return baseResolver(method);
    });
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

    await expect(rpc.readPosition(wallet)).resolves.toMatchObject({
      slot: 100n,
      collateralBalanceAtomic: 7n,
    });
    const methods = fetchMock.mock.calls.map(
      (call) => (JSON.parse(String(call[1]?.body)) as { method: string }).method,
    );
    expect(methods).not.toContain('getLatestBlockhash');
    expect(methods).not.toContain('getSlot');
    expect(methods).not.toContain('getBalance');
  });

  it('keeps the minimum reserve liquidity requirement on new proof preflight', async () => {
    const wallet = Keypair.generate().publicKey;
    const rpc = new FixedSolanaDevnetExecutionRpc(
      CONFIG,
      rpcFetch(
        preflightResolver(wallet, (reserve) => {
          reserve.writeBigUInt64LE(1n, 171);
        }),
      ),
    );

    await expect(rpc.preflight(wallet)).rejects.toMatchObject({
      code: 'RESERVE_UNAVAILABLE',
    });
  });

  it('attributes a position to the finalized account context slot and its block time', async () => {
    const wallet = Keypair.generate().publicKey;
    const accountSlot = SLOT + 5;
    const baseResolver = preflightResolver(wallet);
    const fetchMock = rpcFetch((method, params) => {
      if (method === 'getMultipleAccounts') {
        return {
          context: { slot: accountSlot },
          value: deploymentAccounts(wallet, (reserve) => reserve.writeBigUInt64LE(103n, 1)),
        };
      }
      if (method === 'getBlockTime') {
        return params[0] === accountSlot ? 1_787_832_005 : 1_787_832_000;
      }
      return baseResolver(method);
    });
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

    await expect(rpc.readPosition(wallet)).resolves.toMatchObject({
      slot: 105n,
      observedAt: new Date(1_787_832_005_000).toISOString(),
      reserveLastUpdatedSlot: 103n,
    });
    const blockTimeSlots = fetchMock.mock.calls
      .map((call) => JSON.parse(String(call[1]?.body)) as { method: string; params: unknown[] })
      .filter((call) => call.method === 'getBlockTime')
      .map((call) => call.params[0]);
    expect(blockTimeSlots).toEqual([accountSlot]);
  });

  it.each([
    [171_000_000_000_000n, 1_330_000n, 19_446, 9_000],
    [361_000_000_000_000n, 2_660_000n, 108_224, 9_500],
  ] as const)(
    'uses the extended utilization curve for %s borrowed atomic units',
    async (
      borrowedLiquidityAtomic,
      suppliedLiquidityAtomic,
      supplyApyBasisPoints,
      utilizationBasisPoints,
    ) => {
      const wallet = Keypair.generate().publicKey;
      const rpc = new FixedSolanaDevnetExecutionRpc(
        CONFIG,
        rpcFetch(
          preflightResolver(wallet, (reserve) => {
            writeU128(reserve, 179, borrowedLiquidityAtomic * WAD);
          }),
        ),
      );

      await expect(rpc.readPosition(wallet)).resolves.toMatchObject({
        suppliedLiquidityAtomic,
        supplyApyBasisPoints,
        utilizationBasisPoints,
      });
    },
  );

  it.each([
    [
      'a reserve update from after the finalized observation',
      (reserve: Buffer) => reserve.writeBigUInt64LE(101n, 1),
    ],
    [
      'zero net liquidity after accrued protocol fees',
      (reserve: Buffer) => writeU128(reserve, 373, 20_000_000_000_000n * WAD),
    ],
  ] as const)('fails closed on %s', async (_label, mutateReserve) => {
    const wallet = Keypair.generate().publicKey;
    const rpc = new FixedSolanaDevnetExecutionRpc(
      CONFIG,
      rpcFetch(preflightResolver(wallet, mutateReserve)),
    );

    await expect(rpc.readPosition(wallet)).rejects.toMatchObject({
      code: 'RESERVE_UNAVAILABLE',
    });
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

  it('broadcasts at the exact remaining-block-height safety boundary', async () => {
    const fixture = finalizedDepositFixture((transaction) => {
      prependObservedWalletComputeBudget(transaction);
    });
    const signedTransactionBase64 = fixture.transaction.serialize().toString('base64');
    const currentBlockHeight =
      fixture.expectation.lastValidBlockHeight -
      PUBLIC_TESTNET_MINIMUM_BROADCAST_REMAINING_BLOCK_HEIGHTS;
    const fetchMock = rpcFetch((method) => {
      if (method === 'getBlockHeight') return Number(currentBlockHeight);
      if (method === 'sendTransaction') return fixture.signature;
      throw new Error(`Unexpected method: ${method}`);
    });
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

    await expect(
      rpc.broadcastSignedTransaction(
        { signature: fixture.signature, signedTransactionBase64 },
        fixture.expectation,
      ),
    ).resolves.toBe(fixture.signature);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(PUBLIC_TESTNET_RPC_ENDPOINT);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const heightRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      method: string;
      params: readonly unknown[];
    };
    expect(heightRequest).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBlockHeight',
      params: [{ commitment: 'processed', minContextSlot: 100 }],
    });
    const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      method: string;
      params: readonly unknown[];
    };
    expect(request).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'sendTransaction',
      params: [
        signedTransactionBase64,
        {
          encoding: 'base64',
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          minContextSlot: 100,
        },
      ],
    });
    expect(request.params[1]).not.toHaveProperty('maxRetries');
  });

  it('rejects one block height inside the safety boundary without sending', async () => {
    const fixture = finalizedDepositFixture();
    const signedTransactionBase64 = fixture.transaction.serialize().toString('base64');
    const currentBlockHeight =
      fixture.expectation.lastValidBlockHeight -
      PUBLIC_TESTNET_MINIMUM_BROADCAST_REMAINING_BLOCK_HEIGHTS +
      1n;
    const fetchMock = rpcFetch((method) => {
      if (method === 'getBlockHeight') return Number(currentBlockHeight);
      throw new Error(`Unexpected method: ${method}`);
    });
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

    await expect(
      rpc.broadcastSignedTransaction(
        { signature: fixture.signature, signedTransactionBase64 },
        fixture.expectation,
      ),
    ).rejects.toBeInstanceOf(PublicTestnetBroadcastRejectedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      method: string;
      params: readonly unknown[];
    };
    expect(request).toMatchObject({
      method: 'getBlockHeight',
      params: [{ commitment: 'processed', minContextSlot: 100 }],
    });
  });

  it('rejects an expired blockhash without making any sendTransaction request', async () => {
    const fixture = finalizedDepositFixture();
    const signedTransactionBase64 = fixture.transaction.serialize().toString('base64');
    const fetchMock = rpcFetch((method) => {
      if (method === 'getBlockHeight') return 251;
      throw new Error(`Unexpected method: ${method}`);
    });
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

    await expect(
      rpc.broadcastSignedTransaction(
        { signature: fixture.signature, signedTransactionBase64 },
        fixture.expectation,
      ),
    ).rejects.toBeInstanceOf(PublicTestnetBroadcastRejectedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      method: string;
      params: readonly unknown[];
    };
    expect(request).toMatchObject({
      method: 'getBlockHeight',
      params: [{ commitment: 'processed', minContextSlot: 100 }],
    });
  });

  it('rejects malformed, oversized, or mismatched signed bytes before network access', async () => {
    const fixture = finalizedDepositFixture();
    const signedTransactionBase64 = fixture.transaction.serialize().toString('base64');
    const cases = [
      {
        signature: fixture.signature,
        signedTransactionBase64: Buffer.alloc(PUBLIC_TESTNET_MAX_TRANSACTION_BYTES + 1).toString(
          'base64',
        ),
      },
      {
        signature: fixture.signature,
        signedTransactionBase64: Buffer.from([0]).toString('base64'),
      },
      { signature: '1'.repeat(64), signedTransactionBase64 },
    ] as const;

    for (const submission of cases) {
      const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
      const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);
      await expect(
        rpc.broadcastSignedTransaction(submission, fixture.expectation),
      ).rejects.toBeInstanceOf(PublicTestnetEvidenceMismatchError);
      expect(fetchMock).not.toHaveBeenCalled();
    }

    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);
    await expect(
      rpc.broadcastSignedTransaction(
        { signature: fixture.signature, signedTransactionBase64 },
        { ...fixture.expectation, expectedMessageBase64: Buffer.from('wrong').toString('base64') },
      ),
    ).rejects.toBeInstanceOf(PublicTestnetEvidenceMismatchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies an explicit JSON-RPC send error as rejected without retrying', async () => {
    const fixture = finalizedDepositFixture();
    const signedTransactionBase64 = fixture.transaction.serialize().toString('base64');
    const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string };
      if (request.method === 'getBlockHeight') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 218 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32_002, message: 'Transaction simulation failed', data: {} },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as jest.MockedFunction<typeof fetch>;
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

    await expect(
      rpc.broadcastSignedTransaction(
        { signature: fixture.signature, signedTransactionBase64 },
        fixture.expectation,
      ),
    ).rejects.toBeInstanceOf(PublicTestnetBroadcastRejectedError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['transport failure', 'mismatched RPC signature'] as const)(
    'classifies %s as ambiguous and never retries',
    async (scenario) => {
      const fixture = finalizedDepositFixture();
      const signedTransactionBase64 = fixture.transaction.serialize().toString('base64');
      const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { id: number; method: string };
        if (request.method === 'getBlockHeight') {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 218 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (scenario === 'transport failure') throw new Error('socket closed after write');
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: request.id, result: '1'.repeat(64) }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as jest.MockedFunction<typeof fetch>;
      const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

      await expect(
        rpc.broadcastSignedTransaction(
          { signature: fixture.signature, signedTransactionBase64 },
          fixture.expectation,
        ),
      ).rejects.toBeInstanceOf(PublicTestnetBroadcastAmbiguousError);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('verifies the exact finalized signed message and its SOL/cSOL token deltas', async () => {
    const fixture = finalizedDepositFixture();
    await expect(
      fixture.rpc.verifyFinalizedDeposit(fixture.signature, fixture.expectation),
    ).resolves.toEqual({
      status: 'VERIFIED',
      slot: 101n,
      collateralBalanceBeforeAtomic: 7n,
      collateralBalanceAfterAtomic: 9_000_007n,
      increaseAtomic: 9_000_000n,
    });

    await expect(
      fixture.rpc.verifyFinalizedDeposit(fixture.signature, {
        ...fixture.expectation,
        expectedMessageBase64: Buffer.from('wrong').toString('base64'),
      }),
    ).rejects.toBeInstanceOf(PublicTestnetEvidenceMismatchError);
  });

  it('accepts the observed bounded Phantom compute-budget prefix without relaxing the core', async () => {
    const fixture = finalizedDepositFixture((transaction) => {
      prependObservedWalletComputeBudget(transaction);
    });
    expect(fixture.transaction.instructions).toHaveLength(8);
    expect(
      fixture.transaction.instructions
        .slice(0, 2)
        .map((instruction) => instruction.data.toString('hex')),
    ).toEqual(['03d8b8050000000000', '02400d0300']);
    await expect(
      fixture.rpc.verifyFinalizedDeposit(fixture.signature, fixture.expectation),
    ).resolves.toMatchObject({ status: 'VERIFIED' });
  });

  it('accepts the documented wallet compute-unit-price boundary', async () => {
    const fixture = finalizedDepositFixture((transaction) => {
      transaction.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: PUBLIC_TESTNET_WALLET_MAX_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
        }),
        ComputeBudgetProgram.setComputeUnitLimit({
          units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT,
        }),
      );
    });
    await expect(
      fixture.rpc.verifyFinalizedDeposit(fixture.signature, fixture.expectation),
    ).resolves.toMatchObject({ status: 'VERIFIED' });
  });

  it.each<readonly [string, (transaction: Transaction, wallet: PublicKey) => void]>([
    [
      'reversed compute-budget order',
      (transaction) => {
        transaction.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT,
          }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 375_000 }),
        );
      },
    ],
    [
      'a partial compute-budget prefix',
      (transaction) => {
        transaction.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 375_000 }),
        );
      },
    ],
    [
      'an extra compute-budget instruction',
      (transaction) => {
        transaction.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 375_000 }),
          ComputeBudgetProgram.setComputeUnitLimit({
            units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT,
          }),
          ComputeBudgetProgram.setComputeUnitLimit({
            units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT,
          }),
        );
      },
    ],
    [
      'an unsupported compute-budget tag',
      (transaction) => {
        transaction.instructions.unshift(
          ComputeBudgetProgram.requestHeapFrame({ bytes: 32_768 }),
          ComputeBudgetProgram.setComputeUnitLimit({
            units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT,
          }),
        );
      },
    ],
    [
      'compute-budget account metas',
      (transaction, wallet) => {
        const price = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 375_000 });
        transaction.instructions.unshift(
          new TransactionInstruction({
            programId: price.programId,
            keys: [{ pubkey: wallet, isSigner: false, isWritable: false }],
            data: price.data,
          }),
          ComputeBudgetProgram.setComputeUnitLimit({
            units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT,
          }),
        );
      },
    ],
    [
      'a compute-unit limit above policy',
      (transaction) => {
        transaction.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 375_000 }),
          ComputeBudgetProgram.setComputeUnitLimit({
            units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT + 1,
          }),
        );
      },
    ],
    [
      'a compute-unit price above policy',
      (transaction) => {
        transaction.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: PUBLIC_TESTNET_WALLET_MAX_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS + 1n,
          }),
          ComputeBudgetProgram.setComputeUnitLimit({
            units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT,
          }),
        );
      },
    ],
    [
      'a compute-budget pair after a reviewed instruction',
      (transaction) => {
        transaction.instructions.splice(
          1,
          0,
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 375_000 }),
          ComputeBudgetProgram.setComputeUnitLimit({
            units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT,
          }),
        );
      },
    ],
    [
      'a mutation to the reviewed memo',
      (transaction) => {
        prependObservedWalletComputeBudget(transaction);
        transaction.instructions[2]!.data = Buffer.from('mutated memo', 'utf8');
      },
    ],
    [
      'an arbitrary program prefix',
      (transaction, wallet) => {
        transaction.instructions.unshift(
          new TransactionInstruction({ programId: wallet, keys: [], data: Buffer.alloc(0) }),
        );
      },
    ],
  ])('rejects %s', async (_label, mutate) => {
    const fixture = finalizedDepositFixture(mutate);
    await expect(
      fixture.rpc.verifyFinalizedDeposit(fixture.signature, fixture.expectation),
    ).rejects.toBeInstanceOf(PublicTestnetEvidenceMismatchError);
  });

  it('verifies the signature over the actual prefixed message', async () => {
    const fixture = finalizedDepositFixture((transaction) => {
      prependObservedWalletComputeBudget(transaction);
    });
    fixture.transaction.instructions[0]!.data.writeBigUInt64LE(374_999n, 1);
    await expect(
      fixture.rpc.verifyFinalizedDeposit(fixture.signature, fixture.expectation),
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
        lastValidBlockHeight: 250n,
      }),
    ).resolves.toEqual({ status: 'PENDING' });
  });

  it('keeps missing evidence pending and never infers non-landing from blockhash age', async () => {
    const wallet = Keypair.generate().publicKey;
    const destination = Keypair.generate().publicKey;
    const calls: Array<Readonly<{ method: string; params: readonly unknown[] }>> = [];
    const fetchMock = rpcFetch((method, params) => {
      calls.push({ method, params });
      if (method === 'getSignatureStatuses') {
        return { context: { slot: 300 }, value: [null] };
      }
      if (method === 'getTransaction') return null;
      if (method === 'getSignaturesForAddress') return [];
      throw new Error(`Unexpected method: ${method}`);
    });
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

    await expect(
      rpc.verifyFinalizedDeposit('1'.repeat(64), {
        wallet,
        sourceLiquidityAccount: wallet,
        destinationCollateralAccount: destination,
        expectedMessageBase64: 'x',
        preflightSlot: 100n,
        lastValidBlockHeight: 250n,
      }),
    ).resolves.toEqual({ status: 'PENDING' });
    expect(calls).toEqual([
      {
        method: 'getSignatureStatuses',
        params: [['1'.repeat(64)], { searchTransactionHistory: true }],
      },
      {
        method: 'getTransaction',
        params: [
          '1'.repeat(64),
          { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 },
        ],
      },
      {
        method: 'getSignaturesForAddress',
        params: [wallet.toBase58(), { commitment: 'finalized', minContextSlot: 100, limit: 100 }],
      },
      {
        method: 'getSignaturesForAddress',
        params: [
          destination.toBase58(),
          { commitment: 'finalized', minContextSlot: 100, limit: 100 },
        ],
      },
    ]);
    expect(calls.some(({ method }) => method === 'getBlockHeight')).toBe(false);
    expect(calls.some(({ method }) => method === 'sendTransaction')).toBe(false);
  });

  it('verifies a finalized transaction directly even when the signature-status index misses it', async () => {
    const fixture = finalizedDepositFixture();
    const calls: Array<Readonly<{ method: string; params: readonly unknown[] }>> = [];
    const fetchMock = rpcFetch((method, params) => {
      calls.push({ method, params });
      if (method === 'getSignatureStatuses') {
        return { context: { slot: 300 }, value: [null] };
      }
      if (method === 'getTransaction') return fixture.transactionResult();
      throw new Error(`Unexpected method: ${method}`);
    });
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

    await expect(
      rpc.verifyFinalizedDeposit(fixture.signature, fixture.expectation),
    ).resolves.toEqual({
      status: 'VERIFIED',
      slot: 101n,
      collateralBalanceBeforeAtomic: 7n,
      collateralBalanceAfterAtomic: 9_000_007n,
      increaseAtomic: 9_000_000n,
    });
    expect(calls).toEqual([
      {
        method: 'getSignatureStatuses',
        params: [[fixture.signature], { searchTransactionHistory: true }],
      },
      {
        method: 'getTransaction',
        params: [
          fixture.signature,
          { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 },
        ],
      },
    ]);
  });

  it('uses finalized wallet and collateral address history as a positive lookup fallback', async () => {
    const fixture = finalizedDepositFixture();
    const calls: Array<Readonly<{ method: string; params: readonly unknown[] }>> = [];
    let transactionLookups = 0;
    const fetchMock = rpcFetch((method, params) => {
      calls.push({ method, params });
      if (method === 'getSignatureStatuses') {
        return { context: { slot: 300 }, value: [null] };
      }
      if (method === 'getTransaction') {
        transactionLookups += 1;
        return transactionLookups === 1 ? null : fixture.transactionResult();
      }
      if (method === 'getSignaturesForAddress') {
        if (params[0] === fixture.expectation.wallet.toBase58()) return [];
        if (params[0] === fixture.expectation.destinationCollateralAccount.toBase58()) {
          return [
            {
              signature: fixture.signature,
              slot: 101,
              err: null,
              memo: null,
              blockTime: 1_787_832_001,
              confirmationStatus: 'finalized',
            },
          ];
        }
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

    await expect(
      rpc.verifyFinalizedDeposit(fixture.signature, fixture.expectation),
    ).resolves.toEqual({
      status: 'VERIFIED',
      slot: 101n,
      collateralBalanceBeforeAtomic: 7n,
      collateralBalanceAfterAtomic: 9_000_007n,
      increaseAtomic: 9_000_000n,
    });
    expect(calls.map(({ method }) => method)).toEqual([
      'getSignatureStatuses',
      'getTransaction',
      'getSignaturesForAddress',
      'getSignaturesForAddress',
      'getTransaction',
    ]);
  });

  it('keeps positive address-history evidence pending until exact transaction bytes are readable', async () => {
    const fixture = finalizedDepositFixture();
    const fetchMock = rpcFetch((method) => {
      if (method === 'getSignatureStatuses') {
        return { context: { slot: 300 }, value: [null] };
      }
      if (method === 'getTransaction') return null;
      if (method === 'getSignaturesForAddress') {
        return [
          {
            signature: fixture.signature,
            slot: 101,
            err: null,
            memo: null,
            blockTime: 1_787_832_001,
            confirmationStatus: 'finalized',
          },
        ];
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const rpc = new FixedSolanaDevnetExecutionRpc(CONFIG, fetchMock);

    await expect(
      rpc.verifyFinalizedDeposit(fixture.signature, fixture.expectation),
    ).resolves.toEqual({ status: 'PENDING' });
  });
});
