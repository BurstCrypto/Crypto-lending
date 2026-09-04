import { createHash } from 'node:crypto';

import { parseAccountId, type AccountId } from '../../accounts/domain/account-profile';
import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';
import type { ActivePortfolioWalletRegistration } from '../../portfolio/application/ports/portfolio-wallet-registration-reader.port';
import type { PortfolioWalletRegistrationReader } from '../../portfolio/application/ports/portfolio-wallet-registration-reader.port';
import { parseActivePortfolioWalletRegistrations } from '../../portfolio/domain/active-portfolio-wallet-registrations';
import {
  MAINNET_PROVIDER_POSITION_COVERAGE_ONLY,
  MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
  mainnetProviderPositionCoverageManifestFingerprintV1,
  parseMainnetProviderPositionCoverageManifestV1,
  type MainnetProviderPositionCoverageManifestV1,
} from '../domain/mainnet-provider-position-coverage';
import { mainnetProviderPositionDecimalFromAtomic } from '../domain/mainnet-provider-position-observation';
import {
  mainnetProviderPositionPolicyAllowsMarket,
  mainnetProviderPositionPolicyAllowsSource,
  parseMainnetProviderPositionObservationPolicyV1,
  type MainnetProviderPositionObservationPolicyV1,
  type MainnetProviderPositionSourceKind,
} from '../domain/mainnet-provider-position-observation-policy';

const CORRELATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const SAFE_FAMILY_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const COVERAGE_SLUG = /^[a-z0-9][a-z0-9._:-]{1,127}$/u;
const SAFE_OPAQUE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,190}[A-Za-z0-9])?$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const EVM_BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_SOURCE_READS = 512;
const MAX_POSITIONS_PER_TARGET = 512;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_RESPONSE_NODES = 4_096;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const MAX_CONCURRENCY = 8;

export const PROVIDER_POSITION_ADMISSION_VERSION = 1 as const;
export const PROVIDER_POSITION_ADMISSION_SOURCE_USE =
  'DORMANT_PROVIDER_POSITION_TARGET_EVIDENCE_ONLY' as const;
export const PROVIDER_POSITION_ADMISSION_CANDIDATE_USE =
  'DORMANT_PROVIDER_POSITION_ASSEMBLY_CANDIDATE_ONLY' as const;

export interface ProviderPositionAdmissionClock {
  now(): Date;
}

export interface ProviderPositionAdmissionDeadlineRunRequestV1 {
  readonly deadlineAt: string;
  readonly correlationId: string;
  readonly sourceFamilyId: string;
  readonly targetId: string;
  readonly signal: AbortSignal;
}

/** Injected deadline enforcement; the coordinator owns no ambient timer. */
export interface ProviderPositionAdmissionDeadlineRunner {
  run<T>(
    request: ProviderPositionAdmissionDeadlineRunRequestV1,
    operation: () => Promise<T>,
  ): Promise<T>;
}

export interface ProviderPositionAdmissionAssetV1 {
  readonly stablecoin: SupportedStablecoin;
  readonly networkId: string;
  readonly identity: string;
  readonly decimals: number;
}

export interface ProviderPositionAdmissionBalanceV1 {
  readonly atomic: string;
  readonly decimal: string;
}

export interface ProviderPositionAdmissionEvmAnchorV1 {
  readonly kind: 'EVM_BLOCK';
  readonly blockNumber: string;
  readonly blockHash: string;
}

export interface ProviderPositionAdmissionSolanaAnchorV1 {
  readonly kind: 'SOLANA_SLOT';
  readonly slot: string;
  readonly root: string;
}

export type ProviderPositionAdmissionChainAnchorV1 =
  ProviderPositionAdmissionEvmAnchorV1 | ProviderPositionAdmissionSolanaAnchorV1;

export interface ProviderPositionAdmissionPositionV1 {
  readonly positionId: string;
  readonly positionKind: 'SUPPLY' | 'BORROW';
  readonly asset: ProviderPositionAdmissionAssetV1;
  readonly balance: ProviderPositionAdmissionBalanceV1;
}

export interface ReadProviderPositionAdmissionTargetRequestV1 {
  readonly admissionVersion: typeof PROVIDER_POSITION_ADMISSION_VERSION;
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly deadlineAt: string;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly walletId: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly networkId: string;
  readonly assets: readonly ProviderPositionAdmissionAssetV1[];
}

export interface ProviderPositionAdmissionSourcePort {
  /**
   * Returns a complete account-scoped target observation. Implementations own
   * transport enforcement and must derive continuityFloor from durable state,
   * not from the same stateless response that supplies chainAnchor.
   */
  readTarget(request: ReadProviderPositionAdmissionTargetRequestV1): Promise<unknown>;
}

export interface ProviderPositionAdmissionSourceBinding {
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly networkId: string;
  readonly source: ProviderPositionAdmissionSourcePort;
}

