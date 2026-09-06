import * as evidenceSourceModule from './provider-position-chain-anchor-evidence-source.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
  type ProviderPositionChainAnchorEvidenceSourceAttestationV1,
  type ProviderPositionChainAnchorEvidenceSourceNetworkId,
  type ProviderPositionChainAnchorEvidenceSourcePort,
  type ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
} from './provider-position-chain-anchor-evidence-source.port';

const ETHEREUM_MAINNET = 'eip155:1' as const;
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const SHA256 = 'a'.repeat(64);

type ExpectedNetworkId = typeof ETHEREUM_MAINNET | typeof SOLANA_MAINNET;
type NetworkIdIsExact = [ProviderPositionChainAnchorEvidenceSourceNetworkId] extends [
  ExpectedNetworkId,
]
  ? [ExpectedNetworkId] extends [ProviderPositionChainAnchorEvidenceSourceNetworkId]
    ? true
    : false
  : false;
type BaseIsAccepted = 'eip155:8453' extends ProviderPositionChainAnchorEvidenceSourceNetworkId
  ? true
  : false;
type RequestMayPersistIsFalse =
  ReadProviderPositionChainAnchorEvidenceSourceRequestV1['mayPersist'] extends false ? true : false;
type RequestMayAuthorizeIsFalse =
  ReadProviderPositionChainAnchorEvidenceSourceRequestV1['mayAuthorizeFinancialAction'] extends false
    ? true
    : false;
type AttestationMayPersistIsFalse =
  ProviderPositionChainAnchorEvidenceSourceAttestationV1['mayPersist'] extends false ? true : false;
type AttestationMayAuthorizeIsFalse =
  ProviderPositionChainAnchorEvidenceSourceAttestationV1['mayAuthorizeFinancialAction'] extends false
    ? true
    : false;
type ReadResult = Awaited<
  ReturnType<ProviderPositionChainAnchorEvidenceSourcePort['readAttestation']>
>;
type ReadResultHasStructuralFields = 'networkId' extends keyof ReadResult ? true : false;
type RequestHasEndpoint =
  'endpoint' extends keyof ReadProviderPositionChainAnchorEvidenceSourceRequestV1 ? true : false;
type RequestHasCredentials =
  'credentials' extends keyof ReadProviderPositionChainAnchorEvidenceSourceRequestV1 ? true : false;
type RequestHasWallet =
  'walletId' extends keyof ReadProviderPositionChainAnchorEvidenceSourceRequestV1 ? true : false;

const NETWORK_ID_IS_EXACT: NetworkIdIsExact = true;
const BASE_IS_ACCEPTED: BaseIsAccepted = false;
const REQUEST_MAY_PERSIST_IS_FALSE: RequestMayPersistIsFalse = true;
const REQUEST_MAY_AUTHORIZE_IS_FALSE: RequestMayAuthorizeIsFalse = true;
const ATTESTATION_MAY_PERSIST_IS_FALSE: AttestationMayPersistIsFalse = true;
const ATTESTATION_MAY_AUTHORIZE_IS_FALSE: AttestationMayAuthorizeIsFalse = true;
const READ_RESULT_HAS_STRUCTURAL_FIELDS: ReadResultHasStructuralFields = false;
const REQUEST_HAS_ENDPOINT: RequestHasEndpoint = false;
const REQUEST_HAS_CREDENTIALS: RequestHasCredentials = false;
const REQUEST_HAS_WALLET: RequestHasWallet = false;

function ethereumRequest(
  signal: AbortSignal,
  deadlineAt: string,
): ReadProviderPositionChainAnchorEvidenceSourceRequestV1 {
  return Object.freeze({
    sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    networkId: ETHEREUM_MAINNET,
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
    evaluatedAt: '2026-09-05T17:00:00.000Z',
    deadlineAt,
    signal,
  });
}

function solanaRequest(
  signal: AbortSignal,
  deadlineAt: string,
): ReadProviderPositionChainAnchorEvidenceSourceRequestV1 {
  return Object.freeze({
    sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    networkId: SOLANA_MAINNET,
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
    evaluatedAt: '2026-09-05T17:00:00.000Z',
    deadlineAt,
    signal,
  });
}

function attestationFor(
  request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
): ProviderPositionChainAnchorEvidenceSourceAttestationV1 {
  const currentHead =
    request.networkId === ETHEREUM_MAINNET
      ? Object.freeze({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '50000010',
          blockHash: `0x${'3'.repeat(64)}`,
        })
      : Object.freeze({ kind: 'SOLANA_SLOT' as const, slot: '441990810', root: '441990800' });
  const finalizedHead =
    request.networkId === ETHEREUM_MAINNET
      ? Object.freeze({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '49999990',
          blockHash: `0x${'4'.repeat(64)}`,
        })
      : Object.freeze({ kind: 'SOLANA_SLOT' as const, slot: '441990800', root: '441990800' });
  return Object.freeze({
    sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    networkId: request.networkId,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    sourceKind: request.sourceKind,
    sourceObservationId: request.sourceObservationId,
    continuityFloor: request.continuityFloor,
    chainAnchor: request.chainAnchor,
    observedAt: request.observedAt,
    assessedAt: '2026-09-05T17:00:01.000Z',
    currentHead,
    currentHeadAdvancedAt: '2026-09-05T16:59:59.000Z',
    finalizedHead,
    finalizedHeadAdvancedAt: '2026-09-05T16:59:58.000Z',
    identityProofSha256: SHA256,
    liveCapabilityProofSha256: 'b'.repeat(64),
    lineageProofSha256: 'c'.repeat(64),
  });
}

