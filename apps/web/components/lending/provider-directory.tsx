import Link from 'next/link';
import { ETHEREUM, LENDING_PROVIDERS, MARKETS } from '@/lib/lending/markets';

export function LendingProviderDirectory() {
  return <section className="platform-directory" aria-label="Mainnet lending markets">
    <div className="platform-directory__summary"><strong>{LENDING_PROVIDERS.length} lending providers</strong><span>USDC · Ethereum and Solana</span></div>
    <div className="platform-grid">
      {LENDING_PROVIDERS.map((id) => {
        const market = MARKETS[id], chain = market.network === ETHEREUM ? 'Ethereum' : 'Solana';
        return <article className="platform-card" key={id}>
          <div className="platform-card__heading"><div><p className="platform-ecosystem">{chain}</p><h3>{market.name}</h3></div><span className="platform-status">USDC</span></div>
          <p>{market.market}</p>
          <p>Smart lending checks current supply rates, available capacity, and transaction costs before recommending a route.</p>
          <Link className="navigation-button" href={`/portfolio#lend-${id}`}>View {market.name}</Link>
        </article>;
      })}
    </div>
  </section>;
}
