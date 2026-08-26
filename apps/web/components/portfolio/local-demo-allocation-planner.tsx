'use client';

import { useEffect, useRef, useState } from 'react';

import { isAbortFailure } from '@/lib/authentication/http';
import {
  isLocalDemoUnauthenticated,
  LocalDemoApiError,
  type LocalDemoApiClient,
} from '@/lib/local-demo/local-demo-client';
import {
  compareLocalDemoDecimals,
  LOCAL_DEMO_ALLOCATION_PRESETS,
  type LocalDemoAllocationPreview,
  type LocalDemoAllocationSelectionInput,
  type LocalDemoYieldCatalog,
  type LocalDemoYieldOpportunity,
} from '@/lib/local-demo/local-demo-yield';
import { formatUsdMinor } from '@/lib/portfolio/unified-balance';

const AS_OF_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

type LocalDemoPresetSelection = Extract<LocalDemoAllocationSelectionInput, { kind: 'PRESET' }>;

export interface LocalDemoAllocationPlannerProps {
  readonly client: LocalDemoApiClient;
  readonly onUnauthenticated?: () => void;
}

function Money({ amountUsdMinor }: { amountUsdMinor: string }) {
  const formatted = formatUsdMinor(amountUsdMinor);
  return (
    <data value={formatted.decimal} aria-label={formatted.accessible}>
      <span aria-hidden="true">{formatted.visible}</span>
    </data>
  );
}

function percentage(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  return fraction === 0 ? `${whole}%` : `${whole}.${fraction.toString().padStart(2, '0')}%`;
}

function Apy({
  basisPoints,
  label = 'base annual percentage yield',
}: {
  basisPoints: number;
  label?: string;
}) {
  const decimal = `${Math.floor(basisPoints / 100)}.${(basisPoints % 100)
    .toString()
    .padStart(2, '0')}`;
  return (
    <data value={decimal} aria-label={`${decimal} percent ${label}`}>
      <span aria-hidden="true">{decimal}%</span>
    </data>
  );
}

function ratioPercent(value: string): string {
  const [whole = '', fraction = ''] = value.split('.');
  const scale = fraction.length;
  const numerator = BigInt(`${whole}${fraction}`) * 100n;
  if (scale === 0) return numerator.toString();
  const digits = numerator.toString().padStart(scale + 1, '0');
  const integer = digits.slice(0, -scale);
  const decimals = digits.slice(-scale).replace(/0+$/u, '');
  return decimals.length === 0 ? integer : `${integer}.${decimals}`;
}

function ObservedRate({ rateDecimal, label }: { rateDecimal: string; label: string }) {
  const value = ratioPercent(rateDecimal);
  return (
    <data value={value} aria-label={`${value} percent ${label}`}>
      <span aria-hidden="true">{value}%</span>
    </data>
  );
}

function Timestamp({ value, prefix }: { value: string; prefix?: string }) {
  return (
    <time dateTime={value}>
      {prefix}
      {AS_OF_FORMATTER.format(new Date(value))} UTC
    </time>
  );
}

function YieldStartValue({ preview }: { preview: LocalDemoAllocationPreview }) {
  const hasProjectedYield = BigInt(preview.yieldProjection.projectedAnnualYieldUsdMinor) > 0n;
  if (!hasProjectedYield) {
    return <span className="local-demo-allocation-projection-unavailable">Below $0.01/year</span>;
  }
  return (
    <data value="1" aria-label="Projection assumes base yield from day 1">
      <span aria-hidden="true">
        Day 1 <small>(projection assumption)</small>
      </span>
    </data>
  );
}

