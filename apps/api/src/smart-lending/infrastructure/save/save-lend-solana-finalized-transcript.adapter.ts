import { createHash } from 'node:crypto';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';

export const SAVE_LEND_SOLANA_SOURCE_PINS = Object.freeze({
  publicRepository: 'solendprotocol/public',
  publicCommitSha: 'b3b46ffbc2f5162b6e5680dd3cad1042c2eb3f8e',
  programRepository: 'solendprotocol/solana-program-library',
  programCommitSha: 'd04ce00bbf4356c4fd32b3be38eb9760b696bb3e',
  solanaLoaderRepository: 'solana-labs/solana',
  solanaLoaderCommitSha: '7700cb3128c1f19820de67b81aa45d18f73d2ac0',
  splTokenRepository: 'solana-program/token',
  splTokenCommitSha: '0087ca54bd5a5b07e1df7e1b52303529047a1186',
  lendingMarketLayout: 'SOLEND_D04CE00B_LENDING_MARKET_PACK_290',
  reserveLayout: 'SOLEND_D04CE00B_RESERVE_PACK_619',
  lastUpdateLayout: 'SOLEND_D04CE00B_LAST_UPDATE_SLOT_U64_STALE_BOOL',
  loaderLayout: 'BPF_UPGRADEABLE_LOADER_V3_BINCODE_PROGRAM_36_PROGRAMDATA_HEADER_45',
  mintLayout: 'SPL_TOKEN_0087CA54_MINT_PACK_82',
  reserveIdentityEvidence: 'SAVE_PRODUCTION_CONFIG_API_RESEARCH_2026-09-04_UNTRUSTED',
} as const);

export const SAVE_LEND_SOLANA_MAINNET_IDENTITIES = Object.freeze({
  networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  programAddress: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo',
  lendingMarketAddress: '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY',
  usdcReserveAddress: 'BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
  usdcMintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  upgradeableLoaderAddress: 'BPFLoaderUpgradeab1e11111111111111111111111',
  legacyTokenProgramAddress: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
} as const);

const NETWORK_ID = SAVE_LEND_SOLANA_MAINNET_IDENTITIES.networkId;
const GENESIS_HASH = SAVE_LEND_SOLANA_MAINNET_IDENTITIES.genesisHash;
const PROGRAM_ADDRESS = SAVE_LEND_SOLANA_MAINNET_IDENTITIES.programAddress;
const MARKET_ADDRESS = SAVE_LEND_SOLANA_MAINNET_IDENTITIES.lendingMarketAddress;
const RESERVE_ADDRESS = SAVE_LEND_SOLANA_MAINNET_IDENTITIES.usdcReserveAddress;
const USDC_MINT_ADDRESS = SAVE_LEND_SOLANA_MAINNET_IDENTITIES.usdcMintAddress;
const LOADER_ADDRESS = SAVE_LEND_SOLANA_MAINNET_IDENTITIES.upgradeableLoaderAddress;
const TOKEN_PROGRAM_ADDRESS = SAVE_LEND_SOLANA_MAINNET_IDENTITIES.legacyTokenProgramAddress;
const MARKET_ID = 'save-lend-solana-mainnet-main-usdc' as const;

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
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UNIX_SECONDS = 253_402_300_799n;
const MAX_FRESHNESS_SECONDS = 3_600n;
// The pinned program declares a reserve stale when slots_elapsed >= 1.
const MAX_RESERVE_SLOT_LAG = 0n;
const MAX_PROGRAMDATA_ACCOUNT_BYTES = 10 * 1024 * 1024 + 45;
const PROGRAM_ACCOUNT_BYTES = 36;
const PROGRAMDATA_METADATA_BYTES = 45;
const MARKET_ACCOUNT_BYTES = 290;
const RESERVE_ACCOUNT_BYTES = 619;
const MINT_ACCOUNT_BYTES = 82;
const U64_MAX_JSON_NUMBER = Number(MAX_UINT64);
const ACCOUNT_COUNT = 5;
const ELF_MAGIC = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46]);

