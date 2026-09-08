import * as verifierPortModule from './dormant-mainnet-financial-action-signed-submission-verifier.port';
import {
  DORMANT_MAINNET_SIGNED_SUBMISSION_CAPABILITY_USE,
  DORMANT_MAINNET_SIGNED_SUBMISSION_RESULT_USE,
  DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_USE,
  DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION,
  type DormantMainnetSignedSubmissionCapabilityV1,
} from './dormant-mainnet-financial-action-signed-submission-verifier.port';

describe('dormant mainnet signed-submission verifier port', () => {
  it('exports only inert schema constants and no runtime provider token or implementation', () => {
    expect(DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION).toBe(1);
    expect(DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_USE).toContain('VERIFICATION_ONLY');
    expect(DORMANT_MAINNET_SIGNED_SUBMISSION_CAPABILITY_USE).toContain('OPAQUE_CAPABILITY_ONLY');
    expect(DORMANT_MAINNET_SIGNED_SUBMISSION_RESULT_USE).toContain('DIGEST_EVIDENCE_ONLY');
    expect(Object.keys(verifierPortModule).sort()).toEqual([
      'DORMANT_MAINNET_SIGNED_SUBMISSION_CAPABILITY_USE',
      'DORMANT_MAINNET_SIGNED_SUBMISSION_RESULT_USE',
      'DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_USE',
      'DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION',
    ]);
  });

  it('defines a capability shape that cannot itself grant authority', () => {
    const capability = Object.freeze({
      verifierVersion: DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION,
      use: DORMANT_MAINNET_SIGNED_SUBMISSION_CAPABILITY_USE,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      apiMaySign: false,
      apiMayBroadcast: false,
    }) satisfies DormantMainnetSignedSubmissionCapabilityV1;

    expect(capability).toMatchObject({
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      apiMaySign: false,
      apiMayBroadcast: false,
    });
  });
});
