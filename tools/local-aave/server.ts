import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse, type IncomingMessage, type Server } from 'node:http';
import { join } from 'node:path';

import { LocalAaveReader, LocalAaveReadError, walletAddress } from './reader';

export const LOCAL_PORT = 3300;
export const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const MAX_BODY_BYTES = 256;
const COOLDOWN_MS = 5_000;

function send(res: ServerResponse, status: number, value: unknown): void {
  if (!res.destroyed) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }
}

async function input(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('Invalid body');
    chunks.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, 'address')
  )
    throw new Error('Invalid body');
  return walletAddress((value as Record<string, unknown>).address);
}

/** Loopback-only development UI. Never registers a production provider or accepts transactions. */
export function createLocalAaveServer(
  reader: Pick<LocalAaveReader, 'read'> = new LocalAaveReader(),
): Server {
  if (process.env.NODE_ENV === 'production') throw new Error('Local Aave is a development tool.');
  const assets = new Map(
    [
      ['/', 'index.html', 'text/html'],
      ['/app.js', 'app.js', 'text/javascript'],
      ['/style.css', 'style.css', 'text/css'],
    ].map(([route, file, type]) => [
      route!,
      { body: readFileSync(join(__dirname, 'public', file!)), type },
    ]),
  );
  let active: AbortController | null = null;
  let nextReadAt = 0;
  const server = createServer(
    {
      maxHeaderSize: 8192,
      requestTimeout: 5000,
      headersTimeout: 5000,
      connectionsCheckingInterval: 1000,
    },
    (req, res) => {
      const address = server.address();
      const host = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : '';
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      if (
        !host ||
        req.headers.host !== host ||
        (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`) ||
        (req.headers['sec-fetch-site'] !== undefined &&
          !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))
      ) {
        send(res, 403, { error: 'Open this tool through its 127.0.0.1 address.' });
        return;
      }
      const asset = req.method === 'GET' ? assets.get(req.url ?? '') : undefined;
      if (asset) {
        res.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8` });
        res.end(asset.body);
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        send(res, 200, { status: 'running', mode: 'LOCAL_READ_ONLY' });
        return;
      }
      if (req.method !== 'POST' || req.url !== '/api/read') {
        send(res, 404, { error: 'Not found.' });
        return;
      }
      if (req.headers.origin !== `http://${host}`) {
        send(res, 403, { error: 'A same-origin request is required.' });
        return;
      }
      if (
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '') ||
        (req.headers['content-length'] !== undefined &&
          (!/^\d+$/.test(req.headers['content-length']) ||
            Number(req.headers['content-length']) > MAX_BODY_BYTES)) ||
        req.headers['content-encoding'] !== undefined
      ) {
        send(res, 400, { error: 'Send a small JSON object containing only address.' });
        return;
      }
      if (active || Date.now() < nextReadAt) {
        res.setHeader('Retry-After', '5');
        send(res, 429, {
          error: 'A read is running or was just requested. Please wait five seconds.',
        });
        return;
      }
      const controller = new AbortController();
      active = controller;
      const cancel = (): void => controller.abort();
      req.once('aborted', cancel);
      res.once('close', cancel);
      void (async () => {
        let wallet: string | null;
        try {
          wallet = await input(req);
        } catch (error) {
          send(res, 400, {
            error:
              error instanceof LocalAaveReadError
                ? error.message
                : 'Send a small JSON object containing only address.',
          });
          return;
        }
        if (controller.signal.aborted) return;
        nextReadAt = Date.now() + COOLDOWN_MS;
        try {
          send(res, 200, await reader.read(wallet, controller.signal));
        } catch (error) {
          send(res, 503, {
            error:
              error instanceof LocalAaveReadError
                ? error.message
                : 'Live Aave data is temporarily unavailable. Please try again.',
          });
        }
      })().finally(() => {
        req.removeListener('aborted', cancel);
        res.removeListener('close', cancel);
        active = null;
      });
    },
  );
  server.maxConnections = 16;
  server.on('close', () => active?.abort());
  return server;
}
