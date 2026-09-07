import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseAccountId } from '../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  deriveEulerV2EvcAccountCandidates,
  EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
} from '../../smart-lending/infrastructure/euler/euler-v2-account-position.semantics';
import {
  createEulerV2EthereumVaultManifest,
  EULER_V2_ETHEREUM_IDENTITIES,
  EULER_V2_ETHEREUM_SOURCE_PINS,
  type DormantEulerV2EthereumVaultTranscriptCandidate,
  type EulerV2CodeIdentityDefinition,
  type EulerV2EthereumVaultManifest,
  type EulerV2EthereumVaultManifestDefinition,
} from '../../smart-lending/infrastructure/euler/euler-v2-ethereum-finalized-transcript.adapter';
import {
  PROVIDER_POSITION_ADMISSION_SOURCE_USE,
  PROVIDER_POSITION_ADMISSION_VERSION,
  type ReadProviderPositionAdmissionTargetRequestV1,
} from '../application/provider-position-admission.coordinator';
import {
  DormantEulerV2EthereumProviderPositionSource,
  DormantEulerV2EthereumProviderPositionSourceError,
  EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_USE,
  EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
  EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE,
  EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
  type EulerV2EthereumDurableTargetContextCapabilityV1,
  type EulerV2EthereumDurableTargetContextReaderPort,
  type EulerV2EthereumFinalizedPositionTranscriptPort,
  type EulerV2EthereumProviderPositionSourceClock,
  type ReadEulerV2EthereumDurableTargetContextRequestV1,
  type ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1,
} from './dormant-euler-v2-ethereum-provider-position.source';

const ACCOUNT_ID = parseAccountId('11111111-1111-4111-8111-111111111111');
const WALLET_ID = '22222222-2222-4222-8222-222222222222';
const WALLET_ADDRESS = '0x5555555555555555555555555555555555555555';
const SOURCE_FAMILY_ID = 'ethereum-primary';
const SOURCE_ID = 'euler-rpc-a';
const CONTEXT_SOURCE_FAMILY_ID = 'durable-wallet';
const CONTEXT_SOURCE_ID = 'wallet-context-a';
const CORRELATION_ID = '33333333-3333-4333-8333-333333333333';
const NETWORK_ID = 'eip155:1';
const VAULT = '0x1111111111111111111111111111111111111111';
const ORACLE = '0x2222222222222222222222222222222222222222';
const IRM = '0x3333333333333333333333333333333333333333';
const PROBE = '0x4444444444444444444444444444444444444444';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const MARKET_ID = `euler-v2-ethereum-mainnet:${VAULT}`;
const STARTED_AT = '2026-09-06T12:00:00.000Z';
const CONTEXT_SETTLED_AT = '2026-09-06T12:00:01.000Z';
const CANDIDATE_OBSERVED_AT = '2026-09-06T12:00:02.000Z';
const TRANSCRIPT_SETTLED_AT = '2026-09-06T12:00:03.000Z';
const COMPLETED_AT = '2026-09-06T12:00:04.000Z';
const DEADLINE_AT = '2026-09-06T12:00:20.000Z';
const BLOCK_TIMESTAMP = Math.floor(Date.parse('2026-09-06T11:59:00.000Z') / 1_000);
const STALE_AFTER = '2026-09-06T12:09:00.000Z';
const BLOCK_HASH = `0x${'ab'.repeat(32)}`;
const BLOCK_PARENT_HASH = `0x${'bc'.repeat(32)}`;
const BLOCK_STATE_ROOT = `0x${'cd'.repeat(32)}`;
const FLOOR_HASH = `0x${'de'.repeat(32)}`;
const FLOOR_PARENT_HASH = `0x${'ef'.repeat(32)}`;
const FLOOR_STATE_ROOT = `0x${'12'.repeat(32)}`;
const TRANSCRIPT_FINGERPRINT = '34'.repeat(32);
const FIXED_ERROR = Object.freeze({
  name: 'DormantEulerV2EthereumProviderPositionSourceError',
  message: 'Euler V2 Ethereum provider-position source is unavailable.',
});

type MutableRecord = Record<string, unknown>;
type TranscriptMutator = (
  candidate: MutableRecord,
  requestInput: ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1,
) => void;

function codeIdentity(address: string, ordinal: number): EulerV2CodeIdentityDefinition {
  return {
    address,
    runtimeCodeKeccak256: `0x${ordinal.toString(16).padStart(2, '0').repeat(32)}`,
  };
}

