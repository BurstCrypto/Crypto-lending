import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  TESTNET_SUPPORTED_ASSET_REGISTRY,
  type AssetRegistryEnvironment,
  type SupportedChain,
  type VersionedSupportedAssetRegistry,
} from './supported-asset-registry';
import { LOCAL_EVM_DEVELOPMENT_MANIFEST } from './local-evm-development';

export const CHAIN_OBSERVATION_POLICY_VERSION = 1 as const;
export const CHAIN_OBSERVATION_TIERS = Object.freeze([
  'PROVISIONAL',
  'CANONICAL',
  'FINANCIAL',
] as const);

export type ChainObservationTier = (typeof CHAIN_OBSERVATION_TIERS)[number];
export type ChainObservationNetworkId =
  | 'eip155:1'
  | 'eip155:31337'
  | 'eip155:11155111'
  | 'eip155:8453'
  | 'eip155:84532'
  | 'eip155:42161'
  | 'eip155:421614'
  | 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
  | 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

export type ChainObservationEnvironment = AssetRegistryEnvironment | 'LOCAL';

export type ChainObservationMethod =
  | 'eth_blockNumber'
  | 'eth_call'
  | 'eth_chainId'
  | 'eth_getBalance'
  | 'eth_getBlockByHash'
  | 'eth_getBlockByNumber'
  | 'eth_getCode'
  | 'eth_getLogs'
  | 'eth_getTransactionByHash'
  | 'eth_getTransactionReceipt'
  | 'getAccountInfo'
  | 'getBlock'
  | 'getBlockHeight'
  | 'getGenesisHash'
  | 'getHealth'
  | 'getLatestBlockhash'
  | 'getMultipleAccounts'
  | 'getSignatureStatuses'
  | 'getSignaturesForAddress'
  | 'getSlot'
  | 'getTokenAccountBalance'
  | 'getTokenAccountsByOwner'
  | 'getTransaction'
  | 'getVersion';

export type ChainObservationHintMethod =
  | 'eth_subscribe'
  | 'accountSubscribe'
  | 'logsSubscribe'
  | 'programSubscribe'
  | 'rootSubscribe'
  | 'signatureSubscribe'
  | 'slotSubscribe';

export type ChainObservationSubscription =
  | 'logs'
  | 'newHeads'
  | 'accountSubscribe'
  | 'logsSubscribe'
  | 'programSubscribe'
  | 'slotSubscribe'
  | 'rootSubscribe'
  | 'signatureSubscribe';

export type ChainObservationSelector = 'latest' | 'safe' | 'finalized' | 'processed' | 'confirmed';

export type ChainObservationTierState =
  'ALLOWED' | 'REQUIRES_LIVE_PROOF' | 'BLOCKED_PENDING_LIVE_PROOF';

export type ChainIdentityProbe =
  | Readonly<{
      kind: 'EVM_CHAIN_ID';
      method: 'eth_chainId';
      expectedResult: string;
    }>
  | Readonly<{
      kind: 'SOLANA_GENESIS_HASH';
      method: 'getGenesisHash';
      expectedResult: string;
      expectedCaipReference: string;
      derivation: 'FIRST_32_BASE58_CHARACTERS';
    }>;

export interface ChainObservationTierRule {
  readonly tier: ChainObservationTier;
  readonly selector: ChainObservationSelector;
  readonly state: ChainObservationTierState;
  readonly authority: 'DISPLAY_ONLY' | 'CANONICAL_INDEXING' | 'FINANCIAL_AND_LEDGER';
}

export interface ChainObservationNetworkPolicy {
  readonly chain: SupportedChain;
  readonly environment: ChainObservationEnvironment;
  readonly networkId: ChainObservationNetworkId;
  readonly registryVersion: 1;
  readonly registryFingerprintSha256: string;
  readonly identityProbe: ChainIdentityProbe;
  readonly allowedMethods: readonly ChainObservationMethod[];
  readonly tiers: readonly ChainObservationTierRule[];
  readonly freshness: Readonly<{
    currentWithinMs: number;
    unavailableAfterMs: number;
  }>;
  readonly finality: Readonly<{
    stallAfterMs: number;
    liveCapabilityProofRequired: boolean;
  }>;
  readonly transport: Readonly<{
    authoritative: 'POLLING';
    webSocket: Readonly<{
      role: 'NOTIFICATION_HINT_ONLY';
      allowedMethods: readonly ChainObservationHintMethod[];
      allowedSubscriptions: readonly ChainObservationSubscription[];
      invocation: 'ETH_SUBSCRIBE_WITH_ALLOWLISTED_NAME' | 'DIRECT_SOLANA_SUBSCRIPTION_METHOD';
      checkpointAuthority: 'NEVER_ADVANCE_FROM_NOTIFICATION_ALONE';
      disconnectOrGap: 'AUTHORITATIVE_POLLING_BACKFILL_REQUIRED';
    }>;
  }>;
  readonly monotonicReadConstraint: 'PIN_BLOCK_NUMBER_AND_HASH' | 'MIN_CONTEXT_SLOT_REQUIRED';
}

