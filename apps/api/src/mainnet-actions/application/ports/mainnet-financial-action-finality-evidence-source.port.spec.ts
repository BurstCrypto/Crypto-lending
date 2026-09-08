import * as sourceModule from './mainnet-financial-action-finality-evidence-source.port';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_READ_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION,
  type MainnetFinancialActionFinalityEvidenceSourcePort,
  type ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
} from './mainnet-financial-action-finality-evidence-source.port';
import { parseWalletAddress } from '../../../wallets/domain/wallet-identity';

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

describe('mainnet financial-action finality evidence source port', () => {
  it('requires an opaque capability authenticated against the exact request object', async () => {
    const issued = new WeakMap<object, ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1>();
    const source = {
      sourceVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION,
      async readAttestation(request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1) {
        const capability = frozen({ opaque: true });
        issued.set(capability, request);
        return capability;
      },
      verifyAttestation(
        capability: unknown,
        request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
      ): boolean {
        return (
          typeof capability === 'object' &&
          capability !== null &&
          issued.get(capability) === request
        );
      },
    } satisfies MainnetFinancialActionFinalityEvidenceSourcePort;
    const signal = new AbortController().signal;
    const request = frozen({
      sourceVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION,
      use: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_READ_USE,
      purpose: 'RECONCILIATION_ADMISSION' as const,
      mayAuthorizeFinancialAction: false as const,
      mayPersist: false as const,
      networkId: 'eip155:1' as const,
      accountId: '31b44706-c302-4779-9c9c-392918b26733',
      intentId: 'e688b11a-9447-449e-a5ed-8a2b186d0cf8',
      intentRecordFingerprintSha256: '1'.repeat(64),
      walletRegistrationId: '900363c6-d27a-4211-838b-465bbde47a37',
      walletAddress: parseWalletAddress('eip155:1', '0x1111111111111111111111111111111111111111'),
      lifecycleRevision: '2',
      lifecycleSnapshotSha256: '2'.repeat(64),
      transactionId: `0x${'3'.repeat(64)}`,
      walletSignedPayloadSha256: '4'.repeat(64),
      walletSignatureEvidenceSha256: '5'.repeat(64),
      chainAnchorEvidenceFingerprintSha256: '6'.repeat(64),
      chainAnchor: frozen({
        kind: 'EVM_BLOCK' as const,
        blockNumber: '100',
        blockHash: `0x${'7'.repeat(64)}`,
      }),
      agreedFinalizedHead: frozen({
        kind: 'EVM_BLOCK' as const,
        blockNumber: '110',
        blockHash: `0x${'8'.repeat(64)}`,
      }),
      sourceAuthorityId: '251d25bf-e176-4cb6-b86e-cc69f43c11ae',
      sourceAuthorityFingerprintSha256: '9'.repeat(64),
      sourcePairApprovalId: 'ethereum-mainnet-pair-v1',
      sourcePairRegistryFingerprintSha256: 'a'.repeat(64),
      sourceFamilyId: 'primary-family',
      sourceId: 'primary-source',
      sourceKind: 'RPC' as const,
      sourceRole: 'PRIMARY' as const,
      deploymentAuthorityId: '3e6409c6-b007-44bc-90bd-c4f83fb35297',
      deploymentAuthorityFingerprintSha256: 'b'.repeat(64),
      deploymentManifestFingerprintSha256: 'c'.repeat(64),
      observedDeploymentIdentityFingerprintSha256: 'd'.repeat(64),
      providerId: 'aave' as const,
      protocolId: 'aave-v3' as const,
      marketId: '0x2222222222222222222222222222222222222222',
      assetRegistryVersion: 1,
      assetRegistryFingerprintSha256:
        'd60250f2b5ff017d534068d34b3acbc81fbe70e75194d32bdad0421783ee34b5',
      assetSymbol: 'USDC' as const,
      assetIdentity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      assetDecimals: 6,
      action: 'SUPPLY' as const,
      amountAtomic: '1000000',
      correlationId: '57861eb3-5276-4584-a93f-d201aa38cab8',
      evaluatedAt: '2026-09-07T17:00:00.000Z',
      deadlineAt: '2026-09-07T17:00:20.000Z',
      observationId: 'c14ec277-e729-498e-ab05-b966d478a126',
      signal,
    }) satisfies ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1;

    const capability = await source.readAttestation(request);
    expect(source.verifyAttestation(capability, request)).toBe(true);
    expect(source.verifyAttestation(structuredClone(capability), request)).toBe(false);
    expect(source.verifyAttestation(capability, { ...request })).toBe(false);
  });

  it('keeps every source declaration authority-free and exposes no implementation', () => {
    expect(MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION).toBe(1);
    expect(MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_READ_USE).toContain('READ_ONLY');
    expect(MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE).toContain(
      'ATTESTATION_ONLY',
    );
    expect(Object.keys(sourceModule)).toEqual([
      'MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION',
      'MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_READ_USE',
      'MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE',
    ]);
  });
});