export interface ProviderPositionAdmissionSourceEvidenceV1 {
  readonly evidenceVersion: typeof PROVIDER_POSITION_ADMISSION_VERSION;
  readonly use: typeof PROVIDER_POSITION_ADMISSION_SOURCE_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceObservationId: string;
  readonly walletId: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly networkId: string;
  readonly assets: readonly ProviderPositionAdmissionAssetV1[];
  readonly status: 'COMPLETE';
  readonly observedAt: string;
  readonly staleAfter: string;
  readonly continuityFloor: ProviderPositionAdmissionChainAnchorV1;
  readonly chainAnchor: ProviderPositionAdmissionChainAnchorV1;
  readonly positions: readonly ProviderPositionAdmissionPositionV1[];
}

export interface ProviderPositionAdmissionAcceptedSourceV1 {
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceObservationId: string;
  readonly observedAt: string;
  readonly staleAfter: string;
  readonly continuityFloor: ProviderPositionAdmissionChainAnchorV1;
  readonly chainAnchor: ProviderPositionAdmissionChainAnchorV1;
  readonly positionSetFingerprintSha256: string;
}

export interface ProviderPositionAdmissionTargetCandidateV1 {
  readonly targetId: string;
  readonly walletId: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly networkId: string;
  readonly assets: readonly ProviderPositionAdmissionAssetV1[];
  readonly status: 'COMPLETE';
  readonly divergenceStatus: 'AGREED';
  readonly observedAt: string;
  readonly staleAfter: string;
  readonly positions: readonly ProviderPositionAdmissionPositionV1[];
  readonly acceptedSources: readonly ProviderPositionAdmissionAcceptedSourceV1[];
}

export interface ProviderPositionAdmissionAssemblyCandidateV1 {
  readonly admissionVersion: typeof PROVIDER_POSITION_ADMISSION_VERSION;
  readonly use: typeof PROVIDER_POSITION_ADMISSION_CANDIDATE_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly mayCreatePositionSnapshot: false;
  readonly assemblyStatus: 'BLOCKED_PENDING_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY';
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly positionSnapshotId: string;
  readonly observationPolicyVersion: 1;
  readonly observationPolicyId: string;
  readonly observationPolicyFingerprintSha256: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly capturedAt: string;
  readonly staleAfter: string;
  readonly freshnessClass: 'CURRENT';
  readonly targets: readonly ProviderPositionAdmissionTargetCandidateV1[];
  readonly coverageManifest: MainnetProviderPositionCoverageManifestV1;
  readonly candidateFingerprintSha256: string;
}

export interface ReadProviderPositionAdmissionRequestV1 {
  readonly accountId: AccountId;
  readonly correlationId: string;
}

export interface ProviderPositionAdmissionOptions {
  readonly deadlineMilliseconds: number;
  readonly maximumConcurrency: number;
}

export type ProviderPositionAdmissionFailureCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'POLICY_UNAVAILABLE'
  | 'WALLET_ROSTER_UNAVAILABLE'
  | 'INSUFFICIENT_INDEPENDENT_SOURCES'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_MISMATCH'
  | 'INCOMPLETE_COVERAGE'
  | 'STALE_EVIDENCE'
  | 'REGRESSING_EVIDENCE'
  | 'DIVERGENT_EVIDENCE'
  | 'LIMIT_EXCEEDED'
  | 'ASSEMBLY_UNAVAILABLE';

export class ProviderPositionAdmissionUnavailableError extends Error {
  constructor(readonly code: ProviderPositionAdmissionFailureCode) {
    super('Provider-position admission is unavailable.');
    this.name = 'ProviderPositionAdmissionUnavailableError';
  }
}

interface ExpectedTarget {
  readonly targetId: string;
  readonly walletId: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly networkId: string;
  readonly assets: readonly ProviderPositionAdmissionAssetV1[];
}

interface ReadJob {
  readonly target: ExpectedTarget;
  readonly binding: ProviderPositionAdmissionSourceBinding;
}

function fail(code: ProviderPositionAdmissionFailureCode): never {
  throw new ProviderPositionAdmissionUnavailableError(code);
}

export class DormantProviderPositionAdmissionCoordinator {
  private readonly policy!: MainnetProviderPositionObservationPolicyV1;
  private readonly bindings!: readonly ProviderPositionAdmissionSourceBinding[];
  private readonly options!: Readonly<ProviderPositionAdmissionOptions>;

  constructor(
    policyInput: unknown,
    requiredPolicyFingerprintSha256: string,
    sourceBindings: readonly ProviderPositionAdmissionSourceBinding[],
    private readonly walletReader: PortfolioWalletRegistrationReader,
    private readonly clock: ProviderPositionAdmissionClock,
    private readonly deadlineRunner: ProviderPositionAdmissionDeadlineRunner,
    options: ProviderPositionAdmissionOptions,
  ) {
    try {
      this.policy = parseMainnetProviderPositionObservationPolicyV1(policyInput);
      if (
        requiredPolicyFingerprintSha256 !== this.policy.fingerprintSha256 ||
        !Array.isArray(sourceBindings) ||
        Object.getPrototypeOf(sourceBindings) !== Array.prototype ||
        !Number.isSafeInteger(options.deadlineMilliseconds) ||
        options.deadlineMilliseconds < 1 ||
        options.deadlineMilliseconds > MAX_DEADLINE_MILLISECONDS ||
        !Number.isSafeInteger(options.maximumConcurrency) ||
        options.maximumConcurrency < 1 ||
        options.maximumConcurrency > MAX_CONCURRENCY ||
        typeof walletReader?.readActiveWalletRegistrations !== 'function' ||
        typeof clock?.now !== 'function' ||
        typeof deadlineRunner?.run !== 'function'
      ) {
        return fail('INVALID_CONFIGURATION');
      }
      this.bindings = normalizeBindings(sourceBindings, this.policy);
      this.options = Object.freeze({ ...options });
    } catch (error) {
      if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
      return fail('INVALID_CONFIGURATION');
    }
  }

