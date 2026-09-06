import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

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
  parseCoveredMainnetProviderPositionSnapshotV1,
  parseMainnetProviderPositionCoverageManifestV1,
  type CoveredMainnetProviderPositionSnapshotV1,
  type MainnetProviderPositionCoverageManifestV1,
} from '../domain/mainnet-provider-position-coverage';
import {
  parseMainnetProviderPositionChainAssessmentV1,
  type MainnetProviderPositionChainAssessmentVerificationContextV1,
} from '../domain/mainnet-provider-position-chain-assessment';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
  MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
  mainnetProviderPositionDecimalFromAtomic,
  type MainnetProviderPositionObservationV1,
} from '../domain/mainnet-provider-position-observation';
import {
  mainnetProviderPositionPolicyAllowsMarket,
  mainnetProviderPositionPolicyAllowsSource,
  parseMainnetProviderPositionObservationPolicyV1,
  type MainnetProviderPositionObservationPolicyV1,
  type MainnetProviderPositionSourceKind,
} from '../domain/mainnet-provider-position-observation-policy';
import {
  PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_USE,
  PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION,
  type AssembleProviderPositionTrustedChainAssessmentRequestV1,
  type ProviderPositionTrustedChainAssessmentAssemblyPort,
  type ProviderPositionTrustedChainAssessmentSnapshotCandidateV1,
  type ProviderPositionTrustedChainAssessmentTargetSourceV1,
} from './ports/provider-position-trusted-chain-assessment-assembly.port';

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
const WALLET_ROSTER_SOURCE_FAMILY_ID = 'authoritative-wallet-roster';
const WALLET_ROSTER_TARGET_ID = 'active-wallet-roster';

export const PROVIDER_POSITION_ADMISSION_VERSION = 1 as const;
export const PROVIDER_POSITION_ADMISSION_SOURCE_USE =
  'DORMANT_PROVIDER_POSITION_TARGET_EVIDENCE_ONLY' as const;
export const PROVIDER_POSITION_ADMISSION_CANDIDATE_USE =
  'DORMANT_PROVIDER_POSITION_ASSEMBLY_CANDIDATE_ONLY' as const;
export const PROVIDER_POSITION_ADMISSION_READ_ONLY_ASSEMBLY_USE =
  'DORMANT_PROVIDER_POSITION_READ_ONLY_ASSEMBLY_ONLY' as const;
const TRUSTED_ASSEMBLY_SOURCE_FAMILY_ID = 'trusted-chain-assessment-assembly';

export interface ProviderPositionAdmissionClock {
  now(): Date;
}

export interface ProviderPositionAdmissionDeadlineRunRequestV1 {
  readonly deadlineAt: string;
  readonly correlationId: string;
  readonly sourceFamilyId: string;
  readonly targetId: string;
  readonly signal: AbortSignal;
  /** Narrow authority used by the trusted runner to cancel this whole admission. */
  readonly abortAdmission: () => void;
}

/**
 * Trusted deadline enforcement; the coordinator owns no ambient timer. A
 * runner must cancel through abortAdmission and drain every started operation
 * before settling after a deadline, sibling abort, or operation failure.
 */
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
  readonly signal: AbortSignal;
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
   * transport enforcement, must cooperatively stop and drain before rejecting
   * when request.signal aborts, and must derive continuityFloor from durable
   * state rather than the same stateless response that supplies chainAnchor.
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

export interface ProviderPositionAdmissionReadOnlyAssemblyV1 {
  readonly assemblyVersion: typeof PROVIDER_POSITION_ADMISSION_VERSION;
  readonly use: typeof PROVIDER_POSITION_ADMISSION_READ_ONLY_ASSEMBLY_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  /** Exact server-authored time used to parse the covered snapshot. */
  readonly evaluatedAt: string;
  readonly admissionCandidate: ProviderPositionAdmissionAssemblyCandidateV1;
  readonly coveredSnapshot: CoveredMainnetProviderPositionSnapshotV1;
}

