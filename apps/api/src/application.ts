import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { API_GLOBAL_PREFIX } from './constants';
import { setupOpenApi } from './openapi/openapi';

/** Applies the production HTTP contract to both the real server and test apps. */
export function configureApplication(app: INestApplication): OpenAPIObject {
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  return setupOpenApi(app);
}
