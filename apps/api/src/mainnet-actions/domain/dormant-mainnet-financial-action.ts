import {
  isMainnetLaunchNetwork,
  type MainnetLaunchNetworkId,
} from '../../blockchain/domain/mainnet-launch-network-policy';
import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';
import {
  parseSolanaWalletAddress,
  parseWalletAddress,
  type WalletAddress,
} from '../../wallets/domain/wallet-identity';

export const DORMANT_MAINNET_FINANCIAL_ACTION_INTENT_SCHEMA_VERSION = 1 as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_POLICY_SCHEMA_VERSION = 1 as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_MAXIMUM_TTL_MILLISECONDS = 5 * 60 * 1_000;

export const MAINNET_FINANCIAL_ACTIONS = Object.freeze([
  'SUPPLY',
  'WITHDRAW',
  'BORROW',
  'REPAY',
] as const);

export type MainnetFinancialAction = (typeof MAINNET_FINANCIAL_ACTIONS)[number];
export type MainnetFinancialActionProviderId =
  | 'aave'
  | 'morpho'
  | 'compound'
  | 'spark'
  | 'euler'
  | 'gearbox'
  | 'kamino'
  | 'save'
  | 'project-0'
  | 'jupiter';
export type MainnetFinancialActionProtocolId =
  | 'aave-v3'
  | 'morpho-blue'
  | 'compound-iii'
  | 'sparklend'
  | 'euler-v2'
  | 'gearbox-v3'
  | 'kamino-lend'
  | 'save-lending'
  | 'marginfi-v2'
  | 'jupiter-lend';

export interface MainnetFinancialActionProviderCandidate {
  readonly providerId: MainnetFinancialActionProviderId;
  readonly protocolId: MainnetFinancialActionProtocolId;
  readonly networkId: MainnetLaunchNetworkId;
}

/**
 * Identity candidates only. Inclusion here is not provider, market, or write approval.
 * The immutable zero policy below has no approvals and always denies every candidate.
 */
