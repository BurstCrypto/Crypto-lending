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
  LOCAL_DEMO_VISIBLE_ALLOCATION_PRESET_IDS,
  type LocalDemoAllocationPreview,
  type LocalDemoAllocationSelectionInput,
  type LocalDemoYieldCatalog,
} from '@/lib/local-demo/local-demo-yield';
import {
  EvmPublicTestnetApiClient,
  type EvmPublicTestnetPositionSnapshot,
} from '@/lib/evm-public-testnet';
import { readEvmPublicTestnetPositionAccount } from '@/lib/evm-public-testnet/position-account';
import { formatUsdMinor } from '@/lib/portfolio/unified-balance';
import { PublicTestnetApiClient } from '@/lib/public-testnet/public-testnet-client';
import type { PublicTestnetPositionSnapshot } from '@/lib/public-testnet/public-testnet-execution';
import { readPublicTestnetPositionAccount } from '@/lib/public-testnet/public-testnet-position-account';

import { PublicTestnetLendingDashboard } from './public-testnet-lending-dashboard';
import { createBrowserPublicTestnetWithdrawalAdapters } from './browser-public-testnet-withdrawal-adapters';
import {
  PublicTestnetWithdrawalCoordinator,
  type PublicTestnetWithdrawalAdapters,
} from './public-testnet-withdrawal-coordinator';
import { EvmPublicTestnetLendingDashboard } from './evm-public-testnet-lending-dashboard';
import {
  EvmPublicTestnetTransactionProof,
  type EvmPublicTestnetProofDependencies,
  type EvmPublicTestnetSubmissionController,
} from './evm-public-testnet-transaction-proof';
import {
  PublicTestnetTransactionProof,
  type PublicTestnetProofDependencies,
  type PublicTestnetSubmissionController,
} from './public-testnet-transaction-proof';

const AS_OF_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const DEFAULT_PUBLIC_TESTNET_API_FACTORY = () => new PublicTestnetApiClient();
const DEFAULT_EVM_PUBLIC_TESTNET_API_FACTORY = () => new EvmPublicTestnetApiClient();

export interface LocalDemoAllocationPlannerProps {
  readonly client: LocalDemoApiClient;
  readonly portfolioSnapshotId: string;
  readonly onUnauthenticated?: () => void;
  readonly onPortfolioSnapshotChanged?: () => void;
  readonly publicTestnetProofDependencies?: PublicTestnetProofDependencies;
  readonly evmPublicTestnetProofDependencies?: EvmPublicTestnetProofDependencies;
  readonly publicTestnetWithdrawalAdapters?: PublicTestnetWithdrawalAdapters;
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
          <h3 id="local-demo-yield-catalog-title">Crypto Lending managed blend</h3>
        </div>
        <span
          className={`local-demo-yield-freshness is-${catalog.snapshot.freshness.toLowerCase()}`}
        >
          {catalog.snapshot.freshness === 'CURRENT' ? 'Rates current' : 'Archived rates · stale'}
        </span>
      </div>
      <p className="local-demo-yield-catalog-copy">
        Preview the Crypto Lending managed blend below. Estimates combine supported EVM and Solana
        fixture balances with a locally cached, point-in-time managed rate set and make no live
        external request. Rates can change and risk has not been assessed.
      </p>
      <p className="local-demo-yield-catalog-copy">
        This is a portfolio-composition fixture. It does not create a route, bridge assets, contact
        a validator, or authorize a transaction.
      </p>
      <p className="local-demo-yield-catalog-time">
        Managed snapshot assembled <Timestamp value={catalog.snapshot.capturedAt} />. It becomes
        stale after <Timestamp value={catalog.snapshot.staleAfter} />.
      </p>
    </section>
  );
}

