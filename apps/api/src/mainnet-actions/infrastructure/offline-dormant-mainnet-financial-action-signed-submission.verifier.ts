import { isProxy } from 'node:util/types';

import {
  DORMANT_MAINNET_SIGNED_SUBMISSION_CAPABILITY_USE,
  DORMANT_MAINNET_SIGNED_SUBMISSION_RESULT_USE,
  DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_USE,
  DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION,
  type DormantMainnetFinancialActionSignedSubmissionVerifierPort,
  type DormantMainnetSignedSubmissionCapabilityV1,
  type DormantMainnetSignedSubmissionVerificationResultV1,
  type VerifyDormantMainnetSignedSubmissionRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-signed-submission-verifier.port';
import {
  parseDormantMainnetFinancialActionIntent,
  type DormantMainnetFinancialActionIntentInputV1,
  type DormantMainnetFinancialActionIntentV1,
} from '../domain/dormant-mainnet-financial-action';
import { verifyEthereumMainnetSignedTransaction } from '../domain/ethereum-mainnet-signed-transaction.verifier';
import { sha256Framed } from '../domain/mainnet-financial-action-signed-verification-digest';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_WRITE_MANIFESTS,
  fingerprintDormantMainnetSignedVerificationIntent,
  matchMainnetFinancialActionWriteManifest,
  type MainnetFinancialActionWriteManifestV1,
  type VerifiedMainnetFinancialActionSignedCommand,
} from './mainnet-financial-action-write-manifest';
import { verifySolanaMainnetSignedTransaction } from './solana-mainnet-signed-transaction.verifier';

export type DormantMainnetSignedSubmissionVerifierCode =
  | 'INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST'
  | 'SIGNED_SUBMISSION_VERIFICATION_ABORTED'
  | 'SIGNED_SUBMISSION_VERIFICATION_REQUEST_CHANGED';

export class DormantMainnetSignedSubmissionVerifierError extends Error {
  constructor(readonly code: DormantMainnetSignedSubmissionVerifierCode) {
    super(code);
    this.name = 'DormantMainnetSignedSubmissionVerifierError';
  }
}

interface IssuedCapability {
  readonly request: WeakRef<VerifyDormantMainnetSignedSubmissionRequestV1>;
  readonly requestBindingSha256: string;
  readonly result: DormantMainnetSignedSubmissionVerificationResultV1;
}

const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const REQUEST_KEYS = Object.freeze([
  'verifierVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'intentRecordFingerprintSha256',
  'intent',
  'wire',
  'signal',
] as const);
const WIRE_KEYS = Object.freeze(['networkId', 'encoding', 'signedTransaction'] as const);
const INTENT_KEYS = Object.freeze([
  'schemaVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'intentId',
  'accountId',
  'walletRegistrationId',
  'replayProtectionId',
  'idempotencyKeyDigestSha256',
  'networkId',
  'walletAddress',
  'providerId',
  'protocolId',
  'marketId',
  'assetRegistryVersion',
  'assetRegistryFingerprintSha256',
  'assetSymbol',
  'assetIdentity',
  'assetDecimals',
  'action',
  'amountAtomic',
  'requestedValueUsdMicros',
  'maximumNetworkFeeAtomic',
  'maximumNetworkFeeBasisPoints',
  'minimumPostActionNativeBalanceAtomic',
  'allowanceMode',
  'allowanceAmountAtomic',
  'issuedAt',
  'expiresAt',
  'signingResponsibility',
  'broadcastResponsibility',
  'apiMaySign',
  'apiMayBroadcast',
  'crossChainExecutionAllowed',
  'automaticResendAllowed',
  'automaticFeeEscalationAllowed',
  'durableReplayProtectionVerified',
] as const);

function rejected(code: DormantMainnetSignedSubmissionVerifierCode): never {
  throw new DormantMainnetSignedSubmissionVerifierError(code);
}

function requestBindingSha256(request: VerifyDormantMainnetSignedSubmissionRequestV1): string {
  return sha256Framed('CLMA-SIGNED-SUBMISSION-VERIFICATION-REQUEST-1', [
    fingerprintDormantMainnetSignedVerificationIntent(
      request.intentRecordFingerprintSha256,
      request.intent,
    ),
    request.wire.networkId,
    request.wire.encoding,
    sha256Framed('CLMA-TRANSIENT-SIGNED-WIRE-1', [request.wire.signedTransaction]),
  ]);
}

function exactFrozenRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      !Object.isFrozen(value)
    ) {
      return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
    }
    const reviewed = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        descriptor.configurable ||
        !('value' in descriptor) ||
        descriptor.writable
      ) {
        return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
      }
      reviewed[key] = descriptor.value;
    }
    return reviewed;
  } catch (error) {
    if (error instanceof DormantMainnetSignedSubmissionVerifierError) throw error;
    return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
  }
}

