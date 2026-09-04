import { createHash } from 'node:crypto';

import { PublicKey } from '@solana/web3.js';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import {
  createKaminoLendSolanaManifest,
  KAMINO_LEND_SOLANA_MAINNET_IDENTITIES as ID,
  KAMINO_LEND_SOLANA_SOURCE_PINS as SOURCE,
  KaminoLendSolanaFinalizedTranscriptAdapter,
  KaminoLendSolanaTranscriptUnavailableError,
  type KaminoLendSolanaJsonRpcRequest,
  type KaminoLendSolanaJsonRpcTranscriptTransport,
  type KaminoLendSolanaManifest,
  type KaminoLendSolanaTranscriptClock,
  type ReadKaminoLendSolanaTranscriptRequest,
} from './kamino-lend-solana-finalized-transcript.adapter';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const NOW_SECONDS = 1_767_225_600;
const SLOT = 1_000;
const DEPLOYED_SLOT = 900;
const PROGRAM_DATA_ADDRESS = 'BPFLoader2111111111111111111111111111111111';
const UPGRADE_AUTHORITY = 'Config1111111111111111111111111111111111111';
const MARKET_BYTES = 4_664;
const RESERVE_BYTES = 8_624;
const TOKEN_MINT_BYTES = 82;
const PROGRAM_DATA_HEADER_BYTES = 45;
const MARKET_DISCRIMINATOR = [246, 114, 50, 98, 72, 157, 28, 120] as const;
const RESERVE_DISCRIMINATOR = [43, 242, 204, 202, 26, 247, 59, 127] as const;

interface RpcAccount {
  data: [string, 'base64'];
  executable: boolean;
  lamports: number;
  owner: string;
  rentEpoch: number;
  space: number;
}

interface AccountsResult {
  context: { slot: number; apiVersion?: string };
  value: Array<RpcAccount | null>;
}

interface RpcBlock {
  blockHeight: number | null;
  blockTime: number | null;
  blockhash: string;
  parentSlot: number;
  previousBlockhash: string;
}

interface Fixture {
  accounts: RpcAccount[];
  accountResult: AccountsResult;
  blockBefore: RpcBlock;
  blockAfter: RpcBlock;
  responses: Map<number, unknown>;
  manifest: KaminoLendSolanaManifest;
  transport: FakeTransport;
  clock: KaminoLendSolanaTranscriptClock;
}

const REQUEST: ReadKaminoLendSolanaTranscriptRequest = Object.freeze({
  marketId: 'kamino-lend-solana-mainnet-main-usdc',
  programAddress: ID.programAddress,
  lendingMarketAddress: ID.lendingMarketAddress,
  reserveAddress: ID.usdcReserveAddress,
  assetMintAddress: ID.usdcMintAddress,
});

class FakeTransport implements KaminoLendSolanaJsonRpcTranscriptTransport {
  readonly calls: KaminoLendSolanaJsonRpcRequest[] = [];
  throwAtId: number | undefined;

  constructor(readonly responses: Map<number, unknown>) {}

