import { encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_USE,
  DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION,
  type VerifyDormantMainnetSignedSubmissionRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-signed-submission-verifier.port';
import {
  parseDormantMainnetFinancialActionIntent,
  type DormantMainnetFinancialActionIntentInputV1,
} from '../domain/dormant-mainnet-financial-action';
import {
  fingerprintMainnetFinancialActionWriteManifest,
  MainnetFinancialActionWriteManifestMatchError,
  type EthereumMainnetFinancialActionWriteManifestV1,
  type MainnetFinancialActionWriteManifestDraftV1,
} from './mainnet-financial-action-write-manifest';
import {
  DormantMainnetSignedSubmissionVerifierError,
  OfflineDormantMainnetFinancialActionSignedSubmissionVerifier,
} from './offline-dormant-mainnet-financial-action-signed-submission.verifier';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const KEY = `0x${'11'.repeat(32)}` as const;
const WALLET = privateKeyToAccount(KEY);
const MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const ASSET = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

function reviewedManifest<T extends MainnetFinancialActionWriteManifestDraftV1>(
  draft: T,
): T & { readonly reviewedManifestFingerprintSha256: string } {
  return {
    ...draft,
    reviewedManifestFingerprintSha256: fingerprintMainnetFinancialActionWriteManifest(draft),
  };
}

function manifest(): EthereumMainnetFinancialActionWriteManifestV1 {
  return reviewedManifest({
    schemaVersion: 1,
    manifestId: 'test-aave-supply-v1',
    kind: 'ETHEREUM_EIP1559_ABI_CALL',
    networkId: 'eip155:1',
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: MARKET,
    assetRegistryVersion: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version,
    assetRegistryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    assetSymbol: 'USDC',
    assetIdentity: ASSET,
    action: 'SUPPLY',
    transactionTarget: MARKET,
    functionSignature: 'supply(address,uint256,address,uint16)',
    arguments: [
      { encoding: 'ADDRESS', source: 'INTENT_ASSET_IDENTITY' },
      { encoding: 'UINT256', source: 'INTENT_AMOUNT_ATOMIC' },
      { encoding: 'ADDRESS', source: 'INTENT_WALLET_ADDRESS' },
      { encoding: 'UINT16', source: 'STATIC', value: '0' },
    ],
  });
}

async function request(
  signal: AbortSignal = new AbortController().signal,
): Promise<VerifyDormantMainnetSignedSubmissionRequestV1> {
  const input: DormantMainnetFinancialActionIntentInputV1 = {
    schemaVersion: 1,
    intentId: '11111111-1111-4111-8111-111111111111',
    accountId: '22222222-2222-4222-8222-222222222222',
    walletRegistrationId: '33333333-3333-4333-8333-333333333333',
    replayProtectionId: '44444444-4444-4444-8444-444444444444',
    idempotencyKeyDigestSha256: 'ab'.repeat(32),
    networkId: 'eip155:1',
    walletAddress: WALLET.address,
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: MARKET,
    assetRegistryVersion: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version,
    assetRegistryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    assetSymbol: 'USDC',
    assetIdentity: ASSET,
    action: 'SUPPLY',
    amountAtomic: '1000000',
    requestedValueUsdMicros: '1000000',
    maximumNetworkFeeAtomic: '10000000',
    maximumNetworkFeeBasisPoints: 100,
    minimumPostActionNativeBalanceAtomic: '10000',
    allowanceMode: 'EXACT',
    allowanceAmountAtomic: '1000000',
    issuedAt: '2026-09-08T11:59:00.000Z',
    expiresAt: '2026-09-08T12:04:00.000Z',
  };
  const intent = parseDormantMainnetFinancialActionIntent(input, NOW);
  const data = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'supply',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'asset', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'onBehalfOf', type: 'address' },
          { name: 'referralCode', type: 'uint16' },
        ],
        outputs: [],
      },
    ],
    functionName: 'supply',
    args: [ASSET, 1_000_000n, WALLET.address, 0],
  });
  const signedTransaction = await WALLET.signTransaction({
    type: 'eip1559',
    chainId: 1,
    nonce: 1,
    gas: 100_000n,
    maxFeePerGas: 50n,
    maxPriorityFeePerGas: 2n,
    to: MARKET,
    value: 0n,
    data,
  });
  return Object.freeze({
    verifierVersion: DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION,
    use: DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    intentRecordFingerprintSha256: '12'.repeat(32),
    intent,
    wire: Object.freeze({
      networkId: 'eip155:1' as const,
      encoding: 'LOWERCASE_0X_HEX' as const,
      signedTransaction,
    }),
    signal,
  });
}

