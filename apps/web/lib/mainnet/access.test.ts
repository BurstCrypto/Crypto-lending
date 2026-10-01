// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../../app/api/mainnet/route';
import { GET as legacyGet } from '../../app/api/local-mainnet/route';
import { BridgeJournal } from './bridge-journal.server';
import { LocalBridgeService } from './bridge-service.server';
import * as accounts from './runtime.server';
import * as local from '../local-mainnet/runtime.server';
import { MAINNET_TREASURIES } from './public-config';
import { WEB_LOG_EVENTS, webStructuredLogger } from '../logging/structured-logger.server';
import type { LocalWalletConfig } from './bridge-types';

const accountId = '11111111-1111-4111-8111-111111111111';
const credential = `${accountId}.${'s'.repeat(43)}`,
  csrf = 'c'.repeat(43),
  capability = 'a'.repeat(64);
const profile = {
  accountId,
  contactEmail: 'test@example.com',
  contactPhone: null,
  declaredResidencyCountryCode: 'US',
  eligibilityStatus: 'UNKNOWN',
  version: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};
const config: LocalWalletConfig = {
  ...MAINNET_TREASURIES,
  ethereumTreasury: MAINNET_TREASURIES.ethereumTreasury as `0x${string}`,
  ethereumWallet: '0x1111111111111111111111111111111111111111',
  solanaWallet: null,
  ethereumSourceRouter: null,
  ethereumSupplyRouter: null,
  solanaLookupTables: [],
};
let journal: BridgeJournal, service: LocalBridgeService;
const request = (operation?: string, fields = {}, headers = {}) =>
  new Request('https://app.example.com/api/mainnet', {
    method: operation ? 'POST' : 'GET',
    headers: {
      cookie: `__Host-cl_session=${credential}; __Host-cl_csrf=${csrf}`,
      ...(operation
        ? {
            origin: 'https://app.example.com',
            'content-type': 'application/json',
            'x-csrf-token': csrf,
          }
        : {}),
      ...headers,
    },
    ...(operation ? { body: JSON.stringify({ operation, ...fields }) } : {}),
  });
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('AUTH_PUBLIC_ORIGIN', 'https://app.example.com');
  vi.stubEnv('LOCAL_MAINNET_TEST_MODE', 'enabled');
  vi.stubEnv('LOCAL_MAINNET_TEST_LAUNCH_TOKEN', capability);
  journal = new BridgeJournal(':memory:');
  service = new LocalBridgeService(journal, undefined, undefined, {
    read: () => config,
    write: vi.fn(),
  });
  vi.spyOn(accounts, 'accountMainnetService').mockReturnValue(service);
  vi.spyOn(local, 'localMainnetService').mockReturnValue(service);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(profile));
});
afterEach(() => {
  journal.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('one mainnet engine with distinct account and loopback access', () => {
  it('validates the production session before opening its account journal', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authenticated: true,
      localAccess: false,
      config,
    });
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://app.example.com/api/v1/accounts/me'),
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
        headers: expect.objectContaining({ Cookie: expect.stringContaining(credential) }),
      }),
    );
    expect(accounts.accountMainnetService).toHaveBeenCalledWith(accountId);
    expect(local.localMainnetService).not.toHaveBeenCalled();
  });
  it('rejects missing and expired sessions even when a local capability is supplied', async () => {
    expect(
      (await GET(request(undefined, {}, { cookie: '', 'x-local-mainnet-setup': capability })))
        .status,
    ).toBe(401);
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: 'Expired' }, { status: 401 }));
    expect((await GET(request())).status).toBe(401);
    expect(accounts.accountMainnetService).not.toHaveBeenCalled();
    expect((await legacyGet(request())).status).toBe(404);
  });
  it('requires both the production origin and CSRF credential for mutations', async () => {
    for (const headers of [{ origin: 'https://foreign.example' }, { 'x-csrf-token': 'wrong' }]) {
      expect((await POST(request('configure', { config }, headers))).status).toBe(403);
    }
    expect(service.configuration.write).not.toHaveBeenCalled();
  });
  it('runs identical provider operations after local or production access, with no local login request', async () => {
    const compare = vi.spyOn(service.smartLending, 'compare').mockResolvedValue({
      id: 'quote',
      selectedId: null,
      routes: [],
      createdAt: 1,
      expiresAt: 2,
      input: {},
    } as never);
    const fields = {
      input: {
        sourceNetwork: 'eip155:1',
        amount: '50',
        holdingDays: 365,
        includeCrossChain: false,
      },
    };
    const production = await POST(request('smart-lending-compare', fields));
    expect(production.status).toBe(200);
    const result = await production.json();
    vi.mocked(fetch).mockClear();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEPLOYMENT_TARGET', undefined);
    vi.stubEnv('LOCAL_DEMO_MODE', 'disabled');
    const localRequest = new Request('http://127.0.0.1:3000/api/mainnet', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
        'content-type': 'application/json',
        'x-local-mainnet-setup': capability,
      },
      body: JSON.stringify({ operation: 'smart-lending-compare', ...fields }),
    });
    expect(await (await POST(localRequest)).json()).toEqual(result);
    expect(compare).toHaveBeenNthCalledWith(1, config, fields.input, false);
    expect(compare).toHaveBeenNthCalledWith(2, config, fields.input, false);
    expect(fetch).not.toHaveBeenCalled();
    localRequest.headers.set('host', 'app.example.com');
    expect((await GET(localRequest)).status).toBe(404);
  });
  it('records bounded local connection diagnostics without accepting wallet data or production requests', async () => {
    const warn = vi.spyOn(webStructuredLogger, 'emit').mockImplementation(() => undefined);
    const fields = {
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      stage: 'connect',
      code: 4001,
      elapsedMs: 250,
    };
    expect((await POST(request('wallet-connection-error', fields))).status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEPLOYMENT_TARGET', undefined);
    vi.stubEnv('LOCAL_DEMO_MODE', 'disabled');
    const localRequest = (body: Record<string, unknown>, token = capability) =>
      new Request('http://127.0.0.1:3000/api/mainnet', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
          'content-type': 'application/json',
          'x-local-mainnet-setup': token,
        },
        body: JSON.stringify({ operation: 'wallet-connection-error', ...body }),
      });
    expect((await POST(localRequest(fields, ''))).status).toBe(401);
    for (const extra of [
      { wallet: 'public-address' },
      { signature: 'must-not-be-logged' },
      { stage: ['connect'] },
      { elapsedMs: -1 },
      { code: '4001' },
    ]) {
      expect((await POST(localRequest({ ...fields, ...extra }))).status).toBe(400);
    }
    expect(warn).not.toHaveBeenCalled();
    expect(await (await POST(localRequest(fields))).json()).toEqual({ recorded: true });
    expect(warn).toHaveBeenCalledExactlyOnceWith(WEB_LOG_EVENTS.requestFailed, 'error', {
      method: 'POST',
      route: '/api/mainnet',
      outcome: 'failure',
      errorCode: 'WEB_REQUEST_ERROR',
    });
    expect(service.configuration.write).not.toHaveBeenCalled();
    expect(journal.steps()).toEqual([]);
  });
});
