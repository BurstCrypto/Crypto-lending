import {
  AuthenticationUnauthenticatedError,
  readAuthenticationCsrfToken,
  type AuthenticationFetch,
} from '@/lib/authentication';
import { isAbortFailure, readBoundedJson, retryAfterSeconds } from '@/lib/authentication/http';
import { assertWalletAccount, type ChainId } from '@/lib/wallets/wallet-adapter';

import {
  parseLocalDemoPortfolioResponse,
  type LocalDemoBalanceApiResponse,
} from './local-demo-portfolio-response';

export const LOCAL_DEMO_WALLETS_PATH = '/api/v1/local-demo/wallets';
export const LOCAL_DEMO_PORTFOLIO_PATH = '/api/v1/local-demo/portfolio';
export const LOCAL_DEMO_ALLOCATION_PREVIEW_PATH = '/api/v1/local-demo/allocation-preview';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const USD_MINOR = /^(?:0|[1-9][0-9]{0,17})$/u;
const MAX_REGISTERED_WALLETS = 2;
const LOCAL_DEMO_CONNECTOR_NETWORKS = Object.freeze({
  EVM: 'eip155:11155111',
  SOLANA: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
} as const);

export const LOCAL_DEMO_ALLOCATION_PRESETS = Object.freeze([
  Object.freeze({
    id: 'MORE_LIQUID',
    label: 'More liquid',
    description: 'Keep most capital readily available while adding a smaller yield allocation.',
    percentages: Object.freeze({
      LIQUID_RESERVE: 6000,
      CONSERVATIVE_YIELD: 3000,
      BALANCED_YIELD: 1000,
    }),
  }),
  Object.freeze({
    id: 'BALANCED',
    label: 'Balanced blend',
    description: 'Split capital between ready access and diversified synthetic yield.',
    percentages: Object.freeze({
      LIQUID_RESERVE: 3000,
      CONSERVATIVE_YIELD: 4500,
      BALANCED_YIELD: 2500,
    }),
  }),
  Object.freeze({
    id: 'MORE_YIELD',
    label: 'More yield',
    description: 'Put more capital toward synthetic yield while retaining a liquid reserve.',
    percentages: Object.freeze({
      LIQUID_RESERVE: 1500,
      CONSERVATIVE_YIELD: 3500,
      BALANCED_YIELD: 5000,
    }),
  }),
] as const);

const ALLOCATION_BUCKETS = Object.freeze([
  'LIQUID_RESERVE',
  'CONSERVATIVE_YIELD',
  'BALANCED_YIELD',
] as const);
const ALLOCATION_DEDUCTION_CODES = Object.freeze([
  'LIQUIDITY',
  'CONVERSION',
  'SLIPPAGE',
  'NETWORK',
  'ROUTING',
] as const);
const ALLOCATION_DEDUCTION_BASIS_POINTS = Object.freeze({
  LIQUIDITY: 5000,
  CONVERSION: 1000,
  SLIPPAGE: 1000,
  NETWORK: 1000,
  ROUTING: 2000,
} as const);
const ALLOCATION_BUCKET_LABELS: Readonly<Record<LocalDemoAllocationBucket, string>> = Object.freeze(
  {
    LIQUID_RESERVE: 'Liquid reserve',
    CONSERVATIVE_YIELD: 'Conservative yield',
    BALANCED_YIELD: 'Balanced yield',
  },
);

export type LocalDemoAllocationPresetId = (typeof LOCAL_DEMO_ALLOCATION_PRESETS)[number]['id'];
export type LocalDemoAllocationBucket = (typeof ALLOCATION_BUCKETS)[number];
export type LocalDemoAllocationDeductionCode = (typeof ALLOCATION_DEDUCTION_CODES)[number];

export interface LocalDemoAllocationPreview {
  readonly use: 'LOCAL_DEMO_ESTIMATE_ONLY';
  readonly mayAuthorizeFinancialAction: false;
  readonly preset: Readonly<{
    id: LocalDemoAllocationPresetId;
    label: string;
    description: string;
  }>;
  readonly grossCapitalUsdMinor: string;
  readonly allocations: readonly Readonly<{
    bucket: LocalDemoAllocationBucket;
    label: string;
    percentageBasisPoints: number;
    amountUsdMinor: string;
  }>[];
  readonly deductions: readonly Readonly<{
    code: LocalDemoAllocationDeductionCode;
    amountUsdMinor: string;
  }>[];
  readonly totalFeesUsdMinor: string;
  readonly netPlannedCapitalUsdMinor: string;
  readonly asOf: string;
}

