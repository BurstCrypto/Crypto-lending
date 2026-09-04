import { createHash } from 'node:crypto';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';

export const MARGINFI_V2_SOLANA_SOURCE_PINS = Object.freeze({
  marginfiV2Repository: '0dotxyz/marginfi-v2',
  marginfiV2CommitSha: '5c97c5efb68a24f68041d2bb7d90917b8dc989e2',
  p0TsSdkRepository: '0dotxyz/p0-ts-sdk',
  p0TsSdkCommitSha: '64773b237961c17e5dacbbf4bfe87b8af22e885b',
  solanaLoaderRepository: 'solana-labs/solana',
  solanaLoaderCommitSha: '7700cb3128c1f19820de67b81aa45d18f73d2ac0',
  splTokenRepository: 'solana-program/token',
  splTokenCommitSha: '0087ca54bd5a5b07e1df7e1b52303529047a1186',
  bankLayout: 'MARGINFI_5C97C5EF_BANK_REPR_C_PAYLOAD_1856_ACCOUNT_1864',
  bankConfigLayout: 'MARGINFI_5C97C5EF_BANK_CONFIG_REPR_C_544',
  bankCacheLayout: 'MARGINFI_5C97C5EF_BANK_CACHE_REPR_C_160',
  groupLayout: 'MARGINFI_5C97C5EF_GROUP_V1_1064_OR_CURRENT_9256_ACCOUNT',
  loaderLayout: 'BPF_UPGRADEABLE_LOADER_V3_BINCODE_PROGRAM_36_PROGRAMDATA_HEADER_45',
  mintLayout: 'SPL_TOKEN_0087CA54_MINT_PACK_82',
  tokenAccountLayout: 'SPL_TOKEN_0087CA54_ACCOUNT_PACK_165',
  bankIdentityEvidence: 'OFFICIAL_MARGINFI_RUST_SDK_DOCS_USDC_BANK_2026-09-04',
} as const);

export const MARGINFI_V2_SOLANA_MAINNET_IDENTITIES = Object.freeze({
  networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  programAddress: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
  mainGroupAddress: '4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8',
  usdcBankAddress: '3uxNepDbmkDNq6JhRja5Z8QwbTrfmkKP8AKZV5chYDGG',
  usdcMintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  liquidityVaultAddress: 'BKkAkaN9hzbY1SUu2kmZQYGm2yfngyjq1p8opdUVtEXU',
  liquidityVaultAuthorityAddress: '6U6X3Xn9gcc4Bu1ubmvMbGmuHwHFR4KgvMzHw9mk5VVT',
  liquidityVaultBump: 252,
  liquidityVaultAuthorityBump: 253,
  insuranceVaultAddress: '72v6pWXgaBx9sFRBC4J2knf1AWwAddFTzW3UvF1FYmUV',
  insuranceVaultAuthorityAddress: '5stbFPAJSgNTZ4M8Q11bMDYjmunTymABKtiuE4kVzTea',
  insuranceVaultBump: 254,
  insuranceVaultAuthorityBump: 255,
  feeVaultAddress: 'CijyE1PABfZE7WUVCmqfGTFkHMV1KpqefvD7WGgr2wdL',
  feeVaultAuthorityAddress: '9yvBHzFpm1EtuhoaP8qo4ZtbWrg5vQqChbrP239DM57Z',
  feeVaultBump: 253,
  feeVaultAuthorityBump: 255,
  upgradeableLoaderAddress: 'BPFLoaderUpgradeab1e11111111111111111111111',
  legacyTokenProgramAddress: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
} as const);

const IDS = MARGINFI_V2_SOLANA_MAINNET_IDENTITIES;
const NETWORK_ID = IDS.networkId;
const GENESIS_HASH = IDS.genesisHash;
const PROGRAM_ADDRESS = IDS.programAddress;
const GROUP_ADDRESS = IDS.mainGroupAddress;
const BANK_ADDRESS = IDS.usdcBankAddress;
const USDC_MINT_ADDRESS = IDS.usdcMintAddress;
const LOADER_ADDRESS = IDS.upgradeableLoaderAddress;
const TOKEN_PROGRAM_ADDRESS = IDS.legacyTokenProgramAddress;
const MARKET_ID = 'marginfi-v2-solana-mainnet-main-usdc' as const;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,19})$/u;
const API_VERSION = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(?:[-+][0-9A-Za-z.-]{1,24})?$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const ZERO_SHA256 = '0'.repeat(64);
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UNIX_SECONDS = 253_402_300_799n;
const MAX_FRESHNESS_SECONDS = 3_600n;
const MIN_ORACLE_MAX_AGE_SECONDS = 10n;
const MAX_PROGRAMDATA_ACCOUNT_BYTES = 10 * 1024 * 1024 + 45;
const PROGRAM_ACCOUNT_BYTES = 36;
const PROGRAMDATA_METADATA_BYTES = 45;
const GROUP_V1_ACCOUNT_BYTES = 1_064;
const GROUP_CURRENT_ACCOUNT_BYTES = 9_256;
const BANK_ACCOUNT_BYTES = 1_864;
const MINT_ACCOUNT_BYTES = 82;
const TOKEN_ACCOUNT_BYTES = 165;
const U64_MAX_JSON_NUMBER = Number(MAX_UINT64);
const ACCOUNT_COUNT = 8;
const ELF_MAGIC = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46]);
const GROUP_DISCRIMINATOR = Uint8Array.from([182, 23, 173, 240, 151, 206, 182, 67]);
const BANK_DISCRIMINATOR = Uint8Array.from([142, 49, 166, 242, 50, 66, 97, 188]);
const KNOWN_BANK_FLAGS_MASK = 8_191n;
const TOKEN_2022_BANK_FLAG = 128n;
const ACCEPTED_EXTERNAL_ORACLE_SETUPS = new Set([3, 4, 18]);

const RESPONSE_BOUNDS = Object.freeze({
  maximumBytes: 24 * 1024 * 1024,
  maximumNodes: 640,
  maximumDepth: 12,
  maximumArrayLength: 20,
});
const MANIFEST_BOUNDS = Object.freeze({
  maximumBytes: 64 * 1024,
  maximumNodes: 320,
  maximumDepth: 10,
  maximumArrayLength: 0,
});
const REQUEST_BOUNDS = Object.freeze({
  maximumBytes: 2 * 1024,
  maximumNodes: 20,
  maximumDepth: 3,
  maximumArrayLength: 0,
});
const REQUIRED_FINGERPRINT_BOUNDS = Object.freeze({
  maximumBytes: 512,
  maximumNodes: 8,
  maximumDepth: 2,
  maximumArrayLength: 0,
});
const BLOCK_KEYS = Object.freeze([
  'blockHeight',
  'blockTime',
  'blockhash',
  'numRewardPartitions',
  'parentSlot',
  'previousBlockhash',
  'rewards',
  'signatures',
  'transactions',
] as const);

export interface MarginfiV2SolanaJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: 'getGenesisHash' | 'getSlot' | 'getMultipleAccounts' | 'getBlock';
  readonly params: readonly unknown[];
}

/** Owns no endpoint, client, credentials, retry, DNS, TLS, or egress configuration. */
export interface MarginfiV2SolanaJsonRpcTranscriptTransport {
  exchange(request: MarginfiV2SolanaJsonRpcRequest): Promise<unknown>;
}

export interface MarginfiV2SolanaTranscriptClock {
  now(): Date;
}

export interface MarginfiV2ManifestDefinition {
  readonly schemaVersion: 1;
  readonly use: 'DORMANT_MARGINFI_V2_USDC_CORROBORATION_ONLY';
  readonly sources: Readonly<{
    readonly marginfiV2CommitSha: string;
    readonly p0TsSdkCommitSha: string;
    readonly solanaLoaderCommitSha: string;
    readonly splTokenCommitSha: string;
    readonly bankLayout: string;
    readonly bankConfigLayout: string;
    readonly bankCacheLayout: string;
    readonly groupLayout: string;
    readonly loaderLayout: string;
    readonly mintLayout: string;
    readonly tokenAccountLayout: string;
    readonly bankIdentityEvidence: string;
  }>;
  readonly assetRegistry: Readonly<{
    readonly environment: 'MAINNET';
    readonly version: 1;
    readonly fingerprintSha256: string;
  }>;
  readonly networkId: typeof NETWORK_ID;
  readonly genesisHash: typeof GENESIS_HASH;
  readonly commitment: 'finalized';
  readonly snapshotBinding: 'ONE_GET_MULTIPLE_ACCOUNTS_MIN_CONTEXT_SLOT';
  readonly maximumAgeSeconds: string;
  readonly deployment: Readonly<{
    readonly programAddress: typeof PROGRAM_ADDRESS;
    readonly programDataAddress: string;
    readonly programAccountDataSha256: string;
    readonly programDataAccountLengthBytes: string;
    readonly programDataAccountSha256: string;
    readonly programDataBinarySha256: string;
    readonly expectedLastDeployedSlot: string;
    readonly expectedUpgradeAuthorityAddress: string | null;
  }>;
  readonly group: Readonly<{
    readonly address: typeof GROUP_ADDRESS;
    readonly accountLengthBytes: '1064' | '9256';
    readonly accountDataSha256: string;
  }>;
  readonly bank: Readonly<{
    readonly address: typeof BANK_ADDRESS;
    readonly groupAddress: typeof GROUP_ADDRESS;
    readonly mintAddress: typeof USDC_MINT_ADDRESS;
    readonly expectedMintDecimals: 6;
    readonly expectedOperationalStateRaw: '1';
    readonly expectedRiskTierRaw: '0';
    readonly expectedAssetTagRaw: '0';
    readonly expectedOracleSetupRaw: string;
    readonly expectedPrimaryOracleAddress: string;
    readonly expectedDepositLimitAtomicRaw: string;
    readonly expectedBorrowLimitAtomicRaw: string;
    readonly expectedOracleMaximumAgeSeconds: string;
    readonly accountDataSha256: string;
  }>;
  readonly asset: Readonly<{
    readonly stablecoin: 'USDC';
    readonly mintAddress: typeof USDC_MINT_ADDRESS;
    readonly decimals: 6;
    readonly tokenProgramAddress: typeof TOKEN_PROGRAM_ADDRESS;
    readonly accountDataSha256: string;
  }>;
  readonly vaults: Readonly<{
    readonly liquidity: MarginfiVaultManifest;
    readonly insurance: MarginfiVaultManifest;
    readonly fee: MarginfiVaultManifest;
  }>;
}

