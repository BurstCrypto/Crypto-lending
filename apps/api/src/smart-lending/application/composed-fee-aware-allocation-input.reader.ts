import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { parseAccountId } from '../../accounts/domain/account-profile';
import type { MainnetLaunchNetworkId } from '../../blockchain/domain/mainnet-launch-network-policy';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import { parseWalletAddress } from '../../wallets/domain/wallet-identity';
import {
  FEE_AWARE_ALLOCATION_COST_KINDS,
  type FeeAwareAllocationCandidate,
  type FeeAwareAllocationCostsUsdMantissa,
  type FeeAwareCapitalPosition,
  type FeeAwareCrossChainOptIn,
  type FeeAwareCrossChainPolicy,
  type FeeAwareLendingOpportunity,
  type FeeAwareRiskAssessment,
  type FeeAwareRouteCostQuote,
} from '../domain/fee-aware-allocation';
import {
  APPROVED_LENDING_OPPORTUNITY_SNAPSHOT_READER,
  type ApprovedLendingOpportunity,
  type ApprovedLendingOpportunitySnapshot,
  type ApprovedLendingOpportunitySnapshotReader,
} from './ports/approved-lending-opportunity-snapshot-reader.port';
import {
  APPROVED_SMART_LENDING_POLICY_READER,
  type ApprovedCrossChainNetworkPair,
  type ApprovedSmartLendingPolicyReader,
  type ApprovedSmartLendingPolicySnapshot,
  type CrossChainConsiderationConsent,
  type CrossChainQuoteDisclosureConsent,
} from './ports/approved-smart-lending-policy-reader.port';
import {
  type FeeAwareAllocationInputReader,
  type FeeAwareAllocationInputs,
  type ReadFeeAwareAllocationInputsRequest,
} from './ports/fee-aware-allocation-input.port';
import {
  FULL_LIFECYCLE_COST_QUOTE_READER,
  type FullLifecycleCostQuoteReader,
  type LifecycleQuoteWalletEndpoint,
  type ReadFullLifecycleCostQuoteRequest,
} from './ports/full-lifecycle-cost-quote-reader.port';
import { SMART_LENDING_PROVIDER_IDS } from './ports/live-lending-market-feed.port';
import {
  ROUTABLE_CAPITAL_POSITION_SNAPSHOT_READER,
  type RoutableCapitalPosition,
  type RoutableCapitalPositionSnapshot,
  type RoutableCapitalPositionSnapshotReader,
  type SmartLendingDestinationWallet,
} from './ports/routable-capital-position-snapshot-reader.port';

const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_REFERENCE = /^[\x21-\x7e]{1,192}$/u;
const BRIDGE_PROVIDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_RATE_BASIS_POINTS = 1_000_000n;
const MAX_HOLDING_PERIOD_DAYS = 36_500n;
const MAX_FRESHNESS_SECONDS = 86_400n;
const MAX_POSITIONS = 64;
const MAX_OPPORTUNITIES = 256;
const MAX_CONSENT_WALLET_IDS = MAX_POSITIONS + 2;
export const MAX_COMPOSED_FEE_AWARE_CANDIDATES = 128 as const;
export const COMPOSED_FEE_AWARE_QUOTE_DEADLINE_MILLISECONDS = 30_000 as const;

interface ParsedTimestamp {
  readonly text: string;
  readonly milliseconds: number;
}

interface ParsedPolicy extends ApprovedSmartLendingPolicySnapshot {
  readonly evaluatedAtMilliseconds: number;
  readonly crossChainConsiderationConsent: CrossChainConsiderationConsent | null;
  readonly crossChainQuoteDisclosureConsent: CrossChainQuoteDisclosureConsent | null;
}

interface CandidatePlan {
  readonly candidateId: string;
  readonly position: RoutableCapitalPosition;
  readonly opportunity: ApprovedLendingOpportunity;
  readonly destinationWallet: LifecycleQuoteWalletEndpoint;
}

export class FeeAwareAllocationInputUnavailableError extends Error {
  readonly code = 'FEE_AWARE_ALLOCATION_INPUT_UNAVAILABLE' as const;

  constructor() {
    super('Fee-aware allocation inputs are unavailable');
    this.name = 'FeeAwareAllocationInputUnavailableError';
  }
}

function unavailable(): never {
  throw new FeeAwareAllocationInputUnavailableError();
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ownDataRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return unavailable();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return unavailable();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return unavailable();
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return unavailable();
      }
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return unavailable();
  }
}

function ownDataArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return unavailable();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return unavailable();
    const length = lengthDescriptor.value;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < minimumLength ||
      length > maximumLength
    ) {
      return unavailable();
    }
    const expectedKeys = new Set([
      'length',
      ...Array.from({ length }, (_unused, index) => String(index)),
    ]);
    if (
      Reflect.ownKeys(descriptors).length !== expectedKeys.size ||
      Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !expectedKeys.has(key))
    ) {
      return unavailable();
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return unavailable();
      }
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return unavailable();
  }
}

function timestamp(value: unknown): ParsedTimestamp {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return unavailable();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return unavailable();
  }
  return { text: value, milliseconds };
}

function aggregateQuoteDeadline(evaluatedAt: ParsedTimestamp): ParsedTimestamp {
  const milliseconds = evaluatedAt.milliseconds + COMPOSED_FEE_AWARE_QUOTE_DEADLINE_MILLISECONDS;
  if (!Number.isFinite(milliseconds)) return unavailable();
  try {
    return timestamp(new Date(milliseconds).toISOString());
  } catch {
    return unavailable();
  }
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value)) return unavailable();
  return value;
}

function correlationId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return unavailable();
  return value;
}

function walletId(value: unknown): string {
  return correlationId(value);
}

function unsignedBigInt(value: unknown, maximum: bigint = MAX_UINT256): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > maximum) return unavailable();
  return value;
}

function positiveBigInt(value: unknown, maximum: bigint = MAX_UINT256): bigint {
  const result = unsignedBigInt(value, maximum);
  if (result === 0n) return unavailable();
  return result;
}

function networkId(value: unknown): MainnetLaunchNetworkId {
  if (value !== 'eip155:1' && value !== 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') {
    return unavailable();
  }
  return value;
}

