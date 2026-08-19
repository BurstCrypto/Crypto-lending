import { describe, expect, it } from 'vitest';

import { resolveWalletLabBootstrapGate } from '../src/bootstrap-gate';

describe('wallet lab bootstrap gate', () => {
  it('opens only for an explicitly enabled development build on loopback', () => {
    expect(
      resolveWalletLabBootstrapGate(
        { DEV: true, VITE_WALLET_LAB_ENABLED: 'true' },
        'http://127.0.0.1:4173',
      ),
    ).toEqual({ enabled: true });
    expect(
      resolveWalletLabBootstrapGate(
        { DEV: false, VITE_WALLET_LAB_ENABLED: 'true' },
        'http://127.0.0.1:4173',
      ),
    ).toMatchObject({ enabled: false, reason: 'development-build-required' });
    expect(
      resolveWalletLabBootstrapGate(
        { DEV: true, VITE_WALLET_LAB_ENABLED: 'true' },
        'https://wallet.example.com',
      ),
    ).toMatchObject({ enabled: false, reason: 'loopback-origin-required' });
  });
});