export type LocalDemoWalletNamespace = 'EVM' | 'SOLANA';
export type LocalDemoApiErrorCode =
  'CONFLICT' | 'INVALID_RESPONSE' | 'UNAUTHENTICATED' | 'UNAVAILABLE';

export class LocalDemoApiError extends Error {
  constructor(
    readonly code: LocalDemoApiErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(
      code === 'UNAUTHENTICATED'
        ? 'Authentication is required.'
        : code === 'CONFLICT'
          ? 'The local demo wallet is already in use.'
          : 'The local demo is unavailable.',
    );
    this.name = 'LocalDemoApiError';
  }
}

export interface LocalDemoWalletProjection {
  readonly connectionId: string;
  readonly walletId: string;
  readonly label: string;
  readonly namespace: LocalDemoWalletNamespace;
  readonly chainId: ChainId;
  readonly address: string;
  readonly registeredAt: string;
}

export interface LocalDemoApiClientOptions {
  readonly cookieHeader?: string | (() => string);
  readonly fetch?: AuthenticationFetch;
}

function fail(code: LocalDemoApiErrorCode = 'INVALID_RESPONSE', retry?: number): never {
  throw new LocalDemoApiError(code, retry);
}

function ownDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== expectedKeys.length ||
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !expectedKeys.includes(key),
      ) ||
      expectedKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor))
    ) {
      return fail();
    }
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [
        key,
        'value' in descriptor ? descriptor.value : undefined,
      ]),
    );
  } catch (error) {
    if (error instanceof LocalDemoApiError) throw error;
    return fail();
  }
}

function safeText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    FORBIDDEN_TEXT.test(value)
  ) {
    return fail();
  }
  return value;
}

function canonicalUsdMinor(value: unknown): string {
  if (typeof value !== 'string' || !USD_MINOR.test(value)) return fail();
  return value;
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return fail();
  return value;
}

function exactArray(value: unknown, expectedLength: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || value.length !== expectedLength) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedKeys = [
      ...new Array<string>(expectedLength).fill('').map((_, index) => String(index)),
      'length',
    ];
    if (
      Reflect.ownKeys(descriptors).length !== expectedKeys.length ||
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !expectedKeys.includes(key),
      ) ||
      expectedKeys.some(
        (key) => !Object.hasOwn(descriptors, key) || !('value' in descriptors[key]!),
      )
    ) {
      return fail();
    }
    return Object.freeze(
      expectedKeys
        .slice(0, -1)
        .map((key) => ('value' in descriptors[key]! ? descriptors[key]!.value : undefined)),
    );
  } catch (error) {
    if (error instanceof LocalDemoApiError) throw error;
    return fail();
  }
}

function allocationPreset(value: unknown) {
  if (typeof value !== 'string') return fail();
  const preset = LOCAL_DEMO_ALLOCATION_PRESETS.find(({ id }) => id === value);
  return preset ?? fail();
}

function allocationBucket(value: unknown): LocalDemoAllocationBucket {
  if (
    typeof value !== 'string' ||
    !ALLOCATION_BUCKETS.includes(value as LocalDemoAllocationBucket)
  ) {
    return fail();
  }
  return value as LocalDemoAllocationBucket;
}

function allocationDeductionCode(value: unknown): LocalDemoAllocationDeductionCode {
  if (
    typeof value !== 'string' ||
    !ALLOCATION_DEDUCTION_CODES.includes(value as LocalDemoAllocationDeductionCode)
  ) {
    return fail();
  }
  return value as LocalDemoAllocationDeductionCode;
}

