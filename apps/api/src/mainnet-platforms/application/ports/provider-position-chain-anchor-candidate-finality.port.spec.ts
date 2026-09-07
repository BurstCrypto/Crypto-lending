import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as mainnetPlatformsFeature from '../../index';
import * as finalityPortModule from './provider-position-chain-anchor-candidate-finality.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_ASSESS_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION,
  type AssessProviderPositionChainAnchorCandidateFinalityRequestV1,
  type ProviderPositionChainAnchorCandidateFinalityReason,
  type ProviderPositionChainAnchorCandidateFinalityResultV1,
  type ProviderPositionChainAnchorCandidateFinalityStatus,
} from './provider-position-chain-anchor-candidate-finality.port';

type ExactKeys<T, Expected> = [keyof T] extends [Expected]
  ? [Expected] extends [keyof T]
    ? true
    : false
  : false;
type ExactType<T, Expected> = [T] extends [Expected]
  ? [Expected] extends [T]
    ? true
    : false
  : false;

type ExpectedRequestKeys =
  | 'finalityVersion'
  | 'use'
  | 'mayAuthorizeFinancialAction'
  | 'mayPersist'
  | 'mayCreatePositionSnapshot'
  | 'producerCapability'
  | 'producerRequest'
  | 'signal';
type ExpectedResultKeys =
  | 'finalityVersion'
  | 'use'
  | 'mayAuthorizeFinancialAction'
  | 'mayPersist'
  | 'mayCreatePositionSnapshot'
  | 'networkId'
  | 'sourceObservationId'
  | 'candidateAnchor'
  | 'agreedFinalizedHead'
  | 'status'
  | 'reason'
  | 'authenticatedLineageProof'
  | 'comparedSolanaFinalizedRoot'
  | 'claimsSameSlotForkDetection'
  | 'assessedAt'
  | 'expiresAtExclusive';
type ExactStatus = 'FINALIZED' | 'PENDING' | 'QUARANTINED';
type ExactReason =
  | 'ETHEREUM_FINALIZED_HASH_MATCH'
  | 'ETHEREUM_FINALIZED_LINEAGE_COVERS_CANDIDATE'
  | 'ETHEREUM_FINALIZED_HEIGHT_BELOW_CANDIDATE'
  | 'ETHEREUM_FINALIZED_HASH_CONFLICT'
  | 'SOLANA_FINALIZED_ROOT_COVERS_CANDIDATE_SLOT'
  | 'SOLANA_FINALIZED_ROOT_BELOW_CANDIDATE_SLOT'
  | 'SOLANA_FINALIZED_ROOT_REGRESSION';
type ForbiddenRequestKey = Extract<
  keyof AssessProviderPositionChainAnchorCandidateFinalityRequestV1,
  | 'assessedAt'
  | 'status'
  | 'finalizedHeight'
  | 'finalizedHash'
  | 'finalizedRoot'
  | 'endpoint'
  | 'credential'
  | 'database'
  | 'timer'
>;

const REQUEST_KEYS_ARE_EXACT: ExactKeys<
  AssessProviderPositionChainAnchorCandidateFinalityRequestV1,
  ExpectedRequestKeys
> = true;
const RESULT_KEYS_ARE_EXACT: ExactKeys<
  ProviderPositionChainAnchorCandidateFinalityResultV1,
  ExpectedResultKeys
> = true;
const STATUS_IS_EXACT: ExactType<ProviderPositionChainAnchorCandidateFinalityStatus, ExactStatus> =
  true;
const REASON_IS_EXACT: ExactType<ProviderPositionChainAnchorCandidateFinalityReason, ExactReason> =
  true;
const REQUEST_AUTHORITY_IS_FALSE: ExactType<
  AssessProviderPositionChainAnchorCandidateFinalityRequestV1['mayAuthorizeFinancialAction'],
  false
> = true;
const REQUEST_PERSISTENCE_IS_FALSE: ExactType<
  AssessProviderPositionChainAnchorCandidateFinalityRequestV1['mayPersist'],
  false
> = true;
const REQUEST_SNAPSHOT_IS_FALSE: ExactType<
  AssessProviderPositionChainAnchorCandidateFinalityRequestV1['mayCreatePositionSnapshot'],
  false
> = true;
const RESULT_AUTHORITY_IS_FALSE: ExactType<
  ProviderPositionChainAnchorCandidateFinalityResultV1['mayAuthorizeFinancialAction'],
  false
> = true;
const RESULT_PERSISTENCE_IS_FALSE: ExactType<
  ProviderPositionChainAnchorCandidateFinalityResultV1['mayPersist'],
  false
> = true;
const RESULT_SNAPSHOT_IS_FALSE: ExactType<
  ProviderPositionChainAnchorCandidateFinalityResultV1['mayCreatePositionSnapshot'],
  false
> = true;
const RESULT_FORK_CLAIM_IS_FALSE: ExactType<
  ProviderPositionChainAnchorCandidateFinalityResultV1['claimsSameSlotForkDetection'],
  false
> = true;
const REQUEST_HAS_FORBIDDEN_KEY: ForbiddenRequestKey extends never ? false : true = false;

describe('ProviderPositionChainAnchorCandidateFinalityPort', () => {
  it('pins an exact authority-free, server-timed source-only contract', () => {
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION).toBe(1);
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_ASSESS_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_ASSESS_ONLY',
    );
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_RESULT_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_RESULT_ONLY',
    );
    expect(REQUEST_KEYS_ARE_EXACT).toBe(true);
    expect(RESULT_KEYS_ARE_EXACT).toBe(true);
    expect(STATUS_IS_EXACT).toBe(true);
    expect(REASON_IS_EXACT).toBe(true);
    expect(REQUEST_AUTHORITY_IS_FALSE).toBe(true);
    expect(REQUEST_PERSISTENCE_IS_FALSE).toBe(true);
    expect(REQUEST_SNAPSHOT_IS_FALSE).toBe(true);
    expect(RESULT_AUTHORITY_IS_FALSE).toBe(true);
    expect(RESULT_PERSISTENCE_IS_FALSE).toBe(true);
    expect(RESULT_SNAPSHOT_IS_FALSE).toBe(true);
    expect(RESULT_FORK_CLAIM_IS_FALSE).toBe(true);
    expect(REQUEST_HAS_FORBIDDEN_KEY).toBe(false);
    expect(Object.keys(finalityPortModule).sort()).toEqual([
      'PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_ASSESS_USE',
      'PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_RESULT_USE',
      'PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION',
    ]);
  });

  it('stays dormant and absent from the feature barrel', () => {
    const source = readFileSync(
      join(__dirname, 'provider-position-chain-anchor-candidate-finality.port.ts'),
      'utf8',
    );

    expect(mainnetPlatformsFeature).not.toHaveProperty(
      'PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION',
    );
    expect(source).not.toMatch(
      /@(?:Injectable|Module)|NestFactory|process\.env|fetch\s*\(|setTimeout|setInterval|\.query\s*\(|console\s*\.|logger\s*\.|https?:\/\//u,
    );
    expect(source).not.toMatch(/(?:privateKey|secret|bearer|rawToken|dispatchToken)/iu);
  });
});
