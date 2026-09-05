import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, TextDecoder } from 'node:util';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DECISION_PATH = 'docs/rpc-indexing/kan-62-provider-decision.json';
export const SIDECAR_PATH = 'docs/rpc-indexing/kan-62-provider-decision.sha256';
export const MAX_PROVIDER_DECISION_BYTES = 131_072;
export const MAX_PROVIDER_DECISION_SIDECAR_BYTES = 65;
export const PROVIDER_DECISION_FILES_UNSAFE_ERROR =
  'KAN-62 provider decision or SHA-256 sidecar is unavailable or unsafe.';
export const PROVIDER_DECISION_JSON_INVALID_ERROR = 'KAN-62 provider decision is not valid JSON.';

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;

const TOP_KEYS = [
  'schemaVersion',
  'ticket',
  'decisionReference',
  'asOfDate',
  'localStatus',
  'externalStatus',
  'selection',
  'approvalBoundary',
  'gates',
  'capabilityBoundary',
  'methodProfiles',
  'chainPolicies',
  'networks',
  'providerResearch',
  'commercialResearch',
  'sourceEvidence',
  'undocumentedOrUnverified',
  'zeroCostEvidence',
];
const SELECTION_KEYS = [
  'architecture',
  'primaryProvider',
  'primaryStatus',
  'fallbackProvider',
  'fallbackStatus',
  'fallbackIndependence',
  'runtimeStatus',
  'managedProductsStatus',
  'transactionBroadcastStatus',
];
const APPROVAL_KEYS = [
  'approved',
  'plan',
  'account',
  'endpointHostnames',
  'credentialReferences',
  'regions',
  'sla',
  'monthlyCostUsd',
  'egressDestinations',
  'runtimeActivation',
  'prohibitedUntilGatesPass',
];
const GATE_KEYS = ['ticket', 'kind', 'status', 'blocks', 'requiredEvidence', 'scopeBoundary'];
const CAPABILITY_KEYS = [
  'proposed',
  'excluded',
  'forbiddenMethodPrefixes',
  'transportAuthority',
  'automaticTransactionResubmission',
  'failClosedOnUnsupportedCapability',
];
const TRANSPORT_AUTHORITY_KEYS = [
  'webSocketRole',
  'httpsRole',
  'webSocketOnlyFinancialAdvance',
  'gapPolicy',
];
const METHOD_KEYS = [
  'id',
  'protocol',
  'requiredTransports',
  'httpMethods',
  'webSocketSubscriptions',
  'writeMethods',
  'failClosedIfMissing',
];
const CHAIN_KEYS = ['chain', 'freshness', 'finality', 'reorg', 'outage', 'fallback'];
const FRESHNESS_KEYS = [
  'currentAtOrBelowSeconds',
  'staleAboveSeconds',
  'staleThroughSeconds',
  'unavailableAboveSeconds',
  'finalityStallSeconds',
];
const FINALITY_KEYS = [
  'provisionalSignal',
  'canonicalSignal',
  'financialSignal',
  'testnetIsSlaEvidence',
];
const REORG_KEYS = ['lineage', 'provisionalLogs', 'recovery', 'unknownAncestor'];
const OUTAGE_KEYS = ['webSocketGap', 'rpcFailure', 'statusPage', 'automaticProductionFailover'];
const FALLBACK_KEYS = ['provider', 'identityCheck', 'parity', 'activation'];
const NETWORK_KEYS = [
  'networkId',
  'chain',
  'environment',
  'providerNetworkName',
  'methodProfileId',
  'requiredTransports',
  'identityMethod',
  'expectedIdentity',
  'caipReferenceDerivation',
  'primarySupport',
  'fallbackSupport',
  'primaryArchive',
  'fallbackArchive',
  'historyParity',
  'status',
];
const PROVIDER_RESEARCH_KEYS = [
  'provider',
  'proposedRole',
  'selectionStatus',
  'transportClaim',
  'archiveClaim',
  'rateModel',
  'publishedFreeOffer',
  'publishedPaidMinimum',
  'publishedSla',
  'geographicBehavior',
  'securityAndRetention',
  'approvedPlan',
  'approvedSla',
  'approvedRegion',
  'approvedCostUsd',
];
const COMMERCIAL_KEYS = [
  'observedOn',
  'evidenceMaxAgeDays',
  'recheckRequiredBeforeApproval',
  'currency',
  'taxesEgressBandwidthAddOnsAndSupportFeesIncluded',
  'forecastApproved',
  'pricingApproved',
  'ambiguities',
];
const SOURCE_KEYS = ['id', 'provider', 'topic', 'url', 'observedFact'];
const ZERO_COST_KEYS = [
  'method',
  'providerAccountsCreated',
  'trialsStarted',
  'paymentMethodsAdded',
  'providerEndpointsCreated',
  'apiKeysIssued',
  'rpcRequestsSent',
  'webSocketConnectionsOpened',
  'cloudResourcesCreated',
  'paidServicesActivated',
  'costIncurredUsd',
  'liveEvidenceStatus',
];

const EXPECTED_SELECTION = {
  architecture: 'PROVIDER_NEUTRAL_STANDARD_PROTOCOL_RPC',
  primaryProvider: 'ALCHEMY',
  primaryStatus: 'PROPOSED',
  fallbackProvider: 'QUICKNODE',
  fallbackStatus: 'PROPOSED',
  fallbackIndependence: 'INDEPENDENT_PROVIDER_PENDING_LIVE_PROOF',
  runtimeStatus: 'NOT_APPROVED',
  managedProductsStatus: 'OUT_OF_SCOPE_NOT_APPROVED',
  transactionBroadcastStatus: 'OUT_OF_SCOPE_NOT_APPROVED',
};

const EXPECTED_APPROVAL_BOUNDARY = {
  approved: false,
  plan: null,
  account: null,
  endpointHostnames: [],
  credentialReferences: [],
  regions: [],
  sla: null,
  monthlyCostUsd: null,
  egressDestinations: [],
  runtimeActivation: null,
  prohibitedUntilGatesPass: [
    'CREATE_PROVIDER_ACCOUNT',
    'START_TRIAL',
    'SELECT_PLAN',
    'ADD_PAYMENT_METHOD',
    'CREATE_ENDPOINT',
    'ISSUE_API_KEY',
    'OPEN_PROVIDER_CONNECTION',
    'SEND_RPC_REQUEST',
    'AUTHORIZE_EGRESS',
    'ACTIVATE_RUNTIME_FAILOVER',
  ],
};

