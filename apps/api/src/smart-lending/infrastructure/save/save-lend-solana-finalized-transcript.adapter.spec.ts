import { createHash } from 'node:crypto';

import { PublicKey } from '@solana/web3.js';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import {
  createSaveLendSolanaManifest,
  type ReadSaveLendSolanaTranscriptRequest,
  SAVE_LEND_SOLANA_MAINNET_IDENTITIES as ID,
  SAVE_LEND_SOLANA_SOURCE_PINS as SOURCE,
  SaveLendSolanaFinalizedTranscriptAdapter,
  type SaveLendSolanaJsonRpcRequest,
  type SaveLendSolanaJsonRpcTranscriptTransport,
  type SaveLendSolanaManifest,
  type SaveLendSolanaTranscriptClock,
  SaveLendSolanaTranscriptUnavailableError,
} from './save-lend-solana-finalized-transcript.adapter';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const NOW_SECONDS = 1_767_225_600;
const MINIMUM_SLOT = 995;
const SLOT = 1_000;
const DEPLOYED_SLOT = 900;
const PROGRAM_DATA_ADDRESS = 'BPFLoader2111111111111111111111111111111111';
const UPGRADE_AUTHORITY = 'Config1111111111111111111111111111111111111';
const MARKET_BYTES = 290;
const RESERVE_BYTES = 619;
const MINT_BYTES = 82;
const PROGRAM_DATA_HEADER_BYTES = 45;

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
  manifest: SaveLendSolanaManifest;
  authority: string | null;
  transport: FakeTransport;
  clock: SaveLendSolanaTranscriptClock;
}

const REQUEST: ReadSaveLendSolanaTranscriptRequest = Object.freeze({
  marketId: 'save-lend-solana-mainnet-main-usdc',
  programAddress: ID.programAddress,
  lendingMarketAddress: ID.lendingMarketAddress,
  reserveAddress: ID.usdcReserveAddress,
  assetMintAddress: ID.usdcMintAddress,
});

class FakeTransport implements SaveLendSolanaJsonRpcTranscriptTransport {
  readonly calls: SaveLendSolanaJsonRpcRequest[] = [];
  throwAtId: number | undefined;

  constructor(readonly responses: Map<number, unknown>) {}

