import { isProxy } from 'node:util/types';

import type { Pool } from 'pg';

import { parseAccountId } from '../../accounts/domain/account-profile';
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
  isIssuedProviderPositionAdmissionReadOnlyAssemblyV1,
  type ProviderPositionAdmissionReadOnlyAssemblyV1,
  type ProviderPositionAdmissionClock,
  type ProviderPositionAdmissionOptions,
  type ProviderPositionAdmissionSourceBinding,
} from '../application/provider-position-admission.coordinator';
import {
  MAINNET_PROVIDER_POSITION_READER_VERSION,
  type MainnetProviderPositionReadResultV3,
  type MainnetProviderPositionReaderV3,
  type ReadMainnetProviderPositionsRequestV3,
} from '../application/ports/mainnet-provider-position-reader.port';
import type { ProviderPositionDurableChainAnchorReaderPort } from '../application/ports/provider-position-durable-chain-anchor-reader.port';
import { MAINNET_PROVIDER_POSITION_COVERAGE_VERSION } from '../domain/mainnet-provider-position-coverage';
import { MAINNET_PROVIDER_POSITION_SCHEMA_VERSION } from '../domain/mainnet-provider-position-observation';
import { DormantProviderPositionTrustedChainAssessmentAssembler } from './dormant-provider-position-trusted-chain-assessment.assembler';
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
const OPTIONAL_DEPENDENCY_KEYS = Object.freeze(['durableChainAnchorReader'] as const);
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
const CORRELATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_SOURCE_BINDINGS = 512;
const READER_REQUEST_KEYS = Object.freeze(['accountId', 'correlationId'] as const);

export interface DormantProviderPositionAdmissionRuntimeCompositionDependencies {
  readonly postgresConfig: RuntimePostgresPoolConfig;
  readonly admissionOptions: ProviderPositionAdmissionOptions;
  readonly walletRegistrationConfig: EnabledWalletRegistrationConfig;
  readonly policyInput: unknown;
  readonly requiredPolicyFingerprintSha256: string;
  readonly sourceBindings: readonly ProviderPositionAdmissionSourceBinding[];
  readonly clock: ProviderPositionAdmissionClock;
  readonly durableChainAnchorReader?: ProviderPositionDurableChainAnchorReaderPort;
}

export interface DormantProviderPositionAdmissionRuntimeComposition {
  readonly admit: DormantProviderPositionAdmissionCoordinator['admit'];
  readonly admitAndAssemble: DormantProviderPositionAdmissionCoordinator['admitAndAssemble'];
  readonly reader: Readonly<MainnetProviderPositionReaderV3>;
  readonly close: () => Promise<void>;
}

export type ProviderPositionAdmissionRuntimeCompositionErrorCode =
  | 'PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID'
  | 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED'
  | 'PROVIDER_POSITION_ADMISSION_COMPOSITION_CLOSED'
  | 'PROVIDER_POSITION_ADMISSION_COMPOSITION_READ_FAILED'
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
  readonly durableChainAnchorReader: ProviderPositionDurableChainAnchorReaderPort | undefined;
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
  code: ProviderPositionAdmissionRuntimeCompositionErrorCode = 'PROVIDER_POSITION_ADMISSION_COMPOSITION_INVALID',
): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
      return fail(code);
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return fail(code);
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
      return fail(code);
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return fail(code);
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionRuntimeCompositionError) throw error;
    return fail(code);
  }
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_READ_FAILED');
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    Date.prototype.toISOString.call(new Date(milliseconds)) !== value
  ) {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_READ_FAILED');
  }
  return value;
}

function readerRequest(value: unknown): Readonly<ReadMainnetProviderPositionsRequestV3> {
  const record = exactDataRecord(
    value,
    READER_REQUEST_KEYS,
    [],
    'PROVIDER_POSITION_ADMISSION_COMPOSITION_READ_FAILED',
  );
  let accountId: ReturnType<typeof parseAccountId>;
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_READ_FAILED');
  }
  if (typeof record.correlationId !== 'string' || !CORRELATION_ID.test(record.correlationId)) {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_READ_FAILED');
  }
  return frozenNullPrototype({ accountId, correlationId: record.correlationId });
}