export const MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES: readonly MainnetFinancialActionProviderCandidate[] =
  Object.freeze([
    candidate('aave', 'aave-v3', 'eip155:1'),
    candidate('morpho', 'morpho-blue', 'eip155:1'),
    candidate('compound', 'compound-iii', 'eip155:1'),
    candidate('spark', 'sparklend', 'eip155:1'),
    candidate('euler', 'euler-v2', 'eip155:1'),
    candidate('gearbox', 'gearbox-v3', 'eip155:1'),
    candidate('kamino', 'kamino-lend', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
    candidate('save', 'save-lending', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
    candidate('project-0', 'marginfi-v2', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
    candidate('jupiter', 'jupiter-lend', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
  ]);

export type DormantMainnetFinancialActionValidationCode =
  | 'INVALID_INTENT_INPUT'
  | 'INVALID_SCHEMA_VERSION'
  | 'INVALID_INTENT_ID'
  | 'INVALID_ACCOUNT_ID'
  | 'INVALID_WALLET_REGISTRATION_ID'
  | 'INVALID_REPLAY_PROTECTION'
  | 'INVALID_NETWORK'
  | 'INVALID_WALLET'
  | 'INVALID_PROVIDER_BINDING'
  | 'INVALID_MARKET_BINDING'
  | 'INVALID_ASSET_REGISTRY_BINDING'
  | 'INVALID_ASSET_BINDING'
  | 'INVALID_ACTION'
  | 'INVALID_AMOUNT'
  | 'INVALID_VALUE_LIMIT_INPUT'
  | 'INVALID_NETWORK_FEE_LIMIT_INPUT'
  | 'INVALID_POST_ACTION_RESERVE'
  | 'INVALID_ALLOWANCE'
  | 'INVALID_INTENT_TIME'
  | 'INVALID_SERVER_TIME';

export class DormantMainnetFinancialActionValidationError extends Error {
  constructor(readonly code: DormantMainnetFinancialActionValidationCode) {
    super(code);
    this.name = 'DormantMainnetFinancialActionValidationError';
  }
}

export interface DormantMainnetFinancialActionIntentInputV1 {
  readonly schemaVersion: 1;
  readonly intentId: string;
  readonly accountId: string;
  readonly walletRegistrationId: string;
  readonly replayProtectionId: string;
  readonly idempotencyKeyDigestSha256: string;
  readonly networkId: string;
  readonly walletAddress: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly assetSymbol: string;
  readonly assetIdentity: string;
  readonly action: string;
  readonly amountAtomic: string;
  readonly requestedValueUsdMicros: string;
  readonly maximumNetworkFeeAtomic: string;
  readonly maximumNetworkFeeBasisPoints: number;
  readonly minimumPostActionNativeBalanceAtomic: string;
  readonly allowanceMode: string;
  readonly allowanceAmountAtomic: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface DormantMainnetFinancialActionIntentV1 {
  readonly schemaVersion: 1;
  readonly use: 'DORMANT_MAINNET_FINANCIAL_ACTION_INTENT_VALIDATION_ONLY';
  readonly mayAuthorizeFinancialAction: false;
  readonly intentId: string;
  readonly accountId: string;
  readonly walletRegistrationId: string;
  readonly replayProtectionId: string;
  readonly idempotencyKeyDigestSha256: string;
  readonly networkId: MainnetLaunchNetworkId;
  readonly walletAddress: WalletAddress;
  readonly providerId: MainnetFinancialActionProviderId;
  readonly protocolId: MainnetFinancialActionProtocolId;
  readonly marketId: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly assetSymbol: SupportedStablecoin;
  readonly assetIdentity: string;
  readonly assetDecimals: number;
  readonly action: MainnetFinancialAction;
  readonly amountAtomic: string;
  readonly requestedValueUsdMicros: string;
  readonly maximumNetworkFeeAtomic: string;
  readonly maximumNetworkFeeBasisPoints: number;
  readonly minimumPostActionNativeBalanceAtomic: string;
  readonly allowanceMode: 'EXACT';
  readonly allowanceAmountAtomic: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signingResponsibility: 'USER_WALLET_ONLY';
  readonly broadcastResponsibility: 'USER_WALLET_ONLY';
  readonly apiMaySign: false;
  readonly apiMayBroadcast: false;
  readonly crossChainExecutionAllowed: false;
  readonly automaticResendAllowed: false;
  readonly automaticFeeEscalationAllowed: false;
  readonly durableReplayProtectionVerified: false;
}

export const DORMANT_MAINNET_FINANCIAL_ACTION_DENIAL_REASONS = Object.freeze([
  'MAINNET_ACTIONS_DISABLED',
  'PROVIDER_WRITE_APPROVAL_MISSING',
  'MARKET_WRITE_MANIFEST_MISSING',
  'DURABLE_REPLAY_PROTECTION_UNAVAILABLE',
  'DURABLE_LIMIT_COUNTERS_UNAVAILABLE',
  'PER_TRANSACTION_LIMIT_ZERO',
  'PER_WALLET_DAILY_LIMIT_ZERO',
  'GLOBAL_DAILY_LIMIT_ZERO',
  'TOTAL_VALUE_LIMIT_ZERO',
  'NETWORK_FEE_LIMIT_ZERO',
  'POST_ACTION_RESERVE_UNCONFIGURED',
  'UNRESOLVED_INTENT_LIMIT_ZERO',
] as const);

export type DormantMainnetFinancialActionDenialReason =
  (typeof DORMANT_MAINNET_FINANCIAL_ACTION_DENIAL_REASONS)[number];

export interface DormantMainnetFinancialActionPolicyV1 {
  readonly schemaVersion: 1;
  readonly mode: 'DISABLED';
  readonly mayAuthorizeFinancialAction: false;
  readonly chainKillSwitches: Readonly<{
    readonly 'eip155:1': 'HALT';
    readonly 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'HALT';
  }>;
  readonly approvedProviders: readonly [];
  readonly approvedMarkets: readonly [];
  readonly approvedAssets: readonly [];
  readonly approvedActions: readonly [];
  readonly allowlistedWallets: readonly [];
  readonly perTransactionUsdMicros: '0';
  readonly perWalletDailyUsdMicros: '0';
  readonly globalDailyUsdMicros: '0';
  readonly totalOutstandingUsdMicros: '0';
  readonly maximumNetworkFeeAtomic: '0';
  readonly maximumNetworkFeeBasisPoints: 0;
  readonly minimumPostActionNativeBalanceAtomic: '0';
  readonly maximumAllowanceAtomic: '0';
  readonly maximumUnresolvedIntentsPerWallet: 0;
  readonly walletAllowlistSize: 0;
  readonly exactAllowanceRequired: true;
  readonly automaticResendAllowed: false;
  readonly automaticFeeEscalationAllowed: false;
  readonly durableReplayProtectionAvailable: false;
  readonly durableLimitCountersAvailable: false;
  readonly providerWriteApprovalAvailable: false;
  readonly marketWriteManifestAvailable: false;
  readonly signingResponsibility: 'USER_WALLET_ONLY';
  readonly broadcastResponsibility: 'USER_WALLET_ONLY';
  readonly apiMaySign: false;
  readonly apiMayBroadcast: false;
}

const NO_APPROVALS = Object.freeze([]) as readonly [];

/**
 * This is the only policy exported by the dormant boundary. There is no builder,
 * override, environment lookup, or non-zero alternative in this bounded context.
 */
export const DORMANT_MAINNET_FINANCIAL_ACTION_POLICY: DormantMainnetFinancialActionPolicyV1 =
  Object.freeze({
    schemaVersion: DORMANT_MAINNET_FINANCIAL_ACTION_POLICY_SCHEMA_VERSION,
    mode: 'DISABLED' as const,
    mayAuthorizeFinancialAction: false as const,
    chainKillSwitches: Object.freeze({
      'eip155:1': 'HALT' as const,
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'HALT' as const,
    }),
    approvedProviders: NO_APPROVALS,
    approvedMarkets: NO_APPROVALS,
    approvedAssets: NO_APPROVALS,
    approvedActions: NO_APPROVALS,
    allowlistedWallets: NO_APPROVALS,
    perTransactionUsdMicros: '0' as const,
    perWalletDailyUsdMicros: '0' as const,
    globalDailyUsdMicros: '0' as const,
    totalOutstandingUsdMicros: '0' as const,
    maximumNetworkFeeAtomic: '0' as const,
    maximumNetworkFeeBasisPoints: 0 as const,
    minimumPostActionNativeBalanceAtomic: '0' as const,
    maximumAllowanceAtomic: '0' as const,
    maximumUnresolvedIntentsPerWallet: 0 as const,
    walletAllowlistSize: 0 as const,
    exactAllowanceRequired: true as const,
    automaticResendAllowed: false as const,
    automaticFeeEscalationAllowed: false as const,
    durableReplayProtectionAvailable: false as const,
    durableLimitCountersAvailable: false as const,
    providerWriteApprovalAvailable: false as const,
    marketWriteManifestAvailable: false as const,
    signingResponsibility: 'USER_WALLET_ONLY' as const,
    broadcastResponsibility: 'USER_WALLET_ONLY' as const,
    apiMaySign: false as const,
    apiMayBroadcast: false as const,
  });

export interface DormantMainnetFinancialActionAssessmentV1 {
  readonly schemaVersion: 1;
  readonly decision: 'DENY';
  readonly mayAuthorizeFinancialAction: false;
  readonly intent: DormantMainnetFinancialActionIntentV1;
  readonly policy: DormantMainnetFinancialActionPolicyV1;
  readonly denialReasons: readonly DormantMainnetFinancialActionDenialReason[];
}

const INTENT_INPUT_KEYS = Object.freeze([
  'schemaVersion',
  'intentId',
  'accountId',
  'walletRegistrationId',
  'replayProtectionId',
  'idempotencyKeyDigestSha256',
  'networkId',
  'walletAddress',
  'providerId',
  'protocolId',
  'marketId',
  'assetRegistryVersion',
  'assetRegistryFingerprintSha256',
  'assetSymbol',
  'assetIdentity',
  'action',
  'amountAtomic',
  'requestedValueUsdMicros',
  'maximumNetworkFeeAtomic',
  'maximumNetworkFeeBasisPoints',
  'minimumPostActionNativeBalanceAtomic',
  'allowanceMode',
  'allowanceAmountAtomic',
  'issuedAt',
  'expiresAt',
] as const);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CANONICAL_ATOMIC_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const CANONICAL_TIMESTAMP_PATTERN =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const EVM_MARKET_PATTERN = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UINT256_MAX = (1n << 256n) - 1n;

function candidate(
  providerId: MainnetFinancialActionProviderId,
  protocolId: MainnetFinancialActionProtocolId,
  networkId: MainnetLaunchNetworkId,
): MainnetFinancialActionProviderCandidate {
  return Object.freeze({ providerId, protocolId, networkId });
}

function fail(code: DormantMainnetFinancialActionValidationCode): never {
  throw new DormantMainnetFinancialActionValidationError(code);
}

function exactDataRecord(value: unknown): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail('INVALID_INTENT_INPUT');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail('INVALID_INTENT_INPUT');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== INTENT_INPUT_KEYS.length ||
      keys.some(
        (key) => typeof key !== 'string' || !(INTENT_INPUT_KEYS as readonly string[]).includes(key),
      )
    ) {
      return fail('INVALID_INTENT_INPUT');
    }

    const record = Object.create(null) as Record<string, unknown>;
    for (const key of INTENT_INPUT_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return fail('INVALID_INTENT_INPUT');
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return fail('INVALID_INTENT_INPUT');
  }
}

function uuid(value: unknown, code: DormantMainnetFinancialActionValidationCode): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) return fail(code);
  return value;
}

function replayDigest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value) || /^0{64}$/u.test(value)) {
    return fail('INVALID_REPLAY_PROTECTION');
  }
  return value;
}

