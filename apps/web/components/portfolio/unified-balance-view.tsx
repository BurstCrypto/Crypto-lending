import type { ReactNode } from 'react';

import {
  addressEnding,
  formatUsdMinor,
  maskPortfolioAddress,
  PORTFOLIO_NETWORKS,
  type BuyingPowerDeduction,
  type BuyingPowerDeductionCode,
  type BuyingPowerReasonCode,
  type PortfolioFreshness,
  type UnifiedBalanceApiResponse,
  type UnifiedBalanceAssetContribution,
  type UnifiedBalanceChainContribution,
  type UnifiedBalanceWalletContribution,
  type WalletNamespace,
} from '@/lib/portfolio/unified-balance';

const AS_OF_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const DEDUCTION_LABELS: Readonly<Record<BuyingPowerDeductionCode, string>> = Object.freeze({
  STALE_OR_UNPRICED_BALANCE: 'Stale or unpriced balances',
  LIQUIDITY: 'Liquidity reserve',
  CONVERSION: 'Conversion costs',
  SLIPPAGE: 'Estimated slippage',
  NETWORK: 'Network costs',
  ROUTING: 'Routing costs',
});

const REASON_EXPLANATIONS: Readonly<Record<BuyingPowerReasonCode, string>> = Object.freeze({
  STALE_BALANCE_EXCLUDED:
    'Stale balances remain in portfolio value but are excluded from available buying power.',
  UNSUPPORTED_ASSET_EXCLUDED: 'Unsupported assets are excluded from available buying power.',
  PRICE_UNAVAILABLE:
    'A current supported price is unavailable, so buying power cannot be calculated safely.',
  ROUTE_COST_UNAVAILABLE:
    'Route-cost inputs are unavailable, so the app will not assume that moving funds is free.',
  LIQUIDITY_UNAVAILABLE:
    'Current liquidity evidence is unavailable, so buying power cannot be calculated safely.',
  BUYING_POWER_INPUT_STALE:
    'One or more buying-power inputs are stale. Review the source details before relying on this estimate.',
});

export type UnifiedBalanceViewState =
  | Readonly<{ status: 'LOADING' }>
  | Readonly<{ status: 'ERROR' }>
  | Readonly<{
      status: 'UNAVAILABLE';
      reason: 'NO_SUPPORTED_BALANCES' | 'INCOMPLETE_SNAPSHOT';
    }>
  | Readonly<{ status: 'READY'; snapshot: UnifiedBalanceApiResponse }>;

export interface UnifiedBalanceViewProps {
  readonly state: UnifiedBalanceViewState;
  readonly readyContent?: ReactNode;
}

function Money({ amountUsdMinor, className }: { amountUsdMinor: string; className?: string }) {
  const formatted = formatUsdMinor(amountUsdMinor);
  return (
    <data className={className} value={formatted.decimal} aria-label={formatted.accessible}>
      <span aria-hidden="true">{formatted.visible}</span>
    </data>
  );
}

function DeductionAmount({ deduction }: { deduction: BuyingPowerDeduction }) {
  if (deduction.amountUsdMinor === null) {
    return <span className="portfolio-cost-unavailable">Cost unavailable</span>;
  }
  const formatted = formatUsdMinor(deduction.amountUsdMinor);
  return (
    <data
      className="portfolio-deduction-value"
      value={`-${formatted.decimal}`}
      aria-label={`${formatted.accessible} deduction`}
    >
      <span aria-hidden="true">-{formatted.visible}</span>
    </data>
  );
}

function formatTokenAmount(amountAtomic: string, decimals: number): string {
  const amount = BigInt(amountAtomic);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/u, '');
  const groupedWhole = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(whole);
  return fraction.length === 0 ? groupedWhole : `${groupedWhole}.${fraction}`;
}

function MaskedAddress({ address, namespace }: { address: string; namespace: WalletNamespace }) {
  return (
    <span className="portfolio-masked-address">
      <code aria-hidden="true">{maskPortfolioAddress(address, namespace)}</code>
      <span className="visually-hidden">Address ending in {addressEnding(address, namespace)}</span>
    </span>
  );
}

