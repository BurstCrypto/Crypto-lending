import { createHash } from 'node:crypto';

import { parseAccountId } from '../../accounts/domain/account-profile';
import type { AccountId } from '../../accounts/domain/account-profile';
import { parseActivePortfolioWalletRegistrations } from '../../portfolio/domain/active-portfolio-wallet-registrations';
import type { ActivePortfolioWalletRegistration } from '../../portfolio/application/ports/portfolio-wallet-registration-reader.port';
import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';
import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
  MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
  parseMainnetProviderPositionSnapshotV1,
  type MainnetProviderPositionObservationV1,
  type MainnetProviderPositionSnapshotV1,
} from './mainnet-provider-position-observation';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
  parseMainnetProviderPositionObservationPolicyV1,
  type MainnetProviderPositionObservationPolicyV1,
} from './mainnet-provider-position-observation-policy';
import type { MainnetProviderPositionChainAssessmentVerifierPort } from './mainnet-provider-position-chain-assessment';

export const MAINNET_PROVIDER_POSITION_COVERAGE_VERSION = 1 as const;
export const MAINNET_PROVIDER_POSITION_COVERAGE_ONLY =
  'MAINNET_PROVIDER_POSITION_COVERAGE_ONLY' as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_SLUG_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,127}$/u;
const SAFE_OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/u;
const EVM_NETWORK_PATTERN = /^eip155:/u;
const MAX_TARGETS = 512;
const MAX_POSITIONS = 512;

export type MainnetProviderPositionCoverageStatusV1 =
  'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE' | 'STALE';

export type MainnetProviderPositionCoverageDivergenceStatusV1 =
  'AGREED' | 'DIVERGENT' | 'NOT_ASSESSED';

export interface MainnetProviderPositionCoverageAssetV1 {
  readonly stablecoin: SupportedStablecoin;
  readonly identity: string;
}

export interface MainnetProviderPositionCoverageTargetV1 {
  readonly walletId: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly networkId: string;
  readonly assets: readonly MainnetProviderPositionCoverageAssetV1[];
  readonly sourceIds: readonly string[];
  readonly status: MainnetProviderPositionCoverageStatusV1;
  readonly divergenceStatus: MainnetProviderPositionCoverageDivergenceStatusV1;
  readonly positionCount: number;
  readonly observedAt: string;
  readonly staleAfter: string;
}

export interface MainnetProviderPositionCoverageManifestContentV1 {
  readonly coverageVersion: typeof MAINNET_PROVIDER_POSITION_COVERAGE_VERSION;
  readonly use: typeof MAINNET_PROVIDER_POSITION_COVERAGE_ONLY;
  readonly mayAuthorizeFinancialAction: false;
  readonly manifestId: string;
  readonly accountId: AccountId;
  readonly positionSnapshotId: string;
  readonly observationPolicyVersion: typeof MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION;
  readonly observationPolicyId: string;
  readonly observationPolicyFingerprintSha256: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly capturedAt: string;
  readonly staleAfter: string;
  readonly freshnessClass: 'CURRENT' | 'STALE';
  readonly targets: readonly MainnetProviderPositionCoverageTargetV1[];
}

export interface MainnetProviderPositionCoverageManifestV1 extends MainnetProviderPositionCoverageManifestContentV1 {
  readonly fingerprintSha256: string;
}

export interface MainnetProviderPositionCoverageContextV1 {
  readonly accountId: AccountId;
  readonly evaluatedAt: string;
  readonly expectedWallets: unknown;
  readonly observationPolicy: unknown;
}

export interface ParseCoveredMainnetProviderPositionSnapshotRequestV1 extends MainnetProviderPositionCoverageContextV1 {
  readonly coverageManifest: unknown;
  readonly positionSnapshot: unknown;
  readonly chainAssessment?: unknown;
  readonly chainAssessmentVerifier?: MainnetProviderPositionChainAssessmentVerifierPort;
}