function launchNetwork(value: unknown): MainnetLaunchNetworkId {
  if (typeof value !== 'string' || !isMainnetLaunchNetwork(value)) {
    return fail('INVALID_NETWORK');
  }
  return value;
}

function wallet(networkId: MainnetLaunchNetworkId, value: unknown): WalletAddress {
  try {
    return parseWalletAddress(networkId, value);
  } catch {
    return fail('INVALID_WALLET');
  }
}

function providerBinding(
  networkId: MainnetLaunchNetworkId,
  providerIdValue: unknown,
  protocolIdValue: unknown,
): MainnetFinancialActionProviderCandidate {
  const binding = MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES.find(
    (entry) =>
      entry.networkId === networkId &&
      entry.providerId === providerIdValue &&
      entry.protocolId === protocolIdValue,
  );
  if (!binding) return fail('INVALID_PROVIDER_BINDING');
  return binding;
}

function marketBinding(networkId: MainnetLaunchNetworkId, value: unknown): string {
  if (typeof value !== 'string') return fail('INVALID_MARKET_BINDING');
  if (networkId === 'eip155:1') {
    if (!EVM_MARKET_PATTERN.test(value) || /^0x0+$/u.test(value)) {
      return fail('INVALID_MARKET_BINDING');
    }
    return value;
  }
  try {
    return parseSolanaWalletAddress(value);
  } catch {
    return fail('INVALID_MARKET_BINDING');
  }
}