function manifestDefinition(): EulerV2EthereumVaultManifestDefinition {
  return {
    schemaVersion: 1,
    use: 'DORMANT_EULER_V2_VAULT_CORROBORATION_ONLY',
    sources: { ...EULER_V2_ETHEREUM_SOURCE_PINS },
    registryVersion: 1,
    registryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    networkId: NETWORK_ID,
    chainId: '0x1',
    blockSelector: 'finalized',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    maximumFinalizedBlockAgeSeconds: '600',
    deployment: {
      factory: codeIdentity(EULER_V2_ETHEREUM_IDENTITIES.factory, 1),
      implementation: codeIdentity(EULER_V2_ETHEREUM_IDENTITIES.implementation, 2),
      evc: codeIdentity(EULER_V2_ETHEREUM_IDENTITIES.evc, 3),
      protocolConfig: codeIdentity(EULER_V2_ETHEREUM_IDENTITIES.protocolConfig, 4),
      sequenceRegistry: codeIdentity(EULER_V2_ETHEREUM_IDENTITIES.sequenceRegistry, 5),
      balanceTracker: codeIdentity(EULER_V2_ETHEREUM_IDENTITIES.balanceTracker, 6),
      permit2: codeIdentity(EULER_V2_ETHEREUM_IDENTITIES.permit2, 7),
      modules: {
        token: codeIdentity(EULER_V2_ETHEREUM_IDENTITIES.modules.token, 8),
        vault: codeIdentity(EULER_V2_ETHEREUM_IDENTITIES.modules.vault, 9),
        borrowing: codeIdentity(EULER_V2_ETHEREUM_IDENTITIES.modules.borrowing, 10),
        governance: codeIdentity(EULER_V2_ETHEREUM_IDENTITIES.modules.governance, 11),
      },
    },
    vault: {
      marketId: MARKET_ID,
      vaultAddress: VAULT,
      vaultRuntimeCodeKeccak256: `0x${'21'.repeat(32)}`,
      proxyKind: 'IMMUTABLE_META_PROXY',
      upgradeable: false,
      stablecoin: 'USDC',
      assetAddress: USDC,
      assetRuntimeCodeKeccak256: `0x${'22'.repeat(32)}`,
      oracleAddress: ORACLE,
      oracleRuntimeCodeKeccak256: `0x${'23'.repeat(32)}`,
      unitOfAccountAddress: USDC,
      interestRateModelAddress: IRM,
      interestRateModelRuntimeCodeKeccak256: `0x${'24'.repeat(32)}`,
      depositProbeAccount: PROBE,
      expectedConfigFlags: '0',
      expectedSupplyCapRaw: '64006',
      expectedBorrowCapRaw: '32006',
    },
  };
}

const MANIFEST = createEulerV2EthereumVaultManifest(manifestDefinition());
const ASSET = Object.freeze({
  stablecoin: 'USDC' as const,
  networkId: NETWORK_ID,
  identity: USDC,
  decimals: 6,
});

function request(
  overrides: Partial<ReadProviderPositionAdmissionTargetRequestV1> = {},
): ReadProviderPositionAdmissionTargetRequestV1 {
  return Object.freeze({
    admissionVersion: PROVIDER_POSITION_ADMISSION_VERSION,
    accountId: ACCOUNT_ID,
    correlationId: CORRELATION_ID,
    deadlineAt: DEADLINE_AT,
    signal: new AbortController().signal,
    sourceFamilyId: SOURCE_FAMILY_ID,
    sourceId: SOURCE_ID,
    sourceKind: 'RPC' as const,
    walletId: WALLET_ID,
    providerId: 'euler',
    protocolId: 'euler-v2',
    marketId: MARKET_ID,
    networkId: NETWORK_ID,
    assets: Object.freeze([ASSET]),
    ...overrides,
  });
}

function selectedBlock(): MutableRecord {
  return {
    number: '0x123',
    hash: BLOCK_HASH,
    parentHash: BLOCK_PARENT_HASH,
    stateRoot: BLOCK_STATE_ROOT,
    timestamp: `0x${BLOCK_TIMESTAMP.toString(16)}`,
  };
}

function floorBlock(): MutableRecord {
  return {
    number: '0x100',
    hash: FLOOR_HASH,
    parentHash: FLOOR_PARENT_HASH,
    stateRoot: FLOOR_STATE_ROOT,
    timestamp: `0x${(BLOCK_TIMESTAMP - 120).toString(16)}`,
  };
}

