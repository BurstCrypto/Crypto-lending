import { createHash } from 'node:crypto';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';

export const JUPITER_LEND_SOLANA_SOURCE_PINS = Object.freeze({
  docsRepository: 'jup-ag/docs',
  docsCommitSha: 'c4b7ee1172ebb1c58407e479e7153bf225690aaf',
  integrationRepository: 'jup-ag/jupiter-lend',
  integrationCommitSha: '33a22cf7a5bfdd32ab1712dda4adfbeb9b348ad9',
  lendingIdlPath: 'target/idl/lending.json',
  lendingIdlSha256: '370f421ba919ed331ba952f0fa8566dcf7ffb3460bb87a7928a04f0422b979e2',
  lendingIdlByteLength: '41287',
  lendingIdlVersion: '0.1.4',
  readSdkPackage: '@jup-ag/lend-read',
  readSdkVersion: '0.0.14',
  readSdkTarballSha256: 'eb2c99852604c178f163b484e55e6b7ce73d4f7093f5ccffeb1701d1460a3f82',
  readSdkTarballByteLength: '256048',
  lendingLayout: 'ANCHOR_BORSH_LENDING_8_DISCRIMINATOR_PLUS_188_BYTES',
  loaderLayout: 'BPF_UPGRADEABLE_LOADER_V3_BINCODE_PROGRAM_36_PROGRAMDATA_HEADER_45',
  mintLayout: 'SPL_TOKEN_MINT_PACK_82',
} as const);

export const JUPITER_LEND_SOLANA_MAINNET_IDENTITIES = Object.freeze({
  networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  earnProgramAddress: 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9',
  liquidityProgramAddress: 'jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC',
  rewardsRateModelProgramAddress: 'jup7TthsMgcR9Y3L277b8Eo9uboVSmu1utkuXHNUKar',
  usdcLendingAddress: '2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ',
  usdcFTokenMintAddress: '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D',
  usdcTokenReserveAddress: '94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu',
  usdcSupplyPositionAddress: 'Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF',
  usdcRewardsRateModelAddress: '5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd',
  usdcMintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  upgradeableLoaderAddress: 'BPFLoaderUpgradeab1e11111111111111111111111',
  legacyTokenProgramAddress: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
} as const);

const ID = JUPITER_LEND_SOLANA_MAINNET_IDENTITIES;
const NETWORK_ID = ID.networkId;
const GENESIS_HASH = ID.genesisHash;
const PROGRAM_ADDRESS = ID.earnProgramAddress;
const LENDING_ADDRESS = ID.usdcLendingAddress;
const F_TOKEN_MINT_ADDRESS = ID.usdcFTokenMintAddress;
const USDC_MINT_ADDRESS = ID.usdcMintAddress;
const LOADER_ADDRESS = ID.upgradeableLoaderAddress;
const TOKEN_PROGRAM_ADDRESS = ID.legacyTokenProgramAddress;
const MARKET_ID = 'jupiter-lend-solana-mainnet-usdc-earn' as const;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,19})$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const API_VERSION = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(?:[-+][0-9A-Za-z.-]{1,24})?$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const ZERO_SHA256 = '0'.repeat(64);
const MAX_UINT16 = (1n << 16n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UNIX_SECONDS = 253_402_300_799n;
const MAX_FRESHNESS_SECONDS = 3_600n;
const MAX_PROGRAMDATA_ACCOUNT_BYTES = 10 * 1024 * 1024 + 45;
const PROGRAM_ACCOUNT_BYTES = 36;
const PROGRAMDATA_METADATA_BYTES = 45;
const LENDING_ACCOUNT_BYTES = 196;
const MINT_ACCOUNT_BYTES = 82;
const ACCOUNT_COUNT = 5;
const U64_MAX_JSON_NUMBER = Number(MAX_UINT64);

const LENDING_DISCRIMINATOR = Uint8Array.from([135, 199, 82, 16, 249, 131, 182, 241]);
const ELF_MAGIC = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46]);