  async admit(
    requestInput: ReadProviderPositionAdmissionRequestV1,
  ): Promise<ProviderPositionAdmissionAssemblyCandidateV1> {
    try {
      const request = parseRequest(requestInput);
      const started = canonicalClock(this.clock.now());
      const deadlineMilliseconds = started.milliseconds + this.options.deadlineMilliseconds;
      if (!Number.isSafeInteger(deadlineMilliseconds)) return fail('INVALID_CONFIGURATION');
      const deadlineAt = new Date(deadlineMilliseconds).toISOString();
      let wallets: readonly ActivePortfolioWalletRegistration[];
      try {
        wallets = parseActivePortfolioWalletRegistrations(
          await this.walletReader.readActiveWalletRegistrations({
            accountId: request.accountId,
            evaluatedAt: started.timestamp,
            correlationId: request.correlationId,
          }),
        );
      } catch {
        return fail('WALLET_ROSTER_UNAVAILABLE');
      }
      if (canonicalClock(this.clock.now()).milliseconds >= deadlineMilliseconds) {
        return fail('SOURCE_UNAVAILABLE');
      }

      const targets = expectedTargets(wallets, this.policy);
      const jobs = createJobs(targets, this.bindings);
      if (jobs.length > MAX_SOURCE_READS) return fail('LIMIT_EXCEEDED');
      const controller = new AbortController();
      let evidence: readonly ProviderPositionAdmissionSourceEvidenceV1[];
      try {
        evidence = await runBounded(jobs, this.options.maximumConcurrency, async (job) =>
          this.deadlineRunner.run(
            {
              deadlineAt,
              correlationId: request.correlationId,
              sourceFamilyId: job.binding.sourceFamilyId,
              targetId: job.target.targetId,
              signal: controller.signal,
            },
            async () =>
              parseSourceEvidence(
                await job.binding.source.readTarget(
                  Object.freeze({
                    admissionVersion: PROVIDER_POSITION_ADMISSION_VERSION,
                    accountId: request.accountId,
                    correlationId: request.correlationId,
                    deadlineAt,
                    sourceFamilyId: job.binding.sourceFamilyId,
                    sourceId: job.binding.sourceId,
                    sourceKind: job.binding.sourceKind,
                    walletId: job.target.walletId,
                    providerId: job.target.providerId,
                    protocolId: job.target.protocolId,
                    marketId: job.target.marketId,
                    networkId: job.target.networkId,
                    assets: job.target.assets,
                  }),
                ),
                request,
                job,
              ),
          ),
        );
      } catch (error) {
        controller.abort();
        if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
        return fail('SOURCE_UNAVAILABLE');
      }

      const captured = canonicalClock(this.clock.now());
      if (captured.milliseconds >= deadlineMilliseconds) return fail('SOURCE_UNAVAILABLE');
      const admittedTargets = assembleTargets(targets, evidence, captured.milliseconds);
      const staleAfter = admittedTargets.length
        ? admittedTargets.reduce(
            (earliest, target) => (target.staleAfter < earliest ? target.staleAfter : earliest),
            admittedTargets[0]!.staleAfter,
          )
        : deadlineAt;
      if (captured.timestamp >= staleAfter) return fail('STALE_EVIDENCE');

      const basisFingerprint = fingerprint([
        'crypto-lending:provider-position-admission-basis:v1',
        request.accountId,
        request.correlationId,
        this.policy.fingerprintSha256,
        captured.timestamp,
        admittedTargets,
      ]);
      const positionSnapshotId = `provider-position-${basisFingerprint}`;
      const manifestId = deterministicUuidV4(
        fingerprint(['crypto-lending:provider-position-coverage-manifest-id:v1', basisFingerprint]),
      );
      const coverageContent = {
        coverageVersion: MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
        use: MAINNET_PROVIDER_POSITION_COVERAGE_ONLY,
        mayAuthorizeFinancialAction: false as const,
        manifestId,
        accountId: request.accountId,
        positionSnapshotId,
        observationPolicyVersion: this.policy.policyVersion,
        observationPolicyId: this.policy.policyId,
        observationPolicyFingerprintSha256: this.policy.fingerprintSha256,
        assetRegistryVersion: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version,
        assetRegistryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
        capturedAt: captured.timestamp,
        staleAfter,
        freshnessClass: 'CURRENT' as const,
        targets: admittedTargets.map((target) =>
          Object.freeze({
            walletId: target.walletId,
            providerId: target.providerId,
            protocolId: target.protocolId,
            marketId: target.marketId,
            networkId: target.networkId,
            assets: target.assets.map((asset) =>
              Object.freeze({ stablecoin: asset.stablecoin, identity: asset.identity }),
            ),
            sourceIds: target.acceptedSources.map(({ sourceId }) => sourceId),
            status: 'COMPLETE' as const,
            divergenceStatus: 'AGREED' as const,
            positionCount: target.positions.length,
            observedAt: target.observedAt,
            staleAfter: target.staleAfter,
          }),
        ),
      };
      let coverageManifest: MainnetProviderPositionCoverageManifestV1;
      try {
        const context = {
          accountId: request.accountId,
          evaluatedAt: captured.timestamp,
          expectedWallets: wallets,
          observationPolicy: this.policy,
        };
        const coverageFingerprint = mainnetProviderPositionCoverageManifestFingerprintV1(
          coverageContent,
          context,
        );
        coverageManifest = parseMainnetProviderPositionCoverageManifestV1(
          { ...coverageContent, fingerprintSha256: coverageFingerprint },
          context,
        );
      } catch {
        return fail('ASSEMBLY_UNAVAILABLE');
      }
      const candidateWithoutFingerprint = Object.freeze({
        admissionVersion: PROVIDER_POSITION_ADMISSION_VERSION,
        use: PROVIDER_POSITION_ADMISSION_CANDIDATE_USE,
        mayAuthorizeFinancialAction: false as const,
        mayPersist: false as const,
        mayCreatePositionSnapshot: false as const,
        assemblyStatus: 'BLOCKED_PENDING_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY' as const,
        accountId: request.accountId,
        correlationId: request.correlationId,
        positionSnapshotId,
        observationPolicyVersion: this.policy.policyVersion,
        observationPolicyId: this.policy.policyId,
        observationPolicyFingerprintSha256: this.policy.fingerprintSha256,
        assetRegistryVersion: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version,
        assetRegistryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
        capturedAt: captured.timestamp,
        staleAfter,
        freshnessClass: 'CURRENT' as const,
        targets: admittedTargets,
        coverageManifest,
      });
      return Object.freeze({
        ...candidateWithoutFingerprint,
        candidateFingerprintSha256: fingerprint([
          'crypto-lending:provider-position-admission-candidate:v1',
          candidateWithoutFingerprint,
        ]),
      });
    } catch (error) {
      if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
      return fail('ASSEMBLY_UNAVAILABLE');
    }
  }
}

