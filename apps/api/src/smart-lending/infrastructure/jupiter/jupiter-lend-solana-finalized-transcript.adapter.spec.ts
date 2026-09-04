import { createHash } from 'node:crypto';

import { PublicKey } from '@solana/web3.js';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import {
  createJupiterLendSolanaManifest,
  JUPITER_LEND_SOLANA_MAINNET_IDENTITIES as ID,
  JUPITER_LEND_SOLANA_SOURCE_PINS as SOURCE,
  JupiterLendSolanaFinalizedTranscriptAdapter,
  type JupiterLendSolanaJsonRpcRequest,
  type JupiterLendSolanaJsonRpcTranscriptTransport,
  type JupiterLendSolanaManifest,
  type JupiterLendSolanaTranscriptClock,
  JupiterLendSolanaTranscriptUnavailableError,
  type ReadJupiterLendSolanaTranscriptRequest,
} from './jupiter-lend-solana-finalized-transcript.adapter';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const NOW_SECONDS = 1_788_523_200;
const MINIMUM_SLOT = 999_995;
const SLOT = 1_000_000;
const DEPLOYED_SLOT = 900_000;
const PROGRAM_DATA_ADDRESS = 'BPFLoader2111111111111111111111111111111111';
const UPGRADE_AUTHORITY = 'Config1111111111111111111111111111111111111';
const F_TOKEN_MINT_AUTHORITY = 'Stake11111111111111111111111111111111111111';
const PROGRAM_DATA_HEADER_BYTES = 45;
const LENDING_BYTES = 196;
const MINT_BYTES = 82;

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
  manifest: JupiterLendSolanaManifest;
  authority: string | null;
  transport: FakeTransport;
  clock: JupiterLendSolanaTranscriptClock;
}

interface MutableManifestRecord extends Record<string, unknown> {
  sources: Record<string, unknown>;
  assetRegistry: Record<string, unknown>;
  deployment: Record<string, unknown>;
  market: Record<string, unknown>;
  asset: Record<string, unknown>;
}

const REQUEST: ReadJupiterLendSolanaTranscriptRequest = Object.freeze({
  marketId: 'jupiter-lend-solana-mainnet-usdc-earn',
  programAddress: ID.earnProgramAddress,
  lendingAddress: ID.usdcLendingAddress,
  assetMintAddress: ID.usdcMintAddress,
  receiptMintAddress: ID.usdcFTokenMintAddress,
});

class FakeTransport implements JupiterLendSolanaJsonRpcTranscriptTransport {
  readonly calls: JupiterLendSolanaJsonRpcRequest[] = [];
  throwAtId: number | undefined;

  constructor(readonly responses: Map<number, unknown>) {}

