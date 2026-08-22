import { Injectable } from '@nestjs/common';

import {
  supportedAssetRegistryForEnvironment,
  type AssetRegistryEnvironment,
  type SupportedAssetRegistrySnapshot,
  type SupportedStablecoinAsset,
} from '../domain/supported-asset-registry';

export type SupportedAssetNormalizationErrorCode =
  | 'UNSUPPORTED_ASSET'
  | 'UNKNOWN_REGISTRY_VERSION'
  | 'HISTORICAL_ASSET_NOT_FOUND'
  | 'REGISTRY_METADATA_MISMATCH';

export class SupportedAssetNormalizationError extends Error {
  constructor(readonly code: SupportedAssetNormalizationErrorCode) {
    super(code);
    this.name = 'SupportedAssetNormalizationError';
  }
}

export interface IngressAssetIdentity {
  readonly environment: AssetRegistryEnvironment;
  readonly networkId: string;
  readonly identity: string;
}

export interface HistoricalAssetIdentity extends IngressAssetIdentity {
  readonly registryVersion: number;
}

/**
 * Immutable metadata that binds a normalized identity to the exact reviewed
 * registry snapshot that produced it.
 */
export interface SupportedAssetMetadata extends SupportedStablecoinAsset {
  readonly registryEnvironment: AssetRegistryEnvironment;
  readonly registryFingerprintSha256: string;
}

/**
 * Historical identity metadata is deliberately separated from current support.
 * Consumers must use `currentAsset`, not the historical activation flag, when
 * deciding whether new value may enter the platform.
 */
export interface HistoricalAssetIdentification {
  readonly historicalAsset: SupportedAssetMetadata;
  readonly currentlySupported: boolean;
  readonly currentAsset: SupportedAssetMetadata | null;
}

function metadataForSnapshot(
  snapshot: SupportedAssetRegistrySnapshot,
  asset: SupportedStablecoinAsset,
): SupportedAssetMetadata {
  if (asset.registryVersion !== snapshot.version) {
    throw new SupportedAssetNormalizationError('REGISTRY_METADATA_MISMATCH');
  }

  return Object.freeze({
    ...asset,
    registryEnvironment: snapshot.environment,
    registryFingerprintSha256: snapshot.fingerprintSha256,
  });
}

@Injectable()
export class SupportedAssetNormalizationService {
  /**
   * The ingress boundary intentionally exposes no registry-version selector.
   * Untrusted observations can normalize only against the latest reviewed
   * snapshot for their explicit environment.
   */
  normalizeIngressAsset(input: IngressAssetIdentity): SupportedAssetMetadata {
    const registry = supportedAssetRegistryForEnvironment(input.environment);
    const asset = registry.normalizeAsset(input.networkId, input.identity);
    if (!asset) {
      throw new SupportedAssetNormalizationError('UNSUPPORTED_ASSET');
    }
    return metadataForSnapshot(registry.latest, asset);
  }

  /**
   * Trusted replay/audit callers may identify an exact historical snapshot.
   * Historical activation is never projected as current support: that status
   * is derived independently from the latest registry.
   */
  identifyHistoricalAsset(input: HistoricalAssetIdentity): HistoricalAssetIdentification {
    const registry = supportedAssetRegistryForEnvironment(input.environment);
    const snapshot = registry.atVersion(input.registryVersion);
    if (!snapshot) {
      throw new SupportedAssetNormalizationError('UNKNOWN_REGISTRY_VERSION');
    }

    const historicalAsset = registry.identifyAssetAtVersion(
      input.registryVersion,
      input.networkId,
      input.identity,
    );
    if (!historicalAsset) {
      throw new SupportedAssetNormalizationError('HISTORICAL_ASSET_NOT_FOUND');
    }

    const current = registry.normalizeAsset(input.networkId, input.identity);
    const currentAsset = current ? metadataForSnapshot(registry.latest, current) : null;
    return Object.freeze({
      historicalAsset: metadataForSnapshot(snapshot, historicalAsset),
      currentlySupported: currentAsset !== null,
      currentAsset,
    });
  }
}
