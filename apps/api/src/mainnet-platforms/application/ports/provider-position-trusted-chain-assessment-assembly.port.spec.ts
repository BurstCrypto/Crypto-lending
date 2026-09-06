import { parseAccountId } from '../../../accounts/domain/account-profile';
import type { MainnetProviderPositionChainAssessmentVerificationContextV1 } from '../../domain/mainnet-provider-position-chain-assessment';
import type { ProviderPositionAdmissionAssemblyCandidateV1 } from '../provider-position-admission.coordinator';
import * as assemblyPortModule from './provider-position-trusted-chain-assessment-assembly.port';
import {
  PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_USE,
  PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION,
  type AssembleProviderPositionTrustedChainAssessmentRequestV1,
  type ProviderPositionTrustedChainAssessmentAssemblyPort,
  type ProviderPositionTrustedChainAssessmentSnapshotCandidateV1,
} from './provider-position-trusted-chain-assessment-assembly.port';

const SHA256 = 'a'.repeat(64);

function verificationContext(): MainnetProviderPositionChainAssessmentVerificationContextV1 {
  return Object.freeze({
    positionSchemaVersion: 1,
    snapshotId: 'provider-position-candidate-1',
    assessmentVersion: 1,
    assessmentId: 'trusted-assessment-1',
    observationPolicyFingerprintSha256: SHA256,
    assetRegistryVersion: 1,
    assetRegistryFingerprintSha256: SHA256,
    observationId: '11111111-1111-4111-8111-111111111111',
    observationFingerprintSha256: SHA256,
    walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
    positionId: 'aave-usdc-supply',
    positionKind: 'SUPPLY',
    stablecoin: 'USDC',
    assetIdentity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    assetDecimals: 6,
    balanceAtomic: '1000000',
    balanceDecimal: '1.000000',
    sourceId: 'rpc-alpha',
    sourceKind: 'RPC',
    sourceObservationId: 'ethereum-block-100',
    networkId: 'eip155:1',
    observationTier: 'PROVISIONAL',
    selector: 'latest',
    authority: 'DISPLAY_ONLY',
    chainAnchor: Object.freeze({
      kind: 'EVM_BLOCK',
      blockNumber: '100',
      blockHash: `0x${'1'.repeat(64)}`,
    }),
    observedAt: '2026-09-05T16:59:50.000Z',
    staleAfter: '2026-09-05T17:00:40.000Z',
    freshnessClass: 'CURRENT',
    assessedAt: '2026-09-05T17:00:00.000Z',
    capturedAt: '2026-09-05T17:00:00.000Z',
    evaluatedAt: '2026-09-05T17:00:01.000Z',
    identityStatus: 'VERIFIED',
    progressionStatus: 'CURRENT',
    finalityStatus: 'HEALTHY',
    mayAuthorizeFinancialAction: false,
  });
}

describe('ProviderPositionTrustedChainAssessmentAssemblyPort', () => {
  it('is a runtime-neutral versioned contract with no registration or implementation export', () => {
    expect(PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION).toBe(1);
    expect(PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ASSESSMENT_ASSEMBLY_ONLY',
    );
    expect(Object.keys(assemblyPortModule).sort()).toEqual([
      'PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_USE',
      'PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION',
    ]);
  });

  it('models one issuer/verifier that rejects a cloned capability and exposes no authority surface', async () => {
    const expectedContext = verificationContext();
    const trustedCapabilities = new WeakMap<object, object>();
    const issuedRequests = new WeakMap<
      object,
      AssembleProviderPositionTrustedChainAssessmentRequestV1
    >();
    const port: ProviderPositionTrustedChainAssessmentAssemblyPort = Object.freeze({
      assemblyVersion: PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION,
      assemble: jest.fn(
        async (request: AssembleProviderPositionTrustedChainAssessmentRequestV1) => {
          if (
            request.mayPersist !== false ||
            request.mayAuthorizeFinancialAction !== false ||
            request.signal.aborted
          ) {
            throw new Error('unavailable');
          }
          const capability = Object.freeze({ assessmentId: 'trusted-assessment-1' });
          trustedCapabilities.set(capability, expectedContext);
          issuedRequests.set(capability, request);
          return capability;
        },
      ),
      verifyAssembly: (
        capability: unknown,
        request: AssembleProviderPositionTrustedChainAssessmentRequestV1,
      ) =>
        typeof capability === 'object' &&
        capability !== null &&
        issuedRequests.get(capability) === request,
      verify: (
        capability: unknown,
        context: MainnetProviderPositionChainAssessmentVerificationContextV1,
      ) =>
        typeof capability === 'object' &&
        capability !== null &&
        trustedCapabilities.get(capability) === context,
    });
    const admissionCandidate = Object.freeze({
      candidateFingerprintSha256: SHA256,
    }) as unknown as ProviderPositionAdmissionAssemblyCandidateV1;
    const positionSnapshot = Object.freeze({
      snapshotId: expectedContext.snapshotId,
      observations: Object.freeze([{ observationId: expectedContext.observationId }]),
    }) as unknown as ProviderPositionTrustedChainAssessmentSnapshotCandidateV1;
    const request: AssembleProviderPositionTrustedChainAssessmentRequestV1 = Object.freeze({
      assemblyVersion: PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION,
      use: PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_USE,
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
      accountId: parseAccountId('99999999-9999-4999-8999-999999999999'),
      correlationId: 'position-read-20260905',
      candidateFingerprintSha256: SHA256,
      coverageManifestFingerprintSha256: SHA256,
      admissionCandidate,
      positionSnapshot,
      selectedTargetSources: Object.freeze([]),
      evaluatedAt: expectedContext.evaluatedAt,
      deadlineAt: '2026-09-05T17:00:05.000Z',
      signal: new AbortController().signal,
    });

    const capability = await port.assemble(request);

    expect(port.verifyAssembly(capability, request)).toBe(true);
    expect(port.verifyAssembly(structuredClone(capability), request)).toBe(false);
    expect(port.verifyAssembly(capability, { ...request })).toBe(false);
    expect(port.verify(capability, expectedContext)).toBe(true);
    expect(port.verify(structuredClone(capability), expectedContext)).toBe(false);
    expect(port.verify(capability, { ...expectedContext })).toBe(false);
    expect(request.admissionCandidate).toBe(admissionCandidate);
    expect(request.positionSnapshot).toBe(positionSnapshot);
    expect(Object.keys(port).sort()).toEqual([
      'assemble',
      'assemblyVersion',
      'verify',
      'verifyAssembly',
    ]);
    expect(Object.keys(port)).not.toEqual(
      expect.arrayContaining([
        'authorize',
        'client',
        'endpoint',
        'persist',
        'repository',
        'writer',
      ]),
    );
  });
});