function parseRequest(value: unknown): ReadProviderPositionAdmissionRequestV1 {
  const record = exactRecord(value, ['accountId', 'correlationId'], 'INVALID_REQUEST');
  let accountId: AccountId;
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return fail('INVALID_REQUEST');
  }
  if (typeof record.correlationId !== 'string' || !CORRELATION_ID.test(record.correlationId)) {
    return fail('INVALID_REQUEST');
  }
  return Object.freeze({ accountId, correlationId: record.correlationId });
}

function normalizeBindings(
  values: readonly ProviderPositionAdmissionSourceBinding[],
  policy: MainnetProviderPositionObservationPolicyV1,
): readonly ProviderPositionAdmissionSourceBinding[] {
  const normalized = values.map((value) => {
    const record = exactRecord(
      value,
      ['sourceFamilyId', 'sourceId', 'sourceKind', 'networkId', 'source'],
      'INVALID_CONFIGURATION',
      false,
    );
    if (
      typeof record.sourceFamilyId !== 'string' ||
      !SAFE_FAMILY_ID.test(record.sourceFamilyId) ||
      typeof record.sourceId !== 'string' ||
      !COVERAGE_SLUG.test(record.sourceId) ||
      (record.sourceKind !== 'RPC' &&
        record.sourceKind !== 'INDEXER' &&
        record.sourceKind !== 'PROVIDER_API') ||
      typeof record.networkId !== 'string' ||
      !mainnetProviderPositionPolicyAllowsSource(
        policy,
        record.sourceId,
        record.sourceKind,
        record.networkId,
      ) ||
      typeof (record.source as ProviderPositionAdmissionSourcePort | undefined)?.readTarget !==
        'function'
    ) {
      return fail('INVALID_CONFIGURATION');
    }
    return Object.freeze({
      sourceFamilyId: record.sourceFamilyId,
      sourceId: record.sourceId,
      sourceKind: record.sourceKind,
      networkId: record.networkId,
      source: record.source as ProviderPositionAdmissionSourcePort,
    });
  });
  const keys = normalized.map(({ sourceId, sourceKind, networkId }) =>
    [sourceId, sourceKind, networkId].join('\0'),
  );
  if (
    new Set(keys).size !== keys.length ||
    new Set(normalized.map(({ source }) => source)).size !== normalized.length ||
    normalized.length !== policy.sources.length
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  for (const source of policy.sources) {
    if (
      !normalized.some(
        (binding) =>
          binding.sourceId === source.sourceId &&
          binding.sourceKind === source.sourceKind &&
          binding.networkId === source.networkId,
      )
    ) {
      return fail('INVALID_CONFIGURATION');
    }
  }
  return Object.freeze(
    normalized.sort((left, right) =>
      compare(
        [left.networkId, left.sourceFamilyId, left.sourceId, left.sourceKind].join('\0'),
        [right.networkId, right.sourceFamilyId, right.sourceId, right.sourceKind].join('\0'),
      ),
    ),
  );
}

function expectedTargets(
  wallets: readonly ActivePortfolioWalletRegistration[],
  policy: MainnetProviderPositionObservationPolicyV1,
): readonly ExpectedTarget[] {
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const targets: ExpectedTarget[] = [];
  for (const wallet of wallets) {
    for (const provider of policy.providers) {
      if (!COVERAGE_SLUG.test(provider.providerId)) return fail('POLICY_UNAVAILABLE');
      for (const protocol of provider.protocols) {
        if (!COVERAGE_SLUG.test(protocol.protocolId)) return fail('POLICY_UNAVAILABLE');
        for (const market of protocol.markets) {
          if (market.networkId !== wallet.networkId) continue;
          const assets = market.assets.map((approval) => {
            const registered = registry.identifyAsset(market.networkId, approval.identity);
            if (
              !registered ||
              registered.activationState !== 'ACTIVE' ||
              registered.stablecoin !== approval.stablecoin ||
              !mainnetProviderPositionPolicyAllowsMarket(
                policy,
                provider.providerId,
                protocol.protocolId,
                market.networkId,
                market.marketId,
                approval.stablecoin,
                approval.identity,
              )
            ) {
              return fail('POLICY_UNAVAILABLE');
            }
            return Object.freeze({
              stablecoin: registered.stablecoin,
              networkId: registered.networkId,
              identity: registered.identity,
              decimals: registered.decimals,
            });
          });
          assets.sort((left, right) =>
            compare(
              `${left.stablecoin}\0${left.identity}`,
              `${right.stablecoin}\0${right.identity}`,
            ),
          );
          const key = [
            wallet.walletId,
            provider.providerId,
            protocol.protocolId,
            market.marketId,
            market.networkId,
          ].join('\0');
          targets.push(
            Object.freeze({
              targetId: fingerprint(['crypto-lending:provider-position-target:v1', key]),
              walletId: wallet.walletId,
              providerId: provider.providerId,
              protocolId: protocol.protocolId,
              marketId: market.marketId,
              networkId: market.networkId,
              assets: Object.freeze(assets),
            }),
          );
        }
      }
    }
  }
  return Object.freeze(targets.sort((left, right) => compare(left.targetId, right.targetId)));
}

function createJobs(
  targets: readonly ExpectedTarget[],
  bindings: readonly ProviderPositionAdmissionSourceBinding[],
): readonly ReadJob[] {
  const jobs: ReadJob[] = [];
  for (const target of targets) {
    const eligible = bindings.filter((binding) => binding.networkId === target.networkId);
    if (
      eligible.length < 2 ||
      new Set(eligible.map(({ sourceFamilyId }) => sourceFamilyId)).size < 2
    ) {
      return fail('INSUFFICIENT_INDEPENDENT_SOURCES');
    }
    for (const binding of eligible) jobs.push(Object.freeze({ target, binding }));
  }
  return Object.freeze(jobs);
}

async function runBounded<TInput, TOutput>(
  inputs: readonly TInput[],
  concurrency: number,
  read: (input: TInput) => Promise<TOutput>,
): Promise<readonly TOutput[]> {
  const results = new Array<TOutput>(inputs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < inputs.length) {
      const index = next;
      next += 1;
      const input = inputs[index];
      if (input === undefined) return fail('ASSEMBLY_UNAVAILABLE');
      results[index] = await read(input);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => worker()),
  );
  return Object.freeze(results);
}