  async exchange(request: KaminoLendSolanaJsonRpcRequest): Promise<unknown> {
    this.calls.push(request);
    if (request.id === this.throwAtId) throw new Error('sensitive upstream detail');
    return this.responses.get(request.id);
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function keyBytes(address: string): Uint8Array {
  return new PublicKey(address).toBytes();
}

function writeKey(data: Buffer, offset: number, address: string): void {
  data.set(keyBytes(address), offset);
}

function writeU128(data: Buffer, offset: number, value: bigint): void {
  data.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  data.writeBigUInt64LE(value >> 64n, offset + 8);
}

function programBytes(): Buffer {
  const data = Buffer.alloc(36);
  data.writeUInt32LE(2, 0);
  writeKey(data, 4, PROGRAM_DATA_ADDRESS);
  return data;
}

function programDataBytes(authority: string | null = UPGRADE_AUTHORITY): Buffer {
  const data = Buffer.alloc(PROGRAM_DATA_HEADER_BYTES + 64);
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(BigInt(DEPLOYED_SLOT), 4);
  if (authority === null) {
    data[12] = 0;
  } else {
    data[12] = 1;
    writeKey(data, 13, authority);
  }
  data.set([0x7f, 0x45, 0x4c, 0x46], PROGRAM_DATA_HEADER_BYTES);
  data.fill(0x5a, PROGRAM_DATA_HEADER_BYTES + 4);
  return data;
}

function marketBytes(): Buffer {
  const data = Buffer.alloc(MARKET_BYTES);
  data.set(MARKET_DISCRIMINATOR, 0);
  data.writeBigUInt64LE(1n, 8);
  data[122] = 0;
  data[123] = 1;
  data[124] = 0;
  return data;
}

function reserveBytes(): Buffer {
  const data = Buffer.alloc(RESERVE_BYTES);
  data.set(RESERVE_DISCRIMINATOR, 0);
  data.writeBigUInt64LE(1n, 8);
  data.writeBigUInt64LE(BigInt(SLOT - 1), 16);
  data[24] = 0;
  data[25] = 7;
  data.writeUInt32LE(NOW_SECONDS - 5, 28);
  writeKey(data, 32, ID.lendingMarketAddress);
  writeKey(data, 128, ID.usdcMintAddress);
  data.writeBigUInt64LE(2_000_000n, 224);
  writeU128(data, 232, (1n << 80n) + 123n);
  data.writeBigUInt64LE(6n, 272);
  writeKey(data, 408, ID.legacyTokenProgramAddress);
  data[4_856] = 0;
  data[4_864] = 0;
  data.writeBigUInt64LE(10_000_000_000n, 5_016);
  data.writeBigUInt64LE(8_000_000_000n, 5_024);
  return data;
}

function mintBytes(): Buffer {
  const data = Buffer.alloc(TOKEN_MINT_BYTES);
  data.writeUInt32LE(1, 0);
  writeKey(data, 4, UPGRADE_AUTHORITY);
  data.writeBigUInt64LE(50_000_000_000n, 36);
  data[44] = 6;
  data[45] = 1;
  data.writeUInt32LE(1, 46);
  writeKey(data, 50, ID.lendingMarketAddress);
  return data;
}

function rpcAccount(data: Buffer, owner: string, executable: boolean): RpcAccount {
  return {
    data: [data.toString('base64'), 'base64'],
    executable,
    lamports: 1_000_000,
    owner,
    rentEpoch: Number((1n << 64n) - 1n),
    space: data.byteLength,
  };
}

function sourceDefinition(): KaminoLendSolanaManifest['sources'] {
  return {
    klendCommitSha: SOURCE.klendCommitSha,
    klendSdkCommitSha: SOURCE.klendSdkCommitSha,
    solanaLoaderCommitSha: SOURCE.solanaLoaderCommitSha,
    splTokenCommitSha: SOURCE.splTokenCommitSha,
    lendingMarketLayout: SOURCE.lendingMarketLayout,
    reserveLayout: SOURCE.reserveLayout,
    loaderLayout: SOURCE.loaderLayout,
    mintLayout: SOURCE.mintLayout,
  };
}

function manifestDefinition(
  programData: Buffer,
  authority: string | null = UPGRADE_AUTHORITY,
): Omit<KaminoLendSolanaManifest, 'manifestFingerprintSha256'> {
  return {
    schemaVersion: 1,
    use: 'DORMANT_KAMINO_LEND_USDC_CORROBORATION_ONLY',
    sources: sourceDefinition(),
    assetRegistry: {
      environment: 'MAINNET',
      version: 1,
      fingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    },
    networkId: ID.networkId,
    genesisHash: ID.genesisHash,
    commitment: 'finalized',
    snapshotBinding: 'ONE_GET_MULTIPLE_ACCOUNTS_MIN_CONTEXT_SLOT',
    maximumAgeSeconds: '60',
    deployment: {
      programAddress: ID.programAddress,
      programDataAddress: PROGRAM_DATA_ADDRESS,
      programDataAccountLengthBytes: programData.byteLength.toString(10),
      programDataBinarySha256: sha256(programData.subarray(PROGRAM_DATA_HEADER_BYTES)),
      expectedLastDeployedSlot: DEPLOYED_SLOT.toString(10),
      expectedUpgradeAuthorityAddress: authority,
    },
    market: {
      marketId: 'kamino-lend-solana-mainnet-main-usdc',
      address: ID.lendingMarketAddress,
      expectedVersion: '1',
    },
    reserve: {
      address: ID.usdcReserveAddress,
      expectedVersion: '1',
      lendingMarketAddress: ID.lendingMarketAddress,
      liquidityMintAddress: ID.usdcMintAddress,
    },
    asset: {
      stablecoin: 'USDC',
      mintAddress: ID.usdcMintAddress,
      decimals: 6,
      tokenProgramAddress: ID.legacyTokenProgramAddress,
    },
  };
}

function envelope(id: number, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

function fixture(authority: string | null = UPGRADE_AUTHORITY): Fixture {
  const programData = programDataBytes(authority);
  const accounts = [
    rpcAccount(programBytes(), ID.upgradeableLoaderAddress, true),
    rpcAccount(programData, ID.upgradeableLoaderAddress, false),
    rpcAccount(marketBytes(), ID.programAddress, false),
    rpcAccount(reserveBytes(), ID.programAddress, false),
    rpcAccount(mintBytes(), ID.legacyTokenProgramAddress, false),
  ];
  const accountResult: AccountsResult = {
    context: { slot: SLOT, apiVersion: '3.1.8' },
    value: accounts,
  };
  const blockBefore: RpcBlock = {
    blockHeight: 950,
    blockTime: NOW_SECONDS - 10,
    blockhash: ID.lendingMarketAddress,
    parentSlot: SLOT - 1,
    previousBlockhash: ID.usdcReserveAddress,
  };
  const blockAfter = { ...blockBefore };
  const responses = new Map<number, unknown>([
    [1, envelope(1, ID.genesisHash)],
    [2, envelope(2, SLOT - 1)],
    [3, envelope(3, accountResult)],
    [4, envelope(4, blockBefore)],
    [5, envelope(5, SLOT + 2)],
    [6, envelope(6, blockAfter)],
    [7, envelope(7, ID.genesisHash)],
  ]);
  const transport = new FakeTransport(responses);
  return {
    accounts,
    accountResult,
    blockBefore,
    blockAfter,
    responses,
    manifest: createKaminoLendSolanaManifest(manifestDefinition(programData, authority)),
    transport,
    clock: { now: () => new Date(NOW) },
  };
}

function adapter(value: Fixture): KaminoLendSolanaFinalizedTranscriptAdapter {
  return new KaminoLendSolanaFinalizedTranscriptAdapter(
    value.manifest,
    value.manifest.manifestFingerprintSha256,
    value.transport,
    value.clock,
  );
}

function mutateAccount(value: Fixture, index: number, mutate: (bytes: Buffer) => void): void {
  const account = value.accounts[index];
  if (account === undefined) throw new Error('bad test account index');
  const bytes = Buffer.from(account.data[0], 'base64');
  mutate(bytes);
  account.data = [bytes.toString('base64'), 'base64'];
}

async function expectUnavailable(
  operation: Promise<unknown> | (() => unknown),
): Promise<KaminoLendSolanaTranscriptUnavailableError> {
  let thrown: unknown;
  try {
    if (typeof operation === 'function') operation();
    else await operation;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(KaminoLendSolanaTranscriptUnavailableError);
  expect(thrown).toMatchObject({
    code: 'KAMINO_LEND_SOLANA_TRANSCRIPT_UNAVAILABLE',
    message: 'Kamino Lend Solana transcript is unavailable',
  });
  return thrown as KaminoLendSolanaTranscriptUnavailableError;
}

describe('Kamino Lend Solana manifest', () => {
  it('pins official identities, layouts, active registry v1, and a separate fingerprint', () => {
    const value = fixture();
    expect(value.manifest).toMatchObject({
      schemaVersion: 1,
      networkId: ID.networkId,
      genesisHash: ID.genesisHash,
      maximumAgeSeconds: '60',
      sources: sourceDefinition(),
      assetRegistry: {
        environment: 'MAINNET',
        version: 1,
        fingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
      },
      market: { address: ID.lendingMarketAddress },
      reserve: { address: ID.usdcReserveAddress },
      asset: { mintAddress: ID.usdcMintAddress, decimals: 6 },
    });
    expect(value.manifest.manifestFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(createKaminoLendSolanaManifest(value.manifest)).toEqual(value.manifest);
  });

  it.each([
    [
      'source commit',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        sources: { ...input.sources, klendCommitSha: 'a'.repeat(40) },
      }),
    ],
    [
      'layout',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        sources: { ...input.sources, reserveLayout: 'unreviewed' },
      }),
    ],
    [
      'registry',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        assetRegistry: { ...input.assetRegistry, fingerprintSha256: 'a'.repeat(64) },
      }),
    ],
    [
      'network',
      (input: ReturnType<typeof manifestDefinition>) => ({ ...input, networkId: 'solana:devnet' }),
    ],
    [
      'commitment',
      (input: ReturnType<typeof manifestDefinition>) => ({ ...input, commitment: 'confirmed' }),
    ],
    [
      'program',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        deployment: { ...input.deployment, programAddress: ID.usdcReserveAddress },
      }),
    ],
    [
      'market',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        market: { ...input.market, address: ID.usdcReserveAddress },
      }),
    ],
    [
      'reserve',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        reserve: { ...input.reserve, address: ID.lendingMarketAddress },
      }),
    ],
    [
      'mint',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        asset: { ...input.asset, mintAddress: ID.usdcReserveAddress },
      }),
    ],
    [
      'decimals',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        asset: { ...input.asset, decimals: 9 },
      }),
    ],
    [
      'zero binary hash',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        deployment: { ...input.deployment, programDataBinarySha256: '0'.repeat(64) },
      }),
    ],
    [
      'zero deployed slot',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        deployment: { ...input.deployment, expectedLastDeployedSlot: '0' },
      }),
    ],
    [
      'noncanonical version',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        market: { ...input.market, expectedVersion: '01' },
      }),
    ],
    [
      'zero age',
      (input: ReturnType<typeof manifestDefinition>) => ({ ...input, maximumAgeSeconds: '0' }),
    ],
    [
      'age above bound',
      (input: ReturnType<typeof manifestDefinition>) => ({ ...input, maximumAgeSeconds: '3601' }),
    ],
    [
      'unexpected field',
      (input: ReturnType<typeof manifestDefinition>) => ({
        ...input,
        endpoint: 'https://forbidden.example',
      }),
    ],
  ])('rejects %s drift', (_label, change) => {
    const programData = programDataBytes();
    expect(() => createKaminoLendSolanaManifest(change(manifestDefinition(programData)))).toThrow(
      KaminoLendSolanaTranscriptUnavailableError,
    );
  });

  it('rejects a mismatched supplied manifest fingerprint', () => {
    const parsed = fixture().manifest;
    expect(() =>
      createKaminoLendSolanaManifest({ ...parsed, manifestFingerprintSha256: 'a'.repeat(64) }),
    ).toThrow(KaminoLendSolanaTranscriptUnavailableError);
  });

  it('rejects accessors without invoking them and rejects custom prototypes', () => {
    let invoked = false;
    const accessor = Object.defineProperty({}, 'schemaVersion', {
      enumerable: true,
      get: () => {
        invoked = true;
        return 1;
      },
    });
    expect(() => createKaminoLendSolanaManifest(accessor)).toThrow(
      KaminoLendSolanaTranscriptUnavailableError,
    );
    expect(invoked).toBe(false);
    expect(() => createKaminoLendSolanaManifest(Object.create({ schemaVersion: 1 }))).toThrow(
      KaminoLendSolanaTranscriptUnavailableError,
    );
  });

  it('requires the separately supplied fingerprint in the adapter constructor', () => {
    const value = fixture();
    expect(
      () =>
        new KaminoLendSolanaFinalizedTranscriptAdapter(
          value.manifest,
          'a'.repeat(64),
          value.transport,
          value.clock,
        ),
    ).toThrow(KaminoLendSolanaTranscriptUnavailableError);
  });
});