const RESPONSE_BOUNDS = Object.freeze({
  maximumBytes: 20 * 1024 * 1024,
  maximumNodes: 512,
  maximumDepth: 12,
  maximumArrayLength: 16,
});
const MANIFEST_BOUNDS = Object.freeze({
  maximumBytes: 40 * 1024,
  maximumNodes: 160,
  maximumDepth: 8,
  maximumArrayLength: 0,
});
const REQUEST_BOUNDS = Object.freeze({
  maximumBytes: 2 * 1024,
  maximumNodes: 16,
  maximumDepth: 3,
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

export interface SaveLendSolanaJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: 'getGenesisHash' | 'getSlot' | 'getMultipleAccounts' | 'getBlock';
  readonly params: readonly unknown[];
}

/** Owns no endpoint, client, credentials, retry, DNS, TLS, or egress configuration. */
export interface SaveLendSolanaJsonRpcTranscriptTransport {
  exchange(request: SaveLendSolanaJsonRpcRequest): Promise<unknown>;
}

export interface SaveLendSolanaTranscriptClock {
  now(): Date;
}

export interface SaveLendSolanaManifestDefinition {
  readonly schemaVersion: 1;
  readonly use: 'DORMANT_SAVE_LEND_USDC_CORROBORATION_ONLY';
  readonly sources: Readonly<{
    readonly publicCommitSha: string;
    readonly programCommitSha: string;
    readonly solanaLoaderCommitSha: string;
    readonly splTokenCommitSha: string;
    readonly lendingMarketLayout: string;
    readonly reserveLayout: string;
    readonly lastUpdateLayout: string;
    readonly loaderLayout: string;
    readonly mintLayout: string;
    readonly reserveIdentityEvidence: string;
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
  readonly maximumReserveSlotLag: string;
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
  readonly market: Readonly<{
    readonly marketId: typeof MARKET_ID;
    readonly address: typeof MARKET_ADDRESS;
    readonly expectedVersion: string;
    readonly accountDataSha256: string;
  }>;
  readonly reserve: Readonly<{
    readonly address: typeof RESERVE_ADDRESS;
    readonly expectedVersion: string;
    readonly lendingMarketAddress: typeof MARKET_ADDRESS;
    readonly liquidityMintAddress: typeof USDC_MINT_ADDRESS;
    readonly accountDataSha256: string;
  }>;
  readonly asset: Readonly<{
    readonly stablecoin: 'USDC';
    readonly mintAddress: typeof USDC_MINT_ADDRESS;
    readonly decimals: 6;
    readonly tokenProgramAddress: typeof TOKEN_PROGRAM_ADDRESS;
    readonly accountDataSha256: string;
  }>;
}

export interface SaveLendSolanaManifest extends SaveLendSolanaManifestDefinition {
  readonly manifestFingerprintSha256: string;
}

export interface ReadSaveLendSolanaTranscriptRequest {
  readonly marketId: typeof MARKET_ID;
  readonly programAddress: typeof PROGRAM_ADDRESS;
  readonly lendingMarketAddress: typeof MARKET_ADDRESS;
  readonly reserveAddress: typeof RESERVE_ADDRESS;
  readonly assetMintAddress: typeof USDC_MINT_ADDRESS;
}

export interface DormantSaveLendSolanaTranscriptCandidate {
  readonly schemaVersion: 1;
  readonly sourceId: 'SAVE_LEND_SOLANA_FINALIZED_JSON_RPC_TRANSCRIPT';
  readonly use: 'DORMANT_SAVE_LEND_USDC_CORROBORATION_ONLY';
  readonly providerId: 'save';
  readonly protocolId: 'save-lend';
  readonly networkId: typeof NETWORK_ID;
  readonly marketId: typeof MARKET_ID;
  readonly manifestFingerprintSha256: string;
  readonly transcriptFingerprintSha256: string;
  readonly observedAt: string;
  readonly staleAfter: string;
  readonly sourcePosition: string;
  readonly sourceFinality: 'SOLANA_FINALIZED_SLOT';
  readonly sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED';
  readonly sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT';
  readonly selectionStatus: 'OFFICIAL_PROGRAM_MARKET_AND_ASSET_PINNED_RESERVE_API_RESEARCH_CALLER_FINGERPRINTS_REQUIRED';
  readonly freshnessStatus: 'CURRENT_WITHIN_CALLER_TIME_AND_SLOT_BOUNDS';
  readonly yieldEvidenceStatus: 'ABSENT_NOT_COMPUTED';
  readonly liquidityEvidenceStatus: 'RAW_AVAILABLE_AMOUNT_ONLY_NOT_CAPACITY';
  readonly persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_AND_RISK_VERIFICATION';
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
  readonly market: Readonly<{
    readonly address: typeof MARKET_ADDRESS;
    readonly version: string;
    readonly ownerAuthorityAddress: string;
    readonly riskAuthorityAddress: string;
    readonly tokenProgramAddress: typeof TOKEN_PROGRAM_ADDRESS;
    readonly accountDataSha256: string;
  }>;
  readonly reserve: Readonly<{
    readonly address: typeof RESERVE_ADDRESS;
    readonly version: string;
    readonly lendingMarketAddress: typeof MARKET_ADDRESS;
    readonly liquidityMintAddress: typeof USDC_MINT_ADDRESS;
    readonly lastUpdateSlot: string;
    readonly lastUpdateSlotLag: string;
    readonly staleFlag: false;
    readonly liquidityAvailableAmountAtomicRaw: string;
    readonly liquidityBorrowedAmountWadsRaw: string;
    readonly collateralMintTotalSupplyAtomicRaw: string;
    readonly depositLimitAtomicRaw: string;
    readonly borrowLimitAtomicRaw: string;
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
}

interface ParsedAccount {
  readonly owner: string;
  readonly executable: boolean;
  readonly data: Uint8Array;
  readonly dataSha256: string;
}

interface SolanaBlock {
  readonly slot: number;
  readonly blockhash: string;
  readonly previousBlockhash: string;
  readonly parentSlot: number;
  readonly blockHeight: number;
  readonly blockTime: number;
}

interface ParsedProgramData {
  readonly lastDeployedSlot: bigint;
  readonly upgradeAuthorityAddress: string | null;
  readonly binarySha256: string;
}

interface ParsedMarket {
  readonly version: number;
  readonly ownerAuthorityAddress: string;
  readonly riskAuthorityAddress: string;
}

interface ParsedReserve {
  readonly version: number;
  readonly lastUpdateSlot: bigint;
  readonly lastUpdateSlotLag: bigint;
  readonly liquidityAvailableAmount: bigint;
  readonly liquidityBorrowedAmountWads: bigint;
  readonly collateralMintTotalSupply: bigint;
  readonly depositLimit: bigint;
  readonly borrowLimit: bigint;
}

interface ParsedMint {
  readonly supply: bigint;
  readonly mintAuthorityAddress: string | null;
  readonly freezeAuthorityAddress: string | null;
}

export class SaveLendSolanaTranscriptUnavailableError extends Error {
  readonly code = 'SAVE_LEND_SOLANA_TRANSCRIPT_UNAVAILABLE' as const;

  constructor() {
    super('Save Lend Solana transcript is unavailable');
    this.name = 'SaveLendSolanaTranscriptUnavailableError';
  }
}

export function createSaveLendSolanaManifest(value: unknown): SaveLendSolanaManifest {
  try {
    assertBoundedData(value, MANIFEST_BOUNDS);
    const raw = dataRecord(value);
    const includesFingerprint = Object.hasOwn(raw, 'manifestFingerprintSha256');
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
      'maximumReserveSlotLag',
      'deployment',
      'market',
      'reserve',
      'asset',
      ...(includesFingerprint ? ['manifestFingerprintSha256'] : []),
    ]);
    if (
      record.schemaVersion !== 1 ||
      record.use !== 'DORMANT_SAVE_LEND_USDC_CORROBORATION_ONLY' ||
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
    const maximumReserveSlotLag = canonicalInteger(
      record.maximumReserveSlotLag,
      MAX_RESERVE_SLOT_LAG,
    ).toString(10);
    const deployment = parseDeployment(record.deployment);
    const market = parseMarketManifest(record.market);
    const reserve = parseReserveManifest(record.reserve);
    const asset = parseAssetManifest(record.asset);
    const canonical = Object.freeze({
      schemaVersion: 1 as const,
      use: 'DORMANT_SAVE_LEND_USDC_CORROBORATION_ONLY' as const,
      sources,
      assetRegistry,
      networkId: NETWORK_ID,
      genesisHash: GENESIS_HASH,
      commitment: 'finalized' as const,
      snapshotBinding: 'ONE_GET_MULTIPLE_ACCOUNTS_MIN_CONTEXT_SLOT' as const,
      maximumAgeSeconds,
      maximumReserveSlotLag,
      deployment,
      market,
      reserve,
      asset,
    });
    const manifestFingerprintSha256 = fingerprint('crypto-lending:save-lend-solana-manifest:v1', [
      canonical,
    ]);
    if (
      includesFingerprint &&
      (typeof record.manifestFingerprintSha256 !== 'string' ||
        record.manifestFingerprintSha256 !== manifestFingerprintSha256)
    ) {
      return unavailable();
    }
    return Object.freeze({ ...canonical, manifestFingerprintSha256 });
  } catch (error) {
    if (error instanceof SaveLendSolanaTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

/**
 * Dormant parser for a caller-supplied Solana JSON-RPC transcript. The
 * separately supplied manifest fingerprint prevents silent manifest
 * substitution; neither it nor account hashes establish RPC authenticity or
 * production approval. This class is intentionally not registered anywhere.
 */
export class SaveLendSolanaFinalizedTranscriptAdapter {
  private readonly manifest!: SaveLendSolanaManifest;

  constructor(
    manifest: unknown,
    requiredManifestFingerprintSha256: string,
    private readonly transport: SaveLendSolanaJsonRpcTranscriptTransport,
    private readonly clock: SaveLendSolanaTranscriptClock,
  ) {
    try {
      this.manifest = createSaveLendSolanaManifest(manifest);
      if (
        typeof requiredManifestFingerprintSha256 !== 'string' ||
        !SHA256.test(requiredManifestFingerprintSha256) ||
        requiredManifestFingerprintSha256 !== this.manifest.manifestFingerprintSha256 ||
        typeof transport?.exchange !== 'function' ||
        typeof clock?.now !== 'function'
      ) {
        return unavailable();
      }
    } catch (error) {
      if (error instanceof SaveLendSolanaTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }

  async read(
    request: ReadSaveLendSolanaTranscriptRequest,
  ): Promise<DormantSaveLendSolanaTranscriptCandidate> {
    try {
      assertBoundedData(request, REQUEST_BOUNDS);
      const requested = exactDataRecord(request, [
        'marketId',
        'programAddress',
        'lendingMarketAddress',
        'reserveAddress',
        'assetMintAddress',
      ]);
      if (
        requested.marketId !== MARKET_ID ||
        requested.programAddress !== PROGRAM_ADDRESS ||
        requested.lendingMarketAddress !== MARKET_ADDRESS ||
        requested.reserveAddress !== RESERVE_ADDRESS ||
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
            MARKET_ADDRESS,
            RESERVE_ADDRESS,
            USDC_MINT_ADDRESS,
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
      const [programAccount, programDataAccount, marketAccount, reserveAccount, mintAccount] =
        accountResult.accounts;
      if (
        programAccount === undefined ||
        programDataAccount === undefined ||
        marketAccount === undefined ||
        reserveAccount === undefined ||
        mintAccount === undefined
      ) {
        return unavailable();
      }
      assertAccountFingerprints(
        programAccount,
        programDataAccount,
        marketAccount,
        reserveAccount,
        mintAccount,
        this.manifest,
      );
      parseProgram(programAccount.data, this.manifest.deployment.programDataAddress);
      const programData = parseProgramData(
        programDataAccount.data,
        accountResult.slot,
        this.manifest,
      );
      const market = parseMarket(marketAccount.data, this.manifest.market.expectedVersion);
      const reserve = parseReserve(
        reserveAccount.data,
        accountResult.slot,
        this.manifest.reserve.expectedVersion,
        BigInt(this.manifest.maximumReserveSlotLag),
      );
      const mint = parseMint(mintAccount.data);

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
      assertFresh(BigInt(blockBefore.blockTime), now.milliseconds, maximumAgeSeconds);
      const staleAfter = unixSecondsToTimestamp(BigInt(blockBefore.blockTime) + maximumAgeSeconds);

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
      const marketOutput = Object.freeze({
        address: MARKET_ADDRESS,
        version: market.version.toString(10),
        ownerAuthorityAddress: market.ownerAuthorityAddress,
        riskAuthorityAddress: market.riskAuthorityAddress,
        tokenProgramAddress: TOKEN_PROGRAM_ADDRESS,
        accountDataSha256: marketAccount.dataSha256,
      });
      const reserveOutput = Object.freeze({
        address: RESERVE_ADDRESS,
        version: reserve.version.toString(10),
        lendingMarketAddress: MARKET_ADDRESS,
        liquidityMintAddress: USDC_MINT_ADDRESS,
        lastUpdateSlot: reserve.lastUpdateSlot.toString(10),
        lastUpdateSlotLag: reserve.lastUpdateSlotLag.toString(10),
        staleFlag: false as const,
        liquidityAvailableAmountAtomicRaw: reserve.liquidityAvailableAmount.toString(10),
        liquidityBorrowedAmountWadsRaw: reserve.liquidityBorrowedAmountWads.toString(10),
        collateralMintTotalSupplyAtomicRaw: reserve.collateralMintTotalSupply.toString(10),
        depositLimitAtomicRaw: reserve.depositLimit.toString(10),
        borrowLimitAtomicRaw: reserve.borrowLimit.toString(10),
        accountDataSha256: reserveAccount.dataSha256,
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
      return Object.freeze({
        schemaVersion: 1,
        sourceId: 'SAVE_LEND_SOLANA_FINALIZED_JSON_RPC_TRANSCRIPT',
        use: 'DORMANT_SAVE_LEND_USDC_CORROBORATION_ONLY',
        providerId: 'save',
        protocolId: 'save-lend',
        networkId: NETWORK_ID,
        marketId: MARKET_ID,
        manifestFingerprintSha256: this.manifest.manifestFingerprintSha256,
        transcriptFingerprintSha256: fingerprint(
          'crypto-lending:save-lend-solana-finalized-transcript:v1',
          [
            this.manifest.manifestFingerprintSha256,
            snapshot,
            deployment,
            marketOutput,
            reserveOutput,
            asset,
            now.timestamp,
          ],
        ),
        observedAt: now.timestamp,
        staleAfter,
        sourcePosition: accountResult.slot.toString(10),
        sourceFinality: 'SOLANA_FINALIZED_SLOT',
        sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED',
        sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT',
        selectionStatus:
          'OFFICIAL_PROGRAM_MARKET_AND_ASSET_PINNED_RESERVE_API_RESEARCH_CALLER_FINGERPRINTS_REQUIRED',
        freshnessStatus: 'CURRENT_WITHIN_CALLER_TIME_AND_SLOT_BOUNDS',
        yieldEvidenceStatus: 'ABSENT_NOT_COMPUTED',
        liquidityEvidenceStatus: 'RAW_AVAILABLE_AMOUNT_ONLY_NOT_CAPACITY',
        persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_AND_RISK_VERIFICATION',
        mayPersist: false,
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
        snapshot,
        deployment,
        market: marketOutput,
        reserve: reserveOutput,
        asset,
      });
    } catch (error) {
      if (error instanceof SaveLendSolanaTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }

  private async rpc(
    id: number,
    method: SaveLendSolanaJsonRpcRequest['method'],
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

function parseSources(value: unknown): SaveLendSolanaManifest['sources'] {
  const record = exactDataRecord(value, [
    'publicCommitSha',
    'programCommitSha',
    'solanaLoaderCommitSha',
    'splTokenCommitSha',
    'lendingMarketLayout',
    'reserveLayout',
    'lastUpdateLayout',
    'loaderLayout',
    'mintLayout',
    'reserveIdentityEvidence',
  ]);
  const expected = SAVE_LEND_SOLANA_SOURCE_PINS;
  const commits = [
    record.publicCommitSha,
    record.programCommitSha,
    record.solanaLoaderCommitSha,
    record.splTokenCommitSha,
  ];
  if (
    commits.some((candidate) => typeof candidate !== 'string' || !COMMIT_SHA.test(candidate)) ||
    record.publicCommitSha !== expected.publicCommitSha ||
    record.programCommitSha !== expected.programCommitSha ||
    record.solanaLoaderCommitSha !== expected.solanaLoaderCommitSha ||
    record.splTokenCommitSha !== expected.splTokenCommitSha ||
    record.lendingMarketLayout !== expected.lendingMarketLayout ||
    record.reserveLayout !== expected.reserveLayout ||
    record.lastUpdateLayout !== expected.lastUpdateLayout ||
    record.loaderLayout !== expected.loaderLayout ||
    record.mintLayout !== expected.mintLayout ||
    record.reserveIdentityEvidence !== expected.reserveIdentityEvidence
  ) {
    return unavailable();
  }
  return Object.freeze({
    publicCommitSha: expected.publicCommitSha,
    programCommitSha: expected.programCommitSha,
    solanaLoaderCommitSha: expected.solanaLoaderCommitSha,
    splTokenCommitSha: expected.splTokenCommitSha,
    lendingMarketLayout: expected.lendingMarketLayout,
    reserveLayout: expected.reserveLayout,
    lastUpdateLayout: expected.lastUpdateLayout,
    loaderLayout: expected.loaderLayout,
    mintLayout: expected.mintLayout,
    reserveIdentityEvidence: expected.reserveIdentityEvidence,
  });
}

function parseAssetRegistry(value: unknown): SaveLendSolanaManifest['assetRegistry'] {
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

function parseDeployment(value: unknown): SaveLendSolanaManifest['deployment'] {
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
    programDataAddress === PROGRAM_ADDRESS ||
    programDataAddress === MARKET_ADDRESS ||
    programDataAddress === RESERVE_ADDRESS ||
    programDataAddress === USDC_MINT_ADDRESS ||
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

function parseMarketManifest(value: unknown): SaveLendSolanaManifest['market'] {
  const record = exactDataRecord(value, [
    'marketId',
    'address',
    'expectedVersion',
    'accountDataSha256',
  ]);
  const expectedVersion = positiveCanonicalInteger(record.expectedVersion, 255n);
  const accountDataSha256 = nonzeroSha256(record.accountDataSha256);
  if (
    record.marketId !== MARKET_ID ||
    record.address !== MARKET_ADDRESS ||
    expectedVersion !== 1n
  ) {
    return unavailable();
  }
  return Object.freeze({
    marketId: MARKET_ID,
    address: MARKET_ADDRESS,
    expectedVersion: expectedVersion.toString(10),
    accountDataSha256,
  });
}

function parseReserveManifest(value: unknown): SaveLendSolanaManifest['reserve'] {
  const record = exactDataRecord(value, [
    'address',
    'expectedVersion',
    'lendingMarketAddress',
    'liquidityMintAddress',
    'accountDataSha256',
  ]);
  const expectedVersion = positiveCanonicalInteger(record.expectedVersion, 255n);
  const accountDataSha256 = nonzeroSha256(record.accountDataSha256);
  if (
    record.address !== RESERVE_ADDRESS ||
    expectedVersion !== 1n ||
    record.lendingMarketAddress !== MARKET_ADDRESS ||
    record.liquidityMintAddress !== USDC_MINT_ADDRESS
  ) {
    return unavailable();
  }
  return Object.freeze({
    address: RESERVE_ADDRESS,
    expectedVersion: expectedVersion.toString(10),
    lendingMarketAddress: MARKET_ADDRESS,
    liquidityMintAddress: USDC_MINT_ADDRESS,
    accountDataSha256,
  });
}

function parseAssetManifest(value: unknown): SaveLendSolanaManifest['asset'] {
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

function parseMultipleAccountsResult(
  value: unknown,
  minimumContextSlot: number,
  manifest: SaveLendSolanaManifest,
): Readonly<{ slot: number; accounts: readonly ParsedAccount[] }> {
  const record = exactDataRecord(value, ['context', 'value']);
  const context = allowedDataRecord(record.context, ['slot'], ['slot', 'apiVersion']);
  const slot = parsePositiveSafeInteger(context.slot);
  if (slot < minimumContextSlot) return unavailable();
  if ('apiVersion' in context && !validApiVersion(context.apiVersion)) return unavailable();
  if (!Array.isArray(record.value) || record.value.length !== ACCOUNT_COUNT) return unavailable();
  const expectedProgramDataLength = Number(manifest.deployment.programDataAccountLengthBytes);
  const definitions = Object.freeze([
    Object.freeze({ owner: LOADER_ADDRESS, executable: true, exactBytes: PROGRAM_ACCOUNT_BYTES }),
    Object.freeze({
      owner: LOADER_ADDRESS,
      executable: false,
      exactBytes: expectedProgramDataLength,
    }),
    Object.freeze({ owner: PROGRAM_ADDRESS, executable: false, exactBytes: MARKET_ACCOUNT_BYTES }),
    Object.freeze({ owner: PROGRAM_ADDRESS, executable: false, exactBytes: RESERVE_ACCOUNT_BYTES }),
    Object.freeze({
      owner: TOKEN_PROGRAM_ADDRESS,
      executable: false,
      exactBytes: MINT_ACCOUNT_BYTES,
    }),
  ]);
  const accounts = record.value.map((candidate, index) => {
    if (candidate === null) return unavailable();
    const definition = definitions[index];
    if (definition === undefined) return unavailable();
    return parseAccount(candidate, definition.owner, definition.executable, definition.exactBytes);
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
  return Object.freeze({ owner, executable: expectedExecutable, data, dataSha256: sha256(data) });
}

function assertAccountFingerprints(
  program: ParsedAccount,
  programData: ParsedAccount,
  market: ParsedAccount,
  reserve: ParsedAccount,
  mint: ParsedAccount,
  manifest: SaveLendSolanaManifest,
): void {
  if (
    program.dataSha256 !== manifest.deployment.programAccountDataSha256 ||
    programData.dataSha256 !== manifest.deployment.programDataAccountSha256 ||
    market.dataSha256 !== manifest.market.accountDataSha256 ||
    reserve.dataSha256 !== manifest.reserve.accountDataSha256 ||
    mint.dataSha256 !== manifest.asset.accountDataSha256
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
  manifest: SaveLendSolanaManifest,
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

function parseMarket(data: Uint8Array, expectedVersion: string): ParsedMarket {
  const version = byteAt(data, 0);
  const ownerAuthorityAddress = readPublicKey(data, 2);
  const tokenProgramAddress = readPublicKey(data, 66);
  const riskAuthorityBytes = data.subarray(250, 282);
  const riskAuthorityAddress = isZeroBytes(riskAuthorityBytes)
    ? ownerAuthorityAddress
    : encodeBase58(riskAuthorityBytes);
  if (
    version.toString(10) !== expectedVersion ||
    tokenProgramAddress !== TOKEN_PROGRAM_ADDRESS ||
    isZeroPublicKey(riskAuthorityAddress)
  ) {
    return unavailable();
  }
  return Object.freeze({ version, ownerAuthorityAddress, riskAuthorityAddress });
}

function parseReserve(
  data: Uint8Array,
  snapshotSlot: number,
  expectedVersion: string,
  maximumSlotLag: bigint,
): ParsedReserve {
  const version = byteAt(data, 0);
  const lastUpdateSlot = readU64(data, 1);
  const stale = binaryFlag(byteAt(data, 9));
  const lendingMarket = readPublicKey(data, 10);
  const liquidityMint = readPublicKey(data, 42);
  const liquidityMintDecimals = byteAt(data, 74);
  const liquidityAvailableAmount = readU64(data, 171);
  const liquidityBorrowedAmountWads = readU128(data, 179);
  const collateralMintTotalSupply = readU64(data, 259);
  const depositLimit = readU64(data, 323);
  const borrowLimit = readU64(data, 331);
  binaryFlag(byteAt(data, 521));
  const reserveType = byteAt(data, 469);
  const snapshot = BigInt(snapshotSlot);
  if (lastUpdateSlot > snapshot) return unavailable();
  const lastUpdateSlotLag = snapshot - lastUpdateSlot;
  if (
    version.toString(10) !== expectedVersion ||
    lastUpdateSlot === 0n ||
    stale ||
    lastUpdateSlotLag > maximumSlotLag ||
    lendingMarket !== MARKET_ADDRESS ||
    liquidityMint !== USDC_MINT_ADDRESS ||
    liquidityMintDecimals !== 6 ||
    reserveType > 1 ||
    liquidityAvailableAmount > MAX_UINT64 ||
    liquidityBorrowedAmountWads > MAX_UINT128 ||
    collateralMintTotalSupply > MAX_UINT64 ||
    depositLimit > MAX_UINT64 ||
    borrowLimit > MAX_UINT64
  ) {
    return unavailable();
  }
  return Object.freeze({
    version,
    lastUpdateSlot,
    lastUpdateSlotLag,
    liquidityAvailableAmount,
    liquidityBorrowedAmountWads,
    collateralMintTotalSupply,
    depositLimit,
    borrowLimit,
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

function readU32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.byteLength) return unavailable();
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function readU64(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.byteLength) return unavailable();
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

function readU128(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 16 > data.byteLength) return unavailable();
  return readU64(data, offset) | (readU64(data, offset + 8) << 64n);
}

function byteAt(data: Uint8Array, offset: number): number {
  const value = data[offset];
  if (value === undefined) return unavailable();
  return value;
}

function binaryFlag(value: number): boolean {
  if (value === 0) return false;
  if (value === 1) return true;
  return unavailable();
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
  if (sourceSeconds <= 0n || sourceSeconds > MAX_UNIX_SECONDS) return unavailable();
  const sourceMilliseconds = sourceSeconds * 1_000n;
  const observedMilliseconds = BigInt(nowMilliseconds);
  if (
    sourceMilliseconds > observedMilliseconds ||
    observedMilliseconds - sourceMilliseconds >= maximumAge * 1_000n
  ) {
    return unavailable();
  }
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
    if (error instanceof SaveLendSolanaTranscriptUnavailableError) throw error;
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
    if (error instanceof SaveLendSolanaTranscriptUnavailableError) throw error;
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
    if (error instanceof SaveLendSolanaTranscriptUnavailableError) throw error;
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
  throw new SaveLendSolanaTranscriptUnavailableError();
}
