import { isProxy } from 'node:util/types';

import type { Pool } from 'pg';

import { RegisteredPortfolioWalletReader } from '../../portfolio/infrastructure/registered-portfolio-wallet-reader';
import {
  WalletRegistrationService,
  type WalletRegistrationClock,
} from '../../wallets/application/wallet-registration.service';
import {
  activeWalletRegistrationKey,
  assertWalletRegistrationKeyRingsIndependent,
} from '../../wallets/infrastructure/crypto/wallet-registration-crypto';
import type { EnabledWalletRegistrationConfig } from '../../wallets/infrastructure/config/wallet-registration.config';
import { PostgresWalletRegistrationRepository } from '../../wallets/infrastructure/postgres/postgres-wallet-registration.repository';
import { PostgresService } from '../../infrastructure/database/postgres.service';
import type { RuntimePostgresPoolConfig } from '../../infrastructure/database/runtime-postgres-pool';
import {
  DormantProviderPositionAdmissionCoordinator,
  type ProviderPositionAdmissionClock,
  type ProviderPositionAdmissionOptions,
  type ProviderPositionAdmissionSourceBinding,
} from '../application/provider-position-admission.coordinator';
import type { ProviderPositionTrustedChainAssessmentAssemblyPort } from '../application/ports/provider-position-trusted-chain-assessment-assembly.port';
import { NodeProviderPositionAdmissionDeadlineRunner } from './node-provider-position-admission-deadline.runner';
import {
  createDormantProviderPositionAdmissionRuntimeResource,
  ProviderPositionAdmissionRuntimeBoundsError,
} from './provider-position-admission-runtime-bounds';

const DEPENDENCY_KEYS = Object.freeze([
  'postgresConfig',
  'admissionOptions',
  'walletRegistrationConfig',
  'policyInput',
  'requiredPolicyFingerprintSha256',
  'sourceBindings',
  'clock',
] as const);
const OPTIONAL_DEPENDENCY_KEYS = Object.freeze(['trustedChainAssessmentAssembly'] as const);
const WALLET_CONFIG_KEYS = Object.freeze([
  'mode',
  'publicOrigin',
  'registryEnvironment',
  'challengeTtlSeconds',
  'identityHmacKeys',
  'challengeHmacKeys',
  'metadataSealKeys',
] as const);
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_SOURCE_BINDINGS = 512;

export interface DormantProviderPositionAdmissionRuntimeCompositionDependencies {
  readonly postgresConfig: RuntimePostgresPoolConfig;
  readonly admissionOptions: ProviderPositionAdmissionOptions;
  readonly walletRegistrationConfig: EnabledWalletRegistrationConfig;
  readonly policyInput: unknown;
  readonly requiredPolicyFingerprintSha256: string;
  readonly sourceBindings: readonly ProviderPositionAdmissionSourceBinding[];
  readonly clock: ProviderPositionAdmissionClock;
  readonly trustedChainAssessmentAssembly?: ProviderPositionTrustedChainAssessmentAssemblyPort;
}

export interface DormantProviderPositionAdmissionRuntimeComposition {
  readonly admit: DormantProviderPositionAdmissionCoordinator['admit'];
  readonly admitAndAssemble: DormantProviderPositionAdmissionCoordinator['admitAndAssemble'];
  readonly close: () => Promise<void>;
}

export type ProviderPositionAdmissionRuntimeCompositionErrorCode =
  | 'PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID'
  | 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED'
  | 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CLOSED'
  | 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CLOSE_FAILED';

