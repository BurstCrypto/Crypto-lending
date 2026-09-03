import { PORTFOLIO_BALANCE_READER } from '../../../portfolio/application/ports/portfolio-balance-reader.port';
import { parseAccountId } from '../../../accounts/domain/account-profile';
import {
  MAINNET_PROVIDER_POSITION_READER,
  MAINNET_PROVIDER_POSITION_READER_VERSION,
  type MainnetProviderPositionReader,
} from './mainnet-provider-position-reader.port';
import {
  MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
  type MainnetProviderPositionSnapshotV1,
} from '../../domain/mainnet-provider-position-observation';

describe('MainnetProviderPositionReader port', () => {
  it('is versioned and cannot alias the wallet-balance reader boundary', () => {
    expect(MAINNET_PROVIDER_POSITION_READER_VERSION).toBe(1);
    expect(MAINNET_PROVIDER_POSITION_SCHEMA_VERSION).toBe(1);
    expect(MAINNET_PROVIDER_POSITION_READER).not.toBe(PORTFOLIO_BALANCE_READER);
  });

  it('models an account-scoped read without adding an executable method', async () => {
    const response = Object.freeze({
      schemaVersion: 1,
      use: 'MAINNET_PROVIDER_POSITION_OBSERVATION_ONLY',
      mayAuthorizeFinancialAction: false,
      snapshotId: 'mainnet-provider-position-read',
      observationPolicyVersion: 1,
      observationPolicyId: 'strict-test-policy-v1',
      observationPolicyFingerprintSha256: 'b'.repeat(64),
      assetRegistryVersion: 1,
      assetRegistryFingerprintSha256: 'a'.repeat(64),
      capturedAt: '2026-09-02T17:00:00.000Z',
      staleAfter: '2026-09-02T17:00:45.000Z',
      freshnessClass: 'CURRENT',
      observations: Object.freeze([
        Object.freeze({
          observationId: '11111111-1111-4111-8111-111111111111',
          walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          providerId: 'aave',
          protocolId: 'aave-v3',
          marketId: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
          positionId: 'aave-ethereum-usdc-supply',
          positionKind: 'SUPPLY',
          asset: Object.freeze({
            stablecoin: 'USDC',
            networkId: 'eip155:1',
            identity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            decimals: 6,
          }),
          balance: Object.freeze({ atomic: '5000000', decimal: '5.000000' }),
          source: Object.freeze({
            sourceId: 'ethereum-rpc-primary',
            sourceKind: 'RPC',
            sourceObservationId: 'ethereum-block-50000001',
            chainAnchor: Object.freeze({
              kind: 'EVM_BLOCK',
              blockNumber: '50000001',
              blockHash: `0x${'ab'.repeat(32)}`,
            }),
          }),
          observedAt: '2026-09-02T16:59:45.000Z',
          staleAfter: '2026-09-02T17:00:45.000Z',
          freshnessClass: 'CURRENT',
        }),
      ] as const),
    }) satisfies MainnetProviderPositionSnapshotV1;
    const reader: MainnetProviderPositionReader = {
      readerVersion: 1,
      positionSchemaVersion: 1,
      readCurrentPositions: jest.fn(async () => response),
    };

    await expect(
      reader.readCurrentPositions({
        accountId: parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        evaluatedAt: '2026-09-02T17:00:10.000Z',
        correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).resolves.toBe(response);
    expect(Object.keys(reader).sort()).toEqual([
      'positionSchemaVersion',
      'readCurrentPositions',
      'readerVersion',
    ]);
  });
});
