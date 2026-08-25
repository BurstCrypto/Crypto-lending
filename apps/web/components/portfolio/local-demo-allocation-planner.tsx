'use client';

import { useEffect, useRef, useState } from 'react';

import { isAbortFailure } from '@/lib/authentication/http';
import {
  isLocalDemoUnauthenticated,
  LOCAL_DEMO_ALLOCATION_PRESETS,
  type LocalDemoAllocationDeductionCode,
  type LocalDemoAllocationPresetId,
  type LocalDemoAllocationPreview,
  type LocalDemoApiClient,
} from '@/lib/local-demo/local-demo-client';
import { formatUsdMinor } from '@/lib/portfolio/unified-balance';

const AS_OF_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const BUCKET_LABELS = Object.freeze({
  LIQUID_RESERVE: 'Liquid reserve',
  CONSERVATIVE_YIELD: 'Conservative yield',
  BALANCED_YIELD: 'Balanced yield',
});

const DEDUCTION_LABELS: Readonly<Record<LocalDemoAllocationDeductionCode, string>> = Object.freeze({
  LIQUIDITY: 'Liquidity reserve',
  CONVERSION: 'Conversion costs',
  SLIPPAGE: 'Estimated slippage',
  NETWORK: 'Network costs',
  ROUTING: 'Routing costs',
});

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

function DeductionMoney({ amountUsdMinor }: { amountUsdMinor: string }) {
  const formatted = formatUsdMinor(amountUsdMinor);
  return (
    <data value={`-${formatted.decimal}`} aria-label={`${formatted.accessible} estimated fee`}>
      <span aria-hidden="true">-{formatted.visible}</span>
    </data>
  );
}

function percentage(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  return fraction === 0 ? `${whole}%` : `${whole}.${fraction.toString().padStart(2, '0')}%`;
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
          <strong>No transaction was created.</strong> This estimate cannot authorize a transfer,
          investment, loan, or any other financial action.
        </p>
      </div>

      <div className="local-demo-allocation-preview-heading">
        <div>
          <p className="eyebrow">Selected blend</p>
          <h3 id="local-demo-allocation-preview-title">{preview.preset.label}</h3>
          <p>{preview.preset.description}</p>
        </div>
        <p className="local-demo-allocation-as-of">
          Estimated{' '}
          <time dateTime={preview.asOf}>{AS_OF_FORMATTER.format(new Date(preview.asOf))} UTC</time>
        </p>
      </div>

      <div className="local-demo-allocation-results">
        <section aria-labelledby="local-demo-allocation-amounts-title">
          <h4 id="local-demo-allocation-amounts-title">Allocation amounts</h4>
          <ul className="local-demo-allocation-result-list">
            {preview.allocations.map((allocation) => (
              <li key={allocation.bucket}>
                <span>
                  <strong>{allocation.label}</strong>
                  <small>{percentage(allocation.percentageBasisPoints)} of gross capital</small>
                </span>
                <Money amountUsdMinor={allocation.amountUsdMinor} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="local-demo-allocation-fees-title">
          <h4 id="local-demo-allocation-fees-title">Estimated fees for this blend</h4>
          <ul className="local-demo-allocation-result-list local-demo-allocation-fee-list">
            {preview.deductions.map((deduction) => (
              <li key={deduction.code}>
                <span>{DEDUCTION_LABELS[deduction.code]}</span>
                <DeductionMoney amountUsdMinor={deduction.amountUsdMinor} />
              </li>
            ))}
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
          <dt>Estimated fees if this blend were used</dt>
          <dd>
            <DeductionMoney amountUsdMinor={preview.totalFeesUsdMinor} />
          </dd>
        </div>
        <div className="local-demo-allocation-net">
          <dt>Net planned capital</dt>
          <dd>
            <Money amountUsdMinor={preview.netPlannedCapitalUsdMinor} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function LocalDemoAllocationPlanner({
  client,
  onUnauthenticated,
}: LocalDemoAllocationPlannerProps) {
  const [selectedPreset, setSelectedPreset] = useState<LocalDemoAllocationPresetId | null>(null);
  const [pendingPreset, setPendingPreset] = useState<LocalDemoAllocationPresetId | null>(null);
  const [preview, setPreview] = useState<LocalDemoAllocationPreview | null>(null);
  const [error, setError] = useState(false);
  const requestReference = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
      requestReference.current?.abort();
      requestReference.current = null;
    },
    [],
  );

  async function selectPreset(presetId: LocalDemoAllocationPresetId): Promise<void> {
    requestGeneration.current += 1;
    requestReference.current?.abort();
    const controller = new AbortController();
    const generation = requestGeneration.current;
    requestReference.current = controller;
    setSelectedPreset(presetId);
    setPendingPreset(presetId);
    setPreview(null);
    setError(false);
    try {
      const result = await client.previewAllocation(presetId, controller.signal);
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      setPreview(result);
    } catch (caught) {
      if (isAbortFailure(caught, controller.signal)) return;
      if (isLocalDemoUnauthenticated(caught)) {
        onUnauthenticated?.();
        return;
      }
      if (generation === requestGeneration.current) setError(true);
    } finally {
      if (generation === requestGeneration.current) {
        requestReference.current = null;
        setPendingPreset(null);
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
        <span className="local-demo-proof-badge">Estimate only</span>
      </div>
      <p className="local-demo-allocation-intro">
        Your full available capital remains unchanged. Select a blend to see its exact synthetic
        allocation and estimated fees before deciding what to do.
      </p>

      <div className="local-demo-allocation-choices" role="group" aria-label="Allocation blends">
        {LOCAL_DEMO_ALLOCATION_PRESETS.map((preset) => (
          <button
            className={selectedPreset === preset.id ? 'is-selected' : undefined}
            key={preset.id}
            type="button"
            aria-pressed={selectedPreset === preset.id}
            disabled={pendingPreset !== null}
            onClick={() => void selectPreset(preset.id)}
          >
            <span className="local-demo-allocation-choice-title">
              <strong>{preset.label}</strong>
              <small>
                {pendingPreset === preset.id ? 'Calculating preview...' : 'Preview blend'}
              </small>
            </span>
            <span className="local-demo-allocation-choice-description">{preset.description}</span>
            <span className="local-demo-allocation-mix" aria-label={`${preset.label} allocation`}>
              {Object.entries(preset.percentages).map(([bucket, basisPoints]) => (
                <span key={bucket}>
                  <small>{BUCKET_LABELS[bucket as keyof typeof BUCKET_LABELS]}</small>
                  <strong>{percentage(basisPoints)}</strong>
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>

      <span className="visually-hidden" role="status" aria-live="polite">
        {pendingPreset === null ? '' : 'Calculating allocation preview.'}
      </span>
      {error ? (
        <p className="local-demo-allocation-error" role="alert">
          This allocation estimate could not be confirmed. No transaction was created. Select a
          blend to try again.
        </p>
      ) : null}
      {preview === null ? null : <AllocationPreview preview={preview} />}
    </section>
  );
}
