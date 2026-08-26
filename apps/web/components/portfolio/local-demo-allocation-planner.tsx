'use client';

import { useEffect, useRef, useState } from 'react';

import { isAbortFailure } from '@/lib/authentication/http';
import {
  isLocalDemoUnauthenticated,
  LocalDemoApiError,
  type LocalDemoApiClient,
} from '@/lib/local-demo/local-demo-client';
import {
  LOCAL_DEMO_ALLOCATION_PRESETS,
  LOCAL_DEMO_LIQUID_RESERVE_STEP_BASIS_POINTS,
  LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS,
  LOCAL_DEMO_MIN_LIQUID_RESERVE_BASIS_POINTS,
  type LocalDemoAllocationPreview,
  type LocalDemoAllocationSelectionInput,
  type LocalDemoYieldCatalog,
} from '@/lib/local-demo/local-demo-yield';
import { formatUsdMinor } from '@/lib/portfolio/unified-balance';

const AS_OF_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export interface LocalDemoAllocationPlannerProps {
  readonly client: LocalDemoApiClient;
  readonly portfolioSnapshotId: string;
  readonly onUnauthenticated?: () => void;
  readonly onPortfolioSnapshotChanged?: () => void;
}

function Money({ amountUsdMinor }: { amountUsdMinor: string }) {
  const formatted = formatUsdMinor(amountUsdMinor);
  return (
    <data value={formatted.decimal} aria-label={formatted.accessible}>
      <span aria-hidden="true">{formatted.visible}</span>
    </data>
  );
}

function SignedMoney({ amountUsdMinor }: { amountUsdMinor: string }) {
  const negative = amountUsdMinor.startsWith('-');
  const absolute = negative ? amountUsdMinor.slice(1) : amountUsdMinor;
  const formatted = formatUsdMinor(absolute);
  return (
    <data
      value={`${negative ? '-' : ''}${formatted.decimal}`}
      aria-label={`${negative ? 'negative ' : ''}${formatted.accessible}`}
    >
      <span aria-hidden="true">
        {negative ? '-' : ''}
        {formatted.visible}
      </span>
    </data>
  );
}

function percentage(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  return fraction === 0 ? `${whole}%` : `${whole}.${fraction.toString().padStart(2, '0')}%`;
}

function Apy({ basisPoints }: { basisPoints: number }) {
  const decimal = `${Math.floor(basisPoints / 100)}.${(basisPoints % 100)
    .toString()
    .padStart(2, '0')}`;
  return (
    <data value={decimal} aria-label={`${decimal} percent estimated annual percentage yield`}>
      <span aria-hidden="true">{decimal}%</span>
    </data>
  );
}

function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{AS_OF_FORMATTER.format(new Date(value))} UTC</time>;
}

function RateStatus({ catalog }: { catalog: LocalDemoYieldCatalog }) {
  return (
    <section className="local-demo-yield-catalog" aria-labelledby="local-demo-yield-catalog-title">
      <div className="local-demo-yield-catalog-heading">
        <div>
          <p className="eyebrow">Managed rate data</p>
          <h3 id="local-demo-yield-catalog-title">Crypto Lending yield plans</h3>
        </div>
        <span
          className={`local-demo-yield-freshness is-${catalog.snapshot.freshness.toLowerCase()}`}
        >
          {catalog.snapshot.freshness === 'CURRENT' ? 'Rates current' : 'Archived rates · stale'}
        </span>
      </div>
      <p className="local-demo-yield-catalog-copy">
        Choose a Crypto Lending plan below. Estimates blend supported EVM and Solana fixture
        balances with a locally cached, point-in-time managed rate set and make no live external
        request. Rates can change and risk has not been assessed.
      </p>
      <p className="local-demo-yield-catalog-copy">
        This is a portfolio-composition fixture. It does not create a route, bridge assets, contact
        a validator, or authorize a transaction.
      </p>
      <p className="local-demo-yield-catalog-time">
        Rates captured <Timestamp value={catalog.snapshot.capturedAt} />. Data became stale after{' '}
        <Timestamp value={catalog.snapshot.staleAfter} />.
      </p>
    </section>
  );
}

