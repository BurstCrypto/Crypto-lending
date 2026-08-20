import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { API_VERSION, SERVICE_NAME, SERVICE_VERSION } from '../src/constants';

describe('system endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = testingModule.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves health only under the versioned prefix', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ service: SERVICE_NAME, status: 'ok' });

    expect(response.headers).toMatchObject({
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
    });
    expect(response.headers).not.toHaveProperty('x-powered-by');

    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('reports the contract and service versions', async () => {
    await request(app.getHttpServer()).get('/api/v1/version').expect(200).expect({
      apiVersion: API_VERSION,
      service: SERVICE_NAME,
      serviceVersion: SERVICE_VERSION,
    });
  });

  it('publishes the generated OpenAPI contract', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);

    expect(response.body.info.version).toBe('1.0.0');
    expect(response.body.paths).toHaveProperty('/api/v1/health');
    expect(response.body.paths).toHaveProperty('/api/v1/health/dependencies');
    expect(response.body.paths).toHaveProperty('/api/v1/version');
    expect(
      response.body.paths['/api/v1/health/dependencies'].get.responses['503'].content[
        'application/json'
      ].schema.$ref,
    ).toBe('#/components/schemas/InfrastructureHealthResponseDto');
  });
});