function boundSnapshot(
  record: Readonly<Record<string, unknown>>,
  request: ReadFeeAwareAllocationInputsRequest,
  deadline: ParsedTimestamp,
): { readonly capturedAt: ParsedTimestamp; readonly validUntil: ParsedTimestamp } {
  if (
    record.accountId !== request.accountId ||
    record.correlationId !== request.correlationId ||
    record.evaluatedAt !== request.evaluatedAt
  ) {
    return unavailable();
  }
  const capturedAt = timestamp(record.capturedAt);
  const validUntil = timestamp(record.validUntil);
  const evaluatedAt = timestamp(request.evaluatedAt);
  if (
    capturedAt.milliseconds > evaluatedAt.milliseconds ||
    evaluatedAt.milliseconds >= validUntil.milliseconds ||
    deadline.milliseconds >= validUntil.milliseconds
  ) {
    return unavailable();
  }
  return { capturedAt, validUntil };
}

function parseRoutablePosition(value: unknown): RoutableCapitalPosition {
  const record = ownDataRecord(value, [
    'positionId',
    'walletId',
    'networkId',
    'assetId',
    'assetSymbol',
    'assetDecimals',
    'walletAddress',
    'amountAtomic',
    'amountUsdMantissa',
  ]);
  const parsedNetworkId = networkId(record.networkId);
  if (typeof record.assetId !== 'string') return unavailable();
  const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(parsedNetworkId, record.assetId);
  if (
    !asset ||
    asset.activationState !== 'ACTIVE' ||
    asset.decimals !== 6 ||
    record.assetDecimals !== 6 ||
    record.assetSymbol !== asset.stablecoin
  ) {
    return unavailable();
  }
  let address: string;
  try {
    address = parseWalletAddress(parsedNetworkId, record.walletAddress);
  } catch {
    return unavailable();
  }
  return Object.freeze({
    positionId: reference(record.positionId),
    walletId: walletId(record.walletId),
    networkId: parsedNetworkId,
    assetId: asset.identity,
    assetSymbol: asset.stablecoin,
    assetDecimals: 6 as const,
    walletAddress: address,
    amountAtomic: positiveBigInt(record.amountAtomic),
    amountUsdMantissa: positiveBigInt(record.amountUsdMantissa),
  });
}

function parseDestinationWallet(value: unknown): SmartLendingDestinationWallet {
  const record = ownDataRecord(value, [
    'walletId',
    'networkId',
    'walletAddress',
    'selectionReferenceId',
  ]);
  const parsedNetworkId = networkId(record.networkId);
  let address: string;
  try {
    address = parseWalletAddress(parsedNetworkId, record.walletAddress);
  } catch {
    return unavailable();
  }
  return Object.freeze({
    walletId: walletId(record.walletId),
    networkId: parsedNetworkId,
    walletAddress: address,
    selectionReferenceId: reference(record.selectionReferenceId),
  });
}

function parsePositionSnapshot(
  value: unknown,
  request: ReadFeeAwareAllocationInputsRequest,
  deadline: ParsedTimestamp,
): RoutableCapitalPositionSnapshot {
  const record = ownDataRecord(value, [
    'schemaVersion',
    'use',
    'accountId',
    'correlationId',
    'evaluatedAt',
    'snapshotReferenceId',
    'capturedAt',
    'validUntil',
    'coverage',
    'valuationPolicyApprovalReferenceId',
    'positions',
    'destinationWallets',
  ]);
  if (
    record.schemaVersion !== 1 ||
    record.use !== 'SMART_LENDING_ROUTABLE_CAPITAL' ||
    record.coverage !== 'COMPLETE'
  ) {
    return unavailable();
  }
  const binding = boundSnapshot(record, request, deadline);
  const positions = ownDataArray(record.positions, 1, MAX_POSITIONS)
    .map(parseRoutablePosition)
    .sort((left, right) => ordinalCompare(left.positionId, right.positionId));
  const destinationWallets = ownDataArray(record.destinationWallets, 0, 2)
    .map(parseDestinationWallet)
    .sort((left, right) => ordinalCompare(left.networkId, right.networkId));
  if (
    new Set(positions.map(({ positionId }) => positionId)).size !== positions.length ||
    new Set(
      positions.map(
        ({ walletId: id, networkId: network, assetId }) => `${id}\u0000${network}\u0000${assetId}`,
      ),
    ).size !== positions.length ||
    new Set(destinationWallets.map(({ networkId: network }) => network)).size !==
      destinationWallets.length ||
    new Set(destinationWallets.map(({ walletId: id }) => id)).size !== destinationWallets.length
  ) {
    return unavailable();
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    use: 'SMART_LENDING_ROUTABLE_CAPITAL' as const,
    accountId: request.accountId,
    correlationId: request.correlationId,
    evaluatedAt: request.evaluatedAt,
    snapshotReferenceId: reference(record.snapshotReferenceId),
    capturedAt: binding.capturedAt.text,
    validUntil: binding.validUntil.text,
    coverage: 'COMPLETE' as const,
    valuationPolicyApprovalReferenceId: reference(record.valuationPolicyApprovalReferenceId),
    positions: Object.freeze(positions),
    destinationWallets: Object.freeze(destinationWallets),
  });
}

function parseRiskAssessment(value: unknown): FeeAwareRiskAssessment | null {
  if (value === null) return null;
  const record = ownDataRecord(value, [
    'status',
    'assessmentReferenceId',
    'assessedAt',
    'validUntil',
    'penaltyBasisPoints',
  ]);
  const assessedAt = timestamp(record.assessedAt);
  const validUntil = timestamp(record.validUntil);
  if (
    record.status !== 'APPROVED_FOR_RECOMMENDATION' ||
    validUntil.milliseconds <= assessedAt.milliseconds
  ) {
    return unavailable();
  }
  return Object.freeze({
    status: 'APPROVED_FOR_RECOMMENDATION' as const,
    assessmentReferenceId: reference(record.assessmentReferenceId),
    assessedAt: assessedAt.text,
    validUntil: validUntil.text,
    penaltyBasisPoints: unsignedBigInt(record.penaltyBasisPoints, MAX_RATE_BASIS_POINTS),
  });
}

