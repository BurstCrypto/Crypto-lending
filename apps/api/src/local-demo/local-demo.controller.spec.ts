import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import type { CurrentPrincipal } from '../accounts/auth/current-principal';
import { parseAccountId, type AccountId } from '../accounts/domain/account-profile';
import { loggingContext } from '../infrastructure/logging';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import type {
  LocalDemoAllocationPreviewResponse,
  LocalDemoAllocationService,
} from './local-demo-allocation.service';
import type { LocalDemoRuntimeConfig } from './local-demo-runtime.config';
import type {
  LocalDemoWalletConnection,
  LocalDemoWalletService,
} from './local-demo-wallet.service';
import { LocalDemoController } from './local-demo.controller';

const ACCOUNT_A = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const ACCOUNT_B = parseAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const CORRELATION_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CORRELATION_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const AUTHENTICATED_REQUEST_CORRELATION_B: JobCorrelationContext = Object.freeze({
  correlationId: CORRELATION_B,
  requestId: CORRELATION_B,
  initiatorActorId: ACCOUNT_B,
});
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WALLET_ID = '22222222-2222-4222-8222-222222222222';
const SECRET_CANARY = 'private-key-signature-challenge-canary';

const ENABLED_CONFIG: LocalDemoRuntimeConfig = Object.freeze({
  mode: 'enabled',
  apiHost: '127.0.0.1',
  publicOrigin: 'http://127.0.0.1:3000',
  localEvmRpcUrl: 'http://127.0.0.1:18545',
  localEvmControl: Object.freeze({
    url: 'http://127.0.0.1:18546/control',
    launchId: '0123456789abcdef0123456789abcdef',
    capability: '1111111111111111111111111111111111111111111111111111111111111111',
  }),
});

const DISABLED_CONFIG: LocalDemoRuntimeConfig = Object.freeze({ mode: 'disabled' });

const CONNECTION: LocalDemoWalletConnection = Object.freeze({
  connectionId: CONNECTION_ID,
  walletId: WALLET_ID,
  label: 'Synthetic EVM wallet',
  namespace: 'EVM',
  chainId: 'eip155:11155111',
  address: '0x1111111111111111111111111111111111111111',
  registeredAt: '2026-08-24T20:00:00.000Z',
});

const PORTFOLIO = Object.freeze({
  schemaVersion: 1,
  snapshotId: 'local-demo-snapshot',
  portfolioValueUsdMinor: '1100000',
});

const ALLOCATION_PREVIEW: LocalDemoAllocationPreviewResponse = Object.freeze({
  use: 'LOCAL_DEMO_ESTIMATE_ONLY',
  mayAuthorizeFinancialAction: false,
  preset: Object.freeze({
    id: 'BALANCED',
    label: 'Balanced blend',
    description: 'Split capital between ready access and diversified synthetic yield.',
  }),
  grossCapitalUsdMinor: '1100000',
  allocations: Object.freeze([
    Object.freeze({
      bucket: 'LIQUID_RESERVE',
      label: 'Liquid reserve',
      percentageBasisPoints: 3_000,
      apyBasisPoints: 0,
      amountUsdMinor: '330000',
    }),
    Object.freeze({
      bucket: 'CONSERVATIVE_YIELD',
      label: 'Conservative yield',
      percentageBasisPoints: 4_500,
      apyBasisPoints: 400,
      amountUsdMinor: '495000',
    }),
    Object.freeze({
      bucket: 'BALANCED_YIELD',
      label: 'Balanced yield',
      percentageBasisPoints: 2_500,
      apyBasisPoints: 600,
      amountUsdMinor: '275000',
    }),
  ]),
  deductions: Object.freeze([
    Object.freeze({ code: 'LIQUIDITY', amountUsdMinor: '3850' }),
    Object.freeze({ code: 'CONVERSION', amountUsdMinor: '770' }),
    Object.freeze({ code: 'SLIPPAGE', amountUsdMinor: '770' }),
    Object.freeze({ code: 'NETWORK', amountUsdMinor: '770' }),
    Object.freeze({ code: 'ROUTING', amountUsdMinor: '1540' }),
  ]),
  totalFeesUsdMinor: '7700',
  netPlannedCapitalUsdMinor: '1092300',
  yieldProjection: Object.freeze({
    source: 'SYNTHETIC_FIXED_DEMO_RATES',
    calculationMethod: 'SIMPLE_DAILY_APY_PRORATION_ON_NET_CAPITAL',
    effectiveApyBasisPoints: 330,
    projectedAnnualYieldUsdMinor: '36045',
    projectedAnnualNetGrowthUsdMinor: '28345',
    breakEven: Object.freeze({ status: 'AVAILABLE', firstNetPositiveDay: 78 }),
  }),
  asOf: '2026-08-24T18:30:00.000Z',
});