const ISSUED_PROVIDER_POSITION_ADMISSION_READ_ONLY_ASSEMBLIES = new WeakSet<object>();

/**
 * Reviews only module-private issuance identity. It does not inspect the
 * candidate and therefore cannot invoke properties on an untrusted value.
 */
export function isIssuedProviderPositionAdmissionReadOnlyAssemblyV1(
  value: unknown,
): value is ProviderPositionAdmissionReadOnlyAssemblyV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    ISSUED_PROVIDER_POSITION_ADMISSION_READ_ONLY_ASSEMBLIES.has(value)
  );
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

interface PreparedProviderPositionAdmission {
  readonly candidate: ProviderPositionAdmissionAssemblyCandidateV1;
  readonly wallets: readonly ActivePortfolioWalletRegistration[];
  readonly deadlineAt: string;
  readonly deadlineMilliseconds: number;
  readonly controller: AbortController;
  readonly abortAdmission: () => void;
}

interface ProviderPositionSnapshotAssemblyInput {
  readonly positionSnapshot: ProviderPositionTrustedChainAssessmentSnapshotCandidateV1;
  readonly selectedTargetSources: readonly ProviderPositionTrustedChainAssessmentTargetSourceV1[];
}

function fail(code: ProviderPositionAdmissionFailureCode): never {
  throw new ProviderPositionAdmissionUnavailableError(code);
}

function stableDataMember(value: object, key: PropertyKey): unknown {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 8; depth += 1) {
    if (isProxy(current)) return fail('INVALID_CONFIGURATION');
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      if (!('value' in descriptor)) return fail('INVALID_CONFIGURATION');
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return fail('INVALID_CONFIGURATION');
}

function captureTrustedChainAssessmentAssembly(
  value: ProviderPositionTrustedChainAssessmentAssemblyPort | undefined,
): ProviderPositionTrustedChainAssessmentAssemblyPort | undefined {
  if (value === undefined) return undefined;
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return fail('INVALID_CONFIGURATION');
  }
  const assemblyVersion = stableDataMember(value, 'assemblyVersion');
  const assemble = stableDataMember(value, 'assemble');
  const verifyAssembly = stableDataMember(value, 'verifyAssembly');
  const verify = stableDataMember(value, 'verify');
  if (
    assemblyVersion !== PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION ||
    typeof assemble !== 'function' ||
    isProxy(assemble) ||
    typeof verifyAssembly !== 'function' ||
    isProxy(verifyAssembly) ||
    typeof verify !== 'function' ||
    isProxy(verify)
  ) {
    return fail('INVALID_CONFIGURATION');
  }

  return Object.freeze({
    assemblyVersion: PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION,
    assemble: (request: AssembleProviderPositionTrustedChainAssessmentRequestV1) =>
      Reflect.apply(assemble, value, [request]) as Promise<unknown>,
    verifyAssembly: (
      capability: unknown,
      request: AssembleProviderPositionTrustedChainAssessmentRequestV1,
    ) => Reflect.apply(verifyAssembly, value, [capability, request]) as boolean,
    verify: (
      capability: unknown,
      context: MainnetProviderPositionChainAssessmentVerificationContextV1,
    ) => Reflect.apply(verify, value, [capability, context]) as boolean,
  });
}

export class DormantProviderPositionAdmissionCoordinator {
  private readonly policy!: MainnetProviderPositionObservationPolicyV1;
  private readonly bindings!: readonly ProviderPositionAdmissionSourceBinding[];
  private readonly options!: Readonly<ProviderPositionAdmissionOptions>;
  private readonly trustedChainAssessmentAssembly!:
    ProviderPositionTrustedChainAssessmentAssemblyPort | undefined;
  private readonly activeAdmissionControllers = new Set<AbortController>();
  private admissionOpen = true;