export class ProviderPositionAdmissionRuntimeCompositionError extends Error {
  constructor(readonly code: ProviderPositionAdmissionRuntimeCompositionErrorCode) {
    super('Provider-position admission composition is unavailable.');
    this.name = 'ProviderPositionAdmissionRuntimeCompositionError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

interface ReviewedDependencies {
  readonly postgresConfig: RuntimePostgresPoolConfig;
  readonly admissionOptions: ProviderPositionAdmissionOptions;
  readonly walletRegistrationConfig: EnabledWalletRegistrationConfig;
  readonly policyInput: unknown;
  readonly requiredPolicyFingerprintSha256: string;
  readonly sourceBindings: readonly ProviderPositionAdmissionSourceBinding[];
  readonly clock: ProviderPositionAdmissionClock & WalletRegistrationClock;
  readonly trustedChainAssessmentAssembly:
    ProviderPositionTrustedChainAssessmentAssemblyPort | undefined;
}

interface CloseHandles {
  readonly closePostgres: () => Promise<void>;
  readonly endPool: () => Promise<void>;
}

function fail(code: ProviderPositionAdmissionRuntimeCompositionErrorCode): never {
  throw new ProviderPositionAdmissionRuntimeCompositionError(code);
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function exactDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
      return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    if (
      keys.length < requiredKeys.length ||
      keys.length > allowed.size ||
      requiredKeys.some((key) => !keys.includes(key)) ||
      keys.some((key) => typeof key !== 'string' || !allowed.has(key))
    ) {
      return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionRuntimeCompositionError) throw error;
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
  }
}

function dataArray(value: unknown, maximum: number): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const length = descriptors['length']?.value;
    if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > maximum) {
      return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
    }
    const indices = Array.from({ length: length as number }, (_, index) => String(index));
    const expected = [...indices, 'length'];
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== 'string' || !expected.includes(key))
    ) {
      return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
    }
    return Object.freeze(
      indices.map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
        }
        return descriptor.value;
      }),
    );
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionRuntimeCompositionError) throw error;
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
  }
}

function stableDataMember(value: unknown, key: PropertyKey): unknown {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      return undefined;
    }
    let current: object | null = value;
    for (let depth = 0; current !== null && depth < 8; depth += 1) {
      if (isProxy(current)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) return 'value' in descriptor ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function capturedClock(value: unknown): ProviderPositionAdmissionClock & WalletRegistrationClock {
  const now = stableDataMember(value, 'now');
  if (typeof now !== 'function' || isProxy(now)) {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
  }
  const receiver = value as object;
  return frozenNullPrototype({
    now: (): Date => Reflect.apply(now, receiver, []) as Date,
  });
}

function walletRegistrationConfigSnapshot(value: unknown): EnabledWalletRegistrationConfig {
  const record = exactDataRecord(value, WALLET_CONFIG_KEYS);
  if (
    record.mode !== 'enabled' ||
    record.registryEnvironment !== 'MAINNET' ||
    typeof record.publicOrigin !== 'string' ||
    record.publicOrigin.length < 1 ||
    record.publicOrigin.length > 2_048 ||
    !Number.isSafeInteger(record.challengeTtlSeconds) ||
    (record.challengeTtlSeconds as number) < 60 ||
    (record.challengeTtlSeconds as number) > 300
  ) {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
  }
  try {
    for (const ring of [
      record.identityHmacKeys,
      record.challengeHmacKeys,
      record.metadataSealKeys,
    ]) {
      if (typeof ring !== 'object' || ring === null || isProxy(ring) || !Object.isFrozen(ring)) {
        return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
      }
    }
    const identityHmacKeys =
      record.identityHmacKeys as EnabledWalletRegistrationConfig['identityHmacKeys'];
    const challengeHmacKeys =
      record.challengeHmacKeys as EnabledWalletRegistrationConfig['challengeHmacKeys'];
    const metadataSealKeys =
      record.metadataSealKeys as EnabledWalletRegistrationConfig['metadataSealKeys'];
    activeWalletRegistrationKey(identityHmacKeys);
    activeWalletRegistrationKey(challengeHmacKeys);
    activeWalletRegistrationKey(metadataSealKeys);
    assertWalletRegistrationKeyRingsIndependent([
      identityHmacKeys,
      challengeHmacKeys,
      metadataSealKeys,
    ]);
    return frozenNullPrototype({
      mode: 'enabled' as const,
      publicOrigin: record.publicOrigin,
      registryEnvironment: 'MAINNET' as const,
      challengeTtlSeconds: record.challengeTtlSeconds as number,
      identityHmacKeys,
      challengeHmacKeys,
      metadataSealKeys,
    });
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionRuntimeCompositionError) throw error;
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
  }
}

