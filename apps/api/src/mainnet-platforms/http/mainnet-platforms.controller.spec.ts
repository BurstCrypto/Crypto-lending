import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { AccountAuthGuard } from '../../accounts/auth/account-auth.guard';
import type { MainnetPlatformDirectoryService } from '../application/mainnet-platform-directory.service';
import { MAINNET_PLATFORM_DIRECTORY } from '../domain/mainnet-platform-directory';
import { MainnetPlatformsController } from './mainnet-platforms.controller';
import { MainnetPlatformsPrivacyInterceptor } from './mainnet-platforms-privacy.interceptor';
import { MAINNET_PLATFORM_DIRECTORY_RESPONSE_SCHEMA } from './mainnet-platforms-response.schema';

describe('MainnetPlatformsController', () => {
  it('publishes exactly one authenticated GET-only route', () => {
    const prototype = MainnetPlatformsController.prototype;

    expect(Reflect.getMetadata(PATH_METADATA, MainnetPlatformsController)).toBe(
      'mainnet-platforms',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.read)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, prototype.read)).toBe('/');
    expect(Object.getOwnPropertyNames(prototype).sort()).toEqual(['constructor', 'read']);
    expect(Reflect.getMetadata(GUARDS_METADATA, MainnetPlatformsController)).toContain(
      AccountAuthGuard,
    );
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, MainnetPlatformsController)).toContain(
      MainnetPlatformsPrivacyInterceptor,
    );
  });

  it('returns only the application-owned non-executable directory', () => {
    const directory = { read: jest.fn(() => MAINNET_PLATFORM_DIRECTORY) };
    const controller = new MainnetPlatformsController(
      directory as unknown as MainnetPlatformDirectoryService,
    );

    expect(controller.read()).toBe(MAINNET_PLATFORM_DIRECTORY);
    expect(directory.read).toHaveBeenCalledTimes(1);
  });

  it('documents a closed response schema with no executable action value', () => {
    expect(MAINNET_PLATFORM_DIRECTORY_RESPONSE_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion',
        'use',
        'mayAuthorizeFinancialAction',
        'minimumProviderTarget',
        'providers',
      ],
      properties: {
        mayAuthorizeFinancialAction: { type: 'boolean', enum: [false] },
        minimumProviderTarget: { type: 'integer', enum: [10] },
        providers: {
          type: 'array',
          minItems: 10,
          items: {
            additionalProperties: false,
            properties: {
              integrationStatus: { enum: ['PLANNED'] },
              dataStatus: { enum: ['NOT_CONNECTED'] },
              accessStatus: { enum: ['UNAVAILABLE'] },
              riskStatus: { enum: ['NOT_ASSESSED'] },
              supportedActions: { minItems: 0, maxItems: 0 },
            },
          },
        },
      },
    });
  });
});