type WalletBoundary = Pick<LocalDemoWalletService, 'connect' | 'disconnect' | 'list' | 'reset'>;

interface PortfolioBoundary {
  read(accountId: AccountId, correlation: JobCorrelationContext): Promise<unknown>;
}

type AllocationBoundary = Pick<LocalDemoAllocationService, 'preview'>;

interface ControllerFixture {
  readonly controller: LocalDemoController;
  readonly wallets: jest.Mocked<WalletBoundary>;
  readonly portfolio: jest.Mocked<PortfolioBoundary>;
  readonly allocations: jest.Mocked<AllocationBoundary>;
}

interface ResponseFixture {
  readonly response: { readonly setHeader: jest.Mock };
  readonly headers: Map<string, string>;
}

function controllerFixture(config: LocalDemoRuntimeConfig = ENABLED_CONFIG): ControllerFixture {
  const wallets: jest.Mocked<WalletBoundary> = {
    connect: jest.fn(async (input) => {
      void input;
      return CONNECTION;
    }),
    disconnect: jest.fn((accountId, connectionId) => {
      void accountId;
      void connectionId;
      return true;
    }),
    list: jest.fn((accountId) => {
      void accountId;
      return Object.freeze([CONNECTION]);
    }),
    reset: jest.fn((accountId) => {
      void accountId;
    }),
  };
  const portfolio: jest.Mocked<PortfolioBoundary> = {
    read: jest.fn(async (accountId, correlationId) => {
      void accountId;
      void correlationId;
      return PORTFOLIO;
    }),
  };
  const allocations: jest.Mocked<AllocationBoundary> = {
    preview: jest.fn(async (accountId, correlation, presetId) => {
      void accountId;
      void correlation;
      void presetId;
      return ALLOCATION_PREVIEW;
    }),
  };
  return {
    controller: new LocalDemoController(
      wallets as never,
      portfolio as never,
      allocations as never,
      config,
    ),
    wallets,
    portfolio,
    allocations,
  };
}

function responseFixture(): ResponseFixture {
  const headers = new Map<string, string>();
  return {
    response: {
      setHeader: jest.fn((name: string, value: string) => {
        headers.set(name, value);
      }),
    },
    headers,
  };
}

function principal(accountId: AccountId): CurrentPrincipal {
  return Object.freeze({ accountId });
}

function captureThrown(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error('Expected work to throw');
}

async function captureRejected(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error('Expected work to reject');
}