function parseOpportunity(value: unknown): ApprovedLendingOpportunity {
  const record = ownDataRecord(value, [
    'opportunityId',
    'providerId',
    'protocolId',
    'marketId',
    'networkId',
    'assetId',
    'assetSymbol',
    'assetDecimals',
    'availability',
    'recommendationEligibility',
    'grossApyBasisPoints',
    'recurringFeeBasisPoints',
    'availableCapacityUsdMantissa',
    'evidence',
    'riskAssessment',
  ]);
  if (
    typeof record.providerId !== 'string' ||
    !SMART_LENDING_PROVIDER_IDS.includes(
      record.providerId as (typeof SMART_LENDING_PROVIDER_IDS)[number],
    )
  ) {
    return unavailable();
  }
  const parsedNetworkId = networkId(record.networkId);
  if (typeof record.assetId !== 'string') return unavailable();
  const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(parsedNetworkId, record.assetId);
  if (
    !asset ||
    asset.activationState !== 'ACTIVE' ||
    asset.decimals !== 6 ||
    record.assetDecimals !== 6 ||
    record.assetSymbol !== asset.stablecoin ||
    (record.availability !== 'AVAILABLE' && record.availability !== 'UNAVAILABLE') ||
    (record.recommendationEligibility !== 'ELIGIBLE' &&
      record.recommendationEligibility !== 'INELIGIBLE')
  ) {
    return unavailable();
  }
  const evidence = ownDataRecord(record.evidence, [
    'evidenceReferenceId',
    'adapterId',
    'observedAt',
    'validUntil',
  ]);
  const observedAt = timestamp(evidence.observedAt);
  const evidenceValidUntil = timestamp(evidence.validUntil);
  if (evidenceValidUntil.milliseconds <= observedAt.milliseconds) return unavailable();
  return Object.freeze({
    opportunityId: reference(record.opportunityId),
    providerId: record.providerId,
    protocolId: reference(record.protocolId),
    marketId: reference(record.marketId),
    networkId: parsedNetworkId,
    assetId: asset.identity,
    assetSymbol: asset.stablecoin,
    assetDecimals: 6 as const,
    availability: record.availability,
    recommendationEligibility: record.recommendationEligibility,
    grossApyBasisPoints: unsignedBigInt(record.grossApyBasisPoints, MAX_RATE_BASIS_POINTS),
    recurringFeeBasisPoints: unsignedBigInt(record.recurringFeeBasisPoints, MAX_RATE_BASIS_POINTS),
    availableCapacityUsdMantissa: unsignedBigInt(record.availableCapacityUsdMantissa),
    evidence: Object.freeze({
      evidenceReferenceId: reference(evidence.evidenceReferenceId),
      adapterId: reference(evidence.adapterId),
      observedAt: observedAt.text,
      validUntil: evidenceValidUntil.text,
    }),
    riskAssessment: parseRiskAssessment(record.riskAssessment),
  });
}

function parseOpportunitySnapshot(
  value: unknown,
  request: ReadFeeAwareAllocationInputsRequest,
  deadline: ParsedTimestamp,
): ApprovedLendingOpportunitySnapshot {
  const record = ownDataRecord(value, [
    'schemaVersion',
    'use',
    'accountId',
    'correlationId',
    'evaluatedAt',
    'snapshotReferenceId',
    'capturedAt',
    'validUntil',
    'coverage',
    'providerCoverage',
    'providerPolicyApprovalReferenceId',
    'riskPolicyApprovalReferenceId',
    'opportunities',
  ]);
  if (
    record.schemaVersion !== 1 ||
    record.use !== 'APPROVED_SMART_LENDING_OPPORTUNITIES' ||
    record.coverage !== 'COMPLETE'
  ) {
    return unavailable();
  }
  const binding = boundSnapshot(record, request, deadline);
  const providerCoverage = ownDataArray(
    record.providerCoverage,
    SMART_LENDING_PROVIDER_IDS.length,
    SMART_LENDING_PROVIDER_IDS.length,
  ).map((provider) => {
    if (
      typeof provider !== 'string' ||
      !SMART_LENDING_PROVIDER_IDS.includes(provider as (typeof SMART_LENDING_PROVIDER_IDS)[number])
    ) {
      return unavailable();
    }
    return provider as (typeof SMART_LENDING_PROVIDER_IDS)[number];
  });
  if (
    new Set(providerCoverage).size !== SMART_LENDING_PROVIDER_IDS.length ||
    SMART_LENDING_PROVIDER_IDS.some((provider) => !providerCoverage.includes(provider))
  ) {
    return unavailable();
  }
  const opportunities = ownDataArray(record.opportunities, 1, MAX_OPPORTUNITIES)
    .map(parseOpportunity)
    .sort((left, right) => ordinalCompare(left.opportunityId, right.opportunityId));
  if (
    new Set(opportunities.map(({ opportunityId }) => opportunityId)).size !== opportunities.length
  ) {
    return unavailable();
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    use: 'APPROVED_SMART_LENDING_OPPORTUNITIES' as const,
    accountId: request.accountId,
    correlationId: request.correlationId,
    evaluatedAt: request.evaluatedAt,
    snapshotReferenceId: reference(record.snapshotReferenceId),
    capturedAt: binding.capturedAt.text,
    validUntil: binding.validUntil.text,
    coverage: 'COMPLETE' as const,
    providerCoverage: Object.freeze(providerCoverage),
    providerPolicyApprovalReferenceId: reference(record.providerPolicyApprovalReferenceId),
    riskPolicyApprovalReferenceId: reference(record.riskPolicyApprovalReferenceId),
    opportunities: Object.freeze(opportunities),
  });
}

function parseOptIn(value: unknown): FeeAwareCrossChainOptIn | null {
  if (value === null) return null;
  const record = ownDataRecord(value, ['scope', 'consentReferenceId', 'grantedAt', 'expiresAt']);
  const grantedAt = timestamp(record.grantedAt);
  const expiresAt = timestamp(record.expiresAt);
  if (
    record.scope !== 'CONSIDER_CROSS_CHAIN_RECOMMENDATIONS' ||
    expiresAt.milliseconds <= grantedAt.milliseconds
  ) {
    return unavailable();
  }
  return Object.freeze({
    scope: 'CONSIDER_CROSS_CHAIN_RECOMMENDATIONS' as const,
    consentReferenceId: reference(record.consentReferenceId),
    grantedAt: grantedAt.text,
    expiresAt: expiresAt.text,
  });
}

