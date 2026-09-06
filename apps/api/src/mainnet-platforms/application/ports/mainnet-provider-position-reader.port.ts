import type { AccountId } from '../../../accounts/domain/account-profile';
import type { MAINNET_PROVIDER_POSITION_SCHEMA_VERSION } from '../../domain/mainnet-provider-position-observation';
import type {
  MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
  CoveredMainnetProviderPositionSnapshotV1,
} from '../../domain/mainnet-provider-position-coverage';

export const MAINNET_PROVIDER_POSITION_READER_VERSION = 2 as const;
export const MAINNET_PROVIDER_POSITION_READER = Symbol('MAINNET_PROVIDER_POSITION_READER');

export interface ReadMainnetProviderPositionsRequestV2 {
  readonly accountId: AccountId;
  /** Server-authored canonical evaluation time used by the snapshot freshness parser. */
  readonly evaluatedAt: string;
  readonly correlationId: string;
}

/**
 * Account-scoped, read-only boundary for normalized lending positions. Raw
 * provider records must not escape an implementation of this port. An
 * implementation must use a server-owned clock, a pinned reviewed policy, and
 * an opaque trusted chain-assessment verifier before returning a
 * coverage-bound snapshot. A bare observation snapshot is never sufficient:
 * zero positions require an exact complete coverage manifest.
 */
export interface MainnetProviderPositionReaderV2 {
  readonly readerVersion: typeof MAINNET_PROVIDER_POSITION_READER_VERSION;
  readonly positionSchemaVersion: typeof MAINNET_PROVIDER_POSITION_SCHEMA_VERSION;
  readonly coverageVersion: typeof MAINNET_PROVIDER_POSITION_COVERAGE_VERSION;
  readCurrentPositions(
    request: ReadMainnetProviderPositionsRequestV2,
  ): Promise<CoveredMainnetProviderPositionSnapshotV1>;
}

export type MainnetProviderPositionReader = MainnetProviderPositionReaderV2;