function FreshnessBadge({ freshness }: { freshness: PortfolioFreshness }) {
  return (
    <span
      className={`portfolio-freshness portfolio-freshness-${freshness.toLowerCase()}`}
      aria-label={freshness === 'CURRENT' ? 'Current data' : 'Stale data'}
    >
      <span className="portfolio-freshness-dot" aria-hidden="true" />
      {freshness === 'CURRENT' ? 'Current' : 'Stale'}
    </span>
  );
}

function SourceBuyingPower({ amountUsdMinor }: { amountUsdMinor: string | null }) {
  return amountUsdMinor === null ? (
    <span className="portfolio-unavailable-value">Unavailable</span>
  ) : (
    <Money amountUsdMinor={amountUsdMinor} />
  );
}

function AssetSource({
  asset,
  namespace,
}: {
  asset: UnifiedBalanceAssetContribution;
  namespace: WalletNamespace;
}) {
  return (
    <li className="portfolio-asset-source">
      <div className="portfolio-asset-identity">
        <span className="portfolio-asset-symbol">{asset.stablecoin}</span>
        <MaskedAddress address={asset.assetIdentity} namespace={namespace} />
        <FreshnessBadge freshness={asset.freshness} />
      </div>
      <dl className="portfolio-source-values">
        <div>
          <dt>Token balance</dt>
          <dd>
            {formatTokenAmount(asset.amountAtomic, asset.decimals)} {asset.stablecoin}
          </dd>
        </div>
        <div>
          <dt>Portfolio value</dt>
          <dd>
            <Money amountUsdMinor={asset.portfolioValueUsdMinor} />
          </dd>
        </div>
        <div>
          <dt>Buying power contribution</dt>
          <dd>
            <SourceBuyingPower amountUsdMinor={asset.buyingPowerUsdMinor} />
          </dd>
        </div>
      </dl>
      <p className="portfolio-observed-at">
        Observed{' '}
        <time dateTime={asset.observedAt}>
          {AS_OF_FORMATTER.format(new Date(asset.observedAt))} UTC
        </time>
      </p>
      {asset.buyingPowerReason === null ? null : (
        <p className="portfolio-source-explanation">
          {REASON_EXPLANATIONS[asset.buyingPowerReason]}
        </p>
      )}
    </li>
  );
}

