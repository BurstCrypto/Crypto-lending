import * as evidenceRecorderModule from './provider-position-chain-anchor-evidence-recorder.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
  type ProviderPositionChainAnchorEvidenceRecorderPort,
  type ProviderPositionChainAnchorEvidenceRecordReceiptV1,
  type RecordProviderPositionChainAnchorEvidenceRequestV1,
} from './provider-position-chain-anchor-evidence-recorder.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
  type ProduceProviderPositionChainAnchorEvidenceRequestV1,
} from '../dormant-provider-position-chain-anchor-evidence.producer';

const ETHEREUM_MAINNET = 'eip155:1' as const;
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const SHA256 = 'a'.repeat(64);

type ExpectedRequestKey =
  | 'recorderVersion'
  | 'use'
  | 'mayAuthorizeFinancialAction'
  | 'producerCapability'
  | 'producerRequest'
  | 'signal';
type RequestKeysAreExact = [keyof RecordProviderPositionChainAnchorEvidenceRequestV1] extends [
  ExpectedRequestKey,
]
  ? [ExpectedRequestKey] extends [keyof RecordProviderPositionChainAnchorEvidenceRequestV1]
    ? true
    : false
  : false;
type ExpectedReceiptKey =
  | 'recorderVersion'
  | 'use'
  | 'mayAuthorizeFinancialAction'
  | 'recordOutcome'
  | 'recordedEvidenceFingerprintSha256'
  | 'evidenceRecordedAt';
type ReceiptKeysAreExact = [keyof ProviderPositionChainAnchorEvidenceRecordReceiptV1] extends [
  ExpectedReceiptKey,
]
  ? [ExpectedReceiptKey] extends [keyof ProviderPositionChainAnchorEvidenceRecordReceiptV1]
    ? true
    : false
  : false;
type RequestMayAuthorizeIsFalse =
  RecordProviderPositionChainAnchorEvidenceRequestV1['mayAuthorizeFinancialAction'] extends false
    ? true
    : false;
type ReceiptMayAuthorizeIsFalse =
  ProviderPositionChainAnchorEvidenceRecordReceiptV1['mayAuthorizeFinancialAction'] extends false
    ? true
    : false;
type RequestHasMayPersist =
  'mayPersist' extends keyof RecordProviderPositionChainAnchorEvidenceRequestV1 ? true : false;
type ReceiptHasMayPersist =
  'mayPersist' extends keyof ProviderPositionChainAnchorEvidenceRecordReceiptV1 ? true : false;
type RequestHasRecordArguments =
  'recordArguments' extends keyof RecordProviderPositionChainAnchorEvidenceRequestV1 ? true : false;
type RequestHasProducerVerifier =
  'producerVerifier' extends keyof RecordProviderPositionChainAnchorEvidenceRequestV1
    ? true
    : false;
type RecordResult = Awaited<
  ReturnType<ProviderPositionChainAnchorEvidenceRecorderPort['recordEvidence']>
>;
type RecordResultHasStructuralFields = 'recordOutcome' extends keyof RecordResult ? true : false;

const REQUEST_MAY_AUTHORIZE_IS_FALSE: RequestMayAuthorizeIsFalse = true;
const RECEIPT_MAY_AUTHORIZE_IS_FALSE: ReceiptMayAuthorizeIsFalse = true;
const REQUEST_KEYS_ARE_EXACT: RequestKeysAreExact = true;
const RECEIPT_KEYS_ARE_EXACT: ReceiptKeysAreExact = true;
const REQUEST_HAS_MAY_PERSIST: RequestHasMayPersist = false;
const RECEIPT_HAS_MAY_PERSIST: ReceiptHasMayPersist = false;
const REQUEST_HAS_RECORD_ARGUMENTS: RequestHasRecordArguments = false;
const REQUEST_HAS_PRODUCER_VERIFIER: RequestHasProducerVerifier = false;
const RECORD_RESULT_HAS_STRUCTURAL_FIELDS: RecordResultHasStructuralFields = false;

function producerRequest(
  networkId: typeof ETHEREUM_MAINNET | typeof SOLANA_MAINNET,
  signal: AbortSignal,
): ProduceProviderPositionChainAnchorEvidenceRequestV1 {
  if (networkId === ETHEREUM_MAINNET) {
    return Object.freeze({
      producerVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
      use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      networkId,
      sourceFamilyId: 'ethereum-rpc-family-a',
      sourceId: 'ethereum-rpc-primary',
      sourceKind: 'RPC',
      sourceObservationId: 'ethereum-block-50000001',
      continuityFloor: Object.freeze({
        kind: 'EVM_BLOCK',
        blockNumber: '50000000',
        blockHash: `0x${'1'.repeat(64)}`,
      }),
      chainAnchor: Object.freeze({
        kind: 'EVM_BLOCK',
        blockNumber: '50000001',
        blockHash: `0x${'2'.repeat(64)}`,
      }),
      observedAt: '2026-09-05T16:59:50.000Z',
      deadlineAt: '2026-09-05T17:00:05.000Z',
      signal,
    });
  }
  return Object.freeze({
    producerVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    networkId,
    sourceFamilyId: 'solana-rpc-family-b',
    sourceId: 'solana-rpc-secondary',
    sourceKind: 'RPC',
    sourceObservationId: 'solana-slot-441990796',
    continuityFloor: Object.freeze({
      kind: 'SOLANA_SLOT',
      slot: '441990700',
      root: '441990699',
    }),
    chainAnchor: Object.freeze({
      kind: 'SOLANA_SLOT',
      slot: '441990796',
      root: '441990700',
    }),
    observedAt: '2026-09-05T16:59:55.000Z',
    deadlineAt: '2026-09-05T17:00:05.000Z',
    signal,
  });
}