function parseCrossChainPolicy(value: unknown): FeeAwareCrossChainPolicy {
  const record = ownDataRecord(value, [
    'optIn',
    'allowedBridgeProviderIds',
    'maximumLifecycleCostUsdMantissa',
    'minimumNetImprovementUsdMantissa',
  ]);
  const allowedBridgeProviderIds = ownDataArray(record.allowedBridgeProviderIds, 0, 32).map(
    (provider) => {
      if (typeof provider !== 'string' || !BRIDGE_PROVIDER.test(provider)) return unavailable();
      return provider;
    },
  );
  if (new Set(allowedBridgeProviderIds).size !== allowedBridgeProviderIds.length) {
    return unavailable();
  }
  allowedBridgeProviderIds.sort(ordinalCompare);
  return Object.freeze({
    optIn: parseOptIn(record.optIn),
    allowedBridgeProviderIds: Object.freeze(allowedBridgeProviderIds),
    maximumLifecycleCostUsdMantissa: unsignedBigInt(record.maximumLifecycleCostUsdMantissa),
    minimumNetImprovementUsdMantissa: unsignedBigInt(record.minimumNetImprovementUsdMantissa),
  });
}

function parseExposurePolicy(value: unknown): ApprovedSmartLendingPolicySnapshot['exposurePolicy'] {
  const record = ownDataRecord(value, [
    'maximumCrossChainPrincipalUsdMantissa',
    'maximumProviderPrincipalUsdMantissa',
  ]);
  return Object.freeze({
    maximumCrossChainPrincipalUsdMantissa: unsignedBigInt(
      record.maximumCrossChainPrincipalUsdMantissa,
    ),
    maximumProviderPrincipalUsdMantissa: unsignedBigInt(record.maximumProviderPrincipalUsdMantissa),
  });
}

function parseApprovedWalletIds(value: unknown): readonly string[] {
  const values = ownDataArray(value, 1, MAX_CONSENT_WALLET_IDS).map(walletId);
  if (new Set(values).size !== values.length) return unavailable();
  values.sort(ordinalCompare);
  return Object.freeze(values);
}

function parseApprovedNetworkPairs(value: unknown): readonly ApprovedCrossChainNetworkPair[] {
  const pairs = ownDataArray(value, 1, 2).map((entry) => {
    const record = ownDataRecord(entry, ['sourceNetworkId', 'destinationNetworkId']);
    const sourceNetworkId = networkId(record.sourceNetworkId);
    const destinationNetworkId = networkId(record.destinationNetworkId);
    if (sourceNetworkId === destinationNetworkId) return unavailable();
    return Object.freeze({ sourceNetworkId, destinationNetworkId });
  });
  const key = (pair: ApprovedCrossChainNetworkPair): string =>
    `${pair.sourceNetworkId}\u0000${pair.destinationNetworkId}`;
  if (new Set(pairs.map(key)).size !== pairs.length) return unavailable();
  pairs.sort((left, right) => ordinalCompare(key(left), key(right)));
  return Object.freeze(pairs);
}

function consentBinding(
  record: Readonly<Record<string, unknown>>,
  accountId: ReadFeeAwareAllocationInputsRequest['accountId'],
  approvalReferenceId: string,
): Readonly<{
  accountId: ReadFeeAwareAllocationInputsRequest['accountId'];
  approvalReferenceId: string;
  consentReferenceId: string;
  grantedAt: ParsedTimestamp;
  expiresAt: ParsedTimestamp;
  approvedWalletIds: readonly string[];
  approvedDirectedNetworkPairs: readonly ApprovedCrossChainNetworkPair[];
}> {
  const consentApprovalReferenceId = reference(record.approvalReferenceId);
  const grantedAt = timestamp(record.grantedAt);
  const expiresAt = timestamp(record.expiresAt);
  if (
    record.accountId !== accountId ||
    consentApprovalReferenceId !== approvalReferenceId ||
    expiresAt.milliseconds <= grantedAt.milliseconds
  ) {
    return unavailable();
  }
  return Object.freeze({
    accountId,
    approvalReferenceId,
    consentReferenceId: reference(record.consentReferenceId),
    grantedAt,
    expiresAt,
    approvedWalletIds: parseApprovedWalletIds(record.approvedWalletIds),
    approvedDirectedNetworkPairs: parseApprovedNetworkPairs(record.approvedDirectedNetworkPairs),
  });
}

function parseConsiderationConsent(
  value: unknown,
  optIn: FeeAwareCrossChainOptIn | null,
  accountId: ReadFeeAwareAllocationInputsRequest['accountId'],
  approvalReferenceId: string,
): CrossChainConsiderationConsent | null {
  if (value === null) {
    if (optIn !== null) return unavailable();
    return null;
  }
  if (optIn === null) return unavailable();
  const record = ownDataRecord(value, [
    'scope',
    'accountId',
    'approvalReferenceId',
    'consentReferenceId',
    'grantedAt',
    'expiresAt',
    'approvedWalletIds',
    'approvedDirectedNetworkPairs',
  ]);
  if (record.scope !== 'CONSIDER_CROSS_CHAIN_RECOMMENDATIONS') return unavailable();
  const binding = consentBinding(record, accountId, approvalReferenceId);
  if (
    binding.consentReferenceId !== optIn.consentReferenceId ||
    binding.grantedAt.text !== optIn.grantedAt ||
    binding.expiresAt.text !== optIn.expiresAt
  ) {
    return unavailable();
  }
  return Object.freeze({
    scope: 'CONSIDER_CROSS_CHAIN_RECOMMENDATIONS' as const,
    accountId: binding.accountId,
    approvalReferenceId: binding.approvalReferenceId,
    consentReferenceId: binding.consentReferenceId,
    grantedAt: binding.grantedAt.text,
    expiresAt: binding.expiresAt.text,
    approvedWalletIds: binding.approvedWalletIds,
    approvedDirectedNetworkPairs: binding.approvedDirectedNetworkPairs,
  });
}

