const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CANONICAL_USD_MINOR = /^(?:0|[1-9][0-9]{0,17})$/u;
const CANONICAL_SIGNED_USD_MINOR = /^(?:0|-?[1-9][0-9]{0,17})$/u;
const LOCAL_DEMO_PORTFOLIO_SNAPSHOT_ID = /^local-demo-portfolio:[0-9a-f]{32}$/u;

export const LOCAL_DEMO_YIELD_CATALOG_PATH = '/api/v1/local-demo/yield-catalog' as const;
export const LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID = 'managed-rate-snapshot-v2' as const;
export const LOCAL_DEMO_YIELD_ECOSYSTEMS = Object.freeze(['EVM', 'SOLANA'] as const);

export const LOCAL_DEMO_ALLOCATION_PRESETS = Object.freeze([
  Object.freeze({
    id: 'MORE_LIQUID',
    label: 'More liquid',
    description:
      'Keep 60% readily available and allocate the remainder to the managed yield strategy.',
    liquidReserveBasisPoints: 6_000,
  }),
  Object.freeze({
    id: 'BALANCED',
    label: 'Balanced blend',
    description:
      'Keep 30% readily available and allocate the remainder to the managed yield strategy.',
    liquidReserveBasisPoints: 3_000,
  }),
  Object.freeze({
    id: 'MORE_YIELD',
    label: 'More yield',
    description:
      'Keep 15% readily available and allocate the remainder to the managed yield strategy.',
    liquidReserveBasisPoints: 1_500,
  }),
] as const);

export const LOCAL_DEMO_EXECUTION_COST_COMPONENTS = Object.freeze([
  'NETWORK',
  'CONVERSION',
  'CROSS_ECOSYSTEM_TRANSFER',
  'MARKET_IMPACT',
  'ROUTING',
] as const);
export const LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS = 365 as const;

export type LocalDemoAllocationPresetId = (typeof LOCAL_DEMO_ALLOCATION_PRESETS)[number]['id'];
export type LocalDemoYieldFreshness = 'CURRENT' | 'STALE';
export type LocalDemoYieldEcosystem = (typeof LOCAL_DEMO_YIELD_ECOSYSTEMS)[number];
export type LocalDemoExecutionCostComponentCode =
  (typeof LOCAL_DEMO_EXECUTION_COST_COMPONENTS)[number];

export type LocalDemoAllocationSelectionInput = Readonly<{
  kind: 'PRESET';
  presetId: LocalDemoAllocationPresetId;
}>;

export interface LocalDemoYieldCatalog {
  readonly use: 'LOCAL_DEMO_MANAGED_RATE_SNAPSHOT_ONLY';
  readonly mayAuthorizeFinancialAction: false;
  readonly riskClassificationAvailable: false;
  readonly strategyMode: 'PORTFOLIO_CROSS_CHAIN_BLEND';
  readonly ecosystems: readonly ['EVM', 'SOLANA'];
  readonly snapshot: Readonly<{
    id: typeof LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID;
    capturedAt: string;
    staleAfter: string;
    freshness: LocalDemoYieldFreshness;
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE';
    riskClassification: 'NOT_ASSESSED';
  }>;
}