  async exchange(request: SaveLendSolanaJsonRpcRequest): Promise<unknown> {
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
  data[0] = 1;
  data[1] = 254;
  writeKey(data, 2, UPGRADE_AUTHORITY);
  data.set(Buffer.from('USD', 'ascii'), 34);
  writeKey(data, 66, ID.legacyTokenProgramAddress);
  writeKey(data, 98, ID.usdcReserveAddress);
  writeKey(data, 130, ID.lendingMarketAddress);
  writeKey(data, 250, ID.lendingMarketAddress);
  return data;
}

function reserveBytes(): Buffer {
  const data = Buffer.alloc(RESERVE_BYTES);
  data[0] = 1;
  data.writeBigUInt64LE(BigInt(SLOT), 1);
  data[9] = 0;
  writeKey(data, 10, ID.lendingMarketAddress);
  writeKey(data, 42, ID.usdcMintAddress);
  data[74] = 6;
  writeKey(data, 75, ID.lendingMarketAddress);
  writeKey(data, 107, ID.usdcReserveAddress);
  writeKey(data, 139, ID.lendingMarketAddress);
  data.writeBigUInt64LE(2_000_000n, 171);
  writeU128(data, 179, (1n << 80n) + 123n);
  writeU128(data, 195, 1_000_000_000_000_000_000n);
  writeU128(data, 211, 1_000_000_000_000_000_000n);
  writeKey(data, 227, ID.usdcReserveAddress);
  data.writeBigUInt64LE(3_000_000n, 259);
  writeKey(data, 267, ID.lendingMarketAddress);
  data[299] = 80;
  data[300] = 75;
  data[302] = 85;
  data[305] = 30;
  data.writeBigUInt64LE(10_000_000_000n, 323);
  data.writeBigUInt64LE(8_000_000_000n, 331);
  writeKey(data, 339, UPGRADE_AUTHORITY);
  data[469] = 0;
  data[521] = 0;
  return data;
}

function mintBytes(): Buffer {
  const data = Buffer.alloc(MINT_BYTES);
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

function decodeAccount(account: RpcAccount): Buffer {
  return Buffer.from(account.data[0], 'base64');
}

function sourceDefinition(): SaveLendSolanaManifest['sources'] {
  return {
    publicCommitSha: SOURCE.publicCommitSha,
    programCommitSha: SOURCE.programCommitSha,
    solanaLoaderCommitSha: SOURCE.solanaLoaderCommitSha,
    splTokenCommitSha: SOURCE.splTokenCommitSha,
    lendingMarketLayout: SOURCE.lendingMarketLayout,
    reserveLayout: SOURCE.reserveLayout,
    lastUpdateLayout: SOURCE.lastUpdateLayout,
    loaderLayout: SOURCE.loaderLayout,
    mintLayout: SOURCE.mintLayout,
    reserveIdentityEvidence: SOURCE.reserveIdentityEvidence,
  };
}

function manifestDefinition(
  accounts: readonly RpcAccount[],
  authority: string | null,
): Omit<SaveLendSolanaManifest, 'manifestFingerprintSha256'> {
  const [program, programData, market, reserve, mint] = accounts.map(decodeAccount);
  if (!program || !programData || !market || !reserve || !mint) throw new Error('fixture accounts');
  return {
    schemaVersion: 1,
    use: 'DORMANT_SAVE_LEND_USDC_CORROBORATION_ONLY',
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
    maximumReserveSlotLag: '0',
    deployment: {
      programAddress: ID.programAddress,
      programDataAddress: PROGRAM_DATA_ADDRESS,
      programAccountDataSha256: sha256(program),
      programDataAccountLengthBytes: programData.byteLength.toString(10),
      programDataAccountSha256: sha256(programData),
      programDataBinarySha256: sha256(programData.subarray(PROGRAM_DATA_HEADER_BYTES)),
      expectedLastDeployedSlot: DEPLOYED_SLOT.toString(10),
      expectedUpgradeAuthorityAddress: authority,
    },
    market: {
      marketId: 'save-lend-solana-mainnet-main-usdc',
      address: ID.lendingMarketAddress,
      expectedVersion: '1',
      accountDataSha256: sha256(market),
    },
    reserve: {
      address: ID.usdcReserveAddress,
      expectedVersion: '1',
      lendingMarketAddress: ID.lendingMarketAddress,
      liquidityMintAddress: ID.usdcMintAddress,
      accountDataSha256: sha256(reserve),
    },
    asset: {
      stablecoin: 'USDC',
      mintAddress: ID.usdcMintAddress,
      decimals: 6,
      tokenProgramAddress: ID.legacyTokenProgramAddress,
      accountDataSha256: sha256(mint),
    },
  };
}

function envelope(id: number, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

function fixture(authority: string | null = UPGRADE_AUTHORITY): Fixture {
  const accounts = [
    rpcAccount(programBytes(), ID.upgradeableLoaderAddress, true),
    rpcAccount(programDataBytes(authority), ID.upgradeableLoaderAddress, false),
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
    [2, envelope(2, MINIMUM_SLOT)],
    [3, envelope(3, accountResult)],
    [4, envelope(4, blockBefore)],
    [5, envelope(5, SLOT + 1)],
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
    manifest: createSaveLendSolanaManifest(manifestDefinition(accounts, authority)),
    authority,
    transport,
    clock: { now: () => new Date(NOW) },
  };
}

function rebindManifest(value: Fixture): void {
  value.manifest = createSaveLendSolanaManifest(
    manifestDefinition(value.accounts, value.authority),
  );
}

function mutateAccount(value: Fixture, index: number, mutate: (data: Buffer) => void): void {
  const account = value.accounts[index];
  if (!account) throw new Error('fixture account');
  const data = decodeAccount(account);
  mutate(data);
  account.data = [data.toString('base64'), 'base64'];
}

function adapter(value: Fixture): SaveLendSolanaFinalizedTranscriptAdapter {
  return new SaveLendSolanaFinalizedTranscriptAdapter(
    value.manifest,
    value.manifest.manifestFingerprintSha256,
    value.transport,
    value.clock,
  );
}

async function expectUnavailable(value: Fixture): Promise<void> {
  await expect(adapter(value).read(REQUEST)).rejects.toEqual(
    expect.objectContaining({
      name: 'SaveLendSolanaTranscriptUnavailableError',
      code: 'SAVE_LEND_SOLANA_TRANSCRIPT_UNAVAILABLE',
      message: 'Save Lend Solana transcript is unavailable',
    }),
  );
}

function setManifestField(
  manifest: Record<string, unknown>,
  section: string,
  field: string,
  value: unknown,
): void {
  const candidate = manifest[section];
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new Error('fixture manifest section');
  }
  (candidate as Record<string, unknown>)[field] = value;
}

describe('SaveLendSolanaFinalizedTranscriptAdapter', () => {
  it('pins official source snapshots and mainnet identities without shipping a runtime endpoint', () => {
    expect(SOURCE).toEqual(
      expect.objectContaining({
        publicCommitSha: 'b3b46ffbc2f5162b6e5680dd3cad1042c2eb3f8e',
        programCommitSha: 'd04ce00bbf4356c4fd32b3be38eb9760b696bb3e',
        lendingMarketLayout: 'SOLEND_D04CE00B_LENDING_MARKET_PACK_290',
        reserveLayout: 'SOLEND_D04CE00B_RESERVE_PACK_619',
        reserveIdentityEvidence: 'SAVE_PRODUCTION_CONFIG_API_RESEARCH_2026-09-04_UNTRUSTED',
      }),
    );
    expect(ID).toEqual(
      expect.objectContaining({
        programAddress: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo',
        lendingMarketAddress: '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY',
        usdcReserveAddress: 'BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
        usdcMintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      }),
    );
    expect(Object.values(ID).some((candidate) => /^https?:/u.test(candidate))).toBe(false);
  });

  it('canonicalizes and separately fingerprints the complete caller manifest', () => {
    const value = fixture();
    const recreated = createSaveLendSolanaManifest(value.manifest);

    expect(recreated).toEqual(value.manifest);
    expect(recreated.manifestFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(recreated)).toBe(true);
    expect(Object.isFrozen(recreated.deployment)).toBe(true);
    expect(Object.isFrozen(recreated.reserve)).toBe(true);
  });

  it.each([
    [
      'public source pin',
      (manifest: Record<string, unknown>) =>
        setManifestField(manifest, 'sources', 'publicCommitSha', 'a'.repeat(40)),
    ],
    [
      'program source pin',
      (manifest: Record<string, unknown>) =>
        setManifestField(manifest, 'sources', 'programCommitSha', 'b'.repeat(40)),
    ],
    [
      'reserve evidence label',
      (manifest: Record<string, unknown>) =>
        setManifestField(manifest, 'sources', 'reserveIdentityEvidence', 'LIVE_API'),
    ],
    [
      'asset registry fingerprint',
      (manifest: Record<string, unknown>) =>
        setManifestField(manifest, 'assetRegistry', 'fingerprintSha256', 'a'.repeat(64)),
    ],
    ['network', (manifest: Record<string, unknown>) => (manifest.networkId = 'solana:devnet')],
    ['commitment', (manifest: Record<string, unknown>) => (manifest.commitment = 'confirmed')],
    ['time bound', (manifest: Record<string, unknown>) => (manifest.maximumAgeSeconds = '3601')],
    ['slot bound', (manifest: Record<string, unknown>) => (manifest.maximumReserveSlotLag = '1')],
    [
      'noncanonical integer',
      (manifest: Record<string, unknown>) => (manifest.maximumReserveSlotLag = '05'),
    ],
    [
      'program identity',
      (manifest: Record<string, unknown>) =>
        setManifestField(manifest, 'deployment', 'programAddress', ID.lendingMarketAddress),
    ],
    [
      'zero hash',
      (manifest: Record<string, unknown>) =>
        setManifestField(manifest, 'market', 'accountDataSha256', '0'.repeat(64)),
    ],
    [
      'reserve identity',
      (manifest: Record<string, unknown>) =>
        setManifestField(manifest, 'reserve', 'address', ID.lendingMarketAddress),
    ],
    [
      'future market layout version',
      (manifest: Record<string, unknown>) =>
        setManifestField(manifest, 'market', 'expectedVersion', '2'),
    ],
    [
      'future reserve layout version',
      (manifest: Record<string, unknown>) =>
        setManifestField(manifest, 'reserve', 'expectedVersion', '2'),
    ],
    [
      'asset decimals',
      (manifest: Record<string, unknown>) => setManifestField(manifest, 'asset', 'decimals', 9),
    ],
  ])('rejects manifest substitution: %s', (_name, mutate) => {
    const value = fixture();
    const manifest = structuredClone(value.manifest) as unknown as Record<string, unknown>;
    delete manifest.manifestFingerprintSha256;
    mutate(manifest);

    expect(() => createSaveLendSolanaManifest(manifest)).toThrow(
      SaveLendSolanaTranscriptUnavailableError,
    );
  });

  it('rejects extra manifest fields and a stale embedded fingerprint', () => {
    const value = fixture();
    expect(() =>
      createSaveLendSolanaManifest({ ...value.manifest, endpoint: 'https://not-allowed.invalid' }),
    ).toThrow(SaveLendSolanaTranscriptUnavailableError);
    expect(() =>
      createSaveLendSolanaManifest({
        ...value.manifest,
        manifestFingerprintSha256: 'a'.repeat(64),
      }),
    ).toThrow(SaveLendSolanaTranscriptUnavailableError);
  });

  it('rejects manifest accessors without invoking them', () => {
    let invoked = false;
    const manifest = manifestDefinition(fixture().accounts, UPGRADE_AUTHORITY) as Record<
      string,
      unknown
    >;
    Object.defineProperty(manifest, 'networkId', {
      enumerable: true,
      get: () => {
        invoked = true;
        return ID.networkId;
      },
    });

    expect(() => createSaveLendSolanaManifest(manifest)).toThrow(
      SaveLendSolanaTranscriptUnavailableError,
    );
    expect(invoked).toBe(false);
  });

  it('requires the manifest fingerprint through a separate constructor argument', () => {
    const value = fixture();
    expect(
      () =>
        new SaveLendSolanaFinalizedTranscriptAdapter(
          value.manifest,
          'a'.repeat(64),
          value.transport,
          value.clock,
        ),
    ).toThrow(SaveLendSolanaTranscriptUnavailableError);
  });

  it('returns only dormant raw evidence from one finalized account snapshot', async () => {
    const value = fixture();
    const result = await adapter(value).read(REQUEST);

    expect(result).toEqual(
      expect.objectContaining({
        sourceId: 'SAVE_LEND_SOLANA_FINALIZED_JSON_RPC_TRANSCRIPT',
        providerId: 'save',
        protocolId: 'save-lend',
        networkId: ID.networkId,
        marketId: 'save-lend-solana-mainnet-main-usdc',
        sourceFinality: 'SOLANA_FINALIZED_SLOT',
        sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT',
        yieldEvidenceStatus: 'ABSENT_NOT_COMPUTED',
        liquidityEvidenceStatus: 'RAW_AVAILABLE_AMOUNT_ONLY_NOT_CAPACITY',
        mayPersist: false,
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
      }),
    );
    expect(result.snapshot).toEqual(
      expect.objectContaining({
        minimumContextSlot: MINIMUM_SLOT.toString(10),
        slot: SLOT.toString(10),
        finalizedProgressAfter: (SLOT + 1).toString(10),
      }),
    );
    expect(result.market).toEqual(
      expect.objectContaining({
        address: ID.lendingMarketAddress,
        version: '1',
        ownerAuthorityAddress: UPGRADE_AUTHORITY,
        riskAuthorityAddress: ID.lendingMarketAddress,
        tokenProgramAddress: ID.legacyTokenProgramAddress,
      }),
    );
    expect(result.reserve).toEqual(
      expect.objectContaining({
        address: ID.usdcReserveAddress,
        lastUpdateSlot: SLOT.toString(10),
        lastUpdateSlotLag: '0',
        staleFlag: false,
        liquidityAvailableAmountAtomicRaw: '2000000',
        liquidityBorrowedAmountWadsRaw: ((1n << 80n) + 123n).toString(10),
        collateralMintTotalSupplyAtomicRaw: '3000000',
        depositLimitAtomicRaw: '10000000000',
        borrowLimitAtomicRaw: '8000000000',
      }),
    );
    expect(result.asset).toEqual(
      expect.objectContaining({
        stablecoin: 'USDC',
        decimals: 6,
        initialized: true,
        supplyAtomicRaw: '50000000000',
      }),
    );
    expect(result.observedAt).toBe(NOW.toISOString());
    expect(result.staleAfter).toBe(new Date((NOW_SECONDS + 50) * 1_000).toISOString());
    expect(result.transcriptFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reserve)).toBe(true);
  });

  it('issues the exact bounded seven-call transcript with one ordered account request', async () => {
    const value = fixture();
    await adapter(value).read(REQUEST);

    expect(value.transport.calls).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'getSlot', params: [{ commitment: 'finalized' }] },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'getMultipleAccounts',
        params: [
          [
            ID.programAddress,
            PROGRAM_DATA_ADDRESS,
            ID.lendingMarketAddress,
            ID.usdcReserveAddress,
            ID.usdcMintAddress,
          ],
          { commitment: 'finalized', encoding: 'base64', minContextSlot: MINIMUM_SLOT },
        ],
      },
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'getBlock',
        params: [SLOT, { commitment: 'finalized', transactionDetails: 'none', rewards: false }],
      },
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'getSlot',
        params: [{ commitment: 'finalized', minContextSlot: SLOT }],
      },
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'getBlock',
        params: [SLOT, { commitment: 'finalized', transactionDetails: 'none', rewards: false }],
      },
      { jsonrpc: '2.0', id: 7, method: 'getGenesisHash', params: [] },
    ]);
    expect(value.transport.calls.every(Object.isFrozen)).toBe(true);
    expect(value.transport.calls.every((call) => Object.isFrozen(call.params))).toBe(true);
  });

  it('reports a caller-pinned revoked authority without treating it as authenticity', async () => {
    const value = fixture(null);
    const result = await adapter(value).read(REQUEST);

    expect(result.deployment.upgradeAuthorityAddress).toBeNull();
    expect(result.deployment.upgradeAuthorityStatus).toBe('REVOKED_CALLER_PINNED');
    expect(result.sourceAuthenticity).toBe('UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT');
    expect(result.mayPersist).toBe(false);
  });

  it.each([
    ['marketId', 'other-market'],
    ['programAddress', ID.lendingMarketAddress],
    ['lendingMarketAddress', ID.usdcReserveAddress],
    ['reserveAddress', ID.lendingMarketAddress],
    ['assetMintAddress', ID.usdcReserveAddress],
  ] as const)('rejects a mismatched request %s before transport', async (key, replacement) => {
    const value = fixture();
    await expect(
      adapter(value).read({
        ...REQUEST,
        [key]: replacement,
      } as ReadSaveLendSolanaTranscriptRequest),
    ).rejects.toBeInstanceOf(SaveLendSolanaTranscriptUnavailableError);
    expect(value.transport.calls).toHaveLength(0);
  });

  it('rejects extra request fields before transport', async () => {
    const value = fixture();
    await expect(
      adapter(value).read({
        ...REQUEST,
        endpoint: 'forbidden',
      } as unknown as ReadSaveLendSolanaTranscriptRequest),
    ).rejects.toBeInstanceOf(SaveLendSolanaTranscriptUnavailableError);
    expect(value.transport.calls).toHaveLength(0);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])(
    'sanitizes transport failure at transcript call %i',
    async (id) => {
      const value = fixture();
      value.transport.throwAtId = id;

      await expectUnavailable(value);
    },
  );

  it.each([
    ['wrong genesis', 1, envelope(1, ID.lendingMarketAddress)],
    ['changed final genesis', 7, envelope(7, ID.lendingMarketAddress)],
    ['wrong response id', 2, envelope(99, MINIMUM_SLOT)],
    ['error envelope', 2, { jsonrpc: '2.0', id: 2, error: { code: -1, message: 'secret' } }],
    ['extra envelope field', 2, { jsonrpc: '2.0', id: 2, result: MINIMUM_SLOT, extra: true }],
    ['float slot', 2, envelope(2, 1.5)],
  ] as const)('fails closed for malformed RPC evidence: %s', async (_name, id, response) => {
    const value = fixture();
    value.responses.set(id, response);
    await expectUnavailable(value);
  });

  it('rejects cyclic and accessor-bearing RPC objects without invoking accessors', async () => {
    const cyclic: Record<string, unknown> = { jsonrpc: '2.0', id: 2 };
    cyclic.result = cyclic;
    const cyclicFixture = fixture();
    cyclicFixture.responses.set(2, cyclic);
    await expectUnavailable(cyclicFixture);

    let invoked = false;
    const accessor = { jsonrpc: '2.0', id: 2 } as Record<string, unknown>;
    Object.defineProperty(accessor, 'result', {
      enumerable: true,
      get: () => {
        invoked = true;
        return MINIMUM_SLOT;
      },
    });
    const accessorFixture = fixture();
    accessorFixture.responses.set(2, accessor);
    await expectUnavailable(accessorFixture);
    expect(invoked).toBe(false);
  });

  it.each([
    [
      'context before requested minimum',
      (value: Fixture) => (value.accountResult.context.slot = MINIMUM_SLOT - 1),
    ],
    [
      'invalid API version',
      (value: Fixture) => (value.accountResult.context.apiVersion = 'latest'),
    ],
    ['null account', (value: Fixture) => (value.accountResult.value[2] = null)],
    ['missing account', (value: Fixture) => value.accountResult.value.pop()],
    ['extra account', (value: Fixture) => value.accountResult.value.push(value.accounts[4]!)],
    ['wrong program owner', (value: Fixture) => (value.accounts[0]!.owner = ID.programAddress)],
    ['program not executable', (value: Fixture) => (value.accounts[0]!.executable = false)],
    ['data account executable', (value: Fixture) => (value.accounts[1]!.executable = true)],
    [
      'wrong market owner',
      (value: Fixture) => (value.accounts[2]!.owner = ID.upgradeableLoaderAddress),
    ],
    ['wrong mint owner', (value: Fixture) => (value.accounts[4]!.owner = ID.programAddress)],
    ['wrong account space', (value: Fixture) => (value.accounts[3]!.space = RESERVE_BYTES - 1)],
    ['zero lamports', (value: Fixture) => (value.accounts[3]!.lamports = 0)],
    [
      'unsafe rent epoch',
      (value: Fixture) => (value.accounts[3]!.rentEpoch = Number.MAX_SAFE_INTEGER + 1),
    ],
  ])('rejects invalid account snapshot metadata: %s', async (_name, mutate) => {
    const value = fixture();
    mutate(value);
    await expectUnavailable(value);
  });

  it('requires canonical base64 and exact packed account lengths', async () => {
    const noncanonical = fixture();
    noncanonical.accounts[3]!.data[0] += '\n';
    await expectUnavailable(noncanonical);

    const wrongLength = fixture();
    const reserve = decodeAccount(wrongLength.accounts[3]!);
    const shorter = reserve.subarray(0, reserve.byteLength - 1);
    wrongLength.accounts[3]!.data = [shorter.toString('base64'), 'base64'];
    wrongLength.accounts[3]!.space = shorter.byteLength;
    await expectUnavailable(wrongLength);
  });

  it.each([0, 1, 2, 3, 4])(
    'requires every caller-bound account fingerprint at index %i',
    async (index) => {
      const value = fixture();
      mutateAccount(value, index, (data) => {
        const last = data.byteLength - 1;
        data[last] = (data[last] ?? 0) ^ 1;
      });
      await expectUnavailable(value);
    },
  );

  it.each([
    ['wrong loader variant', (data: Buffer) => data.writeUInt32LE(1, 0)],
    ['wrong ProgramData link', (data: Buffer) => writeKey(data, 4, ID.lendingMarketAddress)],
  ])('rejects invalid upgradeable Program state: %s', async (_name, mutate) => {
    const value = fixture();
    mutateAccount(value, 0, mutate);
    rebindManifest(value);
    await expectUnavailable(value);
  });

  it.each([
    ['wrong ProgramData variant', (data: Buffer) => data.writeUInt32LE(2, 0)],
    [
      'missing ELF marker',
      (data: Buffer) => data.fill(0, PROGRAM_DATA_HEADER_BYTES, PROGRAM_DATA_HEADER_BYTES + 4),
    ],
    ['zero deployment slot', (data: Buffer) => data.writeBigUInt64LE(0n, 4)],
    ['future deployment slot', (data: Buffer) => data.writeBigUInt64LE(BigInt(SLOT + 1), 4)],
    ['invalid authority option', (data: Buffer) => (data[12] = 2)],
    ['authority substitution', (data: Buffer) => writeKey(data, 13, ID.lendingMarketAddress)],
  ])('rejects invalid ProgramData state: %s', async (_name, mutate) => {
    const value = fixture();
    mutateAccount(value, 1, mutate);
    rebindManifest(value);
    await expectUnavailable(value);
  });

  it('binds both the full ProgramData account and its code region independently', async () => {
    const value = fixture();
    const definition = manifestDefinition(value.accounts, value.authority);
    const rebound = createSaveLendSolanaManifest({
      ...definition,
      deployment: {
        ...definition.deployment,
        programDataBinarySha256: 'a'.repeat(64),
      },
    });

    await expect(
      new SaveLendSolanaFinalizedTranscriptAdapter(
        rebound,
        rebound.manifestFingerprintSha256,
        value.transport,
        value.clock,
      ).read(REQUEST),
    ).rejects.toBeInstanceOf(SaveLendSolanaTranscriptUnavailableError);
  });

  it.each([
    ['uninitialized version', (data: Buffer) => (data[0] = 0)],
    ['unexpected version', (data: Buffer) => (data[0] = 2)],
    ['zero owner authority', (data: Buffer) => data.fill(0, 2, 34)],
    ['wrong token program', (data: Buffer) => writeKey(data, 66, ID.lendingMarketAddress)],
  ])('rejects invalid 290-byte lending-market state: %s', async (_name, mutate) => {
    const value = fixture();
    mutateAccount(value, 2, mutate);
    rebindManifest(value);
    await expectUnavailable(value);
  });

  it('applies the pinned program fallback from a zero risk authority to the owner', async () => {
    const value = fixture();
    mutateAccount(value, 2, (data) => data.fill(0, 250, 282));
    rebindManifest(value);

    const result = await adapter(value).read(REQUEST);
    expect(result.market.riskAuthorityAddress).toBe(UPGRADE_AUTHORITY);
  });

  it.each([
    ['uninitialized version', (data: Buffer) => (data[0] = 0)],
    ['unexpected version', (data: Buffer) => (data[0] = 2)],
    ['stale flag', (data: Buffer) => (data[9] = 1)],
    ['invalid stale flag', (data: Buffer) => (data[9] = 2)],
    ['zero update slot', (data: Buffer) => data.writeBigUInt64LE(0n, 1)],
    ['future update slot', (data: Buffer) => data.writeBigUInt64LE(BigInt(SLOT + 1), 1)],
    ['excess update lag', (data: Buffer) => data.writeBigUInt64LE(BigInt(SLOT - 1), 1)],
    ['wrong market link', (data: Buffer) => writeKey(data, 10, ID.usdcReserveAddress)],
    ['wrong liquidity mint', (data: Buffer) => writeKey(data, 42, ID.lendingMarketAddress)],
    ['wrong mint decimals', (data: Buffer) => (data[74] = 9)],
    ['invalid reserve type', (data: Buffer) => (data[469] = 2)],
    ['invalid extra-price option', (data: Buffer) => (data[521] = 2)],
  ])('rejects invalid 619-byte reserve state: %s', async (_name, mutate) => {
    const value = fixture();
    mutateAccount(value, 3, mutate);
    rebindManifest(value);
    await expectUnavailable(value);
  });

  it('permits zero raw limits without converting them into capacity claims', async () => {
    const value = fixture();
    mutateAccount(value, 3, (data) => {
      data.writeBigUInt64LE(0n, 323);
      data.writeBigUInt64LE(0n, 331);
    });
    rebindManifest(value);

    const result = await adapter(value).read(REQUEST);
    expect(result.reserve.depositLimitAtomicRaw).toBe('0');
    expect(result.reserve.borrowLimitAtomicRaw).toBe('0');
    expect(result.liquidityEvidenceStatus).toBe('RAW_AVAILABLE_AMOUNT_ONLY_NOT_CAPACITY');
  });

  it.each([
    ['zero supply', (data: Buffer) => data.writeBigUInt64LE(0n, 36)],
    ['wrong decimals', (data: Buffer) => (data[44] = 9)],
    ['uninitialized mint', (data: Buffer) => (data[45] = 0)],
    ['invalid mint-authority COption', (data: Buffer) => data.writeUInt32LE(2, 0)],
    ['invalid freeze-authority COption', (data: Buffer) => data.writeUInt32LE(2, 46)],
  ])('rejects invalid 82-byte SPL mint state: %s', async (_name, mutate) => {
    const value = fixture();
    mutateAccount(value, 4, mutate);
    rebindManifest(value);
    await expectUnavailable(value);
  });

  it('requires COption None padding to be zero', async () => {
    const value = fixture();
    mutateAccount(value, 4, (data) => {
      data.writeUInt32LE(0, 0);
      data[4] = 1;
    });
    rebindManifest(value);
    await expectUnavailable(value);
  });

  it.each([
    [
      'snapshot progress regressed',
      (value: Fixture) => value.responses.set(5, envelope(5, SLOT - 1)),
    ],
    ['null block height', (value: Fixture) => (value.blockBefore.blockHeight = null)],
    ['null block time', (value: Fixture) => (value.blockBefore.blockTime = null)],
    ['parent equals snapshot', (value: Fixture) => (value.blockBefore.parentSlot = SLOT)],
    [
      'same current and previous hash',
      (value: Fixture) => (value.blockBefore.previousBlockhash = value.blockBefore.blockhash),
    ],
    [
      'nonempty transactions',
      (value: Fixture) =>
        value.responses.set(4, envelope(4, { ...value.blockBefore, transactions: [{}] })),
    ],
    [
      'unexpected block field',
      (value: Fixture) => value.responses.set(4, envelope(4, { ...value.blockBefore, slot: SLOT })),
    ],
  ])('rejects incomplete or inconsistent finalized block evidence: %s', async (_name, mutate) => {
    const value = fixture();
    mutate(value);
    await expectUnavailable(value);
  });

  it.each(['blockhash', 'previousBlockhash', 'parentSlot', 'blockHeight', 'blockTime'] as const)(
    'detects a changed %s when the same finalized block is re-read',
    async (key) => {
      const value = fixture();
      const replacement =
        key === 'blockhash'
          ? ID.usdcMintAddress
          : key === 'previousBlockhash'
            ? ID.usdcMintAddress
            : Number(value.blockAfter[key]) - 1;
      value.blockAfter[key] = replacement as never;
      await expectUnavailable(value);
    },
  );

  it('rejects a block timestamp in the future and at the exact stale boundary', async () => {
    const future = fixture();
    future.blockBefore.blockTime = NOW_SECONDS + 1;
    future.blockAfter.blockTime = NOW_SECONDS + 1;
    await expectUnavailable(future);

    const stale = fixture();
    stale.blockBefore.blockTime = NOW_SECONDS - 60;
    stale.blockAfter.blockTime = NOW_SECONDS - 60;
    await expectUnavailable(stale);
  });

  it.each([
    ['invalid Date', () => new Date(Number.NaN)],
    [
      'Date subclass',
      () => {
        class HostileDate extends Date {}
        return new HostileDate(NOW);
      },
    ],
    ['Date proxy', () => new Proxy(new Date(NOW), {})],
  ] as const)('rejects a hostile clock value: %s', async (_name, clockValue) => {
    const value = fixture();
    value.clock = { now: clockValue };
    await expectUnavailable(value);
  });

  it('uses intrinsic Date methods instead of hostile own overrides', async () => {
    const value = fixture();
    const date = new Date(NOW) as Date & {
      getTime: () => number;
      toISOString: () => string;
    };
    date.getTime = () => {
      throw new Error('must not run');
    };
    date.toISOString = () => {
      throw new Error('must not run');
    };
    value.clock = { now: () => date };

    await expect(adapter(value).read(REQUEST)).resolves.toEqual(
      expect.objectContaining({ observedAt: NOW.toISOString() }),
    );
  });

  it('produces a stable fingerprint for identical evidence and changes it with observation time', async () => {
    const left = fixture();
    const right = fixture();
    const first = await adapter(left).read(REQUEST);
    const second = await adapter(right).read(REQUEST);
    expect(second.transcriptFingerprintSha256).toBe(first.transcriptFingerprintSha256);

    const later = fixture();
    later.clock = { now: () => new Date(NOW.getTime() + 1_000) };
    const third = await adapter(later).read(REQUEST);
    expect(third.transcriptFingerprintSha256).not.toBe(first.transcriptFingerprintSha256);
  });
});