function parseDisclosureConsent(
  value: unknown,
  accountId: ReadFeeAwareAllocationInputsRequest['accountId'],
  approvalReferenceId: string,
): CrossChainQuoteDisclosureConsent | null {
  if (value === null) return null;
  const record = ownDataRecord(value, [
    'scope',
    'providerId',
    'accountId',
    'approvalReferenceId',
    'consentReferenceId',
    'grantedAt',
    'expiresAt',
    'approvedWalletIds',
    'approvedDirectedNetworkPairs',
  ]);
  if (
    record.scope !== 'DISCLOSE_WALLET_ADDRESSES_FOR_CROSS_CHAIN_QUOTE' ||
    record.providerId !== 'lifi'
  ) {
    return unavailable();
  }
  const binding = consentBinding(record, accountId, approvalReferenceId);
  return Object.freeze({
    scope: 'DISCLOSE_WALLET_ADDRESSES_FOR_CROSS_CHAIN_QUOTE' as const,
    providerId: 'lifi' as const,
    accountId: binding.accountId,
    approvalReferenceId: binding.approvalReferenceId,
    consentReferenceId: binding.consentReferenceId,
    grantedAt: binding.grantedAt.text,
    expiresAt: binding.expiresAt.text,
    approvedWalletIds: binding.approvedWalletIds,
    approvedDirectedNetworkPairs: binding.approvedDirectedNetworkPairs,
  });
}

function activeThrough(
  value: { readonly grantedAt: string; readonly expiresAt: string } | null,
  evaluatedAtMilliseconds: number,
  deadlineMilliseconds: number,
): boolean {
  return (
    value !== null &&
    Date.parse(value.grantedAt) <= evaluatedAtMilliseconds &&
    deadlineMilliseconds < Date.parse(value.expiresAt)
  );
}

function parsePolicySnapshot(
  value: unknown,
  request: ReadFeeAwareAllocationInputsRequest,
  deadline: ParsedTimestamp,
): ParsedPolicy {
  const record = ownDataRecord(value, [
    'schemaVersion',
    'use',
    'accountId',
    'correlationId',
    'evaluatedAt',
    'policyReferenceId',
    'approvalReferenceId',
    'effectiveFrom',
    'effectiveUntil',
    'holdingPeriodDays',
    'maximumQuoteAgeSeconds',
    'maximumOpportunityAgeSeconds',
    'minimumNetBenefitUsdMantissa',
    'crossChainPolicy',
    'exposurePolicy',
    'maximumCandidateCount',
    'crossChainConsiderationConsent',
    'crossChainQuoteDisclosureConsent',
  ]);
  if (
    record.schemaVersion !== 1 ||
    record.use !== 'APPROVED_SMART_LENDING_RECOMMENDATION_POLICY' ||
    record.accountId !== request.accountId ||
    record.correlationId !== request.correlationId ||
    record.evaluatedAt !== request.evaluatedAt
  ) {
    return unavailable();
  }
  const evaluatedAt = timestamp(request.evaluatedAt);
  const effectiveFrom = timestamp(record.effectiveFrom);
  const effectiveUntil = timestamp(record.effectiveUntil);
  if (
    effectiveFrom.milliseconds > evaluatedAt.milliseconds ||
    evaluatedAt.milliseconds >= effectiveUntil.milliseconds ||
    deadline.milliseconds >= effectiveUntil.milliseconds ||
    typeof record.maximumCandidateCount !== 'number' ||
    !Number.isSafeInteger(record.maximumCandidateCount) ||
    record.maximumCandidateCount < 1 ||
    record.maximumCandidateCount > MAX_COMPOSED_FEE_AWARE_CANDIDATES
  ) {
    return unavailable();
  }
  const policyReferenceId = reference(record.policyReferenceId);
  const approvalReferenceId = reference(record.approvalReferenceId);
  const crossChainPolicy = parseCrossChainPolicy(record.crossChainPolicy);
  const consideration = parseConsiderationConsent(
    record.crossChainConsiderationConsent,
    crossChainPolicy.optIn,
    request.accountId,
    approvalReferenceId,
  );
  const disclosure = parseDisclosureConsent(
    record.crossChainQuoteDisclosureConsent,
    request.accountId,
    approvalReferenceId,
  );
  return Object.freeze({
    schemaVersion: 1 as const,
    use: 'APPROVED_SMART_LENDING_RECOMMENDATION_POLICY' as const,
    accountId: request.accountId,
    correlationId: request.correlationId,
    evaluatedAt: request.evaluatedAt,
    policyReferenceId,
    approvalReferenceId,
    effectiveFrom: effectiveFrom.text,
    effectiveUntil: effectiveUntil.text,
    holdingPeriodDays: positiveBigInt(record.holdingPeriodDays, MAX_HOLDING_PERIOD_DAYS),
    maximumQuoteAgeSeconds: positiveBigInt(record.maximumQuoteAgeSeconds, MAX_FRESHNESS_SECONDS),
    maximumOpportunityAgeSeconds: positiveBigInt(
      record.maximumOpportunityAgeSeconds,
      MAX_FRESHNESS_SECONDS,
    ),
    minimumNetBenefitUsdMantissa: unsignedBigInt(record.minimumNetBenefitUsdMantissa),
    crossChainPolicy,
    exposurePolicy: parseExposurePolicy(record.exposurePolicy),
    maximumCandidateCount: record.maximumCandidateCount,
    crossChainConsiderationConsent: consideration,
    crossChainQuoteDisclosureConsent: disclosure,
    evaluatedAtMilliseconds: evaluatedAt.milliseconds,
  });
}

function domainPosition(position: RoutableCapitalPosition): FeeAwareCapitalPosition {
  return Object.freeze({
    positionId: position.positionId,
    walletId: position.walletId,
    networkId: position.networkId,
    assetId: position.assetId,
    amountAtomic: position.amountAtomic,
    amountUsdMantissa: position.amountUsdMantissa,
  });
}

function domainOpportunity(opportunity: ApprovedLendingOpportunity): FeeAwareLendingOpportunity {
  return Object.freeze({
    opportunityId: opportunity.opportunityId,
    providerId: opportunity.providerId,
    networkId: opportunity.networkId,
    assetId: opportunity.assetId,
    availability: opportunity.availability,
    recommendationEligibility: opportunity.recommendationEligibility,
    grossApyBasisPoints: opportunity.grossApyBasisPoints,
    recurringFeeBasisPoints: opportunity.recurringFeeBasisPoints,
    availableCapacityUsdMantissa: opportunity.availableCapacityUsdMantissa,
    evidence: opportunity.evidence,
    riskAssessment: opportunity.riskAssessment,
  });
}

