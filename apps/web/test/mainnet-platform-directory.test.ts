import { describe, expect, it } from 'vitest';

import {
  MainnetPlatformDirectoryResponseError,
  parseMainnetPlatformDirectory,
} from '../lib/platforms/mainnet-platform-directory';
import { MAINNET_PLATFORM_DIRECTORY_RESPONSE } from './fixtures/mainnet-platforms';

function cloneResponse(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(MAINNET_PLATFORM_DIRECTORY_RESPONSE)) as Record<string, unknown>;
}

function providers(response: Record<string, unknown>): Array<Record<string, unknown>> {
  return response.providers as Array<Record<string, unknown>>;
}

describe('mainnet platform directory response contract', () => {
  it('accepts ten Ethereum and Solana read-only candidates and returns an immutable copy', () => {
    const parsed = parseMainnetPlatformDirectory(MAINNET_PLATFORM_DIRECTORY_RESPONSE);

    expect(parsed.providers).toHaveLength(10);
    expect(parsed.providers.map(({ name }) => name)).toEqual([
      'Aave',
      'Morpho',
      'Compound',
      'Spark',
      'Euler',
      'Gearbox',
      'Kamino',
      'Save',
      'Project 0',
      'Jupiter',
    ]);
    expect(parsed.mayAuthorizeFinancialAction).toBe(false);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.providers)).toBe(true);
    expect(Object.isFrozen(parsed.providers[0])).toBe(true);
    expect(Object.isFrozen(parsed.providers[0]?.networks)).toBe(true);
    expect(Object.isFrozen(parsed.providers[0]?.networks[0])).toBe(true);
    expect(Object.isFrozen(parsed.providers[0]?.supportedActions)).toBe(true);
  });

  it('rejects fewer than ten candidates and duplicate provider identities', () => {
    const tooFew = cloneResponse();
    tooFew.providers = providers(tooFew).slice(0, 9);
    expect(() => parseMainnetPlatformDirectory(tooFew)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    const duplicateId = cloneResponse();
    providers(duplicateId)[1]!.id = providers(duplicateId)[0]!.id;
    expect(() => parseMainnetPlatformDirectory(duplicateId)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    const duplicateName = cloneResponse();
    providers(duplicateName)[1]!.name = 'AAVE';
    expect(() => parseMainnetPlatformDirectory(duplicateName)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );
  });

  it('rejects unknown fields at every contract level', () => {
    const rootField = cloneResponse();
    rootField.secret = 'not retained';
    expect(() => parseMainnetPlatformDirectory(rootField)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    const providerField = cloneResponse();
    providers(providerField)[0]!.apy = '9.99';
    expect(() => parseMainnetPlatformDirectory(providerField)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    const networkField = cloneResponse();
    const firstProvider = providers(networkField)[0]!;
    const firstNetwork = (firstProvider.networks as Array<Record<string, unknown>>)[0]!;
    firstNetwork.rpcUrl = 'https://secret.example';
    expect(() => parseMainnetPlatformDirectory(networkField)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );
  });

  it('rejects every executable or readiness claim', () => {
    for (const mutate of [
      (response: Record<string, unknown>) => {
        response.mayAuthorizeFinancialAction = true;
      },
      (response: Record<string, unknown>) => {
        providers(response)[0]!.supportedActions = ['SUPPLY'];
      },
      (response: Record<string, unknown>) => {
        providers(response)[0]!.integrationStatus = 'LIVE';
      },
      (response: Record<string, unknown>) => {
        providers(response)[0]!.dataStatus = 'CONNECTED';
      },
      (response: Record<string, unknown>) => {
        providers(response)[0]!.accessStatus = 'AVAILABLE';
      },
      (response: Record<string, unknown>) => {
        providers(response)[0]!.riskStatus = 'APPROVED';
      },
    ]) {
      const response = cloneResponse();
      mutate(response);
      expect(() => parseMainnetPlatformDirectory(response)).toThrow(
        MainnetPlatformDirectoryResponseError,
      );
    }
  });

  it('requires each network identifier to agree with its ecosystem family', () => {
    const mismatchedEvm = cloneResponse();
    (providers(mismatchedEvm)[0]!.networks as Array<Record<string, unknown>>)[0]!.id =
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
    expect(() => parseMainnetPlatformDirectory(mismatchedEvm)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    const mismatchedSolana = cloneResponse();
    (providers(mismatchedSolana)[6]!.networks as Array<Record<string, unknown>>)[0]!.id =
      'eip155:1';
    expect(() => parseMainnetPlatformDirectory(mismatchedSolana)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );
  });

  it('requires the closed v1 provider and canonical network mappings', () => {
    const unknownProvider = cloneResponse();
    providers(unknownProvider)[0]!.id = 'unknown-provider';
    expect(() => parseMainnetPlatformDirectory(unknownProvider)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    const mismatchedProtocol = cloneResponse();
    providers(mismatchedProtocol)[0]!.protocol = 'Aave future version';
    expect(() => parseMainnetPlatformDirectory(mismatchedProtocol)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    const unknownNetwork = cloneResponse();
    (providers(unknownNetwork)[0]!.networks as Array<Record<string, unknown>>)[0]!.id =
      'eip155:999';
    expect(() => parseMainnetPlatformDirectory(unknownNetwork)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    for (const removedNetworkId of ['eip155:56', 'eip155:8453']) {
      const removedNetwork = cloneResponse();
      (providers(removedNetwork)[0]!.networks as Array<Record<string, unknown>>)[0]!.id =
        removedNetworkId;
      expect(() => parseMainnetPlatformDirectory(removedNetwork)).toThrow(
        MainnetPlatformDirectoryResponseError,
      );
    }

    const mismatchedNetworkName = cloneResponse();
    (providers(mismatchedNetworkName)[0]!.networks as Array<Record<string, unknown>>)[0]!.name =
      'Base';
    expect(() => parseMainnetPlatformDirectory(mismatchedNetworkName)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );
  });

  it('rejects inherited records, accessors, sparse arrays, symbols, and hostile proxies', () => {
    const inherited = Object.assign(Object.create({ inherited: true }), cloneResponse());
    expect(() => parseMainnetPlatformDirectory(inherited)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    const accessor = cloneResponse();
    Object.defineProperty(providers(accessor)[0], 'name', {
      enumerable: true,
      get: () => 'Aave',
    });
    expect(() => parseMainnetPlatformDirectory(accessor)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    const sparse = cloneResponse();
    const sparseProviders = providers(sparse);
    delete sparseProviders[4];
    expect(() => parseMainnetPlatformDirectory(sparse)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    const symbolField = cloneResponse();
    Object.defineProperty(symbolField, Symbol('extra'), { enumerable: true, value: 'private' });
    expect(() => parseMainnetPlatformDirectory(symbolField)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );

    const proxy = new Proxy(cloneResponse(), {
      ownKeys: () => {
        throw new Error('hostile trap detail');
      },
    });
    expect(() => parseMainnetPlatformDirectory(proxy)).toThrow(
      MainnetPlatformDirectoryResponseError,
    );
  });
});