function reviewedDependencies(value: unknown): ReviewedDependencies {
  const record = exactDataRecord(value, DEPENDENCY_KEYS, OPTIONAL_DEPENDENCY_KEYS);
  if (
    typeof record.requiredPolicyFingerprintSha256 !== 'string' ||
    !SHA256.test(record.requiredPolicyFingerprintSha256)
  ) {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
  }
  const sourceBindings = dataArray(
    record.sourceBindings,
    MAX_SOURCE_BINDINGS,
  ) as readonly ProviderPositionAdmissionSourceBinding[];
  const trustedChainAssessmentAssembly =
    'trustedChainAssessmentAssembly' in record
      ? (record.trustedChainAssessmentAssembly as
          ProviderPositionTrustedChainAssessmentAssemblyPort | undefined)
      : undefined;
  return Object.freeze({
    postgresConfig: record.postgresConfig as RuntimePostgresPoolConfig,
    admissionOptions: record.admissionOptions as ProviderPositionAdmissionOptions,
    walletRegistrationConfig: walletRegistrationConfigSnapshot(record.walletRegistrationConfig),
    policyInput: record.policyInput,
    requiredPolicyFingerprintSha256: record.requiredPolicyFingerprintSha256,
    sourceBindings,
    clock: capturedClock(record.clock),
    trustedChainAssessmentAssembly,
  });
}

function capturePromiseMethod(value: unknown, key: PropertyKey): () => Promise<void> {
  const method = stableDataMember(value, key);
  if (typeof method !== 'function' || isProxy(method)) {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED');
  }
  const receiver = value as object;
  return (): Promise<void> => {
    try {
      return Promise.resolve(Reflect.apply(method, receiver, [])).then(() => undefined);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('operation failed'));
    }
  };
}

function runtimeBoundsFailureCode(
  error: unknown,
): ProviderPositionAdmissionRuntimeCompositionErrorCode {
  try {
    if (error instanceof ProviderPositionAdmissionRuntimeBoundsError) {
      const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
      if (code === 'PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID') {
        return 'PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID';
      }
    }
  } catch {
    // Fall through to the fixed construction failure.
  }
  return 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED';
}

async function closeOwnedRuntime(
  handles: Readonly<{
    closePostgres: (() => Promise<void>) | undefined;
    endPool: (() => Promise<void>) | undefined;
  }>,
): Promise<boolean> {
  let failed = false;
  if (handles.closePostgres !== undefined) {
    const [postgresResult] = await Promise.allSettled([handles.closePostgres()]);
    failed ||= postgresResult?.status === 'rejected';
  }
  if (handles.endPool !== undefined) {
    const [poolResult] = await Promise.allSettled([handles.endPool()]);
    failed ||= poolResult?.status === 'rejected';
  }
  return failed;
}

function admissionFacade(
  coordinator: DormantProviderPositionAdmissionCoordinator,
  handles: CloseHandles,
): Readonly<DormantProviderPositionAdmissionRuntimeComposition> {
  const admit = stableDataMember(coordinator, 'admit');
  const admitAndAssemble = stableDataMember(coordinator, 'admitAndAssemble');
  const closeAdmission = stableDataMember(coordinator, 'closeAdmission');
  if (
    typeof admit !== 'function' ||
    isProxy(admit) ||
    typeof admitAndAssemble !== 'function' ||
    isProxy(admitAndAssemble) ||
    typeof closeAdmission !== 'function' ||
    isProxy(closeAdmission)
  ) {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED');
  }

  let closed = false;
  let closePromise: Promise<void> | undefined;
  const operations = new Set<Promise<void>>();
  const run = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    if (closed) {
      return Promise.reject(
        new ProviderPositionAdmissionRuntimeCompositionError(
          'PROVIDER_POSITION_ADMISSION_COMPOSITION_CLOSED',
        ),
      );
    }
    const result = Promise.resolve().then(operation);
    const gate = result.then(
      () => undefined,
      () => undefined,
    );
    operations.add(gate);
    void gate.then(() => operations.delete(gate));
    return result;
  };
  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closed = true;
    let finish!: () => void;
    let reject!: (error: ProviderPositionAdmissionRuntimeCompositionError) => void;
    closePromise = new Promise<void>((resolve, rejectPromise) => {
      finish = resolve;
      reject = rejectPromise;
    });
    const operationGates = [...operations];
    let admissionCloseFailed = false;
    try {
      Reflect.apply(closeAdmission, coordinator, []);
    } catch {
      admissionCloseFailed = true;
    }
    let postgresDrain: Promise<void>;
    try {
      postgresDrain = handles.closePostgres();
    } catch (error) {
      postgresDrain = Promise.reject(error instanceof Error ? error : new Error('close failed'));
    }
    void Promise.allSettled([postgresDrain, ...operationGates]).then(async (drainResults) => {
      const [poolResult] = await Promise.allSettled([handles.endPool()]);
      if (
        admissionCloseFailed ||
        drainResults[0]?.status === 'rejected' ||
        poolResult?.status === 'rejected'
      ) {
        reject(
          new ProviderPositionAdmissionRuntimeCompositionError(
            'PROVIDER_POSITION_ADMISSION_COMPOSITION_CLOSE_FAILED',
          ),
        );
        return;
      }
      finish();
    });
    return closePromise;
  };

  return frozenNullPrototype({
    admit: ((request) =>
      run(
        () =>
          Reflect.apply(admit, coordinator, [request]) as ReturnType<
            DormantProviderPositionAdmissionCoordinator['admit']
          >,
      )) as DormantProviderPositionAdmissionCoordinator['admit'],
    admitAndAssemble: ((request) =>
      run(
        () =>
          Reflect.apply(admitAndAssemble, coordinator, [request]) as ReturnType<
            DormantProviderPositionAdmissionCoordinator['admitAndAssemble']
          >,
      )) as DormantProviderPositionAdmissionCoordinator['admitAndAssemble'],
    close,
  });
}