function distributeUsdMinor(total: bigint, basisPoints: readonly number[]): readonly bigint[] {
  const denominator = 10_000n;
  const amounts = basisPoints.map((basisPoint) => (total * BigInt(basisPoint)) / denominator);
  const remainders = basisPoints.map((basisPoint, index) => ({
    index,
    value: (total * BigInt(basisPoint)) % denominator,
  }));
  let undistributed = total - amounts.reduce((sum, amount) => sum + amount, 0n);
  remainders.sort((left, right) =>
    left.value === right.value ? left.index - right.index : left.value > right.value ? -1 : 1,
  );
  for (const { index } of remainders) {
    if (undistributed === 0n) break;
    const amount = amounts[index];
    if (amount === undefined) return fail();
    amounts[index] = amount + 1n;
    undistributed -= 1n;
  }
  if (undistributed !== 0n) return fail();
  return Object.freeze(amounts);
}

export function parseLocalDemoAllocationPreview(value: unknown): LocalDemoAllocationPreview {
  try {
    const record = ownDataRecord(value, [
      'use',
      'mayAuthorizeFinancialAction',
      'preset',
      'grossCapitalUsdMinor',
      'allocations',
      'deductions',
      'totalFeesUsdMinor',
      'netPlannedCapitalUsdMinor',
      'asOf',
    ]);
    if (record.use !== 'LOCAL_DEMO_ESTIMATE_ONLY' || record.mayAuthorizeFinancialAction !== false) {
      return fail();
    }

    const presetRecord = ownDataRecord(record.preset, ['id', 'label', 'description']);
    const presetDefinition = allocationPreset(presetRecord.id);
    if (
      presetRecord.label !== presetDefinition.label ||
      presetRecord.description !== presetDefinition.description
    ) {
      return fail();
    }
    const preset = Object.freeze({
      id: presetDefinition.id,
      label: presetDefinition.label,
      description: presetDefinition.description,
    });

    const grossCapitalUsdMinor = canonicalUsdMinor(record.grossCapitalUsdMinor);
    const grossCapital = BigInt(grossCapitalUsdMinor);
    const expectedAllocationAmounts = distributeUsdMinor(
      grossCapital,
      ALLOCATION_BUCKETS.map((bucket) => presetDefinition.percentages[bucket]),
    );
    const allocations = Object.freeze(
      exactArray(record.allocations, ALLOCATION_BUCKETS.length).map((value) => {
        const allocation = ownDataRecord(value, [
          'bucket',
          'label',
          'percentageBasisPoints',
          'amountUsdMinor',
        ]);
        const bucket = allocationBucket(allocation.bucket);
        const percentageBasisPoints = presetDefinition.percentages[bucket];
        if (
          allocation.label !== ALLOCATION_BUCKET_LABELS[bucket] ||
          allocation.percentageBasisPoints !== percentageBasisPoints
        ) {
          return fail();
        }
        const amountUsdMinor = canonicalUsdMinor(allocation.amountUsdMinor);
        const expectedAmount = expectedAllocationAmounts[ALLOCATION_BUCKETS.indexOf(bucket)];
        if (expectedAmount === undefined || BigInt(amountUsdMinor) !== expectedAmount) {
          return fail();
        }
        return Object.freeze({
          bucket,
          label: ALLOCATION_BUCKET_LABELS[bucket],
          percentageBasisPoints,
          amountUsdMinor,
        });
      }),
    );
    if (
      new Set(allocations.map(({ bucket }) => bucket)).size !== ALLOCATION_BUCKETS.length ||
      allocations.reduce((total, allocation) => total + BigInt(allocation.amountUsdMinor), 0n) !==
        grossCapital
    ) {
      return fail();
    }

    const nonReserveCapital = allocations
      .filter(({ bucket }) => bucket !== 'LIQUID_RESERVE')
      .reduce((total, allocation) => total + BigInt(allocation.amountUsdMinor), 0n);
    const expectedTotalFees = nonReserveCapital / 100n;
    const expectedDeductionAmounts = distributeUsdMinor(
      expectedTotalFees,
      ALLOCATION_DEDUCTION_CODES.map((code) => ALLOCATION_DEDUCTION_BASIS_POINTS[code]),
    );
    const deductions = Object.freeze(
      exactArray(record.deductions, ALLOCATION_DEDUCTION_CODES.length).map((value) => {
        const deduction = ownDataRecord(value, ['code', 'amountUsdMinor']);
        const code = allocationDeductionCode(deduction.code);
        const amountUsdMinor = canonicalUsdMinor(deduction.amountUsdMinor);
        const expectedAmount = expectedDeductionAmounts[ALLOCATION_DEDUCTION_CODES.indexOf(code)];
        if (expectedAmount === undefined || BigInt(amountUsdMinor) !== expectedAmount) {
          return fail();
        }
        return Object.freeze({
          code,
          amountUsdMinor,
        });
      }),
    );
    if (new Set(deductions.map(({ code }) => code)).size !== ALLOCATION_DEDUCTION_CODES.length) {
      return fail();
    }
    const totalFeesUsdMinor = canonicalUsdMinor(record.totalFeesUsdMinor);
    const totalFees = BigInt(totalFeesUsdMinor);
    if (
      totalFees !== expectedTotalFees ||
      deductions.reduce((total, deduction) => total + BigInt(deduction.amountUsdMinor), 0n) !==
        totalFees
    ) {
      return fail();
    }
    const netPlannedCapitalUsdMinor = canonicalUsdMinor(record.netPlannedCapitalUsdMinor);
    if (
      totalFees > grossCapital ||
      grossCapital - totalFees !== BigInt(netPlannedCapitalUsdMinor)
    ) {
      return fail();
    }

    return Object.freeze({
      use: 'LOCAL_DEMO_ESTIMATE_ONLY',
      mayAuthorizeFinancialAction: false,
      preset,
      grossCapitalUsdMinor,
      allocations,
      deductions,
      totalFeesUsdMinor,
      netPlannedCapitalUsdMinor,
      asOf: canonicalTimestamp(record.asOf),
    });
  } catch (error) {
    if (error instanceof LocalDemoApiError) throw error;
    return fail();
  }
}