  constructor(
    policyInput: unknown,
    requiredPolicyFingerprintSha256: string,
    sourceBindings: readonly ProviderPositionAdmissionSourceBinding[],
    private readonly walletReader: PortfolioWalletRegistrationReader,
    private readonly clock: ProviderPositionAdmissionClock,
    private readonly deadlineRunner: ProviderPositionAdmissionDeadlineRunner,
    options: ProviderPositionAdmissionOptions,
    trustedChainAssessmentAssembly?: ProviderPositionTrustedChainAssessmentAssemblyPort,
  ) {
    try {
      this.policy = parseMainnetProviderPositionObservationPolicyV1(policyInput);
      const capturedAssembly = captureTrustedChainAssessmentAssembly(
        trustedChainAssessmentAssembly,
      );
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
      this.trustedChainAssessmentAssembly = capturedAssembly;
    } catch (error) {
      if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
      return fail('INVALID_CONFIGURATION');
    }
  }

  async admit(
    requestInput: ReadProviderPositionAdmissionRequestV1,
  ): Promise<ProviderPositionAdmissionAssemblyCandidateV1> {
    const prepared = await this.prepareAdmission(requestInput);
    try {
      return prepared.candidate;
    } finally {
      prepared.abortAdmission();
    }
  }

  async admitAndAssemble(
    requestInput: ReadProviderPositionAdmissionRequestV1,
  ): Promise<ProviderPositionAdmissionReadOnlyAssemblyV1> {
    const assembly = this.trustedChainAssessmentAssembly;
    if (assembly === undefined) return fail('ASSEMBLY_UNAVAILABLE');

    const prepared = await this.prepareAdmission(requestInput);
    const { abortAdmission, candidate, controller } = prepared;
    try {
      const evaluated = canonicalClock(this.clock.now());
      assertAssemblyWindow(evaluated.milliseconds, candidate, prepared, candidate.capturedAt);
      const { positionSnapshot, selectedTargetSources } = positionSnapshotAssemblyInput(candidate);
      const assemblyRequest = Object.freeze({
        assemblyVersion: PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION,
        use: PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_USE,
        mayAuthorizeFinancialAction: false as const,
        mayPersist: false as const,
        accountId: candidate.accountId,
        correlationId: candidate.correlationId,
        candidateFingerprintSha256: candidate.candidateFingerprintSha256,
        coverageManifestFingerprintSha256: candidate.coverageManifest.fingerprintSha256,
        evaluatedAt: evaluated.timestamp,
        deadlineAt: prepared.deadlineAt,
        signal: controller.signal,
        admissionCandidate: candidate,
        positionSnapshot,
        selectedTargetSources,
      });
      let chainAssessment: unknown;
      try {
        chainAssessment = await this.deadlineRunner.run(
          Object.freeze({
            deadlineAt: prepared.deadlineAt,
            correlationId: candidate.correlationId,
            sourceFamilyId: TRUSTED_ASSEMBLY_SOURCE_FAMILY_ID,
            targetId: candidate.positionSnapshotId,
            signal: controller.signal,
            abortAdmission,
          }),
          () => assembly.assemble(assemblyRequest),
        );
        const normalizedAssessment = parseMainnetProviderPositionChainAssessmentV1(chainAssessment);
        const observationIds = new Set(
          positionSnapshot.observations.map(({ observationId }) => observationId),
        );
        if (
          normalizedAssessment.observationPolicyFingerprintSha256 !==
            candidate.observationPolicyFingerprintSha256 ||
          normalizedAssessment.assetRegistryVersion !== candidate.assetRegistryVersion ||
          normalizedAssessment.assetRegistryFingerprintSha256 !==
            candidate.assetRegistryFingerprintSha256 ||
          normalizedAssessment.entries.length !== observationIds.size ||
          normalizedAssessment.entries.some(
            ({ observationId }) => observationIds.has(observationId) === false,
          ) ||
          assembly.verifyAssembly(chainAssessment, assemblyRequest) !== true
        ) {
          return fail('ASSEMBLY_UNAVAILABLE');
        }
      } catch {
        return fail('ASSEMBLY_UNAVAILABLE');
      }

      const completed = canonicalClock(this.clock.now());
      assertAssemblyWindow(completed.milliseconds, candidate, prepared, evaluated.timestamp);
      let coveredSnapshot: CoveredMainnetProviderPositionSnapshotV1;
      try {
        coveredSnapshot = parseCoveredMainnetProviderPositionSnapshotV1({
          accountId: candidate.accountId,
          evaluatedAt: evaluated.timestamp,
          expectedWallets: prepared.wallets,
          observationPolicy: this.policy,
          coverageManifest: candidate.coverageManifest,
          positionSnapshot,
          chainAssessment,
          chainAssessmentVerifier: assembly,
        });
      } catch {
        return fail('ASSEMBLY_UNAVAILABLE');
      }
      const verified = canonicalClock(this.clock.now());
      assertAssemblyWindow(verified.milliseconds, candidate, prepared, completed.timestamp);

      const readOnlyAssembly = Object.freeze({
        assemblyVersion: PROVIDER_POSITION_ADMISSION_VERSION,
        use: PROVIDER_POSITION_ADMISSION_READ_ONLY_ASSEMBLY_USE,
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        evaluatedAt: evaluated.timestamp,
        admissionCandidate: candidate,
        coveredSnapshot,
      });
      ISSUED_PROVIDER_POSITION_ADMISSION_READ_ONLY_ASSEMBLIES.add(readOnlyAssembly);
      return readOnlyAssembly;
    } catch (error) {
      if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
      return fail('ASSEMBLY_UNAVAILABLE');
    } finally {
      abortAdmission();
    }
  }