export interface LocalDemoAllocationPreview {
  readonly use: 'LOCAL_DEMO_ESTIMATE_ONLY';
  readonly mayAuthorizeFinancialAction: false;
  readonly portfolioSnapshotId: string;
  readonly selection: Readonly<{
    kind: 'PRESET';
    presetId: LocalDemoAllocationPresetId;
    label: string;
    description: string;
    liquidReserveBasisPoints: number;
  }>;
  readonly rateSnapshot: Readonly<{
    id: typeof LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID;
    capturedAt: string;
    staleAfter: string;
    freshness: LocalDemoYieldFreshness;
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE';
    riskClassificationAvailable: false;
    riskClassification: 'NOT_ASSESSED';
  }>;
  readonly grossCapitalUsdMinor: string;
  readonly sourceCapitalByEcosystem: readonly Readonly<{
    ecosystem: LocalDemoYieldEcosystem;
    amountUsdMinor: string;
  }>[];
  readonly allocations: readonly Readonly<{
    bucket: 'LIQUID_RESERVE' | 'MANAGED_YIELD';
    allocationId: 'LIQUID_RESERVE' | 'MANAGED_YIELD';
    label: 'Liquid reserve' | 'Managed yield';
    percentageBasisPoints: number;
    amountUsdMinor: string;
  }>[];
  readonly managedYieldComposition: readonly Readonly<{
    ecosystem: LocalDemoYieldEcosystem;
    label: 'EVM managed yield' | 'SVM managed yield';
    percentageBasisPointsOfManagedYield: number;
    amountUsdMinor: string;
  }>[];
  readonly compositionSummary: Readonly<{
    mode: 'SINGLE_ECOSYSTEM' | 'EVM_SOLANA_PORTFOLIO_BLEND';
    crossEcosystemTransferRequired: false;
    crossEcosystemTransferUsdMinor: '0';
    activeEcosystemCount: 1 | 2;
    activeAllocationCount: number;
  }>;
  readonly executionCost: Readonly<{
    actualLocalOperation: Readonly<{
      status: 'NO_EXECUTION';
      amountUsdMinor: '0';
    }>;
    modeledScenario: Readonly<{
      status: 'AVAILABLE';
      modelId: 'LOCAL_DEMO_ALLOCATION_COST_V2';
      isQuote: false;
      costBasisCapitalUsdMinor: string;
      fundingTreatment: 'DEDUCT_FROM_GROSS_BEFORE_PROJECTION';
      rounding: 'CEIL_EACH_VARIABLE_COMPONENT_TO_USD_MINOR';
      components: readonly Readonly<{
        code: LocalDemoExecutionCostComponentCode;
        label: string;
        calculationBasis:
          | 'NETWORK_ACTIVATION_AND_POSITION_VOLUME'
          | 'TWELVE_BPS_OF_REQUIRED_CONVERSION'
          | 'NO_CROSS_ECOSYSTEM_TRANSFER'
          | 'POSITION_SIZE_AND_UTILIZATION'
          | 'TWENTY_CENTS_PER_ACTIVE_ALLOCATION';
        amountUsdMinor: string;
      }>[];
      totalUsdMinor: string;
    }>;
    publicExecution: Readonly<{
      status: 'UNQUOTED';
      amountUsdMinor: null;
    }>;
  }>;
  readonly capitalIncludedInProjectionUsdMinor: string;
  readonly yieldProjection: Readonly<{
    source: 'MANAGED_RATE_SNAPSHOT';
    calculationMethod: 'INTERNAL_POSITION_WEIGHTED_EXACT_BASE_APY';
    effectiveApyBasisPoints: number;
    projectedAnnualYieldUsdMinor: string;
    projectedAnnualYieldAfterFeesUsdMinor: string;
    firstPositiveDayAfterFees: Readonly<{
      calculationMethod: 'FIRST_WHOLE_DAY_VISIBLE_YIELD_EXCEEDS_ESTIMATED_FEES';
      status: 'RECOVERED_WITHIN_HORIZON' | 'NO_PROJECTED_YIELD' | 'NOT_RECOVERED_WITHIN_HORIZON';
      day: number | null;
      modelHorizonDays: typeof LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS;
    }>;
  }>;
  readonly asOf: string;
}

const COST_COMPONENT_POLICY = Object.freeze({
  NETWORK: Object.freeze({
    label: 'Estimated network costs',
    calculationBasis: 'NETWORK_ACTIVATION_AND_POSITION_VOLUME' as const,
  }),
  CONVERSION: Object.freeze({
    label: 'Estimated conversion costs',
    calculationBasis: 'TWELVE_BPS_OF_REQUIRED_CONVERSION' as const,
  }),
  CROSS_ECOSYSTEM_TRANSFER: Object.freeze({
    label: 'Estimated EVM-Solana transfer costs',
    calculationBasis: 'NO_CROSS_ECOSYSTEM_TRANSFER' as const,
  }),
  MARKET_IMPACT: Object.freeze({
    label: 'Estimated market impact',
    calculationBasis: 'POSITION_SIZE_AND_UTILIZATION' as const,
  }),
  ROUTING: Object.freeze({
    label: 'Estimated routing fee',
    calculationBasis: 'TWENTY_CENTS_PER_ACTIVE_ALLOCATION' as const,
  }),
});

function invalid(): never {
  throw new TypeError('Invalid local demo yield response');
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return invalid();
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return invalid();
      }
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Invalid local demo yield response') {
      throw error;
    }
    return invalid();
  }
}

