import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';

import { API_GLOBAL_PREFIX } from './constants';
import { setupOpenApi } from './openapi/openapi';

/** Applies the production HTTP contract to both the real server and test apps. */
export function configureApplication(app: INestApplication): OpenAPIObject {
  const production = process.env.NODE_ENV?.trim().toLowerCase() === 'production';

  app.use(
    helmet({
      // Swagger's local-only UI requires inline bootstrap code. Production
      // documentation is disabled by default, so the public API can use a
      // deny-by-default CSP without weakening the development experience.
      contentSecurityPolicy: production
        ? {
            directives: {
              defaultSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      strictTransportSecurity: production
        ? {
            includeSubDomains: true,
            maxAge: 31_536_000,
          }
        : false,
    }),
  );
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