export const CHAIN_OBSERVATION_REGISTRY_BINDINGS = deepFreeze({
  MAINNET: {
    registryVersion: 1,
    fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
    networkIds: [
      'eip155:1',
      'eip155:8453',
      'eip155:42161',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    ],
  },
  TESTNET: {
    registryVersion: 1,
    fingerprintSha256: '89c158de188fcde7d01642aadef226f3c93724bfe5b53a7f3fcce096180d5ca7',
    networkIds: [
      'eip155:11155111',
      'eip155:84532',
      'eip155:421614',
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    ],
  },
} as const);

const EVM_ALLOWED_METHODS = deepFreeze([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_getBalance',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
] as const);

const EVM_HINT_METHODS = deepFreeze(['eth_subscribe'] as const);
const EVM_HINT_SUBSCRIPTIONS = deepFreeze(['logs', 'newHeads'] as const);

const SOLANA_ALLOWED_METHODS = deepFreeze([
  'getAccountInfo',
  'getBlock',
  'getBlockHeight',
  'getGenesisHash',
  'getHealth',
  'getLatestBlockhash',
  'getMultipleAccounts',
  'getSignatureStatuses',
  'getSignaturesForAddress',
  'getSlot',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
  'getTransaction',
  'getVersion',
] as const);

const SOLANA_HINT_METHODS = deepFreeze([
  'accountSubscribe',
  'logsSubscribe',
  'programSubscribe',
  'rootSubscribe',
  'signatureSubscribe',
  'slotSubscribe',
] as const);
const SOLANA_HINT_SUBSCRIPTIONS = SOLANA_HINT_METHODS;

const EVM_TIER_RULES = deepFreeze([
  tier('PROVISIONAL', 'latest', 'ALLOWED', 'DISPLAY_ONLY'),
  tier('CANONICAL', 'safe', 'REQUIRES_LIVE_PROOF', 'CANONICAL_INDEXING'),
  tier('FINANCIAL', 'finalized', 'ALLOWED', 'FINANCIAL_AND_LEDGER'),
] as const);

const ARBITRUM_TIER_RULES = deepFreeze([
  tier('PROVISIONAL', 'latest', 'ALLOWED', 'DISPLAY_ONLY'),
  tier('CANONICAL', 'safe', 'BLOCKED_PENDING_LIVE_PROOF', 'CANONICAL_INDEXING'),
  tier('FINANCIAL', 'finalized', 'BLOCKED_PENDING_LIVE_PROOF', 'FINANCIAL_AND_LEDGER'),
] as const);

const LOCAL_EVM_TIER_RULES = deepFreeze([
  tier('PROVISIONAL', 'latest', 'ALLOWED', 'DISPLAY_ONLY'),
  tier('CANONICAL', 'safe', 'BLOCKED_PENDING_LIVE_PROOF', 'CANONICAL_INDEXING'),
  tier('FINANCIAL', 'finalized', 'BLOCKED_PENDING_LIVE_PROOF', 'FINANCIAL_AND_LEDGER'),
] as const);

const SOLANA_TIER_RULES = deepFreeze([
  tier('PROVISIONAL', 'processed', 'ALLOWED', 'DISPLAY_ONLY'),
  tier('CANONICAL', 'confirmed', 'REQUIRES_LIVE_PROOF', 'CANONICAL_INDEXING'),
  tier('FINANCIAL', 'finalized', 'ALLOWED', 'FINANCIAL_AND_LEDGER'),
] as const);

