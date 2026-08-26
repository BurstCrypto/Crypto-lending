# Deterministic local-demo portfolio pipeline

`LocalDemoPortfolioService` is the API-side composition boundary for the local demo. It is
deliberately available only through the local-demo module/configuration gate. The service does not
provide a production fallback.

## Data path

1. Read the account-scoped, ownership-proven projections from `LocalDemoWalletService`.
2. Retain each proven address. Map EVM to the explicit keyless LOCAL identity `eip155:31337`; keep
   Solana on its deterministic mainnet-shaped fixture identity.
3. Invoke the real KAN-63 EVM indexer against the fixed loopback Hardhat chain and KAN-64 Solana
   indexer against its request-local fixture source. Only the funded USDC position crosses either
   adapter boundary.
4. Pass each result through a real KAN-65 `BalanceSyncOrchestrator` backed by request-local jobs,
   metrics, and checkpoints.
5. Project the current observations into the KAN-67 snapshot contract, use KAN-66 with two fixed,
   accepted $1 price observations, and aggregate with `buildUnifiedPortfolio`.
6. Invoke the real KAN-68 `BuyingPowerCalculator`. Its idle-view adjustment explicitly reports
   zero route costs, so supported, current, priced capital remains available in full while the
   calculator continues to exclude stale, unsupported, unpriced, or blocked contributions. The
   idle web response omits allocation cost treatment entirely; the zero-cost local-simulation
   treatment appears only in a requested allocation preview. Public execution costs are not quoted.
7. Floor scale-18 USD mantissas to integer cents and return the exact KAN-69 web response shape.

With one connected wallet in each namespace, the stable fixtures contain $7,000 EVM USDC and
$4,000 Solana USDC. The resulting portfolio and idle buying power are both $11,000. A single
connected namespace receives only its proportional fixture total.

`GET /api/v1/local-demo/yield-catalog` exposes only sanitized status for an immutable checked-in
managed-rate snapshot: a product-owned identifier, capture and stale timestamps, freshness,
non-executable use, and the fact that risk is not assessed. Provider identity, protocol identity,
market identifiers, exact observations, provenance, and endpoints remain server-confidential. The
runtime performs no live provider request; after the 24-hour capture boundary it labels the status
stale and keeps it non-executable.

`POST /api/v1/local-demo/allocation-preview` accepts only one of the three closed preset IDs. The
caller cannot send custom filters, capital, managed rates, fee inputs, provider or protocol details,
market identifiers, or provenance. The server derives capital from the authenticated account and
performs confidential source selection and exact-decimal projection internally. The public response
contains only aggregate `LIQUID_RESERVE` and `MANAGED_YIELD` buckets. Their basis-point percentages
are preset target labels; their integer-cent amounts are authoritative. If the confidential strategy
is unavailable, the API returns a sanitized typed 422 without fallback or internal source details.

The preview creates no route or transaction, so the actual local operation is exactly zero and
public execution remains explicitly unquoted. A separate, non-quote scenario models variable
network, conversion, market-impact, and routing components from server-owned inputs, rounds each
component up to a cent, and deducts their total from gross capital before allocation and projection.
The two aggregate buckets reconcile exactly to the post-model-cost capital.

The server projects the confidential positions from exact managed base-rate decimals and returns
only an aggregate basis-point rate and whole-cent annual yield. Annual yield after modeled fees can
be negative. The first-positive-day field is the first whole day when straight-line projected yield
exceeds modeled fees by at least one cent, limited to a 365-day horizon; it distinguishes no yield
from not recovering within that horizon. The catalog and preview create no user-authorized financial
operation, live provider request, public-chain transaction, or persistence record and do not make a
promise, recommendation, or financial authorization. Portfolio fixture maintenance may still
create zero-gas transactions on the owned loopback EVM after a reset.

## Trust and I/O boundaries

- The EVM reader is an injected port restricted to `http://127.0.0.1:18545`; it verifies the LOCAL
  chain ID, exact contract bytecode, pinned block identity, and `balanceOf` result. It cannot target
  a public provider. Solana, retry scheduling, checkpoints, jobs, metrics, price evidence, clocks,
  and adjustment quotes remain request-local deterministic objects.
- Each EVM wallet is initialized once for an authenticated local-child instance. Later local-chain
  mutations remain visible to synchronization; a new instance identity invalidates the cache and
  reinitializes the deterministic balance even if its height equals or exceeds the prior child.
- Account, correlation, wallet, cluster, address, timestamp, label, registry identity, valuation,
  sync freshness, and aggregate invariants fail closed to `LocalDemoPortfolioUnavailableError`.
- Empty wallet catalogs fail with the same typed unavailable error; they never fabricate an owner.
- The response carries `use: LOCAL_DEMO_ESTIMATE_ONLY` and
  `mayAuthorizeFinancialAction: false`. An isolated local-demo web adapter accepts exactly the
  LOCAL EVM/mock-USDC tuple, validates the remaining accounting and freshness invariants through
  the unchanged shared KAN-69 parser, and renders the LOCAL attribution without widening shared
  production network or asset allowlists.

## Honest integration gate

This pipeline proves deterministic local composition and real local EVM reads only. It is not
evidence of a public wallet/provider, consensus validator, production RPC, price feed, route,
liquidity, Solana chain, or production persistence integration, and its output must never authorize
a financial action.