const EXPECTED_GATES = [
  {
    ticket: 'KAN-251',
    kind: 'EXTERNAL_APPROVAL_AND_LIVE_VALIDATION',
    status: 'PENDING_EXTERNAL_APPROVAL',
    blocks: 'ANY_PROVIDER_OR_RUNTIME_APPROVAL',
    requiredEvidence: [
      'INDEPENDENT_ARCHITECTURE_SECURITY_PRIVACY_LEGAL_AND_FINANCE_DECISIONS',
      'APPROVED_ACCOUNT_AND_PLAN_WITH_BILLING_CAPS',
      'EXACT_ENDPOINT_HOSTNAMES_AND_CREDENTIAL_REFERENCES',
      'METHOD_TRANSPORT_ARCHIVE_AND_CHAIN_IDENTITY_PARITY',
      'MEASURED_THROUGHPUT_LATENCY_COST_AND_RATE_LIMIT_BEHAVIOR',
      'REORG_FINALITY_DISCONNECT_OUTAGE_AND_FALLBACK_EXERCISES',
      'LOG_REDACTION_RETENTION_RESIDENCY_AND_INCIDENT_RESPONSE REVIEW',
    ],
    scopeBoundary: 'DOES_NOT_AUTHORIZE_NETWORK_EGRESS',
  },
  {
    ticket: 'KAN-231',
    kind: 'EXACT_HOST_EGRESS',
    status: 'PENDING_EXTERNAL_APPROVAL',
    blocks: 'ANY_RUNTIME_CONNECTION',
    requiredEvidence: [
      'KAN_251_APPROVED_EXACT_HOSTNAMES',
      'CALLER_AND_PROTOCOL_SCOPED_DESTINATION_POLICY',
      'TLS_DNS_DENY_BY_DEFAULT_AND_KILL_SWITCH_EVIDENCE',
      'CURRENT_KAN_229_COST_CONTROL_BINDING',
    ],
    scopeBoundary: 'CANNOT_APPROVE_PROVIDER_COMMERCIAL_OR_DATA_SEMANTICS',
  },
];

const EXPECTED_CAPABILITY_BOUNDARY = {
  proposed: [
    'STANDARD_HTTPS_JSON_RPC_READS',
    'STANDARD_WSS_JSON_RPC_SUBSCRIPTIONS',
    'STANDARD_PROTOCOL_HISTORICAL_BACKFILL',
  ],
  excluded: [
    'ALCHEMY_DATA_APIS',
    'ALCHEMY_NOTIFY_AND_SMART_WEBSOCKET_ENHANCEMENTS',
    'ALCHEMY_FLASHBLOCKS',
    'ALCHEMY_SOLANA_ACCOUNT_ARCHIVE_EXTENSION',
    'ALCHEMY_YELLOWSTONE_GRPC',
    'QUICKNODE_STREAMS',
    'QUICKNODE_WEBHOOKS',
    'QUICKNODE_FUNCTIONS',
    'QUICKNODE_ADD_ONS',
    'QUICKNODE_YELLOWSTONE_GRPC',
    'VENDOR_TRACE_DEBUG_OR_ENHANCED_NAMESPACES',
    'TRANSACTION_BROADCAST_OR_AUTOMATIC_RESUBMISSION',
  ],
  forbiddenMethodPrefixes: ['alchemy_', 'arbtrace_', 'debug_', 'metis_', 'qn_', 'trace_'],
  transportAuthority: {
    webSocketRole: 'HINT_AND_LOW_LATENCY_ONLY',
    httpsRole: 'AUTHORITATIVE_BOUNDED_REPLAY_POLL_AND_FINALITY_RECONCILIATION',
    webSocketOnlyFinancialAdvance: false,
    gapPolicy: 'STOP_ADVANCE_AND_COMPLETE_IDEMPOTENT_HTTPS_BACKFILL_BEFORE_RESUME',
  },
  automaticTransactionResubmission: 'PROHIBITED',
  failClosedOnUnsupportedCapability: true,
};

const EXPECTED_METHOD_PROFILES = [
  {
    id: 'EVM_STANDARD_READ_V1',
    protocol: 'ETHEREUM_JSON_RPC',
    requiredTransports: ['HTTPS_JSON_RPC', 'WSS_JSON_RPC'],
    httpMethods: [
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
    ],
    webSocketSubscriptions: ['logs', 'newHeads'],
    writeMethods: [],
    failClosedIfMissing: true,
  },
  {
    id: 'SOLANA_STANDARD_READ_V1',
    protocol: 'SOLANA_JSON_RPC',
    requiredTransports: ['HTTPS_JSON_RPC', 'WSS_JSON_RPC'],
    httpMethods: [
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
    ],
    webSocketSubscriptions: [
      'accountSubscribe',
      'logsSubscribe',
      'programSubscribe',
      'rootSubscribe',
      'signatureSubscribe',
      'slotSubscribe',
    ],
    writeMethods: [],
    failClosedIfMissing: true,
  },
];

const COMMON_OUTAGE = {
  webSocketGap: 'STOP_ADVANCE_MARK_STALE_RECONNECT_WITH_BOUNDED_BACKOFF_THEN_HTTP_BACKFILL',
  rpcFailure: 'RETRY_IDEMPOTENT_READS_WITH_BOUNDED_EXPONENTIAL_BACKOFF_AND_JITTER',
  statusPage: 'INFORMATIONAL_NOT_AN_ORACLE',
  automaticProductionFailover: 'NOT_APPROVED',
};

function chainPolicy(chain, freshness, finality, reorg, identityCheck) {
  return {
    chain,
    freshness: {
      currentAtOrBelowSeconds: freshness[0],
      staleAboveSeconds: freshness[1],
      staleThroughSeconds: freshness[2],
      unavailableAboveSeconds: freshness[3],
      finalityStallSeconds: freshness[4],
    },
    finality: {
      provisionalSignal: finality[0],
      canonicalSignal: finality[1],
      financialSignal: finality[2],
      testnetIsSlaEvidence: false,
    },
    reorg: {
      lineage: reorg[0],
      provisionalLogs: reorg[1],
      recovery: reorg[2],
      unknownAncestor: 'FAIL_CLOSED',
    },
    outage: { ...COMMON_OUTAGE },
    fallback: {
      provider: 'QUICKNODE',
      identityCheck,
      parity: 'PENDING_KAN_251_LIVE_VALIDATION',
      activation: 'PENDING_KAN_251_AND_KAN_231',
    },
  };
}

const EVM_REORG = [
  'PERSIST_BLOCK_HASH_PARENT_HASH_AND_HEIGHT',
  'REMOVED_TRUE_OR_HASH_DIVERGENCE_TRIGGERS_ROLLBACK',
  'ROLL_BACK_TO_COMMON_ANCESTOR_THEN_IDEMPOTENT_HTTP_REPLAY',
];
const L2_REORG = [
  'PERSIST_L2_BLOCK_HASH_PARENT_HASH_HEIGHT_AND_L1_ORIGIN_WHEN_STANDARD_RESPONSE_EXPOSES_IT',
  'REMOVED_TRUE_OR_HASH_DIVERGENCE_TRIGGERS_ROLLBACK',
  'ROLL_BACK_TO_COMMON_ANCESTOR_THEN_IDEMPOTENT_HTTP_REPLAY',
];

