import {
  PRODUCTION_PROVIDER_POSITION_READ_RUNTIME_REGISTRY,
  PROVIDER_POSITION_READ_RUNTIME_NETWORK_IDS,
  ProviderPositionReadRuntimeRegistration,
  ProviderPositionReadRuntimeUnavailableError,
} from './provider-position-read-runtime.registration';

describe('provider-position read runtime registration', () => {
  it('keeps the source-owned production activation registry empty and disabled', () => {
    expect(PRODUCTION_PROVIDER_POSITION_READ_RUNTIME_REGISTRY).toEqual({
      schemaVersion: 1,
      use: 'PROVIDER_POSITION_READ_RUNTIME_REGISTRATION_ONLY',
      environment: 'MAINNET',
      approvalStatus: 'NOT_APPROVED',
      activationStatus: 'DISABLED',
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      networkIds: ['eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
      registrations: [],
    });
    expect(Object.getPrototypeOf(PRODUCTION_PROVIDER_POSITION_READ_RUNTIME_REGISTRY)).toBeNull();
    expect(Object.isFrozen(PRODUCTION_PROVIDER_POSITION_READ_RUNTIME_REGISTRY)).toBe(true);
    expect(Object.isFrozen(PROVIDER_POSITION_READ_RUNTIME_NETWORK_IDS)).toBe(true);
    expect(Object.isFrozen(PRODUCTION_PROVIDER_POSITION_READ_RUNTIME_REGISTRY.registrations)).toBe(
      true,
    );
    expect(PRODUCTION_PROVIDER_POSITION_READ_RUNTIME_REGISTRY.networkIds).not.toContain(
      'eip155:8453',
    );
  });

  it('exposes only the frozen reader-v3 facade', () => {
    const registration = new ProviderPositionReadRuntimeRegistration();

    expect(Object.getPrototypeOf(registration.reader)).toBeNull();
    expect(Object.isFrozen(registration.reader)).toBe(true);
    expect(Reflect.ownKeys(registration.reader)).toEqual([
      'readerVersion',
      'positionSchemaVersion',
      'coverageVersion',
      'readCurrentPositions',
    ]);
    expect(registration.reader.readerVersion).toBe(3);
    expect(registration.reader.positionSchemaVersion).toBe(1);
    expect(registration.reader.coverageVersion).toBe(1);
    expect('onApplicationShutdown' in registration.reader).toBe(false);
  });

  it('rejects disabled reads without inspecting input or scheduling work', async () => {
    const schedule = jest.spyOn(globalThis, 'setTimeout');
    let inputInspections = 0;
    const hostileRequest = new Proxy(Object.create(null) as object, {
      get(): never {
        inputInspections += 1;
        throw new Error('request property inspected');
      },
      getOwnPropertyDescriptor(): never {
        inputInspections += 1;
        throw new Error('request descriptor inspected');
      },
      getPrototypeOf(): never {
        inputInspections += 1;
        throw new Error('request prototype inspected');
      },
      ownKeys(): never {
        inputInspections += 1;
        throw new Error('request keys inspected');
      },
    });

    try {
      const registration = new ProviderPositionReadRuntimeRegistration();

      await expect(
        registration.reader.readCurrentPositions(hostileRequest as never),
      ).rejects.toMatchObject({
        name: 'ProviderPositionReadRuntimeUnavailableError',
        code: 'PROVIDER_POSITION_READ_RUNTIME_NOT_APPROVED',
        message: 'Provider-position data is unavailable.',
      });
      expect(inputInspections).toBe(0);
      expect(schedule).not.toHaveBeenCalled();
    } finally {
      schedule.mockRestore();
    }
  });

  it('owns no cleanup handle and remains unavailable after Nest shutdown', async () => {
    const registration = new ProviderPositionReadRuntimeRegistration();
    const reader = registration.reader;

    expect(registration.onApplicationShutdown()).toBeUndefined();
    expect(registration.reader).toBe(reader);
    await expect(reader.readCurrentPositions({} as never)).rejects.toBeInstanceOf(
      ProviderPositionReadRuntimeUnavailableError,
    );
  });
});