function readerResult(
  value: unknown,
  request: Readonly<ReadMainnetProviderPositionsRequestV3>,
): Readonly<MainnetProviderPositionReadResultV3> {
  if (!isIssuedProviderPositionAdmissionReadOnlyAssemblyV1(value)) {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_READ_FAILED');
  }

  const candidate = value.admissionCandidate;
  const coveredSnapshot = value.coveredSnapshot;
  const candidateCoverageManifest = candidate.coverageManifest;
  const coverageManifest = coveredSnapshot.coverageManifest;
  const evaluatedAt = canonicalTimestamp(value.evaluatedAt);
  const capturedAt = canonicalTimestamp(coveredSnapshot.capturedAt);
  const staleAfter = canonicalTimestamp(coveredSnapshot.staleAfter);
  if (
    candidate.accountId !== request.accountId ||
    candidate.correlationId !== request.correlationId ||
    candidate.freshnessClass !== 'CURRENT' ||
    coveredSnapshot.freshnessClass !== 'CURRENT' ||
    coverageManifest.freshnessClass !== 'CURRENT' ||
    coverageManifest.accountId !== request.accountId ||
    candidateCoverageManifest.accountId !== request.accountId ||
    coveredSnapshot.snapshotId !== candidate.positionSnapshotId ||
    coverageManifest.positionSnapshotId !== candidate.positionSnapshotId ||
    candidateCoverageManifest.positionSnapshotId !== candidate.positionSnapshotId ||
    coveredSnapshot.observationPolicyVersion !== candidate.observationPolicyVersion ||
    coveredSnapshot.observationPolicyId !== candidate.observationPolicyId ||
    coveredSnapshot.observationPolicyFingerprintSha256 !==
      candidate.observationPolicyFingerprintSha256 ||
    coveredSnapshot.assetRegistryVersion !== candidate.assetRegistryVersion ||
    coveredSnapshot.assetRegistryFingerprintSha256 !== candidate.assetRegistryFingerprintSha256 ||
    coverageManifest.observationPolicyVersion !== candidate.observationPolicyVersion ||
    coverageManifest.observationPolicyId !== candidate.observationPolicyId ||
    coverageManifest.observationPolicyFingerprintSha256 !==
      candidate.observationPolicyFingerprintSha256 ||
    coverageManifest.assetRegistryVersion !== candidate.assetRegistryVersion ||
    coverageManifest.assetRegistryFingerprintSha256 !== candidate.assetRegistryFingerprintSha256 ||
    candidateCoverageManifest.observationPolicyVersion !== candidate.observationPolicyVersion ||
    candidateCoverageManifest.observationPolicyId !== candidate.observationPolicyId ||
    candidateCoverageManifest.observationPolicyFingerprintSha256 !==
      candidate.observationPolicyFingerprintSha256 ||
    candidateCoverageManifest.assetRegistryVersion !== candidate.assetRegistryVersion ||
    candidateCoverageManifest.assetRegistryFingerprintSha256 !==
      candidate.assetRegistryFingerprintSha256 ||
    candidateCoverageManifest.manifestId !== coverageManifest.manifestId ||
    candidateCoverageManifest.fingerprintSha256 !== coverageManifest.fingerprintSha256 ||
    coveredSnapshot.capturedAt !== candidate.capturedAt ||
    coveredSnapshot.staleAfter !== candidate.staleAfter ||
    coverageManifest.capturedAt !== candidate.capturedAt ||
    coverageManifest.staleAfter !== candidate.staleAfter ||
    candidateCoverageManifest.capturedAt !== candidate.capturedAt ||
    candidateCoverageManifest.staleAfter !== candidate.staleAfter ||
    candidateCoverageManifest.freshnessClass !== 'CURRENT' ||
    Date.parse(capturedAt) > Date.parse(evaluatedAt) ||
    Date.parse(evaluatedAt) >= Date.parse(staleAfter)
  ) {
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_READ_FAILED');
  }
  return frozenNullPrototype({
    evaluatedAt,
    coveredSnapshot,
  });
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
  const durableChainAnchorReader =
    'durableChainAnchorReader' in record
      ? (record.durableChainAnchorReader as
          ProviderPositionDurableChainAnchorReaderPort | undefined)
      : undefined;
  return Object.freeze({
    postgresConfig: record.postgresConfig as RuntimePostgresPoolConfig,
    admissionOptions: record.admissionOptions as ProviderPositionAdmissionOptions,
    walletRegistrationConfig: walletRegistrationConfigSnapshot(record.walletRegistrationConfig),
    policyInput: record.policyInput,
    requiredPolicyFingerprintSha256: record.requiredPolicyFingerprintSha256,
    sourceBindings,
    clock: capturedClock(record.clock),
    durableChainAnchorReader,
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

  const reader = frozenNullPrototype({
    readerVersion: MAINNET_PROVIDER_POSITION_READER_VERSION,
    positionSchemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
    coverageVersion: MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,
    readCurrentPositions: (
      requestInput: ReadMainnetProviderPositionsRequestV3,
    ): Promise<Readonly<MainnetProviderPositionReadResultV3>> =>
      run(async () => {
        try {
          const request = readerRequest(requestInput);
          const assembly = await (Reflect.apply(admitAndAssemble, coordinator, [
            request,
          ]) as Promise<ProviderPositionAdmissionReadOnlyAssemblyV1>);
          return readerResult(assembly, request);
        } catch {
          return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_READ_FAILED');
        }
      }),
  });

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
    reader,
    close,
  });
}

/**
 * Builds a private, dormant provider-position read graph from one reviewed
 * runtime-budget resource. Construction is allocation-only: it performs no
 * database query, provider request, environment lookup, or feature
 * registration. The exact resource pool and options are consumed in-process
 * and never escape the returned closure facade. Its nested reader capability
 * returns only server-timed covered snapshots; it exposes no candidate,
 * verifier, persistence, lifecycle, or financial-action authority.
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
    const trustedChainAssessmentAssembly =
      dependencies.durableChainAnchorReader === undefined
        ? undefined
        : new DormantProviderPositionTrustedChainAssessmentAssembler(
            dependencies.durableChainAnchorReader,
          );
    const coordinator = new DormantProviderPositionAdmissionCoordinator(
      dependencies.policyInput,
      dependencies.requiredPolicyFingerprintSha256,
      dependencies.sourceBindings,
      walletReader,
      dependencies.clock,
      deadlineRunner,
      runtimeResource.admissionOptions,
      trustedChainAssessmentAssembly,
    );
    return admissionFacade(coordinator, { closePostgres, endPool });
  } catch {
    await closeOwnedRuntime({ closePostgres, endPool });
    return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED');
  }
}
