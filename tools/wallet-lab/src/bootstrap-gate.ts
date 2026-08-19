import { WALLET_LAB_ORIGIN } from './local-boundary';

export type WalletLabBootstrapGateReason =
  | 'explicit-enable-required'
  | 'development-build-required'
  | 'loopback-origin-required'
  | 'candidate-commit-required';

function isExactLabOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.origin === WALLET_LAB_ORIGIN;
  } catch {
    return false;
  }
}

/** Pure gate intentionally imports no wallet, chain, or SDK module. */
export function resolveWalletLabBootstrapGate(
  environment: Readonly<{
    DEV?: boolean;
    VITE_WALLET_LAB_ENABLED?: string;
    VITE_WALLET_LAB_CANDIDATE_COMMIT?: string;
  }>,
  origin: string,
):
  Readonly<{ enabled: true }> | Readonly<{ enabled: false; reason: WalletLabBootstrapGateReason }> {
  if (environment.VITE_WALLET_LAB_ENABLED !== 'true') {
    return Object.freeze({ enabled: false, reason: 'explicit-enable-required' });
  }
  if (environment.DEV !== true) {
    return Object.freeze({ enabled: false, reason: 'development-build-required' });
  }
  if (!isExactLabOrigin(origin)) {
    return Object.freeze({ enabled: false, reason: 'loopback-origin-required' });
  }
  if (!/^[0-9a-f]{40}$/iu.test(environment.VITE_WALLET_LAB_CANDIDATE_COMMIT ?? '')) {
    return Object.freeze({ enabled: false, reason: 'candidate-commit-required' });
  }
  return Object.freeze({ enabled: true });
}
