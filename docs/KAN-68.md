# KAN-68 — Baseline available buying power

Status: `LOCAL_CALCULATION_COMPLETE` / `RUNTIME_ROUTE_AND_COST_DATA_NOT_WIRED`

KAN-68 adds a pure, provider-neutral buying-power calculator under
`apps/api/src/buying-power`. It converts exact scale-18 USD portfolio
contributions into a conservative local estimate while keeping portfolio value
and spendable buying power visibly distinct. The branch has no HTTP route,
market-data client, routing client, provider SDK, queue, database adapter, or
cloud wiring.

The output is always labeled `LOCAL_DEMO_ESTIMATE_ONLY` and
`mayAuthorizeFinancialAction: false`. This local calculation cannot approve a
loan, transfer, route, or other financial action.

## Calculation contract

The calculator accepts at most 128 normalized contributions. Every contribution
is bound to an opaque contribution, wallet, network, and asset ID; an exact
non-negative USD mantissa at scale 18 (or explicit `null`); upstream freshness;
valuation-use state; and a canonical source timestamp. Duplicate contribution
IDs, future source timestamps, extra fields, accessors, noncanonical numbers,
and aggregates beyond the 100-digit portfolio bound fail before an adjustment
adapter is called.

For reporting, `supportedPortfolioValueMantissa` sums supported, priced
contributions even when a last-good value is stale. Buying-power eligibility is
narrower:

- unsupported assets are excluded;
- `null` valuations are unpriced, never zero;
- stale or unavailable observations are excluded; and
- financially blocked valuation inputs are excluded.

The resulting eligible gross value can only decrease. The final invariant is
checked exactly:

`available buying power <= eligible gross value <= supported portfolio value`

All arithmetic uses bounded `BigInt` integer mantissas. There is no binary
floating-point or implicit rounding.

## Pluggable adjustment boundary

Each eligible contribution is sent sequentially to an injected
`BuyingPowerAdjustmentPort`. An available quote must echo the contribution ID,
have a current canonical lifetime, and provide all five exact deduction fields:

1. liquidity;
2. conversion;
3. slippage;
4. network; and
5. routing.

An omitted field, malformed or expired quote, adapter failure, or deductions
above the contribution value makes that contribution unavailable. It never
becomes a zero-cost route. An adapter may instead return explicit unavailable
reasons such as `NETWORK_COST_UNAVAILABLE` or `ROUTE_UNAVAILABLE`. Other valid
contributions remain independently calculable, and the aggregate reports
`PARTIAL` with every unavailable reason.

The deterministic acceptance fixture uses current $7,000 and $4,000
contributions, reproducing the BAL-002 $11,000 eligible gross value. Explicit
$60 total deductions produce $10,940 of local demo buying power. A separate
stale $500 supported balance remains visible in the $11,500 supported portfolio
value but contributes no buying power; an unsupported $200 source is excluded
from both totals.

## KAN-67 integration boundary

KAN-67 is intentionally developed on a separate branch. After both tickets are
merged, a reviewed application mapper can transform each KAN-67 source into the
narrow KAN-68 contribution contract:

- observation ID → contribution ID;
- wallet/network/asset identity → opaque attribution fields;
- exact `usdValue.mantissa` → scale-18 contribution value;
- source freshness → `CURRENT`, `STALE`, or `UNAVAILABLE`; and
- valuation `reportingUse` → the KAN-68 valuation-use gate.

KAN-67 excluded sources map to `supported: false`. No adapter may reinterpret
KAN-67's `mayIncreaseBuyingPower: false`; this ticket remains a demo estimate
until price, liquidity, route, risk, and authorization owners approve a runtime
policy.

## Local evidence and remaining gates

The focused tests cover exact arithmetic, the $11,000 breakdown, all deduction
categories, explicit zero-cost quotes, missing cost data, port failure, excessive
deductions, unsupported/unpriced/stale/blocked inputs, quote identity/lifetime,
duplicate IDs, hostile accessors, aggregate overflow, clock failure, immutability,
and the final upper-bound invariant.

Remaining runtime work requires the merged KAN-67 mapper, a reviewed API route,
authenticated account scope, approved price and routing inputs, bounded live
cost/freshness policy, observability, and deployment authorization. None of
those gates is claimed by this branch.

| Local-only evidence                     | Result                  |
| --------------------------------------- | ----------------------- |
| New packages or lockfile changes        | 0                       |
| Provider/RPC/market/routing calls       | 0                       |
| Database, queue, Docker, or cloud calls | 0                       |
| Accounts, trials, or resources created  | 0                       |
| Deployments or pushes                   | 0                       |
| Cost incurred                           | USD `0.00`              |
| Financial authorization                 | `false` on every result |

Review commands:

```powershell
npm test --workspace @crypto-lending/api -- --runInBand src/buying-power
npm test --workspace @crypto-lending/api -- --runInBand
npm run typecheck --workspace @crypto-lending/api
npm run lint --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm run format:check
npm run security:scan:secrets
git diff --check main...HEAD
```