function potentiallyEligible(
  position: RoutableCapitalPosition,
  opportunity: ApprovedLendingOpportunity,
  policy: ParsedPolicy,
  deadline: ParsedTimestamp,
): boolean {
  const evidenceObservedAt = Date.parse(opportunity.evidence.observedAt);
  const evidenceValidUntil = Date.parse(opportunity.evidence.validUntil);
  const riskAssessedAt =
    opportunity.riskAssessment === null
      ? Number.NaN
      : Date.parse(opportunity.riskAssessment.assessedAt);
  const riskValidUntil =
    opportunity.riskAssessment === null
      ? Number.NaN
      : Date.parse(opportunity.riskAssessment.validUntil);
  return (
    position.assetSymbol === opportunity.assetSymbol &&
    opportunity.availability === 'AVAILABLE' &&
    opportunity.recommendationEligibility === 'ELIGIBLE' &&
    opportunity.riskAssessment !== null &&
    position.amountUsdMantissa <= opportunity.availableCapacityUsdMantissa &&
    evidenceObservedAt <= policy.evaluatedAtMilliseconds &&
    deadline.milliseconds < evidenceValidUntil &&
    BigInt(deadline.milliseconds - evidenceObservedAt) <
      policy.maximumOpportunityAgeSeconds * 1_000n &&
    riskAssessedAt <= policy.evaluatedAtMilliseconds &&
    deadline.milliseconds < riskValidUntil &&
    BigInt(deadline.milliseconds - riskAssessedAt) < policy.maximumOpportunityAgeSeconds * 1_000n
  );
}

function candidateId(positionId: string, opportunityId: string): string {
  return `candidate:${createHash('sha256')
    .update(JSON.stringify([positionId, opportunityId]), 'utf8')
    .digest('hex')}`;
}

function sourceWallet(position: RoutableCapitalPosition): LifecycleQuoteWalletEndpoint {
  return Object.freeze({
    walletId: position.walletId,
    networkId: position.networkId,
    walletAddress: position.walletAddress,
    selectionReferenceId: null,
  });
}

function consentCoversRoute(
  consent: CrossChainConsiderationConsent | CrossChainQuoteDisclosureConsent | null,
  position: RoutableCapitalPosition,
  destination: LifecycleQuoteWalletEndpoint,
  evaluatedAtMilliseconds: number,
  deadlineMilliseconds: number,
): boolean {
  return (
    consent !== null &&
    activeThrough(consent, evaluatedAtMilliseconds, deadlineMilliseconds) &&
    consent.approvedWalletIds.includes(position.walletId) &&
    consent.approvedWalletIds.includes(destination.walletId) &&
    consent.approvedDirectedNetworkPairs.some(
      (pair) =>
        pair.sourceNetworkId === position.networkId &&
        pair.destinationNetworkId === destination.networkId,
    )
  );
}

function crossChainPlans(
  positions: readonly RoutableCapitalPosition[],
  opportunities: readonly ApprovedLendingOpportunity[],
  destinations: ReadonlyMap<MainnetLaunchNetworkId, SmartLendingDestinationWallet>,
  policy: ParsedPolicy,
  deadline: ParsedTimestamp,
): readonly CandidatePlan[] {
  const plans: CandidatePlan[] = [];
  for (const position of positions) {
    const eligible = opportunities.filter((opportunity) =>
      potentiallyEligible(position, opportunity, policy, deadline),
    );
    const sameChain = eligible.filter(
      (opportunity) => opportunity.networkId === position.networkId,
    );
    for (const opportunity of sameChain) {
      plans.push({
        candidateId: candidateId(position.positionId, opportunity.opportunityId),
        position,
        opportunity,
        destinationWallet: sourceWallet(position),
      });
    }
    if (sameChain.length === 0 || policy.crossChainPolicy.allowedBridgeProviderIds.length === 0) {
      continue;
    }
    for (const opportunity of eligible.filter(
      (candidate) => candidate.networkId !== position.networkId,
    )) {
      const destination = destinations.get(opportunity.networkId);
      if (!destination) continue;
      if (
        !consentCoversRoute(
          policy.crossChainConsiderationConsent,
          position,
          destination,
          policy.evaluatedAtMilliseconds,
          deadline.milliseconds,
        ) ||
        !consentCoversRoute(
          policy.crossChainQuoteDisclosureConsent,
          position,
          destination,
          policy.evaluatedAtMilliseconds,
          deadline.milliseconds,
        )
      ) {
        continue;
      }
      plans.push({
        candidateId: candidateId(position.positionId, opportunity.opportunityId),
        position,
        opportunity,
        destinationWallet: Object.freeze({ ...destination }),
      });
    }
  }
  plans.sort(
    (left, right) =>
      ordinalCompare(left.position.positionId, right.position.positionId) ||
      Number(left.position.networkId !== left.opportunity.networkId) -
        Number(right.position.networkId !== right.opportunity.networkId) ||
      ordinalCompare(left.opportunity.opportunityId, right.opportunity.opportunityId),
  );
  return Object.freeze(plans);
}

type QuoteRequestFingerprintMaterial = Omit<
  ReadFullLifecycleCostQuoteRequest,
  'requestFingerprintSha256' | 'signal'
>;