const EXPECTED_CHAIN_POLICIES = [
  chainPolicy(
    'ETHEREUM',
    [60, 60, 900, 900, 1800],
    [
      'LATEST_HEAD',
      'SAFE_TAG_PENDING_PROVIDER_LIVE_PROOF',
      'FINALIZED_TAG_PENDING_EXTERNAL_APPROVAL_AND_INDEPENDENT_AGREEMENT',
    ],
    EVM_REORG,
    'EXACT_ETH_CHAIN_ID_BEFORE_ACCEPTING_DATA',
  ),
  chainPolicy(
    'BASE',
    [30, 30, 300, 300, 2700],
    [
      'SEQUENCER_HEAD',
      'SAFE_TAG_PENDING_PROVIDER_LIVE_PROOF',
      'FINALIZED_TAG_AND_L1_SETTLEMENT_PENDING_EXTERNAL_APPROVAL_AND_INDEPENDENT_AGREEMENT',
    ],
    L2_REORG,
    'EXACT_ETH_CHAIN_ID_BEFORE_ACCEPTING_DATA',
  ),
  chainPolicy(
    'ARBITRUM',
    [30, 30, 300, 300, 2700],
    ['SEQUENCER_HEAD', 'BLOCKED_PENDING_LIVE_PROOF', 'BLOCKED_PENDING_LIVE_PROOF'],
    L2_REORG,
    'EXACT_ETH_CHAIN_ID_BEFORE_ACCEPTING_DATA',
  ),
  chainPolicy(
    'SOLANA',
    [15, 15, 120, 120, 90],
    [
      'PROCESSED_COMMITMENT_DISPLAY_ONLY',
      'CONFIRMED_COMMITMENT_PENDING_PROVIDER_LIVE_PROOF',
      'FINALIZED_COMMITMENT_PENDING_EXTERNAL_APPROVAL_AND_INDEPENDENT_AGREEMENT',
    ],
    [
      'PERSIST_SLOT_PARENT_AND_COMMITMENT_WITH_ROOT_CHECKPOINT',
      'NON_ROOTED_FORK_OR_SIGNATURE_STATUS_DIVERGENCE_TRIGGERS_ROLLBACK',
      'DROP_ORPHANED_PROVISIONAL_SLOTS_THEN_IDEMPOTENT_HTTP_REPLAY_FROM_ROOT',
    ],
    'EXACT_GET_GENESIS_HASH_BEFORE_ACCEPTING_DATA',
  ),
];

function network(
  networkId,
  chain,
  environment,
  providerNetworkName,
  expectedIdentity,
  fallbackArchive,
  historyParity,
) {
  const solana = chain === 'SOLANA';
  return {
    networkId,
    chain,
    environment,
    providerNetworkName,
    methodProfileId: solana ? 'SOLANA_STANDARD_READ_V1' : 'EVM_STANDARD_READ_V1',
    requiredTransports: ['HTTPS_JSON_RPC', 'WSS_JSON_RPC'],
    identityMethod: solana ? 'getGenesisHash' : 'eth_chainId',
    expectedIdentity,
    caipReferenceDerivation: solana
      ? 'FIRST_32_BASE58_CHARACTERS'
      : 'HEX_CHAIN_ID_TO_DECIMAL_CAIP_REFERENCE',
    primarySupport: 'DOCUMENTED_PENDING_LIVE_VALIDATION',
    fallbackSupport: 'DOCUMENTED_PENDING_LIVE_VALIDATION',
    primaryArchive: 'GENERAL_FULL_ARCHIVE_PLAN_CLAIM_PENDING_LIVE_VALIDATION',
    fallbackArchive,
    historyParity,
    status: 'PROPOSED',
  };
}

const FULL_FALLBACK_ARCHIVE = 'DOCUMENTED_YES_NO_PRUNING_PENDING_LIVE_VALIDATION';
const MAINNET_HISTORY = 'REQUIRED_PENDING_KAN_251';
const TESTNET_HISTORY = 'BEST_EFFORT_TESTNET_PENDING_KAN_251';

const EXPECTED_NETWORKS = [
  network(
    'eip155:1',
    'ETHEREUM',
    'MAINNET',
    'Ethereum Mainnet',
    '0x1',
    FULL_FALLBACK_ARCHIVE,
    MAINNET_HISTORY,
  ),
  network(
    'eip155:8453',
    'BASE',
    'MAINNET',
    'Base Mainnet',
    '0x2105',
    FULL_FALLBACK_ARCHIVE,
    MAINNET_HISTORY,
  ),
  network(
    'eip155:42161',
    'ARBITRUM',
    'MAINNET',
    'Arbitrum Mainnet',
    '0xa4b1',
    FULL_FALLBACK_ARCHIVE,
    MAINNET_HISTORY,
  ),
  network(
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    'SOLANA',
    'MAINNET',
    'Solana Mainnet-beta',
    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    FULL_FALLBACK_ARCHIVE,
    MAINNET_HISTORY,
  ),
  network(
    'eip155:11155111',
    'ETHEREUM',
    'TESTNET',
    'Ethereum Sepolia',
    '0xaa36a7',
    FULL_FALLBACK_ARCHIVE,
    TESTNET_HISTORY,
  ),
  network(
    'eip155:84532',
    'BASE',
    'TESTNET',
    'Base Sepolia',
    '0x14a34',
    FULL_FALLBACK_ARCHIVE,
    TESTNET_HISTORY,
  ),
  network(
    'eip155:421614',
    'ARBITRUM',
    'TESTNET',
    'Arbitrum Sepolia',
    '0x66eee',
    FULL_FALLBACK_ARCHIVE,
    TESTNET_HISTORY,
  ),
  network(
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    'SOLANA',
    'TESTNET',
    'Solana Devnet',
    'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    'DOCUMENTED_PRUNED_6578505_SLOTS_PENDING_LIVE_VALIDATION',
    'NOT_DOCUMENTED_REQUIRES_BOUNDED_BACKFILL_TEST',
  ),
];

const EXPECTED_PROVIDER_RESEARCH_HASHES = new Map([
  ['ALCHEMY', 'd4184a629f52fc7f3305f2ef90730143cbe4c30f454df9d579f7fea397579dd2'],
  ['QUICKNODE', '735b74368638da19c51be4a2e749b77841e2662ceaec814acec4430ab87b2b38'],
]);

