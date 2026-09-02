import {
  reportingNetworkName,
  type ReportingAggregate,
  type ReportingBalanceCoverage,
  type ReportingExactUsdAmount,
  type ReportingFreshness,
  type ReportingPortfolioSnapshot,
} from '@/lib/portfolio/reporting-portfolio';

const AS_OF_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export type ProductionPortfolioViewState =
  | Readonly<{ status: 'LOADING' }>
  | Readonly<{ status: 'ERROR' }>
  | Readonly<{ status: 'UNAVAILABLE' }>
  | Readonly<{ status: 'READY'; snapshot: ReportingPortfolioSnapshot }>;

export interface ProductionPortfolioViewProps {
  readonly state: ProductionPortfolioViewState;
}

function formatExactUsd(amount: ReportingExactUsdAmount): {
  readonly accessible: string;
  readonly visible: string;
} {
  const [whole = '0', rawFraction = ''] = amount.decimal.split('.');
  const groupedWhole = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(BigInt(whole));
  const significantFraction = rawFraction.replace(/0+$/u, '');
  const visibleFraction =
    significantFraction.length === 0
      ? '00'
      : significantFraction.length === 1
        ? `${significantFraction}0`
        : significantFraction;
  const visible = `$${groupedWhole}.${visibleFraction}`;
  return {
    visible,
    accessible:
      visibleFraction === '00'
        ? `${groupedWhole} US ${whole === '1' ? 'dollar' : 'dollars'}`
        : `${groupedWhole}.${visibleFraction} US dollars`,
  };
}

function Money({ amount, className }: { amount: ReportingExactUsdAmount; className?: string }) {
  const formatted = formatExactUsd(amount);
  return (
    <data
      className={['portfolio-reporting-money', className].filter(Boolean).join(' ')}
      value={amount.decimal}
      aria-label={formatted.accessible}
    >
      <span aria-hidden="true">{formatted.visible}</span>
    </data>
  );
}

function AggregateValue({ aggregate }: { aggregate: ReportingAggregate }) {
  return aggregate.usdValue === null ? (
    <span className="portfolio-unavailable-value">Unavailable</span>
  ) : (
    <Money amount={aggregate.usdValue} />
  );
}

function FreshnessBadge({ freshness }: { freshness: ReportingFreshness }) {
  if (freshness === 'UNAVAILABLE') {
    return <span className="portfolio-inputs-unavailable">Unavailable</span>;
  }
  return (
    <span
      className={`portfolio-freshness portfolio-freshness-${freshness.toLowerCase()}`}
      aria-label={freshness === 'CURRENT' ? 'Current at snapshot time' : 'Stale data'}
    >
      <span className="portfolio-freshness-dot" aria-hidden="true" />
      {freshness === 'CURRENT' ? 'Current at snapshot' : 'Stale'}
    </span>
  );
}

function completenessLabel(aggregate: ReportingAggregate): string {
  if (aggregate.completeness === 'COMPLETE') return 'Complete';
  if (aggregate.completeness === 'PARTIAL') return 'Partial';
  return 'Unavailable';
}

function sourceCountLabel(aggregate: ReportingAggregate): string {
  return `${aggregate.includedSourceCount} of ${aggregate.sourceCount} ${
    aggregate.sourceCount === 1 ? 'source' : 'sources'
  } included`;
}

function walletCoverageLabel(coverage: ReportingBalanceCoverage): string {
  if (coverage.targetCount === 0) return 'No registered wallet networks were expected.';
  const incomplete = coverage.partialTargetCount + coverage.unavailableTargetCount;
  if (incomplete === 0) {
    return `All ${coverage.targetCount} registered wallet ${
      coverage.targetCount === 1 ? 'network has' : 'networks have'
    } complete balance coverage.`;
  }
  return `${incomplete} of ${coverage.targetCount} registered wallet ${
    coverage.targetCount === 1 ? 'network is' : 'networks are'
  } incomplete or unavailable. Missing balances are shown as unavailable, never $0.`;
}

function LoadingView() {
  return (
    <section
      id="balances"
      className="portfolio-state-card"
      aria-labelledby="portfolio-loading-title"
    >
      <div role="status" aria-live="polite" aria-busy="true">
        <div className="portfolio-loading-mark" aria-hidden="true" />
        <h2 id="portfolio-loading-title">Loading your portfolio</h2>
        <p>Waiting for a verified reporting snapshot. Missing values will not be shown as zero.</p>
      </div>
    </section>
  );
}

function ErrorView() {
  return (
    <section
      id="balances"
      className="portfolio-state-card portfolio-state-error"
      aria-labelledby="portfolio-error-title"
    >
      <div role="alert">
        <span className="portfolio-state-mark" aria-hidden="true">
          !
        </span>
        <h2 id="portfolio-error-title">Your portfolio could not be loaded</h2>
        <p>
          The response could not be verified, so no balance data is displayed. Please try again in a
          moment.
        </p>
      </div>
    </section>
  );
}

function UnavailableView() {
  return (
    <section
      id="balances"
      className="portfolio-state-card portfolio-state-unavailable"
      aria-labelledby="portfolio-unavailable-title"
    >
      <div role="status" aria-live="polite">
        <span className="portfolio-state-mark" aria-hidden="true">
          i
        </span>
        <h2 id="portfolio-unavailable-title">Portfolio reporting is unavailable</h2>
        <p>
          A verified balance or pricing source is not available right now, so no portfolio totals
          are shown.
        </p>
      </div>
    </section>
  );
}