function quoteRequestFingerprint(value: QuoteRequestFingerprintMaterial): string {
  const position = value.position;
  const opportunity = value.opportunity;
  const risk = opportunity.riskAssessment;
  return createHash('sha256')
    .update(
      JSON.stringify([
        'crypto-lending:full-lifecycle-cost-quote-request:v1',
        value.accountId,
        value.correlationId,
        value.evaluatedAt,
        value.deadlineAt,
        value.policyReferenceId,
        value.policyApprovalReferenceId,
        [
          position.positionId,
          position.walletId,
          position.networkId,
          position.assetId,
          position.assetSymbol,
          position.assetDecimals,
          position.walletAddress,
          position.amountAtomic.toString(),
          position.amountUsdMantissa.toString(),
        ],
        [
          opportunity.opportunityId,
          opportunity.providerId,
          opportunity.protocolId,
          opportunity.marketId,
          opportunity.networkId,
          opportunity.assetId,
          opportunity.assetSymbol,
          opportunity.assetDecimals,
          opportunity.availability,
          opportunity.recommendationEligibility,
          opportunity.grossApyBasisPoints.toString(),
          opportunity.recurringFeeBasisPoints.toString(),
          opportunity.availableCapacityUsdMantissa.toString(),
          [
            opportunity.evidence.evidenceReferenceId,
            opportunity.evidence.adapterId,
            opportunity.evidence.observedAt,
            opportunity.evidence.validUntil,
          ],
          risk === null
            ? null
            : [
                risk.status,
                risk.assessmentReferenceId,
                risk.assessedAt,
                risk.validUntil,
                risk.penaltyBasisPoints.toString(),
              ],
        ],
        [
          value.destinationWallet.walletId,
          value.destinationWallet.networkId,
          value.destinationWallet.walletAddress,
          value.destinationWallet.selectionReferenceId,
        ],
        [...value.allowedBridgeProviderIds],
        value.crossChainConsiderationConsentReferenceId,
        value.crossChainQuoteDisclosureConsentReferenceId,
      ]),
      'utf8',
    )
    .digest('hex');
}