function ChainSource({
  chain,
  namespace,
}: {
  chain: UnifiedBalanceChainContribution;
  namespace: WalletNamespace;
}) {
  const network = PORTFOLIO_NETWORKS[chain.networkId];
  return (
    <li>
      <details className="portfolio-chain-source">
        <summary>
          <span className="portfolio-source-summary-name">
            <span>{network.name}</span>
            <span className="portfolio-source-count">
              {chain.assets.length} {chain.assets.length === 1 ? 'asset' : 'assets'}
            </span>
          </span>
          <span className="portfolio-source-summary-values">
            <span>
              <span className="visually-hidden">Portfolio value </span>
              <Money amountUsdMinor={chain.portfolioValueUsdMinor} />
            </span>
            <span className="portfolio-summary-secondary">
              Buying power <SourceBuyingPower amountUsdMinor={chain.buyingPowerUsdMinor} />
            </span>
          </span>
        </summary>
        <ul className="portfolio-asset-list">
          {chain.assets.map((asset) => (
            <AssetSource
              key={`${asset.stablecoin}:${asset.assetIdentity}`}
              asset={asset}
              namespace={namespace}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}

function WalletSource({ wallet }: { wallet: UnifiedBalanceWalletContribution }) {
  return (
    <li>
      <details className="portfolio-wallet-source">
        <summary>
          <span className="portfolio-source-summary-name">
            <span>{wallet.label}</span>
            <MaskedAddress address={wallet.address} namespace={wallet.namespace} />
          </span>
          <span className="portfolio-source-summary-values">
            <span>
              <span className="visually-hidden">Portfolio value </span>
              <Money amountUsdMinor={wallet.portfolioValueUsdMinor} />
            </span>
            <span className="portfolio-summary-secondary">
              Buying power <SourceBuyingPower amountUsdMinor={wallet.buyingPowerUsdMinor} />
            </span>
          </span>
        </summary>
        <ul className="portfolio-chain-list">
          {wallet.chains.map((chain) => (
            <ChainSource key={chain.networkId} chain={chain} namespace={wallet.namespace} />
          ))}
        </ul>
      </details>
    </li>
  );
}

function LoadingView() {
  return (
    <section className="portfolio-state-card" aria-labelledby="portfolio-loading-title">
      <div role="status" aria-live="polite" aria-busy="true">
        <div className="portfolio-loading-mark" aria-hidden="true" />
        <h1 id="portfolio-loading-title">Loading your portfolio</h1>
        <p>
          Waiting for a complete balance and buying-power snapshot. No missing value will be shown
          as zero.
        </p>
      </div>
    </section>
  );
}

function ErrorView() {
  return (
    <section
      className="portfolio-state-card portfolio-state-error"
      aria-labelledby="portfolio-error-title"
    >
      <div role="alert">
        <span className="portfolio-state-mark" aria-hidden="true">
          !
        </span>
        <h1 id="portfolio-error-title">Your portfolio could not be loaded</h1>
        <p>
          We could not verify a complete response. Your last confirmed balances are not replaced
          with zero; please try again in a moment.
        </p>
      </div>
    </section>
  );
}

function UnavailableView({ reason }: { reason: 'NO_SUPPORTED_BALANCES' | 'INCOMPLETE_SNAPSHOT' }) {
  return (
    <section
      className="portfolio-state-card portfolio-state-unavailable"
      aria-labelledby="portfolio-unavailable-title"
    >
      <div role="status" aria-live="polite">
        <span className="portfolio-state-mark" aria-hidden="true">
          i
        </span>
        <h1 id="portfolio-unavailable-title">Portfolio value is unavailable</h1>
        <p>
          {reason === 'NO_SUPPORTED_BALANCES'
            ? 'No supported, priced stablecoin balances are available for your connected wallets yet.'
            : 'Some wallet or pricing sources are incomplete, so the app cannot present a trustworthy total.'}
        </p>
      </div>
    </section>
  );
}

function BuyingPowerDeductions({
  deductions,
  unavailable,
}: {
  deductions: readonly BuyingPowerDeduction[];
  unavailable: boolean;
}) {
  if (deductions.length === 0) return null;
  return (
    <details className="portfolio-deductions" open>
      <summary>{unavailable ? 'Required cost inputs' : 'Why buying power is lower'}</summary>
      <ul>
        {deductions.map((deduction) => (
          <li key={deduction.code}>
            <span>{DEDUCTION_LABELS[deduction.code]}</span>
            <DeductionAmount deduction={deduction} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function ReadyView({
  snapshot,
  readyContent,
}: {
  snapshot: UnifiedBalanceApiResponse;
  readyContent?: ReactNode;
}) {
  const formattedAsOf = `${AS_OF_FORMATTER.format(new Date(snapshot.asOf))} UTC`;
  const showsFullLocalDemoCapital =
    snapshot.use === 'LOCAL_DEMO_ESTIMATE_ONLY' &&
    snapshot.mayAuthorizeFinancialAction === false &&
    snapshot.freshness === 'CURRENT' &&
    snapshot.buyingPower.status === 'AVAILABLE' &&
    snapshot.buyingPower.freshness === 'CURRENT' &&
    snapshot.buyingPower.amountUsdMinor === snapshot.portfolioValueUsdMinor;
  return (
    <section className="unified-balance" aria-labelledby="portfolio-title">
      <header className="portfolio-heading">
        <div>
          <p className="eyebrow">Unified balance</p>
          <h1 id="portfolio-title">Your capital, clearly attributed.</h1>
        </div>
        <div className="portfolio-as-of">
          <FreshnessBadge freshness={snapshot.freshness} />
          <p>
            As of <time dateTime={snapshot.asOf}>{formattedAsOf}</time>
          </p>
        </div>
      </header>

      {snapshot.freshness === 'STALE' ? (
        <div className="portfolio-notice portfolio-notice-stale" role="status" aria-live="polite">
          <span aria-hidden="true">!</span>
          <p>
            <strong>Some balance data is stale.</strong> Stale holdings remain visible in portfolio
            value but do not increase available buying power.
          </p>
        </div>
      ) : null}

      <div className="portfolio-totals">
        <article className="portfolio-total-card" aria-labelledby="portfolio-value-label">
          <p id="portfolio-value-label" className="portfolio-total-label">
            Total portfolio value
          </p>
          <Money
            className="portfolio-total-amount"
            amountUsdMinor={snapshot.portfolioValueUsdMinor}
          />
          <p className="portfolio-total-help">
            Supported holdings at their latest accepted portfolio valuation, including visibly
            flagged stale sources.
          </p>
        </article>

        <article
          className="portfolio-total-card portfolio-buying-power-card"
          aria-labelledby="buying-power-label"
        >
          <div className="portfolio-total-heading">
            <p id="buying-power-label" className="portfolio-total-label">
              Available buying power
            </p>
            {snapshot.buyingPower.status === 'AVAILABLE' ? (
              <FreshnessBadge freshness={snapshot.buyingPower.freshness} />
            ) : (
              <span className="portfolio-inputs-unavailable">Inputs unavailable</span>
            )}
          </div>
          {snapshot.buyingPower.status === 'AVAILABLE' &&
          snapshot.buyingPower.amountUsdMinor !== null ? (
            <Money
              className="portfolio-total-amount"
              amountUsdMinor={snapshot.buyingPower.amountUsdMinor}
            />
          ) : (
            <p className="portfolio-total-unavailable" role="status">
              Unavailable
            </p>
          )}
          <p className="portfolio-total-help">
            {snapshot.buyingPower.status === 'AVAILABLE'
              ? showsFullLocalDemoCapital
                ? 'Full supported capital available before any allocation choice. Execution-cost treatment appears only after you preview a blend.'
                : 'Conservative amount after stale funds and known liquidity, conversion, slippage, network, and routing deductions.'
              : 'No amount is shown until every required pricing, liquidity, network, and route-cost input is available.'}
          </p>
        </article>
      </div>

      {readyContent}

      {snapshot.buyingPower.reasons.length === 0 ? null : (
        <div className="portfolio-explanations" aria-labelledby="buying-power-explanations-title">
          <h2 id="buying-power-explanations-title">
            {snapshot.buyingPower.status === 'UNAVAILABLE'
              ? 'Why buying power is unavailable'
              : 'Buying-power notes'}
          </h2>
          <ul>
            {snapshot.buyingPower.reasons.map((reason) => (
              <li key={reason}>{REASON_EXPLANATIONS[reason]}</li>
            ))}
          </ul>
        </div>
      )}

      {showsFullLocalDemoCapital ? null : (
        <BuyingPowerDeductions
          deductions={snapshot.buyingPower.deductions}
          unavailable={snapshot.buyingPower.status === 'UNAVAILABLE'}
        />
      )}

      <section className="portfolio-sources" aria-labelledby="portfolio-sources-title">
        <div className="portfolio-section-heading">
          <div>
            <p className="eyebrow">Source attribution</p>
            <h2 id="portfolio-sources-title">Balance sources</h2>
          </div>
          <p>Expand a wallet, then a chain, to inspect every included asset.</p>
        </div>
        {snapshot.wallets.length === 0 ? (
          <p className="portfolio-empty-sources">No supported wallet contributions were found.</p>
        ) : (
          <ul className="portfolio-wallet-list">
            {snapshot.wallets.map((wallet) => (
              <WalletSource key={wallet.walletId} wallet={wallet} />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

export function UnifiedBalanceView({ state, readyContent }: UnifiedBalanceViewProps) {
  if (state.status === 'LOADING') return <LoadingView />;
  if (state.status === 'ERROR') return <ErrorView />;
  if (state.status === 'UNAVAILABLE') return <UnavailableView reason={state.reason} />;
  return <ReadyView snapshot={state.snapshot} readyContent={readyContent} />;
}
