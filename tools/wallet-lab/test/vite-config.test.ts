import { resolve } from 'node:path';

import { resolveConfig } from 'vite';
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

const CERTIFICATE_PATH = resolve(WALLET_LAB_ROOT, 'test-certificate.pem');
const PRIVATE_KEY_PATH = resolve(WALLET_LAB_ROOT, 'test-private-key.pem');
const CERTIFICATE_BYTES = Buffer.from('test-certificate');
const PRIVATE_KEY_BYTES = Buffer.from('test-private-key');
const SECURE_ENVIRONMENT = {
  WALLET_LAB_ACCESS_PASSWORD: 'correct-horse-battery-staple-lab',
  WALLET_LAB_ACCESS_USERNAME: 'wallet-lab-reviewer',
  WALLET_LAB_HTTPS_CERT_PATH: CERTIFICATE_PATH,
  WALLET_LAB_HTTPS_KEY_PATH: PRIVATE_KEY_PATH,
} as const;
const CONFIG_DEPENDENCIES = {
  publicEnvironment: {},
  secureEnvironment: SECURE_ENVIRONMENT,
  secureAccess: {
    readFile(path: string) {
      if (path === CERTIFICATE_PATH) return CERTIFICATE_BYTES;
      if (path === PRIVATE_KEY_PATH) return PRIVATE_KEY_BYTES;
      throw new Error('unexpected test path');
    },
    validateTlsMaterial() {},
  },
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
      'wss://127.0.0.1:4173',
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
    const config = createWalletLabViteConfig(SERVE_ENV, CONFIG_DEPENDENCIES);
    expect(config.root).toBe(WALLET_LAB_ROOT);
    expect(config.envDir).toBe(WALLET_LAB_ROOT);
    expect(config.server.headers['Content-Security-Policy']).toContain("worker-src 'none'");
    expect(config.server.headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(config.server.https).toMatchObject({
      cert: CERTIFICATE_BYTES,
      key: PRIVATE_KEY_BYTES,
      minVersion: 'TLSv1.2',
    });
    expect(config.plugins.map((plugin) => plugin.name)).toEqual([
      'wallet-lab-local-only-server-guard',
      'wallet-lab-secure-access',
    ]);
    expect(config.server).toMatchObject({
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      origin: 'https://127.0.0.1:4173',
      allowedHosts: ['127.0.0.1'],
      cors: false,
      ws: { host: '127.0.0.1', port: 4173, protocol: 'wss' },
      fs: { strict: true, allow: [WALLET_LAB_ROOT] },
    });
  });

  it('resolves the Vite HMR transport to WSS on the authenticated HTTPS server', async () => {
    const inlineConfig = createWalletLabViteConfig(SERVE_ENV, CONFIG_DEPENDENCIES);
    const resolved = await resolveConfig({ ...inlineConfig, configFile: false }, 'serve', 'test');

    expect(resolved.server.https).toBeTruthy();
    expect(resolved.server.ws).toMatchObject({
      host: '127.0.0.1',
      port: 4173,
      protocol: 'wss',
    });
  });

  it('fails closed before server startup when secure access is not configured', () => {
    expect(() =>
      createWalletLabViteConfig(SERVE_ENV, {
        publicEnvironment: {},
        secureEnvironment: {},
      }),
    ).toThrow(/WALLET_LAB_HTTPS_CERT_PATH is required/u);
  });

  it.each([
    ['wildcard host', { host: '0.0.0.0' }],
    ['wrong port', { port: 5173 }],
    ['non-strict port', { strictPort: false }],
    ['HTTP origin', { origin: 'http://127.0.0.1:4173' }],
    ['CORS enabled', { cors: true }],
    ['wildcard allowed hosts', { allowedHosts: true }],
    ['insecure HMR', { ws: { host: '127.0.0.1', port: 4173, protocol: 'ws' } }],
  ])('rejects a resolved %s override', (_label, override) => {
    const server = {
      allowedHosts: ['127.0.0.1'],
      cors: false,
      host: '127.0.0.1',
      https: { cert: CERTIFICATE_BYTES, key: PRIVATE_KEY_BYTES },
      origin: 'https://127.0.0.1:4173',
      port: 4173,
      strictPort: true,
      ws: { host: '127.0.0.1', port: 4173, protocol: 'wss' },
      ...override,
    };

    expect(() => assertWalletLabResolvedServer({ command: 'serve', server })).toThrow(
      /authenticated HTTPS exactly/u,
    );
  });
});