function OpportunityCard({ opportunity }: { opportunity: LocalDemoYieldOpportunity }) {
  const rewardBasisPoints = opportunity.apy.rewardAprs.reduce(
    (total, reward) => total + reward.basisPoints,
    0,
  );
  const collateral = opportunity.provenance.attributes.find(
    ({ key }) => key === 'market.collateral_symbol',
  )?.value;
  return (
    <article className="local-demo-yield-opportunity-card">
      <div className="local-demo-yield-opportunity-title">
        <div>
          <strong>{opportunity.asset.symbol}</strong>
          <span>{opportunity.network.name}</span>
        </div>
        <ObservedRate
          rateDecimal={opportunity.apy.baseRateDecimal}
          label="observed base annual percentage yield"
        />
      </div>
      <p>
        Morpho Blue <span aria-hidden="true">·</span> {collateral ?? 'market'}
      </p>
      <dl>
        <div>
          <dt>Base supply APY</dt>
          <dd>
            <ObservedRate
              rateDecimal={opportunity.apy.baseRateDecimal}
              label="observed base annual percentage yield"
            />
          </dd>
        </div>
        <div>
          <dt>Reward APR</dt>
          <dd>
            {rewardBasisPoints === 0 ? (
              'None observed'
            ) : (
              <ObservedRate
                rateDecimal={opportunity.apy.rewardAprs[0]!.rateDecimal}
                label="observed reward annual percentage rate"
              />
            )}
          </dd>
        </div>
        <div>
          <dt>Reported borrower fee (not deducted)</dt>
          <dd>
            <ObservedRate
              rateDecimal={opportunity.apy.providerFee.rateDecimal}
              label="reported provider borrow-interest fee rate"
            />
          </dd>
        </div>
        <div>
          <dt>TVL</dt>
          <dd>
            <Money amountUsdMinor={opportunity.tvl.amountUsdMinor} />
          </dd>
        </div>
        <div>
          <dt>Available-to-borrow proxy</dt>
          <dd>
            <Money amountUsdMinor={opportunity.exitLiquidity.amountUsdMinor} />
          </dd>
        </div>
        <div>
          <dt>Utilization</dt>
          <dd>
            <ObservedRate
              rateDecimal={opportunity.utilization.rateDecimal}
              label="observed utilization"
            />
          </dd>
        </div>
      </dl>
      <small>
        Provider observation: <Timestamp value={opportunity.apy.observedAt} />
      </small>
      <small>Provider listing observed · deposit and withdrawal status not verified.</small>
    </article>
  );
}

function CatalogPanel({ catalog }: { catalog: LocalDemoYieldCatalog }) {
  return (
    <section className="local-demo-yield-catalog" aria-labelledby="local-demo-yield-catalog-title">
      <div className="local-demo-yield-catalog-heading">
        <div>
          <p className="eyebrow">Point-in-time provider data</p>
          <h3 id="local-demo-yield-catalog-title">Observed Morpho markets</h3>
        </div>
        <span
          className={`local-demo-yield-freshness is-${catalog.snapshot.freshness.toLowerCase()}`}
        >
          {catalog.snapshot.freshness === 'CURRENT'
            ? 'Snapshot current'
            : 'Archived snapshot · stale'}
        </span>
      </div>
      <p className="local-demo-yield-catalog-copy">
        These base supply APYs were captured from the Morpho Public API and are served from a local,
        immutable snapshot. The app makes no live provider request. Rates can change, rewards remain
        separate, and risk has not been assessed. Provider listing was observed; deposit and
        withdrawal availability were not verified.
      </p>
      <p className="local-demo-yield-catalog-time">
        Snapshot captured <Timestamp value={catalog.snapshot.capturedAt} />. Data became stale after{' '}
        <Timestamp value={catalog.snapshot.staleAfter} />.
      </p>
      <div className="local-demo-yield-opportunity-grid">
        {catalog.opportunities.map((opportunity) => (
          <OpportunityCard key={opportunity.opportunityId} opportunity={opportunity} />
        ))}
      </div>
      <p className="local-demo-yield-proxy-note">
        Available-to-borrow amounts are shown only as an exit-liquidity proxy; they do not guarantee
        that a withdrawal can be completed.
      </p>
    </section>
  );
}

function YieldProjection({ preview }: { preview: LocalDemoAllocationPreview }) {
  return (
    <section
      className="local-demo-allocation-yield-projection"
      aria-labelledby="local-demo-allocation-yield-title"
    >
      <div className="local-demo-allocation-yield-heading">
        <div>
          <p className="eyebrow">Morpho base APY snapshot</p>
          <h4 id="local-demo-allocation-yield-title">Illustrative yield projection</h4>
        </div>
        <p>Local scenario · not a live quote</p>
      </div>
      <dl className="local-demo-allocation-yield-metrics">
        <div className="local-demo-allocation-yield-primary">
          <dt>Effective blended base APY (rounded down)</dt>
          <dd>
            <Apy basisPoints={preview.yieldProjection.effectiveApyBasisPoints} />
          </dd>
        </div>
        <div>
          <dt>Projected base yield in 1 year</dt>
          <dd>
            <Money amountUsdMinor={preview.yieldProjection.projectedAnnualYieldUsdMinor} />
          </dd>
        </div>
        <div>
          <dt>Projection assumes yield from</dt>
          <dd>
            <YieldStartValue preview={preview} />
          </dd>
        </div>
        <div>
          <dt>Public execution costs</dt>
          <dd className="local-demo-allocation-projection-unavailable">Not quoted</dd>
        </div>
      </dl>
      <p className="local-demo-allocation-yield-method">
        Sums each market position using its exact captured base supply APY. This straight-line
        one-year estimate excludes reward APR, compounding, rate changes, taxes, and public
        execution costs. The displayed blended APY and dollar estimate are rounded down to basis
        points and whole cents, respectively. Rates are point-in-time observations, not forecasts or
        promised returns.
      </p>
    </section>
  );
}

