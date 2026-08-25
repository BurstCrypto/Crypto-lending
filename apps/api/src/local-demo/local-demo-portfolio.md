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
6. Invoke the real KAN-68 `BuyingPowerCalculator`. Its injected deterministic adjustment deducts
   one percent, split explicitly across liquidity, conversion, slippage, network, and routing.
7. Floor scale-18 USD mantissas to integer cents and return the exact KAN-69 web response shape.

With one connected wallet in each namespace, the stable fixtures contain $7,000 EVM USDC and
$4,000 Solana USDC. The resulting portfolio is $11,000, deductions are $110, and local-demo buying
power is $10,890. A single connected namespace receives only its proportional fixture total.

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