  /** Stops new admissions and synchronously aborts every admitted operation. */
  closeAdmission(): void {
    this.admissionOpen = false;
    let failed = false;
    for (const controller of [...this.activeAdmissionControllers]) {
      try {
        if (!controller.signal.aborted) controller.abort();
      } catch {
        failed = true;
      }
    }
    if (failed) return fail('SOURCE_UNAVAILABLE');
  }

  private async prepareAdmission(
    requestInput: ReadProviderPositionAdmissionRequestV1,
  ): Promise<PreparedProviderPositionAdmission> {
    let controller: AbortController | undefined;
    let abortAdmission: (() => void) | undefined;
    try {
      if (!this.admissionOpen) return fail('SOURCE_UNAVAILABLE');
      const request = parseRequest(requestInput);
      controller = new AbortController();
      const activeController = controller;
      this.activeAdmissionControllers.add(activeController);
      abortAdmission = (): void => {
        if (activeController.signal.aborted === false) activeController.abort();
        this.activeAdmissionControllers.delete(activeController);
      };
      const activeAbortAdmission = abortAdmission;
      const started = canonicalClock(this.clock.now());
      const deadlineMilliseconds = started.milliseconds + this.options.deadlineMilliseconds;
      if (!Number.isSafeInteger(deadlineMilliseconds)) return fail('INVALID_CONFIGURATION');
      const deadlineAt = new Date(deadlineMilliseconds).toISOString();
      let wallets: readonly ActivePortfolioWalletRegistration[];
      try {
        wallets = parseActivePortfolioWalletRegistrations(
          await this.deadlineRunner.run(
            Object.freeze({
              deadlineAt,
              correlationId: request.correlationId,
              sourceFamilyId: WALLET_ROSTER_SOURCE_FAMILY_ID,
              targetId: WALLET_ROSTER_TARGET_ID,
              signal: activeController.signal,
              abortAdmission: activeAbortAdmission,
            }),
            async () => {
              if (activeController.signal.aborted) return fail('WALLET_ROSTER_UNAVAILABLE');
              const roster = await this.walletReader.readActiveWalletRegistrations({
                accountId: request.accountId,
                evaluatedAt: started.timestamp,
                correlationId: request.correlationId,
                signal: activeController.signal,
              });
              if (activeController.signal.aborted) return fail('WALLET_ROSTER_UNAVAILABLE');
              return roster;
            },
          ),
        );
      } catch {
        return fail('WALLET_ROSTER_UNAVAILABLE');
      }
      if (
        activeController.signal.aborted ||
        canonicalClock(this.clock.now()).milliseconds >= deadlineMilliseconds
      ) {
        return fail('SOURCE_UNAVAILABLE');
      }

      const targets = expectedTargets(wallets, this.policy);
      const jobs = createJobs(targets, this.bindings);
      if (jobs.length > MAX_SOURCE_READS) return fail('LIMIT_EXCEEDED');
      let evidence: readonly ProviderPositionAdmissionSourceEvidenceV1[];
      try {
        evidence = await runBounded(
          jobs,
          this.options.maximumConcurrency,
          activeController,
          activeAbortAdmission,
          async (job) =>
            this.deadlineRunner.run(
              Object.freeze({
                deadlineAt,
                correlationId: request.correlationId,
                sourceFamilyId: job.binding.sourceFamilyId,
                targetId: job.target.targetId,
                signal: activeController.signal,
                abortAdmission: activeAbortAdmission,
              }),
              async () => {
                if (activeController.signal.aborted) return fail('SOURCE_UNAVAILABLE');
                const sourceEvidence = await job.binding.source.readTarget(
                  Object.freeze({
                    admissionVersion: PROVIDER_POSITION_ADMISSION_VERSION,
                    accountId: request.accountId,
                    correlationId: request.correlationId,
                    deadlineAt,
                    signal: activeController.signal,
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
                );
                if (activeController.signal.aborted) return fail('SOURCE_UNAVAILABLE');
                return parseSourceEvidence(sourceEvidence, request, job);
              },
            ),
        );
      } catch (error) {
        activeAbortAdmission();
        if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
        return fail('SOURCE_UNAVAILABLE');
      }

      const captured = canonicalClock(this.clock.now());
      if (activeController.signal.aborted || captured.milliseconds >= deadlineMilliseconds) {
        return fail('SOURCE_UNAVAILABLE');
      }
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
      const candidate = Object.freeze({
        ...candidateWithoutFingerprint,
        candidateFingerprintSha256: fingerprint([
          'crypto-lending:provider-position-admission-candidate:v1',
          candidateWithoutFingerprint,
        ]),
      });
      return Object.freeze({
        candidate,
        wallets,
        deadlineAt,
        deadlineMilliseconds,
        controller: activeController,
        abortAdmission: activeAbortAdmission,
      });
    } catch (error) {
      abortAdmission?.();
      if (error instanceof ProviderPositionAdmissionUnavailableError) throw error;
      return fail('ASSEMBLY_UNAVAILABLE');
    }
  }
}

function assertAssemblyWindow(
  milliseconds: number,
  candidate: ProviderPositionAdmissionAssemblyCandidateV1,
  prepared: PreparedProviderPositionAdmission,
  notBefore: string,
): void {
  if (
    milliseconds < Date.parse(notBefore) ||
    milliseconds >= prepared.deadlineMilliseconds ||
    milliseconds >= Date.parse(candidate.staleAfter)
  ) {
    return fail('ASSEMBLY_UNAVAILABLE');
  }
}

function positionSnapshotAssemblyInput(
  candidate: ProviderPositionAdmissionAssemblyCandidateV1,
): ProviderPositionSnapshotAssemblyInput {
  const observations: MainnetProviderPositionObservationV1[] = [];
  const selectedTargetSources: ProviderPositionTrustedChainAssessmentTargetSourceV1[] = [];
  const observationIds = new Set<string>();
  for (const target of candidate.targets) {
    const selectedSource = target.acceptedSources[0];
    if (selectedSource === undefined) return fail('ASSEMBLY_UNAVAILABLE');
    selectedTargetSources.push(
      Object.freeze({
        targetId: target.targetId,
        walletId: target.walletId,
        providerId: target.providerId,
        protocolId: target.protocolId,
        marketId: target.marketId,
        networkId: target.networkId,
        source: selectedSource,
      }),
    );
    for (const position of target.positions) {
      const observationId = deterministicUuidV4(
        fingerprint([
          'crypto-lending:provider-position-final-observation-id:v1',
          candidate.candidateFingerprintSha256,
          target.targetId,
          position,
          selectedSource,
        ]),
      );
      if (observationIds.has(observationId)) return fail('ASSEMBLY_UNAVAILABLE');
      observationIds.add(observationId);
      observations.push(
        Object.freeze({
          observationId,
          walletId: target.walletId,
          providerId: target.providerId,
          protocolId: target.protocolId,
          marketId: target.marketId,
          positionId: position.positionId,
          positionKind: position.positionKind,
          asset: position.asset,
          balance: position.balance,
          source: Object.freeze({
            sourceId: selectedSource.sourceId,
            sourceKind: selectedSource.sourceKind,
            sourceObservationId: selectedSource.sourceObservationId,
            chainAnchor: selectedSource.chainAnchor,
          }),
          observedAt: selectedSource.observedAt,
          staleAfter: target.staleAfter,
          freshnessClass: 'CURRENT' as const,
        }),
      );
    }
  }

  return Object.freeze({
    positionSnapshot: Object.freeze({
      schemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
      use: MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
      mayAuthorizeFinancialAction: false,
      snapshotId: candidate.positionSnapshotId,
      observationPolicyVersion: candidate.observationPolicyVersion,
      observationPolicyId: candidate.observationPolicyId,
      observationPolicyFingerprintSha256: candidate.observationPolicyFingerprintSha256,
      assetRegistryVersion: candidate.assetRegistryVersion,
      assetRegistryFingerprintSha256: candidate.assetRegistryFingerprintSha256,
      capturedAt: candidate.capturedAt,
      staleAfter: candidate.staleAfter,
      freshnessClass: 'CURRENT',
      observations: Object.freeze(observations),
    }),
    selectedTargetSources: Object.freeze(selectedTargetSources),
  });
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
  const capturedSources = new Map<object, ProviderPositionAdmissionSourcePort>();
  const normalized = values.map((value) => {
    const record = exactRecord(
      value,
      ['sourceFamilyId', 'sourceId', 'sourceKind', 'networkId', 'source'],
      'INVALID_CONFIGURATION',
      false,
    );
    const sourceIdentity = record.source;
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
      (typeof sourceIdentity !== 'object' && typeof sourceIdentity !== 'function') ||
      sourceIdentity === null ||
      isProxy(sourceIdentity)
    ) {
      return fail('INVALID_CONFIGURATION');
    }
    const sourceReceiver = sourceIdentity as object;
    let source = capturedSources.get(sourceReceiver);
    if (source === undefined) {
      const readTarget = stableDataMember(sourceReceiver, 'readTarget');
      if (typeof readTarget !== 'function' || isProxy(readTarget)) {
        return fail('INVALID_CONFIGURATION');
      }
      source = Object.freeze({
        readTarget: (request: ReadProviderPositionAdmissionTargetRequestV1) =>
          Reflect.apply(readTarget, sourceReceiver, [request]) as Promise<unknown>,
      });
      capturedSources.set(sourceReceiver, source);
    }
    return Object.freeze({
      sourceFamilyId: record.sourceFamilyId,
      sourceId: record.sourceId,
      sourceKind: record.sourceKind,
      networkId: record.networkId,
      source,
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
  controller: AbortController,
  abortAdmission: () => void,
  read: (input: TInput) => Promise<TOutput>,
): Promise<readonly TOutput[]> {
  const results = new Array<TOutput>(inputs.length);
  let next = 0;
  let failed = false;
  let firstFailure: unknown;
  const worker = async (): Promise<void> => {
    while (!failed && !controller.signal.aborted && next < inputs.length) {
      const index = next;
      next += 1;
      const input = inputs[index];
      try {
        if (input === undefined) return fail('ASSEMBLY_UNAVAILABLE');
        results[index] = await read(input);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstFailure = error;
          abortAdmission();
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => worker()),
  );
  if (failed) throw firstFailure;
  if (controller.signal.aborted) return fail('SOURCE_UNAVAILABLE');
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