function parseProjection(value: unknown): LocalDemoWalletProjection {
  const record = ownDataRecord(value, [
    'connectionId',
    'walletId',
    'label',
    'namespace',
    'chainId',
    'address',
    'registeredAt',
  ]);
  const connectionId = safeText(record.connectionId, 256);
  const walletId = safeText(record.walletId, 36);
  const label = safeText(record.label, 64);
  const chainId = safeText(record.chainId, 96);
  const address = safeText(record.address, 128);
  const registeredAt = safeText(record.registeredAt, 24);
  if (!UUID_V4.test(connectionId) || !UUID_V4.test(walletId) || connectionId !== walletId) {
    return fail();
  }
  if (record.namespace !== 'EVM' && record.namespace !== 'SOLANA') return fail();
  if (chainId !== LOCAL_DEMO_CONNECTOR_NETWORKS[record.namespace]) return fail();
  const registeredDate = new Date(registeredAt);
  if (
    !CANONICAL_TIMESTAMP.test(registeredAt) ||
    !Number.isFinite(registeredDate.getTime()) ||
    registeredDate.toISOString() !== registeredAt
  ) {
    return fail();
  }
  const adapterNamespace = record.namespace === 'EVM' ? 'eip155' : 'solana';
  try {
    assertWalletAccount({ chainId, address }, adapterNamespace);
  } catch {
    return fail();
  }
  if (record.namespace === 'EVM' && address !== address.toLowerCase()) return fail();
  return Object.freeze({
    connectionId,
    walletId,
    label,
    namespace: record.namespace,
    chainId: chainId as ChainId,
    address,
    registeredAt,
  });
}

export function parseLocalDemoWallets(value: unknown): readonly LocalDemoWalletProjection[] {
  try {
    if (!Array.isArray(value) || value.length > MAX_REGISTERED_WALLETS) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedKeys = [...value.map((_, index) => String(index)), 'length'];
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !expectedKeys.includes(key),
      ) ||
      expectedKeys.some(
        (key) => !Object.hasOwn(descriptors, key) || !('value' in descriptors[key]!),
      )
    ) {
      return fail();
    }
    const wallets = Object.freeze(value.map((wallet) => parseProjection(wallet)));
    if (
      new Set(wallets.map(({ connectionId }) => connectionId)).size !== wallets.length ||
      new Set(wallets.map(({ walletId }) => walletId)).size !== wallets.length ||
      new Set(wallets.map(({ namespace }) => namespace)).size !== wallets.length ||
      new Set(wallets.map(({ chainId, address }) => `${chainId}\0${address}`)).size !==
        wallets.length
    ) {
      return fail();
    }
    return wallets;
  } catch (error) {
    if (error instanceof LocalDemoApiError) throw error;
    return fail();
  }
}