function AggregateDetails({ aggregate }: { aggregate: ReportingAggregate }) {
  return (
    <dl className="portfolio-source-values">
      <div>
        <dt>Reporting total</dt>
        <dd>
          <AggregateValue aggregate={aggregate} />
        </dd>
      </div>
      <div>
        <dt>Coverage</dt>
        <dd>
          {completenessLabel(aggregate)}; {sourceCountLabel(aggregate)}
        </dd>
      </div>
    </dl>
  );
}

function ReadyView({ snapshot }: { snapshot: ReportingPortfolioSnapshot }) {
  const formattedAsOf = `${AS_OF_FORMATTER.format(new Date(snapshot.asOf))} UTC`;
  const overall = snapshot.overallTotal;
  const coverage = snapshot.balanceCoverage;
  return (
    <section id="balances" className="unified-balance" aria-labelledby="reporting-portfolio-title">
      <header className="portfolio-heading">
        <div>
          <p className="eyebrow">Portfolio reporting</p>
          <h2 id="reporting-portfolio-title">
            Your supported mainnet balances, clearly attributed.
          </h2>
        </div>
        <div className="portfolio-as-of">
          <FreshnessBadge freshness={overall.freshnessClass} />
          <p>
            As of <time dateTime={snapshot.asOf}>{formattedAsOf}</time>
          </p>
        </div>
      </header>

      <div className="portfolio-notice" role="note">
        <span aria-hidden="true">i</span>
        <p>
          <strong>Reporting only.</strong> These conservative totals cannot increase buying power or
          authorize a financial transaction.
        </p>
      </div>

      <div className="portfolio-totals">
        <article className="portfolio-total-card" aria-labelledby="reporting-total-label">
          <p id="reporting-total-label" className="portfolio-total-label">
            {overall.completeness === 'PARTIAL' && overall.usdValue !== null
              ? 'Known reported subtotal'
              : 'Supported reporting total'}
          </p>
          {overall.usdValue === null ? (
            <p className="portfolio-total-unavailable" role="status">
              Unavailable
            </p>
          ) : (
            <Money className="portfolio-total-amount" amount={overall.usdValue} />
          )}
          <p className="portfolio-total-help">
            {completenessLabel(overall)} coverage; {sourceCountLabel(overall)}
          </p>
        </article>

        <article className="portfolio-total-card" aria-labelledby="reporting-source-label">
          <p id="reporting-source-label" className="portfolio-total-label">
            Registered wallet coverage
          </p>
          <p className="portfolio-total-amount">
            {coverage.completeTargetCount}/{coverage.targetCount}
          </p>
          <p className="portfolio-total-help">{walletCoverageLabel(coverage)}</p>
          <p className="portfolio-total-help">
            {snapshot.excludedSourceCount === 0
              ? 'All observed sources use supported assets.'
              : `${snapshot.excludedSourceCount} unsupported ${
                  snapshot.excludedSourceCount === 1 ? 'source is' : 'sources are'
                } excluded from the reporting total.`}
          </p>
        </article>
      </div>

      <section className="portfolio-sources" aria-labelledby="reporting-sources-title">
        <div className="portfolio-section-heading">
          <div>
            <p className="eyebrow">Source attribution</p>
            <h2 id="reporting-sources-title">Totals by network and asset</h2>
          </div>
          <p>
            Aggregates omit wallet identifiers, account addresses, and pricing-provider references.
          </p>
        </div>

        <div className="portfolio-totals">
          <article className="portfolio-total-card" aria-labelledby="reporting-networks-title">
            <h3 id="reporting-networks-title">Networks</h3>
            {snapshot.chainTotals.length === 0 ? (
              <p className="portfolio-empty-sources">No network sources were reported.</p>
            ) : (
              <ul className="portfolio-asset-list">
                {snapshot.chainTotals.map((chain) => (
                  <li className="portfolio-asset-source" key={chain.networkId}>
                    <div className="portfolio-asset-identity">
                      <span className="portfolio-asset-symbol">
                        {reportingNetworkName(chain.networkId)}
                      </span>
                      <FreshnessBadge freshness={chain.freshnessClass} />
                    </div>
                    <AggregateDetails aggregate={chain} />
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="portfolio-total-card" aria-labelledby="reporting-assets-title">
            <h3 id="reporting-assets-title">Supported assets</h3>
            {snapshot.assetTotals.length === 0 ? (
              <p className="portfolio-empty-sources">No supported asset sources were reported.</p>
            ) : (
              <ul className="portfolio-asset-list">
                {snapshot.assetTotals.map((asset) => (
                  <li className="portfolio-asset-source" key={asset.stablecoin}>
                    <div className="portfolio-asset-identity">
                      <span className="portfolio-asset-symbol">{asset.stablecoin}</span>
                      <FreshnessBadge freshness={asset.freshnessClass} />
                    </div>
                    <AggregateDetails aggregate={asset} />
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>
    </section>
  );
}

export function ProductionPortfolioView({ state }: ProductionPortfolioViewProps) {
  if (state.status === 'LOADING') return <LoadingView />;
  if (state.status === 'ERROR') return <ErrorView />;
  if (state.status === 'UNAVAILABLE') return <UnavailableView />;
  return <ReadyView snapshot={state.snapshot} />;
}
