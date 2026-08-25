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

`POST /api/v1/local-demo/allocation-preview` accepts one closed preset identifier and projects that
eligible capital across three deterministic buckets. Only non-reserve capital receives a one
percent synthetic estimate, split across liquidity, conversion, slippage, network, and routing in
the established 50/10/10/10/20 proportions. Integer-cent largest-remainder apportionment makes
allocations and itemized estimates sum exactly. The preview creates no operation or transaction and
has no provider, network, or persistence dependency.

The preview also labels fixed synthetic demo APYs of 0% for liquid reserve, 4% for conservative
yield, and 6% for balanced yield. Each preset's effective APY is weighted from its target
percentages (1.80%, 3.30%, or 4.40%). Projected annual yield floors
`net planned capital * effective APY` to whole cents, and projected annual net growth subtracts the
one-time fee estimate. Break-even uses simple 365-day APY proration on net capital and returns the
first whole day whose floored accrued cents exceed fees. These are illustrative fixed-rate
projections, not sourced opportunities, quotes, promises, or financial authorizations.

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