export const CHAIN_OBSERVATION_RESILIENCE_POLICY = deepFreeze({
  reads: {
    connectTimeoutMs: 2_000,
    requestTimeoutMs: 5_000,
    maxAttempts: 3,
    retryBackoff: 'EXPONENTIAL_FULL_JITTER',
    retryScope: 'IDEMPOTENT_ALLOWLIST_ONLY',
  },
  circuitBreaker: {
    consecutiveFailureThreshold: 5,
    openMs: 60_000,
    halfOpenProbeCount: 1,
  },
  fallback: {
    behavior: 'EXACT_APPROVED_ALTERNATE_ONLY',
    requireIndependentFailureDomain: true,
    requireIdentityProbe: true,
    requireFinalizedCheckpointCompatibility: true,
    unapprovedDefault: 'DENY',
  },
  recovery: {
    commonAncestor: 'LAST_FINALIZED_COMMON_ANCESTOR',
    maxReadUnitsPerJob: 2_048,
    continuation: 'REQUIRED_WHEN_LIMIT_REACHED',
    mutationScope: 'PROVISIONAL_ONLY',
  },
  failure: {
    lastGoodObservation: 'RETAIN',
    missingBalance: 'NEVER_REPLACE_WITH_ZERO',
    transactionSubmission: 'DISABLED',
    automaticResubmission: 'NEVER',
    financialUse: 'FAIL_CLOSED',
  },
} as const);

export const CHAIN_OBSERVATION_NETWORK_POLICIES = deepFreeze([
  evmPolicy('ETHEREUM', 'MAINNET', 'eip155:1', '0x1', 60_000, 900_000, 1_800_000),
  evmPolicy('ETHEREUM', 'LOCAL', 'eip155:31337', '0x7a69', 60_000, 300_000, 300_000),
  evmPolicy('ETHEREUM', 'TESTNET', 'eip155:11155111', '0xaa36a7', 60_000, 900_000, 1_800_000),
  evmPolicy('BASE', 'MAINNET', 'eip155:8453', '0x2105', 30_000, 300_000, 2_700_000),
  evmPolicy('BASE', 'TESTNET', 'eip155:84532', '0x14a34', 30_000, 300_000, 2_700_000),
  evmPolicy('ARBITRUM', 'MAINNET', 'eip155:42161', '0xa4b1', 30_000, 300_000, 2_700_000),
  evmPolicy('ARBITRUM', 'TESTNET', 'eip155:421614', '0x66eee', 30_000, 300_000, 2_700_000),
  solanaPolicy(
    'MAINNET',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    15_000,
    120_000,
    90_000,
  ),
  solanaPolicy(
    'TESTNET',
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    15_000,
    120_000,
    90_000,
  ),
] as const satisfies readonly ChainObservationNetworkPolicy[]);

export type ChainObservationFreshness = 'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'QUARANTINED';

export interface ChainHeadProgressInput {
  readonly networkId: ChainObservationNetworkId;
  readonly nowMs: number;
  readonly identityValidated: boolean;
  readonly previous: Readonly<{ position: bigint; advancedAtMs: number }> | null;
  readonly candidate: Readonly<{ position: bigint; retrievedAtMs: number }>;
}

export interface ChainObservationFreshnessDecision {
  readonly freshness: ChainObservationFreshness;
  readonly effectiveHeadAdvancedAtMs: number | null;
  readonly retrievalAgeMs: number | null;
  readonly headAdvanceAgeMs: number | null;
  readonly reason:
    | 'VALIDATED_AND_ADVANCING'
    | 'VALIDATED_BUT_STALE'
    | 'VALIDATED_BUT_EXPIRED'
    | 'IDENTITY_NOT_VALIDATED'
    | 'HEAD_REGRESSION'
    | 'INVALID_PROGRESS';
}

export function chainObservationPolicyForNetwork(
  networkId: string,
): ChainObservationNetworkPolicy | undefined {
  return CHAIN_OBSERVATION_NETWORK_POLICIES.find((policy) => policy.networkId === networkId);
}

export function isAllowedChainObservationMethod(
  networkId: ChainObservationNetworkId,
  method: string,
): method is ChainObservationMethod {
  return (
    chainObservationPolicyForNetwork(networkId)?.allowedMethods.includes(
      method as ChainObservationMethod,
    ) === true
  );
}

