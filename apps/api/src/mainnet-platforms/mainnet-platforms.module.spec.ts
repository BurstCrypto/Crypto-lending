import { Inject, Injectable, Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';

import { AccountsModule } from '../accounts/accounts.module';
import { AccountAuthGuard } from '../accounts/auth/account-auth.guard';
import { AuthenticationModule } from '../authentication/authentication.module';
import { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';
import {
  MAINNET_PROVIDER_POSITION_READER,
  type MainnetProviderPositionReaderV3,
} from './application/ports/mainnet-provider-position-reader.port';
import { MainnetPlatformsController } from './http/mainnet-platforms.controller';
import { MainnetPlatformsPrivacyInterceptor } from './http/mainnet-platforms-privacy.interceptor';
import {
  ProviderPositionReadRuntimeRegistration,
  ProviderPositionReadRuntimeUnavailableError,
} from './infrastructure/provider-position-read-runtime.registration';
import { MainnetPlatformsModule } from './mainnet-platforms.module';

const INERT_ACCOUNT_GUARD = Object.freeze({ canActivate: () => false });

@Module({
  providers: [],
})
class InertAccountsModule {}

@Module({})
class InertAuthenticationModule {}

@Injectable()
class ProviderPositionReaderConsumer {
  constructor(
    @Inject(MAINNET_PROVIDER_POSITION_READER)
    readonly reader: MainnetProviderPositionReaderV3,
  ) {}
}

@Module({
  imports: [MainnetPlatformsModule],
  providers: [ProviderPositionReaderConsumer],
})
class ProviderPositionReaderConsumerModule {}

describe('MainnetPlatformsModule', () => {
  it('uses only the production account boundary and its isolated read-only providers', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      MainnetPlatformsModule,
    ) as unknown[];
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      MainnetPlatformsModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      MainnetPlatformsModule,
    ) as unknown[];
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      MainnetPlatformsModule,
    ) as unknown[];

    expect(imports).toEqual([AccountsModule, AuthenticationModule]);
    expect(controllers).toEqual([MainnetPlatformsController]);
    expect(providers.slice(0, 3)).toEqual([
      MainnetPlatformDirectoryService,
      MainnetPlatformsPrivacyInterceptor,
      ProviderPositionReadRuntimeRegistration,
    ]);
    expect(providers[3]).toEqual(
      expect.objectContaining({
        provide: MAINNET_PROVIDER_POSITION_READER,
        inject: [ProviderPositionReadRuntimeRegistration],
        useFactory: expect.any(Function),
      }),
    );
    expect(exports).toEqual([MainnetPlatformDirectoryService, MAINNET_PROVIDER_POSITION_READER]);

    const readerProvider = providers[3] as {
      useFactory: (
        registration: ProviderPositionReadRuntimeRegistration,
      ) => ProviderPositionReadRuntimeRegistration['reader'];
    };
    const registration = new ProviderPositionReadRuntimeRegistration();
    expect(readerProvider.useFactory(registration)).toBe(registration.reader);
  });

  it('exports one inert reader singleton to a consumer and lets Nest shut its owner down once', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProviderPositionReaderConsumerModule],
    })
      .overrideModule(AccountsModule)
      .useModule(InertAccountsModule)
      .overrideModule(AuthenticationModule)
      .useModule(InertAuthenticationModule)
      .overrideGuard(AccountAuthGuard)
      .useValue(INERT_ACCOUNT_GUARD)
      .compile();
    const app = moduleRef.createNestApplication();
    const shutdown = jest.spyOn(
      ProviderPositionReadRuntimeRegistration.prototype,
      'onApplicationShutdown',
    );
    const scheduleTimeout = jest.spyOn(globalThis, 'setTimeout');
    const scheduleInterval = jest.spyOn(globalThis, 'setInterval');
    const scheduleImmediate = jest.spyOn(globalThis, 'setImmediate');
    const scheduleMicrotask = jest.spyOn(globalThis, 'queueMicrotask');
    const networkFetch = jest.spyOn(globalThis, 'fetch');
    let closed = false;

    try {
      await app.init();
      scheduleTimeout.mockClear();
      scheduleInterval.mockClear();
      scheduleImmediate.mockClear();
      scheduleMicrotask.mockClear();
      networkFetch.mockClear();

      const consumer = app.get(ProviderPositionReaderConsumer);
      const reader = app.get<MainnetProviderPositionReaderV3>(MAINNET_PROVIDER_POSITION_READER);
      const registration = app.get(ProviderPositionReadRuntimeRegistration);

      expect(consumer.reader).toBe(reader);
      expect(app.get(MAINNET_PROVIDER_POSITION_READER)).toBe(reader);
      expect(registration.reader).toBe(reader);
      expect(Reflect.ownKeys(reader)).toEqual([
        'readerVersion',
        'positionSchemaVersion',
        'coverageVersion',
        'readCurrentPositions',
      ]);
      expect(Reflect.ownKeys(registration)).toEqual(['reader']);
      await expect(reader.readCurrentPositions({} as never)).rejects.toBeInstanceOf(
        ProviderPositionReadRuntimeUnavailableError,
      );

      await app.close();
      closed = true;

      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(scheduleTimeout).not.toHaveBeenCalled();
      expect(scheduleInterval).not.toHaveBeenCalled();
      expect(scheduleImmediate).not.toHaveBeenCalled();
      expect(scheduleMicrotask).not.toHaveBeenCalled();
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      if (!closed) await app.close();
      shutdown.mockRestore();
      scheduleTimeout.mockRestore();
      scheduleInterval.mockRestore();
      scheduleImmediate.mockRestore();
      scheduleMicrotask.mockRestore();
      networkFetch.mockRestore();
    }
  });
});