describe('offline dormant mainnet signed-submission verifier', () => {
  it('issues an opaque one-shot capability bound to the exact request and returns no raw wire', async () => {
    const verifier = new OfflineDormantMainnetFinancialActionSignedSubmissionVerifier([manifest()]);
    const exactRequest = await request();
    const capability = await verifier.verifySubmission(exactRequest);

    expect(capability).toEqual({
      verifierVersion: 1,
      use: 'DORMANT_MAINNET_SIGNED_SUBMISSION_OPAQUE_CAPABILITY_ONLY',
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      apiMaySign: false,
      apiMayBroadcast: false,
    });
    expect(verifier.reviewResult(structuredClone(capability), exactRequest)).toBeNull();
    const result = verifier.reviewResult(capability, exactRequest);
    expect(result).toMatchObject({
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      apiMaySign: false,
      apiMayBroadcast: false,
      mayResendTransaction: false,
      automaticRetryAllowed: false,
      dynamicChainStateVerified: false,
      providerDeploymentVerified: false,
      currentNonceOrBlockhashVerified: false,
      walletBalanceVerified: false,
      signatureScheme: 'ECDSA_SECP256K1_EIP1559',
      staticCommandVerification: 'CRYPTOGRAPHIC_SIGNATURE_AND_EXACT_MANIFEST_MATCH',
      ethereumNonce: '1',
      solanaRecentBlockhash: null,
    });
    expect(verifier.reviewResult(capability, exactRequest)).toBeNull();
    expect(JSON.stringify({ capability, result })).not.toContain(
      exactRequest.wire.signedTransaction,
    );
  });

  it('rejects clones, cross-instance capabilities, aborted requests, and the empty production registry', async () => {
    const verifier = new OfflineDormantMainnetFinancialActionSignedSubmissionVerifier([manifest()]);
    const exactRequest = await request();
    const capabilityForClone = await verifier.verifySubmission(exactRequest);
    expect(verifier.reviewResult(capabilityForClone, { ...exactRequest })).toBeNull();

    const capabilityForOther = await verifier.verifySubmission(exactRequest);
    const other = new OfflineDormantMainnetFinancialActionSignedSubmissionVerifier([manifest()]);
    expect(other.reviewResult(capabilityForOther, exactRequest)).toBeNull();

    const controller = new AbortController();
    controller.abort();
    await expect(
      verifier.verifySubmission(await request(controller.signal)),
    ).rejects.toBeInstanceOf(DormantMainnetSignedSubmissionVerifierError);
    await expect(
      new OfflineDormantMainnetFinancialActionSignedSubmissionVerifier().verifySubmission(
        exactRequest,
      ),
    ).rejects.toBeInstanceOf(MainnetFinancialActionWriteManifestMatchError);
  });

  it('captures injected manifests as immutable exact data before asynchronous verification', async () => {
    const mutableManifest = manifest();
    const verifier = new OfflineDormantMainnetFinancialActionSignedSubmissionVerifier([
      mutableManifest,
    ]);
    Reflect.set(mutableManifest, 'transactionTarget', '0x9999999999999999999999999999999999999999');

    const exactRequest = await request();
    const capability = await verifier.verifySubmission(exactRequest);
    expect(verifier.reviewResult(capability, exactRequest)).not.toBeNull();
  });

  it('rejects accessor-backed injected manifests without invoking accessors', () => {
    let accessed = false;
    const malicious = Object.defineProperty([], '0', {
      enumerable: true,
      configurable: true,
      get() {
        accessed = true;
        return manifest();
      },
    });
    expect(
      () =>
        new OfflineDormantMainnetFinancialActionSignedSubmissionVerifier(
          malicious as unknown as readonly EthereumMainnetFinancialActionWriteManifestV1[],
        ),
    ).toThrow(DormantMainnetSignedSubmissionVerifierError);
    expect(accessed).toBe(false);
  });

  it('rejects hostile request accessors, extra fields, and non-native abort signals', async () => {
    const verifier = new OfflineDormantMainnetFinancialActionSignedSubmissionVerifier([manifest()]);
    const valid = await request();
    let accessed = false;
    const accessorRequest = Object.freeze(
      Object.defineProperty(
        {
          verifierVersion: valid.verifierVersion,
          use: valid.use,
          mayAuthorizeFinancialAction: false,
          mayPersist: false,
          intentRecordFingerprintSha256: valid.intentRecordFingerprintSha256,
          intent: valid.intent,
          wire: valid.wire,
          signal: valid.signal,
        },
        'wire',
        {
          enumerable: true,
          configurable: true,
          get() {
            accessed = true;
            return valid.wire;
          },
        },
      ),
    );
    await expect(
      verifier.verifySubmission(
        accessorRequest as unknown as VerifyDormantMainnetSignedSubmissionRequestV1,
      ),
    ).rejects.toBeInstanceOf(DormantMainnetSignedSubmissionVerifierError);
    expect(accessed).toBe(false);

    await expect(
      verifier.verifySubmission(
        Object.freeze({
          ...valid,
          unreviewedField: true,
        }) as VerifyDormantMainnetSignedSubmissionRequestV1,
      ),
    ).rejects.toBeInstanceOf(DormantMainnetSignedSubmissionVerifierError);
    await expect(
      verifier.verifySubmission(
        Object.freeze({
          ...valid,
          signal: Object.freeze({ aborted: false }),
        }) as unknown as VerifyDormantMainnetSignedSubmissionRequestV1,
      ),
    ).rejects.toBeInstanceOf(DormantMainnetSignedSubmissionVerifierError);

    const accessorWire = Object.freeze(
      Object.defineProperty(
        {
          networkId: valid.wire.networkId,
          encoding: valid.wire.encoding,
          signedTransaction: valid.wire.signedTransaction,
        },
        'signedTransaction',
        {
          enumerable: true,
          configurable: true,
          get() {
            accessed = true;
            return valid.wire.signedTransaction;
          },
        },
      ),
    );
    await expect(
      verifier.verifySubmission(
        Object.freeze({
          ...valid,
          wire: accessorWire,
        }) as unknown as VerifyDormantMainnetSignedSubmissionRequestV1,
      ),
    ).rejects.toBeInstanceOf(DormantMainnetSignedSubmissionVerifierError);
    expect(accessed).toBe(false);
  });

  it.each([
    { schemaVersion: 2 },
    { use: 'FORGED_INTENT_USE' },
    { signingResponsibility: 'API' },
    { apiMayBroadcast: true },
    { intentId: 'not-a-uuid' },
    { amountAtomic: '01' },
    { allowanceAmountAtomic: '999' },
    { expiresAt: '2026-09-08T11:59:00.000Z' },
  ])('rejects a forged or malformed runtime intent projection %#', async (intentOverride) => {
    const verifier = new OfflineDormantMainnetFinancialActionSignedSubmissionVerifier([manifest()]);
    const valid = await request();
    const forged = Object.freeze({
      ...valid,
      intent: Object.freeze({ ...valid.intent, ...intentOverride }),
    }) as unknown as VerifyDormantMainnetSignedSubmissionRequestV1;
    await expect(verifier.verifySubmission(forged)).rejects.toBeInstanceOf(
      DormantMainnetSignedSubmissionVerifierError,
    );
  });
});