function parseSourceEvidence(
  value: unknown,
  request: ReadProviderPositionAdmissionRequestV1,
  job: ReadJob,
): ProviderPositionAdmissionSourceEvidenceV1 {
  assertBoundedPlainData(value);
  const record = exactRecord(
    value,
    [
      'evidenceVersion',
      'use',
      'mayAuthorizeFinancialAction',
      'accountId',
      'correlationId',
      'sourceFamilyId',
      'sourceId',
      'sourceKind',
      'sourceObservationId',
      'walletId',
      'providerId',
      'protocolId',
      'marketId',
      'networkId',
      'assets',
      'status',
      'observedAt',
      'staleAfter',
      'continuityFloor',
      'chainAnchor',
      'positions',
    ],
    'SOURCE_MISMATCH',
  );
  if (
    record.evidenceVersion !== PROVIDER_POSITION_ADMISSION_VERSION ||
    record.use !== PROVIDER_POSITION_ADMISSION_SOURCE_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.accountId !== request.accountId ||
    record.correlationId !== request.correlationId ||
    record.sourceFamilyId !== job.binding.sourceFamilyId ||
    record.sourceId !== job.binding.sourceId ||
    record.sourceKind !== job.binding.sourceKind ||
    record.walletId !== job.target.walletId ||
    record.providerId !== job.target.providerId ||
    record.protocolId !== job.target.protocolId ||
    record.marketId !== job.target.marketId ||
    record.networkId !== job.target.networkId ||
    record.status !== 'COMPLETE' ||
    typeof record.sourceObservationId !== 'string' ||
    !SAFE_OPAQUE_ID.test(record.sourceObservationId)
  ) {
    return fail('SOURCE_MISMATCH');
  }
  const assets = dataArray(record.assets, 32, 'SOURCE_MISMATCH').map((asset) =>
    parseAsset(asset, job.target.networkId),
  );
  if (canonicalJson(assets) !== canonicalJson(job.target.assets)) return fail('SOURCE_MISMATCH');
  const observedAt = parseTimestamp(record.observedAt, 'STALE_EVIDENCE');
  const staleAfter = parseTimestamp(record.staleAfter, 'STALE_EVIDENCE');
  const chainPolicy = chainObservationPolicyForNetwork(job.target.networkId);
  if (
    !chainPolicy ||
    chainPolicy.environment !== 'MAINNET' ||
    staleAfter.milliseconds <= observedAt.milliseconds ||
    staleAfter.milliseconds > observedAt.milliseconds + chainPolicy.freshness.currentWithinMs
  ) {
    return fail('STALE_EVIDENCE');
  }
  const continuityFloor = parseAnchor(record.continuityFloor, job.target.networkId);
  const chainAnchor = parseAnchor(record.chainAnchor, job.target.networkId);
  assertNotRegressing(continuityFloor, chainAnchor);
  const positions = dataArray(
    record.positions,
    MAX_POSITIONS_PER_TARGET,
    'INCOMPLETE_COVERAGE',
  ).map((position) => parsePosition(position, job.target));
  positions.sort((left, right) => compare(positionKey(left), positionKey(right)));
  if (new Set(positions.map(positionKey)).size !== positions.length) {
    return fail('INCOMPLETE_COVERAGE');
  }
  return Object.freeze({
    evidenceVersion: PROVIDER_POSITION_ADMISSION_VERSION,
    use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,
    mayAuthorizeFinancialAction: false,
    accountId: request.accountId,
    correlationId: request.correlationId,
    sourceFamilyId: job.binding.sourceFamilyId,
    sourceId: job.binding.sourceId,
    sourceKind: job.binding.sourceKind,
    sourceObservationId: record.sourceObservationId,
    walletId: job.target.walletId,
    providerId: job.target.providerId,
    protocolId: job.target.protocolId,
    marketId: job.target.marketId,
    networkId: job.target.networkId,
    assets: Object.freeze(assets),
    status: 'COMPLETE',
    observedAt: observedAt.timestamp,
    staleAfter: staleAfter.timestamp,
    continuityFloor,
    chainAnchor,
    positions: Object.freeze(positions),
  });
}