function authenticSignal(value: unknown): AbortSignal {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value) ||
      ABORTED_GETTER === undefined
    ) {
      return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
    }
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch {
    return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
  }
}

function aborted(signal: AbortSignal): boolean {
  try {
    return ABORTED_GETTER === undefined || (Reflect.apply(ABORTED_GETTER, signal, []) as boolean);
  } catch {
    return true;
  }
}

function reviewCanonicalIntent(
  record: Record<string, unknown>,
): DormantMainnetFinancialActionIntentV1 {
  if (typeof record.issuedAt !== 'string') {
    return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
  }
  const input = Object.freeze(
    Object.assign(Object.create(null) as DormantMainnetFinancialActionIntentInputV1, {
      schemaVersion: record.schemaVersion,
      intentId: record.intentId,
      accountId: record.accountId,
      walletRegistrationId: record.walletRegistrationId,
      replayProtectionId: record.replayProtectionId,
      idempotencyKeyDigestSha256: record.idempotencyKeyDigestSha256,
      networkId: record.networkId,
      walletAddress: record.walletAddress,
      providerId: record.providerId,
      protocolId: record.protocolId,
      marketId: record.marketId,
      assetRegistryVersion: record.assetRegistryVersion,
      assetRegistryFingerprintSha256: record.assetRegistryFingerprintSha256,
      assetSymbol: record.assetSymbol,
      assetIdentity: record.assetIdentity,
      action: record.action,
      amountAtomic: record.amountAtomic,
      requestedValueUsdMicros: record.requestedValueUsdMicros,
      maximumNetworkFeeAtomic: record.maximumNetworkFeeAtomic,
      maximumNetworkFeeBasisPoints: record.maximumNetworkFeeBasisPoints,
      minimumPostActionNativeBalanceAtomic: record.minimumPostActionNativeBalanceAtomic,
      allowanceMode: record.allowanceMode,
      allowanceAmountAtomic: record.allowanceAmountAtomic,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
    }),
  );
  let parsed: DormantMainnetFinancialActionIntentV1;
  try {
    parsed = parseDormantMainnetFinancialActionIntent(input, new Date(record.issuedAt));
  } catch {
    return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
  }
  for (const key of INTENT_KEYS) {
    if (record[key] !== parsed[key]) {
      return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
    }
  }
  return parsed;
}

function validateRequest(request: VerifyDormantMainnetSignedSubmissionRequestV1): void {
  const reviewedRequest = exactFrozenRecord(request, REQUEST_KEYS);
  const reviewedIntent = exactFrozenRecord(reviewedRequest.intent, INTENT_KEYS);
  const reviewedWire = exactFrozenRecord(reviewedRequest.wire, WIRE_KEYS);
  const signal = authenticSignal(reviewedRequest.signal);
  const canonicalIntent = reviewCanonicalIntent(reviewedIntent);
  if (
    reviewedRequest.verifierVersion !== DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION ||
    reviewedRequest.use !== DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_USE ||
    reviewedRequest.mayAuthorizeFinancialAction !== false ||
    reviewedRequest.mayPersist !== false ||
    reviewedWire.networkId !== canonicalIntent.networkId
  ) {
    return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
  }
  if (
    (request.wire.networkId === 'eip155:1' && request.wire.encoding !== 'LOWERCASE_0X_HEX') ||
    (request.wire.networkId === 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' &&
      request.wire.encoding !== 'CANONICAL_BASE64')
  ) {
    return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
  }
  if (aborted(signal)) return rejected('SIGNED_SUBMISSION_VERIFICATION_ABORTED');
  try {
    requestBindingSha256(request);
  } catch {
    return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

function assertPlainImmutableInputGraph(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== 'object' || value === null) return;
  if (isProxy(value) || seen.has(value)) {
    return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
  }
  const prototype = Object.getPrototypeOf(value);
  const prototypeParent = prototype === null ? null : Object.getPrototypeOf(prototype);
  const prototypeGrandparent =
    prototypeParent === null ? null : Object.getPrototypeOf(prototypeParent);
  const plainRecord = !Array.isArray(value) && (prototype === null || prototypeParent === null);
  const plainArray =
    Array.isArray(value) &&
    prototype !== null &&
    prototypeParent !== null &&
    prototypeGrandparent === null;
  if (!plainRecord && !plainArray) {
    return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
  }
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
      return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
    }
    assertPlainImmutableInputGraph(descriptor.value, seen);
  }
}

/**
 * Pure, no-egress implementation. The optional registry parameter exists for
 * isolated review fixtures; production construction defaults to the immutable
 * empty registry and therefore denies every provider/action.
 */
export class OfflineDormantMainnetFinancialActionSignedSubmissionVerifier implements DormantMainnetFinancialActionSignedSubmissionVerifierPort {
  readonly verifierVersion = DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION;
  private readonly capabilities = new WeakMap<object, IssuedCapability>();
  private readonly registry!: readonly MainnetFinancialActionWriteManifestV1[];

