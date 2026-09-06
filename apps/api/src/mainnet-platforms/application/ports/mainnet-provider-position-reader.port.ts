import type { AccountId } from '../../../accounts/domain/account-profile';
import type { MAINNET_PROVIDER_POSITION_SCHEMA_VERSION } from '../../domain/mainnet-provider-position-observation';
import type {
  MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
  CoveredMainnetProviderPositionSnapshotV1,
} from '../../domain/mainnet-provider-position-coverage';

export const MAINNET_PROVIDER_POSITION_READER_VERSION = 3 as const;
export const MAINNET_PROVIDER_POSITION_READER = Symbol('MAINNET_PROVIDER_POSITION_READER');

export interface ReadMainnetProviderPositionsRequestV3 {
  readonly accountId: AccountId;
  readonly correlationId: string;
}

export interface MainnetProviderPositionReadResultV3 {
  /** Server-authored canonical evaluation time used by the coverage parser. */
  readonly evaluatedAt: string;
  readonly coveredSnapshot: CoveredMainnetProviderPositionSnapshotV1;
}

/**
 * Account-scoped, read-only boundary for normalized lending positions. Raw
 * provider records must not escape an implementation of this port. An
 * implementation must use a server-owned clock, a pinned reviewed policy, and
 * an opaque trusted chain-assessment verifier before returning a
 * coverage-bound snapshot. A bare observation snapshot is never sufficient:
 * zero positions require an exact complete coverage manifest.
 */
export interface MainnetProviderPositionReaderV3 {
  readonly readerVersion: typeof MAINNET_PROVIDER_POSITION_READER_VERSION;
  readonly positionSchemaVersion: typeof MAINNET_PROVIDER_POSITION_SCHEMA_VERSION;
  readonly coverageVersion: typeof MAINNET_PROVIDER_POSITION_COVERAGE_VERSION;
  readCurrentPositions(
    request: ReadMainnetProviderPositionsRequestV3,
  ): Promise<MainnetProviderPositionReadResultV3>;
}

export type MainnetProviderPositionReader = MainnetProviderPositionReaderV3;