function financialAction(value: unknown): MainnetFinancialAction {
  if (
    typeof value !== 'string' ||
    !(MAINNET_FINANCIAL_ACTIONS as readonly string[]).includes(value)
  ) {
    return fail('INVALID_ACTION');
  }
  return value as MainnetFinancialAction;
}

function atomic(
  value: unknown,
  code: DormantMainnetFinancialActionValidationCode,
  allowZero: boolean,
): string {
  if (typeof value !== 'string' || value.length > 78 || !CANONICAL_ATOMIC_PATTERN.test(value)) {
    return fail(code);
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX || (!allowZero && parsed === 0n)) return fail(code);
  return value;
}

function feeBasisPoints(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
    return fail('INVALID_NETWORK_FEE_LIMIT_INPUT');
  }
  return value as number;
}

function canonicalTime(
  value: unknown,
  code: DormantMainnetFinancialActionValidationCode,
): { readonly text: string; readonly milliseconds: number } {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP_PATTERN.test(value)) return fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail(code);
  }
  return Object.freeze({ text: value, milliseconds });
}

function serverTime(value: unknown): number {
  if (!(value instanceof Date)) return fail('INVALID_SERVER_TIME');
  try {
    const milliseconds = Date.prototype.getTime.call(value) as number;
    if (!Number.isFinite(milliseconds)) return fail('INVALID_SERVER_TIME');
    return milliseconds;
  } catch {
    return fail('INVALID_SERVER_TIME');
  }
}

