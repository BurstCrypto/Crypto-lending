import type {
  ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
  ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
} from '../dormant-mainnet-financial-action-finality-evidence.producer';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION,
  MAINNET_FINANCIAL_ACTION_EFFECTIVE_SAFETY_CURSOR_ENCODING,
  type ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
  type RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1,
  type RecordMainnetFinancialActionPostFinalityReviewRequestV1,
} from './dormant-mainnet-financial-action-finality-sidecar-durable.port';

describe('dormant mainnet financial action finality sidecar durable port', () => {
  it('keeps public mutation inputs capability-only and separates review CAS provenance', () => {
    const signal = new AbortController().signal;
    const admissionEvidenceRequest = Object.freeze(
      Object.assign(Object.create(null) as object, {
        signal,
      }),
    ) as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1;
    const reviewEvidenceRequest = Object.freeze(
      Object.assign(Object.create(null) as object, {
        signal,
      }),
    ) as ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1;
    const evidenceCapability = Object.freeze(Object.create(null) as object);
    const readRequest: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1 = Object.freeze({
      accountId: '11111111-1111-4111-8111-111111111111',
      intentId: '22222222-2222-4222-8222-222222222222',
      signal,
    });
    const cursor = Object.freeze(
      Object.assign(Object.create(null) as object, {
        schemaVersion: 1 as const,
        source: 'MIGRATION_0035_DATABASE' as const,
        fingerprintEncoding: MAINNET_FINANCIAL_ACTION_EFFECTIVE_SAFETY_CURSOR_ENCODING,
        accountId: readRequest.accountId,
        intentId: readRequest.intentId,
        networkId: 'eip155:1' as const,
        terminalRevision: '3',
        terminalSnapshotSha256: '1'.repeat(64),
        terminalTransitionFingerprintSha256: '2'.repeat(64),
        originalAdmissionFingerprintSha256: '3'.repeat(64),
        chainTransactionId: `0x${'4'.repeat(64)}`,
        transactionPosition: '100',
        transactionBlockId: `0x${'5'.repeat(64)}`,
        reviewRevision: '0',
        reviewFingerprintSha256: null,
      }),
    );
    const admission: RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1 = {
      evidenceCapability,
      evidenceRequest: admissionEvidenceRequest,
      signal,
    };
    const review: RecordMainnetFinancialActionPostFinalityReviewRequestV1 = {
      evidenceCapability,
      evidenceRequest: reviewEvidenceRequest,
      effectiveSafetyCursor: cursor,
      effectiveSafetyReadRequest: readRequest,
      signal,
    };

    expect(Object.keys(admission).sort()).toEqual(
      ['evidenceCapability', 'evidenceRequest', 'signal'].sort(),
    );
    expect(Object.keys(review).sort()).toEqual(
      [
        'evidenceCapability',
        'evidenceRequest',
        'effectiveSafetyCursor',
        'effectiveSafetyReadRequest',
        'signal',
      ].sort(),
    );
    for (const forbidden of [
      'outcome',
      'disposition',
      'lineageStatus',
      'transactionId',
      'sourceAuthorityId',
      'deploymentAuthorityId',
      'effectEvidenceSha256',
    ]) {
      expect(admission).not.toHaveProperty(forbidden);
      expect(review).not.toHaveProperty(forbidden);
    }
  });

  it('publishes only inert version, result-use, and database cursor encodings', () => {
    expect(DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION).toBe(1);
    expect(DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE).toBe(
      'DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_ONLY',
    );
    expect(MAINNET_FINANCIAL_ACTION_EFFECTIVE_SAFETY_CURSOR_ENCODING).toBe('CLMA-FP-1');
  });
});