function feeBasisCopy(
  basis: LocalDemoAllocationPreview['executionCost']['modeledScenario']['components'][number]['calculationBasis'],
  routingFeeClassification: LocalDemoAllocationPreview['executionCost']['modeledScenario']['routingFeePolicy']['classification'],
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
    case 'CANONICAL_PLATFORM_ROUTING_RULE_V1':
      return routingFeeClassification === 'DIRECT_COMPATIBLE'
        ? 'Direct-compatible routing has a $0 platform fee.'
        : 'Free tier charges 0.20% of managed capital for material orchestration.';
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
          {preview.compositionSummary.activeEcosystemCount === 1 ? 'ecosystem' : 'ecosystems'}
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
  readonly locked: boolean;
  readonly onDraftChange: (basisPoints: number) => void;
  readonly onApply: () => void;
}

function LiquidityAdjustment({
  appliedBasisPoints,
  draftBasisPoints,
  pending,
  locked,
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
        Share of projected capital kept liquid after deducted costs
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
        disabled={pending || locked}
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
            applied after costs deducted from gross capital. Any added-on-top platform fee remains
            separate.
          </p>
        </div>
        <button
          className="portfolio-secondary-action local-demo-liquidity-apply"
          type="button"
          disabled={pending || locked || !changed}
          onClick={onApply}
        >
          {pending ? 'Updating…' : locked ? 'Locked during submission' : 'Update preview'}
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
        least one cent more than the modeled one-time fees. The public APY is conservatively rounded
        down to a 0.25 percentage-point bucket; the estimate uses that disclosed bucket, no
        compounding, and a one-year horizon. Rates and actual costs may change.
      </p>
    </section>
  );
}