function vaultCandidate(
  requestInput: ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1,
): DormantEulerV2EthereumVaultTranscriptCandidate {
  return {
    schemaVersion: 1,
    sourceId: 'EULER_V2_ETHEREUM_FINALIZED_JSON_RPC_TRANSCRIPT',
    use: 'DORMANT_EULER_V2_VAULT_CORROBORATION_ONLY',
    providerId: 'euler',
    protocolId: 'euler-v2',
    networkId: NETWORK_ID,
    marketId: requestInput.marketId,
    manifestFingerprintSha256: requestInput.manifestFingerprintSha256,
    transcriptFingerprintSha256: TRANSCRIPT_FINGERPRINT,
    observedAt: CANDIDATE_OBSERVED_AT,
    staleAfter: STALE_AFTER,
    sourcePosition: '291',
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
    block: selectedBlock() as unknown as DormantEulerV2EthereumVaultTranscriptCandidate['block'],
    deployment: {
      factory: requestInput.manifest.deployment.factory.address,
      implementation: requestInput.manifest.deployment.implementation.address,
      proxyKind: 'IMMUTABLE_META_PROXY',
      factoryRecognizedProxy: true,
      upgradeable: false,
      governorFinalized: true,
    },
    vault: {
      address: requestInput.manifest.vault.vaultAddress,
      stablecoin: requestInput.manifest.vault.stablecoin,
      assetAddress: requestInput.manifest.vault.assetAddress,
      decimals: 6,
      oracleAddress: requestInput.manifest.vault.oracleAddress,
      unitOfAccountAddress: requestInput.manifest.vault.unitOfAccountAddress,
      interestRateModelAddress: requestInput.manifest.vault.interestRateModelAddress,
      hookTarget: ZERO_ADDRESS,
      hookedOperations: '0',
      configFlags: requestInput.manifest.vault.expectedConfigFlags,
    },
    rawState: {
      totalAssetsAtomic: '5000000',
      totalSupplySharesAtomic: '4000000',
      cashAtomic: '3000000',
      totalBorrowsAtomic: '2000000',
      supplyCapRaw: '64006',
      supplyCapResolvedAtomic: '10000000',
      borrowCapRaw: '32006',
      borrowCapResolvedAtomic: '5000000',
      maxDepositProbeAtomic: '4999999',
    },
    conversionEvidence: {
      sampleAtomic: '1000000',
      sharesToAssetsAtomic: '1200000',
      assetsToSharesAtomic: '833333',
      previewDepositSharesAtomic: '833333',
      semantics: 'EVK_PINNED_VIRTUAL_DEPOSIT_INTEGER_ROUND_DOWN_MATCHED',
    },
  };
}