export function isExpectedChainIdentity(networkId: string, observedResult: unknown): boolean {
  const probe = chainObservationPolicyForNetwork(networkId)?.identityProbe;
  return (
    probe !== undefined &&
    typeof observedResult === 'string' &&
    probe.expectedResult === observedResult
  );
}

export function observationTierRule(
  networkId: string,
  requestedTier: string,
): ChainObservationTierRule | undefined {
  const policy = chainObservationPolicyForNetwork(networkId);
  if (!policy) return undefined;
  const rule = policy.tiers.find(({ tier: candidateTier }) => candidateTier === requestedTier);
  return rule;
}

export interface ChainObservationFinancialApprovalInput {
  readonly providerSelectionApproved: boolean;
  readonly exactHostEgressApproved: boolean;
  readonly liveCapabilityProofValidated: boolean;
  readonly registryBindingValidated: boolean;
  readonly independentFinalizedSourcesAgree: boolean;
  readonly identityValidated: boolean;
  readonly freshness: ChainObservationFreshness;
  readonly finalityStatus: FinalityProgressStatus;
  readonly lineageValidated: boolean;
  readonly quarantineClear: boolean;
}

export function canObservationAuthorizeFinancialUse(
  networkId: string,
  requestedTier: string,
  approvals: ChainObservationFinancialApprovalInput,
): boolean {
  const rule = observationTierRule(networkId, requestedTier);
  return (
    requestedTier === 'FINANCIAL' &&
    rule?.state === 'ALLOWED' &&
    isRecord(approvals) &&
    approvals.providerSelectionApproved === true &&
    approvals.exactHostEgressApproved === true &&
    approvals.liveCapabilityProofValidated === true &&
    approvals.registryBindingValidated === true &&
    approvals.independentFinalizedSourcesAgree === true &&
    approvals.identityValidated === true &&
    approvals.freshness === 'CURRENT' &&
    approvals.finalityStatus === 'HEALTHY' &&
    approvals.lineageValidated === true &&
    approvals.quarantineClear === true
  );
}

export function classifyChainObservationFreshness(
  input: ChainHeadProgressInput,
): ChainObservationFreshnessDecision {
  if (!isRecord(input) || typeof input.networkId !== 'string') {
    return freshnessDecision('UNAVAILABLE', null, null, null, 'INVALID_PROGRESS');
  }
  const policy = chainObservationPolicyForNetwork(input.networkId);
  if (!policy || input.identityValidated !== true) {
    return freshnessDecision('UNAVAILABLE', null, null, null, 'IDENTITY_NOT_VALIDATED');
  }
  if (
    !validTime(input.nowMs) ||
    !validHeadCandidate(input.candidate) ||
    (input.previous !== null && !validHeadProgress(input.previous))
  ) {
    return freshnessDecision('UNAVAILABLE', null, null, null, 'INVALID_PROGRESS');
  }
  if (input.candidate.position < 0n || input.candidate.retrievedAtMs > input.nowMs) {
    return freshnessDecision('UNAVAILABLE', null, null, null, 'INVALID_PROGRESS');
  }

  let effectiveHeadAdvancedAtMs = input.candidate.retrievedAtMs;
  if (input.previous) {
    if (
      input.previous.position < 0n ||
      !validTime(input.previous.advancedAtMs) ||
      input.previous.advancedAtMs > input.nowMs ||
      input.candidate.retrievedAtMs < input.previous.advancedAtMs
    ) {
      return freshnessDecision('UNAVAILABLE', null, null, null, 'INVALID_PROGRESS');
    }
    if (input.candidate.position < input.previous.position) {
      return freshnessDecision(
        'QUARANTINED',
        input.previous.advancedAtMs,
        input.nowMs - input.candidate.retrievedAtMs,
        input.nowMs - input.previous.advancedAtMs,
        'HEAD_REGRESSION',
      );
    }
    if (input.candidate.position === input.previous.position) {
      effectiveHeadAdvancedAtMs = input.previous.advancedAtMs;
    }
  }

  const retrievalAgeMs = input.nowMs - input.candidate.retrievedAtMs;
  const headAdvanceAgeMs = input.nowMs - effectiveHeadAdvancedAtMs;
  const effectiveAgeMs = Math.max(retrievalAgeMs, headAdvanceAgeMs);
  if (effectiveAgeMs <= policy.freshness.currentWithinMs) {
    return freshnessDecision(
      'CURRENT',
      effectiveHeadAdvancedAtMs,
      retrievalAgeMs,
      headAdvanceAgeMs,
      'VALIDATED_AND_ADVANCING',
    );
  }
  if (effectiveAgeMs <= policy.freshness.unavailableAfterMs) {
    return freshnessDecision(
      'STALE',
      effectiveHeadAdvancedAtMs,
      retrievalAgeMs,
      headAdvanceAgeMs,
      'VALIDATED_BUT_STALE',
    );
  }
  return freshnessDecision(
    'UNAVAILABLE',
    effectiveHeadAdvancedAtMs,
    retrievalAgeMs,
    headAdvanceAgeMs,
    'VALIDATED_BUT_EXPIRED',
  );
}