export interface MarginfiVaultManifest {
  readonly address: string;
  readonly authorityAddress: string;
  readonly bump: number;
  readonly authorityBump: number;
  readonly accountDataSha256: string;
}

export interface MarginfiV2Manifest extends MarginfiV2ManifestDefinition {
  readonly sourceFingerprintSha256: string;
  readonly deploymentFingerprintSha256: string;
  readonly manifestFingerprintSha256: string;
}

export interface MarginfiV2RequiredFingerprints {
  readonly sourceFingerprintSha256: string;
  readonly deploymentFingerprintSha256: string;
  readonly manifestFingerprintSha256: string;
}

export interface ReadMarginfiV2SolanaTranscriptRequest {
  readonly marketId: typeof MARKET_ID;
  readonly programAddress: typeof PROGRAM_ADDRESS;
  readonly groupAddress: typeof GROUP_ADDRESS;
  readonly bankAddress: typeof BANK_ADDRESS;
  readonly assetMintAddress: typeof USDC_MINT_ADDRESS;
}

interface VaultEvidence {
  readonly address: string;
  readonly authorityAddress: string;
  readonly state: 'INITIALIZED';
  readonly amountAtomicRaw: string;
  readonly accountDataSha256: string;
}

export interface DormantMarginfiV2SolanaTranscriptCandidate {
  readonly schemaVersion: 1;
  readonly sourceId: 'MARGINFI_V2_SOLANA_FINALIZED_JSON_RPC_TRANSCRIPT';
  readonly use: 'DORMANT_MARGINFI_V2_USDC_CORROBORATION_ONLY';
  readonly providerId: 'marginfi';
  readonly protocolId: 'marginfi-v2';
  readonly networkId: typeof NETWORK_ID;
  readonly marketId: typeof MARKET_ID;
  readonly sourceFingerprintSha256: string;
  readonly deploymentFingerprintSha256: string;
  readonly manifestFingerprintSha256: string;
  readonly transcriptFingerprintSha256: string;
  readonly observedAt: string;
  readonly staleAfter: string;
  readonly sourcePosition: string;
  readonly sourceFinality: 'SOLANA_FINALIZED_SLOT';
  readonly sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED';
  readonly sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT';
  readonly selectionStatus: 'OFFICIAL_PROGRAM_GROUP_BANK_AND_ASSET_PINNED_CALLER_FINGERPRINTS_REQUIRED';
  readonly freshnessStatus: 'CURRENT_WITHIN_CALLER_BLOCK_BANK_AND_CACHE_TIME_BOUNDS';
  readonly oracleEvidenceStatus: 'CURRENT_CACHED_TIMESTAMP_ONLY_NO_ORACLE_ACCOUNT_PROOF';
  readonly yieldEvidenceStatus: 'ABSENT_NOT_COMPUTED';
  readonly liquidityEvidenceStatus: 'RAW_VAULT_AMOUNTS_ONLY_NOT_CAPACITY';
  readonly persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_ORACLE_SOURCE_AND_RISK_VERIFICATION';
  readonly mayPersist: false;
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly snapshot: Readonly<{
    readonly minimumContextSlot: string;
    readonly slot: string;
    readonly finalizedProgressAfter: string;
    readonly blockhash: string;
    readonly previousBlockhash: string;
    readonly parentSlot: string;
    readonly blockHeight: string;
    readonly blockTime: string;
  }>;
  readonly deployment: Readonly<{
    readonly programAddress: typeof PROGRAM_ADDRESS;
    readonly programDataAddress: string;
    readonly programAccountDataSha256: string;
    readonly programDataAccountSha256: string;
    readonly programDataBinarySha256: string;
    readonly programDataAccountLengthBytes: string;
    readonly lastDeployedSlot: string;
    readonly upgradeAuthorityAddress: string | null;
    readonly upgradeAuthorityStatus: 'REVOKED_CALLER_PINNED' | 'PRESENT_CALLER_PINNED';
  }>;
  readonly group: Readonly<{
    readonly address: typeof GROUP_ADDRESS;
    readonly adminAddress: string;
    readonly groupFlagsRaw: string;
    readonly bankCountRaw: string;
    readonly accountLengthBytes: string;
    readonly accountDataSha256: string;
  }>;
  readonly bank: Readonly<{
    readonly address: typeof BANK_ADDRESS;
    readonly groupAddress: typeof GROUP_ADDRESS;
    readonly mintAddress: typeof USDC_MINT_ADDRESS;
    readonly mintDecimals: 6;
    readonly liquidityVaultAddress: typeof IDS.liquidityVaultAddress;
    readonly insuranceVaultAddress: typeof IDS.insuranceVaultAddress;
    readonly feeVaultAddress: typeof IDS.feeVaultAddress;
    readonly operationalStateRaw: '1';
    readonly riskTierRaw: '0';
    readonly assetTagRaw: '0';
    readonly oracleSetupRaw: string;
    readonly primaryOracleAddress: string;
    readonly oracleMaximumAgeSeconds: string;
    readonly lastUpdateUnixSecondsRaw: string;
    readonly lastUpdateAt: string;
    readonly cachedOracleTimestampUnixSecondsRaw: string;
    readonly cachedOracleObservedAt: string;
    readonly assetShareValueI80F48LeHexRaw: string;
    readonly liabilityShareValueI80F48LeHexRaw: string;
    readonly totalAssetSharesI80F48LeHexRaw: string;
    readonly totalLiabilitySharesI80F48LeHexRaw: string;
    readonly cachedOraclePriceI80F48LeHexRaw: string;
    readonly cachedOracleConfidenceI80F48LeHexRaw: string;
    readonly depositLimitAtomicRaw: string;
    readonly borrowLimitAtomicRaw: string;
    readonly bankFlagsRaw: string;
    readonly configFlagsRaw: string;
    readonly lendingPositionCountRaw: string;
    readonly borrowingPositionCountRaw: string;
    readonly circuitBreakerTierRaw: '0';
    readonly accountDataSha256: string;
  }>;
  readonly asset: Readonly<{
    readonly stablecoin: 'USDC';
    readonly mintAddress: typeof USDC_MINT_ADDRESS;
    readonly tokenProgramAddress: typeof TOKEN_PROGRAM_ADDRESS;
    readonly decimals: 6;
    readonly initialized: true;
    readonly supplyAtomicRaw: string;
    readonly mintAuthorityAddress: string | null;
    readonly freezeAuthorityAddress: string | null;
    readonly accountDataSha256: string;
  }>;
  readonly vaults: Readonly<{
    readonly liquidity: VaultEvidence;
    readonly insurance: VaultEvidence;
    readonly fee: VaultEvidence;
  }>;
}

interface ParsedAccount {
  readonly data: Uint8Array;
  readonly dataSha256: string;
}

interface ParsedProgramData {
  readonly lastDeployedSlot: bigint;
  readonly upgradeAuthorityAddress: string | null;
  readonly binarySha256: string;
}

interface ParsedGroup {
  readonly adminAddress: string;
  readonly groupFlags: bigint;
  readonly bankCount: number;
}

interface ParsedBank {
  readonly oracleSetup: number;
  readonly primaryOracleAddress: string;
  readonly oracleMaximumAge: bigint;
  readonly lastUpdate: bigint;
  readonly cachedOracleTimestamp: bigint;
  readonly assetShareValueHex: string;
  readonly liabilityShareValueHex: string;
  readonly totalAssetSharesHex: string;
  readonly totalLiabilitySharesHex: string;
  readonly cachedOraclePriceHex: string;
  readonly cachedOracleConfidenceHex: string;
  readonly depositLimit: bigint;
  readonly borrowLimit: bigint;
  readonly bankFlags: bigint;
  readonly configFlags: number;
  readonly lendingPositionCount: number;
  readonly borrowingPositionCount: number;
}

interface ParsedMint {
  readonly supply: bigint;
  readonly mintAuthorityAddress: string | null;
  readonly freezeAuthorityAddress: string | null;
}

interface ParsedTokenAccount {
  readonly amount: bigint;
}

interface SolanaBlock {
  readonly slot: number;
  readonly blockhash: string;
  readonly previousBlockhash: string;
  readonly parentSlot: number;
  readonly blockHeight: number;
  readonly blockTime: number;
}

interface MultipleAccountsResult {
  readonly slot: number;
  readonly accounts: readonly ParsedAccount[];
}

export class MarginfiV2SolanaTranscriptUnavailableError extends Error {
  readonly code = 'MARGINFI_V2_SOLANA_TRANSCRIPT_UNAVAILABLE' as const;