function exactArray(value: unknown, length: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !('value' in lengthDescriptor) || lengthDescriptor.value !== length) {
      return invalid();
    }
    const expected = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expected.size ||
      keys.some((key) => typeof key !== 'string' || !expected.has(key))
    ) {
      return invalid();
    }
    return Object.freeze(
      Array.from({ length }, (_, index) => {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
          return invalid();
        }
        return descriptor.value;
      }),
    );
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Invalid local demo yield response') {
      throw error;
    }
    return invalid();
  }
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return invalid();
  return value;
}

function usdMinor(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_USD_MINOR.test(value)) return invalid();
  return value;
}

function signedUsdMinor(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_SIGNED_USD_MINOR.test(value)) return invalid();
  return value;
}

function boundedInteger(value: unknown, minimum = 0, maximum = 10_000): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid();
  }
  return value;
}

interface ExactAnnualYieldInterval {
  readonly lowerScaled: bigint;
  readonly upperExclusiveScaled: bigint;
  readonly scale: 10_000n;
}

function exactAnnualYieldInterval(
  projectedAnnualYieldUsdMinor: string,
  capitalIncludedInProjectionUsdMinor: string,
  effectiveApyBasisPoints: number,
): ExactAnnualYieldInterval | null {
  const annualYield = BigInt(projectedAnnualYieldUsdMinor);
  const capital = BigInt(capitalIncludedInProjectionUsdMinor);
  if (capital <= 0n) return null;

  // The API intentionally keeps the exact internal rate private. These two
  // public values are floors of that same exact annual-yield amount, so their
  // half-open rational intervals must overlap.
  const lowerScaled =
    annualYield * 10_000n > BigInt(effectiveApyBasisPoints) * capital
      ? annualYield * 10_000n
      : BigInt(effectiveApyBasisPoints) * capital;
  const upperFromYield = (annualYield + 1n) * 10_000n;
  const upperFromApy = BigInt(effectiveApyBasisPoints + 1) * capital;
  const upperExclusive = upperFromYield < upperFromApy ? upperFromYield : upperFromApy;
  return lowerScaled < upperExclusive
    ? Object.freeze({ lowerScaled, upperExclusiveScaled: upperExclusive, scale: 10_000n as const })
    : null;
}

function firstPositiveDayIsConsistent(
  projectedAnnualYieldUsdMinor: string,
  estimatedCostUsdMinor: bigint,
  exactAnnualYield: ExactAnnualYieldInterval,
  status: LocalDemoAllocationPreview['yieldProjection']['firstPositiveDayAfterFees']['status'],
  day: number | null,
): boolean {
  const annualYieldFloor = BigInt(projectedAnnualYieldUsdMinor);
  if (annualYieldFloor === 0n) {
    // The private exact value is either zero or a positive fraction of one
    // cent per year. Neither can recover at least one cent within 365 days.
    if (day !== null || status === 'RECOVERED_WITHIN_HORIZON') return false;
    return status === 'NOT_RECOVERED_WITHIN_HORIZON' || exactAnnualYield.lowerScaled === 0n;
  }
  if (status === 'NO_PROJECTED_YIELD') return false;

  const targetAnnualizedYield =
    (estimatedCostUsdMinor + 1n) *
    BigInt(LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS) *
    exactAnnualYield.scale;
  // Intersecting the public whole-cent yield and rounded APY intervals gives
  // the complete possible range for the private exact recovery day.
  const earliestPossibleDay = targetAnnualizedYield / exactAnnualYield.upperExclusiveScaled + 1n;
  const latestPossibleDay =
    (targetAnnualizedYield + exactAnnualYield.lowerScaled - 1n) / exactAnnualYield.lowerScaled;
  const horizon = BigInt(LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS);

  if (status === 'NOT_RECOVERED_WITHIN_HORIZON') {
    return day === null && latestPossibleDay > horizon;
  }
  return (
    day !== null &&
    BigInt(day) >= earliestPossibleDay &&
    BigInt(day) <= latestPossibleDay &&
    BigInt(day) <= horizon
  );
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) return invalid();
  return value as Values[number];
}