describe('ProviderPositionChainAnchorEvidenceSourcePort', () => {
  it('is an exact Ethereum/Solana-only, authority-free and secret-free type boundary', () => {
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION).toBe(1);
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_ONLY',
    );
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_ONLY',
    );
    expect(NETWORK_ID_IS_EXACT).toBe(true);
    expect(BASE_IS_ACCEPTED).toBe(false);
    expect(REQUEST_MAY_PERSIST_IS_FALSE).toBe(true);
    expect(REQUEST_MAY_AUTHORIZE_IS_FALSE).toBe(true);
    expect(ATTESTATION_MAY_PERSIST_IS_FALSE).toBe(true);
    expect(ATTESTATION_MAY_AUTHORIZE_IS_FALSE).toBe(true);
    expect(READ_RESULT_HAS_STRUCTURAL_FIELDS).toBe(false);
    expect(REQUEST_HAS_ENDPOINT).toBe(false);
    expect(REQUEST_HAS_CREDENTIALS).toBe(false);
    expect(REQUEST_HAS_WALLET).toBe(false);
    expect(Object.keys(evidenceSourceModule).sort()).toEqual([
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE',
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_USE',
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION',
    ]);
  });

  it('returns an opaque capability bound to the exact request, signal and deadline', async () => {
    const issuedRequests = new WeakMap<
      object,
      ReadProviderPositionChainAnchorEvidenceSourceRequestV1
    >();
    const source: ProviderPositionChainAnchorEvidenceSourcePort = Object.freeze({
      sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
      readAttestation: jest.fn(
        async (request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1) => {
          if (request.mayPersist !== false || request.mayAuthorizeFinancialAction !== false) {
            throw new Error('unavailable');
          }
          const capability = attestationFor(request);
          issuedRequests.set(capability, request);
          return capability;
        },
      ),
      verifyAttestation: (
        capability: unknown,
        request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
      ): boolean =>
        typeof capability === 'object' &&
        capability !== null &&
        issuedRequests.get(capability) === request,
    });
    const signal = new AbortController().signal;
    const deadlineAt = '2026-09-05T17:00:05.000Z';

    for (const request of [
      ethereumRequest(signal, deadlineAt),
      solanaRequest(signal, deadlineAt),
    ]) {
      const capability = await source.readAttestation(request);

      expect(source.verifyAttestation(capability, request)).toBe(true);
      expect(source.verifyAttestation(structuredClone(capability), request)).toBe(false);
      expect(source.verifyAttestation(capability, { ...request })).toBe(false);
      expect(
        source.verifyAttestation(capability, {
          ...request,
          signal: new AbortController().signal,
        }),
      ).toBe(false);
      expect(
        source.verifyAttestation(capability, { ...request, deadlineAt: request.evaluatedAt }),
      ).toBe(false);
      expect(request.signal).toBe(signal);
      expect(request.deadlineAt).toBe(deadlineAt);
      expect(capability).toEqual(
        expect.objectContaining({
          mayAuthorizeFinancialAction: false,
          mayPersist: false,
          networkId: request.networkId,
          sourceFamilyId: request.sourceFamilyId,
          sourceId: request.sourceId,
          sourceObservationId: request.sourceObservationId,
          continuityFloor: request.continuityFloor,
          chainAnchor: request.chainAnchor,
          observedAt: request.observedAt,
          assessedAt: '2026-09-05T17:00:01.000Z',
          currentHead: expect.any(Object),
          currentHeadAdvancedAt: '2026-09-05T16:59:59.000Z',
          finalizedHead: expect.any(Object),
          finalizedHeadAdvancedAt: '2026-09-05T16:59:58.000Z',
          identityProofSha256: SHA256,
          liveCapabilityProofSha256: 'b'.repeat(64),
          lineageProofSha256: 'c'.repeat(64),
        }),
      );
    }

    expect(source.readAttestation).toHaveBeenCalledTimes(2);
    expect(Object.keys(source).sort()).toEqual([
      'readAttestation',
      'sourceVersion',
      'verifyAttestation',
    ]);
    expect(Object.keys(source)).not.toEqual(
      expect.arrayContaining([
        'authorize',
        'client',
        'credentials',
        'database',
        'endpoint',
        'persist',
        'repository',
        'url',
        'writer',
      ]),
    );
  });
});