export interface CoveredMainnetProviderPositionSnapshotV1 {
  readonly schemaVersion: typeof MAINNET_PROVIDER_POSITION_SCHEMA_VERSION;
  readonly use: typeof MAINNET_PROVIDER_POSITION_OBSERVATION_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly snapshotId: string;
  readonly observationPolicyVersion: typeof MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION;
  readonly observationPolicyId: string;
  readonly observationPolicyFingerprintSha256: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly capturedAt: string;
  readonly staleAfter: string;
  readonly freshnessClass: 'CURRENT';
  readonly observations: readonly MainnetProviderPositionObservationV1[];
  readonly coverageManifest: MainnetProviderPositionCoverageManifestV1;
}

export type MainnetProviderPositionCoverageUnavailableCode =
  | 'INVALID_MANIFEST'
  | 'ACCOUNT_MISMATCH'
  | 'POLICY_MISMATCH'
  | 'DUPLICATE_TARGET'
  | 'EXTRA_TARGET'
  | 'MISSING_TARGET'
  | 'TARGET_MISMATCH'
  | 'INCOMPLETE_TARGET'
  | 'DIVERGENT_COVERAGE'
  | 'STALE_COVERAGE'
  | 'FINGERPRINT_MISMATCH'
  | 'POSITION_SNAPSHOT_INVALID'
  | 'POSITION_COUNT_MISMATCH'
  | 'POSITION_TARGET_MISMATCH';

export class MainnetProviderPositionCoverageUnavailableError extends Error {
  public readonly code: MainnetProviderPositionCoverageUnavailableCode;

  public constructor(code: MainnetProviderPositionCoverageUnavailableCode) {
    super('Mainnet provider-position coverage is unavailable.');
    this.name = 'MainnetProviderPositionCoverageUnavailableError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface CoverageNormalizationContext {
  readonly accountId: AccountId;
  readonly evaluatedAt: string;
  readonly evaluatedAtMs: number;
  readonly expectedWallets: readonly ActivePortfolioWalletRegistration[];
  readonly policy: MainnetProviderPositionObservationPolicyV1;
}

interface ExpectedCoverageTarget {
  readonly walletId: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly networkId: string;
  readonly assets: readonly MainnetProviderPositionCoverageAssetV1[];
  readonly sourceIds: readonly string[];
}

function fail(code: MainnetProviderPositionCoverageUnavailableCode): never {
  throw new MainnetProviderPositionCoverageUnavailableError(code);
}

function dataRecord(
  value: unknown,
  keys: readonly string[],
  code: MainnetProviderPositionCoverageUnavailableCode = 'INVALID_MANIFEST',
): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail(code);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail(code);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualOwnKeys = Reflect.ownKeys(descriptors);
    if (actualOwnKeys.some((key) => typeof key !== 'string')) {
      return fail(code);
    }
    const actualKeys = (actualOwnKeys as string[]).sort();
    const expectedKeys = [...keys].sort();

    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      return fail(code);
    }

    const result: Record<string, unknown> = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) {
        return fail(code);
      }

      result[key] = descriptor.value;
    }

    return result;
  } catch (error) {
    if (error instanceof MainnetProviderPositionCoverageUnavailableError) {
      throw error;
    }
    return fail(code);
  }
}

function dataArray(
  value: unknown,
  maximumLength: number,
  code: MainnetProviderPositionCoverageUnavailableCode = 'INVALID_MANIFEST',
): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return fail(code);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors.length;
    if (
      lengthDescriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength ||
      lengthDescriptor.enumerable !== false
    ) {
      return fail(code);
    }
    const length = lengthDescriptor.value;
    const expectedKeys = [...Array.from({ length }, (_, index) => String(index)), 'length'].sort();
    const actualOwnKeys = Reflect.ownKeys(descriptors);
    if (actualOwnKeys.some((key) => typeof key !== 'string')) {
      return fail(code);
    }
    const actualKeys = (actualOwnKeys as string[]).sort();

    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      return fail(code);
    }

    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) {
        return fail(code);
      }

      result.push(descriptor.value);
    }

    return result;
  } catch (error) {
    if (error instanceof MainnetProviderPositionCoverageUnavailableError) {
      throw error;
    }
    return fail(code);
  }
}