function parseSnapshot(
  value: unknown,
  includeRiskFlag: boolean,
): LocalDemoYieldCatalog['snapshot'] | LocalDemoAllocationPreview['rateSnapshot'] {
  const record = exactRecord(value, [
    'id',
    'capturedAt',
    'staleAfter',
    'freshness',
    'staleBehavior',
    ...(includeRiskFlag ? ['riskClassificationAvailable'] : []),
    'riskClassification',
  ]);
  if (
    record.id !== LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID ||
    record.staleBehavior !== 'LABEL_STALE_KEEP_NON_EXECUTABLE' ||
    record.riskClassification !== 'NOT_ASSESSED' ||
    (includeRiskFlag && record.riskClassificationAvailable !== false)
  ) {
    return invalid();
  }
  const capturedAt = timestamp(record.capturedAt);
  const staleAfter = timestamp(record.staleAfter);
  if (Date.parse(staleAfter) <= Date.parse(capturedAt)) return invalid();
  const base = {
    id: LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID,
    capturedAt,
    staleAfter,
    freshness: enumValue(record.freshness, ['CURRENT', 'STALE'] as const),
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE' as const,
    riskClassification: 'NOT_ASSESSED' as const,
  };
  return includeRiskFlag
    ? Object.freeze({ ...base, riskClassificationAvailable: false as const })
    : Object.freeze(base);
}

export function parseLocalDemoYieldCatalog(value: unknown): LocalDemoYieldCatalog {
  const record = exactRecord(value, [
    'use',
    'mayAuthorizeFinancialAction',
    'riskClassificationAvailable',
    'strategyMode',
    'ecosystems',
    'snapshot',
  ]);
  if (
    record.use !== 'LOCAL_DEMO_MANAGED_RATE_SNAPSHOT_ONLY' ||
    record.mayAuthorizeFinancialAction !== false ||
    record.riskClassificationAvailable !== false ||
    record.strategyMode !== 'PORTFOLIO_CROSS_CHAIN_BLEND'
  ) {
    return invalid();
  }
  const ecosystems = exactArray(record.ecosystems, LOCAL_DEMO_YIELD_ECOSYSTEMS.length);
  if (ecosystems.some((ecosystem, index) => ecosystem !== LOCAL_DEMO_YIELD_ECOSYSTEMS[index])) {
    return invalid();
  }
  return Object.freeze({
    use: 'LOCAL_DEMO_MANAGED_RATE_SNAPSHOT_ONLY',
    mayAuthorizeFinancialAction: false,
    riskClassificationAvailable: false,
    strategyMode: 'PORTFOLIO_CROSS_CHAIN_BLEND',
    ecosystems: LOCAL_DEMO_YIELD_ECOSYSTEMS,
    snapshot: parseSnapshot(record.snapshot, false) as LocalDemoYieldCatalog['snapshot'],
  });
}

export function validateLocalDemoPortfolioSnapshotId(value: unknown): string {
  if (typeof value !== 'string' || !LOCAL_DEMO_PORTFOLIO_SNAPSHOT_ID.test(value)) return invalid();
  return value;
}

export function validateLocalDemoAllocationSelection(
  value: LocalDemoAllocationSelectionInput,
): LocalDemoAllocationSelectionInput {
  const record = exactRecord(value, ['kind', 'presetId']);
  if (record.kind !== 'PRESET') return invalid();
  return Object.freeze({
    kind: 'PRESET',
    presetId: enumValue(
      record.presetId,
      LOCAL_DEMO_ALLOCATION_PRESETS.map(({ id }) => id),
    ),
  });
}

function distribute(total: bigint, weights: readonly number[]): readonly bigint[] {
  const amounts = weights.map((weight) => (total * BigInt(weight)) / 10_000n);
  const remainders = weights.map((weight, index) => ({
    index,
    value: (total * BigInt(weight)) % 10_000n,
  }));
  let remaining = total - amounts.reduce((sum, amount) => sum + amount, 0n);
  remainders.sort((left, right) =>
    left.value === right.value ? left.index - right.index : left.value > right.value ? -1 : 1,
  );
  for (const { index } of remainders) {
    if (remaining === 0n) break;
    const current = amounts[index];
    if (current === undefined) return invalid();
    amounts[index] = current + 1n;
    remaining -= 1n;
  }
  if (remaining !== 0n) return invalid();
  return Object.freeze(amounts);
}