function AllocationPreview({
  preview,
  draftLiquidReserveBasisPoints,
  liquidityUpdatePending,
  anyTestnetWriteActive,
  onDraftLiquidityChange,
  onApplyLiquidity,
  onUnauthenticated,
  publicTestnetProofDependencies,
  evmPublicTestnetProofDependencies,
  onSvmPublicTestnetWriteActivityChange,
  onEvmPublicTestnetWriteActivityChange,
  onCombinedPublicTestnetLaunchActivityChange,
  onPublicTestnetPositionAccountChange,
  onPublicTestnetPositionRefreshRequested,
  onEvmPublicTestnetPositionAccountChange,
  onEvmPublicTestnetPositionRefreshRequested,
}: {
  preview: LocalDemoAllocationPreview;
  draftLiquidReserveBasisPoints: number;
  liquidityUpdatePending: boolean;
  anyTestnetWriteActive: boolean;
  onDraftLiquidityChange: (basisPoints: number) => void;
  onApplyLiquidity: () => void;
  onUnauthenticated?: (() => void) | undefined;
  publicTestnetProofDependencies?: PublicTestnetProofDependencies | undefined;
  evmPublicTestnetProofDependencies?: EvmPublicTestnetProofDependencies | undefined;
  onSvmPublicTestnetWriteActivityChange: (active: boolean) => void;
  onEvmPublicTestnetWriteActivityChange: (active: boolean) => void;
  onCombinedPublicTestnetLaunchActivityChange: (active: boolean) => void;
  onPublicTestnetPositionAccountChange: (account: string) => void;
  onPublicTestnetPositionRefreshRequested: () => void;
  onEvmPublicTestnetPositionAccountChange: (account: string) => void;
  onEvmPublicTestnetPositionRefreshRequested: () => void;
}) {
  const evmSubmissionController = useRef<EvmPublicTestnetSubmissionController | null>(null);
  const svmSubmissionController = useRef<PublicTestnetSubmissionController | null>(null);
  const combinedSubmissionClaim = useRef(false);
  const [evmSubmitReady, setEvmSubmitReady] = useState(false);
  const [svmSubmitReady, setSvmSubmitReady] = useState(false);
  const [combinedSubmissionActive, setCombinedSubmissionActive] = useState(false);
  const combinedSubmitReady = evmSubmitReady && svmSubmitReady;

  function submitBothTestnetDeposits(): void {
    const evmController = evmSubmissionController.current;
    const svmController = svmSubmissionController.current;
    if (
      combinedSubmissionClaim.current ||
      combinedSubmissionActive ||
      anyTestnetWriteActive ||
      evmController === null ||
      svmController === null ||
      !evmController.canRequestSubmit() ||
      !svmController.canRequestSubmit()
    ) {
      return;
    }

    combinedSubmissionClaim.current = true;
    setCombinedSubmissionActive(true);
    onCombinedPublicTestnetLaunchActivityChange(true);

    // Launch both independent lanes in the same user event without awaiting
    // either wallet. Each controller synchronously claims its own lane before
    // reaching a provider or API await, preventing a second transaction send.
    const evmSubmission = evmController.requestSubmit();
    const svmSubmission = svmController.requestSubmit();

    if (evmSubmission === null || svmSubmission === null) {
      combinedSubmissionClaim.current = false;
      setCombinedSubmissionActive(false);
      onCombinedPublicTestnetLaunchActivityChange(false);
      return;
    }

    void Promise.allSettled([evmSubmission, svmSubmission]).finally(() => {
      combinedSubmissionClaim.current = false;
      setCombinedSubmissionActive(false);
      onCombinedPublicTestnetLaunchActivityChange(false);
    });
  }

  const combinedSubmissionStatus = combinedSubmissionActive
    ? 'Both transaction flows started. Complete the EVM and Phantom wallet approvals.'
    : combinedSubmitReady
      ? 'Both reviews are ready. One click starts two independent wallet approvals.'
      : evmSubmitReady
        ? 'EVM is ready. Finish and confirm the Solana review.'
        : svmSubmitReady
          ? 'Solana is ready. Finish and confirm the EVM review.'
          : 'Open both reviews, connect both wallets, and confirm both disclosures.';

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
          <p className="eyebrow">Selected managed blend</p>
          <h3 id="local-demo-allocation-preview-title">{preview.selection.label}</h3>
          <p>{preview.selection.description}</p>
          <small>Crypto Lending managed strategy · risk not assessed</small>
        </div>
        <p className="local-demo-allocation-as-of">
          Portfolio estimated <Timestamp value={preview.asOf} />
          <br />
          Managed snapshot assembled <Timestamp value={preview.rateSnapshot.capturedAt} />
        </p>
      </div>

      <LiquidityAdjustment
        appliedBasisPoints={preview.selection.liquidReserveBasisPoints}
        draftBasisPoints={draftLiquidReserveBasisPoints}
        pending={liquidityUpdatePending}
        locked={anyTestnetWriteActive}
        onDraftChange={onDraftLiquidityChange}
        onApply={onApplyLiquidity}
      />

      <YieldProjection preview={preview} />

      <EcosystemComposition preview={preview} />

      <div className="local-demo-allocation-results">
        <section aria-labelledby="local-demo-allocation-amounts-title">
          <h4 id="local-demo-allocation-amounts-title">Projected allocation amounts</h4>
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
                  <small>
                    {feeBasisCopy(
                      component.calculationBasis,
                      preview.executionCost.modeledScenario.routingFeePolicy.classification,
                    )}{' '}
                    {component.fundingTreatment === 'ADDED_ON_TOP'
                      ? 'Added on top of available capital.'
                      : 'Deducted from available capital.'}
                  </small>
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
            Platform fee policy: Free tier charges 0.20% when Crypto Lending materially orchestrates
            a route. A direct-compatible route has a $0 platform routing fee.
          </p>
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
          <dt>Estimated costs deducted from capital</dt>
          <dd>
            <Money
              amountUsdMinor={preview.executionCost.modeledScenario.deductedFromGrossUsdMinor}
            />
          </dd>
        </div>
        {preview.executionCost.modeledScenario.retainedRoundingResidualUsdMinor === '0' ? null : (
          <div>
            <dt>Retained rounding residual (not a fee)</dt>
            <dd>
              <Money
                amountUsdMinor={
                  preview.executionCost.modeledScenario.retainedRoundingResidualUsdMinor
                }
              />
            </dd>
          </div>
        )}
        <div>
          <dt>Capital included in projection</dt>
          <dd>
            <Money amountUsdMinor={preview.capitalIncludedInProjectionUsdMinor} />
          </dd>
        </div>
        <div>
          <dt>Platform fee added on top</dt>
          <dd>
            <Money amountUsdMinor={preview.executionCost.modeledScenario.addedOnTopUsdMinor} />
          </dd>
        </div>
        <div className="local-demo-allocation-net">
          <dt>Required capital including added-on-top fee</dt>
          <dd>
            <Money
              amountUsdMinor={
                preview.executionCost.modeledScenario.requiredCapitalIncludingAddedOnTopUsdMinor
              }
            />
          </dd>
        </div>
      </dl>
      {preview.executionCost.modeledScenario.retainedRoundingResidualUsdMinor === '0' ? null : (
        <p className="local-demo-allocation-fee-disclosure">
          The retained rounding residual remains outside this projection because cent-rounded
          modeled costs leave no feasible next cent. It is retained capital, not a fee or spend.
        </p>
      )}
      {!liquidityUpdatePending &&
      draftLiquidReserveBasisPoints === preview.selection.liquidReserveBasisPoints ? (
        <section
          className="public-testnet-proof-suite"
          aria-labelledby="public-testnet-proof-suite-title"
        >
          <div className="public-testnet-proof-suite-heading">
            <div>
              <p className="eyebrow">Coordinated live proofs</p>
              <h4 id="public-testnet-proof-suite-title">Submit EVM and Solana together</h4>
            </div>
            <span>One action · two wallet approvals</span>
          </div>
          <p>
            Prepare and confirm both reviews, then use the single action below. It starts two
            independent transactions and two wallet approvals; neither proof is an atomic
            cross-chain transaction.
          </p>
          <div className="public-testnet-proof-grid">
            <EvmPublicTestnetTransactionProof
              key={`evm:${preview.portfolioSnapshotId}:${preview.rateSnapshot.id}:${preview.selection.liquidReserveBasisPoints}`}
              ref={evmSubmissionController}
              preview={preview}
              onUnauthenticated={onUnauthenticated}
              onWriteActivityChange={onEvmPublicTestnetWriteActivityChange}
              onPositionAccountChange={onEvmPublicTestnetPositionAccountChange}
              onPositionRefreshRequested={onEvmPublicTestnetPositionRefreshRequested}
              onSubmitReadinessChange={setEvmSubmitReady}
              submissionMode="COMBINED"
              dependencies={evmPublicTestnetProofDependencies}
            />
            <PublicTestnetTransactionProof
              key={`svm:${preview.portfolioSnapshotId}:${preview.rateSnapshot.id}:${preview.selection.liquidReserveBasisPoints}`}
              ref={svmSubmissionController}
              preview={preview}
              onUnauthenticated={onUnauthenticated}
              onWriteActivityChange={onSvmPublicTestnetWriteActivityChange}
              onPositionAccountChange={onPublicTestnetPositionAccountChange}
              onPositionRefreshRequested={onPublicTestnetPositionRefreshRequested}
              onSubmitReadinessChange={setSvmSubmitReady}
              submissionMode="COMBINED"
              dependencies={publicTestnetProofDependencies}
            />
          </div>
          <div className="public-testnet-combined-submit">
            <button
              className="public-testnet-submit-action"
              type="button"
              disabled={!combinedSubmitReady || combinedSubmissionActive || anyTestnetWriteActive}
              onClick={submitBothTestnetDeposits}
            >
              {combinedSubmissionActive
                ? 'Complete both wallet approvals'
                : 'Submit both testnet deposits'}
            </button>
            <p role="status" aria-live="polite">
              {combinedSubmissionStatus}
            </p>
          </div>
        </section>
      ) : null}
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
  publicTestnetProofDependencies,
  evmPublicTestnetProofDependencies,
  publicTestnetWithdrawalAdapters,
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
  const [svmPublicTestnetWriteActive, setSvmPublicTestnetWriteActive] = useState(false);
  const [evmPublicTestnetWriteActive, setEvmPublicTestnetWriteActive] = useState(false);
  const [combinedPublicTestnetLaunchActive, setCombinedPublicTestnetLaunchActive] = useState(false);
  const [publicTestnetWithdrawalActive, setPublicTestnetWithdrawalActive] = useState(false);
  const [publicTestnetPositionAccount, setPublicTestnetPositionAccount] = useState<string | null>(
    null,
  );
  const [publicTestnetPositionRefreshKey, setPublicTestnetPositionRefreshKey] = useState(0);
  const [evmPublicTestnetPositionAccount, setEvmPublicTestnetPositionAccount] = useState<
    string | null
  >(null);
  const [evmPublicTestnetPositionRefreshKey, setEvmPublicTestnetPositionRefreshKey] = useState(0);
  const [publicTestnetPositionSnapshot, setPublicTestnetPositionSnapshot] =
    useState<PublicTestnetPositionSnapshot | null>(null);
  const [evmPublicTestnetPositionSnapshot, setEvmPublicTestnetPositionSnapshot] =
    useState<EvmPublicTestnetPositionSnapshot | null>(null);
  const [defaultPublicTestnetWithdrawalAdapters] = useState(() =>
    createBrowserPublicTestnetWithdrawalAdapters(),
  );
  const [previewState, setPreviewState] = useState<'IDLE' | 'ERROR' | 'PORTFOLIO_CHANGED'>('IDLE');
  const catalogRequest = useRef<AbortController | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const createPublicTestnetApi =
    publicTestnetProofDependencies?.createApi ?? DEFAULT_PUBLIC_TESTNET_API_FACTORY;
  const createEvmPublicTestnetApi =
    evmPublicTestnetProofDependencies?.createApi ?? DEFAULT_EVM_PUBLIC_TESTNET_API_FACTORY;
  const anyTestnetWriteActive =
    combinedPublicTestnetLaunchActive ||
    publicTestnetWithdrawalActive ||
    svmPublicTestnetWriteActive ||
    evmPublicTestnetWriteActive;

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      try {
        setPublicTestnetPositionAccount(readPublicTestnetPositionAccount());
      } catch {
        setPublicTestnetPositionAccount(null);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      try {
        setEvmPublicTestnetPositionAccount(readEvmPublicTestnetPositionAccount());
      } catch {
        setEvmPublicTestnetPositionAccount(null);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

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
    if (anyTestnetWriteActive) return;
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
      pendingKey !== null ||
      anyTestnetWriteActive
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
    <>
      <section
        className="public-testnet-dashboard-overview"
        aria-labelledby="public-testnet-dashboard-overview-title"
      >
        <div className="public-testnet-dashboard-overview-heading">
          <div>
            <p className="eyebrow">Live testnet positions</p>
            <h2 id="public-testnet-dashboard-overview-title">Your lending dashboards</h2>
          </div>
          <span>EVM + SVM · read-only</span>
        </div>
        <p>
          See both public-testnet positions immediately after connecting. Refreshing a dashboard
          never sends a transaction.
        </p>
        <div className="public-testnet-dashboard-grid">
          <EvmPublicTestnetLendingDashboard
            key={evmPublicTestnetPositionAccount ?? 'no-evm-position-account'}
            account={evmPublicTestnetPositionAccount}
            createApi={createEvmPublicTestnetApi}
            onUnauthenticated={onUnauthenticated}
            onSnapshotChange={setEvmPublicTestnetPositionSnapshot}
            refreshKey={evmPublicTestnetPositionRefreshKey}
          />
          <PublicTestnetLendingDashboard
            key={publicTestnetPositionAccount ?? 'no-position-account'}
            account={publicTestnetPositionAccount}
            createApi={createPublicTestnetApi}
            onUnauthenticated={onUnauthenticated}
            onSnapshotChange={setPublicTestnetPositionSnapshot}
            refreshKey={publicTestnetPositionRefreshKey}
          />
        </div>
        <PublicTestnetWithdrawalCoordinator
          adapters={publicTestnetWithdrawalAdapters ?? defaultPublicTestnetWithdrawalAdapters}
          evmPositionExpected={evmPublicTestnetPositionAccount !== null}
          evmSnapshot={evmPublicTestnetPositionSnapshot}
          svmPositionExpected={publicTestnetPositionAccount !== null}
          svmSnapshot={publicTestnetPositionSnapshot}
          onEvmPositionRefreshRequested={() =>
            setEvmPublicTestnetPositionRefreshKey((value) => value + 1)
          }
          onSvmPositionRefreshRequested={() =>
            setPublicTestnetPositionRefreshKey((value) => value + 1)
          }
          onWriteActivityChange={setPublicTestnetWithdrawalActive}
        />
      </section>
      <section
        className="local-demo-allocation-panel"
        aria-labelledby="local-demo-allocation-title"
      >
        <div className="local-demo-allocation-heading">
          <div>
            <p className="eyebrow">Allocation preview</p>
            <h2 id="local-demo-allocation-title">Preview your managed allocation.</h2>
          </div>
          <span className="local-demo-proof-badge">Local model · estimate only</span>
        </div>
        <p className="local-demo-allocation-intro">
          Preview a Crypto Lending managed blend across connected EVM and Solana fixture balances.
          It starts with no liquid reserve; after previewing, use the slider to add liquidity if
          needed. Ecosystem allocation, variable fee estimates, and the first positive day after
          estimated fees appear only after you select the blend.
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

        <div className="local-demo-allocation-choices" role="group" aria-label="Managed allocation">
          {LOCAL_DEMO_ALLOCATION_PRESETS.filter((preset) =>
            LOCAL_DEMO_VISIBLE_ALLOCATION_PRESET_IDS.some((presetId) => presetId === preset.id),
          ).map((preset) => {
            const key = `PRESET:${preset.id}`;
            return (
              <button
                className={selectedKey === key ? 'is-selected' : undefined}
                key={preset.id}
                type="button"
                aria-pressed={selectedKey === key}
                disabled={pendingKey !== null || catalog === null || anyTestnetWriteActive}
                onClick={() =>
                  void requestPreview(
                    {
                      kind: 'PRESET',
                      presetId: preset.id,
                      liquidReserveBasisPoints:
                        preview?.selection.liquidReserveBasisPoints ??
                        preset.liquidReserveBasisPoints,
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
                      : 'Preview blend'}
                  </small>
                </span>
                <span className="local-demo-allocation-choice-description">
                  {preset.description}
                </span>
                <span className="local-demo-allocation-choice-apy">
                  <small>Default liquid reserve</small>
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
            being refreshed; preview the managed blend again when it is ready.
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
            anyTestnetWriteActive={anyTestnetWriteActive}
            onDraftLiquidityChange={(basisPoints) => {
              if (!liquidityUpdatePending && !anyTestnetWriteActive) {
                setDraftLiquidReserveBasisPoints(basisPoints);
                setPreviewState('IDLE');
              }
            }}
            onApplyLiquidity={applyDraftLiquidity}
            onUnauthenticated={onUnauthenticated}
            publicTestnetProofDependencies={publicTestnetProofDependencies}
            evmPublicTestnetProofDependencies={evmPublicTestnetProofDependencies}
            onSvmPublicTestnetWriteActivityChange={setSvmPublicTestnetWriteActive}
            onEvmPublicTestnetWriteActivityChange={setEvmPublicTestnetWriteActive}
            onCombinedPublicTestnetLaunchActivityChange={setCombinedPublicTestnetLaunchActive}
            onPublicTestnetPositionAccountChange={setPublicTestnetPositionAccount}
            onPublicTestnetPositionRefreshRequested={() =>
              setPublicTestnetPositionRefreshKey((value) => value + 1)
            }
            onEvmPublicTestnetPositionAccountChange={setEvmPublicTestnetPositionAccount}
            onEvmPublicTestnetPositionRefreshRequested={() =>
              setEvmPublicTestnetPositionRefreshKey((value) => value + 1)
            }
          />
        )}
      </section>
    </>
  );
}