  async exchange(request: JupiterLendSolanaJsonRpcRequest): Promise<unknown> {
    this.calls.push(request);
    if (request.id === this.throwAtId) throw new Error('private upstream failure');
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

function lendingBytes(): Buffer {
  const data = Buffer.alloc(LENDING_BYTES);
  data.set([135, 199, 82, 16, 249, 131, 182, 241], 0);
  writeKey(data, 8, ID.usdcMintAddress);
  writeKey(data, 40, ID.usdcFTokenMintAddress);
  data.writeUInt16LE(1, 72);
  data[74] = 6;
  writeKey(data, 75, ID.usdcRewardsRateModelAddress);
  data.writeBigUInt64LE(1_000_000_000_000n, 107);
  data.writeBigUInt64LE(1_010_000_000_000n, 115);
  data.writeBigUInt64LE(BigInt(NOW_SECONDS - 5), 123);
  writeKey(data, 131, ID.usdcTokenReserveAddress);
  writeKey(data, 163, ID.usdcSupplyPositionAddress);
  data[195] = 255;
  return data;
}

function mintBytes(
  supply: bigint,
  mintAuthority: string | null,
  freezeAuthority: string | null,
): Buffer {
  const data = Buffer.alloc(MINT_BYTES);
  writeCOptionKey(data, 0, mintAuthority);
  data.writeBigUInt64LE(supply, 36);
  data[44] = 6;
  data[45] = 1;
  writeCOptionKey(data, 46, freezeAuthority);
  return data;
}

function writeCOptionKey(data: Buffer, offset: number, address: string | null): void {
  if (address === null) {
    data.writeUInt32LE(0, offset);
    data.fill(0, offset + 4, offset + 36);
  } else {
    data.writeUInt32LE(1, offset);
    writeKey(data, offset + 4, address);
  }
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

function sourceDefinition(): JupiterLendSolanaManifest['sources'] {
  return {
    docsRepository: SOURCE.docsRepository,
    docsCommitSha: SOURCE.docsCommitSha,
    integrationRepository: SOURCE.integrationRepository,
    integrationCommitSha: SOURCE.integrationCommitSha,
    lendingIdlPath: SOURCE.lendingIdlPath,
    lendingIdlSha256: SOURCE.lendingIdlSha256,
    lendingIdlByteLength: SOURCE.lendingIdlByteLength,
    lendingIdlVersion: SOURCE.lendingIdlVersion,
    readSdkPackage: SOURCE.readSdkPackage,
    readSdkVersion: SOURCE.readSdkVersion,
    readSdkTarballSha256: SOURCE.readSdkTarballSha256,
    readSdkTarballByteLength: SOURCE.readSdkTarballByteLength,
    lendingLayout: SOURCE.lendingLayout,
    loaderLayout: SOURCE.loaderLayout,
    mintLayout: SOURCE.mintLayout,
  };
}

function manifestDefinition(
  accounts: readonly RpcAccount[],
  authority: string | null,
): Omit<JupiterLendSolanaManifest, 'manifestFingerprintSha256'> {
  const programData = accounts[1] ? decodeAccount(accounts[1]) : undefined;
  if (!programData) throw new Error('fixture ProgramData account');
  return {
    schemaVersion: 1,
    use: 'DORMANT_JUPITER_LEND_USDC_EARN_CORROBORATION_ONLY',
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
      programAddress: ID.earnProgramAddress,
      programDataAddress: PROGRAM_DATA_ADDRESS,
      programDataAccountLengthBytes: programData.byteLength.toString(10),
      programDataBinarySha256: sha256(programData.subarray(PROGRAM_DATA_HEADER_BYTES)),
      expectedLastDeployedSlot: DEPLOYED_SLOT.toString(10),
      expectedUpgradeAuthorityAddress: authority,
    },
    market: {
      marketId: 'jupiter-lend-solana-mainnet-usdc-earn',
      lendingAddress: ID.usdcLendingAddress,
      fTokenMintAddress: ID.usdcFTokenMintAddress,
      expectedLendingId: '1',
      expectedFTokenMintAuthorityAddress: F_TOKEN_MINT_AUTHORITY,
      expectedFTokenFreezeAuthorityAddress: null,
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
  const accounts = [
    rpcAccount(programBytes(), ID.upgradeableLoaderAddress, true),
    rpcAccount(programDataBytes(authority), ID.upgradeableLoaderAddress, false),
    rpcAccount(lendingBytes(), ID.earnProgramAddress, false),
    rpcAccount(
      mintBytes(50_000_000_000n, UPGRADE_AUTHORITY, null),
      ID.legacyTokenProgramAddress,
      false,
    ),
    rpcAccount(
      mintBytes(49_000_000_000n, F_TOKEN_MINT_AUTHORITY, null),
      ID.legacyTokenProgramAddress,
      false,
    ),
  ];
  const accountResult: AccountsResult = {
    context: { slot: SLOT, apiVersion: '3.1.8' },
    value: accounts,
  };
  const blockBefore: RpcBlock = {
    blockHeight: 950_000,
    blockTime: NOW_SECONDS - 10,
    blockhash: ID.usdcLendingAddress,
    parentSlot: SLOT - 1,
    previousBlockhash: ID.usdcTokenReserveAddress,
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
    manifest: createJupiterLendSolanaManifest(manifestDefinition(accounts, authority)),
    authority,
    transport,
    clock: { now: () => new Date(NOW) },
  };
}

function mutateAccount(value: Fixture, index: number, mutate: (data: Buffer) => void): void {
  const account = value.accounts[index];
  if (!account) throw new Error('fixture account');
  const data = decodeAccount(account);
  mutate(data);
  account.data = [data.toString('base64'), 'base64'];
}

function adapter(value: Fixture): JupiterLendSolanaFinalizedTranscriptAdapter {
  return new JupiterLendSolanaFinalizedTranscriptAdapter(
    value.manifest,
    value.manifest.manifestFingerprintSha256,
    value.transport,
    value.clock,
  );
}

async function expectUnavailable(value: Fixture): Promise<void> {
  await expect(adapter(value).read(REQUEST)).rejects.toEqual(
    expect.objectContaining({
      name: 'JupiterLendSolanaTranscriptUnavailableError',
      code: 'JUPITER_LEND_SOLANA_TRANSCRIPT_UNAVAILABLE',
      message: 'Jupiter Lend Solana transcript is unavailable',
    }),
  );
}

describe('JupiterLendSolanaFinalizedTranscriptAdapter', () => {
  it('pins the reviewed official source artifacts and PDA identities without an endpoint', () => {
    expect(SOURCE).toEqual(
      expect.objectContaining({
        docsRepository: 'jup-ag/docs',
        docsCommitSha: 'c4b7ee1172ebb1c58407e479e7153bf225690aaf',
        integrationRepository: 'jup-ag/jupiter-lend',
        integrationCommitSha: '33a22cf7a5bfdd32ab1712dda4adfbeb9b348ad9',
        lendingIdlPath: 'target/idl/lending.json',
        lendingIdlSha256: '370f421ba919ed331ba952f0fa8566dcf7ffb3460bb87a7928a04f0422b979e2',
        readSdkPackage: '@jup-ag/lend-read',
        readSdkVersion: '0.0.14',
      }),
    );
    expect(ID).toEqual(
      expect.objectContaining({
        earnProgramAddress: 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9',
        liquidityProgramAddress: 'jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC',
        usdcLendingAddress: '2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ',
        usdcFTokenMintAddress: '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D',
        usdcMintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      }),
    );
    expect(Object.values(ID).some((candidate) => /^https?:/u.test(candidate))).toBe(false);

    const usdc = new PublicKey(ID.usdcMintAddress);
    const earn = new PublicKey(ID.earnProgramAddress);
    const liquidity = new PublicKey(ID.liquidityProgramAddress);
    const rewards = new PublicKey(ID.rewardsRateModelProgramAddress);
    const [fToken] = PublicKey.findProgramAddressSync(
      [Buffer.from('f_token_mint'), usdc.toBuffer()],
      earn,
    );
    const [lending] = PublicKey.findProgramAddressSync(
      [Buffer.from('lending'), usdc.toBuffer(), fToken.toBuffer()],
      earn,
    );
    expect(fToken.toBase58()).toBe(ID.usdcFTokenMintAddress);
    expect(lending.toBase58()).toBe(ID.usdcLendingAddress);
    expect(
      PublicKey.findProgramAddressSync(
        [Buffer.from('reserve'), usdc.toBuffer()],
        liquidity,
      )[0].toBase58(),
    ).toBe(ID.usdcTokenReserveAddress);
    expect(
      PublicKey.findProgramAddressSync(
        [Buffer.from('user_supply_position'), usdc.toBuffer(), lending.toBuffer()],
        liquidity,
      )[0].toBase58(),
    ).toBe(ID.usdcSupplyPositionAddress);
    expect(
      PublicKey.findProgramAddressSync(
        [Buffer.from('lending_rewards_rate_model'), usdc.toBuffer()],
        rewards,
      )[0].toBase58(),
    ).toBe(ID.usdcRewardsRateModelAddress);
  });

  it('canonicalizes, freezes, and separately fingerprints the complete manifest', () => {
    const value = fixture();
    const recreated = createJupiterLendSolanaManifest(value.manifest);

    expect(recreated).toEqual(value.manifest);
    expect(recreated.manifestFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(recreated)).toBe(true);
    expect(Object.isFrozen(recreated.sources)).toBe(true);
    expect(Object.isFrozen(recreated.deployment)).toBe(true);
  });

  it.each([
    [
      'docs repository',
      (manifest: MutableManifestRecord) => (manifest.sources.docsRepository = 'fork/docs'),
    ],
    [
      'docs commit',
      (manifest: MutableManifestRecord) => (manifest.sources.docsCommitSha = 'a'.repeat(40)),
    ],
    [
      'integration repository',
      (manifest: MutableManifestRecord) => (manifest.sources.integrationRepository = 'fork/lend'),
    ],
    [
      'integration commit',
      (manifest: MutableManifestRecord) => (manifest.sources.integrationCommitSha = 'b'.repeat(40)),
    ],
    [
      'IDL path',
      (manifest: MutableManifestRecord) => (manifest.sources.lendingIdlPath = '../other.json'),
    ],
    [
      'IDL hash',
      (manifest: MutableManifestRecord) => (manifest.sources.lendingIdlSha256 = 'a'.repeat(64)),
    ],
    [
      'read SDK package',
      (manifest: MutableManifestRecord) => (manifest.sources.readSdkPackage = '@fork/lend'),
    ],
    [
      'read SDK version',
      (manifest: MutableManifestRecord) => (manifest.sources.readSdkVersion = '0.0.15'),
    ],
    [
      'registry fingerprint',
      (manifest: MutableManifestRecord) =>
        (manifest.assetRegistry.fingerprintSha256 = 'a'.repeat(64)),
    ],
    ['network', (manifest: MutableManifestRecord) => (manifest.networkId = 'solana:devnet')],
    ['genesis', (manifest: MutableManifestRecord) => (manifest.genesisHash = ID.usdcMintAddress)],
    ['commitment', (manifest: MutableManifestRecord) => (manifest.commitment = 'confirmed')],
    ['snapshot binding', (manifest: MutableManifestRecord) => (manifest.snapshotBinding = 'LOOSE')],
    ['zero freshness', (manifest: MutableManifestRecord) => (manifest.maximumAgeSeconds = '0')],
    [
      'excess freshness',
      (manifest: MutableManifestRecord) => (manifest.maximumAgeSeconds = '3601'),
    ],
    [
      'noncanonical freshness',
      (manifest: MutableManifestRecord) => (manifest.maximumAgeSeconds = '060'),
    ],
    [
      'program identity',
      (manifest: MutableManifestRecord) =>
        (manifest.deployment.programAddress = ID.liquidityProgramAddress),
    ],
    [
      'program data collision',
      (manifest: MutableManifestRecord) =>
        (manifest.deployment.programDataAddress = ID.usdcMintAddress),
    ],
    [
      'zero binary hash',
      (manifest: MutableManifestRecord) =>
        (manifest.deployment.programDataBinarySha256 = '0'.repeat(64)),
    ],
    [
      'zero deployed slot',
      (manifest: MutableManifestRecord) => (manifest.deployment.expectedLastDeployedSlot = '0'),
    ],
    [
      'market identity',
      (manifest: MutableManifestRecord) =>
        (manifest.market.lendingAddress = ID.usdcTokenReserveAddress),
    ],
    [
      'receipt identity',
      (manifest: MutableManifestRecord) => (manifest.market.fTokenMintAddress = ID.usdcMintAddress),
    ],
    [
      'zero lending id',
      (manifest: MutableManifestRecord) => (manifest.market.expectedLendingId = '0'),
    ],
    [
      'asset identity',
      (manifest: MutableManifestRecord) => (manifest.asset.mintAddress = ID.usdcFTokenMintAddress),
    ],
    ['asset decimals', (manifest: MutableManifestRecord) => (manifest.asset.decimals = 9)],
  ])('rejects manifest substitution: %s', (_name, mutate) => {
    const value = fixture();
    const manifest = structuredClone(value.manifest) as unknown as MutableManifestRecord;
    delete manifest.manifestFingerprintSha256;
    mutate(manifest);
    expect(() => createJupiterLendSolanaManifest(manifest)).toThrow(
      JupiterLendSolanaTranscriptUnavailableError,
    );
  });

  it('rejects extra fields, stale embedded fingerprints, accessors, and custom prototypes', () => {
    const value = fixture();
    expect(() =>
      createJupiterLendSolanaManifest({ ...value.manifest, endpoint: 'https://forbidden.invalid' }),
    ).toThrow(JupiterLendSolanaTranscriptUnavailableError);
    expect(() =>
      createJupiterLendSolanaManifest({
        ...value.manifest,
        manifestFingerprintSha256: 'a'.repeat(64),
      }),
    ).toThrow(JupiterLendSolanaTranscriptUnavailableError);

    let invoked = false;
    const accessor = manifestDefinition(value.accounts, value.authority) as Record<string, unknown>;
    Object.defineProperty(accessor, 'networkId', {
      enumerable: true,
      get: () => {
        invoked = true;
        return ID.networkId;
      },
    });
    expect(() => createJupiterLendSolanaManifest(accessor)).toThrow(
      JupiterLendSolanaTranscriptUnavailableError,
    );
    expect(invoked).toBe(false);

    const custom = Object.assign(
      Object.create({ inherited: true }),
      manifestDefinition(value.accounts, value.authority),
    );
    expect(() => createJupiterLendSolanaManifest(custom)).toThrow(
      JupiterLendSolanaTranscriptUnavailableError,
    );
  });

  it('requires a separate exact manifest fingerprint and injected plain functions', () => {
    const value = fixture();
    expect(
      () =>
        new JupiterLendSolanaFinalizedTranscriptAdapter(
          value.manifest,
          'a'.repeat(64),
          value.transport,
          value.clock,
        ),
    ).toThrow(JupiterLendSolanaTranscriptUnavailableError);
    expect(
      () =>
        new JupiterLendSolanaFinalizedTranscriptAdapter(
          value.manifest,
          value.manifest.manifestFingerprintSha256,
          {} as JupiterLendSolanaJsonRpcTranscriptTransport,
          value.clock,
        ),
    ).toThrow(JupiterLendSolanaTranscriptUnavailableError);
  });

  it('returns only non-persistable raw exchange-price evidence from one finalized snapshot', async () => {
    const result = await adapter(fixture()).read(REQUEST);

    expect(result).toEqual(
      expect.objectContaining({
        sourceId: 'JUPITER_LEND_SOLANA_FINALIZED_JSON_RPC_TRANSCRIPT',
        providerId: 'jupiter',
        protocolId: 'jupiter-lend',
        networkId: ID.networkId,
        marketId: 'jupiter-lend-solana-mainnet-usdc-earn',
        sourceFinality: 'SOLANA_FINALIZED_SLOT',
        sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED',
        sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT',
        yieldEvidenceStatus: 'RAW_EXCHANGE_PRICES_ONLY_NOT_APR_OR_APY',
        liquidityEvidenceStatus: 'ABSENT_NOT_CAPACITY',
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
        lendingAddress: ID.usdcLendingAddress,
        lendingId: '1',
        liquidityExchangePriceRaw: '1000000000000',
        tokenExchangePriceRaw: '1010000000000',
        lastUpdateTimestamp: (NOW_SECONDS - 5).toString(10),
      }),
    );
    expect(result.asset).toEqual(expect.objectContaining({ stablecoin: 'USDC', decimals: 6 }));
    expect(result.receiptAsset).toEqual(
      expect.objectContaining({ symbol: 'jlUSDC', decimals: 6, supplyAtomicRaw: '49000000000' }),
    );
    expect(result.observedAt).toBe(NOW.toISOString());
    expect(result.staleAfter).toBe(new Date((NOW_SECONDS + 50) * 1_000).toISOString());
    expect(result.transcriptFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.market)).toBe(true);
  });

  it('issues the exact seven-call finalized transcript and one ordered account snapshot', async () => {
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
            ID.earnProgramAddress,
            PROGRAM_DATA_ADDRESS,
            ID.usdcLendingAddress,
            ID.usdcMintAddress,
            ID.usdcFTokenMintAddress,
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

  it('reports a caller-pinned revoked authority without claiming authenticity', async () => {
    const result = await adapter(fixture(null)).read(REQUEST);
    expect(result.deployment.upgradeAuthorityAddress).toBeNull();
    expect(result.deployment.upgradeAuthorityStatus).toBe('REVOKED_CALLER_PINNED');
    expect(result.sourceAuthenticity).toBe('UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT');
  });

  it.each([
    ['marketId', 'other-market'],
    ['programAddress', ID.liquidityProgramAddress],
    ['lendingAddress', ID.usdcTokenReserveAddress],
    ['assetMintAddress', ID.usdcFTokenMintAddress],
    ['receiptMintAddress', ID.usdcMintAddress],
  ] as const)('rejects a mismatched request %s before transport', async (key, replacement) => {
    const value = fixture();
    await expect(
      adapter(value).read({
        ...REQUEST,
        [key]: replacement,
      } as ReadJupiterLendSolanaTranscriptRequest),
    ).rejects.toBeInstanceOf(JupiterLendSolanaTranscriptUnavailableError);
    expect(value.transport.calls).toHaveLength(0);
  });

  it('rejects extra request fields before transport', async () => {
    const value = fixture();
    await expect(
      adapter(value).read({ ...REQUEST, endpoint: 'forbidden' } as never),
    ).rejects.toBeInstanceOf(JupiterLendSolanaTranscriptUnavailableError);
    expect(value.transport.calls).toHaveLength(0);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('sanitizes transport failure at call %i', async (id) => {
    const value = fixture();
    value.transport.throwAtId = id;
    await expectUnavailable(value);
  });

  it.each([
    ['wrong initial genesis', 1, envelope(1, ID.usdcMintAddress)],
    ['wrong final genesis', 7, envelope(7, ID.usdcMintAddress)],
    ['wrong JSON-RPC version', 2, { jsonrpc: '1.0', id: 2, result: MINIMUM_SLOT }],
    ['wrong response id', 2, envelope(99, MINIMUM_SLOT)],
    ['error envelope', 2, { jsonrpc: '2.0', id: 2, error: { code: -1, message: 'secret' } }],
    ['extra envelope field', 2, { jsonrpc: '2.0', id: 2, result: MINIMUM_SLOT, extra: true }],
    ['float slot', 2, envelope(2, 1.5)],
  ] as const)('fails closed for malformed RPC evidence: %s', async (_name, id, response) => {
    const value = fixture();
    value.responses.set(id, response);
    await expectUnavailable(value);
  });

  it('rejects cyclic, custom-prototype, and accessor responses without invoking accessors', async () => {
    const cyclic: Record<string, unknown> = { jsonrpc: '2.0', id: 2 };
    cyclic.result = cyclic;
    const cyclicFixture = fixture();
    cyclicFixture.responses.set(2, cyclic);
    await expectUnavailable(cyclicFixture);

    const customFixture = fixture();
    customFixture.responses.set(
      2,
      Object.assign(Object.create({ inherited: true }), envelope(2, MINIMUM_SLOT)),
    );
    await expectUnavailable(customFixture);

    let invoked = false;
    const accessor: Record<string, unknown> = { jsonrpc: '2.0', id: 2 };
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

  it('rejects byte-, width-, and depth-excessive RPC data before parsing it', async () => {
    const bytes = fixture();
    bytes.responses.set(2, envelope(2, 'x'.repeat(20 * 1024 * 1024 + 1)));
    await expectUnavailable(bytes);

    const width = fixture();
    width.responses.set(2, envelope(2, new Array<unknown>(17).fill(1)));
    await expectUnavailable(width);

    let nested: unknown = 1;
    for (let index = 0; index < 13; index += 1) nested = { nested };
    const depth = fixture();
    depth.responses.set(2, envelope(2, nested));
    await expectUnavailable(depth);
  });

  it.each([
    [
      'context before minimum',
      (value: Fixture) => (value.accountResult.context.slot = MINIMUM_SLOT - 1),
    ],
    [
      'invalid API version',
      (value: Fixture) => (value.accountResult.context.apiVersion = 'latest'),
    ],
    ['null account', (value: Fixture) => (value.accountResult.value[2] = null)],
    ['missing account', (value: Fixture) => value.accountResult.value.pop()],
    ['extra account', (value: Fixture) => value.accountResult.value.push(value.accounts[4]!)],
    ['wrong program owner', (value: Fixture) => (value.accounts[0]!.owner = ID.earnProgramAddress)],
    ['program not executable', (value: Fixture) => (value.accounts[0]!.executable = false)],
    ['ProgramData executable', (value: Fixture) => (value.accounts[1]!.executable = true)],
    [
      'wrong lending owner',
      (value: Fixture) => (value.accounts[2]!.owner = ID.liquidityProgramAddress),
    ],
    ['wrong asset owner', (value: Fixture) => (value.accounts[3]!.owner = ID.earnProgramAddress)],
    ['wrong receipt owner', (value: Fixture) => (value.accounts[4]!.owner = ID.earnProgramAddress)],
    ['wrong account space', (value: Fixture) => (value.accounts[2]!.space = LENDING_BYTES - 1)],
    ['zero lamports', (value: Fixture) => (value.accounts[2]!.lamports = 0)],
    [
      'unsafe rent epoch',
      (value: Fixture) => (value.accounts[2]!.rentEpoch = Number.MAX_SAFE_INTEGER + 1),
    ],
  ])('rejects invalid account snapshot metadata: %s', async (_name, mutate) => {
    const value = fixture();
    mutate(value);
    await expectUnavailable(value);
  });

  it('requires canonical base64 and exact account lengths', async () => {
    const noncanonical = fixture();
    noncanonical.accounts[2]!.data[0] += '\n';
    await expectUnavailable(noncanonical);

    const wrongLength = fixture();
    const data = decodeAccount(wrongLength.accounts[2]!);
    const shorter = data.subarray(0, data.byteLength - 1);
    wrongLength.accounts[2]!.data = [shorter.toString('base64'), 'base64'];
    wrongLength.accounts[2]!.space = shorter.byteLength;
    await expectUnavailable(wrongLength);
  });

  it.each([
    ['wrong loader variant', (data: Buffer) => data.writeUInt32LE(1, 0)],
    ['wrong ProgramData link', (data: Buffer) => writeKey(data, 4, ID.usdcLendingAddress)],
  ])('rejects invalid upgradeable Program state: %s', async (_name, mutate) => {
    const value = fixture();
    mutateAccount(value, 0, mutate);
    await expectUnavailable(value);
  });

  it.each([
    ['wrong ProgramData variant', (data: Buffer) => data.writeUInt32LE(2, 0)],
    [
      'missing ELF marker',
      (data: Buffer) => data.fill(0, PROGRAM_DATA_HEADER_BYTES, PROGRAM_DATA_HEADER_BYTES + 4),
    ],
    ['zero deployed slot', (data: Buffer) => data.writeBigUInt64LE(0n, 4)],
    [
      'unexpected deployed slot',
      (data: Buffer) => data.writeBigUInt64LE(BigInt(DEPLOYED_SLOT - 1), 4),
    ],
    ['future deployed slot', (data: Buffer) => data.writeBigUInt64LE(BigInt(SLOT + 1), 4)],
    ['invalid authority option', (data: Buffer) => (data[12] = 2)],
    ['authority substitution', (data: Buffer) => writeKey(data, 13, ID.usdcLendingAddress)],
    ['binary drift', (data: Buffer) => (data[data.byteLength - 1] = 0x01)],
  ])('rejects invalid or drifted ProgramData: %s', async (_name, mutate) => {
    const value = fixture();
    mutateAccount(value, 1, mutate);
    await expectUnavailable(value);
  });

  it('requires zero authority padding when the upgrade authority is revoked', async () => {
    const value = fixture(null);
    mutateAccount(value, 1, (data) => (data[13] = 1));
    await expectUnavailable(value);
  });

  it.each([
    ['wrong discriminator', (data: Buffer) => (data[0] = 0)],
    ['wrong underlying mint', (data: Buffer) => writeKey(data, 8, ID.usdcFTokenMintAddress)],
    ['wrong receipt mint', (data: Buffer) => writeKey(data, 40, ID.usdcMintAddress)],
    ['zero lending id', (data: Buffer) => data.writeUInt16LE(0, 72)],
    ['unexpected lending id', (data: Buffer) => data.writeUInt16LE(2, 72)],
    ['wrong decimals', (data: Buffer) => (data[74] = 9)],
    ['wrong rewards model', (data: Buffer) => writeKey(data, 75, ID.earnProgramAddress)],
    ['zero liquidity price', (data: Buffer) => data.writeBigUInt64LE(0n, 107)],
    ['zero token price', (data: Buffer) => data.writeBigUInt64LE(0n, 115)],
    ['zero update timestamp', (data: Buffer) => data.writeBigUInt64LE(0n, 123)],
    ['wrong reserve', (data: Buffer) => writeKey(data, 131, ID.usdcMintAddress)],
    ['wrong supply position', (data: Buffer) => writeKey(data, 163, ID.usdcMintAddress)],
    ['wrong bump', (data: Buffer) => (data[195] = 254)],
  ])('rejects invalid official 196-byte Lending layout: %s', async (_name, mutate) => {
    const value = fixture();
    mutateAccount(value, 2, mutate);
    await expectUnavailable(value);
  });

  it.each([3, 4])('rejects invalid packed mint state at account %i', async (index) => {
    for (const mutate of [
      (data: Buffer): void => {
        data.writeBigUInt64LE(0n, 36);
      },
      (data: Buffer): void => {
        data[44] = 9;
      },
      (data: Buffer): void => {
        data[45] = 0;
      },
      (data: Buffer): void => {
        data.writeUInt32LE(2, 0);
      },
      (data: Buffer): void => {
        data.writeUInt32LE(2, 46);
      },
    ]) {
      const value = fixture();
      mutateAccount(value, index, mutate);
      await expectUnavailable(value);
    }
  });

  it('binds receipt mint authorities and rejects dirty None padding', async () => {
    const authority = fixture();
    mutateAccount(authority, 4, (data) => writeKey(data, 4, UPGRADE_AUTHORITY));
    await expectUnavailable(authority);

    const padding = fixture();
    mutateAccount(padding, 4, (data) => (data[50] = 1));
    await expectUnavailable(padding);
  });

  it.each([
    [
      'finalized progress regressed',
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
  ])('rejects incomplete finalized block evidence: %s', async (_name, mutate) => {
    const value = fixture();
    mutate(value);
    await expectUnavailable(value);
  });

  it.each(['blockhash', 'previousBlockhash', 'parentSlot', 'blockHeight', 'blockTime'] as const)(
    'detects changed %s when the selected finalized block is re-read',
    async (key) => {
      const value = fixture();
      const replacement =
        key === 'blockhash' || key === 'previousBlockhash'
          ? ID.usdcMintAddress
          : Number(value.blockAfter[key]) - 1;
      value.blockAfter[key] = replacement as never;
      await expectUnavailable(value);
    },
  );

  it('rejects future/stale block and Lending timestamps at the exclusive boundary', async () => {
    const futureBlock = fixture();
    futureBlock.blockBefore.blockTime = NOW_SECONDS + 1;
    futureBlock.blockAfter.blockTime = NOW_SECONDS + 1;
    await expectUnavailable(futureBlock);

    const staleBlock = fixture();
    staleBlock.blockBefore.blockTime = NOW_SECONDS - 60;
    staleBlock.blockAfter.blockTime = NOW_SECONDS - 60;
    await expectUnavailable(staleBlock);

    const futureLending = fixture();
    mutateAccount(futureLending, 2, (data) => data.writeBigUInt64LE(BigInt(NOW_SECONDS + 1), 123));
    await expectUnavailable(futureLending);

    const staleLending = fixture();
    mutateAccount(staleLending, 2, (data) => data.writeBigUInt64LE(BigInt(NOW_SECONDS - 60), 123));
    await expectUnavailable(staleLending);
  });

  it('accepts one millisecond inside both freshness boundaries', async () => {
    const value = fixture();
    value.clock = { now: () => new Date(NOW_SECONDS * 1_000 - 1) };
    value.blockBefore.blockTime = NOW_SECONDS - 60;
    value.blockAfter.blockTime = NOW_SECONDS - 60;
    mutateAccount(value, 2, (data) => data.writeBigUInt64LE(BigInt(NOW_SECONDS - 60), 123));
    await expect(adapter(value).read(REQUEST)).resolves.toEqual(
      expect.objectContaining({ staleAfter: new Date(NOW_SECONDS * 1_000).toISOString() }),
    );
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
  ] as const)('rejects hostile clock value: %s', async (_name, clockValue) => {
    const value = fixture();
    value.clock = { now: clockValue };
    await expectUnavailable(value);
  });

  it('uses intrinsic Date methods instead of hostile instance overrides', async () => {
    const value = fixture();
    const date = new Date(NOW) as Date & { getTime: () => number; toISOString: () => string };
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

  it('keeps transcript fingerprints deterministic and observation-bound', async () => {
    const first = await adapter(fixture()).read(REQUEST);
    const second = await adapter(fixture()).read(REQUEST);
    expect(second.transcriptFingerprintSha256).toBe(first.transcriptFingerprintSha256);

    const later = fixture();
    later.clock = { now: () => new Date(NOW.getTime() + 1_000) };
    const changed = await adapter(later).read(REQUEST);
    expect(changed.transcriptFingerprintSha256).not.toBe(first.transcriptFingerprintSha256);
  });
});
