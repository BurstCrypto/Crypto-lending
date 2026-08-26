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
   idle web response omits deductions entirely; fees appear only in a requested allocation preview.
7. Floor scale-18 USD mantissas to integer cents and return the exact KAN-69 web response shape.

With one connected wallet in each namespace, the stable fixtures contain $7,000 EVM USDC and
$4,000 Solana USDC. The resulting portfolio and idle buying power are both $11,000. A single
connected namespace receives only its proportional fixture total.

`GET /api/v1/local-demo/yield-catalog` exposes an immutable checked-in capture of five Morpho Blue
USDC/USDT markets on Ethereum and Base. The capture retains exact source timestamps, provider block
identities, request/response hashes, base supply APY, reward APR, reported market fee, TVL,
utilization, and available-to-borrow liquidity. Available-to-borrow is only an exit-liquidity proxy.
Provider listing is recorded, but deposit and withdrawal availability are not verified. Risk is
explicitly not assessed. The runtime performs no Morpho or other provider request; after the 24-hour
capture boundary it labels the data stale and keeps it non-executable.

`POST /api/v1/local-demo/allocation-preview` accepts a closed preset or bounded custom filter.
Custom constraints cover asset, provider, network, minimum base APY, minimum TVL, minimum
available-to-borrow proxy, maximum utilization, and liquid-reserve percentage. The server derives
capital from the authenticated account, ranks matches by exact base APY then opportunity ID, keeps
at most three, and divides the non-reserve allocation deterministically. No match returns a typed
422 response without fallback.

Only non-reserve capital receives a one-percent local action-cost assumption, split across
liquidity, conversion, slippage, network, and routing in the established 50/10/10/10/20
proportions. Integer-cent largest-remainder apportionment makes allocations and itemized estimates
sum exactly. Projected annual yield uses only the weighted provider base APYs on net planned
capital; reward APR remains separately disclosed and excluded. Break-even uses simple 365-day APY
proration and returns the first whole day whose floored accrued cents exceed the local cost
assumption. The catalog and preview create no user-authorized financial operation, live provider
request, public-chain transaction, or persistence record and do not make a promise, recommendation,
or financial authorization. Portfolio fixture maintenance may still create zero-gas transactions
on the owned loopback EVM after a reset.

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