const RESPONSE_BOUNDS = Object.freeze({
  maximumBytes: 20 * 1024 * 1024,
  maximumNodes: 512,
  maximumDepth: 12,
  maximumArrayLength: 16,
});
const MANIFEST_BOUNDS = Object.freeze({
  maximumBytes: 32 * 1024,
  maximumNodes: 128,
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

export interface JupiterLendSolanaJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: 'getGenesisHash' | 'getSlot' | 'getMultipleAccounts' | 'getBlock';
  readonly params: readonly unknown[];
}

/** Owns no endpoint, client, credential, retry, DNS, TLS, or egress configuration. */
export interface JupiterLendSolanaJsonRpcTranscriptTransport {
  exchange(request: JupiterLendSolanaJsonRpcRequest): Promise<unknown>;
}

export interface JupiterLendSolanaTranscriptClock {
  now(): Date;
}

export interface JupiterLendSolanaManifestDefinition {
  readonly schemaVersion: 1;
  readonly use: 'DORMANT_JUPITER_LEND_USDC_EARN_CORROBORATION_ONLY';
  readonly sources: Readonly<{
    readonly docsRepository: string;
    readonly docsCommitSha: string;
    readonly integrationRepository: string;
    readonly integrationCommitSha: string;
    readonly lendingIdlPath: string;
    readonly lendingIdlSha256: string;
    readonly lendingIdlByteLength: string;
    readonly lendingIdlVersion: string;
    readonly readSdkPackage: string;
    readonly readSdkVersion: string;
    readonly readSdkTarballSha256: string;
    readonly readSdkTarballByteLength: string;
    readonly lendingLayout: string;
    readonly loaderLayout: string;
    readonly mintLayout: string;
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
    readonly programDataAccountLengthBytes: string;
    readonly programDataBinarySha256: string;
    readonly expectedLastDeployedSlot: string;
    readonly expectedUpgradeAuthorityAddress: string | null;
  }>;
  readonly market: Readonly<{
    readonly marketId: typeof MARKET_ID;
    readonly lendingAddress: typeof LENDING_ADDRESS;
    readonly fTokenMintAddress: typeof F_TOKEN_MINT_ADDRESS;
    readonly expectedLendingId: string;
    readonly expectedFTokenMintAuthorityAddress: string | null;
    readonly expectedFTokenFreezeAuthorityAddress: string | null;
  }>;
  readonly asset: Readonly<{
    readonly stablecoin: 'USDC';
    readonly mintAddress: typeof USDC_MINT_ADDRESS;
    readonly decimals: 6;
    readonly tokenProgramAddress: typeof TOKEN_PROGRAM_ADDRESS;
  }>;
}

export interface JupiterLendSolanaManifest extends JupiterLendSolanaManifestDefinition {
  readonly manifestFingerprintSha256: string;
}

export interface ReadJupiterLendSolanaTranscriptRequest {
  readonly marketId: typeof MARKET_ID;
  readonly programAddress: typeof PROGRAM_ADDRESS;
  readonly lendingAddress: typeof LENDING_ADDRESS;
  readonly assetMintAddress: typeof USDC_MINT_ADDRESS;
  readonly receiptMintAddress: typeof F_TOKEN_MINT_ADDRESS;
}

export interface DormantJupiterLendSolanaTranscriptCandidate {
  readonly schemaVersion: 1;
  readonly sourceId: 'JUPITER_LEND_SOLANA_FINALIZED_JSON_RPC_TRANSCRIPT';
  readonly use: 'DORMANT_JUPITER_LEND_USDC_EARN_CORROBORATION_ONLY';
  readonly providerId: 'jupiter';
  readonly protocolId: 'jupiter-lend';
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
  readonly selectionStatus: 'OFFICIAL_PDA_IDENTITIES_PINNED_CALLER_DEPLOYMENT_FINGERPRINT_REQUIRED';
  readonly freshnessStatus: 'CURRENT_WITHIN_CALLER_MANIFEST_BOUND';
  readonly yieldEvidenceStatus: 'RAW_EXCHANGE_PRICES_ONLY_NOT_APR_OR_APY';
  readonly liquidityEvidenceStatus: 'ABSENT_NOT_CAPACITY';
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
    readonly programDataBinarySha256: string;
    readonly programDataAccountLengthBytes: string;
    readonly lastDeployedSlot: string;
    readonly upgradeAuthorityAddress: string | null;
    readonly upgradeAuthorityStatus: 'REVOKED_CALLER_PINNED' | 'PRESENT_CALLER_PINNED';
  }>;
  readonly market: Readonly<{
    readonly lendingAddress: typeof LENDING_ADDRESS;
    readonly lendingId: string;
    readonly fTokenMintAddress: typeof F_TOKEN_MINT_ADDRESS;
    readonly rewardsRateModelAddress: typeof ID.usdcRewardsRateModelAddress;
    readonly tokenReserveAddress: typeof ID.usdcTokenReserveAddress;
    readonly supplyPositionAddress: typeof ID.usdcSupplyPositionAddress;
    readonly liquidityProgramAddress: typeof ID.liquidityProgramAddress;
    readonly rewardsRateModelProgramAddress: typeof ID.rewardsRateModelProgramAddress;
    readonly lastUpdateTimestamp: string;
    readonly liquidityExchangePriceRaw: string;
    readonly tokenExchangePriceRaw: string;
    readonly bump: '255';
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
  readonly receiptAsset: Readonly<{
    readonly symbol: 'jlUSDC';
    readonly mintAddress: typeof F_TOKEN_MINT_ADDRESS;
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

interface ParsedProgramData {
  readonly lastDeployedSlot: bigint;
  readonly upgradeAuthorityAddress: string | null;
  readonly binarySha256: string;
}

interface ParsedLending {
  readonly lendingId: bigint;
  readonly lastUpdateTimestamp: bigint;
  readonly liquidityExchangePrice: bigint;
  readonly tokenExchangePrice: bigint;
}

interface ParsedMint {
  readonly supply: bigint;
  readonly mintAuthorityAddress: string | null;
  readonly freezeAuthorityAddress: string | null;
}

interface SolanaBlock {
  readonly slot: number;
  readonly blockhash: string;
  readonly previousBlockhash: string;
  readonly parentSlot: number;
  readonly blockHeight: number;
  readonly blockTime: number;
}

export class JupiterLendSolanaTranscriptUnavailableError extends Error {
  readonly code = 'JUPITER_LEND_SOLANA_TRANSCRIPT_UNAVAILABLE' as const;

  constructor() {
    super('Jupiter Lend Solana transcript is unavailable');
    this.name = 'JupiterLendSolanaTranscriptUnavailableError';
  }
}

export function createJupiterLendSolanaManifest(value: unknown): JupiterLendSolanaManifest {
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
      'deployment',
      'market',
      'asset',
      ...(includesFingerprint ? ['manifestFingerprintSha256'] : []),
    ]);
    if (
      record.schemaVersion !== 1 ||
      record.use !== 'DORMANT_JUPITER_LEND_USDC_EARN_CORROBORATION_ONLY' ||
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
    const market = parseMarketManifest(record.market);
    const asset = parseAssetManifest(record.asset);
    const canonical = Object.freeze({
      schemaVersion: 1 as const,
      use: 'DORMANT_JUPITER_LEND_USDC_EARN_CORROBORATION_ONLY' as const,
      sources,
      assetRegistry,
      networkId: NETWORK_ID,
      genesisHash: GENESIS_HASH,
      commitment: 'finalized' as const,
      snapshotBinding: 'ONE_GET_MULTIPLE_ACCOUNTS_MIN_CONTEXT_SLOT' as const,
      maximumAgeSeconds,
      deployment,
      market,
      asset,
    });
    const manifestFingerprintSha256 = fingerprint(
      'crypto-lending:jupiter-lend-solana-manifest:v1',
      [canonical],
    );
    if (
      includesFingerprint &&
      (typeof record.manifestFingerprintSha256 !== 'string' ||
        record.manifestFingerprintSha256 !== manifestFingerprintSha256)
    ) {
      return unavailable();
    }
    return Object.freeze({ ...canonical, manifestFingerprintSha256 });
  } catch (error) {
    if (error instanceof JupiterLendSolanaTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

/**
 * Dormant parser for a caller-supplied Solana JSON-RPC transcript. The caller
 * must independently bind the deployment fingerprint. This class is
 * intentionally absent from dependency injection and owns no network client.
 */
export class JupiterLendSolanaFinalizedTranscriptAdapter {
  private readonly manifest!: JupiterLendSolanaManifest;

  constructor(
    manifest: unknown,
    requiredManifestFingerprintSha256: string,
    private readonly transport: JupiterLendSolanaJsonRpcTranscriptTransport,
    private readonly clock: JupiterLendSolanaTranscriptClock,
  ) {
    try {
      this.manifest = createJupiterLendSolanaManifest(manifest);
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
      if (error instanceof JupiterLendSolanaTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }

  async read(
    request: ReadJupiterLendSolanaTranscriptRequest,
  ): Promise<DormantJupiterLendSolanaTranscriptCandidate> {
    try {
      assertBoundedData(request, REQUEST_BOUNDS);
      const requested = exactDataRecord(request, [
        'marketId',
        'programAddress',
        'lendingAddress',
        'assetMintAddress',
        'receiptMintAddress',
      ]);
      if (
        requested.marketId !== MARKET_ID ||
        requested.programAddress !== PROGRAM_ADDRESS ||
        requested.lendingAddress !== LENDING_ADDRESS ||
        requested.assetMintAddress !== USDC_MINT_ADDRESS ||
        requested.receiptMintAddress !== F_TOKEN_MINT_ADDRESS
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
            LENDING_ADDRESS,
            USDC_MINT_ADDRESS,
            F_TOKEN_MINT_ADDRESS,
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
        lendingAccount,
        assetMintAccount,
        receiptMintAccount,
      ] = accountResult.accounts;
      if (
        programAccount === undefined ||
        programDataAccount === undefined ||
        lendingAccount === undefined ||
        assetMintAccount === undefined ||
        receiptMintAccount === undefined
      ) {
        return unavailable();
      }

      parseProgram(programAccount.data, this.manifest.deployment.programDataAddress);
      const programData = parseProgramData(
        programDataAccount.data,
        accountResult.slot,
        this.manifest,
      );
      const lending = parseLending(lendingAccount.data, this.manifest);
      const assetMint = parseMint(assetMintAccount.data);
      const receiptMint = parseMint(receiptMintAccount.data);
      if (
        receiptMint.mintAuthorityAddress !==
          this.manifest.market.expectedFTokenMintAuthorityAddress ||
        receiptMint.freezeAuthorityAddress !==
          this.manifest.market.expectedFTokenFreezeAuthorityAddress
      ) {
        return unavailable();
      }

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
      assertFresh(lending.lastUpdateTimestamp, now.milliseconds, maximumAgeSeconds);
      const earliestSourceTime =
        BigInt(blockBefore.blockTime) < lending.lastUpdateTimestamp
          ? BigInt(blockBefore.blockTime)
          : lending.lastUpdateTimestamp;
      const staleAfter = unixSecondsToTimestamp(earliestSourceTime + maximumAgeSeconds);

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
        programDataBinarySha256: programData.binarySha256,
        programDataAccountLengthBytes: programDataAccount.data.byteLength.toString(10),
        lastDeployedSlot: programData.lastDeployedSlot.toString(10),
        upgradeAuthorityAddress: programData.upgradeAuthorityAddress,
        upgradeAuthorityStatus:
          programData.upgradeAuthorityAddress === null
            ? ('REVOKED_CALLER_PINNED' as const)
            : ('PRESENT_CALLER_PINNED' as const),
      });
      const market = Object.freeze({
        lendingAddress: LENDING_ADDRESS,
        lendingId: lending.lendingId.toString(10),
        fTokenMintAddress: F_TOKEN_MINT_ADDRESS,
        rewardsRateModelAddress: ID.usdcRewardsRateModelAddress,
        tokenReserveAddress: ID.usdcTokenReserveAddress,
        supplyPositionAddress: ID.usdcSupplyPositionAddress,
        liquidityProgramAddress: ID.liquidityProgramAddress,
        rewardsRateModelProgramAddress: ID.rewardsRateModelProgramAddress,
        lastUpdateTimestamp: lending.lastUpdateTimestamp.toString(10),
        liquidityExchangePriceRaw: lending.liquidityExchangePrice.toString(10),
        tokenExchangePriceRaw: lending.tokenExchangePrice.toString(10),
        bump: '255' as const,
        accountDataSha256: lendingAccount.dataSha256,
      });
      const asset = Object.freeze({
        stablecoin: 'USDC' as const,
        mintAddress: USDC_MINT_ADDRESS,
        tokenProgramAddress: TOKEN_PROGRAM_ADDRESS,
        decimals: 6 as const,
        initialized: true as const,
        supplyAtomicRaw: assetMint.supply.toString(10),
        mintAuthorityAddress: assetMint.mintAuthorityAddress,
        freezeAuthorityAddress: assetMint.freezeAuthorityAddress,
        accountDataSha256: assetMintAccount.dataSha256,
      });
      const receiptAsset = Object.freeze({
        symbol: 'jlUSDC' as const,
        mintAddress: F_TOKEN_MINT_ADDRESS,
        tokenProgramAddress: TOKEN_PROGRAM_ADDRESS,
        decimals: 6 as const,
        initialized: true as const,
        supplyAtomicRaw: receiptMint.supply.toString(10),
        mintAuthorityAddress: receiptMint.mintAuthorityAddress,
        freezeAuthorityAddress: receiptMint.freezeAuthorityAddress,
        accountDataSha256: receiptMintAccount.dataSha256,
      });

      return Object.freeze({
        schemaVersion: 1,
        sourceId: 'JUPITER_LEND_SOLANA_FINALIZED_JSON_RPC_TRANSCRIPT',
        use: 'DORMANT_JUPITER_LEND_USDC_EARN_CORROBORATION_ONLY',
        providerId: 'jupiter',
        protocolId: 'jupiter-lend',
        networkId: NETWORK_ID,
        marketId: MARKET_ID,
        manifestFingerprintSha256: this.manifest.manifestFingerprintSha256,
        transcriptFingerprintSha256: fingerprint(
          'crypto-lending:jupiter-lend-solana-finalized-transcript:v1',
          [
            this.manifest.manifestFingerprintSha256,
            snapshot,
            deployment,
            market,
            asset,
            receiptAsset,
            programAccount.dataSha256,
            programDataAccount.dataSha256,
            now.timestamp,
          ],
        ),
        observedAt: now.timestamp,
        staleAfter,
        sourcePosition: accountResult.slot.toString(10),
        sourceFinality: 'SOLANA_FINALIZED_SLOT',
        sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED',
        sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT',
        selectionStatus: 'OFFICIAL_PDA_IDENTITIES_PINNED_CALLER_DEPLOYMENT_FINGERPRINT_REQUIRED',
        freshnessStatus: 'CURRENT_WITHIN_CALLER_MANIFEST_BOUND',
        yieldEvidenceStatus: 'RAW_EXCHANGE_PRICES_ONLY_NOT_APR_OR_APY',
        liquidityEvidenceStatus: 'ABSENT_NOT_CAPACITY',
        persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_AND_RISK_VERIFICATION',
        mayPersist: false,
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
        snapshot,
        deployment,
        market,
        asset,
        receiptAsset,
      });
    } catch (error) {
      if (error instanceof JupiterLendSolanaTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }

  private async rpc(
    id: number,
    method: JupiterLendSolanaJsonRpcRequest['method'],
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

function parseSources(value: unknown): JupiterLendSolanaManifest['sources'] {
  const record = exactDataRecord(value, [
    'docsRepository',
    'docsCommitSha',
    'integrationRepository',
    'integrationCommitSha',
    'lendingIdlPath',
    'lendingIdlSha256',
    'lendingIdlByteLength',
    'lendingIdlVersion',
    'readSdkPackage',
    'readSdkVersion',
    'readSdkTarballSha256',
    'readSdkTarballByteLength',
    'lendingLayout',
    'loaderLayout',
    'mintLayout',
  ]);
  const source = JUPITER_LEND_SOLANA_SOURCE_PINS;
  if (
    record.docsRepository !== source.docsRepository ||
    typeof record.docsCommitSha !== 'string' ||
    !COMMIT_SHA.test(record.docsCommitSha) ||
    record.integrationRepository !== source.integrationRepository ||
    typeof record.integrationCommitSha !== 'string' ||
    !COMMIT_SHA.test(record.integrationCommitSha) ||
    typeof record.lendingIdlSha256 !== 'string' ||
    !SHA256.test(record.lendingIdlSha256) ||
    typeof record.readSdkTarballSha256 !== 'string' ||
    !SHA256.test(record.readSdkTarballSha256) ||
    record.docsCommitSha !== source.docsCommitSha ||
    record.integrationCommitSha !== source.integrationCommitSha ||
    record.lendingIdlPath !== source.lendingIdlPath ||
    record.lendingIdlSha256 !== source.lendingIdlSha256 ||
    record.lendingIdlByteLength !== source.lendingIdlByteLength ||
    record.lendingIdlVersion !== source.lendingIdlVersion ||
    record.readSdkPackage !== source.readSdkPackage ||
    record.readSdkVersion !== source.readSdkVersion ||
    record.readSdkTarballSha256 !== source.readSdkTarballSha256 ||
    record.readSdkTarballByteLength !== source.readSdkTarballByteLength ||
    record.lendingLayout !== source.lendingLayout ||
    record.loaderLayout !== source.loaderLayout ||
    record.mintLayout !== source.mintLayout
  ) {
    return unavailable();
  }
  return Object.freeze({
    docsRepository: source.docsRepository,
    docsCommitSha: source.docsCommitSha,
    integrationRepository: source.integrationRepository,
    integrationCommitSha: source.integrationCommitSha,
    lendingIdlPath: source.lendingIdlPath,
    lendingIdlSha256: source.lendingIdlSha256,
    lendingIdlByteLength: source.lendingIdlByteLength,
    lendingIdlVersion: source.lendingIdlVersion,
    readSdkPackage: source.readSdkPackage,
    readSdkVersion: source.readSdkVersion,
    readSdkTarballSha256: source.readSdkTarballSha256,
    readSdkTarballByteLength: source.readSdkTarballByteLength,
    lendingLayout: source.lendingLayout,
    loaderLayout: source.loaderLayout,
    mintLayout: source.mintLayout,
  });
}

function parseAssetRegistry(value: unknown): JupiterLendSolanaManifest['assetRegistry'] {
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

function parseDeployment(value: unknown): JupiterLendSolanaManifest['deployment'] {
  const record = exactDataRecord(value, [
    'programAddress',
    'programDataAddress',
    'programDataAccountLengthBytes',
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
  if (
    record.programAddress !== PROGRAM_ADDRESS ||
    programDataAddress === PROGRAM_ADDRESS ||
    programDataAddress === LENDING_ADDRESS ||
    programDataAddress === F_TOKEN_MINT_ADDRESS ||
    programDataAddress === USDC_MINT_ADDRESS ||
    programDataAccountLengthBytes <= BigInt(PROGRAMDATA_METADATA_BYTES) ||
    typeof record.programDataBinarySha256 !== 'string' ||
    !SHA256.test(record.programDataBinarySha256) ||
    record.programDataBinarySha256 === ZERO_SHA256
  ) {
    return unavailable();
  }
  return Object.freeze({
    programAddress: PROGRAM_ADDRESS,
    programDataAddress,
    programDataAccountLengthBytes: programDataAccountLengthBytes.toString(10),
    programDataBinarySha256: record.programDataBinarySha256,
    expectedLastDeployedSlot: expectedLastDeployedSlot.toString(10),
    expectedUpgradeAuthorityAddress,
  });
}

function parseMarketManifest(value: unknown): JupiterLendSolanaManifest['market'] {
  const record = exactDataRecord(value, [
    'marketId',
    'lendingAddress',
    'fTokenMintAddress',
    'expectedLendingId',
    'expectedFTokenMintAuthorityAddress',
    'expectedFTokenFreezeAuthorityAddress',
  ]);
  const expectedLendingId = positiveCanonicalInteger(record.expectedLendingId, MAX_UINT16);
  const expectedFTokenMintAuthorityAddress =
    record.expectedFTokenMintAuthorityAddress === null
      ? null
      : publicKey(record.expectedFTokenMintAuthorityAddress);
  const expectedFTokenFreezeAuthorityAddress =
    record.expectedFTokenFreezeAuthorityAddress === null
      ? null
      : publicKey(record.expectedFTokenFreezeAuthorityAddress);
  if (
    record.marketId !== MARKET_ID ||
    record.lendingAddress !== LENDING_ADDRESS ||
    record.fTokenMintAddress !== F_TOKEN_MINT_ADDRESS
  ) {
    return unavailable();
  }
  return Object.freeze({
    marketId: MARKET_ID,
    lendingAddress: LENDING_ADDRESS,
    fTokenMintAddress: F_TOKEN_MINT_ADDRESS,
    expectedLendingId: expectedLendingId.toString(10),
    expectedFTokenMintAuthorityAddress,
    expectedFTokenFreezeAuthorityAddress,
  });
}

function parseAssetManifest(value: unknown): JupiterLendSolanaManifest['asset'] {
  const record = exactDataRecord(value, [
    'stablecoin',
    'mintAddress',
    'decimals',
    'tokenProgramAddress',
  ]);
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
  });
}

function parseMultipleAccountsResult(
  value: unknown,
  minimumContextSlot: number,
  manifest: JupiterLendSolanaManifest,
): Readonly<{ slot: number; accounts: readonly ParsedAccount[] }> {
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
    Object.freeze({ owner: PROGRAM_ADDRESS, executable: false, bytes: LENDING_ACCOUNT_BYTES }),
    Object.freeze({ owner: TOKEN_PROGRAM_ADDRESS, executable: false, bytes: MINT_ACCOUNT_BYTES }),
    Object.freeze({ owner: TOKEN_PROGRAM_ADDRESS, executable: false, bytes: MINT_ACCOUNT_BYTES }),
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
  return Object.freeze({
    owner,
    executable: expectedExecutable,
    data,
    dataSha256: sha256(data),
  });
}

function parseProgram(data: Uint8Array, expectedProgramDataAddress: string): void {
  if (readU32(data, 0) !== 2 || readPublicKey(data, 4) !== expectedProgramDataAddress) {
    return unavailable();
  }
}

function parseProgramData(
  data: Uint8Array,
  snapshotSlot: number,
  manifest: JupiterLendSolanaManifest,
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
    if (!isZeroBytes(data.subarray(13, 45))) return unavailable();
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

function parseLending(data: Uint8Array, manifest: JupiterLendSolanaManifest): ParsedLending {
  if (!bytesEqual(data.subarray(0, 8), LENDING_DISCRIMINATOR)) return unavailable();
  const mint = readPublicKey(data, 8);
  const fTokenMint = readPublicKey(data, 40);
  const lendingId = BigInt(readU16(data, 72));
  const decimals = byteAt(data, 74);
  const rewardsRateModel = readPublicKey(data, 75);
  const liquidityExchangePrice = readU64(data, 107);
  const tokenExchangePrice = readU64(data, 115);
  const lastUpdateTimestamp = readU64(data, 123);
  const tokenReserve = readPublicKey(data, 131);
  const supplyPosition = readPublicKey(data, 163);
  const bump = byteAt(data, 195);
  if (
    mint !== USDC_MINT_ADDRESS ||
    fTokenMint !== F_TOKEN_MINT_ADDRESS ||
    lendingId === 0n ||
    lendingId.toString(10) !== manifest.market.expectedLendingId ||
    decimals !== 6 ||
    rewardsRateModel !== ID.usdcRewardsRateModelAddress ||
    liquidityExchangePrice === 0n ||
    tokenExchangePrice === 0n ||
    lastUpdateTimestamp === 0n ||
    tokenReserve !== ID.usdcTokenReserveAddress ||
    supplyPosition !== ID.usdcSupplyPositionAddress ||
    bump !== 255
  ) {
    return unavailable();
  }
  return Object.freeze({
    lendingId,
    lastUpdateTimestamp,
    liquidityExchangePrice,
    tokenExchangePrice,
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

function readU16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.byteLength) return unavailable();
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true);
}

function readU32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.byteLength) return unavailable();
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function readU64(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.byteLength) return unavailable();
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
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
    if (error instanceof JupiterLendSolanaTranscriptUnavailableError) throw error;
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

/** Traverses property descriptors and rejects accessors without invoking them. */
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
    if (error instanceof JupiterLendSolanaTranscriptUnavailableError) throw error;
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
    if (error instanceof JupiterLendSolanaTranscriptUnavailableError) throw error;
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
  throw new JupiterLendSolanaTranscriptUnavailableError();
}