  constructor() {
    super('Marginfi v2 Solana transcript is unavailable');
    this.name = 'MarginfiV2SolanaTranscriptUnavailableError';
  }
}

export function createMarginfiV2SolanaManifest(value: unknown): MarginfiV2Manifest {
  try {
    assertBoundedData(value, MANIFEST_BOUNDS);
    const raw = dataRecord(value);
    const fingerprintKeys = [
      'sourceFingerprintSha256',
      'deploymentFingerprintSha256',
      'manifestFingerprintSha256',
    ] as const;
    const suppliedFingerprintCount = fingerprintKeys.filter((key) =>
      Object.hasOwn(raw, key),
    ).length;
    if (suppliedFingerprintCount !== 0 && suppliedFingerprintCount !== fingerprintKeys.length) {
      return unavailable();
    }
    const record = exactDataRecord(value, [
      'schemaVersion',
      'use',
      'sources',
      'assetRegistry',
      'networkId',
      'genesisHash',
      'commitment',
      'snapshotBinding',
      'maximumAgeSeconds',
      'deployment',
      'group',
      'bank',
      'asset',
      'vaults',
      ...(suppliedFingerprintCount === fingerprintKeys.length ? fingerprintKeys : []),
    ]);
    if (
      record.schemaVersion !== 1 ||
      record.use !== 'DORMANT_MARGINFI_V2_USDC_CORROBORATION_ONLY' ||
      record.networkId !== NETWORK_ID ||
      record.genesisHash !== GENESIS_HASH ||
      record.commitment !== 'finalized' ||
      record.snapshotBinding !== 'ONE_GET_MULTIPLE_ACCOUNTS_MIN_CONTEXT_SLOT'
    ) {
      return unavailable();
    }

    const sources = parseSources(record.sources);
    const assetRegistry = parseAssetRegistry(record.assetRegistry);
    const maximumAgeSeconds = positiveCanonicalInteger(
      record.maximumAgeSeconds,
      MAX_FRESHNESS_SECONDS,
    ).toString(10);
    const deployment = parseDeployment(record.deployment);
    const group = parseGroupManifest(record.group);
    const bank = parseBankManifest(record.bank);
    const asset = parseAssetManifest(record.asset);
    const vaults = parseVaultsManifest(record.vaults);
    const canonical: MarginfiV2ManifestDefinition = Object.freeze({
      schemaVersion: 1,
      use: 'DORMANT_MARGINFI_V2_USDC_CORROBORATION_ONLY',
      sources,
      assetRegistry,
      networkId: NETWORK_ID,
      genesisHash: GENESIS_HASH,
      commitment: 'finalized',
      snapshotBinding: 'ONE_GET_MULTIPLE_ACCOUNTS_MIN_CONTEXT_SLOT',
      maximumAgeSeconds,
      deployment,
      group,
      bank,
      asset,
      vaults,
    });
    const sourceFingerprintSha256 = fingerprint('crypto-lending:marginfi-v2-solana-source:v1', [
      sources,
      assetRegistry,
      NETWORK_ID,
      GENESIS_HASH,
      Object.freeze({
        programAddress: PROGRAM_ADDRESS,
        groupAddress: GROUP_ADDRESS,
        bankAddress: BANK_ADDRESS,
        mintAddress: USDC_MINT_ADDRESS,
        tokenProgramAddress: TOKEN_PROGRAM_ADDRESS,
        loaderAddress: LOADER_ADDRESS,
        liquidityVaultAddress: IDS.liquidityVaultAddress,
        liquidityVaultAuthorityAddress: IDS.liquidityVaultAuthorityAddress,
        insuranceVaultAddress: IDS.insuranceVaultAddress,
        insuranceVaultAuthorityAddress: IDS.insuranceVaultAuthorityAddress,
        feeVaultAddress: IDS.feeVaultAddress,
        feeVaultAuthorityAddress: IDS.feeVaultAuthorityAddress,
      }),
    ]);
    const deploymentFingerprintSha256 = fingerprint(
      'crypto-lending:marginfi-v2-solana-deployment:v1',
      [deployment, group, bank, asset, vaults],
    );
    const manifestFingerprintSha256 = fingerprint('crypto-lending:marginfi-v2-solana-manifest:v1', [
      canonical,
      sourceFingerprintSha256,
      deploymentFingerprintSha256,
    ]);
    if (
      suppliedFingerprintCount === fingerprintKeys.length &&
      (record.sourceFingerprintSha256 !== sourceFingerprintSha256 ||
        record.deploymentFingerprintSha256 !== deploymentFingerprintSha256 ||
        record.manifestFingerprintSha256 !== manifestFingerprintSha256)
    ) {
      return unavailable();
    }
    return Object.freeze({
      ...canonical,
      sourceFingerprintSha256,
      deploymentFingerprintSha256,
      manifestFingerprintSha256,
    });
  } catch (error) {
    if (error instanceof MarginfiV2SolanaTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

/**
 * Dormant parser for a caller-supplied Solana JSON-RPC transcript. It has no
 * endpoint, client, egress, persistence, recommendation, or action capability,
 * and is intentionally not registered in dependency injection.
 */
export class MarginfiV2SolanaFinalizedTranscriptAdapter {
  private readonly manifest!: MarginfiV2Manifest;

  constructor(
    manifest: unknown,
    requiredFingerprints: unknown,
    private readonly transport: MarginfiV2SolanaJsonRpcTranscriptTransport,
    private readonly clock: MarginfiV2SolanaTranscriptClock,
  ) {
    try {
      this.manifest = createMarginfiV2SolanaManifest(manifest);
      assertBoundedData(requiredFingerprints, REQUIRED_FINGERPRINT_BOUNDS);
      const required = exactDataRecord(requiredFingerprints, [
        'sourceFingerprintSha256',
        'deploymentFingerprintSha256',
        'manifestFingerprintSha256',
      ]);
      for (const value of Object.values(required)) {
        if (typeof value !== 'string' || !SHA256.test(value)) return unavailable();
      }
      if (
        required.sourceFingerprintSha256 !== this.manifest.sourceFingerprintSha256 ||
        required.deploymentFingerprintSha256 !== this.manifest.deploymentFingerprintSha256 ||
        required.manifestFingerprintSha256 !== this.manifest.manifestFingerprintSha256 ||
        typeof transport?.exchange !== 'function' ||
        typeof clock?.now !== 'function'
      ) {
        return unavailable();
      }
    } catch (error) {
      if (error instanceof MarginfiV2SolanaTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }

  async read(
    request: ReadMarginfiV2SolanaTranscriptRequest,
  ): Promise<DormantMarginfiV2SolanaTranscriptCandidate> {
    try {
      assertBoundedData(request, REQUEST_BOUNDS);
      const requested = exactDataRecord(request, [
        'marketId',
        'programAddress',
        'groupAddress',
        'bankAddress',
        'assetMintAddress',
      ]);
      if (
        requested.marketId !== MARKET_ID ||
        requested.programAddress !== PROGRAM_ADDRESS ||
        requested.groupAddress !== GROUP_ADDRESS ||
        requested.bankAddress !== BANK_ADDRESS ||
        requested.assetMintAddress !== USDC_MINT_ADDRESS
      ) {
        return unavailable();
      }

      if ((await this.rpc(1, 'getGenesisHash', [])) !== GENESIS_HASH) return unavailable();
      const minimumContextSlot = parsePositiveSafeInteger(
        await this.rpc(2, 'getSlot', [Object.freeze({ commitment: 'finalized' })]),
      );
      const accountResult = parseMultipleAccountsResult(
        await this.rpc(3, 'getMultipleAccounts', [
          Object.freeze([
            PROGRAM_ADDRESS,
            this.manifest.deployment.programDataAddress,
            GROUP_ADDRESS,
            BANK_ADDRESS,
            USDC_MINT_ADDRESS,
            IDS.liquidityVaultAddress,
            IDS.insuranceVaultAddress,
            IDS.feeVaultAddress,
          ]),
          Object.freeze({
            commitment: 'finalized',
            encoding: 'base64',
            minContextSlot: minimumContextSlot,
          }),
        ]),
        minimumContextSlot,
        this.manifest,
      );
      const [
        programAccount,
        programDataAccount,
        groupAccount,
        bankAccount,
        mintAccount,
        liquidityVaultAccount,
        insuranceVaultAccount,
        feeVaultAccount,
      ] = accountResult.accounts;
      if (
        programAccount === undefined ||
        programDataAccount === undefined ||
        groupAccount === undefined ||
        bankAccount === undefined ||
        mintAccount === undefined ||
        liquidityVaultAccount === undefined ||
        insuranceVaultAccount === undefined ||
        feeVaultAccount === undefined
      ) {
        return unavailable();
      }
      assertAccountFingerprints(
        programAccount,
        programDataAccount,
        groupAccount,
        bankAccount,
        mintAccount,
        liquidityVaultAccount,
        insuranceVaultAccount,
        feeVaultAccount,
        this.manifest,
      );
      parseProgram(programAccount.data, this.manifest.deployment.programDataAddress);
      const programData = parseProgramData(
        programDataAccount.data,
        accountResult.slot,
        this.manifest,
      );
      const group = parseGroup(groupAccount.data);
      const bank = parseBank(bankAccount.data, this.manifest);
      const mint = parseMint(mintAccount.data);
      const liquidityVault = parseTokenAccount(
        liquidityVaultAccount.data,
        IDS.liquidityVaultAuthorityAddress,
      );
      const insuranceVault = parseTokenAccount(
        insuranceVaultAccount.data,
        IDS.insuranceVaultAuthorityAddress,
      );
      const feeVault = parseTokenAccount(feeVaultAccount.data, IDS.feeVaultAuthorityAddress);

      const blockBefore = parseBlock(
        await this.rpc(4, 'getBlock', [
          accountResult.slot,
          Object.freeze({ commitment: 'finalized', transactionDetails: 'none', rewards: false }),
        ]),
        accountResult.slot,
      );
      const finalizedProgressAfter = parsePositiveSafeInteger(
        await this.rpc(5, 'getSlot', [
          Object.freeze({ commitment: 'finalized', minContextSlot: accountResult.slot }),
        ]),
      );
      if (finalizedProgressAfter < accountResult.slot) return unavailable();
      const blockAfter = parseBlock(
        await this.rpc(6, 'getBlock', [
          accountResult.slot,
          Object.freeze({ commitment: 'finalized', transactionDetails: 'none', rewards: false }),
        ]),
        accountResult.slot,
      );
      if (!sameBlock(blockBefore, blockAfter)) return unavailable();
      if ((await this.rpc(7, 'getGenesisHash', [])) !== GENESIS_HASH) return unavailable();

      const now = canonicalClock(this.clock.now());
      const maximumAgeSeconds = BigInt(this.manifest.maximumAgeSeconds);
      const blockTime = BigInt(blockBefore.blockTime);
      if (bank.lastUpdate > blockTime || bank.cachedOracleTimestamp > blockTime) {
        return unavailable();
      }
      assertFresh(blockTime, now.milliseconds, maximumAgeSeconds);
      assertFresh(bank.lastUpdate, now.milliseconds, maximumAgeSeconds);
      const effectiveOracleMaximumAge = minimumBigInt(maximumAgeSeconds, bank.oracleMaximumAge);
      assertFresh(bank.cachedOracleTimestamp, now.milliseconds, effectiveOracleMaximumAge);
      const staleAtSeconds = minimumBigInt(
        blockTime + maximumAgeSeconds,
        bank.lastUpdate + maximumAgeSeconds,
        bank.cachedOracleTimestamp + effectiveOracleMaximumAge,
      );

      const snapshot = Object.freeze({
        minimumContextSlot: minimumContextSlot.toString(10),
        slot: accountResult.slot.toString(10),
        finalizedProgressAfter: finalizedProgressAfter.toString(10),
        blockhash: blockBefore.blockhash,
        previousBlockhash: blockBefore.previousBlockhash,
        parentSlot: blockBefore.parentSlot.toString(10),
        blockHeight: blockBefore.blockHeight.toString(10),
        blockTime: blockBefore.blockTime.toString(10),
      });
      const deployment = Object.freeze({
        programAddress: PROGRAM_ADDRESS,
        programDataAddress: this.manifest.deployment.programDataAddress,
        programAccountDataSha256: programAccount.dataSha256,
        programDataAccountSha256: programDataAccount.dataSha256,
        programDataBinarySha256: programData.binarySha256,
        programDataAccountLengthBytes: programDataAccount.data.byteLength.toString(10),
        lastDeployedSlot: programData.lastDeployedSlot.toString(10),
        upgradeAuthorityAddress: programData.upgradeAuthorityAddress,
        upgradeAuthorityStatus:
          programData.upgradeAuthorityAddress === null
            ? ('REVOKED_CALLER_PINNED' as const)
            : ('PRESENT_CALLER_PINNED' as const),
      });
      const groupOutput = Object.freeze({
        address: GROUP_ADDRESS,
        adminAddress: group.adminAddress,
        groupFlagsRaw: group.groupFlags.toString(10),
        bankCountRaw: group.bankCount.toString(10),
        accountLengthBytes: groupAccount.data.byteLength.toString(10),
        accountDataSha256: groupAccount.dataSha256,
      });
      const bankOutput = Object.freeze({
        address: BANK_ADDRESS,
        groupAddress: GROUP_ADDRESS,
        mintAddress: USDC_MINT_ADDRESS,
        mintDecimals: 6 as const,
        liquidityVaultAddress: IDS.liquidityVaultAddress,
        insuranceVaultAddress: IDS.insuranceVaultAddress,
        feeVaultAddress: IDS.feeVaultAddress,
        operationalStateRaw: '1' as const,
        riskTierRaw: '0' as const,
        assetTagRaw: '0' as const,
        oracleSetupRaw: bank.oracleSetup.toString(10),
        primaryOracleAddress: bank.primaryOracleAddress,
        oracleMaximumAgeSeconds: bank.oracleMaximumAge.toString(10),
        lastUpdateUnixSecondsRaw: bank.lastUpdate.toString(10),
        lastUpdateAt: unixSecondsToTimestamp(bank.lastUpdate),
        cachedOracleTimestampUnixSecondsRaw: bank.cachedOracleTimestamp.toString(10),
        cachedOracleObservedAt: unixSecondsToTimestamp(bank.cachedOracleTimestamp),
        assetShareValueI80F48LeHexRaw: bank.assetShareValueHex,
        liabilityShareValueI80F48LeHexRaw: bank.liabilityShareValueHex,
        totalAssetSharesI80F48LeHexRaw: bank.totalAssetSharesHex,
        totalLiabilitySharesI80F48LeHexRaw: bank.totalLiabilitySharesHex,
        cachedOraclePriceI80F48LeHexRaw: bank.cachedOraclePriceHex,
        cachedOracleConfidenceI80F48LeHexRaw: bank.cachedOracleConfidenceHex,
        depositLimitAtomicRaw: bank.depositLimit.toString(10),
        borrowLimitAtomicRaw: bank.borrowLimit.toString(10),
        bankFlagsRaw: bank.bankFlags.toString(10),
        configFlagsRaw: bank.configFlags.toString(10),
        lendingPositionCountRaw: bank.lendingPositionCount.toString(10),
        borrowingPositionCountRaw: bank.borrowingPositionCount.toString(10),
        circuitBreakerTierRaw: '0' as const,
        accountDataSha256: bankAccount.dataSha256,
      });
      const asset = Object.freeze({
        stablecoin: 'USDC' as const,
        mintAddress: USDC_MINT_ADDRESS,
        tokenProgramAddress: TOKEN_PROGRAM_ADDRESS,
        decimals: 6 as const,
        initialized: true as const,
        supplyAtomicRaw: mint.supply.toString(10),
        mintAuthorityAddress: mint.mintAuthorityAddress,
        freezeAuthorityAddress: mint.freezeAuthorityAddress,
        accountDataSha256: mintAccount.dataSha256,
      });
      const vaults = Object.freeze({
        liquidity: vaultEvidence(
          IDS.liquidityVaultAddress,
          IDS.liquidityVaultAuthorityAddress,
          liquidityVault,
          liquidityVaultAccount,
        ),
        insurance: vaultEvidence(
          IDS.insuranceVaultAddress,
          IDS.insuranceVaultAuthorityAddress,
          insuranceVault,
          insuranceVaultAccount,
        ),
        fee: vaultEvidence(
          IDS.feeVaultAddress,
          IDS.feeVaultAuthorityAddress,
          feeVault,
          feeVaultAccount,
        ),
      });
      return Object.freeze({
        schemaVersion: 1,
        sourceId: 'MARGINFI_V2_SOLANA_FINALIZED_JSON_RPC_TRANSCRIPT',
        use: 'DORMANT_MARGINFI_V2_USDC_CORROBORATION_ONLY',
        providerId: 'marginfi',
        protocolId: 'marginfi-v2',
        networkId: NETWORK_ID,
        marketId: MARKET_ID,
        sourceFingerprintSha256: this.manifest.sourceFingerprintSha256,
        deploymentFingerprintSha256: this.manifest.deploymentFingerprintSha256,
        manifestFingerprintSha256: this.manifest.manifestFingerprintSha256,
        transcriptFingerprintSha256: fingerprint(
          'crypto-lending:marginfi-v2-solana-finalized-transcript:v1',
          [
            this.manifest.sourceFingerprintSha256,
            this.manifest.deploymentFingerprintSha256,
            this.manifest.manifestFingerprintSha256,
            snapshot,
            deployment,
            groupOutput,
            bankOutput,
            asset,
            vaults,
            now.timestamp,
          ],
        ),
        observedAt: now.timestamp,
        staleAfter: unixSecondsToTimestamp(staleAtSeconds),
        sourcePosition: accountResult.slot.toString(10),
        sourceFinality: 'SOLANA_FINALIZED_SLOT',
        sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED',
        sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT',
        selectionStatus:
          'OFFICIAL_PROGRAM_GROUP_BANK_AND_ASSET_PINNED_CALLER_FINGERPRINTS_REQUIRED',
        freshnessStatus: 'CURRENT_WITHIN_CALLER_BLOCK_BANK_AND_CACHE_TIME_BOUNDS',
        oracleEvidenceStatus: 'CURRENT_CACHED_TIMESTAMP_ONLY_NO_ORACLE_ACCOUNT_PROOF',
        yieldEvidenceStatus: 'ABSENT_NOT_COMPUTED',
        liquidityEvidenceStatus: 'RAW_VAULT_AMOUNTS_ONLY_NOT_CAPACITY',
        persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_ORACLE_SOURCE_AND_RISK_VERIFICATION',
        mayPersist: false,
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
        snapshot,
        deployment,
        group: groupOutput,
        bank: bankOutput,
        asset,
        vaults,
      });
    } catch (error) {
      if (error instanceof MarginfiV2SolanaTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }

  private async rpc(
    id: number,
    method: MarginfiV2SolanaJsonRpcRequest['method'],
    params: readonly unknown[],
  ): Promise<unknown> {
    const request = Object.freeze({
      jsonrpc: '2.0' as const,
      id,
      method,
      params: Object.freeze(params),
    });
    let response: unknown;
    try {
      response = await this.transport.exchange(request);
    } catch {
      return unavailable();
    }
    assertBoundedData(response, RESPONSE_BOUNDS);
    const envelope = exactDataRecord(response, ['jsonrpc', 'id', 'result']);
    if (envelope.jsonrpc !== '2.0' || envelope.id !== id) return unavailable();
    return envelope.result;
  }
}

function parseSources(value: unknown): MarginfiV2Manifest['sources'] {
  const record = exactDataRecord(value, [
    'marginfiV2CommitSha',
    'p0TsSdkCommitSha',
    'solanaLoaderCommitSha',
    'splTokenCommitSha',
    'bankLayout',
    'bankConfigLayout',
    'bankCacheLayout',
    'groupLayout',
    'loaderLayout',
    'mintLayout',
    'tokenAccountLayout',
    'bankIdentityEvidence',
  ]);
  const expected = MARGINFI_V2_SOLANA_SOURCE_PINS;
  const commits = [
    record.marginfiV2CommitSha,
    record.p0TsSdkCommitSha,
    record.solanaLoaderCommitSha,
    record.splTokenCommitSha,
  ];
  if (
    commits.some((candidate) => typeof candidate !== 'string' || !COMMIT_SHA.test(candidate)) ||
    record.marginfiV2CommitSha !== expected.marginfiV2CommitSha ||
    record.p0TsSdkCommitSha !== expected.p0TsSdkCommitSha ||
    record.solanaLoaderCommitSha !== expected.solanaLoaderCommitSha ||
    record.splTokenCommitSha !== expected.splTokenCommitSha ||
    record.bankLayout !== expected.bankLayout ||
    record.bankConfigLayout !== expected.bankConfigLayout ||
    record.bankCacheLayout !== expected.bankCacheLayout ||
    record.groupLayout !== expected.groupLayout ||
    record.loaderLayout !== expected.loaderLayout ||
    record.mintLayout !== expected.mintLayout ||
    record.tokenAccountLayout !== expected.tokenAccountLayout ||
    record.bankIdentityEvidence !== expected.bankIdentityEvidence
  ) {
    return unavailable();
  }
  return Object.freeze({
    marginfiV2CommitSha: expected.marginfiV2CommitSha,
    p0TsSdkCommitSha: expected.p0TsSdkCommitSha,
    solanaLoaderCommitSha: expected.solanaLoaderCommitSha,
    splTokenCommitSha: expected.splTokenCommitSha,
    bankLayout: expected.bankLayout,
    bankConfigLayout: expected.bankConfigLayout,
    bankCacheLayout: expected.bankCacheLayout,
    groupLayout: expected.groupLayout,
    loaderLayout: expected.loaderLayout,
    mintLayout: expected.mintLayout,
    tokenAccountLayout: expected.tokenAccountLayout,
    bankIdentityEvidence: expected.bankIdentityEvidence,
  });
}

function parseAssetRegistry(value: unknown): MarginfiV2Manifest['assetRegistry'] {
  const record = exactDataRecord(value, ['environment', 'version', 'fingerprintSha256']);
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  if (
    record.environment !== 'MAINNET' ||
    record.version !== 1 ||
    record.fingerprintSha256 !== registry.fingerprintSha256 ||
    registry.version !== 1 ||
    registry.environment !== 'MAINNET'
  ) {
    return unavailable();
  }
  return Object.freeze({
    environment: 'MAINNET' as const,
    version: 1 as const,
    fingerprintSha256: registry.fingerprintSha256,
  });
}

function parseDeployment(value: unknown): MarginfiV2Manifest['deployment'] {
  const record = exactDataRecord(value, [
    'programAddress',
    'programDataAddress',
    'programAccountDataSha256',
    'programDataAccountLengthBytes',
    'programDataAccountSha256',
    'programDataBinarySha256',
    'expectedLastDeployedSlot',
    'expectedUpgradeAuthorityAddress',
  ]);
  const programDataAddress = publicKey(record.programDataAddress);
  const expectedUpgradeAuthorityAddress =
    record.expectedUpgradeAuthorityAddress === null
      ? null
      : publicKey(record.expectedUpgradeAuthorityAddress);
  const programDataAccountLengthBytes = positiveCanonicalInteger(
    record.programDataAccountLengthBytes,
    BigInt(MAX_PROGRAMDATA_ACCOUNT_BYTES),
  );
  const expectedLastDeployedSlot = positiveCanonicalInteger(
    record.expectedLastDeployedSlot,
    MAX_UINT64,
  );
  const programAccountDataSha256 = nonzeroSha256(record.programAccountDataSha256);
  const programDataAccountSha256 = nonzeroSha256(record.programDataAccountSha256);
  const programDataBinarySha256 = nonzeroSha256(record.programDataBinarySha256);
  if (
    record.programAddress !== PROGRAM_ADDRESS ||
    new Set<string>([PROGRAM_ADDRESS, GROUP_ADDRESS, BANK_ADDRESS, USDC_MINT_ADDRESS]).has(
      programDataAddress,
    ) ||
    programDataAccountLengthBytes <= BigInt(PROGRAMDATA_METADATA_BYTES)
  ) {
    return unavailable();
  }
  return Object.freeze({
    programAddress: PROGRAM_ADDRESS,
    programDataAddress,
    programAccountDataSha256,
    programDataAccountLengthBytes: programDataAccountLengthBytes.toString(10),
    programDataAccountSha256,
    programDataBinarySha256,
    expectedLastDeployedSlot: expectedLastDeployedSlot.toString(10),
    expectedUpgradeAuthorityAddress,
  });
}

function parseGroupManifest(value: unknown): MarginfiV2Manifest['group'] {
  const record = exactDataRecord(value, ['address', 'accountLengthBytes', 'accountDataSha256']);
  const accountDataSha256 = nonzeroSha256(record.accountDataSha256);
  if (
    record.address !== GROUP_ADDRESS ||
    (record.accountLengthBytes !== '1064' && record.accountLengthBytes !== '9256')
  ) {
    return unavailable();
  }
  return Object.freeze({
    address: GROUP_ADDRESS,
    accountLengthBytes: record.accountLengthBytes,
    accountDataSha256,
  });
}

function parseBankManifest(value: unknown): MarginfiV2Manifest['bank'] {
  const record = exactDataRecord(value, [
    'address',
    'groupAddress',
    'mintAddress',
    'expectedMintDecimals',
    'expectedOperationalStateRaw',
    'expectedRiskTierRaw',
    'expectedAssetTagRaw',
    'expectedOracleSetupRaw',
    'expectedPrimaryOracleAddress',
    'expectedDepositLimitAtomicRaw',
    'expectedBorrowLimitAtomicRaw',
    'expectedOracleMaximumAgeSeconds',
    'accountDataSha256',
  ]);
  const oracleSetup = canonicalInteger(record.expectedOracleSetupRaw, 26n);
  const depositLimit = canonicalInteger(record.expectedDepositLimitAtomicRaw, MAX_UINT64);
  const borrowLimit = canonicalInteger(record.expectedBorrowLimitAtomicRaw, MAX_UINT64);
  const oracleMaximumAge = positiveCanonicalInteger(
    record.expectedOracleMaximumAgeSeconds,
    MAX_UINT64,
  );
  const primaryOracleAddress = publicKey(record.expectedPrimaryOracleAddress);
  const accountDataSha256 = nonzeroSha256(record.accountDataSha256);
  if (
    record.address !== BANK_ADDRESS ||
    record.groupAddress !== GROUP_ADDRESS ||
    record.mintAddress !== USDC_MINT_ADDRESS ||
    record.expectedMintDecimals !== 6 ||
    record.expectedOperationalStateRaw !== '1' ||
    record.expectedRiskTierRaw !== '0' ||
    record.expectedAssetTagRaw !== '0' ||
    !ACCEPTED_EXTERNAL_ORACLE_SETUPS.has(Number(oracleSetup)) ||
    oracleMaximumAge < MIN_ORACLE_MAX_AGE_SECONDS
  ) {
    return unavailable();
  }
  return Object.freeze({
    address: BANK_ADDRESS,
    groupAddress: GROUP_ADDRESS,
    mintAddress: USDC_MINT_ADDRESS,
    expectedMintDecimals: 6 as const,
    expectedOperationalStateRaw: '1' as const,
    expectedRiskTierRaw: '0' as const,
    expectedAssetTagRaw: '0' as const,
    expectedOracleSetupRaw: oracleSetup.toString(10),
    expectedPrimaryOracleAddress: primaryOracleAddress,
    expectedDepositLimitAtomicRaw: depositLimit.toString(10),
    expectedBorrowLimitAtomicRaw: borrowLimit.toString(10),
    expectedOracleMaximumAgeSeconds: oracleMaximumAge.toString(10),
    accountDataSha256,
  });
}

function parseAssetManifest(value: unknown): MarginfiV2Manifest['asset'] {
  const record = exactDataRecord(value, [
    'stablecoin',
    'mintAddress',
    'decimals',
    'tokenProgramAddress',
    'accountDataSha256',
  ]);
  const accountDataSha256 = nonzeroSha256(record.accountDataSha256);
  const registered = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.identifyAsset(
    NETWORK_ID,
    USDC_MINT_ADDRESS,
  );
  if (
    record.stablecoin !== 'USDC' ||
    record.mintAddress !== USDC_MINT_ADDRESS ||
    record.decimals !== 6 ||
    record.tokenProgramAddress !== TOKEN_PROGRAM_ADDRESS ||
    registered?.stablecoin !== 'USDC' ||
    registered.chain !== 'SOLANA' ||
    registered.decimals !== 6 ||
    registered.activationState !== 'ACTIVE' ||
    registered.registryVersion !== 1
  ) {
    return unavailable();
  }
  return Object.freeze({
    stablecoin: 'USDC' as const,
    mintAddress: USDC_MINT_ADDRESS,
    decimals: 6 as const,
    tokenProgramAddress: TOKEN_PROGRAM_ADDRESS,
    accountDataSha256,
  });
}

function parseVaultsManifest(value: unknown): MarginfiV2Manifest['vaults'] {
  const record = exactDataRecord(value, ['liquidity', 'insurance', 'fee']);
  return Object.freeze({
    liquidity: parseVaultManifest(record.liquidity, {
      address: IDS.liquidityVaultAddress,
      authorityAddress: IDS.liquidityVaultAuthorityAddress,
      bump: IDS.liquidityVaultBump,
      authorityBump: IDS.liquidityVaultAuthorityBump,
    }),
    insurance: parseVaultManifest(record.insurance, {
      address: IDS.insuranceVaultAddress,
      authorityAddress: IDS.insuranceVaultAuthorityAddress,
      bump: IDS.insuranceVaultBump,
      authorityBump: IDS.insuranceVaultAuthorityBump,
    }),
    fee: parseVaultManifest(record.fee, {
      address: IDS.feeVaultAddress,
      authorityAddress: IDS.feeVaultAuthorityAddress,
      bump: IDS.feeVaultBump,
      authorityBump: IDS.feeVaultAuthorityBump,
    }),
  });
}

function parseVaultManifest(
  value: unknown,
  expected: Readonly<{
    address: string;
    authorityAddress: string;
    bump: number;
    authorityBump: number;
  }>,
): MarginfiVaultManifest {
  const record = exactDataRecord(value, [
    'address',
    'authorityAddress',
    'bump',
    'authorityBump',
    'accountDataSha256',
  ]);
  const address = publicKey(record.address);
  const authorityAddress = publicKey(record.authorityAddress);
  const accountDataSha256 = nonzeroSha256(record.accountDataSha256);
  if (
    address !== expected.address ||
    authorityAddress !== expected.authorityAddress ||
    record.bump !== expected.bump ||
    record.authorityBump !== expected.authorityBump
  ) {
    return unavailable();
  }
  return Object.freeze({
    address,
    authorityAddress,
    bump: expected.bump,
    authorityBump: expected.authorityBump,
    accountDataSha256,
  });
}

function parseMultipleAccountsResult(
  value: unknown,
  minimumContextSlot: number,
  manifest: MarginfiV2Manifest,
): MultipleAccountsResult {
  const record = exactDataRecord(value, ['context', 'value']);
  const context = allowedDataRecord(record.context, ['slot'], ['slot', 'apiVersion']);
  const slot = parsePositiveSafeInteger(context.slot);
  if (slot < minimumContextSlot) return unavailable();
  if ('apiVersion' in context && !validApiVersion(context.apiVersion)) return unavailable();
  if (!Array.isArray(record.value) || record.value.length !== ACCOUNT_COUNT) return unavailable();
  const definitions = Object.freeze([
    Object.freeze({ owner: LOADER_ADDRESS, executable: true, bytes: PROGRAM_ACCOUNT_BYTES }),
    Object.freeze({
      owner: LOADER_ADDRESS,
      executable: false,
      bytes: Number(manifest.deployment.programDataAccountLengthBytes),
    }),
    Object.freeze({
      owner: PROGRAM_ADDRESS,
      executable: false,
      bytes: Number(manifest.group.accountLengthBytes),
    }),
    Object.freeze({ owner: PROGRAM_ADDRESS, executable: false, bytes: BANK_ACCOUNT_BYTES }),
    Object.freeze({ owner: TOKEN_PROGRAM_ADDRESS, executable: false, bytes: MINT_ACCOUNT_BYTES }),
    Object.freeze({ owner: TOKEN_PROGRAM_ADDRESS, executable: false, bytes: TOKEN_ACCOUNT_BYTES }),
    Object.freeze({ owner: TOKEN_PROGRAM_ADDRESS, executable: false, bytes: TOKEN_ACCOUNT_BYTES }),
    Object.freeze({ owner: TOKEN_PROGRAM_ADDRESS, executable: false, bytes: TOKEN_ACCOUNT_BYTES }),
  ]);
  const accounts = record.value.map((candidate, index) => {
    if (candidate === null) return unavailable();
    const definition = definitions[index];
    if (definition === undefined) return unavailable();
    return parseAccount(candidate, definition.owner, definition.executable, definition.bytes);
  });
  return Object.freeze({ slot, accounts: Object.freeze(accounts) });
}

function parseAccount(
  value: unknown,
  expectedOwner: string,
  expectedExecutable: boolean,
  exactBytes: number,
): ParsedAccount {
  const record = exactDataRecord(value, [
    'data',
    'executable',
    'lamports',
    'owner',
    'rentEpoch',
    'space',
  ]);
  const owner = publicKey(record.owner);
  parsePositiveSafeInteger(record.lamports);
  validateRentEpoch(record.rentEpoch);
  const space = parsePositiveSafeInteger(record.space);
  const data = parseCanonicalBase64(record.data, exactBytes);
  if (
    owner !== expectedOwner ||
    record.executable !== expectedExecutable ||
    space !== exactBytes ||
    data.byteLength !== exactBytes
  ) {
    return unavailable();
  }
  return Object.freeze({ data, dataSha256: sha256(data) });
}

function assertAccountFingerprints(
  program: ParsedAccount,
  programData: ParsedAccount,
  group: ParsedAccount,
  bank: ParsedAccount,
  mint: ParsedAccount,
  liquidityVault: ParsedAccount,
  insuranceVault: ParsedAccount,
  feeVault: ParsedAccount,
  manifest: MarginfiV2Manifest,
): void {
  if (
    program.dataSha256 !== manifest.deployment.programAccountDataSha256 ||
    programData.dataSha256 !== manifest.deployment.programDataAccountSha256 ||
    group.dataSha256 !== manifest.group.accountDataSha256 ||
    bank.dataSha256 !== manifest.bank.accountDataSha256 ||
    mint.dataSha256 !== manifest.asset.accountDataSha256 ||
    liquidityVault.dataSha256 !== manifest.vaults.liquidity.accountDataSha256 ||
    insuranceVault.dataSha256 !== manifest.vaults.insurance.accountDataSha256 ||
    feeVault.dataSha256 !== manifest.vaults.fee.accountDataSha256
  ) {
    return unavailable();
  }
}

function parseProgram(data: Uint8Array, expectedProgramDataAddress: string): void {
  if (readU32(data, 0) !== 2 || readPublicKey(data, 4) !== expectedProgramDataAddress) {
    return unavailable();
  }
}

function parseProgramData(
  data: Uint8Array,
  snapshotSlot: number,
  manifest: MarginfiV2Manifest,
): ParsedProgramData {
  if (readU32(data, 0) !== 3 || !bytesEqual(data.subarray(45, 49), ELF_MAGIC)) {
    return unavailable();
  }
  const lastDeployedSlot = readU64(data, 4);
  if (
    lastDeployedSlot === 0n ||
    lastDeployedSlot > BigInt(snapshotSlot) ||
    lastDeployedSlot.toString(10) !== manifest.deployment.expectedLastDeployedSlot
  ) {
    return unavailable();
  }
  const option = byteAt(data, 12);
  let upgradeAuthorityAddress: string | null;
  if (option === 0) {
    upgradeAuthorityAddress = null;
  } else if (option === 1) {
    upgradeAuthorityAddress = readPublicKey(data, 13);
  } else {
    return unavailable();
  }
  if (upgradeAuthorityAddress !== manifest.deployment.expectedUpgradeAuthorityAddress) {
    return unavailable();
  }
  const binarySha256 = sha256(data.subarray(PROGRAMDATA_METADATA_BYTES));
  if (binarySha256 !== manifest.deployment.programDataBinarySha256) return unavailable();
  return Object.freeze({ lastDeployedSlot, upgradeAuthorityAddress, binarySha256 });
}

function parseGroup(data: Uint8Array): ParsedGroup {
  if (
    (data.byteLength !== GROUP_V1_ACCOUNT_BYTES &&
      data.byteLength !== GROUP_CURRENT_ACCOUNT_BYTES) ||
    !bytesEqual(data.subarray(0, 8), GROUP_DISCRIMINATOR)
  ) {
    return unavailable();
  }
  const adminAddress = readPublicKey(data, 8);
  const groupFlags = readU64(data, 40);
  const bankCount = readU16(data, 120);
  if ((groupFlags & ~1n) !== 0n) return unavailable();
  return Object.freeze({ adminAddress, groupFlags, bankCount });
}

function parseBank(data: Uint8Array, manifest: MarginfiV2Manifest): ParsedBank {
  if (
    data.byteLength !== BANK_ACCOUNT_BYTES ||
    !bytesEqual(data.subarray(0, 8), BANK_DISCRIMINATOR)
  ) {
    return unavailable();
  }
  const mintAddress = readPublicKey(data, 8);
  const mintDecimals = byteAt(data, 40);
  const groupAddress = readPublicKey(data, 41);
  const assetShareValue = readI128(data, 80);
  const liabilityShareValue = readI128(data, 96);
  const liquidityVaultAddress = readPublicKey(data, 112);
  const liquidityVaultBump = byteAt(data, 144);
  const liquidityVaultAuthorityBump = byteAt(data, 145);
  const insuranceVaultAddress = readPublicKey(data, 146);
  const insuranceVaultBump = byteAt(data, 178);
  const insuranceVaultAuthorityBump = byteAt(data, 179);
  const feeVaultAddress = readPublicKey(data, 200);
  const feeVaultBump = byteAt(data, 232);
  const feeVaultAuthorityBump = byteAt(data, 233);
  const totalLiabilityShares = readI128(data, 256);
  const totalAssetShares = readI128(data, 272);
  const lastUpdate = readI64(data, 288);
  const depositLimit = readU64(data, 360);
  const operationalState = byteAt(data, 608);
  const oracleSetup = byteAt(data, 609);
  const primaryOracleAddress = readPublicKey(data, 610);
  const borrowLimit = readU64(data, 776);
  const riskTier = byteAt(data, 784);
  const assetTag = byteAt(data, 785);
  const configFlags = byteAt(data, 786);
  const oracleMaximumAge = BigInt(readU16(data, 800));
  const bankFlags = readU64(data, 840);
  const cachedOraclePrice = readI128(data, 1_408);
  const cachedOracleTimestamp = readI64(data, 1_424);
  const cachedOracleConfidence = readI128(data, 1_432);
  const liquidationCacheFlags = byteAt(data, 1_448);
  const lendingPositionCount = readI32(data, 1_536);
  const borrowingPositionCount = readI32(data, 1_540);
  const circuitBreakerTier = byteAt(data, 1_776);

  if (
    mintAddress !== USDC_MINT_ADDRESS ||
    mintDecimals !== 6 ||
    groupAddress !== GROUP_ADDRESS ||
    liquidityVaultAddress !== IDS.liquidityVaultAddress ||
    liquidityVaultBump !== IDS.liquidityVaultBump ||
    liquidityVaultAuthorityBump !== IDS.liquidityVaultAuthorityBump ||
    insuranceVaultAddress !== IDS.insuranceVaultAddress ||
    insuranceVaultBump !== IDS.insuranceVaultBump ||
    insuranceVaultAuthorityBump !== IDS.insuranceVaultAuthorityBump ||
    feeVaultAddress !== IDS.feeVaultAddress ||
    feeVaultBump !== IDS.feeVaultBump ||
    feeVaultAuthorityBump !== IDS.feeVaultAuthorityBump ||
    assetShareValue <= 0n ||
    liabilityShareValue <= 0n ||
    totalLiabilityShares < 0n ||
    totalAssetShares < 0n ||
    lastUpdate <= 0n ||
    operationalState !== 1 ||
    operationalState.toString(10) !== manifest.bank.expectedOperationalStateRaw ||
    !ACCEPTED_EXTERNAL_ORACLE_SETUPS.has(oracleSetup) ||
    oracleSetup.toString(10) !== manifest.bank.expectedOracleSetupRaw ||
    primaryOracleAddress !== manifest.bank.expectedPrimaryOracleAddress ||
    depositLimit.toString(10) !== manifest.bank.expectedDepositLimitAtomicRaw ||
    borrowLimit.toString(10) !== manifest.bank.expectedBorrowLimitAtomicRaw ||
    riskTier !== 0 ||
    riskTier.toString(10) !== manifest.bank.expectedRiskTierRaw ||
    assetTag !== 0 ||
    assetTag.toString(10) !== manifest.bank.expectedAssetTagRaw ||
    oracleMaximumAge < MIN_ORACLE_MAX_AGE_SECONDS ||
    oracleMaximumAge.toString(10) !== manifest.bank.expectedOracleMaximumAgeSeconds ||
    (bankFlags & ~KNOWN_BANK_FLAGS_MASK) !== 0n ||
    (bankFlags & TOKEN_2022_BANK_FLAG) !== 0n ||
    cachedOraclePrice <= 0n ||
    cachedOracleTimestamp <= 0n ||
    cachedOracleConfidence < 0n ||
    (liquidationCacheFlags & ~1) !== 0 ||
    circuitBreakerTier !== 0 ||
    !isZeroBytes(data.subarray(1_560, 1_656))
  ) {
    return unavailable();
  }
  return Object.freeze({
    oracleSetup,
    primaryOracleAddress,
    oracleMaximumAge,
    lastUpdate,
    cachedOracleTimestamp,
    assetShareValueHex: littleEndianHex(data, 80, 16),
    liabilityShareValueHex: littleEndianHex(data, 96, 16),
    totalAssetSharesHex: littleEndianHex(data, 272, 16),
    totalLiabilitySharesHex: littleEndianHex(data, 256, 16),
    cachedOraclePriceHex: littleEndianHex(data, 1_408, 16),
    cachedOracleConfidenceHex: littleEndianHex(data, 1_432, 16),
    depositLimit,
    borrowLimit,
    bankFlags,
    configFlags,
    lendingPositionCount,
    borrowingPositionCount,
  });
}

function parseMint(data: Uint8Array): ParsedMint {
  const mintAuthorityAddress = readCOptionPublicKey(data, 0);
  const supply = readU64(data, 36);
  const decimals = byteAt(data, 44);
  const initialized = byteAt(data, 45);
  const freezeAuthorityAddress = readCOptionPublicKey(data, 46);
  if (supply === 0n || decimals !== 6 || initialized !== 1) return unavailable();
  return Object.freeze({ supply, mintAuthorityAddress, freezeAuthorityAddress });
}

function parseTokenAccount(data: Uint8Array, expectedAuthorityAddress: string): ParsedTokenAccount {
  const mintAddress = readPublicKey(data, 0);
  const authorityAddress = readPublicKey(data, 32);
  const amount = readU64(data, 64);
  const delegateAddress = readCOptionPublicKey(data, 72);
  const state = byteAt(data, 108);
  const nativeReserve = readCOptionU64(data, 109);
  const delegatedAmount = readU64(data, 121);
  const closeAuthorityAddress = readCOptionPublicKey(data, 129);
  if (
    mintAddress !== USDC_MINT_ADDRESS ||
    authorityAddress !== expectedAuthorityAddress ||
    delegateAddress !== null ||
    state !== 1 ||
    nativeReserve !== null ||
    delegatedAmount !== 0n ||
    closeAuthorityAddress !== null
  ) {
    return unavailable();
  }
  return Object.freeze({ amount });
}

function vaultEvidence(
  address: string,
  authorityAddress: string,
  vault: ParsedTokenAccount,
  account: ParsedAccount,
): VaultEvidence {
  return Object.freeze({
    address,
    authorityAddress,
    state: 'INITIALIZED' as const,
    amountAtomicRaw: vault.amount.toString(10),
    accountDataSha256: account.dataSha256,
  });
}

function parseBlock(value: unknown, expectedSlot: number): SolanaBlock {
  const record = allowedDataRecord(
    value,
    ['blockHeight', 'blockTime', 'blockhash', 'parentSlot', 'previousBlockhash'],
    BLOCK_KEYS,
  );
  const blockHeight = parsePositiveSafeInteger(record.blockHeight);
  const blockTime = parsePositiveSafeInteger(record.blockTime);
  const blockhash = publicKey(record.blockhash);
  const previousBlockhash = publicKey(record.previousBlockhash);
  const parentSlot = parseNonnegativeSafeInteger(record.parentSlot);
  validateEmptyOptionalBlockArrays(record);
  if (
    parentSlot >= expectedSlot ||
    blockhash === previousBlockhash ||
    isZeroPublicKey(blockhash) ||
    isZeroPublicKey(previousBlockhash)
  ) {
    return unavailable();
  }
  return Object.freeze({
    slot: expectedSlot,
    blockhash,
    previousBlockhash,
    parentSlot,
    blockHeight,
    blockTime,
  });
}

function validateEmptyOptionalBlockArrays(record: Readonly<Record<string, unknown>>): void {
  for (const key of ['rewards', 'signatures', 'transactions'] as const) {
    if (key in record && (!Array.isArray(record[key]) || record[key].length !== 0)) {
      return unavailable();
    }
  }
  if (
    'numRewardPartitions' in record &&
    record.numRewardPartitions !== null &&
    !isNonnegativeSafeInteger(record.numRewardPartitions)
  ) {
    return unavailable();
  }
}

function sameBlock(left: SolanaBlock, right: SolanaBlock): boolean {
  return (
    left.slot === right.slot &&
    left.blockhash === right.blockhash &&
    left.previousBlockhash === right.previousBlockhash &&
    left.parentSlot === right.parentSlot &&
    left.blockHeight === right.blockHeight &&
    left.blockTime === right.blockTime
  );
}

function parseCanonicalBase64(value: unknown, exactBytes: number): Uint8Array {
  if (!Array.isArray(value) || value.length !== 2) return unavailable();
  const [encoded, encoding] = value as readonly unknown[];
  const maximumEncodedLength = Math.ceil(exactBytes / 3) * 4;
  if (
    typeof encoded !== 'string' ||
    encoding !== 'base64' ||
    encoded.length < 1 ||
    encoded.length > maximumEncodedLength ||
    !CANONICAL_BASE64.test(encoded)
  ) {
    return unavailable();
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.byteLength !== exactBytes || decoded.toString('base64') !== encoded) {
    return unavailable();
  }
  return Uint8Array.from(decoded);
}

function readCOptionPublicKey(data: Uint8Array, offset: number): string | null {
  const tag = readU32(data, offset);
  if (tag === 0) {
    if (!isZeroBytes(data.subarray(offset + 4, offset + 36))) return unavailable();
    return null;
  }
  if (tag !== 1) return unavailable();
  return readPublicKey(data, offset + 4);
}

function readCOptionU64(data: Uint8Array, offset: number): bigint | null {
  const tag = readU32(data, offset);
  if (tag === 0) {
    if (!isZeroBytes(data.subarray(offset + 4, offset + 12))) return unavailable();
    return null;
  }
  if (tag !== 1) return unavailable();
  return readU64(data, offset + 4);
}

function readPublicKey(data: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 32 > data.byteLength) return unavailable();
  const bytes = data.subarray(offset, offset + 32);
  if (isZeroBytes(bytes)) return unavailable();
  return encodeBase58(bytes);
}

function publicKey(value: unknown): string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return unavailable();
  let numericValue = 0n;
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) return unavailable();
    numericValue = numericValue * 58n + BigInt(digit);
  }
  const reversed: number[] = [];
  while (numericValue > 0n) {
    reversed.push(Number(numericValue % 256n));
    numericValue /= 256n;
  }
  const leadingZeroes = value.match(/^1*/u)?.[0].length ?? 0;
  const decoded = Uint8Array.from([
    ...new Array<number>(leadingZeroes).fill(0),
    ...reversed.reverse(),
  ]);
  if (decoded.byteLength !== 32 || encodeBase58(decoded) !== value || isZeroBytes(decoded)) {
    return unavailable();
  }
  return value;
}

function encodeBase58(bytes: Uint8Array): string {
  let numericValue = 0n;
  for (const byte of bytes) numericValue = numericValue * 256n + BigInt(byte);
  let encoded = '';
  while (numericValue > 0n) {
    const remainder = Number(numericValue % 58n);
    encoded = `${BASE58_ALPHABET[remainder]}${encoded}`;
    numericValue /= 58n;
  }
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.byteLength && bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return `${'1'.repeat(leadingZeroes)}${encoded}`;
}

function readU16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.byteLength) return unavailable();
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true);
}

