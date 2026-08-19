import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { defineConfig, loadEnv, type ConfigEnv, type Plugin } from 'vite';
import {
  resolveWalletLabSecureAccess,
  type WalletLabAccessDecision,
  type WalletLabAccessVerifier,
  type WalletLabSecureAccessDependencies,
  type WalletLabSecureAccessEnvironment,
} from './server/secure-access.ts';
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
  const sources = new Set<string>(["'self'", `wss://${WALLET_LAB_HOST}:${WALLET_LAB_PORT}`]);

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
  server: {
    allowedHosts?: boolean | readonly string[];
    cors?: unknown;
    host?: string | boolean;
    https?: unknown;
    origin?: string;
    port?: number;
    strictPort?: boolean;
    ws?:
      | false
      | {
          host?: string;
          port?: number;
          protocol?: string;
        };
  };
}): void {
  const ws = config.server.ws;
  const rejected: string[] = [];

  if (config.command !== 'serve') rejected.push('command');
  if (config.server.host !== WALLET_LAB_HOST) rejected.push('host');
  if (config.server.port !== WALLET_LAB_PORT) rejected.push('port');
  if (config.server.strictPort !== true) rejected.push('strict-port');
  if (config.server.origin !== WALLET_LAB_ORIGIN) rejected.push('origin');
  if (!config.server.https) rejected.push('https');
  if (config.server.cors !== false) rejected.push('cors');
  if (
    !Array.isArray(config.server.allowedHosts) ||
    config.server.allowedHosts.length === 0 ||
    config.server.allowedHosts.some((host) => host !== WALLET_LAB_HOST)
  ) {
    rejected.push('allowed-hosts');
  }
  if (!ws || ws.host !== WALLET_LAB_HOST || ws.port !== WALLET_LAB_PORT || ws.protocol !== 'wss') {
    rejected.push('wss');
  }

  if (rejected.length > 0) {
    throw new Error(
      `Wallet lab must use authenticated HTTPS exactly at ${WALLET_LAB_ORIGIN}; rejected boundary fields: ${rejected.join(', ')}.`,
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

function denialStatus(decision: Exclude<WalletLabAccessDecision, { allowed: true }>): Readonly<{
  code: 401 | 403 | 421;
  text: 'Forbidden' | 'Misdirected Request' | 'Unauthorized';
}> {
  if (decision.reason === 'invalid-host') {
    return Object.freeze({ code: 421, text: 'Misdirected Request' });
  }

  if (decision.reason === 'invalid-origin') {
    return Object.freeze({ code: 403, text: 'Forbidden' });
  }

  return Object.freeze({ code: 401, text: 'Unauthorized' });
}

function rejectHttpRequest(
  response: ServerResponse,
  decision: Exclude<WalletLabAccessDecision, { allowed: true }>,
): void {
  const status = denialStatus(decision);
  const body = `${status.text}\n`;

  response.statusCode = status.code;
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (status.code === 401) {
    response.setHeader(
      'WWW-Authenticate',
      'Basic realm="CryptoLending wallet lab", charset="UTF-8"',
    );
  }
  response.end(body);
}

function rejectWebSocketUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  decision: Exclude<WalletLabAccessDecision, { allowed: true }>,
): void {
  const status = denialStatus(decision);
  const challenge =
    status.code === 401
      ? 'WWW-Authenticate: Basic realm="CryptoLending wallet lab", charset="UTF-8"\r\n'
      : '';

  // Vite's listener runs after this pre-listener. Make the rejected request
  // ineligible for its HMR route before closing the socket.
  request.url = '/__wallet_lab_access_denied__';
  request.headers['sec-websocket-protocol'] = 'wallet-lab-access-denied';
  socket.end(
    `HTTP/1.1 ${status.code} ${status.text}\r\n` +
      'Cache-Control: no-store, max-age=0\r\n' +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n' +
      challenge +
      '\r\n',
  );
}

function secureAccessPlugin(access: WalletLabAccessVerifier): Plugin {
  return {
    name: 'wallet-lab-secure-access',
    enforce: 'pre',
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) throw new Error('Wallet lab secure access requires its dedicated server.');

      server.middlewares.use((request, response, next) => {
        const decision = access.authorize(request.headers, 'http');

        if (!decision.allowed) {
          rejectHttpRequest(response, decision);
          return;
        }

        if (decision.via === 'basic') response.setHeader('Set-Cookie', access.sessionCookie);
        next();
      });

      httpServer.prependListener('upgrade', (request, socket) => {
        const decision = access.authorize(request.headers, 'websocket');
        if (!decision.allowed) rejectWebSocketUpgrade(request, socket, decision);
      });
    },
  };
}

export type WalletLabViteConfigDependencies = Readonly<{
  publicEnvironment?: Record<string, string> | undefined;
  secureAccess?: WalletLabSecureAccessDependencies | undefined;
  secureEnvironment?: WalletLabSecureAccessEnvironment | undefined;
}>;

export function createWalletLabViteConfig(
  { command, mode, isPreview }: ConfigEnv,
  dependencies: WalletLabViteConfigDependencies = {},
) {
  if (command === 'build' || isPreview === true) {
    throw new Error('The wallet lab is localhost-only and must not produce or serve a build.');
  }

  const environment = dependencies.publicEnvironment ?? loadEnv(mode, WALLET_LAB_ROOT, 'VITE_');
  const secureEnvironment =
    dependencies.secureEnvironment ?? loadEnv(mode, WALLET_LAB_ROOT, 'WALLET_LAB_');
  const secureAccess = resolveWalletLabSecureAccess(secureEnvironment, dependencies.secureAccess);
  const connectSources = createConnectSources(environment).join(' ');
  const headers = {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy':
      `default-src 'self'; base-uri 'none'; connect-src ${connectSources}; ` +
      "frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; " +
      "script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  } as const;

  return {
    root: WALLET_LAB_ROOT,
    envDir: WALLET_LAB_ROOT,
    plugins: [localOnlyServerGuard(), secureAccessPlugin(secureAccess.access)],
    server: {
      host: WALLET_LAB_HOST,
      port: WALLET_LAB_PORT,
      strictPort: true,
      origin: WALLET_LAB_ORIGIN,
      allowedHosts: [WALLET_LAB_HOST],
      cors: false,
      https: secureAccess.https,
      ws: { host: WALLET_LAB_HOST, port: WALLET_LAB_PORT, protocol: 'wss' },
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
