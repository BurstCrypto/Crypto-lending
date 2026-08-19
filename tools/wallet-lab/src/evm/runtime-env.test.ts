import { describe, expect, it } from 'vitest';

import { EVM_TESTNET_CHAIN_IDS } from './chains';
import {
  resolveEvmRuntimeSettings,
  type EvmRuntimeEnvironment,
  type ReadyEvmRuntimeSettings,
} from './runtime-env';

const baseEnvironment: EvmRuntimeEnvironment = {
  DEV: true,
  VITE_WALLET_LAB_ENABLED: 'true',
  VITE_WALLETCONNECT_TERMS_ACCEPTED: 'true',
  VITE_WALLETCONNECT_PROJECT_ID: '0123456789abcdef0123456789abcdef',
  VITE_SEPOLIA_RPC_URL: 'https://sepolia.example.test/rpc',
  VITE_BASE_SEPOLIA_RPC_URL: 'https://base-sepolia.example.test/rpc',
};

function expectReady(
  settings: ReturnType<typeof resolveEvmRuntimeSettings>,
): ReadyEvmRuntimeSettings {
  expect(settings.enabled).toBe(true);

  if (!settings.enabled) throw new Error(`Expected a ready runtime, got ${settings.reason}`);

  return settings;
}

describe('resolveEvmRuntimeSettings', () => {
  it('requires all global local-only gates', () => {
    expect(resolveEvmRuntimeSettings({}, 'http://127.0.0.1:4173')).toMatchObject({
      enabled: false,
      reason: 'explicit-enable-required',
    });
    expect(
      resolveEvmRuntimeSettings({ ...baseEnvironment, DEV: false }, 'http://127.0.0.1:4173'),
    ).toMatchObject({ enabled: false, reason: 'development-build-required' });
    expect(resolveEvmRuntimeSettings(baseEnvironment, 'https://wallet.example.com')).toMatchObject({
      enabled: false,
      reason: 'loopback-origin-required',
    });
    expect(resolveEvmRuntimeSettings(baseEnvironment, 'http://localhost:4173')).toMatchObject({
      enabled: false,
      reason: 'loopback-origin-required',
    });
    expect(resolveEvmRuntimeSettings(baseEnvironment, 'http://127.0.0.1:5173')).toMatchObject({
      enabled: false,
      reason: 'loopback-origin-required',
    });
    expect(
      resolveEvmRuntimeSettings(
        { ...baseEnvironment, VITE_SEPOLIA_RPC_URL: 'http://localhost:8545' },
        'http://127.0.0.1:4173',
      ),
    ).toMatchObject({ enabled: false, reason: 'sepolia-https-rpc-required' });
  });

  it('returns only the two testnet RPC mappings when ready', () => {
    const settings = expectReady(
      resolveEvmRuntimeSettings(baseEnvironment, 'http://127.0.0.1:4173'),
    );

    expect(settings.dapp.origin).toBe('http://127.0.0.1:4173');
    expect(
      Object.keys(settings.rpcUrls)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(
      [EVM_TESTNET_CHAIN_IDS.sepolia, EVM_TESTNET_CHAIN_IDS.baseSepolia].sort((a, b) => a - b),
    );
    expect(settings.connectorAvailability).toMatchObject({
      injected: { enabled: true },
      coinbaseWallet: { enabled: true },
      walletConnect: { enabled: true },
    });
  });

  it('disables only WalletConnect unless terms are accepted and its project ID is valid', () => {
    const termsNotAccepted = expectReady(
      resolveEvmRuntimeSettings(
        { ...baseEnvironment, VITE_WALLETCONNECT_TERMS_ACCEPTED: 'false' },
        'http://127.0.0.1:4173',
      ),
    );
    const missing = expectReady(
      resolveEvmRuntimeSettings(
        { ...baseEnvironment, VITE_WALLETCONNECT_PROJECT_ID: undefined },
        'http://127.0.0.1:4173',
      ),
    );
    const invalid = expectReady(
      resolveEvmRuntimeSettings(
        { ...baseEnvironment, VITE_WALLETCONNECT_PROJECT_ID: 'not-a-project-id' },
        'http://127.0.0.1:4173',
      ),
    );

    expect(termsNotAccepted.connectorAvailability.walletConnect).toEqual({
      enabled: false,
      reason: 'walletconnect-terms-not-accepted',
    });
    expect(missing.connectorAvailability).toMatchObject({
      injected: { enabled: true },
      coinbaseWallet: { enabled: true },
      walletConnect: {
        enabled: false,
        reason: 'walletconnect-project-id-missing',
      },
    });
    expect(invalid.connectorAvailability.walletConnect).toEqual({
      enabled: false,
      reason: 'walletconnect-project-id-invalid',
    });
  });
});