describe('Kamino Lend Solana finalized transcript', () => {
  it('returns a bounded, explicitly non-persistable raw candidate', async () => {
    const value = fixture();
    const candidate = await adapter(value).read(REQUEST);
    expect(candidate).toMatchObject({
      sourceId: 'KAMINO_LEND_SOLANA_FINALIZED_JSON_RPC_TRANSCRIPT',
      sourcePosition: SLOT.toString(10),
      sourceFinality: 'SOLANA_FINALIZED_SLOT',
      sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT',
      yieldEvidenceStatus: 'ABSENT_NOT_COMPUTED',
      liquidityEvidenceStatus: 'RAW_AVAILABLE_AMOUNT_ONLY_NOT_CAPACITY',
      mayPersist: false,
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      observedAt: NOW.toISOString(),
      staleAfter: '2026-01-01T00:00:50.000Z',
      deployment: {
        programAddress: ID.programAddress,
        programDataAddress: PROGRAM_DATA_ADDRESS,
        lastDeployedSlot: DEPLOYED_SLOT.toString(10),
        upgradeAuthorityAddress: UPGRADE_AUTHORITY,
        upgradeAuthorityStatus: 'PRESENT_CALLER_PINNED',
      },
      market: {
        version: '1',
        emergencyMode: false,
        borrowDisabled: false,
      },
      reserve: {
        version: '1',
        lastUpdateSlot: (SLOT - 1).toString(10),
        priceStatusRaw: '7',
        totalAvailableAmountAtomicRaw: '2000000',
        borrowedAmountScaledFractionRaw: ((1n << 80n) + 123n).toString(10),
        depositLimitAtomicRaw: '10000000000',
        borrowLimitAtomicRaw: '8000000000',
      },
      asset: {
        stablecoin: 'USDC',
        decimals: 6,
        initialized: true,
        supplyAtomicRaw: '50000000000',
      },
    });
    expect(candidate.transcriptFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(candidate)).toBe(true);
  });

  it('uses exactly one ordered getMultipleAccounts snapshot with finalized minContextSlot', async () => {
    const value = fixture();
    await adapter(value).read(REQUEST);
    expect(value.transport.calls.map(({ method }) => method)).toEqual([
      'getGenesisHash',
      'getSlot',
      'getMultipleAccounts',
      'getBlock',
      'getSlot',
      'getBlock',
      'getGenesisHash',
    ]);
    expect(value.transport.calls[2]?.params).toEqual([
      [
        ID.programAddress,
        PROGRAM_DATA_ADDRESS,
        ID.lendingMarketAddress,
        ID.usdcReserveAddress,
        ID.usdcMintAddress,
      ],
      { commitment: 'finalized', encoding: 'base64', minContextSlot: SLOT - 1 },
    ]);
    expect(Object.isFrozen(value.transport.calls[2]?.params)).toBe(true);
    expect(Object.isFrozen(value.transport.calls[2]?.params[0])).toBe(true);
    expect(Object.isFrozen(value.transport.calls[2]?.params[1])).toBe(true);
  });

  it('supports an explicitly caller-pinned revoked upgrade authority', async () => {
    const value = fixture(null);
    const candidate = await adapter(value).read(REQUEST);
    expect(candidate.deployment).toMatchObject({
      upgradeAuthorityAddress: null,
      upgradeAuthorityStatus: 'REVOKED_CALLER_PINNED',
    });
  });

  it('produces deterministic fingerprints for an identical transcript', async () => {
    const first = fixture();
    const second = fixture();
    expect((await adapter(first).read(REQUEST)).transcriptFingerprintSha256).toBe(
      (await adapter(second).read(REQUEST)).transcriptFingerprintSha256,
    );
  });

  it.each([
    ['market id', { ...REQUEST, marketId: 'wrong' }],
    ['program', { ...REQUEST, programAddress: ID.usdcReserveAddress }],
    ['market', { ...REQUEST, lendingMarketAddress: ID.usdcReserveAddress }],
    ['reserve', { ...REQUEST, reserveAddress: ID.lendingMarketAddress }],
    ['mint', { ...REQUEST, assetMintAddress: ID.usdcReserveAddress }],
    ['extra field', { ...REQUEST, endpoint: 'forbidden' }],
  ])('rejects request %s drift before transport use', async (_label, request) => {
    const value = fixture();
    await expectUnavailable(adapter(value).read(request as ReadKaminoLendSolanaTranscriptRequest));
    expect(value.transport.calls).toHaveLength(0);
  });

  it.each([1, 7])('rejects wrong mainnet genesis identity at RPC %i', async (id) => {
    const value = fixture();
    value.responses.set(id, envelope(id, ID.usdcReserveAddress));
    await expectUnavailable(adapter(value).read(REQUEST));
  });

  it('sanitizes transport failures', async () => {
    const value = fixture();
    value.transport.throwAtId = 3;
    const error = await expectUnavailable(adapter(value).read(REQUEST));
    expect(error.message).not.toContain('sensitive');
  });

  it.each([
    ['wrong JSON-RPC version', { jsonrpc: '1.0', id: 1, result: ID.genesisHash }],
    ['wrong id', { jsonrpc: '2.0', id: 99, result: ID.genesisHash }],
    ['error envelope', { jsonrpc: '2.0', id: 1, error: { code: -1 } }],
    ['extra envelope field', { jsonrpc: '2.0', id: 1, result: ID.genesisHash, trace: 'x' }],
  ])('rejects %s', async (_label, response) => {
    const value = fixture();
    value.responses.set(1, response);
    await expectUnavailable(adapter(value).read(REQUEST));
  });

  it('rejects response accessors without invoking them', async () => {
    const value = fixture();
    let invoked = false;
    value.responses.set(
      1,
      Object.defineProperty({ jsonrpc: '2.0', id: 1 }, 'result', {
        enumerable: true,
        get: () => {
          invoked = true;
          return ID.genesisHash;
        },
      }),
    );
    await expectUnavailable(adapter(value).read(REQUEST));
    expect(invoked).toBe(false);
  });

  it('rejects cyclic and custom-prototype response data', async () => {
    const cyclic: Record<string, unknown> = { jsonrpc: '2.0', id: 1 };
    cyclic.result = cyclic;
    const first = fixture();
    first.responses.set(1, cyclic);
    await expectUnavailable(adapter(first).read(REQUEST));

    const second = fixture();
    second.responses.set(1, Object.create({ jsonrpc: '2.0', id: 1, result: ID.genesisHash }));
    await expectUnavailable(adapter(second).read(REQUEST));
  });

  it.each([
    ['context regression', (value: Fixture) => (value.accountResult.context.slot = SLOT - 2)],
    [
      'unsafe context',
      (value: Fixture) => (value.accountResult.context.slot = Number.MAX_SAFE_INTEGER + 1),
    ],
    ['fractional context', (value: Fixture) => (value.accountResult.context.slot = SLOT + 0.5)],
    [
      'bad api version',
      (value: Fixture) => (value.accountResult.context.apiVersion = 'x'.repeat(33)),
    ],
    ['missing account', (value: Fixture) => value.accountResult.value.pop()],
    ['null account', (value: Fixture) => (value.accountResult.value[3] = null)],
  ])('rejects invalid snapshot: %s', async (_label, change) => {
    const value = fixture();
    change(value);
    await expectUnavailable(adapter(value).read(REQUEST));
  });

  it.each([
    ['owner', (account: RpcAccount) => (account.owner = ID.usdcMintAddress)],
    ['executable', (account: RpcAccount) => (account.executable = true)],
    ['space', (account: RpcAccount) => (account.space += 1)],
    ['zero lamports', (account: RpcAccount) => (account.lamports = 0)],
    ['fractional lamports', (account: RpcAccount) => (account.lamports = 1.5)],
    ['invalid rent epoch', (account: RpcAccount) => (account.rentEpoch = -1)],
    ['wrong encoding', (account: RpcAccount) => ((account.data as [string, string])[1] = 'base58')],
  ])('rejects invalid reserve account metadata: %s', async (_label, change) => {
    const value = fixture();
    const account = value.accounts[3];
    if (account === undefined) throw new Error('missing fixture account');
    change(account);
    await expectUnavailable(adapter(value).read(REQUEST));
  });

  it('rejects noncanonical and wrong-length base64', async () => {
    const noncanonical = fixture();
    const reserve = noncanonical.accounts[3];
    if (reserve === undefined) throw new Error('missing reserve');
    reserve.data = [`${reserve.data[0]}\n`, 'base64'];
    await expectUnavailable(adapter(noncanonical).read(REQUEST));

    const wrongLength = fixture();
    const market = wrongLength.accounts[2];
    if (market === undefined) throw new Error('missing market');
    const bytes = Buffer.from(market.data[0], 'base64').subarray(1);
    market.data = [bytes.toString('base64'), 'base64'];
    market.space = bytes.byteLength;
    await expectUnavailable(adapter(wrongLength).read(REQUEST));
  });

  it.each([
    [
      'program variant',
      (value: Fixture) => mutateAccount(value, 0, (bytes) => bytes.writeUInt32LE(1, 0)),
    ],
    [
      'program-data link',
      (value: Fixture) =>
        mutateAccount(value, 0, (bytes) => writeKey(bytes, 4, ID.usdcReserveAddress)),
    ],
    [
      'program-data variant',
      (value: Fixture) => mutateAccount(value, 1, (bytes) => bytes.writeUInt32LE(2, 0)),
    ],
    ['program-data ELF', (value: Fixture) => mutateAccount(value, 1, (bytes) => (bytes[45] = 0))],
    [
      'program-data deployment slot',
      (value: Fixture) => mutateAccount(value, 1, (bytes) => bytes.writeBigUInt64LE(901n, 4)),
    ],
    [
      'program-data future slot',
      (value: Fixture) => mutateAccount(value, 1, (bytes) => bytes.writeBigUInt64LE(1_001n, 4)),
    ],
    [
      'program-data authority',
      (value: Fixture) =>
        mutateAccount(value, 1, (bytes) => writeKey(bytes, 13, ID.usdcReserveAddress)),
    ],
    [
      'program-data option',
      (value: Fixture) => mutateAccount(value, 1, (bytes) => (bytes[12] = 2)),
    ],
    [
      'program binary hash',
      (value: Fixture) => mutateAccount(value, 1, (bytes) => (bytes[60] = (bytes[60] ?? 0) ^ 1)),
    ],
  ])('rejects loader/deployment drift: %s', async (_label, change) => {
    const value = fixture();
    change(value);
    await expectUnavailable(adapter(value).read(REQUEST));
  });

  it.each([
    ['discriminator', (bytes: Buffer) => (bytes[0] = (bytes[0] ?? 0) ^ 1)],
    ['version', (bytes: Buffer) => bytes.writeBigUInt64LE(2n, 8)],
    ['emergency', (bytes: Buffer) => (bytes[122] = 1)],
    ['invalid emergency flag', (bytes: Buffer) => (bytes[122] = 2)],
    ['borrow disabled', (bytes: Buffer) => (bytes[124] = 1)],
    ['invalid autodeleverage flag', (bytes: Buffer) => (bytes[123] = 2)],
  ])('rejects market drift: %s', async (_label, change) => {
    const value = fixture();
    mutateAccount(value, 2, change);
    await expectUnavailable(adapter(value).read(REQUEST));
  });

  it.each([
    ['discriminator', (bytes: Buffer) => (bytes[0] = (bytes[0] ?? 0) ^ 1)],
    ['version', (bytes: Buffer) => bytes.writeBigUInt64LE(2n, 8)],
    ['zero last update slot', (bytes: Buffer) => bytes.writeBigUInt64LE(0n, 16)],
    ['future last update slot', (bytes: Buffer) => bytes.writeBigUInt64LE(1_001n, 16)],
    ['stale bit', (bytes: Buffer) => (bytes[24] = 1)],
    ['zero timestamp', (bytes: Buffer) => bytes.writeUInt32LE(0, 28)],
    ['market identity', (bytes: Buffer) => writeKey(bytes, 32, ID.usdcReserveAddress)],
    ['mint identity', (bytes: Buffer) => writeKey(bytes, 128, ID.usdcReserveAddress)],
    ['mint decimals', (bytes: Buffer) => bytes.writeBigUInt64LE(9n, 272)],
    ['token program', (bytes: Buffer) => writeKey(bytes, 408, ID.usdcMintAddress)],
    ['obsolete status', (bytes: Buffer) => (bytes[4_856] = 1)],
    ['emergency mode', (bytes: Buffer) => (bytes[4_864] = 1)],
    ['invalid emergency flag', (bytes: Buffer) => (bytes[4_864] = 2)],
    ['zero deposit limit', (bytes: Buffer) => bytes.writeBigUInt64LE(0n, 5_016)],
    ['zero borrow limit', (bytes: Buffer) => bytes.writeBigUInt64LE(0n, 5_024)],
  ])('rejects reserve drift: %s', async (_label, change) => {
    const value = fixture();
    mutateAccount(value, 3, change);
    await expectUnavailable(adapter(value).read(REQUEST));
  });

  it.each([
    ['invalid mint option', (bytes: Buffer) => bytes.writeUInt32LE(2, 0)],
    [
      'noncanonical absent mint authority',
      (bytes: Buffer) => {
        bytes.writeUInt32LE(0, 0);
        bytes[4] = 1;
      },
    ],
    ['zero supply', (bytes: Buffer) => bytes.writeBigUInt64LE(0n, 36)],
    ['wrong decimals', (bytes: Buffer) => (bytes[44] = 9)],
    ['uninitialized', (bytes: Buffer) => (bytes[45] = 0)],
    ['invalid initialized flag', (bytes: Buffer) => (bytes[45] = 2)],
    ['invalid freeze option', (bytes: Buffer) => bytes.writeUInt32LE(2, 46)],
  ])('rejects SPL mint drift: %s', async (_label, change) => {
    const value = fixture();
    mutateAccount(value, 4, change);
    await expectUnavailable(adapter(value).read(REQUEST));
  });

  it.each([
    ['null block', (value: Fixture) => value.responses.set(4, envelope(4, null))],
    ['null block time', (value: Fixture) => (value.blockBefore.blockTime = null)],
    ['zero block time', (value: Fixture) => (value.blockBefore.blockTime = 0)],
    ['null block height', (value: Fixture) => (value.blockBefore.blockHeight = null)],
    ['parent at slot', (value: Fixture) => (value.blockBefore.parentSlot = SLOT)],
    [
      'same block hashes',
      (value: Fixture) => (value.blockBefore.previousBlockhash = value.blockBefore.blockhash),
    ],
    ['invalid block hash', (value: Fixture) => (value.blockBefore.blockhash = 'not-base58')],
    [
      'transaction payload',
      (value: Fixture) => Object.assign(value.blockBefore, { transactions: [{}] }),
    ],
    ['finalized regression', (value: Fixture) => value.responses.set(5, envelope(5, SLOT - 1))],
    ['reorged hash', (value: Fixture) => (value.blockAfter.blockhash = ID.usdcMintAddress)],
    ['changed block time', (value: Fixture) => (value.blockAfter.blockTime = NOW_SECONDS - 9)],
  ])('rejects incoherent finalized block evidence: %s', async (_label, change) => {
    const value = fixture();
    change(value);
    await expectUnavailable(adapter(value).read(REQUEST));
  });

  it('rejects a future and exclusive-boundary stale block time', async () => {
    const future = fixture();
    future.blockBefore.blockTime = NOW_SECONDS + 1;
    future.blockAfter.blockTime = NOW_SECONDS + 1;
    await expectUnavailable(adapter(future).read(REQUEST));

    const stale = fixture();
    stale.blockBefore.blockTime = NOW_SECONDS - 60;
    stale.blockAfter.blockTime = NOW_SECONDS - 60;
    await expectUnavailable(adapter(stale).read(REQUEST));
  });

  it('rejects a future and exclusive-boundary stale reserve timestamp', async () => {
    const future = fixture();
    mutateAccount(future, 3, (bytes) => bytes.writeUInt32LE(NOW_SECONDS + 1, 28));
    await expectUnavailable(adapter(future).read(REQUEST));

    const stale = fixture();
    mutateAccount(stale, 3, (bytes) => bytes.writeUInt32LE(NOW_SECONDS - 60, 28));
    await expectUnavailable(adapter(stale).read(REQUEST));
  });

  it('accepts one millisecond inside the exclusive freshness boundary', async () => {
    const value = fixture();
    value.blockBefore.blockTime = NOW_SECONDS - 60;
    value.blockAfter.blockTime = NOW_SECONDS - 60;
    value.clock = { now: () => new Date(NOW.getTime() - 1) };
    await expect(adapter(value).read(REQUEST)).resolves.toMatchObject({
      freshnessStatus: 'CURRENT_WITHIN_CALLER_MANIFEST_BOUND',
    });
  });

  it('rejects Date subclasses and invalid dates', async () => {
    class HostileDate extends Date {}
    const subclass = fixture();
    subclass.clock = { now: () => new HostileDate(NOW) };
    await expectUnavailable(adapter(subclass).read(REQUEST));

    const invalid = fixture();
    invalid.clock = { now: () => new Date(Number.NaN) };
    await expectUnavailable(adapter(invalid).read(REQUEST));
  });

  it('uses Date.prototype methods without invoking hostile instance overrides', async () => {
    const value = fixture();
    const hostile = new Date(NOW);
    let getTimeInvoked = false;
    let toISOStringInvoked = false;
    Object.defineProperties(hostile, {
      getTime: {
        value: () => {
          getTimeInvoked = true;
          throw new Error('hostile getTime');
        },
      },
      toISOString: {
        value: () => {
          toISOStringInvoked = true;
          throw new Error('hostile toISOString');
        },
      },
    });
    value.clock = { now: () => hostile };
    await expect(adapter(value).read(REQUEST)).resolves.toMatchObject({
      observedAt: NOW.toISOString(),
    });
    expect(getTimeInvoked).toBe(false);
    expect(toISOStringInvoked).toBe(false);
  });

  it('binds reserve binary fingerprints without interpreting yield or capacity', async () => {
    const value = fixture();
    const first = await adapter(value).read(REQUEST);
    const changed = fixture();
    mutateAccount(changed, 3, (bytes) => bytes.writeBigUInt64LE(3_000_000n, 224));
    const second = await adapter(changed).read(REQUEST);
    expect(second.reserve.totalAvailableAmountAtomicRaw).toBe('3000000');
    expect(second.reserve.accountDataSha256).not.toBe(first.reserve.accountDataSha256);
    expect(second.transcriptFingerprintSha256).not.toBe(first.transcriptFingerprintSha256);
    expect(second.yieldEvidenceStatus).toBe('ABSENT_NOT_COMPUTED');
    expect(second.liquidityEvidenceStatus).toBe('RAW_AVAILABLE_AMOUNT_ONLY_NOT_CAPACITY');
  });
});
