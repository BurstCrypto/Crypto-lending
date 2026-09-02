import type { AccountId } from '../../../accounts/domain/account-profile';
import type {
  MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
  MainnetProviderPositionSnapshotV1,
} from '../../domain/mainnet-provider-position-observation';

export const MAINNET_PROVIDER_POSITION_READER_VERSION = 1 as const;
export const MAINNET_PROVIDER_POSITION_READER = Symbol('MAINNET_PROVIDER_POSITION_READER');

export interface ReadMainnetProviderPositionsRequestV1 {
  readonly accountId: AccountId;
  /** Server-authored canonical evaluation time used by the snapshot freshness parser. */
  readonly evaluatedAt: string;
  readonly correlationId: string;
}

/**
 * Account-scoped, read-only boundary for normalized lending positions. Raw
 * provider records must not escape an implementation of this port. An
 * implementation must use a server-owned clock, a pinned reviewed policy, and
 * an opaque trusted chain-assessment verifier before returning a snapshot.
 */
export interface MainnetProviderPositionReaderV1 {
  readonly readerVersion: typeof MAINNET_PROVIDER_POSITION_READER_VERSION;
  readonly positionSchemaVersion: typeof MAINNET_PROVIDER_POSITION_SCHEMA_VERSION;
  readCurrentPositions(
    request: ReadMainnetProviderPositionsRequestV1,
  ): Promise<MainnetProviderPositionSnapshotV1>;
}

export type MainnetProviderPositionReader = MainnetProviderPositionReaderV1;
