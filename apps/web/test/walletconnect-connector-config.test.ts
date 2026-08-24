import { describe, expect, it } from 'vitest';

import {
  assertLocalWalletConnectFactory,
  createWalletConnectPairingPresentation,
  parseWalletConnectLocalConfiguration,
  WALLETCONNECT_LOCAL_TRANSPORT_BOUNDARY,
  WalletConnectConnectorError,
} from '../lib/wallets/walletconnect-connector';

const pairingUri = `wc:pairing-topic@2?symKey=${'a'.repeat(64)}&relay-protocol=irn`;

function configuration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'deterministic-local',
    runtimeEnvironment: 'test',
    transportBoundary: WALLETCONNECT_LOCAL_TRANSPORT_BOUNDARY,
    connectorId: 'walletconnect',
    namespace: 'eip155',
    approvedChains: ['eip155:11155111', 'eip155:84532'],
    requiredMethods: ['personal_sign'],
    requiredEvents: ['accountsChanged', 'chainChanged'],
    pairingTimeoutMs: 60_000,
    deepLinks: [
      {
        walletId: 'example-wallet',
        baseUrl: 'https://wallet.example/connect',
        pairingUriParameter: 'uri',
      },
    ],
    ...overrides,
  };
}

describe('local WalletConnect configuration', () => {
  it('accepts and freezes the exact deterministic-local boundary', () => {
    const parsed = parseWalletConnectLocalConfiguration(configuration());

    expect(parsed).toMatchObject({
      mode: 'deterministic-local',
      runtimeEnvironment: 'test',
      connectorId: 'walletconnect',
      namespace: 'eip155',
      pairingTimeoutMs: 60_000,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.approvedChains)).toBe(true);
    expect(Object.isFrozen(parsed.deepLinks[0])).toBe(true);
  });

  it('rejects disabled, vendor, relay, credential, and accessor configuration', () => {
    for (const invalid of [
      configuration({ mode: 'disabled' }),
      configuration({ runtimeEnvironment: 'production' }),
      configuration({ transportBoundary: 'VENDOR_SDK' }),
      { ...configuration(), projectId: 'external-project' },
      { ...configuration(), relayUrl: 'https://relay.example' },
    ]) {
      expect(() => parseWalletConnectLocalConfiguration(invalid)).toThrowError(
        new WalletConnectConnectorError('CONFIGURATION_INVALID'),
      );
    }

    let reads = 0;
    const accessor = { ...configuration() };
    Object.defineProperty(accessor, 'namespace', {
      enumerable: true,
      get: () => {
        reads += 1;
        return 'eip155';
      },
    });
    expect(() => parseWalletConnectLocalConfiguration(accessor)).toThrow(
      'configuration is invalid',
    );
    expect(reads).toBe(0);
  });

  it('rejects wrong-namespace chains, duplicate capabilities, and unsafe links', () => {
    expect(() =>
      parseWalletConnectLocalConfiguration(
        configuration({ approvedChains: ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'] }),
      ),
    ).toThrow('configuration is invalid');
    expect(() =>
      parseWalletConnectLocalConfiguration(
        configuration({ requiredMethods: ['personal_sign', 'personal_sign'] }),
      ),
    ).toThrow('configuration is invalid');
    expect(() =>
      parseWalletConnectLocalConfiguration(
        configuration({
          deepLinks: [
            {
              walletId: 'live-host',
              baseUrl: 'https://wallet.vendor.com/connect',
              pairingUriParameter: 'uri',
            },
          ],
        }),
      ),
    ).toThrow('configuration is invalid');
    expect(() =>
      parseWalletConnectLocalConfiguration(
        configuration({
          deepLinks: [
            {
              walletId: 'unsafe',
              baseUrl: 'javascript:alert(1)',
              pairingUriParameter: 'uri',
            },
          ],
        }),
      ),
    ).toThrow('configuration is invalid');
    expect(() =>
      parseWalletConnectLocalConfiguration(
        configuration({
          deepLinks: [
            {
              walletId: 'unsafe',
              baseUrl: 'https://wallet.example/connect?existing=value',
              pairingUriParameter: 'uri',
            },
          ],
        }),
      ),
    ).toThrow('configuration is invalid');
  });

  it('accepts only canonical KAN-61 Solana CAIP IDs', () => {
    expect(
      parseWalletConnectLocalConfiguration(
        configuration({
          namespace: 'solana',
          approvedChains: ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
        }),
      ).approvedChains,
    ).toEqual(['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1']);

    for (const alias of ['solana:mainnet', 'solana:devnet', 'solana:testnet']) {
      expect(() =>
        parseWalletConnectLocalConfiguration(
          configuration({ namespace: 'solana', approvedChains: [alias as never] }),
        ),
      ).toThrow('configuration is invalid');
    }
  });

  it('builds QR and allowlisted HTTPS deep links without altering the pairing URI', () => {
    const parsed = parseWalletConnectLocalConfiguration(configuration());
    const presentation = createWalletConnectPairingPresentation(
      pairingUri,
      Date.UTC(2026, 7, 24, 18, 5),
      parsed.deepLinks,
    );

    expect(presentation.qrUri).toBe(pairingUri);
    expect(presentation.expiresAt).toBe('2026-08-24T18:05:00.000Z');
    expect(presentation.deepLinks).toEqual([
      {
        walletId: 'example-wallet',
        uri: `https://wallet.example/connect?uri=${encodeURIComponent(pairingUri)}`,
      },
    ]);
    expect(Object.isFrozen(presentation)).toBe(true);
    expect(Object.isFrozen(presentation.deepLinks)).toBe(true);
  });

  it('rejects malformed pairing material with a fixed non-secret error', () => {
    for (const invalid of [
      'https://relay.example/pairing-secret',
      `wc:pairing-topic@2?symKey=${'a'.repeat(64)}`,
      `wc:pairing-topic@2?symKey=${'z'.repeat(64)}&relay-protocol=irn`,
      `wc:pairing-topic@1?symKey=${'a'.repeat(64)}&relay-protocol=irn`,
    ]) {
      let captured: unknown;
      try {
        createWalletConnectPairingPresentation(invalid, Date.now() + 60_000, []);
      } catch (error) {
        captured = error;
      }
      expect(captured).toBeInstanceOf(WalletConnectConnectorError);
      expect(captured).toMatchObject({ code: 'PAIRING_INVALID' });
      expect(String(captured)).not.toContain(invalid);
    }
  });

  it('accepts only the injected deterministic factory marker', () => {
    expect(() =>
      assertLocalWalletConnectFactory({
        boundary: WALLETCONNECT_LOCAL_TRANSPORT_BOUNDARY,
        create: async () => {
          throw new Error('not invoked');
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertLocalWalletConnectFactory({
        boundary: 'VENDOR_SDK',
        create: async () => {
          throw new Error('not invoked');
        },
      } as never),
    ).toThrow('configuration is invalid');
  });
});