const EXPECTED_AMBIGUITIES = [
  'ALCHEMY_PRICING_DOC_CONFLICTS_BETWEEN_500_AND_1000_FREE_CUPS',
  'ALCHEMY_THROUGHPUT_DOC_SAYS_ACCOUNT_LEVEL_WHILE_PRICING_DOC_SAYS_PER_APPLICATION',
  'ALCHEMY_METHOD_MIX_WEBSOCKET_BYTES_ARCHIVE_DEPTH_AND_RETRY_VOLUME_NOT_MEASURED',
  'QUICKNODE_FREE_IS_A_ONE_MONTH_TRIAL_NOT_A_PERMANENT_PRODUCTION_TIER',
  'QUICKNODE_ADVERTISED_BUILD_DISCOUNT_AND_MONTHLY_CHECKOUT_TOTAL_REQUIRE_ACCOUNT_CONFIRMATION',
  'QUICKNODE_METHOD_CREDIT_MULTIPLIERS_WEBSOCKET_VOLUME_ARCHIVE_DEPTH_AND_OVERAGE_CONTROLS_NOT_MEASURED',
  'BOTH_PROVIDERS_REQUIRE_CONTRACT_REVIEW_FOR_UPTIME_SERVICE_CREDITS_AND_EXCLUSIONS',
  'TAX_DATA_EGRESS_SUPPORT_ADD_ON_AND_CURRENCY_TERMS_ARE_NOT_APPROVED',
];

const EXPECTED_UNVERIFIED = [
  'EXACT_PRIMARY_AND_FALLBACK_ENDPOINT_HOSTNAMES',
  'ACCOUNT_OR_PROJECT_BOUND_RATE_LIMITS_FOR_THE_REQUIRED_METHOD_MIX',
  'WSS_CONNECTION_SUBSCRIPTION_MESSAGE_AND_BYTE_LIMITS_FOR_EACH_NETWORK',
  'ARCHIVE_START_HEIGHT_OR_SLOT_AND_HISTORICAL_METHOD_PARITY_FOR_EACH_NETWORK',
  'ETHEREUM_BASE_AND_ARBITRUM_SAFE_FINALIZED_TAG_SEMANTICS_ACROSS_BOTH_PROVIDERS',
  'BASE_AND_ARBITRUM_L1_ORIGIN_SETTLEMENT_AND_SEQUENCER_OUTAGE_BEHAVIOR',
  'SOLANA_COMMITMENT_ROOT_REORG_AND_SKIPPED_SLOT_PARITY_ACROSS_BOTH_PROVIDERS',
  'CROSS_PROVIDER_HEAD_SKEW_DUPLICATE_LOG_ORDERING_AND_FAILBACK_BEHAVIOR',
  'EXACT_DATA_RESIDENCY_SUBPROCESSORS_RPC_PAYLOAD_CLASSIFICATION_AND_DELETION',
  'SIGNED_SLA_SERVICE_CREDITS_EXCLUSIONS_SUPPORT_AND_INCIDENT_ESCALATION',
  'MONTHLY_REQUEST_WEBSOCKET_RETRY_ARCHIVE_EGRESS_TAX_AND_SUPPORT_COST',
  'INDEPENDENCE_OF_CLOUD_NETWORK_DNS_AND_UPSTREAM_NODE_FAILURE_DOMAINS',
];

const EXPECTED_ZERO_COST = {
  method: 'OFFICIAL_DOCUMENTATION_ONLY_LOCAL_FILE_AUTHORING',
  providerAccountsCreated: 0,
  trialsStarted: 0,
  paymentMethodsAdded: 0,
  providerEndpointsCreated: 0,
  apiKeysIssued: 0,
  rpcRequestsSent: 0,
  webSocketConnectionsOpened: 0,
  cloudResourcesCreated: 0,
  paidServicesActivated: 0,
  costIncurredUsd: '0.00',
  liveEvidenceStatus: 'NOT_RUN_PENDING_AUTHORIZATION',
};