function distributeByAmounts(total: bigint, weights: readonly bigint[]): readonly bigint[] {
  const denominator = weights.reduce((sum, weight) => sum + weight, 0n);
  if (total < 0n || denominator <= 0n || weights.some((weight) => weight < 0n)) return invalid();
  const amounts = weights.map((weight) => (total * weight) / denominator);
  const remainders = weights.map((weight, index) => ({
    index,
    value: (total * weight) % denominator,
  }));
  let remaining = total - amounts.reduce((sum, amount) => sum + amount, 0n);
  remainders.sort((left, right) =>
    left.value === right.value ? left.index - right.index : left.value > right.value ? -1 : 1,
  );
  for (const { index } of remainders) {
    if (remaining === 0n) break;
    const current = amounts[index];
    if (current === undefined) return invalid();
    amounts[index] = current + 1n;
    remaining -= 1n;
  }
  if (remaining !== 0n) return invalid();
  return Object.freeze(amounts);
}

function parseExecutionCost(
  value: unknown,
  grossCapital: bigint,
): LocalDemoAllocationPreview['executionCost'] {
  const record = exactRecord(value, ['actualLocalOperation', 'modeledScenario', 'publicExecution']);
  const actual = exactRecord(record.actualLocalOperation, ['status', 'amountUsdMinor']);
  if (actual.status !== 'NO_EXECUTION' || actual.amountUsdMinor !== '0') return invalid();
  const modeled = exactRecord(record.modeledScenario, [
    'status',
    'modelId',
    'isQuote',
    'costBasisCapitalUsdMinor',
    'fundingTreatment',
    'rounding',
    'components',
    'totalUsdMinor',
  ]);
  if (
    modeled.status !== 'AVAILABLE' ||
    modeled.modelId !== 'LOCAL_DEMO_ALLOCATION_COST_V2' ||
    modeled.isQuote !== false ||
    modeled.fundingTreatment !== 'DEDUCT_FROM_GROSS_BEFORE_PROJECTION' ||
    modeled.rounding !== 'CEIL_EACH_VARIABLE_COMPONENT_TO_USD_MINOR'
  ) {
    return invalid();
  }
  const costBasisCapitalUsdMinor = usdMinor(modeled.costBasisCapitalUsdMinor);
  if (BigInt(costBasisCapitalUsdMinor) !== grossCapital) return invalid();
  const components = Object.freeze(
    exactArray(modeled.components, LOCAL_DEMO_EXECUTION_COST_COMPONENTS.length).map(
      (candidate, index) => {
        const component = exactRecord(candidate, [
          'code',
          'label',
          'calculationBasis',
          'amountUsdMinor',
        ]);
        const expectedCode = LOCAL_DEMO_EXECUTION_COST_COMPONENTS[index];
        if (expectedCode === undefined || component.code !== expectedCode) return invalid();
        const policy = COST_COMPONENT_POLICY[expectedCode];
        if (
          component.label !== policy.label ||
          component.calculationBasis !== policy.calculationBasis
        ) {
          return invalid();
        }
        const amountUsdMinor = usdMinor(component.amountUsdMinor);
        if (expectedCode === 'CROSS_ECOSYSTEM_TRANSFER' && amountUsdMinor !== '0') {
          return invalid();
        }
        return Object.freeze({
          code: expectedCode,
          label: policy.label,
          calculationBasis: policy.calculationBasis,
          amountUsdMinor,
        });
      },
    ),
  );
  const totalUsdMinor = usdMinor(modeled.totalUsdMinor);
  if (
    components.reduce((sum, component) => sum + BigInt(component.amountUsdMinor), 0n) !==
    BigInt(totalUsdMinor)
  ) {
    return invalid();
  }
  const publicExecution = exactRecord(record.publicExecution, ['status', 'amountUsdMinor']);
  if (publicExecution.status !== 'UNQUOTED' || publicExecution.amountUsdMinor !== null) {
    return invalid();
  }
  return Object.freeze({
    actualLocalOperation: Object.freeze({ status: 'NO_EXECUTION', amountUsdMinor: '0' }),
    modeledScenario: Object.freeze({
      status: 'AVAILABLE',
      modelId: 'LOCAL_DEMO_ALLOCATION_COST_V2',
      isQuote: false,
      costBasisCapitalUsdMinor,
      fundingTreatment: 'DEDUCT_FROM_GROSS_BEFORE_PROJECTION',
      rounding: 'CEIL_EACH_VARIABLE_COMPONENT_TO_USD_MINOR',
      components,
      totalUsdMinor,
    }),
    publicExecution: Object.freeze({ status: 'UNQUOTED', amountUsdMinor: null }),
  });
}

