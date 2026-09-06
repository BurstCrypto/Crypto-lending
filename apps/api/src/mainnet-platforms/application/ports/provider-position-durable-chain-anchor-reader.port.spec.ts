import { parseAccountId } from '../../../accounts/domain/account-profile';
import * as durableAnchorReaderModule from './provider-position-durable-chain-anchor-reader.port';
import {
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE,
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE,
  type ProviderPositionDurableChainAnchorAssessmentV1,
  type ProviderPositionDurableChainAnchorNetworkId,
  type ProviderPositionDurableChainAnchorReaderPort,
  type ReadProviderPositionDurableChainAnchorRequestV1,
} from './provider-position-durable-chain-anchor-reader.port';

const ETHEREUM_MAINNET = 'eip155:1' as const;
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const SHA256 = 'a'.repeat(64);

type ExpectedNetworkId = typeof ETHEREUM_MAINNET | typeof SOLANA_MAINNET;
type NetworkIdIsExact = [ProviderPositionDurableChainAnchorNetworkId] extends [ExpectedNetworkId]
  ? [ExpectedNetworkId] extends [ProviderPositionDurableChainAnchorNetworkId]
    ? true
    : false
  : false;
type BaseIsAccepted = 'eip155:8453' extends ProviderPositionDurableChainAnchorNetworkId
  ? true
  : false;
type RequestMayPersistIsFalse =
  ReadProviderPositionDurableChainAnchorRequestV1['mayPersist'] extends false ? true : false;
type RequestMayAuthorizeIsFalse =
  ReadProviderPositionDurableChainAnchorRequestV1['mayAuthorizeFinancialAction'] extends false
    ? true
    : false;
type AssessmentMayPersistIsFalse =
  ProviderPositionDurableChainAnchorAssessmentV1['mayPersist'] extends false ? true : false;
type AssessmentMayAuthorizeIsFalse =
  ProviderPositionDurableChainAnchorAssessmentV1['mayAuthorizeFinancialAction'] extends false
    ? true
    : false;
type ReadResult = Awaited<ReturnType<ProviderPositionDurableChainAnchorReaderPort['readAnchor']>>;
type ReadResultHasStructuralFields = 'networkId' extends keyof ReadResult ? true : false;

const NETWORK_ID_IS_EXACT: NetworkIdIsExact = true;
const BASE_IS_ACCEPTED: BaseIsAccepted = false;
const REQUEST_MAY_PERSIST_IS_FALSE: RequestMayPersistIsFalse = true;
const REQUEST_MAY_AUTHORIZE_IS_FALSE: RequestMayAuthorizeIsFalse = true;
const ASSESSMENT_MAY_PERSIST_IS_FALSE: AssessmentMayPersistIsFalse = true;
const ASSESSMENT_MAY_AUTHORIZE_IS_FALSE: AssessmentMayAuthorizeIsFalse = true;
const READ_RESULT_HAS_STRUCTURAL_FIELDS: ReadResultHasStructuralFields = false;

const ACCOUNT_ID = parseAccountId('99999999-9999-4999-8999-999999999999');

function ethereumRequest(): ReadProviderPositionDurableChainAnchorRequestV1 {
  return Object.freeze({
    readerVersion: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
    use: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    accountId: ACCOUNT_ID,
    correlationId: 'provider-position-anchor-ethereum-1',
    candidateFingerprintSha256: SHA256,
    targetId: 'ethereum-target-1',
    walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
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
    capturedAt: '2026-09-05T17:00:00.000Z',
    evaluatedAt: '2026-09-05T17:00:01.000Z',
    deadlineAt: '2026-09-05T17:00:05.000Z',
    signal: new AbortController().signal,
  });
}

function solanaRequest(): ReadProviderPositionDurableChainAnchorRequestV1 {
  return Object.freeze({
    readerVersion: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
    use: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    accountId: ACCOUNT_ID,
    correlationId: 'provider-position-anchor-solana-1',
    candidateFingerprintSha256: SHA256,
    targetId: 'solana-target-1',
    walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    providerId: 'jupiter',
    protocolId: 'jupiter-lend',
    marketId: 'JupiterUsdcEarnVault',
    networkId: SOLANA_MAINNET,
    sourceFamilyId: 'solana-rpc-family-a',
    sourceId: 'solana-rpc-primary',
    sourceKind: 'RPC',
    sourceObservationId: 'solana-slot-441990796',
    continuityFloor: Object.freeze({ kind: 'SOLANA_SLOT', slot: '441990700', root: '441990699' }),
    chainAnchor: Object.freeze({ kind: 'SOLANA_SLOT', slot: '441990796', root: '441990700' }),
    observedAt: '2026-09-05T16:59:55.000Z',
    capturedAt: '2026-09-05T17:00:00.000Z',
    evaluatedAt: '2026-09-05T17:00:01.000Z',
    deadlineAt: '2026-09-05T17:00:05.000Z',
    signal: new AbortController().signal,
  });
}