function safeString(
  value: unknown,
  pattern: RegExp,
  code: MainnetProviderPositionCoverageUnavailableCode = 'INVALID_MANIFEST',
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    return fail(code);
  }
  return value;
}

function exactLiteral<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  code: MainnetProviderPositionCoverageUnavailableCode = 'INVALID_MANIFEST',
): T {
  if (value !== expected) {
    return fail(code);
  }
  return expected;
}

function timestamp(
  value: unknown,
  code: MainnetProviderPositionCoverageUnavailableCode = 'INVALID_MANIFEST',
): { readonly value: string; readonly milliseconds: number } {
  if (typeof value !== 'string') {
    return fail(code);
  }

  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail(code);
  }

  return { value, milliseconds };
}

function canonicalIdentity(networkId: string, value: unknown): string {
  if (typeof value !== 'string') {
    return fail('TARGET_MISMATCH');
  }

  if (EVM_NETWORK_PATTERN.test(networkId)) {
    if (!EVM_ADDRESS_PATTERN.test(value)) {
      return fail('TARGET_MISMATCH');
    }
    return value.toLowerCase();
  }

  return safeString(value, SAFE_OPAQUE_ID_PATTERN, 'TARGET_MISMATCH');
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function targetKey(
  target: Pick<
    MainnetProviderPositionCoverageTargetV1,
    'walletId' | 'providerId' | 'protocolId' | 'marketId' | 'networkId'
  >,
): string {
  return [
    target.walletId,
    target.providerId,
    target.protocolId,
    target.marketId,
    target.networkId,
  ].join('|');
}

function positionTargetKey(observation: MainnetProviderPositionObservationV1): string {
  return [
    observation.walletId,
    observation.providerId,
    observation.protocolId,
    observation.marketId,
    observation.asset.networkId,
  ].join('|');
}

function normalizeContext(
  context: MainnetProviderPositionCoverageContextV1,
): CoverageNormalizationContext {
  let accountId: AccountId;
  let expectedWallets: readonly ActivePortfolioWalletRegistration[];
  let policy: MainnetProviderPositionObservationPolicyV1;

  try {
    accountId = parseAccountId(context.accountId);
  } catch {
    return fail('ACCOUNT_MISMATCH');
  }

  const evaluatedAt = timestamp(context.evaluatedAt, 'STALE_COVERAGE');

  try {
    expectedWallets = parseActivePortfolioWalletRegistrations(context.expectedWallets);
  } catch {
    return fail('TARGET_MISMATCH');
  }

  try {
    policy = parseMainnetProviderPositionObservationPolicyV1(context.observationPolicy);
  } catch {
    return fail('POLICY_MISMATCH');
  }

  return {
    accountId,
    evaluatedAt: evaluatedAt.value,
    evaluatedAtMs: evaluatedAt.milliseconds,
    expectedWallets,
    policy,
  };
}

function expectedTargets(context: CoverageNormalizationContext): readonly ExpectedCoverageTarget[] {
  const sourceIdsByNetwork = new Map<string, string[]>();
  for (const source of context.policy.sources) {
    const sourceIds = sourceIdsByNetwork.get(source.networkId) ?? [];
    sourceIds.push(source.sourceId);
    sourceIdsByNetwork.set(source.networkId, sourceIds);
  }

  const targets: ExpectedCoverageTarget[] = [];
  for (const wallet of context.expectedWallets) {
    for (const provider of context.policy.providers) {
      for (const protocol of provider.protocols) {
        for (const market of protocol.markets) {
          if (market.networkId !== wallet.networkId) {
            continue;
          }

          targets.push({
            walletId: wallet.walletId,
            providerId: provider.providerId,
            protocolId: protocol.protocolId,
            marketId: market.marketId,
            networkId: market.networkId,
            assets: Object.freeze(
              market.assets
                .map((asset) =>
                  Object.freeze({
                    stablecoin: asset.stablecoin,
                    identity: asset.identity,
                  }),
                )
                .sort((left, right) =>
                  compareStrings(
                    `${left.stablecoin}|${left.identity}`,
                    `${right.stablecoin}|${right.identity}`,
                  ),
                ),
            ),
            sourceIds: Object.freeze(
              [...(sourceIdsByNetwork.get(market.networkId) ?? [])].sort(compareStrings),
            ),
          });
        }
      }
    }
  }

  return Object.freeze(
    targets.sort((left, right) => compareStrings(targetKey(left), targetKey(right))),
  );
}

function parseCoverageAsset(
  value: unknown,
  networkId: string,
): MainnetProviderPositionCoverageAssetV1 {
  const record = dataRecord(value, ['stablecoin', 'identity'], 'TARGET_MISMATCH');
  const stablecoin = safeString(
    record.stablecoin,
    /^(USDC|USDT|PYUSD)$/u,
    'TARGET_MISMATCH',
  ) as SupportedStablecoin;

  return Object.freeze({
    stablecoin,
    identity: canonicalIdentity(networkId, record.identity),
  });
}

function parseCoverageTarget(value: unknown): MainnetProviderPositionCoverageTargetV1 {
  const record = dataRecord(
    value,
    [
      'walletId',
      'providerId',
      'protocolId',
      'marketId',
      'networkId',
      'assets',
      'sourceIds',
      'status',
      'divergenceStatus',
      'positionCount',
      'observedAt',
      'staleAfter',
    ],
    'TARGET_MISMATCH',
  );
  const networkId = safeString(
    record.networkId,
    /^(eip155:1|solana:[1-9A-HJ-NP-Za-km-z]{32,44})$/u,
    'TARGET_MISMATCH',
  );
  const status = safeString(
    record.status,
    /^(COMPLETE|PARTIAL|UNAVAILABLE|STALE)$/u,
    'TARGET_MISMATCH',
  ) as MainnetProviderPositionCoverageStatusV1;
  const divergenceStatus = safeString(
    record.divergenceStatus,
    /^(AGREED|DIVERGENT|NOT_ASSESSED)$/u,
    'TARGET_MISMATCH',
  ) as MainnetProviderPositionCoverageDivergenceStatusV1;
  if (
    typeof record.positionCount !== 'number' ||
    !Number.isSafeInteger(record.positionCount) ||
    record.positionCount < 0 ||
    record.positionCount > MAX_POSITIONS
  ) {
    return fail('TARGET_MISMATCH');
  }

  const assets = dataArray(record.assets, 32, 'TARGET_MISMATCH')
    .map((asset) => parseCoverageAsset(asset, networkId))
    .sort((left, right) =>
      compareStrings(
        `${left.stablecoin}|${left.identity}`,
        `${right.stablecoin}|${right.identity}`,
      ),
    );
  const sourceIds = dataArray(record.sourceIds, 32, 'TARGET_MISMATCH')
    .map((sourceId) => safeString(sourceId, SAFE_SLUG_PATTERN, 'TARGET_MISMATCH'))
    .sort(compareStrings);
  if (
    new Set(assets.map((asset) => `${asset.stablecoin}|${asset.identity}`)).size !==
      assets.length ||
    new Set(sourceIds).size !== sourceIds.length
  ) {
    return fail('TARGET_MISMATCH');
  }

  const observedAt = timestamp(record.observedAt, 'STALE_COVERAGE');
  const staleAfter = timestamp(record.staleAfter, 'STALE_COVERAGE');

  return Object.freeze({
    walletId: safeString(record.walletId, UUID_PATTERN, 'TARGET_MISMATCH'),
    providerId: safeString(record.providerId, SAFE_SLUG_PATTERN, 'TARGET_MISMATCH'),
    protocolId: safeString(record.protocolId, SAFE_SLUG_PATTERN, 'TARGET_MISMATCH'),
    marketId: safeString(record.marketId, SAFE_OPAQUE_ID_PATTERN, 'TARGET_MISMATCH'),
    networkId,
    assets: Object.freeze(assets),
    sourceIds: Object.freeze(sourceIds),
    status,
    divergenceStatus,
    positionCount: record.positionCount,
    observedAt: observedAt.value,
    staleAfter: staleAfter.value,
  });
}

function exactStringArray(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function exactAssets(
  actual: readonly MainnetProviderPositionCoverageAssetV1[],
  expected: readonly MainnetProviderPositionCoverageAssetV1[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every(
      (asset, index) =>
        asset.stablecoin === expected[index]?.stablecoin &&
        asset.identity === expected[index]?.identity,
    )
  );
}

function normalizeCoverageContent(
  value: unknown,
  rawContext: MainnetProviderPositionCoverageContextV1,
): MainnetProviderPositionCoverageManifestContentV1 {
  const context = normalizeContext(rawContext);
  const record = dataRecord(value, [
    'coverageVersion',
    'use',
    'mayAuthorizeFinancialAction',
    'manifestId',
    'accountId',
    'positionSnapshotId',
    'observationPolicyVersion',
    'observationPolicyId',
    'observationPolicyFingerprintSha256',
    'assetRegistryVersion',
    'assetRegistryFingerprintSha256',
    'capturedAt',
    'staleAfter',
    'freshnessClass',
    'targets',
  ]);

  exactLiteral(record.coverageVersion, MAINNET_PROVIDER_POSITION_COVERAGE_VERSION);
  exactLiteral(record.use, MAINNET_PROVIDER_POSITION_COVERAGE_ONLY);
  exactLiteral(record.mayAuthorizeFinancialAction, false);

  let accountId: AccountId;
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return fail('ACCOUNT_MISMATCH');
  }
  if (accountId !== context.accountId) {
    return fail('ACCOUNT_MISMATCH');
  }

  if (
    record.observationPolicyVersion !== context.policy.policyVersion ||
    record.observationPolicyId !== context.policy.policyId ||
    record.observationPolicyFingerprintSha256 !== context.policy.fingerprintSha256 ||
    record.assetRegistryVersion !== MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version ||
    record.assetRegistryFingerprintSha256 !==
      MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256
  ) {
    return fail('POLICY_MISMATCH');
  }

  const capturedAt = timestamp(record.capturedAt, 'STALE_COVERAGE');
  const staleAfter = timestamp(record.staleAfter, 'STALE_COVERAGE');
  if (
    capturedAt.milliseconds > context.evaluatedAtMs ||
    staleAfter.milliseconds <= capturedAt.milliseconds ||
    context.evaluatedAtMs >= staleAfter.milliseconds ||
    record.freshnessClass !== 'CURRENT'
  ) {
    return fail('STALE_COVERAGE');
  }

  const parsedTargets = dataArray(record.targets, MAX_TARGETS).map(parseCoverageTarget);
  const seenKeys = new Set<string>();
  for (const target of parsedTargets) {
    const key = targetKey(target);
    if (seenKeys.has(key)) {
      return fail('DUPLICATE_TARGET');
    }
    seenKeys.add(key);
  }

  const expected = expectedTargets(context);
  const expectedByKey = new Map(expected.map((target) => [targetKey(target), target] as const));

  for (const target of parsedTargets) {
    const expectedTarget = expectedByKey.get(targetKey(target));
    if (expectedTarget === undefined) {
      return fail('EXTRA_TARGET');
    }

    if (
      !exactAssets(target.assets, expectedTarget.assets) ||
      !exactStringArray(target.sourceIds, expectedTarget.sourceIds)
    ) {
      return fail('TARGET_MISMATCH');
    }

    if (target.status !== 'COMPLETE') {
      return fail('INCOMPLETE_TARGET');
    }
    if (target.divergenceStatus !== 'AGREED') {
      return fail('DIVERGENT_COVERAGE');
    }

    const targetObservedAtMs = Date.parse(target.observedAt);
    const targetStaleAfterMs = Date.parse(target.staleAfter);
    const networkPolicy = chainObservationPolicyForNetwork(target.networkId);
    if (
      networkPolicy === undefined ||
      networkPolicy.environment !== 'MAINNET' ||
      targetObservedAtMs > capturedAt.milliseconds ||
      targetStaleAfterMs <= targetObservedAtMs ||
      context.evaluatedAtMs >= targetStaleAfterMs ||
      capturedAt.milliseconds - targetObservedAtMs > networkPolicy.freshness.unavailableAfterMs ||
      targetStaleAfterMs > targetObservedAtMs + networkPolicy.freshness.currentWithinMs
    ) {
      return fail('STALE_COVERAGE');
    }
  }

  if (parsedTargets.length < expected.length) {
    return fail('MISSING_TARGET');
  }
  if (parsedTargets.length > expected.length) {
    return fail('EXTRA_TARGET');
  }

  const positionCount = parsedTargets.reduce((sum, target) => sum + target.positionCount, 0);
  if (positionCount > MAX_POSITIONS) {
    return fail('TARGET_MISMATCH');
  }

  const targets = [...parsedTargets].sort((left, right) =>
    compareStrings(targetKey(left), targetKey(right)),
  );
  if (
    targets.length > 0 &&
    staleAfter.milliseconds !== Math.min(...targets.map((target) => Date.parse(target.staleAfter)))
  ) {
    return fail('STALE_COVERAGE');
  }

  return Object.freeze({
    coverageVersion: MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
    use: MAINNET_PROVIDER_POSITION_COVERAGE_ONLY,
    mayAuthorizeFinancialAction: false,
    manifestId: safeString(record.manifestId, UUID_PATTERN),
    accountId,
    positionSnapshotId: safeString(record.positionSnapshotId, SAFE_OPAQUE_ID_PATTERN),
    observationPolicyVersion: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
    observationPolicyId: context.policy.policyId,
    observationPolicyFingerprintSha256: context.policy.fingerprintSha256,
    assetRegistryVersion: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version,
    assetRegistryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    capturedAt: capturedAt.value,
    staleAfter: staleAfter.value,
    freshnessClass: 'CURRENT',
    targets: Object.freeze(targets),
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareStrings)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function mainnetProviderPositionCoverageManifestFingerprintV1(
  value: unknown,
  context: MainnetProviderPositionCoverageContextV1,
): string {
  const normalized = normalizeCoverageContent(value, context);
  return createHash('sha256').update(canonicalJson(normalized), 'utf8').digest('hex');
}

export function parseMainnetProviderPositionCoverageManifestV1(
  value: unknown,
  context: MainnetProviderPositionCoverageContextV1,
): MainnetProviderPositionCoverageManifestV1 {
  const record = dataRecord(value, [
    'coverageVersion',
    'use',
    'mayAuthorizeFinancialAction',
    'manifestId',
    'accountId',
    'positionSnapshotId',
    'observationPolicyVersion',
    'observationPolicyId',
    'observationPolicyFingerprintSha256',
    'assetRegistryVersion',
    'assetRegistryFingerprintSha256',
    'capturedAt',
    'staleAfter',
    'freshnessClass',
    'targets',
    'fingerprintSha256',
  ]);
  const content: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(record)) {
    if (key !== 'fingerprintSha256') {
      content[key] = item;
    }
  }

  const normalized = normalizeCoverageContent(content, context);
  const fingerprint = safeString(record.fingerprintSha256, SHA256_PATTERN, 'FINGERPRINT_MISMATCH');
  const expectedFingerprint = createHash('sha256')
    .update(canonicalJson(normalized), 'utf8')
    .digest('hex');
  if (fingerprint !== expectedFingerprint) {
    return fail('FINGERPRINT_MISMATCH');
  }

  return Object.freeze({
    ...normalized,
    fingerprintSha256: fingerprint,
  });
}

function parseEmptyPositionSnapshot(
  value: unknown,
  manifest: MainnetProviderPositionCoverageManifestV1,
): Omit<CoveredMainnetProviderPositionSnapshotV1, 'coverageManifest'> {
  const record = dataRecord(
    value,
    [
      'schemaVersion',
      'use',
      'mayAuthorizeFinancialAction',
      'snapshotId',
      'observationPolicyVersion',
      'observationPolicyId',
      'observationPolicyFingerprintSha256',
      'assetRegistryVersion',
      'assetRegistryFingerprintSha256',
      'capturedAt',
      'staleAfter',
      'freshnessClass',
      'observations',
    ],
    'POSITION_SNAPSHOT_INVALID',
  );
  exactLiteral(
    record.schemaVersion,
    MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
    'POSITION_SNAPSHOT_INVALID',
  );
  exactLiteral(record.use, MAINNET_PROVIDER_POSITION_OBSERVATION_USE, 'POSITION_SNAPSHOT_INVALID');
  exactLiteral(record.mayAuthorizeFinancialAction, false, 'POSITION_SNAPSHOT_INVALID');
  if (
    record.snapshotId !== manifest.positionSnapshotId ||
    record.observationPolicyVersion !== manifest.observationPolicyVersion ||
    record.observationPolicyId !== manifest.observationPolicyId ||
    record.observationPolicyFingerprintSha256 !== manifest.observationPolicyFingerprintSha256 ||
    record.assetRegistryVersion !== manifest.assetRegistryVersion ||
    record.assetRegistryFingerprintSha256 !== manifest.assetRegistryFingerprintSha256 ||
    record.capturedAt !== manifest.capturedAt ||
    record.staleAfter !== manifest.staleAfter ||
    record.freshnessClass !== 'CURRENT'
  ) {
    return fail('POSITION_SNAPSHOT_INVALID');
  }

  if (dataArray(record.observations, MAX_POSITIONS, 'POSITION_SNAPSHOT_INVALID').length !== 0) {
    return fail('POSITION_SNAPSHOT_INVALID');
  }

  return Object.freeze({
    schemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
    mayAuthorizeFinancialAction: false,
    snapshotId: manifest.positionSnapshotId,
    observationPolicyVersion: manifest.observationPolicyVersion,
    observationPolicyId: manifest.observationPolicyId,
    observationPolicyFingerprintSha256: manifest.observationPolicyFingerprintSha256,
    assetRegistryVersion: manifest.assetRegistryVersion,
    assetRegistryFingerprintSha256: manifest.assetRegistryFingerprintSha256,
    capturedAt: manifest.capturedAt,
    staleAfter: manifest.staleAfter,
    freshnessClass: 'CURRENT',
    observations: Object.freeze([]),
  });
}

function observationCountByTarget(
  observations: readonly MainnetProviderPositionObservationV1[],
  manifest: MainnetProviderPositionCoverageManifestV1,
): ReadonlyMap<string, number> {
  const targetByKey = new Map(
    manifest.targets.map((target) => [targetKey(target), target] as const),
  );
  const countByTarget = new Map<string, number>();

  for (const observation of observations) {
    const key = positionTargetKey(observation);
    const target = targetByKey.get(key);
    if (target === undefined) {
      return fail('POSITION_TARGET_MISMATCH');
    }

    if (
      !target.assets.some(
        (asset) =>
          asset.stablecoin === observation.asset.stablecoin &&
          asset.identity === observation.asset.identity,
      )
    ) {
      return fail('POSITION_TARGET_MISMATCH');
    }

    countByTarget.set(key, (countByTarget.get(key) ?? 0) + 1);
  }

  return countByTarget;
}

export function parseCoveredMainnetProviderPositionSnapshotV1(
  request: ParseCoveredMainnetProviderPositionSnapshotRequestV1,
): CoveredMainnetProviderPositionSnapshotV1 {
  const context = normalizeContext(request);
  const manifest = parseMainnetProviderPositionCoverageManifestV1(
    request.coverageManifest,
    request,
  );

  let observationsInput: readonly unknown[];
  try {
    const snapshotRecord = dataRecord(
      request.positionSnapshot,
      [
        'schemaVersion',
        'use',
        'mayAuthorizeFinancialAction',
        'snapshotId',
        'observationPolicyVersion',
        'observationPolicyId',
        'observationPolicyFingerprintSha256',
        'assetRegistryVersion',
        'assetRegistryFingerprintSha256',
        'capturedAt',
        'staleAfter',
        'freshnessClass',
        'observations',
      ],
      'POSITION_SNAPSHOT_INVALID',
    );
    observationsInput = dataArray(
      snapshotRecord.observations,
      MAX_POSITIONS,
      'POSITION_SNAPSHOT_INVALID',
    );
  } catch (error) {
    if (error instanceof MainnetProviderPositionCoverageUnavailableError) {
      throw error;
    }
    return fail('POSITION_SNAPSHOT_INVALID');
  }

  let snapshot:
    | MainnetProviderPositionSnapshotV1
    | Omit<CoveredMainnetProviderPositionSnapshotV1, 'coverageManifest'>;
  if (observationsInput.length === 0) {
    snapshot = parseEmptyPositionSnapshot(request.positionSnapshot, manifest);
  } else {
    if (request.chainAssessment === undefined || request.chainAssessmentVerifier === undefined) {
      return fail('POSITION_SNAPSHOT_INVALID');
    }

    try {
      snapshot = parseMainnetProviderPositionSnapshotV1(
        request.positionSnapshot,
        context.evaluatedAt,
        context.policy,
        request.chainAssessment,
        request.chainAssessmentVerifier,
      );
    } catch {
      return fail('POSITION_SNAPSHOT_INVALID');
    }
  }

  if (
    snapshot.snapshotId !== manifest.positionSnapshotId ||
    snapshot.observationPolicyVersion !== manifest.observationPolicyVersion ||
    snapshot.observationPolicyId !== manifest.observationPolicyId ||
    snapshot.observationPolicyFingerprintSha256 !== manifest.observationPolicyFingerprintSha256 ||
    snapshot.assetRegistryVersion !== manifest.assetRegistryVersion ||
    snapshot.assetRegistryFingerprintSha256 !== manifest.assetRegistryFingerprintSha256 ||
    snapshot.capturedAt !== manifest.capturedAt ||
    snapshot.staleAfter !== manifest.staleAfter ||
    snapshot.freshnessClass !== 'CURRENT'
  ) {
    return fail('POSITION_SNAPSHOT_INVALID');
  }

  const totalDeclaredPositions = manifest.targets.reduce(
    (sum, target) => sum + target.positionCount,
    0,
  );
  if (totalDeclaredPositions !== snapshot.observations.length) {
    return fail('POSITION_COUNT_MISMATCH');
  }

  const actualCountByTarget = observationCountByTarget(snapshot.observations, manifest);
  for (const target of manifest.targets) {
    if ((actualCountByTarget.get(targetKey(target)) ?? 0) !== target.positionCount) {
      return fail('POSITION_COUNT_MISMATCH');
    }
  }

  return Object.freeze({
    schemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
    mayAuthorizeFinancialAction: false,
    snapshotId: snapshot.snapshotId,
    observationPolicyVersion: snapshot.observationPolicyVersion,
    observationPolicyId: snapshot.observationPolicyId,
    observationPolicyFingerprintSha256: snapshot.observationPolicyFingerprintSha256,
    assetRegistryVersion: snapshot.assetRegistryVersion,
    assetRegistryFingerprintSha256: snapshot.assetRegistryFingerprintSha256,
    capturedAt: snapshot.capturedAt,
    staleAfter: snapshot.staleAfter,
    freshnessClass: 'CURRENT',
    observations: snapshot.observations,
    coverageManifest: manifest,
  });
}
