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

`GET /api/v1/local-demo/yield-catalog` exposes only sanitized status for immutable checked-in EVM
and Solana managed-rate observations: a product-owned identifier, supported ecosystems, capture and
stale timestamps, freshness, non-executable use, and the fact that risk is not assessed. Internally,
provider snapshot v3 contains ten distinct private candidates from immutable point-in-time
developer captures: seven on EVM (Morpho, Aave, Compound, Moonwell, Spark, Venus, and Euler) and
three on Solana (Kamino, Save, and the internally labeled P0/marginfi candidate). A separately
researched Drift observation is excluded before ranking because its observed market was paused and
its observation was stale; it is not one of the ten selectable candidates. Provider and protocol
names, market identifiers, exact observations, provenance, and endpoints remain server-confidential
and never enter the public DTO or web contract. Runtime reads only the checked-in snapshots for
managed-rate evaluation, performs no external provider, public-RPC, validator, bridge, or
public-chain I/O on that path, creates no transaction, and incurs no provider-request or on-chain
execution cost.

The v3 aggregate `capturedAt` is the latest component capture time, when the complete candidate set
exists, while aggregate `staleAfter` is the earliest component stale boundary. This deliberately
conservative interval makes the complete set stale as soon as any component expires; an invalid
interval fails closed. The product-owned public ID `managed-rate-snapshot-v3` reveals the fixture
generation but no provider identity. For v3 the aggregate values are `2026-08-27T01:04:48.000Z`
and `2026-08-27T14:14:54.580Z`, respectively. Staleness never changes the non-executable boundary.

`POST /api/v1/local-demo/allocation-preview` accepts the exact displayed portfolio snapshot ID, one
of the three closed base-plan IDs, and a required user-selected liquid reserve from 0 through 9,500
basis points. The web offers only `BALANCED`, labeled **Managed blend**; `MORE_LIQUID` and
`MORE_YIELD` remain accepted only for compatibility until they gain distinct server-owned strategy
dimensions. The snapshot ID is a concurrency token: a wallet change produces a sanitized 409
instead of allowing an old response to render against a new portfolio. The caller cannot send
custom filters, capital, managed rates, fee inputs, provider or protocol details, market identifiers,
or provenance. The server derives chain-qualified capital from the authenticated account, applies
the requested reserve, and performs confidential source selection and exact-decimal projection
internally. The browser sends zero basis points for a plan's first preview and can then submit an
explicit slider-selected reserve; the API remains generic across the full allowed range. Its response
description is generated from the validated reserve rather than claiming a fixed percentage from the
base plan. The public response contains aggregate `LIQUID_RESERVE` and `MANAGED_YIELD` buckets plus
provider-neutral EVM/Solana source and managed-composition totals. No venue, market, contract, mint,
network identifier, or per-position rate crosses the browser boundary. If the confidential strategy
is unavailable, the API returns a sanitized typed 422 without fallback or internal source details.

The confidential selector is deterministic and distinct-provider first: for each ecosystem its
selection pass admits at most one opportunity per provider and stops after at most two opportunities.
The public result omits the selected-position count and cannot identify the selected providers. This
diversification rule is an allocation heuristic only; it does not classify provider, protocol, asset,
contract, liquidity, or operational risk. Internally, the ten private candidates therefore yield at
most four selected positions when both ecosystems participate, rather than ten simultaneous
positions.

The preview creates no executable route or transaction, so the actual local operation is exactly
zero and public execution remains explicitly unquoted. EVM capital remains assigned to EVM and
Solana capital remains assigned to Solana; no EVM-to-Solana principal transfer is modeled. EVM
network placement is still hypothetical, not proof of a bridge-free executable route. A separate,
non-quote scenario models network, conversion, EVM-to-Solana transfer, market-impact, and routing
components from server-owned inputs. With no subscription-entitlement integration, the server
explicitly applies the canonical Free-tier policy: material orchestration costs 20 basis points of
managed capital, while one exact same-network, same-contract-or-mint direct settlement costs zero.
No legacy local-demo routing calculation is added. Network, conversion, and market-impact amounts
round up to a cent and are deducted from gross capital; the platform fee uses the canonical policy's
half-even atomic-unit rounding and remains added on top. A fixed-topology cent discontinuity retains
the minimum feasible amount, capped at three cents, outside the projection as an explicitly disclosed
rounding residual. It remains user capital and is not included in fee totals or break-even. Larger
route-activation gaps fail closed. Managed capital is apportioned from each ecosystem's
post-deducted-cost capacity, so neither ecosystem funds the other's costs or residual even at a zero
reserve. The cross-ecosystem-transfer component is exactly zero because this composition performs
no EVM-to-Solana transfer. The aggregate buckets and ecosystem composition reconcile exactly to
gross capital after deducted costs and the residual; added-on-top required capital is reported
separately.

Within each ecosystem, the two confidential positions begin at a 60/40 split. Each amount is
bounded by the lower of that observation's captured TVL and available-liquidity proxy; residual
capital is reassigned only among the already selected native-ecosystem positions. Insufficient
combined capacity fails closed instead of producing an over-capacity projection. This capacity-aware
selection and rebalancing is a local in-memory calculation only; it does not persist or execute a
rebalance.

Exact captured observations, including base supply APY decimals and capacity inputs, remain private
for ranking, selection, and capacity checks. The public effective APY is the conservative floor of
the exact position-weighted aggregate to a product-owned 25-basis-point bucket; public whole-cent
annual yield, after-fee yield, and first-positive-day status are derived from that bucketed rate.
Reward or promotional APR remains separate private snapshot metadata and is not included in
selection, aggregate APY, or projected yield. Annual yield after modeled fees can be negative. The
first-positive-day field is the first whole day when straight-line bucketed yield exceeds modeled
fees by at least one cent, limited to a 365-day horizon; it distinguishes no yield from not recovering
within that horizon. Provider listing is only a captured observation; deposit and withdrawal
availability were not verified, and provider and protocol risk remains unassessed. The catalog and
preview create no user-authorized financial operation, live provider request, public-chain
transaction, or persistence record and do not make a promise, recommendation, risk assessment, or
financial authorization. Portfolio fixture maintenance may still create zero-gas transactions on
the owned loopback EVM after a reset.

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

This pipeline proves deterministic local cross-ecosystem composition and real local EVM reads only.
Its Solana wallet and every lending route remain fixtures. It is not evidence of a public wallet or
provider connection, consensus validator, bridge, production RPC, price feed, executable liquidity,
Solana transaction, or production persistence integration, and its output must never authorize a
financial action.