const EXPECTED_SOURCES = [
  [
    'ALCHEMY_CHAIN_SUPPORT',
    'ALCHEMY',
    'NETWORKS_AND_HTTPS',
    'https://www.alchemy.com/docs/reference/node-supported-chains',
    'ae51bc9c74341cb04ade4597c571e7851bf64e660d56d29e62fe2fc96ed667e6',
  ],
  [
    'ALCHEMY_FEATURE_SUPPORT',
    'ALCHEMY',
    'CHAIN_FEATURES',
    'https://www.alchemy.com/docs/reference/feature-support-by-chain',
    '5cf749dde419d9a82b42c784b329f9b70fb6f1223cbf7f9bc65b3191663f659a',
  ],
  [
    'ALCHEMY_ETHEREUM_RPC',
    'ALCHEMY',
    'ETHEREUM_TRANSPORT_AND_ARCHIVE',
    'https://www.alchemy.com/rpc/ethereum',
    '602a60ac9ec842937ce7847012d1b5b9e1f66a21483417b33f6999b5ec9600ad',
  ],
  [
    'ALCHEMY_BASE_RPC',
    'ALCHEMY',
    'BASE_TRANSPORT_AND_ARCHIVE',
    'https://www.alchemy.com/rpc/base',
    '817545188b910f4d08a93b9a6c06ac697967590a7b2360790c486bd33cc16c12',
  ],
  [
    'ALCHEMY_ARBITRUM_RPC',
    'ALCHEMY',
    'ARBITRUM_TRANSPORT_AND_ARCHIVE',
    'https://www.alchemy.com/rpc/arbitrum',
    'db019b9315dc075e47bee2fe5c44d09292a94320387c17dd0b9550bcdf4fc99d',
  ],
  [
    'ALCHEMY_SOLANA_RPC',
    'ALCHEMY',
    'SOLANA_TRANSPORT_AND_ARCHIVE',
    'https://www.alchemy.com/rpc/solana',
    '5b544ba133d6bc64a638e08a8adbca8c9c71be71e8b73796e166d922d1c25ca0',
  ],
  [
    'ALCHEMY_SUBSCRIPTIONS',
    'ALCHEMY',
    'WEBSOCKET_SUBSCRIPTIONS',
    'https://www.alchemy.com/docs/reference/subscription-api',
    'f335a6b6a2ad3a45dd82a88ed015aadd6a1155d71f3369d4538c3319f86f60b5',
  ],
  [
    'ALCHEMY_SOLANA_SUBSCRIPTIONS',
    'ALCHEMY',
    'SOLANA_WEBSOCKET_SUBSCRIPTIONS',
    'https://www.alchemy.com/docs/reference/solana-subscription-api-endpoints',
    '3313ae843048d06278b40785586aafe5aed70fafacd8225c0e6a049f7db6804e',
  ],
  [
    'ALCHEMY_PRICING',
    'ALCHEMY',
    'PRICING_AND_PLANS',
    'https://www.alchemy.com/pricing',
    '0e85ea3d7fa016d9351b846464b628af5d25d1607f251ea4e3eb02b75920a20a',
  ],
  [
    'ALCHEMY_PRICING_DOCS',
    'ALCHEMY',
    'PRICING_FEATURES_AND_AMBIGUITY',
    'https://www.alchemy.com/docs/reference/pricing-plans',
    'ce109c949e9cd21d640b92a7d2b9dcb7627bb1e438e2baf607409172f2db73cf',
  ],
  [
    'ALCHEMY_COMPUTE_COSTS',
    'ALCHEMY',
    'METHOD_AND_WEBSOCKET_METERING',
    'https://www.alchemy.com/docs/reference/compute-unit-costs',
    '9b8822271c79b272e1a06724db3ef1d389ae94b7a35dcc29c957cc35a201a0dc',
  ],
  [
    'ALCHEMY_THROUGHPUT',
    'ALCHEMY',
    'RATE_LIMITS',
    'https://www.alchemy.com/docs/reference/throughput',
    '9a6fb44726ead6e1633800960168dc96c450cfeef0f580f454e76fff2ff47b7e',
  ],
  [
    'ALCHEMY_SLA',
    'ALCHEMY',
    'SERVICE_LEVEL_TERMS',
    'https://legal.alchemy.com/',
    '39da0b9fd2ef9ff83d19966e7d90bb8764c6e27efcb22bb6e29b17ae829b85b5',
  ],
  [
    'ALCHEMY_ROUTING',
    'ALCHEMY',
    'GEOGRAPHY_AND_FAILOVER',
    'https://www.alchemy.com/blog/cortex-router-fastest-healthy-node',
    '8ac34db0659ba54e381fb3b9bb6cca132b85c97934ec9c4be96fc14313a2ad7e',
  ],
  [
    'ALCHEMY_STATUS',
    'ALCHEMY',
    'OUTAGES',
    'https://status.alchemy.com/',
    '9a4295b89d9fa8e1b8b86a5dfd6c122ef21aa07cea0f05ad4a85ddcdf39314da',
  ],
  [
    'ALCHEMY_REQUEST_LOGS',
    'ALCHEMY',
    'LOG_CONTENT_AND_RETENTION',
    'https://www.alchemy.com/docs/alchemy-request-logs',
    '6251e695bcf8895840d2a4030e80f510126cf7410f06293012ba13c31c095d51',
  ],
  [
    'ALCHEMY_SECURITY',
    'ALCHEMY',
    'SECURITY',
    'https://www.alchemy.com/security',
    'c1c46076300e08ffa0b2061a1e43c032c11d2c5d818f8eee708cd0083597d4be',
  ],
  [
    'ALCHEMY_DATA_APIS',
    'ALCHEMY',
    'MANAGED_INDEXING_EXCLUSION',
    'https://www.alchemy.com/docs/data',
    '0177b5011ee6510858ec8d3aabc5a41577a9b36a20460af58a347ffcddfc7ad4',
  ],
  [
    'QUICKNODE_ETHEREUM_RPC',
    'QUICKNODE',
    'ETHEREUM_NETWORK_TRANSPORT_AND_ARCHIVE',
    'https://www.quicknode.com/docs/ethereum',
    '3a08b030d9a1d51af76f7753197827a24d85b2a520949b64984abd266f3bbe57',
  ],
  [
    'QUICKNODE_BASE_RPC',
    'QUICKNODE',
    'BASE_NETWORK_TRANSPORT_AND_ARCHIVE',
    'https://www.quicknode.com/docs/base',
    '14641e625917b38b328427d421f0f525d2851f440987e108e792c9fca0ea70dd',
  ],
  [
    'QUICKNODE_ARBITRUM_RPC',
    'QUICKNODE',
    'ARBITRUM_NETWORK_TRANSPORT_AND_ARCHIVE',
    'https://www.quicknode.com/docs/arbitrum',
    'ad741852f566ec78f0a4c188bc3930049d54ff9495aa27e8cbf3d21ce827585d',
  ],
  [
    'QUICKNODE_SOLANA_RPC',
    'QUICKNODE',
    'SOLANA_NETWORK_TRANSPORT_AND_ARCHIVE',
    'https://www.quicknode.com/docs/solana',
    'eb26b8e2d8715efd69e5e5f807ba1b04247cd788d4318f0ef938a601bd963937',
  ],
  [
    'QUICKNODE_ARCHIVE_MATRIX',
    'QUICKNODE',
    'ARCHIVE_AND_PRUNING',
    'https://www.quicknode.com/docs/platform/supported-chains-node-types',
    'ea0464655506c18ce610adabc5ea7de1a18b2f22f4579aea52ac8a7da1e5da26',
  ],
  [
    'QUICKNODE_PRICING',
    'QUICKNODE',
    'PRICING_RATE_LIMITS_AND_SLA',
    'https://www.quicknode.com/pricing',
    '61f7519027fa6fb5334fc742542a5f5e02d4ad46944d63ccd4b5044468f2b3b9',
  ],
  [
    'QUICKNODE_API_CREDITS',
    'QUICKNODE',
    'METERING',
    'https://www.quicknode.com/api-credits',
    '315853e9ef358337939e4524a2a2475955e74d5211b56c59695278a8fdc191a5',
  ],
  [
    'QUICKNODE_GEOGRAPHY',
    'QUICKNODE',
    'GEOGRAPHY_AND_ROUTING',
    'https://support.quicknode.com/articles/5948433326-where-are-quicknode-servers-located',
    '4cf51fbb59b7666069f0a117771a38b70017e4744054a3cbbc35f7164927ef61',
  ],
  [
    'QUICKNODE_STATUS',
    'QUICKNODE',
    'OUTAGES',
    'https://status.quicknode.com/',
    '3a52c9fa21f78b6431dd093c84332e38fe5899fae6274cd86265155938c9153a',
  ],
  [
    'QUICKNODE_SECURITY',
    'QUICKNODE',
    'SECURITY',
    'https://www.quicknode.com/security',
    '3eec3ee631e990947574156ffa1b73d2162fbc91a7d2dd464cdcac89e3276db2',
  ],
  [
    'QUICKNODE_PRIVACY',
    'QUICKNODE',
    'PRIVACY_AND_RETENTION',
    'https://www.quicknode.com/privacy',
    'efd42f4b20d2769277126b92dfd64c78b81299f5888ed825aee34c5494f8c5ad',
  ],
  [
    'QUICKNODE_TERMS',
    'QUICKNODE',
    'COMMERCIAL_AND_WARRANTY_TERMS',
    'https://www.quicknode.com/terms',
    '6a5541aa974b7b8197ca83093e0de762bc8e4cc8ba98620d0b2fb5d151b08401',
  ],
  [
    'PROTOCOL_ETHEREUM_JSON_RPC_FINALITY',
    'PROTOCOL',
    'ETHEREUM_METHODS_AND_FINALITY_TAGS',
    'https://ethereum.org/developers/docs/apis/json-rpc/',
    '5720b46cdb726a5d1259eff0b3efe36a5ca1ff453446016e8261934e5fc8c816',
  ],
  [
    'PROTOCOL_BASE_FINALITY',
    'PROTOCOL',
    'BASE_FINALITY_AND_L1_SETTLEMENT',
    'https://docs.base.org/base-chain/network-information/transaction-finality',
    '441268ad5b41fd5686dad79a4de298cba3ee4601420e497e0dafc2b44bae4830',
  ],
  [
    'PROTOCOL_ARBITRUM_FINALITY_REORGS',
    'PROTOCOL',
    'ARBITRUM_FINALITY_REORG_AND_INDEXER_POLICY',
    'https://docs.arbitrum.io/how-arbitrum-works/reference/finality-and-reorgs',
    '88a6e6808e3e4591f2ba4b425538e885824a12240475b7b034e2c52f9b84a3f5',
  ],
  [
    'PROTOCOL_SOLANA_RPC_COMMITMENT',
    'PROTOCOL',
    'SOLANA_METHODS_AND_COMMITMENT',
    'https://solana.com/docs/rpc',
    '88a3bf59a0ad5ae5339a547fa1a3c61623851b2703c4dcb61e15b9135aa6f29d',
  ],
  [
    'PROTOCOL_SOLANA_KNOWN_GENESIS_HASHES',
    'PROTOCOL',
    'SOLANA_FULL_CLUSTER_IDENTITY',
    'https://github.com/solana-labs/solana/blob/master/sdk/src/genesis_config.rs',
    '6002cbcbeebdcab54b26ba75c9c3530ba0c6ea599672e44f34c77865bcbdcba6',
  ],
  [
    'STANDARD_SOLANA_CAIP2_DERIVATION',
    'STANDARD',
    'SOLANA_CAIP_REFERENCE_DERIVATION',
    'https://namespaces.chainagnostic.org/solana/caip2',
    '858bda3aff7a69f75ab30552c21be682eafe0ad334ff4a7e305670db5e319703',
  ],
];

