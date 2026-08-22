import { Test } from '@nestjs/testing';

import { BlockchainModule } from '../blockchain.module';
import * as registryDomain from '../domain/supported-asset-registry';
import {
  SupportedAssetNormalizationError,
  SupportedAssetNormalizationService,
  type IngressAssetIdentity,
} from './supported-asset-normalization.service';
import type {
  StablecoinAssetDefinition,
  SupportedAssetRegistrySnapshot,
  SupportedAssetRegistrySnapshotDefinition,
} from '../domain/supported-asset-registry';

function snapshotDefinition(
  snapshot: SupportedAssetRegistrySnapshot,
): SupportedAssetRegistrySnapshotDefinition {
  return {
    version: snapshot.version,
    environment: snapshot.environment,
    networks: snapshot.networks.map(({ chain, networkId, activationState }) => ({
      chain,
      networkId,
      activationState,
    })),
    assets: snapshot.assets.map(
      ({ stablecoin, chain, networkId, identity, decimals, activationState }) => ({
        stablecoin,
        chain,
        networkId,
        identity,
        decimals,
        activationState,
      }),
    ),
  };
}

function expectNormalizationCode(work: () => unknown, code: string): void {
  try {
    work();
    throw new Error('expected asset normalization to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(SupportedAssetNormalizationError);
    expect((error as SupportedAssetNormalizationError).code).toBe(code);
  }
}

describe('SupportedAssetNormalizationService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes ingress only through the latest registry and returns its immutable reference', () => {
    const service = new SupportedAssetNormalizationService();
    const latest = registryDomain.MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
    const usdc = latest.assets.find(
      ({ stablecoin, networkId }) => stablecoin === 'USDC' && networkId === 'eip155:1',
    );
    if (!usdc) throw new Error('Expected the mainnet Ethereum USDC fixture');

    const result = service.normalizeIngressAsset({
      environment: 'MAINNET',
      networkId: usdc.networkId,
      identity: usdc.identity.toUpperCase().replace('0X', '0x'),
    });

    expect(result).toMatchObject({
      stablecoin: 'USDC',
      registryEnvironment: 'MAINNET',
      registryVersion: latest.version,
      registryFingerprintSha256: latest.fingerprintSha256,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('fails closed for counterfeit, unsupported, and wrong-network ingress identities', () => {
    const service = new SupportedAssetNormalizationService();
    const ethereumUsdc = registryDomain.MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets.find(
      ({ stablecoin, networkId }) => stablecoin === 'USDC' && networkId === 'eip155:1',
    );
    if (!ethereumUsdc) throw new Error('Expected the mainnet Ethereum USDC fixture');

    for (const input of [
      {
        environment: 'MAINNET' as const,
        networkId: 'eip155:1',
        identity: '0x0000000000000000000000000000000000000001',
      },
      {
        environment: 'MAINNET' as const,
        networkId: 'eip155:8453',
        identity: ethereumUsdc.identity,
      },
      {
        environment: 'TESTNET' as const,
        networkId: 'eip155:11155111',
        identity: ethereumUsdc.identity,
      },
    ]) {
      expectNormalizationCode(() => service.normalizeIngressAsset(input), 'UNSUPPORTED_ASSET');
    }
  });

  it('does not honor an untrusted historical version on the ingress boundary', () => {
    const versionOne = snapshotDefinition(registryDomain.MAINNET_SUPPORTED_ASSET_REGISTRY.latest);
    const target = versionOne.assets[0];
    if (!target) throw new Error('Expected a registry asset fixture');
    const versionTwoAssets: StablecoinAssetDefinition[] = versionOne.assets.map((asset, index) =>
      index === 0 ? { ...asset, activationState: 'INACTIVE' } : asset,
    );
    const history = registryDomain.createVersionedSupportedAssetRegistry([
      versionOne,
      { ...versionOne, version: 2, assets: versionTwoAssets },
    ]);
    const identifyAtVersion = jest.fn((version: number, networkId: string, identity: string) =>
      history.identifyAssetAtVersion(version, networkId, identity),
    );
    jest.spyOn(registryDomain, 'supportedAssetRegistryForEnvironment').mockReturnValue({
      ...history,
      identifyAssetAtVersion: identifyAtVersion,
    });
    const service = new SupportedAssetNormalizationService();
    const forgedDowngrade = {
      environment: 'MAINNET',
      networkId: target.networkId,
      identity: target.identity,
      registryVersion: 1,
    } as unknown as IngressAssetIdentity;

    expectNormalizationCode(
      () => service.normalizeIngressAsset(forgedDowngrade),
      'UNSUPPORTED_ASSET',
    );
    expect(identifyAtVersion).not.toHaveBeenCalled();
  });

  it('identifies trusted history without treating old activation as current support', () => {
    const versionOne = snapshotDefinition(registryDomain.MAINNET_SUPPORTED_ASSET_REGISTRY.latest);
    const target = versionOne.assets[0];
    if (!target) throw new Error('Expected a registry asset fixture');
    const versionTwoAssets: StablecoinAssetDefinition[] = versionOne.assets.map((asset, index) =>
      index === 0 ? { ...asset, activationState: 'INACTIVE' } : asset,
    );
    const history = registryDomain.createVersionedSupportedAssetRegistry([
      versionOne,
      { ...versionOne, version: 2, assets: versionTwoAssets },
    ]);
    jest.spyOn(registryDomain, 'supportedAssetRegistryForEnvironment').mockReturnValue(history);
    const service = new SupportedAssetNormalizationService();

    const result = service.identifyHistoricalAsset({
      environment: 'MAINNET',
      registryVersion: 1,
      networkId: target.networkId,
      identity: target.identity,
    });

    expect(result).toMatchObject({
      historicalAsset: {
        activationState: 'ACTIVE',
        registryEnvironment: 'MAINNET',
        registryVersion: 1,
        registryFingerprintSha256: history.atVersion(1)?.fingerprintSha256,
      },
      currentlySupported: false,
      currentAsset: null,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expectNormalizationCode(
      () =>
        service.identifyHistoricalAsset({
          environment: 'MAINNET',
          registryVersion: 3,
          networkId: target.networkId,
          identity: target.identity,
        }),
      'UNKNOWN_REGISTRY_VERSION',
    );
  });

  it('is exported by BlockchainModule', async () => {
    const moduleReference = await Test.createTestingModule({
      imports: [BlockchainModule],
    }).compile();

    try {
      expect(moduleReference.get(SupportedAssetNormalizationService)).toBeInstanceOf(
        SupportedAssetNormalizationService,
      );
    } finally {
      await moduleReference.close();
    }
  });
});