  constructor(
    registry: readonly MainnetFinancialActionWriteManifestV1[] = DORMANT_MAINNET_FINANCIAL_ACTION_WRITE_MANIFESTS,
  ) {
    if (!Array.isArray(registry) || isProxy(registry)) {
      return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
    }
    try {
      assertPlainImmutableInputGraph(registry);
      this.registry = Object.freeze(
        registry.map((manifest) => deepFreeze(structuredClone(manifest))),
      );
    } catch {
      return rejected('INVALID_SIGNED_SUBMISSION_VERIFICATION_REQUEST');
    }
  }

  async verifySubmission(request: VerifyDormantMainnetSignedSubmissionRequestV1): Promise<unknown> {
    validateRequest(request);
    const initialRequestBindingSha256 = requestBindingSha256(request);
    let command: VerifiedMainnetFinancialActionSignedCommand;
    if (request.wire.networkId === 'eip155:1') {
      command = await verifyEthereumMainnetSignedTransaction({
        signedTransaction: request.wire.signedTransaction,
        expectedWalletAddress: request.intent.walletAddress,
        maximumNetworkFeeAtomic: request.intent.maximumNetworkFeeAtomic,
      });
    } else {
      command = verifySolanaMainnetSignedTransaction({
        signedTransactionBase64: request.wire.signedTransaction,
        expectedWalletAddress: request.intent.walletAddress,
      });
    }
    if (aborted(request.signal)) return rejected('SIGNED_SUBMISSION_VERIFICATION_ABORTED');
    const finalRequestBindingSha256 = requestBindingSha256(request);
    if (initialRequestBindingSha256 !== finalRequestBindingSha256) {
      return rejected('SIGNED_SUBMISSION_VERIFICATION_REQUEST_CHANGED');
    }

    const manifestMatch = matchMainnetFinancialActionWriteManifest(
      request.intentRecordFingerprintSha256,
      request.intent,
      command,
      this.registry,
    );
    const result: DormantMainnetSignedSubmissionVerificationResultV1 = Object.freeze({
      verifierVersion: DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION,
      use: DORMANT_MAINNET_SIGNED_SUBMISSION_RESULT_USE,
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
      intentId: request.intent.intentId,
      intentRecordFingerprintSha256: request.intentRecordFingerprintSha256,
      verificationIntentFingerprintSha256: fingerprintDormantMainnetSignedVerificationIntent(
        request.intentRecordFingerprintSha256,
        request.intent,
      ),
      networkId: command.networkId,
      transactionId: command.transactionId,
      signerWalletAddress: command.signerWalletAddress,
      signatureScheme:
        command.kind === 'VERIFIED_ETHEREUM_EIP1559_TRANSACTION'
          ? 'ECDSA_SECP256K1_EIP1559'
          : 'ED25519_SOLANA_TRANSACTION',
      signedEnvelopeSha256: command.signedEnvelopeSha256,
      signingPayloadSha256: command.signingPayloadSha256,
      signatureEvidenceSha256: command.signatureEvidenceSha256,
      chainReplayIdentitySha256: command.chainReplayIdentitySha256,
      providerWriteManifestFingerprintSha256: manifestMatch.providerWriteManifestFingerprintSha256,
      providerActionBindingSha256: manifestMatch.providerActionBindingSha256,
      ethereumNonce:
        command.kind === 'VERIFIED_ETHEREUM_EIP1559_TRANSACTION' ? command.nonce : null,
      solanaRecentBlockhash:
        command.kind === 'VERIFIED_SOLANA_SIGNED_TRANSACTION' ? command.recentBlockhash : null,
      staticCommandVerification: 'CRYPTOGRAPHIC_SIGNATURE_AND_EXACT_MANIFEST_MATCH',
    });
    const capability: DormantMainnetSignedSubmissionCapabilityV1 = Object.freeze({
      verifierVersion: DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION,
      use: DORMANT_MAINNET_SIGNED_SUBMISSION_CAPABILITY_USE,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      apiMaySign: false,
      apiMayBroadcast: false,
    });
    this.capabilities.set(capability, {
      request: new WeakRef(request),
      requestBindingSha256: initialRequestBindingSha256,
      result,
    });
    return capability;
  }

  reviewResult(
    capability: unknown,
    request: VerifyDormantMainnetSignedSubmissionRequestV1,
  ): DormantMainnetSignedSubmissionVerificationResultV1 | null {
    if (typeof capability !== 'object' || capability === null || isProxy(capability)) return null;
    const issued = this.capabilities.get(capability);
    if (issued === undefined) return null;
    this.capabilities.delete(capability);
    try {
      validateRequest(request);
      if (
        issued.request.deref() !== request ||
        aborted(request.signal) ||
        requestBindingSha256(request) !== issued.requestBindingSha256
      ) {
        return null;
      }
      return issued.result;
    } catch {
      return null;
    }
  }
}