async function readBeforeDeadline<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  if (signal.aborted) return unavailable();
  let abort: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new FeeAwareAllocationInputUnavailableError());
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([read(), deadline]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

function parseCosts(value: unknown): FeeAwareAllocationCostsUsdMantissa {
  const record = ownDataRecord(value, FEE_AWARE_ALLOCATION_COST_KINDS);
  const result = Object.create(null) as Record<
    (typeof FEE_AWARE_ALLOCATION_COST_KINDS)[number],
    bigint
  >;
  for (const kind of FEE_AWARE_ALLOCATION_COST_KINDS) {
    result[kind] = unsignedBigInt(record[kind]);
  }
  return Object.freeze(result);
}

function parseBridge(
  value: unknown,
  quote: {
    readonly sourceAmountAtomic: bigint;
    readonly minimumDestinationAmountAtomic: bigint;
  },
  allowedProviders: ReadonlySet<string>,
): FeeAwareRouteCostQuote['bridge'] {
  if (value === null) return null;
  const record = ownDataRecord(value, [
    'entryBridgeProviderId',
    'exitBridgeProviderId',
    'entryEstimateReferenceId',
    'exitEstimateReferenceId',
    'entryMinimumOutputAtomic',
    'exitMinimumOutputAtomic',
  ]);
  const entryProvider = reference(record.entryBridgeProviderId);
  const exitProvider = reference(record.exitBridgeProviderId);
  const entryMinimum = positiveBigInt(record.entryMinimumOutputAtomic);
  const exitMinimum = positiveBigInt(record.exitMinimumOutputAtomic);
  if (
    !allowedProviders.has(entryProvider) ||
    !allowedProviders.has(exitProvider) ||
    entryMinimum !== quote.minimumDestinationAmountAtomic ||
    entryMinimum > quote.sourceAmountAtomic ||
    exitMinimum > entryMinimum
  ) {
    return unavailable();
  }
  return Object.freeze({
    entryBridgeProviderId: entryProvider,
    exitBridgeProviderId: exitProvider,
    entryEstimateReferenceId: reference(record.entryEstimateReferenceId),
    exitEstimateReferenceId: reference(record.exitEstimateReferenceId),
    entryMinimumOutputAtomic: entryMinimum,
    exitMinimumOutputAtomic: exitMinimum,
  });
}

function parseQuoteResult(
  value: unknown,
  request: ReadFullLifecycleCostQuoteRequest,
  policy: ParsedPolicy,
  plan: CandidatePlan,
): FeeAwareRouteCostQuote {
  const envelope = ownDataRecord(value, [
    'schemaVersion',
    'use',
    'accountId',
    'correlationId',
    'evaluatedAt',
    'policyReferenceId',
    'requestFingerprintSha256',
    'quote',
  ]);
  if (
    envelope.schemaVersion !== 1 ||
    envelope.use !== 'FULL_LIFECYCLE_COST_QUOTE' ||
    envelope.accountId !== request.accountId ||
    envelope.correlationId !== request.correlationId ||
    envelope.evaluatedAt !== request.evaluatedAt ||
    envelope.policyReferenceId !== policy.policyReferenceId ||
    envelope.requestFingerprintSha256 !== request.requestFingerprintSha256
  ) {
    return unavailable();
  }
  const record = ownDataRecord(envelope.quote, [
    'quoteReferenceId',
    'routeReferenceId',
    'positionId',
    'opportunityId',
    'verifiedByAdapterId',
    'quotedAt',
    'validUntil',
    'sourceNetworkId',
    'destinationNetworkId',
    'sourceAssetId',
    'destinationAssetId',
    'sourceAmountAtomic',
    'minimumDestinationAmountAtomic',
    'costsUsdMantissa',
    'bridge',
  ]);
  const quotedAt = timestamp(record.quotedAt);
  const validUntil = timestamp(record.validUntil);
  const deadline = timestamp(request.deadlineAt);
  const sourceAmountAtomic = positiveBigInt(record.sourceAmountAtomic);
  const minimumDestinationAmountAtomic = positiveBigInt(record.minimumDestinationAmountAtomic);
  if (
    record.positionId !== plan.position.positionId ||
    record.opportunityId !== plan.opportunity.opportunityId ||
    record.sourceNetworkId !== plan.position.networkId ||
    record.destinationNetworkId !== plan.opportunity.networkId ||
    record.sourceAssetId !== plan.position.assetId ||
    record.destinationAssetId !== plan.opportunity.assetId ||
    sourceAmountAtomic !== plan.position.amountAtomic ||
    minimumDestinationAmountAtomic > sourceAmountAtomic ||
    quotedAt.milliseconds > policy.evaluatedAtMilliseconds ||
    deadline.milliseconds >= validUntil.milliseconds ||
    BigInt(deadline.milliseconds - quotedAt.milliseconds) >= policy.maximumQuoteAgeSeconds * 1_000n
  ) {
    return unavailable();
  }
  const crossChain = plan.position.networkId !== plan.opportunity.networkId;
  const costs = parseCosts(record.costsUsdMantissa);
  const bridge = parseBridge(
    record.bridge,
    { sourceAmountAtomic, minimumDestinationAmountAtomic },
    new Set(policy.crossChainPolicy.allowedBridgeProviderIds),
  );
  if (
    (crossChain && bridge === null) ||
    (!crossChain && bridge !== null) ||
    (!crossChain && (costs.entryBridge !== 0n || costs.exitBridge !== 0n))
  ) {
    return unavailable();
  }
  return Object.freeze({
    quoteReferenceId: reference(record.quoteReferenceId),
    routeReferenceId: reference(record.routeReferenceId),
    positionId: plan.position.positionId,
    opportunityId: plan.opportunity.opportunityId,
    verifiedByAdapterId: reference(record.verifiedByAdapterId),
    quotedAt: quotedAt.text,
    validUntil: validUntil.text,
    sourceNetworkId: plan.position.networkId,
    destinationNetworkId: plan.opportunity.networkId,
    sourceAssetId: plan.position.assetId,
    destinationAssetId: plan.opportunity.assetId,
    sourceAmountAtomic,
    minimumDestinationAmountAtomic,
    costsUsdMantissa: costs,
    bridge,
  });
}

@Injectable()
export class ComposedFeeAwareAllocationInputReader implements FeeAwareAllocationInputReader {
  constructor(
    @Inject(ROUTABLE_CAPITAL_POSITION_SNAPSHOT_READER)
    private readonly capital: RoutableCapitalPositionSnapshotReader,
    @Inject(APPROVED_LENDING_OPPORTUNITY_SNAPSHOT_READER)
    private readonly opportunities: ApprovedLendingOpportunitySnapshotReader,
    @Inject(APPROVED_SMART_LENDING_POLICY_READER)
    private readonly policy: ApprovedSmartLendingPolicyReader,
    @Inject(FULL_LIFECYCLE_COST_QUOTE_READER)
    private readonly quotes: FullLifecycleCostQuoteReader,
  ) {}

  async read(requestValue: ReadFeeAwareAllocationInputsRequest): Promise<FeeAwareAllocationInputs> {
    try {
      const evaluatedAt = timestamp(requestValue.evaluatedAt);
      const deadline = aggregateQuoteDeadline(evaluatedAt);
      const controller = new AbortController();
      const request = Object.freeze({
        accountId: parseAccountId(requestValue.accountId),
        correlationId: correlationId(requestValue.correlationId),
        evaluatedAt: evaluatedAt.text,
        deadlineAt: deadline.text,
        signal: controller.signal,
      });
      const timeout = setTimeout(
        () => controller.abort(),
        COMPOSED_FEE_AWARE_QUOTE_DEADLINE_MILLISECONDS,
      );
      try {
        const [capitalValue, opportunityValue, policyValue] = await readBeforeDeadline(
          controller.signal,
          () =>
            Promise.all([
              this.capital.readRoutableCapitalPositions(request),
              this.opportunities.readApprovedLendingOpportunities(request),
              this.policy.readApprovedSmartLendingPolicy(request),
            ]),
        );
        if (controller.signal.aborted) return unavailable();
        const capital = parsePositionSnapshot(capitalValue, request, deadline);
        const opportunities = parseOpportunitySnapshot(opportunityValue, request, deadline);
        const policy = parsePolicySnapshot(policyValue, request, deadline);
        const destinations = new Map(
          capital.destinationWallets.map((wallet) => [wallet.networkId, wallet]),
        );
        const plans = crossChainPlans(
          capital.positions,
          opportunities.opportunities,
          destinations,
          policy,
          deadline,
        );
        if (plans.length > policy.maximumCandidateCount) return unavailable();

        const candidates: FeeAwareAllocationCandidate[] = [];
        for (const plan of plans) {
          if (controller.signal.aborted) return unavailable();
          const crossChain = plan.position.networkId !== plan.opportunity.networkId;
          const material: QuoteRequestFingerprintMaterial = Object.freeze({
            accountId: request.accountId,
            correlationId: request.correlationId,
            evaluatedAt: request.evaluatedAt,
            deadlineAt: request.deadlineAt,
            policyReferenceId: policy.policyReferenceId,
            policyApprovalReferenceId: policy.approvalReferenceId,
            position: plan.position,
            opportunity: plan.opportunity,
            destinationWallet: plan.destinationWallet,
            allowedBridgeProviderIds: policy.crossChainPolicy.allowedBridgeProviderIds,
            crossChainConsiderationConsentReferenceId: crossChain
              ? (policy.crossChainConsiderationConsent?.consentReferenceId ?? null)
              : null,
            crossChainQuoteDisclosureConsentReferenceId: crossChain
              ? (policy.crossChainQuoteDisclosureConsent?.consentReferenceId ?? null)
              : null,
          });
          const quoteRequest: ReadFullLifecycleCostQuoteRequest = Object.freeze({
            ...material,
            signal: request.signal,
            requestFingerprintSha256: quoteRequestFingerprint(material),
          });
          const result = await readBeforeDeadline(controller.signal, () =>
            this.quotes.readFullLifecycleCostQuote(quoteRequest),
          );
          if (controller.signal.aborted) return unavailable();
          candidates.push(
            Object.freeze({
              candidateId: plan.candidateId,
              positionId: plan.position.positionId,
              opportunityId: plan.opportunity.opportunityId,
              costQuote: parseQuoteResult(result, quoteRequest, policy, plan),
            }),
          );
        }
        if (controller.signal.aborted) return unavailable();
        return Object.freeze({
          holdingPeriodDays: policy.holdingPeriodDays,
          maximumQuoteAgeSeconds: policy.maximumQuoteAgeSeconds,
          maximumOpportunityAgeSeconds: policy.maximumOpportunityAgeSeconds,
          minimumNetBenefitUsdMantissa: policy.minimumNetBenefitUsdMantissa,
          crossChainPolicy: policy.crossChainPolicy,
          exposurePolicy: policy.exposurePolicy,
          positions: Object.freeze(capital.positions.map(domainPosition)),
          opportunities: Object.freeze(opportunities.opportunities.map(domainOpportunity)),
          candidates: Object.freeze(candidates),
        });
      } finally {
        try {
          controller.abort();
        } finally {
          clearTimeout(timeout);
        }
      }
    } catch {
      return unavailable();
    }
  }
}