function browserCookieHeader(): string {
  return typeof document === 'undefined' ? '' : document.cookie;
}

function requestInit(
  method: 'GET' | 'POST' | 'DELETE',
  signal: AbortSignal | undefined,
  body?: string,
  csrfToken?: string,
): RequestInit {
  return {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrfToken === undefined ? {} : { 'X-CSRF-Token': csrfToken }),
    },
    ...(body === undefined ? {} : { body }),
    ...(signal === undefined ? {} : { signal }),
  };
}

export class LocalDemoApiClient {
  readonly #cookieHeader: string | (() => string);
  readonly #fetch: AuthenticationFetch;

  constructor(options: LocalDemoApiClientOptions = {}) {
    this.#cookieHeader = options.cookieHeader ?? browserCookieHeader;
    this.#fetch =
      options.fetch ??
      ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  }

  async listWallets(signal?: AbortSignal): Promise<readonly LocalDemoWalletProjection[]> {
    const response = await this.#request(
      LOCAL_DEMO_WALLETS_PATH,
      requestInit('GET', signal),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));
    return parseLocalDemoWallets(await this.#json(response));
  }

  async registerWallet(
    namespace: LocalDemoWalletNamespace,
    signal?: AbortSignal,
  ): Promise<LocalDemoWalletProjection> {
    const response = await this.#unsafeRequest(
      LOCAL_DEMO_WALLETS_PATH,
      'POST',
      JSON.stringify({ namespace }),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status === 409) return fail('CONFLICT');
    if (response.status !== 201) {
      return fail('UNAVAILABLE', retryAfterSeconds(response));
    }
    const projection = parseProjection(await this.#json(response));
    if (projection.namespace !== namespace) return fail();
    return projection;
  }

  async disconnectWallet(connectionId: string, signal?: AbortSignal): Promise<void> {
    if (!UUID_V4.test(connectionId)) return fail();
    const response = await this.#unsafeRequest(
      LOCAL_DEMO_WALLETS_PATH,
      'DELETE',
      JSON.stringify({ connectionId }),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 204) return fail('UNAVAILABLE', retryAfterSeconds(response));
  }

  async readPortfolio(signal?: AbortSignal): Promise<LocalDemoBalanceApiResponse> {
    const response = await this.#request(
      LOCAL_DEMO_PORTFOLIO_PATH,
      requestInit('GET', signal),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parseLocalDemoPortfolioResponse(await this.#json(response));
    } catch {
      return fail();
    }
  }

  async previewAllocation(
    presetId: LocalDemoAllocationPresetId,
    signal?: AbortSignal,
  ): Promise<LocalDemoAllocationPreview> {
    allocationPreset(presetId);
    const response = await this.#unsafeRequest(
      LOCAL_DEMO_ALLOCATION_PREVIEW_PATH,
      'POST',
      JSON.stringify({ presetId }),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));
    const preview = parseLocalDemoAllocationPreview(await this.#json(response));
    if (preview.preset.id !== presetId) return fail();
    return preview;
  }

  async #unsafeRequest(
    path: typeof LOCAL_DEMO_WALLETS_PATH | typeof LOCAL_DEMO_ALLOCATION_PREVIEW_PATH,
    method: 'POST' | 'DELETE',
    body: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    let csrfToken: string;
    try {
      const cookieHeader =
        typeof this.#cookieHeader === 'function' ? this.#cookieHeader() : this.#cookieHeader;
      csrfToken = readAuthenticationCsrfToken(cookieHeader);
    } catch {
      return fail('UNAUTHENTICATED');
    }
    return this.#request(path, requestInit(method, signal, body, csrfToken), signal);
  }

  async #request(
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    try {
      return await this.#fetch(path, init);
    } catch (error) {
      if (isAbortFailure(error, signal)) throw error;
      return fail('UNAVAILABLE');
    }
  }

  async #json(response: Response): Promise<unknown> {
    try {
      return await readBoundedJson(response);
    } catch {
      return fail();
    }
  }
}

export function isLocalDemoUnauthenticated(error: unknown): boolean {
  return (
    (error instanceof LocalDemoApiError && error.code === 'UNAUTHENTICATED') ||
    error instanceof AuthenticationUnauthenticatedError
  );
}