function assetBinding(
  networkId: MainnetLaunchNetworkId,
  versionValue: unknown,
  fingerprintValue: unknown,
  symbolValue: unknown,
  identityValue: unknown,
): {
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
  readonly symbol: SupportedStablecoin;
  readonly identity: string;
  readonly decimals: number;
} {
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  if (versionValue !== registry.version || fingerprintValue !== registry.fingerprintSha256) {
    return fail('INVALID_ASSET_REGISTRY_BINDING');
  }
  if (typeof identityValue !== 'string' || typeof symbolValue !== 'string') {
    return fail('INVALID_ASSET_BINDING');
  }
  const asset = registry.identifyAsset(networkId, identityValue);
  const network = registry.networks.find((entry) => entry.networkId === networkId);
  if (
    !asset ||
    !network ||
    asset.activationState !== 'ACTIVE' ||
    network.activationState !== 'ACTIVE' ||
    asset.stablecoin !== symbolValue ||
    asset.identity !== identityValue
  ) {
    return fail('INVALID_ASSET_BINDING');
  }
  return Object.freeze({
    registryVersion: registry.version,
    registryFingerprintSha256: registry.fingerprintSha256,
    symbol: asset.stablecoin,
    identity: asset.identity,
    decimals: asset.decimals,
  });
}

/**
 * Parses an untrusted candidate into a frozen, exact-chain intent description.
 * Parsing proves syntax and binding only; it never approves or prepares a transaction.
 */