const OFFICIAL_HOSTS = new Map([
  ['ALCHEMY', new Set(['www.alchemy.com', 'legal.alchemy.com', 'status.alchemy.com'])],
  ['QUICKNODE', new Set(['www.quicknode.com', 'support.quicknode.com', 'status.quicknode.com'])],
  [
    'PROTOCOL',
    new Set(['ethereum.org', 'docs.base.org', 'docs.arbitrum.io', 'solana.com', 'github.com']),
  ],
  ['STANDARD', new Set(['namespaces.chainagnostic.org'])],
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expectedKeys, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    errors.push(`${path} must contain exactly: ${expected.join(', ')}.`);
    return false;
  }
  return true;
}

function expectExact(actual, expected, path, errors) {
  if (!isDeepStrictEqual(actual, expected))
    errors.push(`${path} must equal the closed KAN-62 value.`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function comparablePath(value) {
  let path = normalize(resolve(value));
  if (path.startsWith('\\\\?\\UNC\\')) path = `\\\\${path.slice(8)}`;
  else if (path.startsWith('\\\\?\\')) path = path.slice(4);
  path = path.replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function sameStableFile(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.nlink === 1n &&
    right.nlink === 1n &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function controlledRepositoryPath(repositoryRoot, relativePath) {
  if (
    typeof repositoryRoot !== 'string' ||
    repositoryRoot.length === 0 ||
    repositoryRoot.length > 4_096 ||
    repositoryRoot.includes('\u0000')
  ) {
    throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
  }
  const root = resolve(repositoryRoot);
  const rootStatus = lstatSync(root, { bigint: true });
  if (
    rootStatus.isSymbolicLink() ||
    !rootStatus.isDirectory() ||
    comparablePath(realpathSync.native(root)) !== comparablePath(root)
  ) {
    throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
  }
  const absolutePath = resolve(root, relativePath);
  const childPath = relative(root, absolutePath);
  if (
    childPath === '' ||
    childPath === '..' ||
    childPath.startsWith(`..${sep}`) ||
    isAbsolute(childPath)
  ) {
    throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
  }
  let current = root;
  const components = childPath.split(/[\\/]+/u);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component.length === 0) throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
    current = join(current, component);
    const status = lstatSync(current, { bigint: true });
    const final = index === components.length - 1;
    if (status.isSymbolicLink() || (!final && !status.isDirectory())) {
      throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
    }
    if (comparablePath(realpathSync.native(current)) !== comparablePath(current)) {
      throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
    }
  }
  return absolutePath;
}

function readDescriptorExactly(descriptor, size) {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, offset);
    if (count <= 0) throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
    offset += count;
  }
  const overflow = Buffer.allocUnsafe(1);
  if (readSync(descriptor, overflow, 0, 1, size) !== 0) {
    throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
  }
  return bytes;
}