function assessmentFor(
  request: ReadProviderPositionDurableChainAnchorRequestV1,
): ProviderPositionDurableChainAnchorAssessmentV1 {
  return Object.freeze({
    readerVersion: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
    use: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    networkId: request.networkId,
    continuityFloor: request.continuityFloor,
    chainAnchor: request.chainAnchor,
    assessedAt: request.capturedAt,
    identityStatus: 'VERIFIED',
    progressionStatus: 'CURRENT',
    finalityStatus: 'HEALTHY',
  });
}

describe('ProviderPositionDurableChainAnchorReaderPort', () => {
  it('is an exact Ethereum/Solana-only, authority-free type boundary', () => {
    expect(PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION).toBe(1);
    expect(PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE).toBe(
      'DORMANT_PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_ONLY',
    );
    expect(PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE).toBe(
      'DORMANT_PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_ONLY',
    );
    expect(NETWORK_ID_IS_EXACT).toBe(true);
    expect(BASE_IS_ACCEPTED).toBe(false);
    expect(REQUEST_MAY_PERSIST_IS_FALSE).toBe(true);
    expect(REQUEST_MAY_AUTHORIZE_IS_FALSE).toBe(true);
    expect(ASSESSMENT_MAY_PERSIST_IS_FALSE).toBe(true);
    expect(ASSESSMENT_MAY_AUTHORIZE_IS_FALSE).toBe(true);
    expect(READ_RESULT_HAS_STRUCTURAL_FIELDS).toBe(false);
    expect(Object.keys(durableAnchorReaderModule).sort()).toEqual([
      'PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE',
      'PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION',
      'PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE',
    ]);
  });

  it('returns only an opaque capability verified against the exact read request', async () => {
    const issuedRequests = new WeakMap<object, ReadProviderPositionDurableChainAnchorRequestV1>();
    const reader: ProviderPositionDurableChainAnchorReaderPort = Object.freeze({
      readerVersion: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
      readAnchor: jest.fn(async (request: ReadProviderPositionDurableChainAnchorRequestV1) => {
        if (request.mayPersist !== false || request.mayAuthorizeFinancialAction !== false) {
          throw new Error('unavailable');
        }
        const capability = assessmentFor(request);
        issuedRequests.set(capability, request);
        return capability;
      }),
      verifyAnchor: (
        capability: unknown,
        request: ReadProviderPositionDurableChainAnchorRequestV1,
      ): boolean =>
        typeof capability === 'object' &&
        capability !== null &&
        issuedRequests.get(capability) === request,
    });

    for (const request of [ethereumRequest(), solanaRequest()]) {
      const capability = await reader.readAnchor(request);

      expect(reader.verifyAnchor(capability, request)).toBe(true);
      expect(reader.verifyAnchor(structuredClone(capability), request)).toBe(false);
      expect(reader.verifyAnchor(capability, { ...request })).toBe(false);
      expect(reader.verifyAnchor(capability, { ...request, capturedAt: request.observedAt })).toBe(
        false,
      );
      expect(capability).toEqual(
        expect.objectContaining({
          mayAuthorizeFinancialAction: false,
          mayPersist: false,
          networkId: request.networkId,
          continuityFloor: request.continuityFloor,
          chainAnchor: request.chainAnchor,
          assessedAt: request.capturedAt,
        }),
      );
    }

    expect(reader.readAnchor).toHaveBeenCalledTimes(2);
    expect(Object.keys(reader).sort()).toEqual(['readAnchor', 'readerVersion', 'verifyAnchor']);
    expect(Object.keys(reader)).not.toEqual(
      expect.arrayContaining(['authorize', 'client', 'persist', 'repository', 'writer']),
    );
  });
});