function AllocationPreview({ preview }: { preview: LocalDemoAllocationPreview }) {
  return (
    <section
      className="local-demo-allocation-preview"
      aria-labelledby="local-demo-allocation-preview-title"
    >
      <div className="local-demo-allocation-warning" role="note">
        <span>Preview only</span>
        <p>
          <strong>No user-authorized financial transaction was created.</strong> This estimate
          cannot authorize a transfer, investment, loan, or financial action. Provider rates are
          historical snapshot observations. This non-executing local simulation models no action
          cost; public execution costs have not been quoted.
        </p>
      </div>
      {preview.catalog.freshness === 'STALE' ? (
        <p className="local-demo-yield-stale-warning" role="note">
          This archived snapshot is stale. It remains visible for local, non-executable testing
          only.
        </p>
      ) : null}
      <div className="local-demo-allocation-preview-heading">
        <div>
          <p className="eyebrow">Selected yield plan</p>
          <h3 id="local-demo-allocation-preview-title">{preview.selection.label}</h3>
          <p>{preview.selection.description}</p>
          <small>
            {preview.catalog.selectedOpportunityCount} of {preview.catalog.matchedOpportunityCount}{' '}
            matching snapshot markets selected · risk not assessed
          </small>
        </div>
        <p className="local-demo-allocation-as-of">
          Portfolio estimated <Timestamp value={preview.asOf} />
          <br />
          Rates captured <Timestamp value={preview.catalog.capturedAt} />
        </p>
      </div>

      <YieldProjection preview={preview} />

      <div className="local-demo-allocation-results">
        <section aria-labelledby="local-demo-allocation-amounts-title">
          <h4 id="local-demo-allocation-amounts-title">Allocation amounts</h4>
          <ul className="local-demo-allocation-result-list">
            {preview.allocations.map((allocation) => (
              <li key={allocation.allocationId}>
                <span>
                  <strong>{allocation.label}</strong>
                  <small>
                    Target share: {percentage(allocation.percentageBasisPoints)} of gross capital
                    (rounded)
                  </small>
                  {allocation.opportunity === null ? null : (
                    <small>
                      {allocation.opportunity.asset.symbol} · {allocation.opportunity.network.name}{' '}
                      ·{' '}
                      {allocation.opportunity.apy.rewardAprs.length === 0
                        ? 'no reward APR observed'
                        : `${percentage(
                            allocation.opportunity.apy.rewardAprs.reduce(
                              (sum, reward) => sum + reward.basisPoints,
                              0,
                            ),
                          )} reward APR excluded`}
                    </small>
                  )}
                </span>
                <span className="local-demo-allocation-result-values">
                  <Apy basisPoints={allocation.baseApyBasisPoints} />
                  <Money amountUsdMinor={allocation.amountUsdMinor} />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="local-demo-allocation-fees-title">
          <h4 id="local-demo-allocation-fees-title">Execution cost treatment</h4>
          <p className="local-demo-allocation-fee-disclosure">
            The local preview creates no route or transaction, so its modeled execution cost is $0.
            Public network, routing, conversion, and slippage costs are not quoted or included.
          </p>
          <ul className="local-demo-allocation-result-list local-demo-allocation-fee-list">
            <li>
              <span>Modeled local execution cost</span>
              <Money amountUsdMinor={preview.executionCost.modeledLocalAmountUsdMinor} />
            </li>
          </ul>
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
          <dt>Modeled local execution cost</dt>
          <dd>
            <Money amountUsdMinor={preview.executionCost.modeledLocalAmountUsdMinor} />
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

function sameOpportunity(
  actual: LocalDemoYieldOpportunity,
  expected: LocalDemoYieldOpportunity,
): boolean {
  return (
    actual.opportunityId === expected.opportunityId &&
    actual.protocol.marketId === expected.protocol.marketId &&
    actual.asset.symbol === expected.asset.symbol &&
    actual.asset.contract === expected.asset.contract &&
    actual.asset.decimals === expected.asset.decimals &&
    actual.network.id === expected.network.id &&
    actual.network.name === expected.network.name &&
    actual.apy.baseRateDecimal === expected.apy.baseRateDecimal &&
    actual.apy.baseBasisPoints === expected.apy.baseBasisPoints &&
    actual.apy.observedAt === expected.apy.observedAt &&
    actual.apy.providerFee.rateDecimal === expected.apy.providerFee.rateDecimal &&
    actual.apy.providerFee.basisPoints === expected.apy.providerFee.basisPoints &&
    actual.apy.rewardAprs.length === expected.apy.rewardAprs.length &&
    actual.apy.rewardAprs.every(
      (reward, index) =>
        reward.assetSymbol === expected.apy.rewardAprs[index]?.assetSymbol &&
        reward.rateDecimal === expected.apy.rewardAprs[index]?.rateDecimal &&
        reward.basisPoints === expected.apy.rewardAprs[index]?.basisPoints,
    ) &&
    actual.tvl.sourceAmountUsdDecimal === expected.tvl.sourceAmountUsdDecimal &&
    actual.tvl.amountUsdMinor === expected.tvl.amountUsdMinor &&
    actual.tvl.observedAt === expected.tvl.observedAt &&
    actual.exitLiquidity.sourceAmountUsdDecimal === expected.exitLiquidity.sourceAmountUsdDecimal &&
    actual.exitLiquidity.amountUsdMinor === expected.exitLiquidity.amountUsdMinor &&
    actual.exitLiquidity.observedAt === expected.exitLiquidity.observedAt &&
    actual.utilization.rateDecimal === expected.utilization.rateDecimal &&
    actual.utilization.basisPoints === expected.utilization.basisPoints &&
    actual.utilization.observedAt === expected.utilization.observedAt &&
    actual.availability.asOf === expected.availability.asOf &&
    actual.provenance.sourceId === expected.provenance.sourceId &&
    actual.provenance.sourceObservedAt === expected.provenance.sourceObservedAt &&
    actual.provenance.retrievedAt === expected.provenance.retrievedAt &&
    actual.provenance.payloadSha256 === expected.provenance.payloadSha256 &&
    actual.provenance.attributes.length === expected.provenance.attributes.length &&
    actual.provenance.attributes.every(
      (attribute, index) =>
        attribute.key === expected.provenance.attributes[index]?.key &&
        attribute.value === expected.provenance.attributes[index]?.value,
    )
  );
}

function previewMatchesCatalog(
  preview: LocalDemoAllocationPreview,
  catalog: LocalDemoYieldCatalog,
): boolean {
  const matches = [...catalog.opportunities].sort((left, right) => {
    const apyOrder = compareLocalDemoDecimals(right.apy.baseRateDecimal, left.apy.baseRateDecimal);
    return apyOrder === 0 ? left.opportunityId.localeCompare(right.opportunityId) : apyOrder;
  });
  const selected = matches.slice(0, 3);
  const actual = preview.allocations.flatMap(({ opportunity }) =>
    opportunity === null ? [] : [opportunity],
  );
  return (
    preview.catalog.matchedOpportunityCount === matches.length &&
    preview.catalog.selectedOpportunityCount === selected.length &&
    actual.length === selected.length &&
    actual.every((opportunity, index) => {
      const expected = selected[index];
      return expected !== undefined && sameOpportunity(opportunity, expected);
    })
  );
}

export function LocalDemoAllocationPlanner({
  client,
  onUnauthenticated,
}: LocalDemoAllocationPlannerProps) {
  const [catalog, setCatalog] = useState<LocalDemoYieldCatalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogLoadAttempt, setCatalogLoadAttempt] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<LocalDemoAllocationPreview | null>(null);
  const [previewState, setPreviewState] = useState<'IDLE' | 'ERROR'>('IDLE');
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
        current.catalog.snapshotId !== catalog.snapshot.id ||
        current.catalog.freshness === 'STALE'
          ? current
          : Object.freeze({
              ...current,
              catalog: Object.freeze({ ...current.catalog, freshness: 'STALE' as const }),
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

  async function requestPreview(selection: LocalDemoPresetSelection, key: string): Promise<void> {
    requestGeneration.current += 1;
    previewRequest.current?.abort();
    const controller = new AbortController();
    const generation = requestGeneration.current;
    previewRequest.current = controller;
    setSelectedKey(key);
    setPendingKey(key);
    setPreview(null);
    setPreviewState('IDLE');
    try {
      const result = await client.previewAllocation(selection, controller.signal);
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      if (
        catalog === null ||
        result.catalog.snapshotId !== catalog.snapshot.id ||
        result.catalog.capturedAt !== catalog.snapshot.capturedAt ||
        result.catalog.staleAfter !== catalog.snapshot.staleAfter ||
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
                  current.snapshot.freshness === 'STALE' ? 'STALE' : result.catalog.freshness,
              }),
            }),
      );
      setPreview(result);
    } catch (error) {
      if (isAbortFailure(error, controller.signal)) return;
      if (isLocalDemoUnauthenticated(error)) {
        onUnauthenticated?.();
        return;
      }
      if (generation === requestGeneration.current) {
        setPreviewState('ERROR');
      }
    } finally {
      if (generation === requestGeneration.current) {
        previewRequest.current = null;
        setPendingKey(null);
      }
    }
  }

  return (
    <section className="local-demo-allocation-panel" aria-labelledby="local-demo-allocation-title">
      <div className="local-demo-allocation-heading">
        <div>
          <p className="eyebrow">Allocation preview</p>
          <h2 id="local-demo-allocation-title">Choose how to allocate your capital.</h2>
        </div>
        <span className="local-demo-proof-badge">Local snapshot · estimate only</span>
      </div>
      <p className="local-demo-allocation-intro">
        Compare real, timestamped provider observations without live egress. Allocation math,
        projected yield, and execution-cost treatment appear only after you select a preset.
      </p>

      {catalogError ? (
        <div className="local-demo-catalog-error" role="alert">
          <p className="local-demo-allocation-error">
            The local provider snapshot could not be validated. No yield values were accepted.
          </p>
          <button
            className="portfolio-secondary-action"
            type="button"
            onClick={() => {
              setCatalogError(false);
              setCatalogLoadAttempt((attempt) => attempt + 1);
            }}
          >
            Retry snapshot
          </button>
        </div>
      ) : catalog === null ? (
        <p className="local-demo-yield-loading" role="status">
          Loading the local provider snapshot…
        </p>
      ) : (
        <CatalogPanel catalog={catalog} />
      )}

      <div className="local-demo-allocation-choices" role="group" aria-label="Allocation presets">
        {LOCAL_DEMO_ALLOCATION_PRESETS.map((preset) => {
          const key = `PRESET:${preset.id}`;
          return (
            <button
              className={selectedKey === key ? 'is-selected' : undefined}
              key={preset.id}
              type="button"
              aria-pressed={selectedKey === key}
              disabled={pendingKey !== null || catalog === null}
              onClick={() => void requestPreview({ kind: 'PRESET', presetId: preset.id }, key)}
            >
              <span className="local-demo-allocation-choice-title">
                <strong>{preset.label}</strong>
                <small>{pendingKey === key ? 'Calculating…' : 'Preview snapshot blend'}</small>
              </span>
              <span className="local-demo-allocation-choice-description">{preset.description}</span>
              <span className="local-demo-allocation-choice-apy">
                <small>Liquid reserve</small>
                <strong>{percentage(preset.liquidReserveBasisPoints)}</strong>
              </span>
              <span className="local-demo-allocation-mix">
                <span>
                  <small>Yield allocation</small>
                  <strong>{percentage(10_000 - preset.liquidReserveBasisPoints)}</strong>
                </span>
                <span>
                  <small>Markets used</small>
                  <strong>Up to 3</strong>
                </span>
                <span>
                  <small>Selection</small>
                  <strong>Base APY, then ID</strong>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <span className="visually-hidden" role="status" aria-live="polite">
        {pendingKey !== null
          ? 'Calculating allocation preview.'
          : preview === null
            ? ''
            : `${preview.selection.label} preview ready with ${preview.catalog.selectedOpportunityCount} selected snapshot markets.`}
      </span>
      {previewState === 'ERROR' ? (
        <p className="local-demo-allocation-error" role="alert">
          This allocation estimate could not be confirmed. No user-authorized financial transaction
          was created. Try again.
        </p>
      ) : null}
      {preview === null ? null : <AllocationPreview preview={preview} />}
    </section>
  );
}