function readBoundedStableRepositoryFile(
  repositoryRoot,
  relativePath,
  maximumBytes,
  afterFirstReadForTest,
) {
  let descriptor;
  try {
    const absolutePath = controlledRepositoryPath(repositoryRoot, relativePath);
    const before = lstatSync(absolutePath, { bigint: true });
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size <= 0n ||
      before.size > BigInt(maximumBytes)
    ) {
      throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
    }
    const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
    descriptor = openSync(absolutePath, fsConstants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(before, opened)) {
      throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
    }
    const size = Number(opened.size);
    const first = readDescriptorExactly(descriptor, size);
    afterFirstReadForTest?.();
    const afterFirst = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(opened, afterFirst)) {
      throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
    }
    const second = readDescriptorExactly(descriptor, size);
    const afterSecond = fstatSync(descriptor, { bigint: true });
    const finalPath = controlledRepositoryPath(repositoryRoot, relativePath);
    const final = lstatSync(finalPath, { bigint: true });
    if (
      comparablePath(finalPath) !== comparablePath(absolutePath) ||
      !sameStableFile(opened, afterSecond) ||
      !sameStableFile(afterSecond, final) ||
      !first.equals(second)
    ) {
      throw new Error(PROVIDER_DECISION_FILES_UNSAFE_ERROR);
    }
    return first;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateJsonWithoutDuplicateKeys(text) {
  let index = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;

  function invalid() {
    throw new Error(PROVIDER_DECISION_JSON_INVALID_ERROR);
  }

  function whitespace() {
    while (
      text[index] === ' ' ||
      text[index] === '\t' ||
      text[index] === '\r' ||
      text[index] === '\n'
    ) {
      index += 1;
    }
  }

  function string() {
    if (text[index] !== '"') invalid();
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text.charCodeAt(index);
      if (character === 0x22) {
        index += 1;
        return JSON.parse(text.slice(start, index));
      }
      if (character < 0x20) invalid();
      if (character !== 0x5c) {
        index += 1;
        continue;
      }
      index += 1;
      const escaped = text[index];
      if (escaped === 'u') {
        if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(index + 1, index + 5))) invalid();
        index += 5;
        continue;
      }
      if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escaped)) invalid();
      index += 1;
    }
    invalid();
  }

  function number() {
    numberPattern.lastIndex = index;
    const match = numberPattern.exec(text);
    if (match === null) invalid();
    index = numberPattern.lastIndex;
  }

  function value(depth) {
    if (depth > 128) invalid();
    whitespace();
    if (text[index] === '"') {
      string();
      return;
    }
    if (text[index] === '{') {
      object(depth + 1);
      return;
    }
    if (text[index] === '[') {
      list(depth + 1);
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    number();
  }

  function object(depth) {
    index += 1;
    whitespace();
    if (text[index] === '}') {
      index += 1;
      return;
    }
    const keys = new Set();
    while (index < text.length) {
      const key = string();
      if (keys.has(key)) invalid();
      keys.add(key);
      whitespace();
      if (text[index] !== ':') invalid();
      index += 1;
      value(depth);
      whitespace();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      if (text[index] !== ',') invalid();
      index += 1;
      whitespace();
    }
    invalid();
  }

  function list(depth) {
    index += 1;
    whitespace();
    if (text[index] === ']') {
      index += 1;
      return;
    }
    while (index < text.length) {
      value(depth);
      whitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      if (text[index] !== ',') invalid();
      index += 1;
    }
    invalid();
  }

  whitespace();
  value(0);
  whitespace();
  if (index !== text.length) invalid();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateDateFreshness(record, now, errors) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    errors.push('validation time must be a valid Date.');
    return;
  }
  if (typeof record.asOfDate !== 'string' || !DATE_ONLY.test(record.asOfDate)) {
    errors.push('asOfDate must be a canonical YYYY-MM-DD date.');
    return;
  }
  const observedMs = Date.parse(`${record.asOfDate}T00:00:00.000Z`);
  if (
    Number.isNaN(observedMs) ||
    new Date(observedMs).toISOString().slice(0, 10) !== record.asOfDate
  ) {
    errors.push('asOfDate must be a real calendar date.');
    return;
  }
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = (todayUtc - observedMs) / DAY_MS;
  if (ageDays < 0) errors.push('asOfDate cannot be in the future.');
  if (ageDays > 30) errors.push('KAN-62 research and pricing evidence is stale after 30 days.');
}

function validateClosedObjectArray(value, expectedLength, keys, path, errors) {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    errors.push(`${path} must contain exactly ${expectedLength} closed row(s).`);
    return false;
  }
  value.forEach((entry, index) => exactKeys(entry, keys, `${path}[${index}]`, errors));
  return true;
}

function validateCore(record, now) {
  const errors = [];
  if (!exactKeys(record, TOP_KEYS, 'record', errors)) return errors;

  if (record.schemaVersion !== 1) errors.push('schemaVersion must equal 1.');
  if (record.ticket !== 'KAN-62') errors.push('ticket must equal KAN-62.');
  if (record.decisionReference !== 'jira:KAN-62/provider-decision-v1') {
    errors.push('decisionReference must bind provider-decision-v1.');
  }
  if (record.localStatus !== 'READY_FOR_INDEPENDENT_REVIEW') {
    errors.push('localStatus must remain READY_FOR_INDEPENDENT_REVIEW.');
  }
  if (record.externalStatus !== 'PENDING_EXTERNAL_APPROVAL') {
    errors.push('externalStatus must remain PENDING_EXTERNAL_APPROVAL.');
  }
  validateDateFreshness(record, now, errors);

  exactKeys(record.selection, SELECTION_KEYS, 'selection', errors);
  expectExact(record.selection, EXPECTED_SELECTION, 'selection', errors);

  exactKeys(record.approvalBoundary, APPROVAL_KEYS, 'approvalBoundary', errors);
  expectExact(record.approvalBoundary, EXPECTED_APPROVAL_BOUNDARY, 'approvalBoundary', errors);

  if (validateClosedObjectArray(record.gates, 2, GATE_KEYS, 'gates', errors)) {
    expectExact(record.gates, EXPECTED_GATES, 'gates', errors);
  }

  if (exactKeys(record.capabilityBoundary, CAPABILITY_KEYS, 'capabilityBoundary', errors)) {
    exactKeys(
      record.capabilityBoundary.transportAuthority,
      TRANSPORT_AUTHORITY_KEYS,
      'capabilityBoundary.transportAuthority',
      errors,
    );
  }
  expectExact(
    record.capabilityBoundary,
    EXPECTED_CAPABILITY_BOUNDARY,
    'capabilityBoundary',
    errors,
  );

  if (
    validateClosedObjectArray(
      record.methodProfiles,
      EXPECTED_METHOD_PROFILES.length,
      METHOD_KEYS,
      'methodProfiles',
      errors,
    )
  ) {
    expectExact(record.methodProfiles, EXPECTED_METHOD_PROFILES, 'methodProfiles', errors);
  }

  if (
    validateClosedObjectArray(
      record.chainPolicies,
      EXPECTED_CHAIN_POLICIES.length,
      CHAIN_KEYS,
      'chainPolicies',
      errors,
    )
  ) {
    for (const [index, policy] of record.chainPolicies.entries()) {
      exactKeys(policy.freshness, FRESHNESS_KEYS, `chainPolicies[${index}].freshness`, errors);
      exactKeys(policy.finality, FINALITY_KEYS, `chainPolicies[${index}].finality`, errors);
      exactKeys(policy.reorg, REORG_KEYS, `chainPolicies[${index}].reorg`, errors);
      exactKeys(policy.outage, OUTAGE_KEYS, `chainPolicies[${index}].outage`, errors);
      exactKeys(policy.fallback, FALLBACK_KEYS, `chainPolicies[${index}].fallback`, errors);
    }
    expectExact(record.chainPolicies, EXPECTED_CHAIN_POLICIES, 'chainPolicies', errors);
  }

  if (
    validateClosedObjectArray(
      record.networks,
      EXPECTED_NETWORKS.length,
      NETWORK_KEYS,
      'networks',
      errors,
    )
  ) {
    expectExact(record.networks, EXPECTED_NETWORKS, 'networks', errors);
  }

  if (
    validateClosedObjectArray(
      record.providerResearch,
      EXPECTED_PROVIDER_RESEARCH_HASHES.size,
      PROVIDER_RESEARCH_KEYS,
      'providerResearch',
      errors,
    )
  ) {
    const providers = record.providerResearch.map(({ provider }) => provider);
    expectExact(providers, ['ALCHEMY', 'QUICKNODE'], 'providerResearch providers', errors);
    for (const [index, research] of record.providerResearch.entries()) {
      const expectedHash = EXPECTED_PROVIDER_RESEARCH_HASHES.get(research.provider);
      if (expectedHash === undefined || sha256(canonicalJson(research)) !== expectedHash) {
        errors.push(`providerResearch[${index}] must retain the closed documented claim set.`);
      }
      if (
        research.selectionStatus !== 'PROPOSED' ||
        research.approvedPlan !== null ||
        research.approvedSla !== null ||
        research.approvedRegion !== null ||
        research.approvedCostUsd !== null
      ) {
        errors.push(`providerResearch[${index}] cannot claim plan, SLA, Region, or cost approval.`);
      }
    }
  }

  if (exactKeys(record.commercialResearch, COMMERCIAL_KEYS, 'commercialResearch', errors)) {
    const commercial = record.commercialResearch;
    if (commercial.observedOn !== record.asOfDate) {
      errors.push('commercialResearch.observedOn must equal asOfDate.');
    }
    if (
      commercial.evidenceMaxAgeDays !== 30 ||
      commercial.recheckRequiredBeforeApproval !== true ||
      commercial.currency !== 'USD' ||
      commercial.taxesEgressBandwidthAddOnsAndSupportFeesIncluded !== false ||
      commercial.forecastApproved !== false ||
      commercial.pricingApproved !== false
    ) {
      errors.push('commercialResearch must remain current, incomplete, and unapproved.');
    }
    expectExact(
      commercial.ambiguities,
      EXPECTED_AMBIGUITIES,
      'commercialResearch.ambiguities',
      errors,
    );
  }

  if (
    validateClosedObjectArray(
      record.sourceEvidence,
      EXPECTED_SOURCES.length,
      SOURCE_KEYS,
      'sourceEvidence',
      errors,
    )
  ) {
    for (const [index, source] of record.sourceEvidence.entries()) {
      const [id, provider, topic, url, factHash] = EXPECTED_SOURCES[index];
      expectExact(
        [source.id, source.provider, source.topic, source.url, sha256(source.observedFact)],
        [id, provider, topic, url, factHash],
        `sourceEvidence[${index}]`,
        errors,
      );
      try {
        const parsed = new URL(source.url);
        const allowedHosts = OFFICIAL_HOSTS.get(source.provider);
        if (
          parsed.protocol !== 'https:' ||
          parsed.username !== '' ||
          parsed.password !== '' ||
          parsed.hash !== '' ||
          !allowedHosts?.has(parsed.hostname)
        ) {
          errors.push(`sourceEvidence[${index}].url must use an allowlisted official HTTPS host.`);
        }
      } catch {
        errors.push(`sourceEvidence[${index}].url must be a valid official HTTPS URL.`);
      }
    }
  }

  expectExact(
    record.undocumentedOrUnverified,
    EXPECTED_UNVERIFIED,
    'undocumentedOrUnverified',
    errors,
  );

  exactKeys(record.zeroCostEvidence, ZERO_COST_KEYS, 'zeroCostEvidence', errors);
  expectExact(record.zeroCostEvidence, EXPECTED_ZERO_COST, 'zeroCostEvidence', errors);
  return errors;
}