function assembleTargets(
  targets: readonly ExpectedTarget[],
  evidence: readonly ProviderPositionAdmissionSourceEvidenceV1[],
  capturedAtMilliseconds: number,
): readonly ProviderPositionAdmissionTargetCandidateV1[] {
  return Object.freeze(
    targets.map((target) => {
      const sources = evidence.filter(
        (item) =>
          item.walletId === target.walletId &&
          item.providerId === target.providerId &&
          item.protocolId === target.protocolId &&
          item.marketId === target.marketId &&
          item.networkId === target.networkId,
      );
      if (sources.length < 2 || new Set(sources.map((item) => item.sourceFamilyId)).size < 2) {
        return fail('INCOMPLETE_COVERAGE');
      }
      for (const source of sources) {
        if (
          Date.parse(source.observedAt) > capturedAtMilliseconds ||
          capturedAtMilliseconds >= Date.parse(source.staleAfter)
        ) {
          return fail('STALE_EVIDENCE');
        }
      }
      const positionSetFingerprints = sources.map((source) =>
        positionSetFingerprint(source.positions),
      );
      if (new Set(positionSetFingerprints).size !== 1) return fail('DIVERGENT_EVIDENCE');
      sources.sort((left, right) =>
        compare(
          `${left.sourceFamilyId}\0${left.sourceId}\0${left.sourceKind}`,
          `${right.sourceFamilyId}\0${right.sourceId}\0${right.sourceKind}`,
        ),
      );
      const positions = sources[0]?.positions;
      if (!positions) return fail('INCOMPLETE_COVERAGE');
      const observedAt = sources.reduce(
        (latest, source) => (source.observedAt > latest ? source.observedAt : latest),
        sources[0]!.observedAt,
      );
      const staleAfter = sources.reduce(
        (earliest, source) => (source.staleAfter < earliest ? source.staleAfter : earliest),
        sources[0]!.staleAfter,
      );
      if (observedAt >= staleAfter) return fail('STALE_EVIDENCE');
      return Object.freeze({
        targetId: target.targetId,
        walletId: target.walletId,
        providerId: target.providerId,
        protocolId: target.protocolId,
        marketId: target.marketId,
        networkId: target.networkId,
        assets: target.assets,
        status: 'COMPLETE' as const,
        divergenceStatus: 'AGREED' as const,
        observedAt,
        staleAfter,
        positions,
        acceptedSources: Object.freeze(
          sources.map((source) =>
            Object.freeze({
              sourceFamilyId: source.sourceFamilyId,
              sourceId: source.sourceId,
              sourceKind: source.sourceKind,
              sourceObservationId: source.sourceObservationId,
              observedAt: source.observedAt,
              staleAfter: source.staleAfter,
              continuityFloor: source.continuityFloor,
              chainAnchor: source.chainAnchor,
              positionSetFingerprintSha256: positionSetFingerprint(source.positions),
            }),
          ),
        ),
      });
    }),
  );
}