function readU32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.byteLength) return unavailable();
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function readI32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.byteLength) return unavailable();
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(offset, true);
}

function readU64(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.byteLength) return unavailable();
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

function readI64(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.byteLength) return unavailable();
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true);
}

function readI128(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 16 > data.byteLength) return unavailable();
  const unsigned = readU64(data, offset) | (readU64(data, offset + 8) << 64n);
  return unsigned >= 1n << 127n ? unsigned - (1n << 128n) : unsigned;
}

function littleEndianHex(data: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || length <= 0 || offset + length > data.byteLength) return unavailable();
  return Buffer.from(data.subarray(offset, offset + length)).toString('hex');
}

function byteAt(data: Uint8Array, offset: number): number {
  const value = data[offset];
  if (value === undefined) return unavailable();
  return value;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function isZeroBytes(value: Uint8Array): boolean {
  return value.every((byte) => byte === 0);
}

function isZeroPublicKey(value: string): boolean {
  return value === '11111111111111111111111111111111';
}

function parsePositiveSafeInteger(value: unknown): number {
  if (!isNonnegativeSafeInteger(value) || value === 0) return unavailable();
  return value;
}

function parseNonnegativeSafeInteger(value: unknown): number {
  if (!isNonnegativeSafeInteger(value)) return unavailable();
  return value;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validateRentEpoch(value: unknown): void {
  // Solana JSON-RPC serializes u64::MAX as a rounded JSON number. Other
  // accepted values must retain safe-integer precision.
  if (!isNonnegativeSafeInteger(value) && value !== U64_MAX_JSON_NUMBER) return unavailable();
}

function validApiVersion(value: unknown): boolean {
  return typeof value === 'string' && value.length <= 32 && API_VERSION.test(value);
}

function canonicalInteger(value: unknown, maximum: bigint): bigint {
  if (
    typeof value !== 'string' ||
    !CANONICAL_UNSIGNED_INTEGER.test(value) ||
    value.length > maximum.toString(10).length
  ) {
    return unavailable();
  }
  const parsed = BigInt(value);
  if (parsed > maximum) return unavailable();
  return parsed;
}

function positiveCanonicalInteger(value: unknown, maximum: bigint): bigint {
  const parsed = canonicalInteger(value, maximum);
  if (parsed === 0n) return unavailable();
  return parsed;
}

function nonzeroSha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value) || value === ZERO_SHA256) {
    return unavailable();
  }
  return value;
}