function expectUnavailable(error: unknown, response: ResponseFixture): void {
  expect(error).toBeInstanceOf(HttpException);
  const httpError = error as HttpException;
  expect(httpError.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  expect(httpError.getResponse()).toEqual({
    error: 'Service Unavailable',
    message: 'Local demo data is unavailable',
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
  });
  expect(response.headers).toEqual(new Map([['Retry-After', '1']]));
  expect(JSON.stringify(httpError.getResponse())).not.toContain(SECRET_CANARY);
}

describe('LocalDemoController', () => {
  it('publishes exact local-demo routes and successful status codes', () => {
    const prototype = LocalDemoController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, LocalDemoController)).toBe('local-demo');
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.listWallets)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, prototype.listWallets)).toBe('wallets');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.listWallets)).toBe(HttpStatus.OK);
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.connectWallet)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, prototype.connectWallet)).toBe('wallets');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.connectWallet)).toBe(
      HttpStatus.CREATED,
    );
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.disconnectWallet)).toBe(
      RequestMethod.DELETE,
    );
    expect(Reflect.getMetadata(PATH_METADATA, prototype.disconnectWallet)).toBe('wallets');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.disconnectWallet)).toBe(
      HttpStatus.NO_CONTENT,
    );
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.readPortfolio)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, prototype.readPortfolio)).toBe('portfolio');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.readPortfolio)).toBe(HttpStatus.OK);
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.previewAllocation)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(PATH_METADATA, prototype.previewAllocation)).toBe(
      'allocation-preview',
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.previewAllocation)).toBe(
      HttpStatus.OK,
    );
  });

  it('returns only the authenticated account wallet catalog', () => {
    const fixture = controllerFixture();
    const response = responseFixture();

    expect(fixture.controller.listWallets(principal(ACCOUNT_A), response.response)).toEqual([
      CONNECTION,
    ]);
    expect(fixture.wallets.list).toHaveBeenCalledWith(ACCOUNT_A);
    expect(fixture.wallets.list).not.toHaveBeenCalledWith(ACCOUNT_B);
    expect(response.response.setHeader).not.toHaveBeenCalled();
  });

  it.each(['EVM', 'SOLANA'] as const)(
    'connects one %s synthetic wallet with only principal and logging context authority',
    async (namespace) => {
      const fixture = controllerFixture();
      const response = responseFixture();
      const correlationId = namespace === 'EVM' ? CORRELATION_A : CORRELATION_B;
      const accountId = namespace === 'EVM' ? ACCOUNT_A : ACCOUNT_B;

      const result = await loggingContext.run({ correlationId }, () =>
        fixture.controller.connectWallet(principal(accountId), { namespace }, response.response),
      );

      expect(result).toBe(CONNECTION);
      expect(fixture.wallets.connect).toHaveBeenCalledWith({
        accountId,
        namespace,
        correlationId,
      });
      expect(response.response.setHeader).not.toHaveBeenCalled();
    },
  );

  it('rejects extra fields, caller account scope, and caller-authored wallet material exactly', async () => {
    const bodies: readonly unknown[] = [
      {},
      { namespace: 'eip155' },
      { namespace: 'EVM', accountId: ACCOUNT_B },
      { namespace: 'EVM', address: '0x1111111111111111111111111111111111111111' },
      { namespace: 'EVM', privateKey: SECRET_CANARY },
      { namespace: 'EVM', signature: SECRET_CANARY },
      { namespace: 'EVM', challenge: SECRET_CANARY },
    ];
    let getterInvoked = false;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'namespace', {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return 'EVM';
      },
    });

    for (const body of [...bodies, accessor]) {
      const fixture = controllerFixture();
      const response = responseFixture();
      const error = await captureRejected(() =>
        loggingContext.run({ correlationId: CORRELATION_A }, () =>
          fixture.controller.connectWallet(principal(ACCOUNT_A), body, response.response),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      const httpError = error as BadRequestException;
      expect(httpError.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(JSON.stringify(httpError.getResponse())).toContain('Local demo request is invalid');
      expect(JSON.stringify(httpError.getResponse())).not.toContain(SECRET_CANARY);
      expect(fixture.wallets.connect).not.toHaveBeenCalled();
      expect(response.response.setHeader).not.toHaveBeenCalled();
    }
    expect(getterInvoked).toBe(false);
  });

  it('disconnects only the principal-scoped canonical connection and remains idempotent', () => {
    const fixture = controllerFixture();
    const response = responseFixture();

    expect(
      fixture.controller.disconnectWallet(
        principal(ACCOUNT_A),
        { connectionId: CONNECTION_ID },
        response.response,
      ),
    ).toBeUndefined();
    expect(fixture.wallets.disconnect).toHaveBeenCalledWith(ACCOUNT_A, CONNECTION_ID);

    fixture.wallets.disconnect.mockReturnValueOnce(false);
    expect(
      fixture.controller.disconnectWallet(
        principal(ACCOUNT_B),
        { connectionId: CONNECTION_ID },
        response.response,
      ),
    ).toBeUndefined();
    expect(fixture.wallets.disconnect).toHaveBeenLastCalledWith(ACCOUNT_B, CONNECTION_ID);
  });

  it('rejects a malformed disconnect body before touching wallet state', () => {
    const fixture = controllerFixture();
    const response = responseFixture();
    const error = captureThrown(() =>
      fixture.controller.disconnectWallet(
        principal(ACCOUNT_A),
        { connectionId: CONNECTION_ID, privateKey: SECRET_CANARY },
        response.response,
      ),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(JSON.stringify((error as BadRequestException).getResponse())).not.toContain(
      SECRET_CANARY,
    );
    expect(fixture.wallets.disconnect).not.toHaveBeenCalled();
  });

  it('reads the portfolio for only the principal account and active correlation', async () => {
    const fixture = controllerFixture();
    const response = responseFixture();

    const result = await loggingContext.run(AUTHENTICATED_REQUEST_CORRELATION_B, () =>
      fixture.controller.readPortfolio(principal(ACCOUNT_B), response.response),
    );

    expect(result).toBe(PORTFOLIO);
    expect(fixture.portfolio.read).toHaveBeenCalledWith(
      ACCOUNT_B,
      AUTHENTICATED_REQUEST_CORRELATION_B,
    );
    expect(fixture.portfolio.read).not.toHaveBeenCalledWith(ACCOUNT_A, expect.anything());
  });

  it('previews only an allowlisted preset for the principal account and active correlation', async () => {
    const fixture = controllerFixture();
    const response = responseFixture();

    const result = await loggingContext.run(AUTHENTICATED_REQUEST_CORRELATION_B, () =>
      fixture.controller.previewAllocation(
        principal(ACCOUNT_B),
        { presetId: 'BALANCED' },
        response.response,
      ),
    );

    expect(result).toBe(ALLOCATION_PREVIEW);
    expect(fixture.allocations.preview).toHaveBeenCalledWith(
      ACCOUNT_B,
      AUTHENTICATED_REQUEST_CORRELATION_B,
      'BALANCED',
    );
    expect(fixture.allocations.preview).not.toHaveBeenCalledWith(
      ACCOUNT_A,
      expect.anything(),
      expect.anything(),
    );
  });

  it('rejects caller-authored allocation amounts and unsupported presets before previewing', async () => {
    const bodies: readonly unknown[] = [
      {},
      { presetId: 'CUSTOM' },
      { presetId: 'BALANCED', amountUsdMinor: '1100000' },
      { presetId: 'MORE_YIELD', accountId: ACCOUNT_B },
    ];

    for (const body of bodies) {
      const fixture = controllerFixture();
      const response = responseFixture();
      const error = await captureRejected(() =>
        loggingContext.run(AUTHENTICATED_REQUEST_CORRELATION_B, () =>
          fixture.controller.previewAllocation(principal(ACCOUNT_B), body, response.response),
        ),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(fixture.allocations.preview).not.toHaveBeenCalled();
      expect(response.response.setHeader).not.toHaveBeenCalled();
    }
  });

  it('uses one generic redacted 503 contract for every dependency failure', async () => {
    const list = controllerFixture();
    const listResponse = responseFixture();
    list.wallets.list.mockImplementationOnce(() => {
      throw new Error(SECRET_CANARY);
    });
    expectUnavailable(
      captureThrown(() => list.controller.listWallets(principal(ACCOUNT_A), listResponse.response)),
      listResponse,
    );

    const connect = controllerFixture();
    const connectResponse = responseFixture();
    connect.wallets.connect.mockRejectedValueOnce(new Error(SECRET_CANARY));
    expectUnavailable(
      await captureRejected(() =>
        loggingContext.run({ correlationId: CORRELATION_A }, () =>
          connect.controller.connectWallet(
            principal(ACCOUNT_A),
            { namespace: 'EVM' },
            connectResponse.response,
          ),
        ),
      ),
      connectResponse,
    );

    const disconnect = controllerFixture();
    const disconnectResponse = responseFixture();
    disconnect.wallets.disconnect.mockImplementationOnce(() => {
      throw new Error(SECRET_CANARY);
    });
    expectUnavailable(
      captureThrown(() =>
        disconnect.controller.disconnectWallet(
          principal(ACCOUNT_A),
          { connectionId: CONNECTION_ID },
          disconnectResponse.response,
        ),
      ),
      disconnectResponse,
    );

    const portfolio = controllerFixture();
    const portfolioResponse = responseFixture();
    portfolio.portfolio.read.mockRejectedValueOnce(new Error(SECRET_CANARY));
    expectUnavailable(
      await captureRejected(() =>
        loggingContext.run({ correlationId: CORRELATION_A }, () =>
          portfolio.controller.readPortfolio(principal(ACCOUNT_A), portfolioResponse.response),
        ),
      ),
      portfolioResponse,
    );

    const allocation = controllerFixture();
    const allocationResponse = responseFixture();
    allocation.allocations.preview.mockRejectedValueOnce(new Error(SECRET_CANARY));
    expectUnavailable(
      await captureRejected(() =>
        loggingContext.run(AUTHENTICATED_REQUEST_CORRELATION_B, () =>
          allocation.controller.previewAllocation(
            principal(ACCOUNT_B),
            { presetId: 'BALANCED' },
            allocationResponse.response,
          ),
        ),
      ),
      allocationResponse,
    );
  });

  it('maps a missing correlation context to the same generic 503 without calling a service', async () => {
    const connect = controllerFixture();
    const connectResponse = responseFixture();
    expectUnavailable(
      await captureRejected(() =>
        connect.controller.connectWallet(
          principal(ACCOUNT_A),
          { namespace: 'EVM' },
          connectResponse.response,
        ),
      ),
      connectResponse,
    );
    expect(connect.wallets.connect).not.toHaveBeenCalled();

    const portfolio = controllerFixture();
    const portfolioResponse = responseFixture();
    expectUnavailable(
      await captureRejected(() =>
        portfolio.controller.readPortfolio(principal(ACCOUNT_A), portfolioResponse.response),
      ),
      portfolioResponse,
    );
    expect(portfolio.portfolio.read).not.toHaveBeenCalled();

    const allocation = controllerFixture();
    const allocationResponse = responseFixture();
    expectUnavailable(
      await captureRejected(() =>
        allocation.controller.previewAllocation(
          principal(ACCOUNT_A),
          { presetId: 'BALANCED' },
          allocationResponse.response,
        ),
      ),
      allocationResponse,
    );
    expect(allocation.allocations.preview).not.toHaveBeenCalled();
  });

  it('returns a generic 404 and performs no work while the runtime is disabled', async () => {
    const fixture = controllerFixture(DISABLED_CONFIG);

    const listError = captureThrown(() =>
      fixture.controller.listWallets(principal(ACCOUNT_A), responseFixture().response),
    );
    const disconnectError = captureThrown(() =>
      fixture.controller.disconnectWallet(
        principal(ACCOUNT_A),
        { connectionId: CONNECTION_ID },
        responseFixture().response,
      ),
    );
    const connectError = await captureRejected(() =>
      fixture.controller.connectWallet(
        principal(ACCOUNT_A),
        { namespace: 'EVM' },
        responseFixture().response,
      ),
    );
    const portfolioError = await captureRejected(() =>
      fixture.controller.readPortfolio(principal(ACCOUNT_A), responseFixture().response),
    );
    const allocationError = await captureRejected(() =>
      fixture.controller.previewAllocation(
        principal(ACCOUNT_A),
        { presetId: 'BALANCED' },
        responseFixture().response,
      ),
    );

    for (const error of [
      listError,
      disconnectError,
      connectError,
      portfolioError,
      allocationError,
    ]) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(JSON.stringify((error as NotFoundException).getResponse())).toContain('Not found');
      expect(JSON.stringify((error as NotFoundException).getResponse())).not.toContain(
        'local-demo',
      );
    }
    expect(fixture.wallets.list).not.toHaveBeenCalled();
    expect(fixture.wallets.connect).not.toHaveBeenCalled();
    expect(fixture.wallets.disconnect).not.toHaveBeenCalled();
    expect(fixture.portfolio.read).not.toHaveBeenCalled();
    expect(fixture.allocations.preview).not.toHaveBeenCalled();
  });
});