export function validateProviderDecisionRecord(record, { now = new Date() } = {}) {
  try {
    return validateCore(record, now);
  } catch {
    return ['record is malformed and could not be safely validated.'];
  }
}

export function validateProviderDecisionSidecar(decisionBytes, sidecar) {
  try {
    const expected = `${sha256(decisionBytes)}\n`;
    return sidecar === expected
      ? []
      : ['KAN-62 SHA-256 sidecar must exactly bind the decision JSON bytes.'];
  } catch {
    return ['KAN-62 SHA-256 sidecar input is malformed.'];
  }
}

function loadProviderDecisionSnapshot({
  repositoryRoot = REPOSITORY_ROOT,
  now = new Date(),
  afterDecisionFirstReadForTest = undefined,
  afterSidecarFirstReadForTest = undefined,
} = {}) {
  try {
    const decisionBytes = readBoundedStableRepositoryFile(
      repositoryRoot,
      DECISION_PATH,
      MAX_PROVIDER_DECISION_BYTES,
      afterDecisionFirstReadForTest,
    );
    const sidecarBytes = readBoundedStableRepositoryFile(
      repositoryRoot,
      SIDECAR_PATH,
      MAX_PROVIDER_DECISION_SIDECAR_BYTES,
      afterSidecarFirstReadForTest,
    );
    const sidecar = new TextDecoder('utf-8', { fatal: true }).decode(sidecarBytes);
    let record;
    try {
      if (decisionBytes[0] === 0xef && decisionBytes[1] === 0xbb && decisionBytes[2] === 0xbf) {
        throw new Error(PROVIDER_DECISION_JSON_INVALID_ERROR);
      }
      const decisionText = new TextDecoder('utf-8', { fatal: true }).decode(decisionBytes);
      validateJsonWithoutDuplicateKeys(decisionText);
      record = JSON.parse(decisionText);
    } catch {
      return Object.freeze({
        errors: Object.freeze([PROVIDER_DECISION_JSON_INVALID_ERROR]),
        fingerprint: null,
        record: null,
      });
    }
    const fingerprint = sha256(decisionBytes);
    const errors = Object.freeze([
      ...validateProviderDecisionRecord(record, { now }),
      ...validateProviderDecisionSidecar(decisionBytes, sidecar),
    ]);
    const result = Object.freeze({
      errors,
      fingerprint,
      record: errors.length === 0 ? deepFreeze(record) : null,
    });
    return result;
  } catch {
    return Object.freeze({
      errors: Object.freeze([PROVIDER_DECISION_FILES_UNSAFE_ERROR]),
      fingerprint: null,
      record: null,
    });
  }
}

export function loadValidatedProviderDecisionSnapshot({
  repositoryRoot = REPOSITORY_ROOT,
  now = new Date(),
} = {}) {
  return loadProviderDecisionSnapshot({ repositoryRoot, now });
}

/** Test-only fault seam; production preflight uses loadValidatedProviderDecisionSnapshot. */
export function loadValidatedProviderDecisionSnapshotForTest({
  repositoryRoot = REPOSITORY_ROOT,
  now = new Date(),
  afterDecisionFirstReadForTest = undefined,
  afterSidecarFirstReadForTest = undefined,
} = {}) {
  return loadProviderDecisionSnapshot({
    repositoryRoot,
    now,
    afterDecisionFirstReadForTest,
    afterSidecarFirstReadForTest,
  });
}

export function validateProviderDecisionFiles(options = {}) {
  const { errors, fingerprint } = loadValidatedProviderDecisionSnapshot(options);
  return { errors, fingerprint };
}

function main() {
  const result = validateProviderDecisionFiles();
  if (result.errors.length > 0) {
    console.error('KAN-62 provider decision validation failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `KAN-62 provider decision is locally valid and pending external approval (sha256 ${result.fingerprint}).`,
  );
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
