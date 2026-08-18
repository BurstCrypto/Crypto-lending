import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import { API_CONTRACT_VERSION, OPENAPI_DOCUMENT_PATH, SERVICE_NAME } from '../constants';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Crypto Lending API')
    .setDescription('Versioned API for the Crypto Lending platform.')
    .setVersion(API_CONTRACT_VERSION)
    .addBearerAuth(
      {
        bearerFormat: 'JWT',
        description: 'Managed identity access token',
        scheme: 'bearer',
        type: 'http',
      },
      'bearer',
    )
    .build();

  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}`,
  });
}

export function setupOpenApi(app: INestApplication): OpenAPIObject {
  const document = createOpenApiDocument(app);

  SwaggerModule.setup(OPENAPI_DOCUMENT_PATH, app, document, {
    customSiteTitle: `${SERVICE_NAME} documentation`,
    jsonDocumentUrl: `${OPENAPI_DOCUMENT_PATH}-json`,
  });

  return document;
}