export type FinalityProgressStatus =
  'HEALTHY' | 'STALLED' | 'UNAVAILABLE' | 'QUARANTINED' | 'BLOCKED_PENDING_LIVE_PROOF';

export interface FinalityProgressInput extends ChainHeadProgressInput {
  readonly liveCapabilityProofValidated: boolean;
}

export interface FinalityProgressDecision {
  readonly status: FinalityProgressStatus;
  readonly effectiveFinalizedAdvancedAtMs: number | null;
  readonly reason:
    | 'FINALITY_ADVANCING'
    | 'FINALITY_STALLED'
    | 'FINALIZED_HEAD_REGRESSION'
    | 'LIVE_CAPABILITY_PROOF_REQUIRED'
    | 'INVALID_FINALITY_PROGRESS';
}

export function classifyFinalityProgress(input: FinalityProgressInput): FinalityProgressDecision {
  if (!isRecord(input) || typeof input.networkId !== 'string') {
    return finalityDecision('UNAVAILABLE', null, 'INVALID_FINALITY_PROGRESS');
  }
  const policy = chainObservationPolicyForNetwork(input.networkId);
  if (!policy) return finalityDecision('UNAVAILABLE', null, 'INVALID_FINALITY_PROGRESS');
  if (
    input.identityValidated !== true ||
    typeof input.liveCapabilityProofValidated !== 'boolean' ||
    !validTime(input.nowMs) ||
    !validHeadCandidate(input.candidate) ||
    (input.previous !== null && !validHeadProgress(input.previous)) ||
    input.candidate.retrievedAtMs > input.nowMs ||
    input.candidate.position < 0n
  ) {
    return finalityDecision('UNAVAILABLE', null, 'INVALID_FINALITY_PROGRESS');
  }
  if (policy.finality.liveCapabilityProofRequired && !input.liveCapabilityProofValidated) {
    return finalityDecision('BLOCKED_PENDING_LIVE_PROOF', null, 'LIVE_CAPABILITY_PROOF_REQUIRED');
  }

  let advancedAtMs = input.candidate.retrievedAtMs;
  if (input.previous) {
    if (
      input.previous.position < 0n ||
      !validTime(input.previous.advancedAtMs) ||
      input.previous.advancedAtMs > input.nowMs ||
      input.candidate.retrievedAtMs < input.previous.advancedAtMs
    ) {
      return finalityDecision('UNAVAILABLE', null, 'INVALID_FINALITY_PROGRESS');
    }
    if (input.candidate.position < input.previous.position) {
      return finalityDecision(
        'QUARANTINED',
        input.previous.advancedAtMs,
        'FINALIZED_HEAD_REGRESSION',
      );
    }
    if (input.candidate.position === input.previous.position) {
      advancedAtMs = input.previous.advancedAtMs;
    }
  }

  if (input.nowMs - advancedAtMs > policy.finality.stallAfterMs) {
    return finalityDecision('STALLED', advancedAtMs, 'FINALITY_STALLED');
  }
  return finalityDecision('HEALTHY', advancedAtMs, 'FINALITY_ADVANCING');
}

export interface ChainBlockReference {
  readonly position: bigint;
  readonly hash: string;
  readonly parentHash: string;
}

export type ChainContinuityAction =
  | 'ACCEPT_APPEND'
  | 'ACCEPT_NO_CHANGE'
  | 'VERIFY_BOUNDED_CONTINUITY_FROM_LAST_FINALIZED_CHECKPOINT'
  | 'RECOVER_PROVISIONAL_FROM_LAST_FINALIZED_COMMON_ANCESTOR'
  | 'QUARANTINE_FINALIZED_DISAGREEMENT'
  | 'FAIL_CLOSED_BLOCKED_TIER';

