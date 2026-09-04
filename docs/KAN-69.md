# KAN-69: production portfolio reporting UI

Status: `AUTHENTICATED_DURABLE_API_SOURCE_CONNECTED` / `LIVE_INGESTION_BLOCKED`

The checked-in production `/portfolio` route now renders an authenticated,
reporting-only view of `GET /api/v1/portfolio`. It restores the managed session
before showing private data, redirects signed-out users to the fixed portfolio
return path, lets an authenticated user manage Ethereum and Solana wallet
ownership, and refreshes reporting after the wallet roster changes. This is a
source-level connection, not evidence that the route or identity service has
been deployed.

The route no longer imports or displays the local-demo portfolio, fixture, or
buying-power preview. Those older contracts remain isolated test/development
artifacts. Production deliberately displays no lending or transaction control:
durable balance and price ingestion is not active, and the API response is not
financial authority.

## Production browser boundary

`apps/web/lib/portfolio/reporting-portfolio.ts` is the closed browser parser for
the KAN-67 response. It accepts only Ethereum mainnet and Solana mainnet, the
exact USDC/USDT/PYUSD registry identities for those networks, the immutable
mainnet registry fingerprint, and the server's conservative-reporting control
fields. Base, Arbitrum, testnets, extra assets, changed registry data, accessors,
and malformed or unreconciled aggregates fail closed.

The parser also verifies:

- canonical UUIDs, timestamps, integer mantissas, decimal renderings, and fixed
  scale-18 USD amounts;
- bounded, unique source and coverage arrays made only of plain data fields;
- exact wallet/network/asset source attribution before private identifiers are
  discarded;
- source, wallet, chain, asset, and overall totals recomputed with `BigInt`;
- complete, partial, unavailable, current, and stale states without converting
  missing evidence to zero; and
- `CONSERVATIVE_REPORTING_ONLY`, `mayIncreaseBuyingPower: false`, and
  `mayAuthorizeFinancialUse: false` on every accepted response.

Accepted data is copied into a smaller frozen view model. The rendered view
does not retain wallet addresses, wallet IDs, account IDs, observation IDs,
provider references, endpoint details, or raw upstream errors.

## Session and request handling

`apps/web/lib/portfolio/portfolio-client.ts` performs one fixed same-origin,
credentialed, `no-store` GET with a bounded response and the closed parser. It
accepts only the expected success contract, the exact unauthenticated response,
or the exact bounded unavailable response. Provider-authored text and response
bodies are never logged or shown.

`ProductionPortfolio`:

- keeps portfolio content hidden until session restoration succeeds;
- cancels superseded and unmounted requests;
- revalidates browser back/forward-cache restores;
- clears private state and redirects when either the session check or a later
  wallet operation detects authentication loss;
- reloads after wallet registration or revocation; and
- renders separate loading, unavailable, invalid-response, empty, partial, and
  stale states with a bounded retry control.

The route remains `noindex, nofollow`. Responses and the API privacy interceptor
use private, no-store semantics and vary on authentication-relevant headers.

## Accessible presentation

The production view presents a supported reporting total, exact registered
wallet-network coverage, and totals by Ethereum/Solana network and stablecoin.
It uses integer-backed currency formatting, canonical `<time>` elements,
visible textual freshness and completeness labels, semantic headings and lists,
and notices that do not rely on color alone. Partial totals are labeled as known
subtotals; unavailable evidence is never rendered as `$0`.

Wallet ownership and balance reporting are reached through two simple jump
buttons after authentication. The shared header exposes Home, Platforms,
Portfolio, and Account only after the managed session is established; public
visitors receive only the configured sign-in/registration actions.

## Deliberately retained historical preview

`apps/web/lib/portfolio/unified-balance.ts` and `UnifiedBalanceView` preserve the
original BAL-004 fixture contract and buying-power presentation tests. They are
not imported by the production portfolio route. Their broader historical chain
catalog and deterministic Base fixture therefore cannot become production
coverage. The active production parser independently pins the two-network
Ethereum/Solana launch allowlist.

Buying power remains a separate KAN-68 concern. The current production screen
does not map a reporting total into buying power and does not expose an intent,
deposit, allocation, bridge, or withdrawal action.

## Remaining activation gates

The UI/API connection proves request, privacy, reconciliation, and presentation
behavior only. Useful current totals still require approved balance and price
writers, provider/RPC identities, independent evidence, durable consumers,
egress, monitoring, and deployed acceptance exercises. Lending recommendations
and real-value actions require their own reviewed policy, risk, consent,
simulation, wallet-authorization, reconciliation, legal, finance, security, and
operations gates.

The isolated balance-sync source/DLQ and publisher contract do not change that
status. No dedicated consumer task/service, receive/delete IAM permission, or
Ethereum/Solana RPC egress is active, so the queue cannot make portfolio data
live.

No fixture may be substituted when durable evidence is empty. Until those gates
close, the honest production outcome is a clearly labeled unavailable or
incomplete reporting state.

## Local verification

```text
npm test --workspace @crypto-lending/web -- reporting-portfolio-contract.test.ts portfolio-client.test.ts production-portfolio.test.tsx
npm test --workspace @crypto-lending/web
npm run lint --workspace @crypto-lending/web
npm run typecheck --workspace @crypto-lending/web
npm run build --workspace @crypto-lending/web
npm run format:check
npm run security:scan:secrets
```

These checks require no external provider, RPC, cloud service, wallet secret,
deployment, paid resource, or mainnet transaction. They confer no live-read or
write authority.