function parsePosition(
  value: unknown,
  target: ExpectedTarget,
): ProviderPositionAdmissionPositionV1 {
  const record = exactRecord(
    value,
    ['positionId', 'positionKind', 'asset', 'balance'],
    'SOURCE_MISMATCH',
  );
  if (
    typeof record.positionId !== 'string' ||
    !SAFE_OPAQUE_ID.test(record.positionId) ||
    (record.positionKind !== 'SUPPLY' && record.positionKind !== 'BORROW')
  ) {
    return fail('SOURCE_MISMATCH');
  }
  const asset = parseAsset(record.asset, target.networkId);
  if (
    !target.assets.some(
      (approved) =>
        approved.stablecoin === asset.stablecoin &&
        approved.identity === asset.identity &&
        approved.decimals === asset.decimals,
    )
  ) {
    return fail('SOURCE_MISMATCH');
  }
  const balanceRecord = exactRecord(record.balance, ['atomic', 'decimal'], 'SOURCE_MISMATCH');
  const maximum = target.networkId.startsWith('solana:') ? MAX_UINT64 : MAX_UINT256;
  const atomic = canonicalInteger(balanceRecord.atomic, maximum, 'SOURCE_MISMATCH');
  const decimal = mainnetProviderPositionDecimalFromAtomic(atomic, asset.decimals);
  if (balanceRecord.decimal !== decimal) return fail('SOURCE_MISMATCH');
  return Object.freeze({
    positionId: record.positionId,
    positionKind: record.positionKind,
    asset,
    balance: Object.freeze({ atomic, decimal }),
  });
}

function parseAsset(value: unknown, networkId: string): ProviderPositionAdmissionAssetV1 {
  const record = exactRecord(
    value,
    ['stablecoin', 'networkId', 'identity', 'decimals'],
    'SOURCE_MISMATCH',
  );
  if (
    record.networkId !== networkId ||
    typeof record.identity !== 'string' ||
    typeof record.decimals !== 'number' ||
    !Number.isSafeInteger(record.decimals)
  ) {
    return fail('SOURCE_MISMATCH');
  }
  const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.identifyAsset(networkId, record.identity);
  if (
    !asset ||
    asset.activationState !== 'ACTIVE' ||
    record.stablecoin !== asset.stablecoin ||
    record.decimals !== asset.decimals
  ) {
    return fail('SOURCE_MISMATCH');
  }
  return Object.freeze({
    stablecoin: asset.stablecoin,
    networkId: asset.networkId,
    identity: asset.identity,
    decimals: asset.decimals,
  });
}

function parseAnchor(value: unknown, networkId: string): ProviderPositionAdmissionChainAnchorV1 {
  const kind = dataProperty(value, 'kind', 'SOURCE_MISMATCH');
  if (kind === 'EVM_BLOCK') {
    const record = exactRecord(value, ['kind', 'blockNumber', 'blockHash'], 'SOURCE_MISMATCH');
    if (
      !networkId.startsWith('eip155:') ||
      typeof record.blockHash !== 'string' ||
      !EVM_BLOCK_HASH.test(record.blockHash) ||
      /^0x0{64}$/iu.test(record.blockHash)
    ) {
      return fail('SOURCE_MISMATCH');
    }
    return Object.freeze({
      kind: 'EVM_BLOCK',
      blockNumber: canonicalInteger(record.blockNumber, MAX_UINT256, 'SOURCE_MISMATCH'),
      blockHash: record.blockHash.toLowerCase(),
    });
  }
  if (kind === 'SOLANA_SLOT') {
    const record = exactRecord(value, ['kind', 'slot', 'root'], 'SOURCE_MISMATCH');
    if (!networkId.startsWith('solana:')) return fail('SOURCE_MISMATCH');
    const slot = canonicalInteger(record.slot, MAX_UINT64, 'SOURCE_MISMATCH');
    const root = canonicalInteger(record.root, MAX_UINT64, 'SOURCE_MISMATCH');
    if (BigInt(root) > BigInt(slot)) return fail('SOURCE_MISMATCH');
    return Object.freeze({ kind: 'SOLANA_SLOT', slot, root });
  }
  return fail('SOURCE_MISMATCH');
}

function assertNotRegressing(
  floor: ProviderPositionAdmissionChainAnchorV1,
  current: ProviderPositionAdmissionChainAnchorV1,
): void {
  if (floor.kind !== current.kind) return fail('REGRESSING_EVIDENCE');
  if (floor.kind === 'EVM_BLOCK' && current.kind === 'EVM_BLOCK') {
    const floorNumber = BigInt(floor.blockNumber);
    const currentNumber = BigInt(current.blockNumber);
    if (
      currentNumber < floorNumber ||
      (currentNumber === floorNumber && current.blockHash !== floor.blockHash)
    ) {
      return fail('REGRESSING_EVIDENCE');
    }
    return;
  }
  if (floor.kind === 'SOLANA_SLOT' && current.kind === 'SOLANA_SLOT') {
    if (BigInt(current.slot) < BigInt(floor.slot) || BigInt(current.root) < BigInt(floor.root)) {
      return fail('REGRESSING_EVIDENCE');
    }
    return;
  }
  return fail('REGRESSING_EVIDENCE');
}

