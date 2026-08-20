import { isIP } from 'node:net';
import type { Server } from 'node:http';

import { DEFAULT_PORT } from './constants';

export interface HttpServerOptions {
  headersTimeoutMs: number;
  host: string;
  keepAliveTimeoutMs: number;
  maxHeadersCount: number;
  maxRequestsPerSocket: number;
  port: number;
  requestTimeoutMs: number;
}

function boundedInteger(
  environment: Readonly<NodeJS.ProcessEnv>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function isValidHostname(host: string): boolean {
  if (isIP(host)) return true;
  if (host.length < 1 || host.length > 253 || host.endsWith('.')) return false;

  return host
    .split('.')
    .every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
    );
}

export function loadHttpServerOptions(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): HttpServerOptions {
  const production = environment.NODE_ENV?.trim().toLowerCase() === 'production';
  const requestTimeoutMs = boundedInteger(
    environment,
    'HTTP_REQUEST_TIMEOUT_MS',
    30_000,
    1_000,
    120_000,
  );
  const headersTimeoutMs = boundedInteger(
    environment,
    'HTTP_HEADERS_TIMEOUT_MS',
    Math.min(10_000, requestTimeoutMs),
    1_000,
    requestTimeoutMs,
  );
  const host = environment.API_HOST?.trim() || (production ? '0.0.0.0' : '127.0.0.1');
  if (!isValidHostname(host)) {
    throw new Error('API_HOST must be a valid IP address or DNS hostname');
  }

  return {
    headersTimeoutMs,
    host,
    keepAliveTimeoutMs: boundedInteger(
      environment,
      'HTTP_KEEP_ALIVE_TIMEOUT_MS',
      // The production ALB idle timeout is 60 seconds. Keep the backend open
      // slightly longer to avoid a stale pooled connection race and ALB 502s.
      production ? 65_000 : 5_000,
      1_000,
      120_000,
    ),
    maxHeadersCount: boundedInteger(environment, 'HTTP_MAX_HEADERS_COUNT', 100, 16, 1_000),
    maxRequestsPerSocket: boundedInteger(
      environment,
      'HTTP_MAX_REQUESTS_PER_SOCKET',
      1_000,
      1,
      10_000,
    ),
    port: boundedInteger(environment, 'PORT', DEFAULT_PORT, 1, 65_535),
    requestTimeoutMs,
  };
}

export function applyHttpServerLimits(
  server: Pick<
    Server,
    | 'headersTimeout'
    | 'keepAliveTimeout'
    | 'maxHeadersCount'
    | 'maxRequestsPerSocket'
    | 'requestTimeout'
  >,
  options: HttpServerOptions,
): void {
  server.headersTimeout = options.headersTimeoutMs;
  server.keepAliveTimeout = options.keepAliveTimeoutMs;
  server.maxHeadersCount = options.maxHeadersCount;
  server.maxRequestsPerSocket = options.maxRequestsPerSocket;
  server.requestTimeout = options.requestTimeoutMs;
}
