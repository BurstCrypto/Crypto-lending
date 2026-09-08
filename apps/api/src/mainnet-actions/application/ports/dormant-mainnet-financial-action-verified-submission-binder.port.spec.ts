import * as binderPortModule from './dormant-mainnet-financial-action-verified-submission-binder.port';
import {
  DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION,
  DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_CAPABILITY_USE,
  DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_REQUEST_USE,
  type DormantMainnetVerifiedSubmissionBindCapabilityV1,
} from './dormant-mainnet-financial-action-verified-submission-binder.port';

describe('dormant mainnet verified-submission binder port', () => {
  it('exports only inert schema constants and no provider token or implementation', () => {
    expect(DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION).toBe(1);
    expect(DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_REQUEST_USE).toContain('REQUEST_ONLY');
    expect(DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_CAPABILITY_USE).toContain(
      'OPAQUE_CAPABILITY_ONLY',
    );
    expect(Object.keys(binderPortModule).sort()).toEqual([
      'DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION',
      'DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_CAPABILITY_USE',
      'DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_REQUEST_USE',
    ]);
  });

  it('defines an opaque capability with no financial, persistence, or retry authority', () => {
    const capability = Object.freeze({
      verifiedSubmissionBinderVersion: DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION,
      use: DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_CAPABILITY_USE,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      apiMaySign: false,
      apiMayBroadcast: false,
      mayResendTransaction: false,
      automaticRetryAllowed: false,
    }) satisfies DormantMainnetVerifiedSubmissionBindCapabilityV1;

    expect(capability).toEqual(
      expect.objectContaining({
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        apiMaySign: false,
        apiMayBroadcast: false,
        mayResendTransaction: false,
        automaticRetryAllowed: false,
      }),
    );
    expect(capability).not.toHaveProperty('wire');
    expect(capability).not.toHaveProperty('transactionId');
    expect(capability).not.toHaveProperty('walletAddress');
  });
});