function abiUint(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function callResult(
  plan: Readonly<{ operationId: string; to: string; from: null }>,
  data: string,
  result: string,
): MutableRecord {
  return {
    operationId: plan.operationId,
    method: 'eth_call',
    to: plan.to,
    data,
    from: null,
    blockParameter: { blockHash: BLOCK_HASH, requireCanonical: true },
    result,
  };
}

function accountRows(
  requestInput: ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1,
): MutableRecord[] {
  return requestInput.accountReadPlans.map((plan, index) => {
    const shares = index === 0 ? 1_000_000n : 0n;
    const supplyAssets = index === 0 ? 1_200_000n : 0n;
    const debtAssets = index === 1 ? 2n : 0n;
    const debtExact = index === 1 ? 2_147_483_649n : 0n;
    return {
      accountId: plan.accountId,
      accountAddress: plan.accountAddress,
      balanceOf: callResult(plan.balanceOf, plan.balanceOf.data, abiUint(shares)),
      convertToAssets: callResult(
        plan.convertToAssets,
        `${plan.convertToAssets.selector}${shares.toString(16).padStart(64, '0')}`,
        abiUint(supplyAssets),
      ),
      debtOf: callResult(plan.debtOf, plan.debtOf.data, abiUint(debtAssets)),
      debtOfExact: callResult(plan.debtOfExact, plan.debtOfExact.data, abiUint(debtExact)),
    };
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
}

function transcriptCapability(
  requestInput: ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1,
  mutate?: TranscriptMutator,
): unknown {
  const candidate: MutableRecord = {
    transcriptVersion: EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
    use: EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    mayCreatePositionSnapshot: false,
    maySign: false,
    mayAccessWalletPrivateKey: false,
    accountId: requestInput.accountId,
    correlationId: requestInput.correlationId,
    deadlineAt: requestInput.deadlineAt,
    sourceFamilyId: requestInput.sourceFamilyId,
    sourceId: requestInput.sourceId,
    sourceKind: requestInput.sourceKind,
    walletId: requestInput.walletId,
    providerId: requestInput.providerId,
    protocolId: requestInput.protocolId,
    marketId: requestInput.marketId,
    networkId: requestInput.networkId,
    walletAddress: requestInput.walletAddress,
    manifestFingerprintSha256: requestInput.manifestFingerprintSha256,
    semanticsFingerprintSha256: requestInput.semanticsFingerprintSha256,
    chainIdBefore: '0x1',
    chainIdAfter: '0x1',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    vaultTranscript: vaultCandidate(requestInput),
    selectedBlockAfter: selectedBlock(),
    floorBlockBefore: floorBlock(),
    floorBlockAfter: floorBlock(),
    walletOwnerGate: callResult(
      requestInput.walletOwnerRead,
      requestInput.walletOwnerRead.data,
      `0x${'0'.repeat(24)}${requestInput.walletAddress.slice(2)}`,
    ),
    accounts: accountRows(requestInput),
    executionOrder: [...requestInput.executionOrder],
    status: 'COMPLETE',
    coverageScope: 'EXACT_MANIFEST_VAULT_LOAN_ASSET_ALL_256_EVC_ACCOUNTS',
    operatorTraversal: false,
    indirectExposureIncluded: false,
    zeroPositionSemantics: 'EXACT_ZERO_AGGREGATE_AFTER_ALL_256_EVC_ACCOUNT_ROWS',
  };
  mutate?.(candidate, requestInput);
  return deepFreeze(candidate);
}

function contextCapability(
  input: ReadEulerV2EthereumDurableTargetContextRequestV1,
): EulerV2EthereumDurableTargetContextCapabilityV1 {
  return deepFreeze({
    contextVersion: EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
    use: EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    maySign: false,
    mayAccessWalletPrivateKey: false,
    accountId: input.accountId,
    correlationId: input.correlationId,
    deadlineAt: input.deadlineAt,
    sourceFamilyId: input.sourceFamilyId,
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    walletId: input.walletId,
    providerId: input.providerId,
    protocolId: input.protocolId,
    marketId: input.marketId,
    networkId: input.networkId,
    contextSourceFamilyId: CONTEXT_SOURCE_FAMILY_ID,
    contextSourceId: CONTEXT_SOURCE_ID,
    walletAddress: WALLET_ADDRESS,
    continuityFloor: {
      kind: 'EVM_BLOCK' as const,
      blockNumber: '256',
      blockHash: FLOOR_HASH,
    },
  });
}

interface HarnessOptions {
  readonly transcriptMutator?: TranscriptMutator;
  readonly times?: readonly string[];
  readonly reviewContext?: boolean;
  readonly reviewTranscript?: boolean;
}

interface Harness {
  readonly contextReader: EulerV2EthereumDurableTargetContextReaderPort;
  readonly transcriptReader: EulerV2EthereumFinalizedPositionTranscriptPort;
  readonly clock: EulerV2EthereumProviderPositionSourceClock;
  readonly contextRead: jest.Mock;
  readonly transcriptRead: jest.Mock;
}

function harness(options: HarnessOptions = {}): Harness {
  const issuedContexts = new WeakMap<object, ReadEulerV2EthereumDurableTargetContextRequestV1>();
  const issuedTranscripts = new WeakMap<
    object,
    ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1
  >();
  const contextRead = jest.fn(
    async (input: ReadEulerV2EthereumDurableTargetContextRequestV1): Promise<unknown> => {
      const capability = contextCapability(input);
      issuedContexts.set(capability, input);
      return capability;
    },
  );
  const transcriptRead = jest.fn(
    async (input: ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1): Promise<unknown> => {
      const capability = transcriptCapability(input, options.transcriptMutator);
      if (typeof capability === 'object' && capability !== null) {
        issuedTranscripts.set(capability, input);
      }
      return capability;
    },
  );
  const times = [STARTED_AT, CONTEXT_SETTLED_AT, TRANSCRIPT_SETTLED_AT, COMPLETED_AT];
  let clockIndex = 0;
  return {
    contextReader: {
      contextVersion: EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
      sourceFamilyId: CONTEXT_SOURCE_FAMILY_ID,
      sourceId: CONTEXT_SOURCE_ID,
      readContext: contextRead,
      reviewContext: (capability, input) =>
        options.reviewContext === false ||
        typeof capability !== 'object' ||
        capability === null ||
        issuedContexts.get(capability) !== input
          ? null
          : capability,
    },
    transcriptReader: {
      transcriptVersion: EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourceId: SOURCE_ID,
      readTranscript: transcriptRead,
      reviewTranscript: (capability, input) =>
        options.reviewTranscript === false ||
        typeof capability !== 'object' ||
        capability === null ||
        issuedTranscripts.get(capability) !== input
          ? null
          : capability,
    },
    clock: {
      now: () => new Date((options.times ?? times)[clockIndex++] ?? COMPLETED_AT),
    },
    contextRead,
    transcriptRead,
  };
}

function source(
  testHarness: Harness,
  manifest: EulerV2EthereumVaultManifest = MANIFEST,
  manifestFingerprint = manifest.manifestFingerprintSha256,
  semanticsFingerprint = EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
): DormantEulerV2EthereumProviderPositionSource {
  return new DormantEulerV2EthereumProviderPositionSource(
    manifest,
    manifestFingerprint,
    semanticsFingerprint,
    testHarness.contextReader,
    testHarness.transcriptReader,
    testHarness.clock,
  );
}

describe('DormantEulerV2EthereumProviderPositionSource', () => {
  it('emits a complete exact-vault aggregate only after reviewed durable and finalized capabilities', async () => {
    const testHarness = harness();
    const result = await source(testHarness).readTarget(request());

    expect(result).toEqual({
      evidenceVersion: PROVIDER_POSITION_ADMISSION_VERSION,
      use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,
      mayAuthorizeFinancialAction: false,
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourceId: SOURCE_ID,
      sourceKind: 'RPC',
      sourceObservationId: 'ethereum-block-291',
      walletId: WALLET_ID,
      providerId: 'euler',
      protocolId: 'euler-v2',
      marketId: MARKET_ID,
      networkId: NETWORK_ID,
      assets: [ASSET],
      status: 'COMPLETE',
      observedAt: COMPLETED_AT,
      staleAfter: DEADLINE_AT,
      continuityFloor: { kind: 'EVM_BLOCK', blockNumber: '256', blockHash: FLOOR_HASH },
      chainAnchor: { kind: 'EVM_BLOCK', blockNumber: '291', blockHash: BLOCK_HASH },
      positions: [
        {
          positionId: `${MARKET_ID}-${WALLET_ID}-supply`,
          positionKind: 'SUPPLY',
          asset: ASSET,
          balance: { atomic: '1200000', decimal: '1.200000' },
        },
        {
          positionId: `${MARKET_ID}-${WALLET_ID}-borrow`,
          positionKind: 'BORROW',
          asset: ASSET,
          balance: { atomic: '2', decimal: '0.000002' },
        },
      ],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(WALLET_ADDRESS);

    const issued = testHarness.transcriptRead.mock
      .calls[0]?.[0] as ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1;
    expect(issued.manifest).toEqual(MANIFEST);
    expect(issued.manifestFingerprintSha256).toBe(MANIFEST.manifestFingerprintSha256);
    expect(issued.semanticsFingerprintSha256).toBe(
      EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
    );
    expect(issued.vaultTranscriptRequest).toEqual({
      marketId: MARKET_ID,
      vaultAddress: VAULT,
      stablecoin: 'USDC',
    });
    const expectedAccounts = deriveEulerV2EvcAccountCandidates(WALLET_ADDRESS);
    expect(issued.accountReadPlans).toHaveLength(256);
    expect(
      issued.accountReadPlans.map(({ accountId, accountAddress }) => ({
        accountId,
        accountAddress,
      })),
    ).toEqual(expectedAccounts);
    expect(issued.walletOwnerRead).toMatchObject({
      operationId: 'evc-wallet-owner',
      method: 'eth_call',
      to: MANIFEST.deployment.evc.address,
      from: null,
    });
    expect(issued.accountReadPlans[0]).toMatchObject({
      accountId: '0',
      accountAddress: WALLET_ADDRESS,
      balanceOf: { method: 'eth_call', to: VAULT, from: null },
      convertToAssets: {
        method: 'eth_call',
        to: VAULT,
        uint256InputFromOperationId: 'evc-000-balance-of',
        from: null,
      },
      debtOf: { method: 'eth_call', to: VAULT, from: null },
      debtOfExact: { method: 'eth_call', to: VAULT, from: null },
    });
    expect(issued.boundaryReadPlan).toEqual({
      chainIdBefore: { operationId: 'chain-id-before', method: 'eth_chainId' },
      vaultTranscript: {
        operationId: 'vault-transcript',
        adapterSourceId: 'EULER_V2_ETHEREUM_FINALIZED_JSON_RPC_TRANSCRIPT',
      },
      floorBlockBefore: {
        operationId: 'floor-block-before',
        method: 'eth_getBlockByNumber',
        selector: '0x100',
        includeTransactions: false,
      },
      floorBlockAfter: {
        operationId: 'floor-block-after',
        method: 'eth_getBlockByNumber',
        selector: '0x100',
        includeTransactions: false,
      },
      selectedBlockAfter: {
        operationId: 'selected-block-after',
        method: 'eth_getBlockByNumber',
        selectorFrom: 'VAULT_TRANSCRIPT_BLOCK_NUMBER',
        includeTransactions: false,
      },
      chainIdAfter: { operationId: 'chain-id-after', method: 'eth_chainId' },
    });
    expect(issued.executionOrder).toHaveLength(1_031);
    expect(issued.executionOrder.slice(0, 4)).toEqual([
      'chain-id-before',
      'vault-transcript',
      'floor-block-before',
      'evc-wallet-owner',
    ]);
    expect(issued.executionOrder.slice(-3)).toEqual([
      'floor-block-after',
      'selected-block-after',
      'chain-id-after',
    ]);
    expect(issued.mayAuthorizeFinancialAction).toBe(false);
    expect(issued.mayPersist).toBe(false);
    expect(issued.mayCreatePositionSnapshot).toBe(false);
    expect(issued).not.toHaveProperty('endpoint');
    expect(issued).not.toHaveProperty('vaultDiscovery');
  });

  it('proves an empty exact target only after all 256 deterministic account rows are zero', async () => {
    const testHarness = harness({
      transcriptMutator: (candidate) => {
        candidate.accounts = (candidate.accounts as MutableRecord[]).map((row) => ({
          ...row,
          balanceOf: { ...(row.balanceOf as MutableRecord), result: abiUint(0n) },
          convertToAssets: {
            ...(row.convertToAssets as MutableRecord),
            data: `${String((row.convertToAssets as MutableRecord).data).slice(0, 10)}${'0'.repeat(64)}`,
            result: abiUint(0n),
          },
          debtOf: { ...(row.debtOf as MutableRecord), result: abiUint(0n) },
          debtOfExact: { ...(row.debtOfExact as MutableRecord), result: abiUint(0n) },
        }));
      },
    });

    const result = await source(testHarness).readTarget(request());

    expect(result.status).toBe('COMPLETE');
    expect(result.positions).toEqual([]);
    const issued = testHarness.transcriptRead.mock
      .calls[0]?.[0] as ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1;
    expect(issued.accountReadPlans).toHaveLength(256);
  });

  it.each([
    [
      'partial EVC account coverage',
      (candidate: MutableRecord): void => {
        candidate.accounts = (candidate.accounts as MutableRecord[]).slice(0, -1);
      },
    ],
    [
      'reordered EVC accounts',
      (candidate: MutableRecord): void => {
        const rows = candidate.accounts as MutableRecord[];
        [rows[0], rows[1]] = [rows[1] as MutableRecord, rows[0] as MutableRecord];
      },
    ],
    [
      'derived account-address substitution',
      (candidate: MutableRecord): void => {
        (candidate.accounts as MutableRecord[])[17] = {
          ...(candidate.accounts as MutableRecord[])[17],
          accountAddress: WALLET_ADDRESS,
        };
      },
    ],
    [
      'supply conversion rounding drift',
      (candidate: MutableRecord): void => {
        const row = (candidate.accounts as MutableRecord[])[0] as MutableRecord;
        row.convertToAssets = {
          ...(row.convertToAssets as MutableRecord),
          result: abiUint(1_200_001n),
        };
      },
    ],
    [
      'borrow ceiling rounding drift',
      (candidate: MutableRecord): void => {
        const row = (candidate.accounts as MutableRecord[])[1] as MutableRecord;
        row.debtOf = { ...(row.debtOf as MutableRecord), result: abiUint(1n) };
      },
    ],
    [
      'latest-block account read laundering',
      (candidate: MutableRecord): void => {
        const row = (candidate.accounts as MutableRecord[])[0] as MutableRecord;
        row.balanceOf = { ...(row.balanceOf as MutableRecord), blockParameter: 'latest' };
      },
    ],
    [
      'wrong-vault account call',
      (candidate: MutableRecord): void => {
        const row = (candidate.accounts as MutableRecord[])[0] as MutableRecord;
        row.debtOf = { ...(row.debtOf as MutableRecord), to: ORACLE };
      },
    ],
    [
      'wrong account calldata',
      (candidate: MutableRecord): void => {
        const row = (candidate.accounts as MutableRecord[])[0] as MutableRecord;
        row.debtOfExact = {
          ...(row.debtOfExact as MutableRecord),
          data: `0xab49b7f1${'0'.repeat(64)}`,
        };
      },
    ],
  ] as const)('fails closed on %s', async (_label, mutate) => {
    const testHarness = harness({ transcriptMutator: mutate });

    await expect(source(testHarness).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
  });

  it.each([
    [
      'adapter manifest substitution',
      (candidate: MutableRecord): void => {
        (candidate.vaultTranscript as MutableRecord).manifestFingerprintSha256 = '56'.repeat(32);
      },
    ],
    [
      'adapter vault substitution',
      (candidate: MutableRecord): void => {
        ((candidate.vaultTranscript as MutableRecord).vault as MutableRecord).address =
          WALLET_ADDRESS;
      },
    ],
    [
      'adapter resolved-cap forgery',
      (candidate: MutableRecord): void => {
        (
          (candidate.vaultTranscript as MutableRecord).rawState as MutableRecord
        ).supplyCapResolvedAtomic = '9999999';
      },
    ],
    [
      'adapter max-deposit forgery',
      (candidate: MutableRecord): void => {
        (
          (candidate.vaultTranscript as MutableRecord).rawState as MutableRecord
        ).maxDepositProbeAtomic = '1';
      },
    ],
    [
      'adapter zero conversion forgery',
      (candidate: MutableRecord): void => {
        (
          (candidate.vaultTranscript as MutableRecord).conversionEvidence as MutableRecord
        ).sharesToAssetsAtomic = '0';
      },
    ],
    [
      'selected-block closeout drift',
      (candidate: MutableRecord): void => {
        (candidate.selectedBlockAfter as MutableRecord).stateRoot = `0x${'67'.repeat(32)}`;
      },
    ],
    [
      'durable-floor closeout drift',
      (candidate: MutableRecord): void => {
        (candidate.floorBlockAfter as MutableRecord).hash = `0x${'78'.repeat(32)}`;
      },
    ],
    [
      'wallet-owner gate substitution',
      (candidate: MutableRecord): void => {
        (candidate.walletOwnerGate as MutableRecord).result =
          `0x${'0'.repeat(24)}${VAULT.slice(2)}`;
      },
    ],
    [
      'wrong-EVC owner target',
      (candidate: MutableRecord): void => {
        (candidate.walletOwnerGate as MutableRecord).to = VAULT;
      },
    ],
    [
      'same-block canonicality removal',
      (candidate: MutableRecord): void => {
        (
          (candidate.walletOwnerGate as MutableRecord).blockParameter as MutableRecord
        ).requireCanonical = false;
      },
    ],
    [
      'execution-order drift',
      (candidate: MutableRecord): void => {
        const order = candidate.executionOrder as string[];
        [order[1], order[2]] = [order[2] as string, order[1] as string];
      },
    ],
  ] as const)('rejects %s', async (_label, mutate) => {
    const testHarness = harness({ transcriptMutator: mutate });

    await expect(source(testHarness).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
  });

  it.each([
    ['providerId', 'aave'],
    ['protocolId', 'euler-v1'],
    ['marketId', 'euler-v2-ethereum-mainnet:other'],
    ['networkId', 'eip155:8453'],
    ['sourceKind', 'INDEXER'],
    ['sourceFamilyId', 'ethereum-secondary'],
    ['sourceId', 'euler-rpc-b'],
  ] as const)(
    'rejects request %s substitution before either reader is called',
    async (key, value) => {
      const testHarness = harness();

      await expect(source(testHarness).readTarget(request({ [key]: value }))).rejects.toMatchObject(
        {
          ...FIXED_ERROR,
          code: 'EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
        },
      );
      expect(testHarness.contextRead).not.toHaveBeenCalled();
      expect(testHarness.transcriptRead).not.toHaveBeenCalled();
    },
  );

  it('rejects a substituted asset and added request fields before either reader is called', async () => {
    for (const input of [
      request({
        assets: Object.freeze([Object.freeze({ ...ASSET, identity: VAULT })]),
      }),
      Object.freeze({ ...request(), unexpectedAuthority: true }),
    ]) {
      const testHarness = harness();
      await expect(
        source(testHarness).readTarget(input as ReadProviderPositionAdmissionTargetRequestV1),
      ).rejects.toMatchObject({
        ...FIXED_ERROR,
        code: 'EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
      });
      expect(testHarness.contextRead).not.toHaveBeenCalled();
      expect(testHarness.transcriptRead).not.toHaveBeenCalled();
    }
  });

  it('requires exact manifest and account-semantics fingerprints at construction', () => {
    const testHarness = harness();

    expect(() => source(testHarness, MANIFEST, '90'.repeat(32))).toThrow(
      DormantEulerV2EthereumProviderPositionSourceError,
    );
    expect(() =>
      source(testHarness, MANIFEST, MANIFEST.manifestFingerprintSha256, '91'.repeat(32)),
    ).toThrow(DormantEulerV2EthereumProviderPositionSourceError);
  });

  it('rejects same receiver, source family, or source id laundering at construction', () => {
    const testHarness = harness();
    const sameFamily = {
      ...testHarness.contextReader,
      sourceFamilyId: SOURCE_FAMILY_ID,
    };
    const sameId = {
      ...testHarness.contextReader,
      sourceId: SOURCE_ID,
    };
    for (const contextReader of [sameFamily, sameId]) {
      expect(
        () =>
          new DormantEulerV2EthereumProviderPositionSource(
            MANIFEST,
            MANIFEST.manifestFingerprintSha256,
            EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
            contextReader,
            testHarness.transcriptReader,
            testHarness.clock,
          ),
      ).toThrow(DormantEulerV2EthereumProviderPositionSourceError);
    }

    const shared = {
      contextVersion: EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
      transcriptVersion: EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
      sourceFamilyId: 'shared-family',
      sourceId: 'shared-source',
      readContext: jest.fn(),
      reviewContext: jest.fn(),
      readTranscript: jest.fn(),
      reviewTranscript: jest.fn(),
    };
    expect(
      () =>
        new DormantEulerV2EthereumProviderPositionSource(
          MANIFEST,
          MANIFEST.manifestFingerprintSha256,
          EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
          shared,
          shared,
          testHarness.clock,
        ),
    ).toThrow(DormantEulerV2EthereumProviderPositionSourceError);
  });

  it('authenticates both opaque capabilities before any property inspection', async () => {
    let traps = 0;
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          traps += 1;
          throw new Error('must remain opaque');
        },
      },
    );
    const contextFailure = harness({ reviewContext: false });
    contextFailure.contextReader.readContext = jest.fn(async () => hostile);
    await expect(source(contextFailure).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
    expect(traps).toBe(0);
    expect(contextFailure.transcriptRead).not.toHaveBeenCalled();

    const transcriptFailure = harness({ reviewTranscript: false });
    transcriptFailure.transcriptReader.readTranscript = jest.fn(async () => hostile);
    await expect(source(transcriptFailure).readTarget(request())).rejects.toMatchObject(
      FIXED_ERROR,
    );
    expect(traps).toBe(0);
  });

  it('fails closed on stale adapter evidence and deadline expiry', async () => {
    const stale = harness({
      transcriptMutator: (candidate) => {
        (candidate.vaultTranscript as MutableRecord).observedAt = STARTED_AT;
      },
    });
    await expect(source(stale).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);

    const expired = harness({
      times: [STARTED_AT, CONTEXT_SETTLED_AT, DEADLINE_AT, DEADLINE_AT],
    });
    await expect(source(expired).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
  });

  it('contains no runtime registration, transport, persistence, signing, or route authority', () => {
    const sourceText = readFileSync(
      join(__dirname, 'dormant-euler-v2-ethereum-provider-position.source.ts'),
      'utf8',
    );

    for (const forbidden of [
      '@Injectable',
      '@Module',
      '@Controller',
      'http://',
      'https://',
      'fetch(',
      'privateKey',
      'signTransaction',
      'sendRawTransaction',
      'DATABASE_URL',
    ]) {
      expect(sourceText).not.toContain(forbidden);
    }
  });
});