/**
 * Builds a private, dormant provider-position read graph from one reviewed
 * runtime-budget resource. Construction is allocation-only: it performs no
 * database query, provider request, environment lookup, or feature
 * registration. The exact resource pool and options are consumed in-process
 * and never escape the returned closure facade.
 *
 * `close` stops new facade admissions, aborts all active coordinator work,
 * cancels/drains PostgreSQL roster work, waits for every already-admitted
 * coordinator call, and only then ends the pool. A started non-cooperative
 * provider can still delay close indefinitely; allowing that work to escape
 * would be less safe than waiting for physical settlement.
 */
export async function createDormantProviderPositionAdmissionRuntimeComposition(
  dependenciesInput: DormantProviderPositionAdmissionRuntimeCompositionDependencies,
): Promise<Readonly<DormantProviderPositionAdmissionRuntimeComposition>> {
  let dependencies: ReviewedDependencies;
  try {
    dependencies = reviewedDependencies(dependenciesInput);
  } catch {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID');
  }

  let runtimeResource: ReturnType<typeof createDormantProviderPositionAdmissionRuntimeResource>;
  try {
    runtimeResource = createDormantProviderPositionAdmissionRuntimeResource(
      dependencies.postgresConfig,
      dependencies.admissionOptions,
    );
  } catch (error) {
    return fail(runtimeBoundsFailureCode(error));
  }

  let endPool: (() => Promise<void>) | undefined;
  let closePostgres: (() => Promise<void>) | undefined;
  try {
    const pool: Pool = runtimeResource.pool;
    endPool = capturePromiseMethod(pool, 'end');
    const postgres = new PostgresService(pool);
    closePostgres = capturePromiseMethod(postgres, 'closeCancellableQueries');
    const walletRepository = new PostgresWalletRegistrationRepository(postgres);
    const walletService = new WalletRegistrationService(
      walletRepository,
      dependencies.walletRegistrationConfig,
      dependencies.clock,
    );
    const walletReader = new RegisteredPortfolioWalletReader(walletService);
    const deadlineRunner = new NodeProviderPositionAdmissionDeadlineRunner(dependencies.clock);
    const coordinator = new DormantProviderPositionAdmissionCoordinator(
      dependencies.policyInput,
      dependencies.requiredPolicyFingerprintSha256,
      dependencies.sourceBindings,
      walletReader,
      dependencies.clock,
      deadlineRunner,
      runtimeResource.admissionOptions,
      dependencies.trustedChainAssessmentAssembly,
    );
    return admissionFacade(coordinator, { closePostgres, endPool });
  } catch {
    await closeOwnedRuntime({ closePostgres, endPool });
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED');
  }
}
