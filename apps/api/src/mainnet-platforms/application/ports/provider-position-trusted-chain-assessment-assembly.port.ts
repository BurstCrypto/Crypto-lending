import type { AccountId } from '../../../accounts/domain/account-profile';
import type { MainnetProviderPositionChainAssessmentVerifierPort } from '../../domain/mainnet-provider-position-chain-assessment';
import type { MainnetProviderPositionObservationV1 } from '../../domain/mainnet-provider-position-observation';
import type {
  ProviderPositionAdmissionAcceptedSourceV1,
  ProviderPositionAdmissionAssemblyCandidateV1,
} from '../provider-position-admission.coordinator';

export const PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION = 1 as const;
export const PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ASSESSMENT_ASSEMBLY_ONLY' as const;

/**
 * Final, immutable observation selection presented to the trusted assessment
 * implementation. This is assembly input only; it is not a parsed snapshot.
 */
export interface ProviderPositionTrustedChainAssessmentSnapshotCandidateV1 {
  readonly schemaVersion: 1;
  readonly use: 'MAINNET_PROVIDER_POSITION_OBSERVATION_ONLY';
  readonly mayAuthorizeFinancialAction: false;
  readonly snapshotId: string;
  readonly observationPolicyVersion: 1;
  readonly observationPolicyId: string;
  readonly observationPolicyFingerprintSha256: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly capturedAt: string;
  readonly staleAfter: string;
  readonly freshnessClass: 'CURRENT';
  readonly observations: readonly MainnetProviderPositionObservationV1[];
}

/** One canonical source selection per covered target, including zero-position targets. */
export interface ProviderPositionTrustedChainAssessmentTargetSourceV1 {
  readonly targetId: string;
  readonly walletId: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly networkId: string;
  readonly source: ProviderPositionAdmissionAcceptedSourceV1;
}

export interface AssembleProviderPositionTrustedChainAssessmentRequestV1 {
  readonly assemblyVersion: typeof PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION;
  readonly use: typeof PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly candidateFingerprintSha256: string;
  readonly coverageManifestFingerprintSha256: string;
  readonly evaluatedAt: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  readonly admissionCandidate: ProviderPositionAdmissionAssemblyCandidateV1;
  readonly positionSnapshot: ProviderPositionTrustedChainAssessmentSnapshotCandidateV1;
  readonly selectedTargetSources: readonly ProviderPositionTrustedChainAssessmentTargetSourceV1[];
}

/**
 * Server-side trust boundary for complete provider-position assembly.
 *
 * `assemble` must independently assess every selected anchor against durable
 * chain identity, progression, and finality state. Its exact returned object
 * is the opaque capability later supplied to `verify`; a clone or
 * deserialized assessment must fail verification. `verifyAssembly` binds that
 * capability to the complete request, including selected anchors for
 * zero-position targets; `verify` additionally binds every normalized output
 * observation. The same injected instance owns all operations so callers
 * cannot select their own verifier.
 *
 * No implementation is registered by this port, and no method grants
 * persistence or financial-action authority.
 */
export interface ProviderPositionTrustedChainAssessmentAssemblyPort extends MainnetProviderPositionChainAssessmentVerifierPort {
  readonly assemblyVersion: typeof PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION;
  assemble(request: AssembleProviderPositionTrustedChainAssessmentRequestV1): Promise<unknown>;
  verifyAssembly(
    capability: unknown,
    request: AssembleProviderPositionTrustedChainAssessmentRequestV1,
  ): boolean;
}