export interface ChainContinuityDecision {
  readonly action: ChainContinuityAction;
  readonly maxReadUnits: number;
  readonly mayMutateFinalizedFacts: false;
}

export function decideChainContinuity(
  input: Readonly<{
    networkId: ChainObservationNetworkId;
    tier: ChainObservationTier;
    liveCapabilityProofValidated: boolean;
    previous: ChainBlockReference;
    candidate: ChainBlockReference;
  }>,
): ChainContinuityDecision {
  if (!isRecord(input) || typeof input.networkId !== 'string' || typeof input.tier !== 'string') {
    return continuityDecision('FAIL_CLOSED_BLOCKED_TIER');
  }
  const rule = observationTierRule(input.networkId, input.tier);
  if (
    !rule ||
    rule.state === 'BLOCKED_PENDING_LIVE_PROOF' ||
    (input.tier !== 'PROVISIONAL' && input.liveCapabilityProofValidated !== true)
  ) {
    return continuityDecision('FAIL_CLOSED_BLOCKED_TIER');
  }
  if (!validBlockReference(input.previous) || !validBlockReference(input.candidate)) {
    return input.tier === 'FINANCIAL'
      ? continuityDecision('QUARANTINE_FINALIZED_DISAGREEMENT')
      : continuityDecision('RECOVER_PROVISIONAL_FROM_LAST_FINALIZED_COMMON_ANCESTOR');
  }
  if (
    input.candidate.position === input.previous.position &&
    input.candidate.hash === input.previous.hash &&
    input.candidate.parentHash === input.previous.parentHash
  ) {
    return continuityDecision('ACCEPT_NO_CHANGE');
  }
  if (input.candidate.position <= input.previous.position) {
    return input.tier === 'FINANCIAL'
      ? continuityDecision('QUARANTINE_FINALIZED_DISAGREEMENT')
      : continuityDecision('RECOVER_PROVISIONAL_FROM_LAST_FINALIZED_COMMON_ANCESTOR');
  }
  if (input.candidate.position === input.previous.position + 1n) {
    if (input.candidate.parentHash === input.previous.hash) {
      return continuityDecision('ACCEPT_APPEND');
    }
    return input.tier === 'FINANCIAL'
      ? continuityDecision('QUARANTINE_FINALIZED_DISAGREEMENT')
      : continuityDecision('RECOVER_PROVISIONAL_FROM_LAST_FINALIZED_COMMON_ANCESTOR');
  }
  return continuityDecision('VERIFY_BOUNDED_CONTINUITY_FROM_LAST_FINALIZED_CHECKPOINT');
}

export type FinalizedSourceAgreement =
  'AGREED' | 'BLOCKED_NOT_ALIGNED' | 'QUARANTINE_FINALIZED_DISAGREEMENT';

export interface ChainFinalizedCheckpoint extends ChainBlockReference {
  readonly networkId: ChainObservationNetworkId;
}

export function compareFinalizedSourceCheckpoints(
  primary: ChainFinalizedCheckpoint,
  fallback: ChainFinalizedCheckpoint,
): FinalizedSourceAgreement {
  if (!validFinalizedCheckpoint(primary) || !validFinalizedCheckpoint(fallback)) {
    return 'QUARANTINE_FINALIZED_DISAGREEMENT';
  }
  if (primary.networkId !== fallback.networkId) return 'BLOCKED_NOT_ALIGNED';
  if (primary.position !== fallback.position) return 'BLOCKED_NOT_ALIGNED';
  return primary.hash === fallback.hash && primary.parentHash === fallback.parentHash
    ? 'AGREED'
    : 'QUARANTINE_FINALIZED_DISAGREEMENT';
}

export type ChainFallbackAction =
  'USE_PRIMARY' | 'USE_EXACT_APPROVED_FALLBACK' | 'FAIL_CLOSED_RETAIN_LAST_GOOD';

