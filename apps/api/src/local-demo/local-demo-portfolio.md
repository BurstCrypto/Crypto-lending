# Deterministic local-demo portfolio pipeline

`LocalDemoPortfolioService` is the API-side composition boundary for the local demo. It is
deliberately available only through the local-demo module/configuration gate. The service does not
provide a production fallback.

## Data path

1. Read the account-scoped, ownership-proven projections from `LocalDemoWalletService`.
2. Retain each proven address and map the connector's Sepolia/devnet cluster to a synthetic
   MAINNET-shaped fixture network (`eip155:1` or Solana mainnet). This is fixture metadata only; no
   chain or provider is contacted.
3. Invoke the real KAN-63 EVM indexer or KAN-64 Solana indexer with request-local fixture source
   ports. Only the funded USDC position crosses the adapter boundary.
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

- All fixture readers, retry scheduling, checkpoint storage, jobs, metrics, price evidence, clocks,
  and adjustment quotes are request-local deterministic objects.
- The pipeline has no RPC, HTTP, database, queue, timer, wallet-provider, or process-global port.
- Account, correlation, wallet, cluster, address, timestamp, label, registry identity, valuation,
  sync freshness, and aggregate invariants fail closed to `LocalDemoPortfolioUnavailableError`.
- Empty wallet catalogs fail with the same typed unavailable error; they never fabricate an owner.
- The response carries `use: LOCAL_DEMO_ESTIMATE_ONLY` and
  `mayAuthorizeFinancialAction: false`, matching the optional controls accepted by the KAN-69 web
  parser.

## Honest integration gate

This pipeline proves deterministic local composition only. It is not evidence of live wallet,
provider, RPC, price-feed, route, liquidity, or production persistence integration, and its output
must never authorize a financial action.