function assertFresh(sourceSeconds: bigint, nowMilliseconds: number, maximumAge: bigint): void {
  if (sourceSeconds <= 0n || sourceSeconds > MAX_UNIX_SECONDS || maximumAge <= 0n) {
    return unavailable();
  }
  const sourceMilliseconds = sourceSeconds * 1_000n;
  const observedMilliseconds = BigInt(nowMilliseconds);
  if (
    sourceMilliseconds > observedMilliseconds ||
    observedMilliseconds - sourceMilliseconds >= maximumAge * 1_000n
  ) {
    return unavailable();
  }
}

function minimumBigInt(...values: readonly bigint[]): bigint {
  const first = values[0];
  if (first === undefined || values.some((value) => value <= 0n)) return unavailable();
  return values.slice(1).reduce((minimum, value) => (value < minimum ? value : minimum), first);
}

function canonicalClock(value: unknown): Readonly<{ timestamp: string; milliseconds: number }> {
  try {
    if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype) {
      return unavailable();
    }
    const milliseconds = Date.prototype.getTime.call(value);
    if (!Number.isSafeInteger(milliseconds)) return unavailable();
    const timestamp = Date.prototype.toISOString.call(value);
    if (!ISO_TIMESTAMP.test(timestamp)) return unavailable();
    return Object.freeze({ timestamp, milliseconds });
  } catch (error) {
    if (error instanceof MarginfiV2SolanaTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function unixSecondsToTimestamp(value: bigint): string {
  if (value <= 0n || value > MAX_UNIX_SECONDS) return unavailable();
  const milliseconds = value * 1_000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return unavailable();
  const timestamp = Date.prototype.toISOString.call(new Date(Number(milliseconds)));
  if (!ISO_TIMESTAMP.test(timestamp)) return unavailable();
  return timestamp;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function fingerprint(domain: string, values: readonly unknown[]): string {
  return createHash('sha256')
    .update(JSON.stringify([domain, ...values]), 'utf8')
    .digest('hex');
}

interface DataBounds {
  readonly maximumBytes: number;
  readonly maximumNodes: number;
  readonly maximumDepth: number;
  readonly maximumArrayLength: number;
}

/** Traverses property descriptors, rejecting accessors without invoking them. */
function assertBoundedData(value: unknown, bounds: DataBounds): void {
  try {
    const seen = new WeakSet<object>();
    let bytes = 0;
    let nodes = 0;
    const visit = (candidate: unknown, depth: number): void => {
      nodes += 1;
      if (nodes > bounds.maximumNodes || depth > bounds.maximumDepth) return unavailable();
      if (candidate === null || typeof candidate === 'boolean') {
        bytes += 5;
      } else if (typeof candidate === 'number') {
        if (!Number.isFinite(candidate) || !Number.isInteger(candidate)) return unavailable();
        bytes += 32;
      } else if (typeof candidate === 'string') {
        bytes += Buffer.byteLength(candidate, 'utf8') + 2;
      } else if (typeof candidate === 'object') {
        if (seen.has(candidate)) return unavailable();
        seen.add(candidate);
        const array = Array.isArray(candidate);
        const prototype = Object.getPrototypeOf(candidate);
        if (
          (array && prototype !== Array.prototype) ||
          (!array && prototype !== Object.prototype && prototype !== null) ||
          Object.getOwnPropertySymbols(candidate).length !== 0
        ) {
          return unavailable();
        }
        const descriptors = Object.getOwnPropertyDescriptors(candidate);
        const keys: string[] = [];
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (array && key === 'length') continue;
          if (!descriptor.enumerable || !('value' in descriptor)) return unavailable();
          keys.push(key);
          bytes += Buffer.byteLength(key, 'utf8') + 3;
          visit(descriptor.value, depth + 1);
        }
        if (
          array &&
          (candidate.length > bounds.maximumArrayLength ||
            keys.length !== candidate.length ||
            keys.some((key, index) => key !== String(index)))
        ) {
          return unavailable();
        }
      } else {
        return unavailable();
      }
      if (bytes > bounds.maximumBytes) return unavailable();
    };
    visit(value, 0);
  } catch (error) {
    if (error instanceof MarginfiV2SolanaTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return unavailable();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return unavailable();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return unavailable();
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return unavailable();
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof MarginfiV2SolanaTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  const record = dataRecord(value);
  const actual = Object.keys(record);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) {
    return unavailable();
  }
  return record;
}

function allowedDataRecord(
  value: unknown,
  required: readonly string[],
  allowed: readonly string[],
): Readonly<Record<string, unknown>> {
  const record = dataRecord(value);
  const actual = Object.keys(record);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    actual.some((key) => !allowed.includes(key))
  ) {
    return unavailable();
  }
  return record;
}

function unavailable(): never {
  throw new MarginfiV2SolanaTranscriptUnavailableError();
}
