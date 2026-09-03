import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AccountAuthGuard } from '../src/accounts/auth/account-auth.guard';
import {
  CURRENT_PRINCIPAL_RESOLVER,
  type CurrentPrincipalResolver,
} from '../src/accounts/auth/current-principal';
import { parseAccountId } from '../src/accounts/domain/account-profile';
import { configureApplication } from '../src/application';
import { MainnetPlatformDirectoryService } from '../src/mainnet-platforms/application/mainnet-platform-directory.service';
import { MAINNET_PLATFORM_DIRECTORY } from '../src/mainnet-platforms/domain/mainnet-platform-directory';
import { MainnetPlatformsController } from '../src/mainnet-platforms/http/mainnet-platforms.controller';
import { MainnetPlatformsPrivacyInterceptor } from '../src/mainnet-platforms/http/mainnet-platforms-privacy.interceptor';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

describe('mainnet platform directory HTTP boundary (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const resolver: CurrentPrincipalResolver = {
      resolve(requestValue: unknown) {
        const authorization = (requestValue as { headers?: { authorization?: unknown } }).headers
          ?.authorization;
        return authorization === 'Bearer mainnet-platform-directory-fixture'
          ? { accountId: ACCOUNT_ID }
          : null;
      },
    };
    const module = await Test.createTestingModule({
      controllers: [MainnetPlatformsController],
      providers: [
        AccountAuthGuard,
        MainnetPlatformsPrivacyInterceptor,
        MainnetPlatformDirectoryService,
        { provide: CURRENT_PRINCIPAL_RESOLVER, useValue: resolver },
      ],
    }).compile();

    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires the verified session principal before returning the directory', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/mainnet-platforms')
      .set('X-Account-ID', ACCOUNT_ID)
      .expect(401);

    expect(response.headers).toMatchObject({
      'cache-control': 'private, no-store',
      vary: 'Cookie, Origin',
    });
    expect(response.body).toEqual({
      error: 'Unauthorized',
      message: 'Authentication required',
      statusCode: 401,
    });
  });

  it('returns the exact private, non-executable directory to an authenticated caller', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/mainnet-platforms')
      .set('Authorization', 'Bearer mainnet-platform-directory-fixture')
      .expect(200);

    expect(response.headers).toMatchObject({
      'cache-control': 'private, no-store',
      vary: 'Cookie, Origin',
    });
    expect(response.body).toEqual(MAINNET_PLATFORM_DIRECTORY);
    expect(response.body.providers).toHaveLength(10);
    expect(
      response.body.providers.flatMap((provider: { networks: Array<{ id: string }> }) =>
        provider.networks.map(({ id }) => id),
      ),
    ).toEqual(expect.arrayContaining(['eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']));
    expect(JSON.stringify(response.body)).not.toMatch(/eip155:(?:56|8453)|BNB|Base/iu);
    expect(
      response.body.providers.every(
        (provider: Record<string, unknown>) =>
          provider.integrationStatus === 'PLANNED' &&
          provider.dataStatus === 'NOT_CONNECTED' &&
          provider.accessStatus === 'UNAVAILABLE' &&
          provider.riskStatus === 'NOT_ASSESSED' &&
          Array.isArray(provider.supportedActions) &&
          provider.supportedActions.length === 0,
      ),
    ).toBe(true);
    expect(
      response.body.providers.find(
        (provider: Record<string, unknown>) => provider.id === 'jupiter',
      ),
    ).toMatchObject({
      name: 'Jupiter',
      protocol: 'Jupiter Lend',
      ecosystem: 'SOLANA',
      integrationStatus: 'PLANNED',
      dataStatus: 'NOT_CONNECTED',
      accessStatus: 'UNAVAILABLE',
      riskStatus: 'NOT_ASSESSED',
      supportedActions: [],
    });
  });

  it('publishes the exact two-network, ten-provider response contract in OpenAPI', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
    const endpoint = response.body.paths['/api/v1/mainnet-platforms'].get;
    const schema = endpoint.responses['200'].content['application/json'].schema;
    const providerSchema = schema.properties.providers;
    const networkSchema = providerSchema.items.properties.networks.items;

    expect(endpoint.security).toEqual([{ sessionCookie: [] }]);
    expect(providerSchema).toMatchObject({ minItems: 10, maxItems: 10 });
    expect(providerSchema.items.properties.id.enum).toEqual([
      'aave',
      'morpho',
      'compound',
      'spark',
      'euler',
      'gearbox',
      'kamino',
      'save',
      'project-0',
      'jupiter',
    ]);
    expect(networkSchema.properties).toMatchObject({
      id: {
        enum: ['eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
      },
      name: { enum: ['Ethereum', 'Solana'] },
    });
    expect(JSON.stringify(schema)).not.toMatch(/eip155:(?:56|8453)|BNB|Base|moonwell|venus/iu);
  });

  it('does not expose a mutation route', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/mainnet-platforms')
      .set('Authorization', 'Bearer mainnet-platform-directory-fixture')
      .send({ action: 'SUPPLY' })
      .expect(404);
  });
});
