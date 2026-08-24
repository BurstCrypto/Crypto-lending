import type { ChainObservationNetworkId } from '../../domain/chain-observation-policy';
import type { AssetRegistryEnvironment } from '../../domain/supported-asset-registry';

export interface SolanaCanonicalReadCapabilityContext {
  readonly environment: AssetRegistryEnvironment;
  readonly networkId: ChainObservationNetworkId;
  readonly commitment: 'confirmed';
}

/**
 * Trusted composition-root boundary for a future KAN-251 capability record.
 * Request data is deliberately opaque: a caller-provided boolean or JSON shape
 * cannot self-authorize canonical reads.
 */
export interface SolanaCanonicalReadCapabilityVerifierPort {
  verify(capability: unknown, context: SolanaCanonicalReadCapabilityContext): boolean;
}