export function parseLocalDemoAllocationPreview(value: unknown): LocalDemoAllocationPreview {
  const record = exactRecord(value, [
    'use',
    'mayAuthorizeFinancialAction',
    'portfolioSnapshotId',
    'selection',
    'rateSnapshot',
    'grossCapitalUsdMinor',
    'sourceCapitalByEcosystem',
    'allocations',
    'managedYieldComposition',
    'compositionSummary',
    'executionCost',
    'capitalIncludedInProjectionUsdMinor',
    'yieldProjection',
    'asOf',
  ]);
  if (record.use !== 'LOCAL_DEMO_ESTIMATE_ONLY' || record.mayAuthorizeFinancialAction !== false) {
    return invalid();
  }
  const portfolioSnapshotId = validateLocalDemoPortfolioSnapshotId(record.portfolioSnapshotId);
  const selectionRecord = exactRecord(record.selection, [
    'kind',
    'presetId',
    'label',
    'description',
    'liquidReserveBasisPoints',
  ]);
  if (selectionRecord.kind !== 'PRESET') return invalid();
  const presetId = enumValue(
    selectionRecord.presetId,
    LOCAL_DEMO_ALLOCATION_PRESETS.map(({ id }) => id),
  );
  const preset = LOCAL_DEMO_ALLOCATION_PRESETS.find(({ id }) => id === presetId);
  if (
    preset === undefined ||
    selectionRecord.label !== preset.label ||
    selectionRecord.description !== preset.description ||
    selectionRecord.liquidReserveBasisPoints !== preset.liquidReserveBasisPoints
  ) {
    return invalid();
  }
  const selection = Object.freeze({
    kind: 'PRESET' as const,
    presetId,
    label: preset.label,
    description: preset.description,
    liquidReserveBasisPoints: preset.liquidReserveBasisPoints,
  });
  const rateSnapshot = parseSnapshot(
    record.rateSnapshot,
    true,
  ) as LocalDemoAllocationPreview['rateSnapshot'];
  const grossCapitalUsdMinor = usdMinor(record.grossCapitalUsdMinor);
  const grossCapital = BigInt(grossCapitalUsdMinor);
  const sourceCapitalByEcosystem = Object.freeze(
    exactArray(record.sourceCapitalByEcosystem, LOCAL_DEMO_YIELD_ECOSYSTEMS.length).map(
      (candidate, index) => {
        const source = exactRecord(candidate, ['ecosystem', 'amountUsdMinor']);
        const ecosystem = LOCAL_DEMO_YIELD_ECOSYSTEMS[index];
        if (ecosystem === undefined || source.ecosystem !== ecosystem) return invalid();
        return Object.freeze({ ecosystem, amountUsdMinor: usdMinor(source.amountUsdMinor) });
      },
    ),
  );
  if (
    sourceCapitalByEcosystem.reduce((sum, source) => sum + BigInt(source.amountUsdMinor), 0n) !==
    grossCapital
  ) {
    return invalid();
  }
  const executionCost = parseExecutionCost(record.executionCost, grossCapital);
  const estimatedCost = BigInt(executionCost.modeledScenario.totalUsdMinor);
  const capitalIncludedInProjectionUsdMinor = usdMinor(record.capitalIncludedInProjectionUsdMinor);
  const capitalIncludedInProjection = BigInt(capitalIncludedInProjectionUsdMinor);
  if (
    estimatedCost >= grossCapital ||
    grossCapital - estimatedCost !== capitalIncludedInProjection
  ) {
    return invalid();
  }

  const allocations = Object.freeze(
    exactArray(record.allocations, 2).map((candidate, index) => {
      const allocation = exactRecord(candidate, [
        'bucket',
        'allocationId',
        'label',
        'percentageBasisPoints',
        'amountUsdMinor',
      ]);
      const expected =
        index === 0
          ? Object.freeze({
              bucket: 'LIQUID_RESERVE' as const,
              allocationId: 'LIQUID_RESERVE' as const,
              label: 'Liquid reserve' as const,
              percentageBasisPoints: preset.liquidReserveBasisPoints,
            })
          : Object.freeze({
              bucket: 'MANAGED_YIELD' as const,
              allocationId: 'MANAGED_YIELD' as const,
              label: 'Managed yield' as const,
              percentageBasisPoints: 10_000 - preset.liquidReserveBasisPoints,
            });
      if (
        allocation.bucket !== expected.bucket ||
        allocation.allocationId !== expected.allocationId ||
        allocation.label !== expected.label ||
        allocation.percentageBasisPoints !== expected.percentageBasisPoints
      ) {
        return invalid();
      }
      return Object.freeze({ ...expected, amountUsdMinor: usdMinor(allocation.amountUsdMinor) });
    }),
  );
  const expectedAmounts = distribute(capitalIncludedInProjection, [
    preset.liquidReserveBasisPoints,
    10_000 - preset.liquidReserveBasisPoints,
  ]);
  if (
    allocations.some(
      (allocation, index) => BigInt(allocation.amountUsdMinor) !== expectedAmounts[index],
    ) ||
    allocations.reduce((sum, allocation) => sum + BigInt(allocation.amountUsdMinor), 0n) !==
      capitalIncludedInProjection
  ) {
    return invalid();
  }

  const managedYieldAmount = BigInt(allocations[1]!.amountUsdMinor);
  const managedYieldComposition = Object.freeze(
    exactArray(record.managedYieldComposition, LOCAL_DEMO_YIELD_ECOSYSTEMS.length).map(
      (candidate, index) => {
        const composition = exactRecord(candidate, [
          'ecosystem',
          'label',
          'percentageBasisPointsOfManagedYield',
          'amountUsdMinor',
        ]);
        const ecosystem = LOCAL_DEMO_YIELD_ECOSYSTEMS[index];
        const label = index === 0 ? ('EVM managed yield' as const) : ('SVM managed yield' as const);
        if (
          ecosystem === undefined ||
          composition.ecosystem !== ecosystem ||
          composition.label !== label
        ) {
          return invalid();
        }
        const percentageBasisPointsOfManagedYield = boundedInteger(
          composition.percentageBasisPointsOfManagedYield,
        );
        const amountUsdMinor = usdMinor(composition.amountUsdMinor);
        const sourceAmount = BigInt(sourceCapitalByEcosystem[index]!.amountUsdMinor);
        const amount = BigInt(amountUsdMinor);
        if (
          amount > sourceAmount ||
          (sourceAmount === 0n && (amount !== 0n || percentageBasisPointsOfManagedYield !== 0)) ||
          (amount === 0n) !== (percentageBasisPointsOfManagedYield === 0)
        ) {
          return invalid();
        }
        return Object.freeze({
          ecosystem,
          label,
          percentageBasisPointsOfManagedYield,
          amountUsdMinor,
        });
      },
    ),
  );
  if (
    managedYieldComposition.reduce(
      (sum, composition) => sum + BigInt(composition.amountUsdMinor),
      0n,
    ) !== managedYieldAmount ||
    managedYieldComposition.reduce(
      (sum, composition) => sum + composition.percentageBasisPointsOfManagedYield,
      0,
    ) !== (managedYieldAmount > 0n ? 10_000 : 0) ||
    managedYieldComposition.some(
      (composition, index) =>
        BigInt(composition.percentageBasisPointsOfManagedYield) !==
        distributeByAmounts(
          10_000n,
          managedYieldComposition.map(({ amountUsdMinor }) => BigInt(amountUsdMinor)),
        )[index],
    )
  ) {
    return invalid();
  }

  const activeEcosystemCount = managedYieldComposition.filter(
    (composition) => BigInt(composition.amountUsdMinor) > 0n,
  ).length;
  if (activeEcosystemCount !== 1 && activeEcosystemCount !== 2) return invalid();
  const compositionRecord = exactRecord(record.compositionSummary, [
    'mode',
    'crossEcosystemTransferRequired',
    'crossEcosystemTransferUsdMinor',
    'activeEcosystemCount',
    'activeAllocationCount',
  ]);
  const expectedMode =
    activeEcosystemCount === 2
      ? ('EVM_SOLANA_PORTFOLIO_BLEND' as const)
      : ('SINGLE_ECOSYSTEM' as const);
  if (
    compositionRecord.mode !== expectedMode ||
    compositionRecord.crossEcosystemTransferRequired !== false ||
    compositionRecord.crossEcosystemTransferUsdMinor !== '0' ||
    compositionRecord.activeEcosystemCount !== activeEcosystemCount
  ) {
    return invalid();
  }
  const activeAllocationCount = boundedInteger(
    compositionRecord.activeAllocationCount,
    activeEcosystemCount,
    4,
  );
  const compositionSummary = Object.freeze({
    mode: expectedMode,
    crossEcosystemTransferRequired: false as const,
    crossEcosystemTransferUsdMinor: '0' as const,
    activeEcosystemCount: activeEcosystemCount as 1 | 2,
    activeAllocationCount,
  });

  const projectionRecord = exactRecord(record.yieldProjection, [
    'source',
    'calculationMethod',
    'effectiveApyBasisPoints',
    'projectedAnnualYieldUsdMinor',
    'projectedAnnualYieldAfterFeesUsdMinor',
    'firstPositiveDayAfterFees',
  ]);
  if (
    projectionRecord.source !== 'MANAGED_RATE_SNAPSHOT' ||
    projectionRecord.calculationMethod !== 'INTERNAL_POSITION_WEIGHTED_EXACT_BASE_APY'
  ) {
    return invalid();
  }
  const projectedAnnualYieldUsdMinor = usdMinor(projectionRecord.projectedAnnualYieldUsdMinor);
  const projectedAnnualYieldAfterFeesUsdMinor = signedUsdMinor(
    projectionRecord.projectedAnnualYieldAfterFeesUsdMinor,
  );
  if (
    BigInt(projectedAnnualYieldUsdMinor) - estimatedCost !==
    BigInt(projectedAnnualYieldAfterFeesUsdMinor)
  ) {
    return invalid();
  }
  const effectiveApyBasisPoints = boundedInteger(projectionRecord.effectiveApyBasisPoints);
  const exactAnnualYield = exactAnnualYieldInterval(
    projectedAnnualYieldUsdMinor,
    capitalIncludedInProjectionUsdMinor,
    effectiveApyBasisPoints,
  );
  if (exactAnnualYield === null) return invalid();
  const firstPositiveRecord = exactRecord(projectionRecord.firstPositiveDayAfterFees, [
    'calculationMethod',
    'status',
    'day',
    'modelHorizonDays',
  ]);
  if (
    firstPositiveRecord.calculationMethod !==
      'FIRST_WHOLE_DAY_VISIBLE_YIELD_EXCEEDS_ESTIMATED_FEES' ||
    firstPositiveRecord.modelHorizonDays !== LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS
  ) {
    return invalid();
  }
  const firstPositiveStatus = enumValue(firstPositiveRecord.status, [
    'RECOVERED_WITHIN_HORIZON',
    'NO_PROJECTED_YIELD',
    'NOT_RECOVERED_WITHIN_HORIZON',
  ] as const);
  const day =
    firstPositiveStatus === 'RECOVERED_WITHIN_HORIZON'
      ? boundedInteger(firstPositiveRecord.day, 1, LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS)
      : firstPositiveRecord.day === null
        ? null
        : invalid();
  if (
    !firstPositiveDayIsConsistent(
      projectedAnnualYieldUsdMinor,
      estimatedCost,
      exactAnnualYield,
      firstPositiveStatus,
      day,
    )
  ) {
    return invalid();
  }
  return Object.freeze({
    use: 'LOCAL_DEMO_ESTIMATE_ONLY',
    mayAuthorizeFinancialAction: false,
    portfolioSnapshotId,
    selection,
    rateSnapshot,
    grossCapitalUsdMinor,
    sourceCapitalByEcosystem,
    allocations,
    managedYieldComposition,
    compositionSummary,
    executionCost,
    capitalIncludedInProjectionUsdMinor,
    yieldProjection: Object.freeze({
      source: 'MANAGED_RATE_SNAPSHOT',
      calculationMethod: 'INTERNAL_POSITION_WEIGHTED_EXACT_BASE_APY',
      effectiveApyBasisPoints,
      projectedAnnualYieldUsdMinor,
      projectedAnnualYieldAfterFeesUsdMinor,
      firstPositiveDayAfterFees: Object.freeze({
        calculationMethod: 'FIRST_WHOLE_DAY_VISIBLE_YIELD_EXCEEDS_ESTIMATED_FEES',
        status: firstPositiveStatus,
        day,
        modelHorizonDays: LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS,
      }),
    }),
    asOf: timestamp(record.asOf),
  });
}
