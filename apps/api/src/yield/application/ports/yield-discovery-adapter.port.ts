import type {
  NormalizedYieldOpportunityV1,
  YIELD_OPPORTUNITY_SCHEMA_VERSION,
} from '../../domain/normalized-yield-opportunity';

export const YIELD_DISCOVERY_ADAPTER_VERSION = 1 as const;
export const YIELD_DISCOVERY_ADAPTER = Symbol('YIELD_DISCOVERY_ADAPTER');

export interface YieldDiscoveryRequestV1 {
  /** Canonical timestamp supplied by the polling application, not by the adapter clock. */
  readonly requestedAt: string;
  /** Opaque provider cursor returned by the previous page. */
  readonly cursor: string | null;
}

export interface YieldDiscoveryPageV1 {
  readonly adapterVersion: typeof YIELD_DISCOVERY_ADAPTER_VERSION;
  readonly opportunitySchemaVersion: typeof YIELD_OPPORTUNITY_SCHEMA_VERSION;
  readonly providerId: string;
  readonly discoveredAt: string;
  readonly nextCursor: string | null;
  readonly opportunities: readonly NormalizedYieldOpportunityV1[];
}

/**
 * Provider implementations may fetch and map however their approved transport
 * requires, but raw provider records must never escape this interface.
 */
export interface YieldDiscoveryAdapterV1 {
  readonly adapterVersion: typeof YIELD_DISCOVERY_ADAPTER_VERSION;
  readonly opportunitySchemaVersion: typeof YIELD_OPPORTUNITY_SCHEMA_VERSION;
  readonly providerId: string;
  discover(request: YieldDiscoveryRequestV1): Promise<YieldDiscoveryPageV1>;
}

export type YieldDiscoveryAdapter = YieldDiscoveryAdapterV1;
