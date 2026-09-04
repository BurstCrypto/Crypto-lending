import { createHash } from 'node:crypto';

import { keccak256, type Hex } from 'viem';

import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  SUPPORTED_STABLECOINS,
  type SupportedStablecoin,
} from '../../../blockchain/domain/supported-asset-registry';

export const EULER_V2_ETHEREUM_SOURCE_PINS = Object.freeze({
  eulerInterfacesCommitSha: 'd0e9a428523b3de6cb3e6c7a06ad55b6e59223f3',
  eulerChainsContentSha256: '20ca447e2f1236210c63e71b616de7a7ef0b33f26c327c89b70ff1d08547b288',
  eulerVaultKitCommitSha: '9e3c760e051f5d769f7c6edb9be30198a55117d4',
} as const);

export const EULER_V2_ETHEREUM_IDENTITIES = Object.freeze({
  factory: '0x29a56a1b8214d9cf7c5561811750d5cbdb45cc8e',
  implementation: '0x8ff1c814719096b61abf00bb46ead0c9a529dd7d',
  evc: '0x0c9a3dd6b8f28529d72d7f9ce918d493519ee383',
  protocolConfig: '0x4cd6bf1d183264c02be7748cb5cd3a47d013351b',
  sequenceRegistry: '0xeaddd21618ad5deb412d3fd23580fd461c106b54',
  balanceTracker: '0x0d52d06ceb8dcdeeb40cfd9f17489b350dd7f8a3',
  permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3',
  modules: Object.freeze({
    token: '0x8a58aecbe677682d0f037c67f37f5a7a2e94973c',
    vault: '0xb4ad4d9c02c01b01cf586c16f01c58c73c7f0188',
    borrowing: '0x639156f8feb0cd88205e4861a0224ec169605acf',
    governance: '0xa61f5016f2cd5cec12d091f871fce1e1df5f0b67',
  }),
} as const);

export const EULER_V2_ETHEREUM_SELECTORS = Object.freeze({
  factoryImplementation: '0x5c60da1b',
  factoryIsProxy: '0x29710388',
  factoryGetProxyConfig: '0xa20ea5c1',
  asset: '0x38d52e0f',
  decimals: '0x313ce567',
  evc: '0xa70354a1',
  protocolConfigAddress: '0x539bd5bf',
  balanceTrackerAddress: '0xece6a7fa',
  permit2Address: '0xc5224983',
  oracle: '0x7dc0d1d0',
  unitOfAccount: '0x3e833364',
  interestRateModel: '0xf3fdb15a',
  governorAdmin: '0x6ce98c29',
  hookConfig: '0xcf349b7d',
  configFlags: '0x2b38a367',
  caps: '0x18e22d98',
  moduleToken: '0x5fa23055',
  moduleVault: '0xe2f206e5',
  moduleBorrowing: '0x14c054bc',
  moduleGovernance: '0xb4cd541b',
  totalAssets: '0x01e1d114',
  totalSupply: '0x18160ddd',
  cash: '0x961be391',
  totalBorrows: '0x47bd3718',
  convertToAssets: '0x07a2d13a',
  convertToShares: '0xc6e6f592',
  previewDeposit: '0xef8b30f7',
  maxDeposit: '0x402d267d',
} as const);

const NETWORK_ID = 'eip155:1' as const;
const CHAIN_ID = '0x1' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_WORD = `0x${'0'.repeat(64)}`;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const MARKET_ID = /^euler-v2-ethereum-mainnet:0x[0-9a-f]{40}$/u;
const MAX_UINT16 = (1n << 16n) - 1n;
const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT112 = (1n << 112n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_TOTAL_ASSETS = MAX_UINT112 * 2n;
const MAX_UNIX_SECONDS = 253_402_300_799n;
const MAX_RUNTIME_CODE_BYTES = 49_152;
const MAX_FINALIZED_BLOCK_AGE_SECONDS = 3_600n;
const CONVERSION_SAMPLE_ATOMIC = 1_000_000n;
const VIRTUAL_DEPOSIT_ATOMIC = 1_000_000n;
const RESPONSE_BOUNDS = Object.freeze({
  maximumBytes: 2 * 1024 * 1024,
  maximumNodes: 120_000,
  maximumDepth: 16,
  maximumArrayLength: 100_000,
});
const MANIFEST_BOUNDS = Object.freeze({
  maximumBytes: 48 * 1024,
  maximumNodes: 256,
  maximumDepth: 10,
  maximumArrayLength: 0,
});
const REQUEST_BOUNDS = Object.freeze({
  maximumBytes: 1_024,
  maximumNodes: 8,
  maximumDepth: 2,
  maximumArrayLength: 0,
});
const BLOCK_KEYS = Object.freeze([
  'baseFeePerGas',
  'blobGasUsed',
  'difficulty',
  'excessBlobGas',
  'extraData',
  'gasLimit',
  'gasUsed',
  'hash',
  'logsBloom',
  'miner',
  'mixHash',
  'nonce',
  'number',
  'parentBeaconBlockRoot',
  'parentHash',
  'receiptsRoot',
  'requestsHash',
  'sha3Uncles',
  'size',
  'stateRoot',
  'timestamp',
  'totalDifficulty',
  'transactions',
  'transactionsRoot',
  'uncles',
  'withdrawals',
  'withdrawalsRoot',
] as const);

export interface EulerV2EthereumJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call';
  readonly params: readonly unknown[];
}

/** Owns no endpoint, client, retry, credentials, DNS, TLS, or egress policy. */
export interface EulerV2EthereumJsonRpcTranscriptTransport {
  exchange(request: EulerV2EthereumJsonRpcRequest): Promise<unknown>;
}

export interface EulerV2EthereumTranscriptClock {
  now(): Date;
}

export interface EulerV2CodeIdentityDefinition {
  readonly address: string;
  readonly runtimeCodeKeccak256: string;
}