export function parseDormantMainnetFinancialActionIntent(
  input: unknown,
  serverNow: unknown,
): DormantMainnetFinancialActionIntentV1 {
  const record = exactDataRecord(input);
  if (record.schemaVersion !== DORMANT_MAINNET_FINANCIAL_ACTION_INTENT_SCHEMA_VERSION) {
    return fail('INVALID_SCHEMA_VERSION');
  }

  const intentId = uuid(record.intentId, 'INVALID_INTENT_ID');
  const accountId = uuid(record.accountId, 'INVALID_ACCOUNT_ID');
  const walletRegistrationId = uuid(record.walletRegistrationId, 'INVALID_WALLET_REGISTRATION_ID');
  const replayProtectionId = uuid(record.replayProtectionId, 'INVALID_REPLAY_PROTECTION');
  if (new Set([intentId, accountId, walletRegistrationId, replayProtectionId]).size !== 4) {
    return fail('INVALID_REPLAY_PROTECTION');
  }
  const idempotencyKeyDigestSha256 = replayDigest(record.idempotencyKeyDigestSha256);
  const networkId = launchNetwork(record.networkId);
  const walletAddress = wallet(networkId, record.walletAddress);
  const provider = providerBinding(networkId, record.providerId, record.protocolId);
  const marketId = marketBinding(networkId, record.marketId);
  const asset = assetBinding(
    networkId,
    record.assetRegistryVersion,
    record.assetRegistryFingerprintSha256,
    record.assetSymbol,
    record.assetIdentity,
  );
  const action = financialAction(record.action);
  const amountAtomic = atomic(record.amountAtomic, 'INVALID_AMOUNT', false);
  const requestedValueUsdMicros = atomic(
    record.requestedValueUsdMicros,
    'INVALID_VALUE_LIMIT_INPUT',
    false,
  );
  const maximumNetworkFeeAtomic = atomic(
    record.maximumNetworkFeeAtomic,
    'INVALID_NETWORK_FEE_LIMIT_INPUT',
    true,
  );
  const maximumNetworkFeeBasisPoints = feeBasisPoints(record.maximumNetworkFeeBasisPoints);
  const minimumPostActionNativeBalanceAtomic = atomic(
    record.minimumPostActionNativeBalanceAtomic,
    'INVALID_POST_ACTION_RESERVE',
    false,
  );
  const allowanceAmountAtomic = atomic(record.allowanceAmountAtomic, 'INVALID_ALLOWANCE', true);
  const expectedAllowance = action === 'SUPPLY' || action === 'REPAY' ? amountAtomic : '0';
  if (record.allowanceMode !== 'EXACT' || allowanceAmountAtomic !== expectedAllowance) {
    return fail('INVALID_ALLOWANCE');
  }

  const nowMilliseconds = serverTime(serverNow);
  const issuedAt = canonicalTime(record.issuedAt, 'INVALID_INTENT_TIME');
  const expiresAt = canonicalTime(record.expiresAt, 'INVALID_INTENT_TIME');
  if (
    issuedAt.milliseconds > nowMilliseconds ||
    expiresAt.milliseconds <= nowMilliseconds ||
    expiresAt.milliseconds <= issuedAt.milliseconds ||
    expiresAt.milliseconds - issuedAt.milliseconds >
      DORMANT_MAINNET_FINANCIAL_ACTION_MAXIMUM_TTL_MILLISECONDS
  ) {
    return fail('INVALID_INTENT_TIME');
  }

  return Object.freeze({
    schemaVersion: DORMANT_MAINNET_FINANCIAL_ACTION_INTENT_SCHEMA_VERSION,
    use: 'DORMANT_MAINNET_FINANCIAL_ACTION_INTENT_VALIDATION_ONLY' as const,
    mayAuthorizeFinancialAction: false as const,
    intentId,
    accountId,
    walletRegistrationId,
    replayProtectionId,
    idempotencyKeyDigestSha256,
    networkId,
    walletAddress,
    providerId: provider.providerId,
    protocolId: provider.protocolId,
    marketId,
    assetRegistryVersion: asset.registryVersion,
    assetRegistryFingerprintSha256: asset.registryFingerprintSha256,
    assetSymbol: asset.symbol,
    assetIdentity: asset.identity,
    assetDecimals: asset.decimals,
    action,
    amountAtomic,
    requestedValueUsdMicros,
    maximumNetworkFeeAtomic,
    maximumNetworkFeeBasisPoints,
    minimumPostActionNativeBalanceAtomic,
    allowanceMode: 'EXACT' as const,
    allowanceAmountAtomic,
    issuedAt: issuedAt.text,
    expiresAt: expiresAt.text,
    signingResponsibility: 'USER_WALLET_ONLY' as const,
    broadcastResponsibility: 'USER_WALLET_ONLY' as const,
    apiMaySign: false as const,
    apiMayBroadcast: false as const,
    crossChainExecutionAllowed: false as const,
    automaticResendAllowed: false as const,
    automaticFeeEscalationAllowed: false as const,
    durableReplayProtectionVerified: false as const,
  });
}

/** Revalidates the untrusted input and returns the boundary's only possible decision. */
export function assessDormantMainnetFinancialAction(
  input: unknown,
  serverNow: unknown,
): DormantMainnetFinancialActionAssessmentV1 {
  const intent = parseDormantMainnetFinancialActionIntent(input, serverNow);
  return Object.freeze({
    schemaVersion: 1 as const,
    decision: 'DENY' as const,
    mayAuthorizeFinancialAction: false as const,
    intent,
    policy: DORMANT_MAINNET_FINANCIAL_ACTION_POLICY,
    denialReasons: DORMANT_MAINNET_FINANCIAL_ACTION_DENIAL_REASONS,
  });
}