function canonicalInteger(
  value: unknown,
  maximum: bigint,
  code: ProviderPositionAdmissionFailureCode,
): string {
  if (
    typeof value !== 'string' ||
    !UNSIGNED_INTEGER.test(value) ||
    value.length > maximum.toString(10).length
  ) {
    return fail(code);
  }
  if (BigInt(value) > maximum) return fail(code);
  return value;
}

function parseTimestamp(
  value: unknown,
  code: ProviderPositionAdmissionFailureCode,
): Readonly<{ timestamp: string; milliseconds: number }> {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail(code);
  }
  return Object.freeze({ timestamp: value, milliseconds });
}

function canonicalClock(value: unknown): Readonly<{ timestamp: string; milliseconds: number }> {
  try {
    if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype) {
      return fail('INVALID_CONFIGURATION');
    }
    const milliseconds = Date.prototype.getTime.call(value);
    const timestamp = Date.prototype.toISOString.call(value);
    if (!Number.isSafeInteger(milliseconds) || !TIMESTAMP.test(timestamp)) {
      return fail('INVALID_CONFIGURATION');
    }
    return Object.freeze({ timestamp, milliseconds });
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
    return fail('INVALID_CONFIGURATION');
  }
}

function positionKey(value: ProviderPositionAdmissionPositionV1): string {
  return [
    value.positionId,
    value.positionKind,
    value.asset.stablecoin,
    value.asset.networkId,
    value.asset.identity,
  ].join('\0');
}

function positionSetFingerprint(values: readonly ProviderPositionAdmissionPositionV1[]): string {
  return fingerprint(['crypto-lending:provider-position-agreement-set:v1', values]);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function deterministicUuidV4(hex: string): string {
  const characters = hex.slice(0, 32).split('');
  characters[12] = '4';
  const variant = Number.parseInt(characters[16] ?? '0', 16);
  characters[16] = ((variant & 0x3) | 0x8).toString(16);
  const compact = characters.join('');
  const uuid = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
  if (!UUID_V4.test(uuid)) return fail('ASSEMBLY_UNAVAILABLE');
  return uuid;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertBoundedPlainData(value: unknown): void {
  try {
    const seen = new WeakSet<object>();
    let bytes = 0;
    let nodes = 0;
    const visit = (candidate: unknown, depth: number): void => {
      nodes += 1;
      if (nodes > MAX_RESPONSE_NODES || depth > 16) return fail('SOURCE_MISMATCH');
      if (candidate === null || typeof candidate === 'boolean') bytes += 5;
      else if (typeof candidate === 'string') bytes += Buffer.byteLength(candidate, 'utf8') + 2;
      else if (typeof candidate === 'number') {
        if (!Number.isFinite(candidate) || !Number.isInteger(candidate)) {
          return fail('SOURCE_MISMATCH');
        }
        bytes += 32;
      } else if (typeof candidate === 'object') {
        if (seen.has(candidate)) return fail('SOURCE_MISMATCH');
        seen.add(candidate);
        const array = Array.isArray(candidate);
        const prototype = Object.getPrototypeOf(candidate);
        if (
          (array && prototype !== Array.prototype) ||
          (!array && prototype !== Object.prototype && prototype !== null) ||
          Object.getOwnPropertySymbols(candidate).length > 0
        ) {
          return fail('SOURCE_MISMATCH');
        }
        const descriptors = Object.getOwnPropertyDescriptors(candidate);
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (array && key === 'length') continue;
          if (!descriptor.enumerable || !('value' in descriptor)) return fail('SOURCE_MISMATCH');
          bytes += Buffer.byteLength(key, 'utf8') + 3;
          visit(descriptor.value, depth + 1);
        }
      } else return fail('SOURCE_MISMATCH');
      if (bytes > MAX_RESPONSE_BYTES) return fail('SOURCE_MISMATCH');
    };
    visit(value, 0);
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
    return fail('SOURCE_MISMATCH');
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: ProviderPositionAdmissionFailureCode,
  requirePlain = true,
): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(code);
    const prototype = Object.getPrototypeOf(value);
    if (requirePlain && prototype !== Object.prototype && prototype !== null) return fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail(code);
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
    return fail(code);
  }
}

function dataProperty(
  value: unknown,
  key: string,
  code: ProviderPositionAdmissionFailureCode,
): unknown {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
    return descriptor.value;
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
    return fail(code);
  }
}

function dataArray(
  value: unknown,
  maximumLength: number,
  code: ProviderPositionAdmissionFailureCode,
): unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
      return fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors['length'];
    if (
      !lengthDescriptor ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength ||
      lengthDescriptor.enumerable
    ) {
      return fail(code);
    }
    const length = lengthDescriptor.value;
    const expected = [...Array.from({ length }, (_, index) => String(index)), 'length'];
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== expected.length ||
      actual.some((key) => typeof key !== 'string' || !expected.includes(key))
    ) {
      return fail(code);
    }
    return Array.from({ length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
      return descriptor.value;
    });
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
    return fail(code);
  }
}
