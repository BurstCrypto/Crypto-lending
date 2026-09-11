import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import { API_CONTRACT_VERSION, OPENAPI_DOCUMENT_PATH, SERVICE_NAME } from '../constants';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Bonsai Lending API')
    .setDescription('Versioned API for the Bonsai Lending platform.')
    .setVersion(API_CONTRACT_VERSION)
    .addApiKey(
      {
        description: 'Opaque host-only secure session cookie',
        in: 'cookie',
        name: '__Host-cl_session',
        type: 'apiKey',
      },
      'sessionCookie',
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}`,
  });
}

export function shouldExposeOpenApi(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): boolean {
  const configured = environment.API_DOCS_ENABLED?.trim().toLowerCase();
  if (configured !== undefined && configured !== 'true' && configured !== 'false') {
    throw new Error('API_DOCS_ENABLED must be either true or false');
  }

  return (
    configured === 'true' ||
    (configured === undefined && environment.NODE_ENV?.trim().toLowerCase() !== 'production')
  );
}

export function setupOpenApi(
  app: INestApplication,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): OpenAPIObject {
  const document = createOpenApiDocument(app);

  if (shouldExposeOpenApi(environment)) {
    SwaggerModule.setup(OPENAPI_DOCUMENT_PATH, app, document, {
      customSiteTitle: `${SERVICE_NAME} documentation`,
      jsonDocumentUrl: `${OPENAPI_DOCUMENT_PATH}-json`,
    });
  }

  return document;
}
