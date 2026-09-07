import { Injectable, type OnApplicationShutdown } from '@nestjs/common';

import {
  MAINNET_PROVIDER_POSITION_READER_VERSION,
  type MainnetProviderPositionReadResultV3,
  type MainnetProviderPositionReaderV3,
  type ReadMainnetProviderPositionsRequestV3,
} from '../application/ports/mainnet-provider-position-reader.port';
import { MAINNET_PROVIDER_POSITION_COVERAGE_VERSION } from '../domain/mainnet-provider-position-coverage';
import { MAINNET_PROVIDER_POSITION_SCHEMA_VERSION } from '../domain/mainnet-provider-position-observation';

export const PROVIDER_POSITION_READ_RUNTIME_REGISTRATION_USE =
  'PROVIDER_POSITION_READ_RUNTIME_REGISTRATION_ONLY' as const;

export const PROVIDER_POSITION_READ_RUNTIME_NETWORK_IDS = Object.freeze([
  'eip155:1',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
] as const);

export interface ProviderPositionReadRuntimeActivationRegistry {
  readonly schemaVersion: 1;
  readonly use: typeof PROVIDER_POSITION_READ_RUNTIME_REGISTRATION_USE;
  readonly environment: 'MAINNET';
  readonly approvalStatus: 'NOT_APPROVED';
  readonly activationStatus: 'DISABLED';
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly networkIds: typeof PROVIDER_POSITION_READ_RUNTIME_NETWORK_IDS;
  readonly registrations: readonly never[];
}

/**
 * Source-owned production activation boundary. An environment value cannot
 * add a provider, endpoint, credential, or network. A later activation must be
 * a separately reviewed source change; the current registry cannot load a
 * runtime and cannot authorize a provider read.
 */
export const PRODUCTION_PROVIDER_POSITION_READ_RUNTIME_REGISTRY: Readonly<ProviderPositionReadRuntimeActivationRegistry> =
  Object.freeze(
    Object.assign(Object.create(null) as ProviderPositionReadRuntimeActivationRegistry, {
      schemaVersion: 1 as const,
      use: PROVIDER_POSITION_READ_RUNTIME_REGISTRATION_USE,
      environment: 'MAINNET' as const,
      approvalStatus: 'NOT_APPROVED' as const,
      activationStatus: 'DISABLED' as const,
      mayAuthorizeFinancialAction: false as const,
      mayPersist: false as const,
      networkIds: PROVIDER_POSITION_READ_RUNTIME_NETWORK_IDS,
      registrations: Object.freeze([]) as readonly never[],
    }),
  );

export class ProviderPositionReadRuntimeUnavailableError extends Error {
  readonly code = 'PROVIDER_POSITION_READ_RUNTIME_NOT_APPROVED' as const;

  constructor() {
    super('Provider-position data is unavailable.');
    this.name = 'ProviderPositionReadRuntimeUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

function unavailable(): Promise<never> {
  return Promise.reject(new ProviderPositionReadRuntimeUnavailableError());
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

/**
 * Nest lifecycle owner for the registered provider-position read capability.
 *
 * The production registry is intentionally empty and NOT_APPROVED, so this
 * object owns no pool, provider, timer, endpoint, credential, writer, or close
 * handle. Reads reject without inspecting caller input. The separate reader
 * facade keeps Nest lifecycle methods and future runtime ownership out of the
 * capability supplied to application consumers.
 */
@Injectable()
export class ProviderPositionReadRuntimeRegistration implements OnApplicationShutdown {
  readonly reader: Readonly<MainnetProviderPositionReaderV3>;

  constructor() {
    this.reader = frozenNullPrototype<MainnetProviderPositionReaderV3>({
      readerVersion: MAINNET_PROVIDER_POSITION_READER_VERSION,
      positionSchemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
      coverageVersion: MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
      readCurrentPositions: (
        request: ReadMainnetProviderPositionsRequestV3,
      ): Promise<MainnetProviderPositionReadResultV3> => {
        void request;
        return unavailable();
      },
    });
  }

  onApplicationShutdown(): void {
    // The disabled registration owns no runtime resource or asynchronous work.
  }
}