export interface EulerV2EthereumVaultManifestDefinition {
  readonly schemaVersion: 1;
  readonly use: 'DORMANT_EULER_V2_VAULT_CORROBORATION_ONLY';
  readonly sources: Readonly<{
    readonly eulerInterfacesCommitSha: string;
    readonly eulerChainsContentSha256: string;
    readonly eulerVaultKitCommitSha: string;
  }>;
  readonly registryVersion: 1;
  readonly registryFingerprintSha256: string;
  readonly networkId: 'eip155:1';
  readonly chainId: '0x1';
  readonly blockSelector: 'finalized';
  readonly blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL';
  /** Caller-owned freshness bound. This repository supplies no production value. */
  readonly maximumFinalizedBlockAgeSeconds: string;
  readonly deployment: Readonly<{
    readonly factory: EulerV2CodeIdentityDefinition;
    readonly implementation: EulerV2CodeIdentityDefinition;
    readonly evc: EulerV2CodeIdentityDefinition;
    readonly protocolConfig: EulerV2CodeIdentityDefinition;
    readonly sequenceRegistry: EulerV2CodeIdentityDefinition;
    readonly balanceTracker: EulerV2CodeIdentityDefinition;
    readonly permit2: EulerV2CodeIdentityDefinition;
    readonly modules: Readonly<{
      readonly token: EulerV2CodeIdentityDefinition;
      readonly vault: EulerV2CodeIdentityDefinition;
      readonly borrowing: EulerV2CodeIdentityDefinition;
      readonly governance: EulerV2CodeIdentityDefinition;
    }>;
  }>;
  readonly vault: Readonly<{
    readonly marketId: string;
    readonly vaultAddress: string;
    readonly vaultRuntimeCodeKeccak256: string;
    readonly proxyKind: 'IMMUTABLE_META_PROXY';
    readonly upgradeable: false;
    readonly stablecoin: SupportedStablecoin;
    readonly assetAddress: string;
    readonly assetRuntimeCodeKeccak256: string;
    readonly oracleAddress: string;
    readonly oracleRuntimeCodeKeccak256: string;
    readonly unitOfAccountAddress: string;
    readonly interestRateModelAddress: string;
    readonly interestRateModelRuntimeCodeKeccak256: string;
    readonly depositProbeAccount: string;
    readonly expectedConfigFlags: string;
    readonly expectedSupplyCapRaw: string;
    readonly expectedBorrowCapRaw: string;
  }>;
}

export interface EulerV2EthereumVaultManifest extends EulerV2EthereumVaultManifestDefinition {
  readonly manifestFingerprintSha256: string;
}

export interface ReadEulerV2EthereumVaultTranscriptRequest {
  readonly marketId: string;
  readonly vaultAddress: string;
  readonly stablecoin: SupportedStablecoin;
}

export interface DormantEulerV2EthereumVaultTranscriptCandidate {
  readonly schemaVersion: 1;
  readonly sourceId: 'EULER_V2_ETHEREUM_FINALIZED_JSON_RPC_TRANSCRIPT';
  readonly use: 'DORMANT_EULER_V2_VAULT_CORROBORATION_ONLY';
  readonly providerId: 'euler';
  readonly protocolId: 'euler-v2';
  readonly networkId: 'eip155:1';
  readonly marketId: string;
  readonly manifestFingerprintSha256: string;
  readonly transcriptFingerprintSha256: string;
  readonly observedAt: string;
  readonly staleAfter: string;
  readonly sourcePosition: string;
  readonly sourceFinality: 'ETHEREUM_FINALIZED_BLOCK';
  readonly sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED';
  readonly sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT';
  readonly freshnessStatus: 'CURRENT_WITHIN_CALLER_MANIFEST_BOUND';
  readonly yieldEvidenceStatus: 'ABSENT_NOT_COMPUTED';
  readonly liquidityEvidenceStatus: 'NOT_ESTABLISHED_BY_CASH_CAP_OR_MAX_DEPOSIT';
  readonly persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_AND_RISK_VERIFICATION';
  readonly mayPersist: false;
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly block: Readonly<{
    readonly number: string;
    readonly hash: string;
    readonly parentHash: string;
    readonly stateRoot: string;
    readonly timestamp: string;
  }>;
  readonly deployment: Readonly<{
    readonly factory: string;
    readonly implementation: string;
    readonly proxyKind: 'IMMUTABLE_META_PROXY';
    readonly factoryRecognizedProxy: true;
    readonly upgradeable: false;
    readonly governorFinalized: true;
  }>;
  readonly vault: Readonly<{
    readonly address: string;
    readonly stablecoin: SupportedStablecoin;
    readonly assetAddress: string;
    readonly decimals: 6;
    readonly oracleAddress: string;
    readonly unitOfAccountAddress: string;
    readonly interestRateModelAddress: string;
    readonly hookTarget: typeof ZERO_ADDRESS;
    readonly hookedOperations: '0';
    readonly configFlags: string;
  }>;
  readonly rawState: Readonly<{
    readonly totalAssetsAtomic: string;
    readonly totalSupplySharesAtomic: string;
    readonly cashAtomic: string;
    readonly totalBorrowsAtomic: string;
    readonly supplyCapRaw: string;
    readonly supplyCapResolvedAtomic: string;
    readonly borrowCapRaw: string;
    readonly borrowCapResolvedAtomic: string;
    /** Account-scoped method output, not a liquidity/capacity claim. */
    readonly maxDepositProbeAtomic: string;
  }>;
  readonly conversionEvidence: Readonly<{
    readonly sampleAtomic: '1000000';
    readonly sharesToAssetsAtomic: string;
    readonly assetsToSharesAtomic: string;
    readonly previewDepositSharesAtomic: string;
    readonly semantics: 'EVK_PINNED_VIRTUAL_DEPOSIT_INTEGER_ROUND_DOWN_MATCHED';
  }>;
}

interface EthereumBlockHeader {
  readonly number: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly stateRoot: string;
  readonly timestamp: string;
}

interface ProxyConfig {
  readonly upgradeable: boolean;
  readonly implementation: string;
  readonly trailingData: string;
}

interface CodeObservation {
  readonly role: string;
  readonly address: string;
  readonly runtimeCodeKeccak256: string;
}

export class EulerV2EthereumTranscriptUnavailableError extends Error {
  readonly code = 'EULER_V2_ETHEREUM_TRANSCRIPT_UNAVAILABLE' as const;