export function decideChainObservationFallback(
  input: Readonly<{
    primaryAvailable: boolean;
    primaryCircuitOpen: boolean;
    alternateApproved: boolean;
    alternateFailureDomainIndependent: boolean;
    alternateIdentityValidated: boolean;
    alternateFinalizedCheckpointCompatible: boolean;
  }>,
): ChainFallbackAction {
  if (!isRecord(input)) return 'FAIL_CLOSED_RETAIN_LAST_GOOD';
  if (input.primaryAvailable === true && input.primaryCircuitOpen === false) return 'USE_PRIMARY';
  if (
    input.primaryCircuitOpen === true &&
    input.alternateApproved === true &&
    input.alternateFailureDomainIndependent === true &&
    input.alternateIdentityValidated === true &&
    input.alternateFinalizedCheckpointCompatible === true
  ) {
    return 'USE_EXACT_APPROVED_FALLBACK';
  }
  return 'FAIL_CLOSED_RETAIN_LAST_GOOD';
}

function tier(
  requestedTier: ChainObservationTier,
  selector: ChainObservationSelector,
  state: ChainObservationTierState,
  authority: ChainObservationTierRule['authority'],
): ChainObservationTierRule {
  return { tier: requestedTier, selector, state, authority };
}

function evmPolicy(
  chain: Exclude<SupportedChain, 'SOLANA'>,
  environment: ChainObservationEnvironment,
  networkId: ChainObservationNetworkId,
  expectedChainId: string,
  currentWithinMs: number,
  unavailableAfterMs: number,
  finalityStallAfterMs: number,
): ChainObservationNetworkPolicy {
  const registryFingerprintSha256 =
    environment === 'LOCAL'
      ? LOCAL_EVM_DEVELOPMENT_MANIFEST.registryFingerprintSha256
      : CHAIN_OBSERVATION_REGISTRY_BINDINGS[environment].fingerprintSha256;
  return {
    chain,
    environment,
    networkId,
    registryVersion: 1,
    registryFingerprintSha256,
    identityProbe: { kind: 'EVM_CHAIN_ID', method: 'eth_chainId', expectedResult: expectedChainId },
    allowedMethods: EVM_ALLOWED_METHODS,
    tiers:
      environment === 'LOCAL'
        ? LOCAL_EVM_TIER_RULES
        : chain === 'ARBITRUM'
          ? ARBITRUM_TIER_RULES
          : EVM_TIER_RULES,
    freshness: { currentWithinMs, unavailableAfterMs },
    finality: {
      stallAfterMs: finalityStallAfterMs,
      liveCapabilityProofRequired: true,
    },
    transport: transportPolicy(
      EVM_HINT_METHODS,
      EVM_HINT_SUBSCRIPTIONS,
      'ETH_SUBSCRIBE_WITH_ALLOWLISTED_NAME',
    ),
    monotonicReadConstraint: 'PIN_BLOCK_NUMBER_AND_HASH',
  };
}

function solanaPolicy(
  environment: AssetRegistryEnvironment,
  networkId: Extract<ChainObservationNetworkId, `solana:${string}`>,
  expectedGenesisHash: string,
  currentWithinMs: number,
  unavailableAfterMs: number,
  finalityStallAfterMs: number,
): ChainObservationNetworkPolicy {
  return {
    chain: 'SOLANA',
    environment,
    networkId,
    registryVersion: 1,
    registryFingerprintSha256: CHAIN_OBSERVATION_REGISTRY_BINDINGS[environment].fingerprintSha256,
    identityProbe: {
      kind: 'SOLANA_GENESIS_HASH',
      method: 'getGenesisHash',
      expectedResult: expectedGenesisHash,
      expectedCaipReference: networkId.slice('solana:'.length),
      derivation: 'FIRST_32_BASE58_CHARACTERS',
    },
    allowedMethods: SOLANA_ALLOWED_METHODS,
    tiers: SOLANA_TIER_RULES,
    freshness: { currentWithinMs, unavailableAfterMs },
    finality: { stallAfterMs: finalityStallAfterMs, liveCapabilityProofRequired: true },
    transport: transportPolicy(
      SOLANA_HINT_METHODS,
      SOLANA_HINT_SUBSCRIPTIONS,
      'DIRECT_SOLANA_SUBSCRIPTION_METHOD',
    ),
    monotonicReadConstraint: 'MIN_CONTEXT_SLOT_REQUIRED',
  };
}