function feeBasisCopy(
  basis: LocalDemoAllocationPreview['executionCost']['modeledScenario']['components'][number]['calculationBasis'],
): string {
  switch (basis) {
    case 'NETWORK_ACTIVATION_AND_POSITION_VOLUME':
      return 'Varies with planned network actions and allocation size.';
    case 'TWELVE_BPS_OF_REQUIRED_CONVERSION':
      return '0.12% only on capital that requires asset conversion.';
    case 'NO_CROSS_ECOSYSTEM_TRANSFER':
      return 'No EVM-to-Solana principal transfer is included in this composition.';
    case 'POSITION_SIZE_AND_UTILIZATION':
      return 'Varies with allocation size and modeled liquidity utilization.';
    case 'TWENTY_CENTS_PER_ACTIVE_ALLOCATION':
      return '$0.20 for each active managed allocation.';
  }
}

function EcosystemComposition({ preview }: { preview: LocalDemoAllocationPreview }) {
  return (
    <section
      className="local-demo-ecosystem-composition"
      aria-labelledby="local-demo-ecosystem-composition-title"
    >
      <div className="local-demo-ecosystem-composition-heading">
        <div>
          <p className="eyebrow">Portfolio-level cross-chain blend</p>
          <h4 id="local-demo-ecosystem-composition-title">Managed allocation by ecosystem</h4>
        </div>
        <p>
          {preview.compositionSummary.activeEcosystemCount}{' '}
          {preview.compositionSummary.activeEcosystemCount === 1 ? 'ecosystem' : 'ecosystems'} ·{' '}
          {preview.compositionSummary.activeAllocationCount}{' '}
          {preview.compositionSummary.activeAllocationCount === 1 ? 'allocation' : 'allocations'}
        </p>
      </div>
      <ul className="local-demo-ecosystem-list">
        {preview.managedYieldComposition.map((composition, index) => {
          const source = preview.sourceCapitalByEcosystem[index]!;
          return (
            <li key={composition.ecosystem}>
              <strong>{composition.label}</strong>
              <dl className="local-demo-ecosystem-values">
                <div className="local-demo-ecosystem-managed-amount">
                  <dt>Managed amount</dt>
                  <dd>
                    <Money amountUsdMinor={composition.amountUsdMinor} />
                  </dd>
                </div>
                <div>
                  <dt>Source capital</dt>
                  <dd>
                    <Money amountUsdMinor={source.amountUsdMinor} />
                  </dd>
                </div>
                <div>
                  <dt>Share of managed yield</dt>
                  <dd>
                    <data
                      value={(composition.percentageBasisPointsOfManagedYield / 100).toFixed(2)}
                      aria-label={`${percentage(composition.percentageBasisPointsOfManagedYield)} of managed yield`}
                    >
                      {percentage(composition.percentageBasisPointsOfManagedYield)}
                    </data>
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
      <div className="local-demo-native-route-note" role="note">
        <strong>No EVM-to-Solana transfer is modeled.</strong>
        <p>
          Capital remains assigned to its wallet ecosystem. Modeled EVM-to-Solana transfer:{' '}
          <Money amountUsdMinor={preview.compositionSummary.crossEcosystemTransferUsdMinor} />. This
          is a local composition fixture—not a live route, bridge quote, or transaction. EVM network
          placement remains hypothetical and public execution is unquoted.
        </p>
      </div>
    </section>
  );
}

interface LiquidityAdjustmentProps {
  readonly appliedBasisPoints: number;
  readonly draftBasisPoints: number;
  readonly pending: boolean;
  readonly onDraftChange: (basisPoints: number) => void;
  readonly onApply: () => void;
}

function LiquidityAdjustment({
  appliedBasisPoints,
  draftBasisPoints,
  pending,
  onDraftChange,
  onApply,
}: LiquidityAdjustmentProps) {
  const changed = draftBasisPoints !== appliedBasisPoints;
  return (
    <section
      className="local-demo-liquidity-adjustment"
      aria-labelledby="local-demo-liquidity-adjustment-title"
      aria-busy={pending}
    >
      <div className="local-demo-liquidity-adjustment-heading">
        <div>
          <p className="eyebrow">Adjustable liquidity</p>
          <h4 id="local-demo-liquidity-adjustment-title">Fine-tune this preview</h4>
        </div>
        <output
          className="local-demo-liquidity-output"
          htmlFor="local-demo-liquidity-range"
          aria-live="polite"
        >
          Draft {percentage(draftBasisPoints)}
        </output>
      </div>
      <label htmlFor="local-demo-liquidity-range">
        Share kept liquid after estimated one-time fees
      </label>
      <input
        id="local-demo-liquidity-range"
        type="range"
        min={LOCAL_DEMO_MIN_LIQUID_RESERVE_BASIS_POINTS}
        max={LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS}
        step={LOCAL_DEMO_LIQUID_RESERVE_STEP_BASIS_POINTS}
        value={draftBasisPoints}
        aria-valuetext={`${percentage(draftBasisPoints)} kept liquid in the draft`}
        aria-describedby="local-demo-liquidity-state local-demo-liquidity-help"
        disabled={pending}
        onChange={(event) => onDraftChange(Number(event.currentTarget.value))}
      />
      <div className="local-demo-liquidity-adjustment-footer">
        <div>
          <p id="local-demo-liquidity-state">
            Current applied preview: <strong>{percentage(appliedBasisPoints)} liquid</strong>.
            Draft: <strong>{percentage(draftBasisPoints)} liquid</strong>
            {changed ? ' · not applied yet' : ' · matches current preview'}.
          </p>
          <p id="local-demo-liquidity-help">
            Updating recalculates this preview only. It moves no funds, and the selected share is
            applied after modeled one-time fees.
          </p>
        </div>
        <button
          className="portfolio-secondary-action local-demo-liquidity-apply"
          type="button"
          disabled={pending || !changed}
          onClick={onApply}
        >
          {pending ? 'Updating…' : 'Update preview'}
        </button>
      </div>
    </section>
  );
}

function FirstPositiveDay({ preview }: { preview: LocalDemoAllocationPreview }) {
  const result = preview.yieldProjection.firstPositiveDayAfterFees;
  if (result.status === 'NO_PROJECTED_YIELD') {
    return <span className="local-demo-allocation-projection-unavailable">No projected yield</span>;
  }
  if (result.status === 'NOT_RECOVERED_WITHIN_HORIZON') {
    return <span className="local-demo-allocation-projection-unavailable">Not within 1 year</span>;
  }
  return (
    <data
      value={String(result.day)}
      aria-label={`First positive whole-cent yield after estimated fees is day ${result.day}`}
    >
      <span aria-hidden="true">Day {result.day}</span>
    </data>
  );
}

function firstPositiveDayAnnouncement(preview: LocalDemoAllocationPreview): string {
  const result = preview.yieldProjection.firstPositiveDayAfterFees;
  if (result.status === 'RECOVERED_WITHIN_HORIZON') {
    return `first positive day after estimated fees is day ${result.day}`;
  }
  return result.status === 'NO_PROJECTED_YIELD'
    ? 'no positive yield is projected'
    : 'estimated fees are not recovered within one year';
}

function YieldProjection({ preview }: { preview: LocalDemoAllocationPreview }) {
  return (
    <section
      className="local-demo-allocation-yield-projection"
      aria-labelledby="local-demo-allocation-yield-title"
    >
      <div className="local-demo-allocation-yield-heading">
        <div>
          <p className="eyebrow">Post-fee projection</p>
          <h4 id="local-demo-allocation-yield-title">Illustrative yield result</h4>
        </div>
        <p>Local scenario · not a live quote</p>
      </div>
      <dl className="local-demo-allocation-yield-metrics">
        <div className="local-demo-allocation-yield-primary">
          <dt>Estimated blended APY (rounded down)</dt>
          <dd>
            <Apy basisPoints={preview.yieldProjection.effectiveApyBasisPoints} />
          </dd>
        </div>
        <div>
          <dt>Projected yield in 1 year before fees</dt>
          <dd>
            <Money amountUsdMinor={preview.yieldProjection.projectedAnnualYieldUsdMinor} />
          </dd>
        </div>
        <div>
          <dt>Estimated one-time fees</dt>
          <dd>
            <Money amountUsdMinor={preview.executionCost.modeledScenario.totalUsdMinor} />
          </dd>
        </div>
        <div>
          <dt>Projected yield after fees in 1 year</dt>
          <dd>
            <SignedMoney
              amountUsdMinor={preview.yieldProjection.projectedAnnualYieldAfterFeesUsdMinor}
            />
          </dd>
        </div>
        <div>
          <dt>First positive day after estimated fees</dt>
          <dd>
            <FirstPositiveDay preview={preview} />
          </dd>
        </div>
      </dl>
      <p className="local-demo-allocation-yield-method">
        The first positive day is the first whole day where projected cumulative yield reaches at
        least one cent more than the modeled one-time fees. The estimate uses exact internal rate
        math, no compounding, and a one-year horizon. Rates and actual costs may change.
      </p>
    </section>
  );
}

function AllocationPreview({
  preview,
  draftLiquidReserveBasisPoints,
  liquidityUpdatePending,
  onDraftLiquidityChange,
  onApplyLiquidity,
}: {
  preview: LocalDemoAllocationPreview;
  draftLiquidReserveBasisPoints: number;
  liquidityUpdatePending: boolean;
  onDraftLiquidityChange: (basisPoints: number) => void;
  onApplyLiquidity: () => void;
}) {
  return (
    <section
      className="local-demo-allocation-preview"
      aria-labelledby="local-demo-allocation-preview-title"
    >
      <div className="local-demo-allocation-warning" role="note">
        <span>Preview only</span>
        <p>
          <strong>No user-authorized financial transaction was created.</strong> This local model is
          not a public execution quote. Actual rates, fees, and route details may change before any
          future confirmation.
        </p>
      </div>
      {preview.rateSnapshot.freshness === 'STALE' ? (
        <p className="local-demo-yield-stale-warning" role="note">
          This managed rate set is stale and remains available only for local, non-executable
          testing.
        </p>
      ) : null}
      <div className="local-demo-allocation-preview-heading">
        <div>
          <p className="eyebrow">Selected yield plan</p>
          <h3 id="local-demo-allocation-preview-title">{preview.selection.label}</h3>
          <p>{preview.selection.description}</p>
          <small>Crypto Lending managed strategy · risk not assessed</small>
        </div>
        <p className="local-demo-allocation-as-of">
          Portfolio estimated <Timestamp value={preview.asOf} />
          <br />
          Rates captured <Timestamp value={preview.rateSnapshot.capturedAt} />
        </p>
      </div>

      <LiquidityAdjustment
        appliedBasisPoints={preview.selection.liquidReserveBasisPoints}
        draftBasisPoints={draftLiquidReserveBasisPoints}
        pending={liquidityUpdatePending}
        onDraftChange={onDraftLiquidityChange}
        onApply={onApplyLiquidity}
      />

      <YieldProjection preview={preview} />

      <EcosystemComposition preview={preview} />

      <div className="local-demo-allocation-results">
        <section aria-labelledby="local-demo-allocation-amounts-title">
          <h4 id="local-demo-allocation-amounts-title">Allocation amounts after estimated fees</h4>
          <ul className="local-demo-allocation-result-list">
            {preview.allocations.map((allocation) => (
              <li key={allocation.allocationId}>
                <span>
                  <strong>{allocation.label}</strong>
                  <small>{percentage(allocation.percentageBasisPoints)} target share</small>
                </span>
                <Money amountUsdMinor={allocation.amountUsdMinor} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="local-demo-allocation-fees-title">
          <h4 id="local-demo-allocation-fees-title">Estimated one-time fees</h4>
          <p className="local-demo-allocation-fee-disclosure">
            These amounts come from a deterministic local test model. They change with capital,
            conversion needs, allocation size, utilization, and routing complexity; they are not a
            live public quote.
          </p>
          <ul className="local-demo-allocation-result-list local-demo-allocation-fee-list">
            {preview.executionCost.modeledScenario.components.map((component) => (
              <li key={component.code}>
                <span>
                  <strong>{component.label}</strong>
                  <small>{feeBasisCopy(component.calculationBasis)}</small>
                </span>
                <Money amountUsdMinor={component.amountUsdMinor} />
              </li>
            ))}
            <li>
              <strong>Total estimated fees</strong>
              <Money amountUsdMinor={preview.executionCost.modeledScenario.totalUsdMinor} />
            </li>
          </ul>
          <p className="local-demo-allocation-fee-disclosure">
            Actual local operation: $0 because no transaction occurred. Public execution costs:
            unquoted.
          </p>
        </section>
      </div>

      <dl className="local-demo-allocation-reconciliation">
        <div>
          <dt>Full available capital</dt>
          <dd>
            <Money amountUsdMinor={preview.grossCapitalUsdMinor} />
          </dd>
        </div>
        <div>
          <dt>Estimated one-time fees deducted</dt>
          <dd>
            <Money amountUsdMinor={preview.executionCost.modeledScenario.totalUsdMinor} />
          </dd>
        </div>
        <div className="local-demo-allocation-net">
          <dt>Capital included in projection</dt>
          <dd>
            <Money amountUsdMinor={preview.capitalIncludedInProjectionUsdMinor} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

function previewMatchesCatalog(
  preview: LocalDemoAllocationPreview,
  catalog: LocalDemoYieldCatalog,
): boolean {
  return (
    preview.rateSnapshot.id === catalog.snapshot.id &&
    preview.rateSnapshot.capturedAt === catalog.snapshot.capturedAt &&
    preview.rateSnapshot.staleAfter === catalog.snapshot.staleAfter
  );
}

export function LocalDemoAllocationPlanner({
  client,
  portfolioSnapshotId,
  onUnauthenticated,
  onPortfolioSnapshotChanged,
}: LocalDemoAllocationPlannerProps) {
  const [catalog, setCatalog] = useState<LocalDemoYieldCatalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogLoadAttempt, setCatalogLoadAttempt] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<LocalDemoAllocationPreview | null>(null);
  const [draftLiquidReserveBasisPoints, setDraftLiquidReserveBasisPoints] = useState<number | null>(
    null,
  );
  const [liquidityUpdatePending, setLiquidityUpdatePending] = useState(false);
  const [previewState, setPreviewState] = useState<'IDLE' | 'ERROR' | 'PORTFOLIO_CHANGED'>('IDLE');
  const catalogRequest = useRef<AbortController | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    catalogRequest.current = controller;
    async function loadCatalog(): Promise<void> {
      try {
        const result = await client.readYieldCatalog(controller.signal);
        if (!controller.signal.aborted) {
          setCatalogError(false);
          setCatalog(result);
        }
      } catch (error) {
        if (isAbortFailure(error, controller.signal)) return;
        if (isLocalDemoUnauthenticated(error)) onUnauthenticated?.();
        else if (!controller.signal.aborted) setCatalogError(true);
      }
    }
    void loadCatalog();
    return () => {
      controller.abort();
      catalogRequest.current = null;
    };
  }, [catalogLoadAttempt, client, onUnauthenticated]);

  useEffect(() => {
    if (catalog === null || catalog.snapshot.freshness === 'STALE') return;
    const markStale = (): void => {
      setCatalog((current) =>
        current === null ||
        current.snapshot.id !== catalog.snapshot.id ||
        current.snapshot.freshness === 'STALE'
          ? current
          : Object.freeze({
              ...current,
              snapshot: Object.freeze({ ...current.snapshot, freshness: 'STALE' as const }),
            }),
      );
      setPreview((current) =>
        current === null ||
        current.rateSnapshot.id !== catalog.snapshot.id ||
        current.rateSnapshot.freshness === 'STALE'
          ? current
          : Object.freeze({
              ...current,
              rateSnapshot: Object.freeze({
                ...current.rateSnapshot,
                freshness: 'STALE' as const,
              }),
            }),
      );
    };
    const remainingMilliseconds = Date.parse(catalog.snapshot.staleAfter) - Date.now();
    if (remainingMilliseconds <= 0) {
      markStale();
      return;
    }
    const timer = globalThis.setTimeout(markStale, remainingMilliseconds + 1);
    return () => globalThis.clearTimeout(timer);
  }, [catalog]);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
      previewRequest.current?.abort();
      previewRequest.current = null;
    },
    [],
  );

  async function requestPreview(
    selection: LocalDemoAllocationSelectionInput,
    key: string,
    options: Readonly<{ preserveAppliedPreview?: boolean }> = {},
  ): Promise<void> {
    const preserveAppliedPreview = options.preserveAppliedPreview === true;
    requestGeneration.current += 1;
    previewRequest.current?.abort();
    const controller = new AbortController();
    const generation = requestGeneration.current;
    previewRequest.current = controller;
    setSelectedKey(key);
    setPendingKey(key);
    setLiquidityUpdatePending(preserveAppliedPreview);
    if (!preserveAppliedPreview) {
      setPreview(null);
      setDraftLiquidReserveBasisPoints(null);
    }
    setPreviewState('IDLE');
    try {
      const result = await client.previewAllocation(
        portfolioSnapshotId,
        selection,
        controller.signal,
      );
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      if (
        catalog === null ||
        result.portfolioSnapshotId !== portfolioSnapshotId ||
        result.selection.presetId !== selection.presetId ||
        result.selection.liquidReserveBasisPoints !== selection.liquidReserveBasisPoints ||
        !previewMatchesCatalog(result, catalog)
      ) {
        throw new LocalDemoApiError('INVALID_RESPONSE');
      }
      setCatalog((current) =>
        current === null
          ? current
          : Object.freeze({
              ...current,
              snapshot: Object.freeze({
                ...current.snapshot,
                freshness:
                  current.snapshot.freshness === 'STALE' ? 'STALE' : result.rateSnapshot.freshness,
              }),
            }),
      );
      setPreview(result);
      setDraftLiquidReserveBasisPoints(result.selection.liquidReserveBasisPoints);
    } catch (error) {
      if (isAbortFailure(error, controller.signal)) return;
      if (isLocalDemoUnauthenticated(error)) {
        onUnauthenticated?.();
        return;
      }
      if (error instanceof LocalDemoApiError && error.code === 'PORTFOLIO_SNAPSHOT_CHANGED') {
        if (generation === requestGeneration.current) {
          setSelectedKey(null);
          setPreview(null);
          setDraftLiquidReserveBasisPoints(null);
          setPreviewState('PORTFOLIO_CHANGED');
          onPortfolioSnapshotChanged?.();
        }
        return;
      }
      if (generation === requestGeneration.current) setPreviewState('ERROR');
    } finally {
      if (generation === requestGeneration.current) {
        previewRequest.current = null;
        setPendingKey(null);
        setLiquidityUpdatePending(false);
      }
    }
  }

  function applyDraftLiquidity(): void {
    if (
      preview === null ||
      draftLiquidReserveBasisPoints === null ||
      draftLiquidReserveBasisPoints === preview.selection.liquidReserveBasisPoints ||
      pendingKey !== null
    ) {
      return;
    }
    const key = `PRESET:${preview.selection.presetId}`;
    void requestPreview(
      {
        kind: 'PRESET',
        presetId: preview.selection.presetId,
        liquidReserveBasisPoints: draftLiquidReserveBasisPoints,
      },
      key,
      { preserveAppliedPreview: true },
    );
  }

  return (
    <section className="local-demo-allocation-panel" aria-labelledby="local-demo-allocation-title">
      <div className="local-demo-allocation-heading">
        <div>
          <p className="eyebrow">Allocation preview</p>
          <h2 id="local-demo-allocation-title">Choose how to allocate your capital.</h2>
        </div>
        <span className="local-demo-proof-badge">Local model · estimate only</span>
      </div>
      <p className="local-demo-allocation-intro">
        Compare Crypto Lending plans across connected EVM and Solana fixture balances. Ecosystem
        allocation, variable fee estimates, and the first positive day after estimated fees appear
        only after you select a plan.
      </p>

      {catalogError ? (
        <div className="local-demo-catalog-error" role="alert">
          <p className="local-demo-allocation-error">
            The managed rate set could not be validated. No yield estimate was accepted.
          </p>
          <button
            className="portfolio-secondary-action"
            type="button"
            onClick={() => {
              setCatalogError(false);
              setCatalogLoadAttempt((attempt) => attempt + 1);
            }}
          >
            Retry rates
          </button>
        </div>
      ) : catalog === null ? (
        <p className="local-demo-yield-loading" role="status">
          Loading managed rates…
        </p>
      ) : (
        <RateStatus catalog={catalog} />
      )}

      <div className="local-demo-allocation-choices" role="group" aria-label="Allocation plans">
        {LOCAL_DEMO_ALLOCATION_PRESETS.map((preset) => {
          const key = `PRESET:${preset.id}`;
          return (
            <button
              className={selectedKey === key ? 'is-selected' : undefined}
              key={preset.id}
              type="button"
              aria-pressed={selectedKey === key}
              disabled={pendingKey !== null || catalog === null}
              onClick={() =>
                void requestPreview(
                  {
                    kind: 'PRESET',
                    presetId: preset.id,
                    liquidReserveBasisPoints: preset.liquidReserveBasisPoints,
                  },
                  key,
                )
              }
            >
              <span className="local-demo-allocation-choice-title">
                <strong>{preset.label}</strong>
                <small>
                  {pendingKey === key
                    ? liquidityUpdatePending
                      ? 'Updating…'
                      : 'Calculating…'
                    : 'Preview plan'}
                </small>
              </span>
              <span className="local-demo-allocation-choice-description">{preset.description}</span>
              <span className="local-demo-allocation-choice-apy">
                <small>Liquid reserve</small>
                <strong>{percentage(preset.liquidReserveBasisPoints)}</strong>
              </span>
              <span className="local-demo-allocation-mix">
                <span>
                  <small>Managed yield</small>
                  <strong>{percentage(10_000 - preset.liquidReserveBasisPoints)}</strong>
                </span>
                <span>
                  <small>Fee estimate</small>
                  <strong>After selection</strong>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <span className="visually-hidden" role="status" aria-live="polite">
        {pendingKey !== null
          ? liquidityUpdatePending
            ? 'Updating the allocation preview. The current applied preview remains visible.'
            : 'Calculating allocation preview.'
          : preview === null
            ? ''
            : `${preview.selection.label} preview ready. Estimated fees are ${
                formatUsdMinor(preview.executionCost.modeledScenario.totalUsdMinor).visible
              }; ${preview.compositionSummary.activeEcosystemCount === 2 ? 'EVM and Solana managed allocations are included' : 'one managed ecosystem is included'}; ${firstPositiveDayAnnouncement(preview)}.`}
      </span>
      {previewState === 'PORTFOLIO_CHANGED' ? (
        <p className="local-demo-allocation-error" role="alert">
          Your connected-wallet portfolio changed before this preview completed. The portfolio is
          being refreshed; choose a plan again when it is ready.
        </p>
      ) : null}
      {previewState === 'ERROR' ? (
        <p className="local-demo-allocation-error" role="alert">
          {preview === null
            ? 'This allocation estimate could not be confirmed. No user-authorized financial transaction was created. Try again.'
            : 'The liquidity update could not be confirmed. The current applied preview has not changed, and no funds were moved. Try again.'}
        </p>
      ) : null}
      {preview === null ? null : (
        <AllocationPreview
          preview={preview}
          draftLiquidReserveBasisPoints={
            draftLiquidReserveBasisPoints ?? preview.selection.liquidReserveBasisPoints
          }
          liquidityUpdatePending={liquidityUpdatePending}
          onDraftLiquidityChange={(basisPoints) => {
            if (!liquidityUpdatePending) {
              setDraftLiquidReserveBasisPoints(basisPoints);
              setPreviewState('IDLE');
            }
          }}
          onApplyLiquidity={applyDraftLiquidity}
        />
      )}
    </section>
  );
}