function recordRequest(
  producerCapability: unknown,
  originalProducerRequest: ProduceProviderPositionChainAnchorEvidenceRequestV1,
): RecordProviderPositionChainAnchorEvidenceRequestV1 {
  return Object.freeze({
    recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
    mayAuthorizeFinancialAction: false,
    producerCapability,
    producerRequest: originalProducerRequest,
    signal: originalProducerRequest.signal,
  });
}

describe('ProviderPositionChainAnchorEvidenceRecorderPort', () => {
  it('is an authority-free dormant type boundary with no persistence grant or duplicate data', () => {
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION).toBe(1);
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_ONLY',
    );
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_ONLY',
    );
    expect(REQUEST_MAY_AUTHORIZE_IS_FALSE).toBe(true);
    expect(RECEIPT_MAY_AUTHORIZE_IS_FALSE).toBe(true);
    expect(REQUEST_KEYS_ARE_EXACT).toBe(true);
    expect(RECEIPT_KEYS_ARE_EXACT).toBe(true);
    expect(REQUEST_HAS_MAY_PERSIST).toBe(false);
    expect(RECEIPT_HAS_MAY_PERSIST).toBe(false);
    expect(REQUEST_HAS_RECORD_ARGUMENTS).toBe(false);
    expect(REQUEST_HAS_PRODUCER_VERIFIER).toBe(false);
    expect(RECORD_RESULT_HAS_STRUCTURAL_FIELDS).toBe(false);
    expect(Object.keys(evidenceRecorderModule).sort()).toEqual([
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION',
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_USE',
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE',
    ]);
  });

  it('returns an opaque receipt bound to exact capability, request and signal identities', async () => {
    const issuedProducerRequests = new WeakMap<
      object,
      ProduceProviderPositionChainAnchorEvidenceRequestV1
    >();
    const issuedReceipts = new WeakMap<
      object,
      RecordProviderPositionChainAnchorEvidenceRequestV1
    >();
    const recorder: ProviderPositionChainAnchorEvidenceRecorderPort = Object.freeze({
      recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
      recordEvidence: jest.fn(
        async (request: RecordProviderPositionChainAnchorEvidenceRequestV1) => {
          if (
            request.mayAuthorizeFinancialAction !== false ||
            request.signal !== request.producerRequest.signal ||
            typeof request.producerCapability !== 'object' ||
            request.producerCapability === null ||
            issuedProducerRequests.get(request.producerCapability) !== request.producerRequest
          ) {
            throw new Error('unavailable');
          }
          const receipt: ProviderPositionChainAnchorEvidenceRecordReceiptV1 = Object.freeze({
            recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
            use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_USE,
            mayAuthorizeFinancialAction: false,
            recordOutcome: 'RECORDED',
            recordedEvidenceFingerprintSha256: SHA256,
            evidenceRecordedAt: '2026-09-05T17:00:01.000Z',
          });
          issuedReceipts.set(receipt, request);
          return receipt;
        },
      ),
      verifyReceipt: (
        capability: unknown,
        request: RecordProviderPositionChainAnchorEvidenceRequestV1,
      ): boolean =>
        typeof capability === 'object' &&
        capability !== null &&
        issuedReceipts.get(capability) === request,
    });

    for (const networkId of [ETHEREUM_MAINNET, SOLANA_MAINNET]) {
      const signal = new AbortController().signal;
      const originalProducerRequest = producerRequest(networkId, signal);
      const producerCapability = Object.freeze({ networkId });
      issuedProducerRequests.set(producerCapability, originalProducerRequest);
      const request = recordRequest(producerCapability, originalProducerRequest);
      const receipt = await recorder.recordEvidence(request);

      expect(recorder.verifyReceipt(receipt, request)).toBe(true);
      expect(recorder.verifyReceipt(structuredClone(receipt), request)).toBe(false);
      expect(recorder.verifyReceipt(receipt, { ...request })).toBe(false);
      expect(
        recorder.verifyReceipt(receipt, {
          ...request,
          producerCapability: structuredClone(producerCapability),
        }),
      ).toBe(false);
      expect(
        recorder.verifyReceipt(receipt, {
          ...request,
          producerRequest: { ...originalProducerRequest },
        }),
      ).toBe(false);
      expect(
        recorder.verifyReceipt(receipt, {
          ...request,
          signal: new AbortController().signal,
        }),
      ).toBe(false);
      expect(request.producerCapability).toBe(producerCapability);
      expect(request.producerRequest).toBe(originalProducerRequest);
      expect(request.signal).toBe(signal);
      expect(request.signal).toBe(request.producerRequest.signal);
      expect(receipt).toEqual({
        recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
        use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_USE,
        mayAuthorizeFinancialAction: false,
        recordOutcome: 'RECORDED',
        recordedEvidenceFingerprintSha256: SHA256,
        evidenceRecordedAt: '2026-09-05T17:00:01.000Z',
      });
      expect(receipt).not.toHaveProperty('mayPersist');
    }

    expect(recorder.recordEvidence).toHaveBeenCalledTimes(2);
    expect(Object.keys(recorder).sort()).toEqual([
      'recordEvidence',
      'recorderVersion',
      'verifyReceipt',
    ]);
    expect(Object.keys(recorder)).not.toEqual(
      expect.arrayContaining([
        'authorize',
        'client',
        'database',
        'execute',
        'grant',
        'persist',
        'query',
        'repository',
        'writer',
      ]),
    );
  });
});
