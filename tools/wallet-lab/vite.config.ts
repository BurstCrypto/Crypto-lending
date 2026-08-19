import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, loadEnv, type ConfigEnv, type Plugin } from 'vite';
import { WALLET_LAB_HOST, WALLET_LAB_ORIGIN, WALLET_LAB_PORT } from './src/local-boundary.ts';

export const WALLET_LAB_ROOT = dirname(fileURLToPath(import.meta.url));

function httpsOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function createConnectSources(environment: Record<string, string>): readonly string[] {
  const sources = new Set<string>(["'self'", `ws://${WALLET_LAB_HOST}:${WALLET_LAB_PORT}`]);

  for (const candidate of [
    environment.VITE_SEPOLIA_RPC_URL,
    environment.VITE_BASE_SEPOLIA_RPC_URL,
  ]) {
    const origin = httpsOrigin(candidate);
    if (origin) sources.add(origin);
  }

  // Coinbase's EOA mobile transport polls this documented relay endpoint.
  sources.add('https://www.walletlink.org');
  sources.add('wss://www.walletlink.org');

  if (environment.VITE_WALLETCONNECT_TERMS_ACCEPTED === 'true') {
    sources.add('wss://relay.walletconnect.org');
    sources.add('https://verify.walletconnect.com');
    sources.add('https://verify.walletconnect.org');
  }

  return Object.freeze([...sources]);
}

export function assertWalletLabResolvedServer(config: {
  command: string;
  server: { host?: string | boolean; port?: number; strictPort?: boolean };
}): void {
  if (
    config.command !== 'serve' ||
    config.server.host !== WALLET_LAB_HOST ||
    config.server.port !== WALLET_LAB_PORT ||
    config.server.strictPort !== true
  ) {
    throw new Error(
      `Wallet lab must bind exactly to ${WALLET_LAB_ORIGIN}; host, port, and preview overrides are blocked.`,
    );
  }
}

function localOnlyServerGuard(): Plugin {
  return {
    name: 'wallet-lab-local-only-server-guard',
    enforce: 'pre',
    configResolved(config) {
      assertWalletLabResolvedServer(config);
    },
  };
}

export function createWalletLabViteConfig({ command, mode, isPreview }: ConfigEnv) {
  if (command === 'build' || isPreview === true) {
    throw new Error('The wallet lab is localhost-only and must not produce or serve a build.');
  }

  const environment = loadEnv(mode, WALLET_LAB_ROOT, 'VITE_');
  const connectSources = createConnectSources(environment).join(' ');
  const headers = {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy':
      `default-src 'self'; base-uri 'none'; connect-src ${connectSources}; ` +
      "frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; " +
      "script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'none'",
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  } as const;

  return {
    root: WALLET_LAB_ROOT,
    envDir: WALLET_LAB_ROOT,
    plugins: [localOnlyServerGuard()],
    server: {
      host: WALLET_LAB_HOST,
      port: WALLET_LAB_PORT,
      strictPort: true,
      origin: WALLET_LAB_ORIGIN,
      allowedHosts: [WALLET_LAB_HOST],
      cors: { origin: WALLET_LAB_ORIGIN },
      hmr: { host: WALLET_LAB_HOST, port: WALLET_LAB_PORT, protocol: 'ws' },
      headers,
      fs: { strict: true, allow: [WALLET_LAB_ROOT] },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
    },
  };
}

export default defineConfig(createWalletLabViteConfig);
