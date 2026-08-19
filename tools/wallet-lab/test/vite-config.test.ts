import { describe, expect, it } from 'vitest';

import {
  assertWalletLabResolvedServer,
  createConnectSources,
  createWalletLabViteConfig,
  WALLET_LAB_ROOT,
} from '../vite.config';

const SERVE_ENV = {
  command: 'serve',
  mode: 'test',
  isSsrBuild: false,
  isPreview: false,
} as const;

describe('wallet lab Vite boundary', () => {
  it('allows only the two configured RPC origins while WalletConnect is gated off', () => {
    const sources = createConnectSources({
      VITE_SEPOLIA_RPC_URL: 'https://sepolia.example.test/private-path',
      VITE_BASE_SEPOLIA_RPC_URL: 'https://base.example.test/rpc',
      VITE_WALLETCONNECT_TERMS_ACCEPTED: 'false',
    });

    expect(sources).toEqual([
      "'self'",
      'ws://127.0.0.1:4173',
      'https://sepolia.example.test',
      'https://base.example.test',
      'https://www.walletlink.org',
      'wss://www.walletlink.org',
    ]);
    expect(sources.join(' ')).not.toMatch(/\bhttps:\s|\bwss:\s/u);
    expect(sources).not.toContain('wss://relay.walletconnect.org');
  });

  it('adds exact WalletConnect service origins only after explicit terms acceptance', () => {
    const sources = createConnectSources({
      VITE_WALLETCONNECT_TERMS_ACCEPTED: 'true',
    });

    expect(sources).toContain('wss://relay.walletconnect.org');
    expect(sources).toContain('https://verify.walletconnect.org');
    expect(sources).not.toContain('https://rpc.walletconnect.org');
    expect(sources).not.toContain('https://rpc.wallet.coinbase.com');
  });

  it('rejects build and preview commands', () => {
    expect(() => createWalletLabViteConfig({ ...SERVE_ENV, command: 'build' })).toThrow(
      /must not produce or serve a build/u,
    );
    expect(() => createWalletLabViteConfig({ ...SERVE_ENV, isPreview: true })).toThrow(
      /must not produce or serve a build/u,
    );
  });

  it('pins the Vite root, filesystem, browser, and HMR boundaries', () => {
    const config = createWalletLabViteConfig(SERVE_ENV);
    expect(config.root).toBe(WALLET_LAB_ROOT);
    expect(config.envDir).toBe(WALLET_LAB_ROOT);
    expect(config.server.headers['Content-Security-Policy']).toContain("worker-src 'none'");
    expect(config.server).toMatchObject({
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      origin: 'http://127.0.0.1:4173',
      allowedHosts: ['127.0.0.1'],
      cors: { origin: 'http://127.0.0.1:4173' },
      hmr: { host: '127.0.0.1', port: 4173, protocol: 'ws' },
      fs: { strict: true, allow: [WALLET_LAB_ROOT] },
    });
  });

  it.each([
    ['wildcard host', { host: '0.0.0.0', port: 4173, strictPort: true }],
    ['wrong port', { host: '127.0.0.1', port: 5173, strictPort: true }],
    ['non-strict port', { host: '127.0.0.1', port: 4173, strictPort: false }],
  ])('rejects a resolved %s override', (_label, server) => {
    expect(() => assertWalletLabResolvedServer({ command: 'serve', server })).toThrow(
      /must bind exactly/u,
    );
  });
});