  constructor() {
    super('Euler V2 Ethereum transcript is unavailable');
    this.name = 'EulerV2EthereumTranscriptUnavailableError';
  }
}

export function createEulerV2EthereumVaultManifest(value: unknown): EulerV2EthereumVaultManifest {
  try {
    assertBoundedData(value, MANIFEST_BOUNDS);
    const raw = dataRecord(value);
    const includesFingerprint = Object.hasOwn(raw, 'manifestFingerprintSha256');
    const record = exactDataRecord(value, [
      'schemaVersion',
      'use',
      'sources',
      'registryVersion',
      'registryFingerprintSha256',
      'networkId',
      'chainId',
      'blockSelector',
      'blockBinding',
      'maximumFinalizedBlockAgeSeconds',
      'deployment',
      'vault',
      ...(includesFingerprint ? ['manifestFingerprintSha256'] : []),
    ]);
    const registryFingerprint = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256;
    if (
      record.schemaVersion !== 1 ||
      record.use !== 'DORMANT_EULER_V2_VAULT_CORROBORATION_ONLY' ||
      record.registryVersion !== 1 ||
      record.registryFingerprintSha256 !== registryFingerprint ||
      record.networkId !== NETWORK_ID ||
      record.chainId !== CHAIN_ID ||
      record.blockSelector !== 'finalized' ||
      record.blockBinding !== 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL'
    ) {
      return unavailable();
    }
    const sources = parseSources(record.sources);
    const maximumFinalizedBlockAgeSeconds = positiveCanonicalInteger(
      record.maximumFinalizedBlockAgeSeconds,
      MAX_FINALIZED_BLOCK_AGE_SECONDS,
    ).toString(10);
    const deployment = parseDeployment(record.deployment);
    const vault = parseVault(record.vault);
    const canonical = Object.freeze({
      schemaVersion: 1 as const,
      use: 'DORMANT_EULER_V2_VAULT_CORROBORATION_ONLY' as const,
      sources,
      registryVersion: 1 as const,
      registryFingerprintSha256: registryFingerprint,
      networkId: NETWORK_ID,
      chainId: CHAIN_ID,
      blockSelector: 'finalized' as const,
      blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const,
      maximumFinalizedBlockAgeSeconds,
      deployment,
      vault,
    });
    const manifestFingerprintSha256 = fingerprint(
      'crypto-lending:euler-v2-ethereum-vault-manifest:v1',
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
    if (error instanceof EulerV2EthereumTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

/**
 * Dormant, single-source transcript parser. A matching manifest fingerprint is
 * only a substitution guard, never approval or source authentication. No
 * transport or persistence path is registered by this file.
 */
export class EulerV2EthereumFinalizedTranscriptAdapter {
  private readonly manifest!: EulerV2EthereumVaultManifest;

  constructor(
    manifest: unknown,
    requiredManifestFingerprintSha256: string,
    private readonly transport: EulerV2EthereumJsonRpcTranscriptTransport,
    private readonly clock: EulerV2EthereumTranscriptClock,
  ) {
    try {
      this.manifest = createEulerV2EthereumVaultManifest(manifest);
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
      if (error instanceof EulerV2EthereumTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }

  async read(
    request: ReadEulerV2EthereumVaultTranscriptRequest,
  ): Promise<DormantEulerV2EthereumVaultTranscriptCandidate> {
    try {
      assertBoundedData(request, REQUEST_BOUNDS);
      const requested = exactDataRecord(request, ['marketId', 'vaultAddress', 'stablecoin']);
      const vault = this.manifest.vault;
      if (
        requested.marketId !== vault.marketId ||
        requested.vaultAddress !== vault.vaultAddress ||
        requested.stablecoin !== vault.stablecoin
      ) {
        return unavailable();
      }

      if ((await this.rpc(1, 'eth_chainId', [])) !== CHAIN_ID) return unavailable();
      const before = parseBlock(
        await this.rpc(2, 'eth_getBlockByNumber', [this.manifest.blockSelector, false]),
      );
      const blockParameter = Object.freeze({ blockHash: before.hash, requireCanonical: true });

      const codeObservations: CodeObservation[] = [];
      let nextId = 3;
      for (const [role, identity] of deploymentCodeIdentities(this.manifest.deployment)) {
        codeObservations.push(await this.checkedCode(nextId, role, identity, blockParameter));
        nextId += 1;
      }
      for (const [role, identity] of vaultCodeIdentities(vault)) {
        codeObservations.push(await this.checkedCode(nextId, role, identity, blockParameter));
        nextId += 1;
      }

      const deployment = this.manifest.deployment;
      if (
        decodeAddress(
          await this.call(
            nextId++,
            deployment.factory.address,
            EULER_V2_ETHEREUM_SELECTORS.factoryImplementation,
            blockParameter,
          ),
        ) !== deployment.implementation.address
      ) {
        return unavailable();
      }
      const isProxyData = `${EULER_V2_ETHEREUM_SELECTORS.factoryIsProxy}${addressWord(
        vault.vaultAddress,
      )}`;
      if (
        !decodeBoolean(
          await this.call(nextId++, deployment.factory.address, isProxyData, blockParameter),
        )
      ) {
        return unavailable();
      }
      const proxyConfigData = `${EULER_V2_ETHEREUM_SELECTORS.factoryGetProxyConfig}${addressWord(
        vault.vaultAddress,
      )}`;
      const proxyConfig = decodeProxyConfig(
        await this.call(nextId++, deployment.factory.address, proxyConfigData, blockParameter),
      );
      const expectedTrailingData = `${vault.assetAddress.slice(2)}${vault.oracleAddress.slice(
        2,
      )}${vault.unitOfAccountAddress.slice(2)}`;
      if (
        proxyConfig.upgradeable ||
        proxyConfig.implementation !== deployment.implementation.address ||
        proxyConfig.trailingData !== `0x${expectedTrailingData}`
      ) {
        return unavailable();
      }

      const expectedAddresses = [
        [EULER_V2_ETHEREUM_SELECTORS.asset, vault.assetAddress],
        [EULER_V2_ETHEREUM_SELECTORS.evc, deployment.evc.address],
        [EULER_V2_ETHEREUM_SELECTORS.protocolConfigAddress, deployment.protocolConfig.address],
        [EULER_V2_ETHEREUM_SELECTORS.balanceTrackerAddress, deployment.balanceTracker.address],
        [EULER_V2_ETHEREUM_SELECTORS.permit2Address, deployment.permit2.address],
        [EULER_V2_ETHEREUM_SELECTORS.oracle, vault.oracleAddress],
        [EULER_V2_ETHEREUM_SELECTORS.unitOfAccount, vault.unitOfAccountAddress],
        [EULER_V2_ETHEREUM_SELECTORS.interestRateModel, vault.interestRateModelAddress],
        [EULER_V2_ETHEREUM_SELECTORS.moduleToken, deployment.modules.token.address],
        [EULER_V2_ETHEREUM_SELECTORS.moduleVault, deployment.modules.vault.address],
        [EULER_V2_ETHEREUM_SELECTORS.moduleBorrowing, deployment.modules.borrowing.address],
        [EULER_V2_ETHEREUM_SELECTORS.moduleGovernance, deployment.modules.governance.address],
      ] as const;
      for (const [selector, expectedAddress] of expectedAddresses) {
        if (
          decodeAddress(await this.call(nextId++, vault.vaultAddress, selector, blockParameter)) !==
          expectedAddress
        ) {
          return unavailable();
        }
      }
      if (
        decodeUint(
          await this.call(
            nextId++,
            vault.vaultAddress,
            EULER_V2_ETHEREUM_SELECTORS.decimals,
            blockParameter,
          ),
          255n,
        ) !== 6n ||
        decodeUint(
          await this.call(
            nextId++,
            vault.assetAddress,
            EULER_V2_ETHEREUM_SELECTORS.decimals,
            blockParameter,
          ),
          255n,
        ) !== 6n
      ) {
        return unavailable();
      }
      if (
        decodeAddress(
          await this.call(
            nextId++,
            vault.vaultAddress,
            EULER_V2_ETHEREUM_SELECTORS.governorAdmin,
            blockParameter,
          ),
        ) !== ZERO_ADDRESS
      ) {
        return unavailable();
      }
      const hookConfig = decodeAddressUint(
        await this.call(
          nextId++,
          vault.vaultAddress,
          EULER_V2_ETHEREUM_SELECTORS.hookConfig,
          blockParameter,
        ),
        MAX_UINT32,
      );
      if (hookConfig.address !== ZERO_ADDRESS || hookConfig.value !== 0n) return unavailable();
      const configFlags = decodeUint(
        await this.call(
          nextId++,
          vault.vaultAddress,
          EULER_V2_ETHEREUM_SELECTORS.configFlags,
          blockParameter,
        ),
        MAX_UINT32,
      );
      if (configFlags.toString(10) !== vault.expectedConfigFlags) return unavailable();
      const caps = decodeTwoUints(
        await this.call(
          nextId++,
          vault.vaultAddress,
          EULER_V2_ETHEREUM_SELECTORS.caps,
          blockParameter,
        ),
        MAX_UINT16,
      );
      if (
        caps[0].toString(10) !== vault.expectedSupplyCapRaw ||
        caps[1].toString(10) !== vault.expectedBorrowCapRaw
      ) {
        return unavailable();
      }
      const supplyCap = resolveFinitePositiveAmountCap(caps[0]);
      const borrowCap = resolveFinitePositiveAmountCap(caps[1]);

      const totalAssets = await this.uintCall(
        nextId++,
        vault.vaultAddress,
        EULER_V2_ETHEREUM_SELECTORS.totalAssets,
        blockParameter,
        MAX_TOTAL_ASSETS,
      );
      const totalSupply = await this.uintCall(
        nextId++,
        vault.vaultAddress,
        EULER_V2_ETHEREUM_SELECTORS.totalSupply,
        blockParameter,
        MAX_UINT112,
      );
      const cash = await this.uintCall(
        nextId++,
        vault.vaultAddress,
        EULER_V2_ETHEREUM_SELECTORS.cash,
        blockParameter,
        MAX_UINT112,
      );
      const totalBorrows = await this.uintCall(
        nextId++,
        vault.vaultAddress,
        EULER_V2_ETHEREUM_SELECTORS.totalBorrows,
        blockParameter,
        MAX_UINT112,
      );
      if (
        totalAssets === 0n ||
        totalSupply === 0n ||
        totalAssets !== cash + totalBorrows ||
        totalAssets >= supplyCap ||
        totalBorrows > borrowCap
      ) {
        return unavailable();
      }

      const convertToAssets = await this.uintCall(
        nextId++,
        vault.vaultAddress,
        `${EULER_V2_ETHEREUM_SELECTORS.convertToAssets}${uint256Word(CONVERSION_SAMPLE_ATOMIC)}`,
        blockParameter,
        MAX_UINT112,
      );
      const convertToShares = await this.uintCall(
        nextId++,
        vault.vaultAddress,
        `${EULER_V2_ETHEREUM_SELECTORS.convertToShares}${uint256Word(CONVERSION_SAMPLE_ATOMIC)}`,
        blockParameter,
        MAX_UINT112,
      );
      const previewDeposit = await this.uintCall(
        nextId++,
        vault.vaultAddress,
        `${EULER_V2_ETHEREUM_SELECTORS.previewDeposit}${uint256Word(CONVERSION_SAMPLE_ATOMIC)}`,
        blockParameter,
        MAX_UINT112,
      );
      const maxDeposit = await this.uintCall(
        nextId++,
        vault.vaultAddress,
        `${EULER_V2_ETHEREUM_SELECTORS.maxDeposit}${addressWord(vault.depositProbeAccount)}`,
        blockParameter,
        MAX_UINT112,
      );
      const expectedConvertToAssets = convertSharesDown(
        CONVERSION_SAMPLE_ATOMIC,
        totalAssets,
        totalSupply,
      );
      const expectedConvertToShares = convertAssetsDown(
        CONVERSION_SAMPLE_ATOMIC,
        totalAssets,
        totalSupply,
      );
      const expectedMaxDeposit = calculatePinnedMaxDeposit(
        supplyCap,
        totalAssets,
        totalSupply,
        cash,
      );
      if (
        convertToAssets === 0n ||
        convertToShares === 0n ||
        convertToAssets !== expectedConvertToAssets ||
        convertToShares !== expectedConvertToShares ||
        previewDeposit !== convertToShares ||
        maxDeposit === 0n ||
        maxDeposit !== expectedMaxDeposit
      ) {
        return unavailable();
      }

      const after = parseBlock(
        await this.rpc(nextId++, 'eth_getBlockByNumber', [before.number, false]),
      );
      if (!sameBlock(before, after) || (await this.rpc(nextId++, 'eth_chainId', [])) !== CHAIN_ID) {
        return unavailable();
      }

      const now = canonicalClock(this.clock.now());
      const maximumAge = BigInt(this.manifest.maximumFinalizedBlockAgeSeconds);
      const blockTimestamp = BigInt(before.timestamp);
      const blockMilliseconds = blockTimestamp * 1_000n;
      const observedMilliseconds = BigInt(now.milliseconds);
      if (
        blockMilliseconds > observedMilliseconds ||
        observedMilliseconds - blockMilliseconds >= maximumAge * 1_000n
      ) {
        return unavailable();
      }
      const staleAfter = unixSecondsToTimestamp(blockTimestamp + maximumAge);
      const rawState = Object.freeze({
        totalAssetsAtomic: totalAssets.toString(10),
        totalSupplySharesAtomic: totalSupply.toString(10),
        cashAtomic: cash.toString(10),
        totalBorrowsAtomic: totalBorrows.toString(10),
        supplyCapRaw: caps[0].toString(10),
        supplyCapResolvedAtomic: supplyCap.toString(10),
        borrowCapRaw: caps[1].toString(10),
        borrowCapResolvedAtomic: borrowCap.toString(10),
        maxDepositProbeAtomic: maxDeposit.toString(10),
      });
      const conversionEvidence = Object.freeze({
        sampleAtomic: '1000000' as const,
        sharesToAssetsAtomic: convertToAssets.toString(10),
        assetsToSharesAtomic: convertToShares.toString(10),
        previewDepositSharesAtomic: previewDeposit.toString(10),
        semantics: 'EVK_PINNED_VIRTUAL_DEPOSIT_INTEGER_ROUND_DOWN_MATCHED' as const,
      });
      const block = Object.freeze({ ...before });
      return Object.freeze({
        schemaVersion: 1,
        sourceId: 'EULER_V2_ETHEREUM_FINALIZED_JSON_RPC_TRANSCRIPT',
        use: 'DORMANT_EULER_V2_VAULT_CORROBORATION_ONLY',
        providerId: 'euler',
        protocolId: 'euler-v2',
        networkId: NETWORK_ID,
        marketId: vault.marketId,
        manifestFingerprintSha256: this.manifest.manifestFingerprintSha256,
        transcriptFingerprintSha256: fingerprint(
          'crypto-lending:euler-v2-ethereum-finalized-transcript:v1',
          [
            this.manifest.manifestFingerprintSha256,
            before,
            codeObservations,
            proxyConfig,
            configFlags.toString(10),
            rawState,
            conversionEvidence,
            after,
            now.timestamp,
          ],
        ),
        observedAt: now.timestamp,
        staleAfter,
        sourcePosition: BigInt(before.number).toString(10),
        sourceFinality: 'ETHEREUM_FINALIZED_BLOCK',
        sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED',
        sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT',
        freshnessStatus: 'CURRENT_WITHIN_CALLER_MANIFEST_BOUND',
        yieldEvidenceStatus: 'ABSENT_NOT_COMPUTED',
        liquidityEvidenceStatus: 'NOT_ESTABLISHED_BY_CASH_CAP_OR_MAX_DEPOSIT',
        persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_AND_RISK_VERIFICATION',
        mayPersist: false,
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
        block,
        deployment: Object.freeze({
          factory: deployment.factory.address,
          implementation: deployment.implementation.address,
          proxyKind: 'IMMUTABLE_META_PROXY' as const,
          factoryRecognizedProxy: true as const,
          upgradeable: false as const,
          governorFinalized: true as const,
        }),
        vault: Object.freeze({
          address: vault.vaultAddress,
          stablecoin: vault.stablecoin,
          assetAddress: vault.assetAddress,
          decimals: 6 as const,
          oracleAddress: vault.oracleAddress,
          unitOfAccountAddress: vault.unitOfAccountAddress,
          interestRateModelAddress: vault.interestRateModelAddress,
          hookTarget: ZERO_ADDRESS,
          hookedOperations: '0' as const,
          configFlags: configFlags.toString(10),
        }),
        rawState,
        conversionEvidence,
      });
    } catch (error) {
      if (error instanceof EulerV2EthereumTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }

  private async checkedCode(
    id: number,
    role: string,
    identity: EulerV2CodeIdentityDefinition,
    blockParameter: Readonly<{ blockHash: string; requireCanonical: true }>,
  ): Promise<CodeObservation> {
    const code = parseRuntimeCode(
      await this.rpc(id, 'eth_getCode', [identity.address, blockParameter]),
    );
    const observedHash = runtimeCodeKeccak256(code);
    if (observedHash !== identity.runtimeCodeKeccak256) return unavailable();
    return Object.freeze({ role, address: identity.address, runtimeCodeKeccak256: observedHash });
  }

  private call(
    id: number,
    to: string,
    data: string,
    blockParameter: Readonly<{ blockHash: string; requireCanonical: true }>,
  ): Promise<unknown> {
    return this.rpc(id, 'eth_call', [Object.freeze({ to, data }), blockParameter]);
  }

  private async uintCall(
    id: number,
    to: string,
    data: string,
    blockParameter: Readonly<{ blockHash: string; requireCanonical: true }>,
    maximum: bigint,
  ): Promise<bigint> {
    return decodeUint(await this.call(id, to, data, blockParameter), maximum);
  }

  private async rpc(
    id: number,
    method: EulerV2EthereumJsonRpcRequest['method'],
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

function parseSources(value: unknown): EulerV2EthereumVaultManifest['sources'] {
  const record = exactDataRecord(value, [
    'eulerInterfacesCommitSha',
    'eulerChainsContentSha256',
    'eulerVaultKitCommitSha',
  ]);
  if (
    typeof record.eulerInterfacesCommitSha !== 'string' ||
    !COMMIT_SHA.test(record.eulerInterfacesCommitSha) ||
    record.eulerInterfacesCommitSha !== EULER_V2_ETHEREUM_SOURCE_PINS.eulerInterfacesCommitSha ||
    record.eulerChainsContentSha256 !== EULER_V2_ETHEREUM_SOURCE_PINS.eulerChainsContentSha256 ||
    typeof record.eulerVaultKitCommitSha !== 'string' ||
    !COMMIT_SHA.test(record.eulerVaultKitCommitSha) ||
    record.eulerVaultKitCommitSha !== EULER_V2_ETHEREUM_SOURCE_PINS.eulerVaultKitCommitSha
  ) {
    return unavailable();
  }
  return Object.freeze({ ...EULER_V2_ETHEREUM_SOURCE_PINS });
}

function parseDeployment(value: unknown): EulerV2EthereumVaultManifest['deployment'] {
  const record = exactDataRecord(value, [
    'factory',
    'implementation',
    'evc',
    'protocolConfig',
    'sequenceRegistry',
    'balanceTracker',
    'permit2',
    'modules',
  ]);
  const modules = exactDataRecord(record.modules, ['token', 'vault', 'borrowing', 'governance']);
  return Object.freeze({
    factory: parseCodeIdentity(record.factory, EULER_V2_ETHEREUM_IDENTITIES.factory),
    implementation: parseCodeIdentity(
      record.implementation,
      EULER_V2_ETHEREUM_IDENTITIES.implementation,
    ),
    evc: parseCodeIdentity(record.evc, EULER_V2_ETHEREUM_IDENTITIES.evc),
    protocolConfig: parseCodeIdentity(
      record.protocolConfig,
      EULER_V2_ETHEREUM_IDENTITIES.protocolConfig,
    ),
    sequenceRegistry: parseCodeIdentity(
      record.sequenceRegistry,
      EULER_V2_ETHEREUM_IDENTITIES.sequenceRegistry,
    ),
    balanceTracker: parseCodeIdentity(
      record.balanceTracker,
      EULER_V2_ETHEREUM_IDENTITIES.balanceTracker,
    ),
    permit2: parseCodeIdentity(record.permit2, EULER_V2_ETHEREUM_IDENTITIES.permit2),
    modules: Object.freeze({
      token: parseCodeIdentity(modules.token, EULER_V2_ETHEREUM_IDENTITIES.modules.token),
      vault: parseCodeIdentity(modules.vault, EULER_V2_ETHEREUM_IDENTITIES.modules.vault),
      borrowing: parseCodeIdentity(
        modules.borrowing,
        EULER_V2_ETHEREUM_IDENTITIES.modules.borrowing,
      ),
      governance: parseCodeIdentity(
        modules.governance,
        EULER_V2_ETHEREUM_IDENTITIES.modules.governance,
      ),
    }),
  });
}

function parseCodeIdentity(value: unknown, expectedAddress: string): EulerV2CodeIdentityDefinition {
  const record = exactDataRecord(value, ['address', 'runtimeCodeKeccak256']);
  if (
    record.address !== expectedAddress ||
    typeof record.runtimeCodeKeccak256 !== 'string' ||
    !BYTES32.test(record.runtimeCodeKeccak256) ||
    record.runtimeCodeKeccak256 === ZERO_WORD
  ) {
    return unavailable();
  }
  return Object.freeze({
    address: expectedAddress,
    runtimeCodeKeccak256: record.runtimeCodeKeccak256,
  });
}

function parseVault(value: unknown): EulerV2EthereumVaultManifest['vault'] {
  const record = exactDataRecord(value, [
    'marketId',
    'vaultAddress',
    'vaultRuntimeCodeKeccak256',
    'proxyKind',
    'upgradeable',
    'stablecoin',
    'assetAddress',
    'assetRuntimeCodeKeccak256',
    'oracleAddress',
    'oracleRuntimeCodeKeccak256',
    'unitOfAccountAddress',
    'interestRateModelAddress',
    'interestRateModelRuntimeCodeKeccak256',
    'depositProbeAccount',
    'expectedConfigFlags',
    'expectedSupplyCapRaw',
    'expectedBorrowCapRaw',
  ]);
  if (
    typeof record.stablecoin !== 'string' ||
    !SUPPORTED_STABLECOINS.includes(record.stablecoin as SupportedStablecoin)
  ) {
    return unavailable();
  }
  const stablecoin = record.stablecoin as SupportedStablecoin;
  const vaultAddress = nonzeroAddress(record.vaultAddress);
  const assetAddress = nonzeroAddress(record.assetAddress);
  const oracleAddress = nonzeroAddress(record.oracleAddress);
  const unitOfAccountAddress = nonzeroAddress(record.unitOfAccountAddress);
  const interestRateModelAddress = nonzeroAddress(record.interestRateModelAddress);
  const depositProbeAccount = nonzeroAddress(record.depositProbeAccount);
  if (
    record.proxyKind !== 'IMMUTABLE_META_PROXY' ||
    record.upgradeable !== false ||
    unitOfAccountAddress !== assetAddress ||
    new Set([vaultAddress, assetAddress, oracleAddress, interestRateModelAddress]).size !== 4
  ) {
    return unavailable();
  }
  const registered = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.identifyAsset(
    NETWORK_ID,
    assetAddress,
  );
  if (
    registered?.stablecoin !== stablecoin ||
    registered.activationState !== 'ACTIVE' ||
    registered.decimals !== 6 ||
    registered.registryVersion !== 1
  ) {
    return unavailable();
  }
  if (
    typeof record.marketId !== 'string' ||
    !MARKET_ID.test(record.marketId) ||
    record.marketId !== `euler-v2-ethereum-mainnet:${vaultAddress}`
  ) {
    return unavailable();
  }
  const codeHashes = [
    record.vaultRuntimeCodeKeccak256,
    record.assetRuntimeCodeKeccak256,
    record.oracleRuntimeCodeKeccak256,
    record.interestRateModelRuntimeCodeKeccak256,
  ];
  if (
    codeHashes.some(
      (candidate) =>
        typeof candidate !== 'string' || !BYTES32.test(candidate) || candidate === ZERO_WORD,
    )
  ) {
    return unavailable();
  }
  const expectedConfigFlags = canonicalInteger(record.expectedConfigFlags, 3n).toString(10);
  const expectedSupplyCapRaw = positiveCanonicalInteger(record.expectedSupplyCapRaw, MAX_UINT16);
  const expectedBorrowCapRaw = positiveCanonicalInteger(record.expectedBorrowCapRaw, MAX_UINT16);
  resolveFinitePositiveAmountCap(expectedSupplyCapRaw);
  resolveFinitePositiveAmountCap(expectedBorrowCapRaw);
  return Object.freeze({
    marketId: record.marketId,
    vaultAddress,
    vaultRuntimeCodeKeccak256: codeHashes[0] as string,
    proxyKind: 'IMMUTABLE_META_PROXY',
    upgradeable: false,
    stablecoin,
    assetAddress,
    assetRuntimeCodeKeccak256: codeHashes[1] as string,
    oracleAddress,
    oracleRuntimeCodeKeccak256: codeHashes[2] as string,
    unitOfAccountAddress,
    interestRateModelAddress,
    interestRateModelRuntimeCodeKeccak256: codeHashes[3] as string,
    depositProbeAccount,
    expectedConfigFlags,
    expectedSupplyCapRaw: expectedSupplyCapRaw.toString(10),
    expectedBorrowCapRaw: expectedBorrowCapRaw.toString(10),
  });
}

function deploymentCodeIdentities(
  deployment: EulerV2EthereumVaultManifest['deployment'],
): readonly (readonly [string, EulerV2CodeIdentityDefinition])[] {
  return Object.freeze([
    Object.freeze(['factory', deployment.factory] as const),
    Object.freeze(['implementation', deployment.implementation] as const),
    Object.freeze(['evc', deployment.evc] as const),
    Object.freeze(['protocolConfig', deployment.protocolConfig] as const),
    Object.freeze(['sequenceRegistry', deployment.sequenceRegistry] as const),
    Object.freeze(['balanceTracker', deployment.balanceTracker] as const),
    Object.freeze(['permit2', deployment.permit2] as const),
    Object.freeze(['moduleToken', deployment.modules.token] as const),
    Object.freeze(['moduleVault', deployment.modules.vault] as const),
    Object.freeze(['moduleBorrowing', deployment.modules.borrowing] as const),
    Object.freeze(['moduleGovernance', deployment.modules.governance] as const),
  ]);
}

function vaultCodeIdentities(
  vault: EulerV2EthereumVaultManifest['vault'],
): readonly (readonly [string, EulerV2CodeIdentityDefinition])[] {
  return Object.freeze([
    Object.freeze([
      'vault',
      Object.freeze({
        address: vault.vaultAddress,
        runtimeCodeKeccak256: vault.vaultRuntimeCodeKeccak256,
      }),
    ] as const),
    Object.freeze([
      'asset',
      Object.freeze({
        address: vault.assetAddress,
        runtimeCodeKeccak256: vault.assetRuntimeCodeKeccak256,
      }),
    ] as const),
    Object.freeze([
      'oracle',
      Object.freeze({
        address: vault.oracleAddress,
        runtimeCodeKeccak256: vault.oracleRuntimeCodeKeccak256,
      }),
    ] as const),
    Object.freeze([
      'interestRateModel',
      Object.freeze({
        address: vault.interestRateModelAddress,
        runtimeCodeKeccak256: vault.interestRateModelRuntimeCodeKeccak256,
      }),
    ] as const),
  ]);
}

function decodeProxyConfig(value: unknown): ProxyConfig {
  const words = abiWords(value, 6);
  const upgradeable = booleanWord(words[0]);
  const implementation = addressFromWord(words[1]);
  if (unsignedWord(words[2], MAX_UINT256) !== 96n) return unavailable();
  if (unsignedWord(words[3], MAX_UINT256) !== 60n) return unavailable();
  const dataWord0 = words[4];
  const dataWord1 = words[5];
  if (dataWord0 === undefined || dataWord1 === undefined) return unavailable();
  const padded = `${dataWord0}${dataWord1}`;
  if (!/^[0-9a-f]{128}$/u.test(padded) || padded.slice(120) !== '0'.repeat(8)) {
    return unavailable();
  }
  return Object.freeze({
    upgradeable,
    implementation,
    trailingData: `0x${padded.slice(0, 120)}`,
  });
}

function decodeAddress(value: unknown): string {
  return addressFromWord(abiWords(value, 1)[0]);
}

function decodeBoolean(value: unknown): boolean {
  return booleanWord(abiWords(value, 1)[0]);
}

function decodeUint(value: unknown, maximum: bigint): bigint {
  return unsignedWord(abiWords(value, 1)[0], maximum);
}

function decodeAddressUint(
  value: unknown,
  maximum: bigint,
): Readonly<{ address: string; value: bigint }> {
  const words = abiWords(value, 2);
  return Object.freeze({
    address: addressFromWord(words[0]),
    value: unsignedWord(words[1], maximum),
  });
}

function decodeTwoUints(value: unknown, maximum: bigint): readonly [bigint, bigint] {
  const words = abiWords(value, 2);
  return Object.freeze([
    unsignedWord(words[0], maximum),
    unsignedWord(words[1], maximum),
  ]) as readonly [bigint, bigint];
}

function abiWords(value: unknown, expectedCount: number): readonly string[] {
  if (
    typeof value !== 'string' ||
    value.length !== 2 + expectedCount * 64 ||
    !/^0x[0-9a-f]+$/u.test(value)
  ) {
    return unavailable();
  }
  const words: string[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    words.push(value.slice(2 + index * 64, 2 + (index + 1) * 64));
  }
  return Object.freeze(words);
}

function booleanWord(word: string | undefined): boolean {
  if (word === '0'.repeat(64)) return false;
  if (word === `${'0'.repeat(63)}1`) return true;
  return unavailable();
}

function addressFromWord(word: string | undefined): string {
  if (typeof word !== 'string' || !/^0{24}[0-9a-f]{40}$/u.test(word)) return unavailable();
  return `0x${word.slice(24)}`;
}

function unsignedWord(word: string | undefined, maximum: bigint): bigint {
  if (typeof word !== 'string' || !/^[0-9a-f]{64}$/u.test(word)) return unavailable();
  const parsed = BigInt(`0x${word}`);
  if (parsed > maximum) return unavailable();
  return parsed;
}

function resolveFinitePositiveAmountCap(raw: bigint): bigint {
  if (raw <= 0n || raw > MAX_UINT16) return unavailable();
  const exponent = raw & 63n;
  const mantissa = raw >> 6n;
  if (mantissa === 0n) return unavailable();
  const resolved = (10n ** exponent * mantissa) / 100n;
  if (resolved === 0n || resolved > MAX_UINT112) return unavailable();
  return resolved;
}

function convertSharesDown(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (shares * (totalAssets + VIRTUAL_DEPOSIT_ATOMIC)) / (totalShares + VIRTUAL_DEPOSIT_ATOMIC);
}

function convertAssetsDown(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (assets * (totalShares + VIRTUAL_DEPOSIT_ATOMIC)) / (totalAssets + VIRTUAL_DEPOSIT_ATOMIC);
}

function calculatePinnedMaxDeposit(
  supplyCap: bigint,
  totalAssets: bigint,
  totalShares: bigint,
  cash: bigint,
): bigint {
  if (totalAssets >= supplyCap) return 0n;
  const capSpace = supplyCap - totalAssets;
  const cashSpace = MAX_UINT112 - cash;
  const maximumAssets = capSpace < cashSpace ? capSpace : cashSpace;
  let maximumShares = convertAssetsDown(maximumAssets, totalAssets, totalShares);
  const shareSpace = MAX_UINT112 - totalShares;
  if (maximumShares > shareSpace) maximumShares = shareSpace;
  const returnedAssets = convertSharesDown(maximumShares, totalAssets, totalShares);
  return convertAssetsDown(returnedAssets, totalAssets, totalShares) === 0n ? 0n : returnedAssets;
}

function parseBlock(value: unknown): EthereumBlockHeader {
  const record = allowedDataRecord(
    value,
    ['number', 'hash', 'parentHash', 'stateRoot', 'timestamp'],
    BLOCK_KEYS,
  );
  const number = hexQuantity(record.number, MAX_UINT64, true);
  const timestamp = hexQuantity(record.timestamp, MAX_UNIX_SECONDS, false);
  const hash = bytes32(record.hash);
  const parentHash = bytes32(record.parentHash);
  const stateRoot = bytes32(record.stateRoot);
  if (hash === ZERO_WORD || parentHash === ZERO_WORD || stateRoot === ZERO_WORD) {
    return unavailable();
  }
  return Object.freeze({ number, hash, parentHash, stateRoot, timestamp });
}

function sameBlock(left: EthereumBlockHeader, right: EthereumBlockHeader): boolean {
  return (
    left.number === right.number &&
    left.hash === right.hash &&
    left.parentHash === right.parentHash &&
    left.stateRoot === right.stateRoot &&
    left.timestamp === right.timestamp
  );
}

function parseRuntimeCode(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !HEX_DATA.test(value) ||
    value === '0x' ||
    (value.length - 2) / 2 > MAX_RUNTIME_CODE_BYTES
  ) {
    return unavailable();
  }
  return value;
}

function runtimeCodeKeccak256(value: string): string {
  try {
    return keccak256(value as Hex);
  } catch {
    return unavailable();
  }
}

function nonzeroAddress(value: unknown): string {
  if (typeof value !== 'string' || !ADDRESS.test(value) || value === ZERO_ADDRESS) {
    return unavailable();
  }
  return value;
}

function bytes32(value: unknown): string {
  if (typeof value !== 'string' || !BYTES32.test(value)) return unavailable();
  return value;
}

function hexQuantity(value: unknown, maximum: bigint, positive: boolean): string {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value) || value.length > 66) {
    return unavailable();
  }
  const parsed = BigInt(value);
  if (parsed > maximum || (positive && parsed === 0n)) return unavailable();
  return value;
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

function addressWord(address: string): string {
  return `${'0'.repeat(24)}${address.slice(2)}`;
}

function uint256Word(value: bigint): string {
  if (value < 0n || value > MAX_UINT256) return unavailable();
  return value.toString(16).padStart(64, '0');
}

function canonicalClock(value: unknown): Readonly<{ timestamp: string; milliseconds: number }> {
  try {
    if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype) {
      return unavailable();
    }
    const milliseconds = Date.prototype.getTime.call(value);
    if (!Number.isSafeInteger(milliseconds)) return unavailable();
    const timestamp = Date.prototype.toISOString.call(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(timestamp)) {
      return unavailable();
    }
    return Object.freeze({ timestamp, milliseconds });
  } catch (error) {
    if (error instanceof EulerV2EthereumTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function unixSecondsToTimestamp(value: bigint): string {
  if (value < 0n || value > MAX_UNIX_SECONDS) return unavailable();
  const milliseconds = value * 1_000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return unavailable();
  const timestamp = new Date(Number(milliseconds)).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(timestamp)) {
    return unavailable();
  }
  return timestamp;
}

interface DataBounds {
  readonly maximumBytes: number;
  readonly maximumNodes: number;
  readonly maximumDepth: number;
  readonly maximumArrayLength: number;
}

/** Traverses descriptors, so an accessor is rejected without being invoked. */
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
        if (!Number.isSafeInteger(candidate)) return unavailable();
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
    if (error instanceof EulerV2EthereumTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return unavailable();
    }
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
    if (error instanceof EulerV2EthereumTranscriptUnavailableError) throw error;
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

function fingerprint(domain: string, values: readonly unknown[]): string {
  return createHash('sha256')
    .update(JSON.stringify([domain, ...values]), 'utf8')
    .digest('hex');
}

function unavailable(): never {
  throw new EulerV2EthereumTranscriptUnavailableError();
}