function transportPolicy(
  allowedMethods: readonly ChainObservationHintMethod[],
  allowedSubscriptions: readonly ChainObservationSubscription[],
  invocation: ChainObservationNetworkPolicy['transport']['webSocket']['invocation'],
): ChainObservationNetworkPolicy['transport'] {
  return {
    authoritative: 'POLLING',
    webSocket: {
      role: 'NOTIFICATION_HINT_ONLY',
      allowedMethods,
      allowedSubscriptions,
      invocation,
      checkpointAuthority: 'NEVER_ADVANCE_FROM_NOTIFICATION_ALONE',
      disconnectOrGap: 'AUTHORITATIVE_POLLING_BACKFILL_REQUIRED',
    },
  };
}

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validHeadCandidate(
  value: unknown,
): value is Readonly<{ position: bigint; retrievedAtMs: number }> {
  return (
    isRecord(value) &&
    typeof value.position === 'bigint' &&
    value.position >= 0n &&
    validTime(value.retrievedAtMs)
  );
}

function validHeadProgress(
  value: unknown,
): value is Readonly<{ position: bigint; advancedAtMs: number }> {
  return (
    isRecord(value) &&
    typeof value.position === 'bigint' &&
    value.position >= 0n &&
    validTime(value.advancedAtMs)
  );
}

function validBlockReference(value: unknown): value is ChainBlockReference {
  return (
    isRecord(value) &&
    typeof value.position === 'bigint' &&
    value.position >= 0n &&
    typeof value.hash === 'string' &&
    validOpaqueHash(value.hash) &&
    typeof value.parentHash === 'string' &&
    validOpaqueHash(value.parentHash)
  );
}

function validFinalizedCheckpoint(value: unknown): value is ChainFinalizedCheckpoint {
  const networkId: unknown = isRecord(value) ? value.networkId : undefined;
  return (
    validBlockReference(value) &&
    typeof networkId === 'string' &&
    chainObservationPolicyForNetwork(networkId) !== undefined
  );
}

function validOpaqueHash(value: string): boolean {
  return value.length >= 3 && value.length <= 128 && !/\s/u.test(value);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function freshnessDecision(
  freshness: ChainObservationFreshness,
  effectiveHeadAdvancedAtMs: number | null,
  retrievalAgeMs: number | null,
  headAdvanceAgeMs: number | null,
  reason: ChainObservationFreshnessDecision['reason'],
): ChainObservationFreshnessDecision {
  return Object.freeze({
    freshness,
    effectiveHeadAdvancedAtMs,
    retrievalAgeMs,
    headAdvanceAgeMs,
    reason,
  });
}

function finalityDecision(
  status: FinalityProgressStatus,
  effectiveFinalizedAdvancedAtMs: number | null,
  reason: FinalityProgressDecision['reason'],
): FinalityProgressDecision {
  return Object.freeze({ status, effectiveFinalizedAdvancedAtMs, reason });
}

function continuityDecision(action: ChainContinuityAction): ChainContinuityDecision {
  return Object.freeze({
    action,
    maxReadUnits: CHAIN_OBSERVATION_RESILIENCE_POLICY.recovery.maxReadUnitsPerJob,
    mayMutateFinalizedFacts: false as const,
  });
}

function assertRegistryBinding(
  environment: AssetRegistryEnvironment,
  registry: VersionedSupportedAssetRegistry,
): void {
  const expected = CHAIN_OBSERVATION_REGISTRY_BINDINGS[environment];
  const actualNetworks = registry.latest.networks.map(({ networkId }) => networkId);
  if (
    registry.environment !== environment ||
    registry.latest.version !== expected.registryVersion ||
    registry.latest.fingerprintSha256 !== expected.fingerprintSha256 ||
    actualNetworks.length !== expected.networkIds.length ||
    expected.networkIds.some((networkId) => !actualNetworks.includes(networkId))
  ) {
    throw new Error('CHAIN_OBSERVATION_REGISTRY_BINDING_MISMATCH');
  }
}

function deepFreeze<const Value extends object>(value: Value): Readonly<Value> {
  for (const key of Reflect.ownKeys(value)) {
    const child: unknown = Reflect.get(value, key);
    if ((typeof child === 'object' && child !== null) || typeof child === 'function') {
      deepFreeze(child as object);
    }
  }
  return Object.freeze(value);
}

assertRegistryBinding('MAINNET', MAINNET_SUPPORTED_ASSET_REGISTRY);
assertRegistryBinding('TESTNET', TESTNET_SUPPORTED_ASSET_REGISTRY);
