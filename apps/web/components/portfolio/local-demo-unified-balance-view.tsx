import type { ReactNode } from 'react';

import {
  addressEnding,
  formatUsdMinor,
  maskPortfolioAddress,
  PORTFOLIO_NETWORKS,
  type BuyingPowerDeduction,
  type BuyingPowerDeductionCode,
  type PortfolioFreshness,
  type WalletNamespace,
} from '@/lib/portfolio/unified-balance';
import {
  LOCAL_DEMO_EVM_NETWORK_ID,
  type LocalDemoBalanceApiResponse,
  type LocalDemoBalanceChainContribution,
  type LocalDemoBalanceWalletContribution,
  type LocalDemoPortfolioNetworkId,
} from '@/lib/local-demo/local-demo-portfolio-response';

import { UnifiedBalanceView } from './unified-balance-view';

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

export type LocalDemoUnifiedBalanceViewState =
  | Readonly<{ status: 'LOADING' }>
  | Readonly<{ status: 'ERROR' }>
  | Readonly<{
      status: 'UNAVAILABLE';
      reason: 'NO_SUPPORTED_BALANCES' | 'INCOMPLETE_SNAPSHOT';
    }>
  | Readonly<{ status: 'READY'; snapshot: LocalDemoBalanceApiResponse }>;

interface LocalDemoUnifiedBalanceViewProps {
  readonly state: LocalDemoUnifiedBalanceViewState;
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

function MaskedAddress({ address, namespace }: { address: string; namespace: WalletNamespace }) {
  return (
    <span className="portfolio-masked-address">
      <code aria-hidden="true">{maskPortfolioAddress(address, namespace)}</code>
      <span className="visually-hidden">Address ending in {addressEnding(address, namespace)}</span>
    </span>
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

function localDemoNetworkName(networkId: LocalDemoPortfolioNetworkId): string {
  return networkId === LOCAL_DEMO_EVM_NETWORK_ID
    ? 'LOCAL EVM (chain 31337)'
    : PORTFOLIO_NETWORKS[networkId].name;
}

function AssetSource({
  asset,
  namespace,
}: {
  asset: LocalDemoBalanceChainContribution['assets'][number];
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
    </li>
  );
}

function ChainSource({
  chain,
  namespace,
}: {
  chain: LocalDemoBalanceChainContribution;
  namespace: WalletNamespace;
}) {
  return (
    <li>
      <details className="portfolio-chain-source">
        <summary>
          <span className="portfolio-source-summary-name">
            <span>{localDemoNetworkName(chain.networkId)}</span>
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

function WalletSource({ wallet }: { wallet: LocalDemoBalanceWalletContribution }) {
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

function BuyingPowerDeductions({ deductions }: { deductions: readonly BuyingPowerDeduction[] }) {
  if (deductions.length === 0) return null;
  return (
    <details className="portfolio-deductions" open>
      <summary>Why buying power is lower</summary>
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
  snapshot: LocalDemoBalanceApiResponse;
  readyContent?: ReactNode;
}) {
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
            As of{' '}
            <time dateTime={snapshot.asOf}>
              {AS_OF_FORMATTER.format(new Date(snapshot.asOf))} UTC
            </time>
          </p>
        </div>
      </header>

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
            Supported local-demo holdings at their latest accepted portfolio valuation.
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
            <FreshnessBadge freshness={snapshot.buyingPower.freshness} />
          </div>
          {snapshot.buyingPower.amountUsdMinor === null ? (
            <p className="portfolio-total-unavailable" role="status">
              Unavailable
            </p>
          ) : (
            <Money
              className="portfolio-total-amount"
              amountUsdMinor={snapshot.buyingPower.amountUsdMinor}
            />
          )}
          <p className="portfolio-total-help">
            Full supported capital available before any allocation choice. Estimated fees appear
            only after you preview a blend.
          </p>
        </article>
      </div>

      {readyContent}

      <section className="portfolio-sources" aria-labelledby="portfolio-sources-title">
        <div className="portfolio-section-heading">
          <div>
            <p className="eyebrow">Source attribution</p>
            <h2 id="portfolio-sources-title">Balance sources</h2>
          </div>
          <p>Expand a wallet, then a chain, to inspect every included asset.</p>
        </div>
        <ul className="portfolio-wallet-list">
          {snapshot.wallets.map((wallet) => (
            <WalletSource key={wallet.walletId} wallet={wallet} />
          ))}
        </ul>
      </section>
    </section>
  );
}

export function LocalDemoUnifiedBalanceView({
  state,
  readyContent,
}: LocalDemoUnifiedBalanceViewProps) {
  if (state.status !== 'READY') return <UnifiedBalanceView state={state} />;
  return <ReadyView snapshot={state.snapshot} readyContent={readyContent} />;
}
