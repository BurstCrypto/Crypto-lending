# KAN-67: unified balance and portfolio-value API

Status: `LOCAL_DEMO_IMPLEMENTED` / `LIVE_READERS_NOT_CONNECTED`

KAN-67 adds an authenticated, reporting-only `GET /api/v1/portfolio` boundary.
It combines one account-scoped indexed-balance snapshot with immutable BAL-001
price evidence, then returns exact USD totals by wallet, network, stablecoin,
and source. The implementation is provider-neutral and does not call a wallet,
RPC, market-data provider, database, cloud service, or network endpoint.

The application module intentionally installs fail-closed readers. Until the
IDX-005 balance reader and approved BAL-001 price-evidence reader are wired by
later integration work, a real request returns the generic retryable `503`
contract instead of inventing a balance or a one-dollar price.

## HTTP contract

The route requires the existing authenticated session cookie. The account is
taken only from the authenticated principal; account-like query parameters and
headers are ignored. Responses use `Cache-Control: private, no-store` and vary
on `Cookie, Origin`. A source failure produces only:

```json
{
  "error": "Service Unavailable",
  "message": "Portfolio unavailable",
  "statusCode": 503
}
```

The `Retry-After` response header is `1`. Adapter or parser error text is never
returned. The OpenAPI document publishes session-cookie security, the closed
response schema, and the `401` and `503` cases.

Every successful response includes:

- a trusted server `asOf` and the opaque balance snapshot ID, capture time, and
  snapshot freshness;
- `overallTotal`, `walletTotals`, `chainTotals`, and `assetTotals` with exact
  scale-18 USD strings, freshness, completeness, and source counts;
- one source record per supported wallet/network/asset balance with its exact
  atomic amount, registry-bound asset identity, balance timestamp, immutable
  price snapshot ID, selected price observation, and valuation policy result;
- unsupported source records in `excludedSources`, always marked as excluded;
  and
- explicit `CONSERVATIVE_REPORTING_ONLY`, `mayIncreaseBuyingPower: false`, and
  `mayAuthorizeFinancialUse: false` controls at the response and valuation
  levels.

No field in this API is buying power. KAN-68 must calculate that separately
under its own collateral and risk policy.

## Exact arithmetic and the acceptance example

Asset quantities remain canonical base-unit integer strings. BAL-001 produces
USD mantissas at scale 18, and KAN-67 adds those mantissas with bounded `BigInt`
arithmetic. The API never uses binary floating point, implicit token decimals,
or an implicit one-dollar stablecoin rate.

The deterministic endpoint test proves the epic's example using three source
balances and three independently identified, asset-bound price snapshots:

| Wallet | Network          | Asset | Exact USD value           |
| ------ | ---------------- | ----- | ------------------------- |
| A      | Ethereum mainnet | USDC  | `5000.000000000000000000` |
| A      | Solana mainnet   | USDT  | `2500.000000000000000000` |
| B      | Base mainnet     | USDC  | `3500.000000000000000000` |

The resulting wallet totals are `7500` and `3500`; USDC totals `8500`, USDT
totals `2500`, and the overall result is exactly
`11000.000000000000000000` USD. Source attribution remains present beside the
aggregate, so the total is auditable without recomputing from a floating-point
display value.

## Freshness, completeness, and exclusion rules

- A stale balance snapshot downgrades every apparently-current contained row.
  This also prevents a stale empty snapshot from being presented as current.
- A stale balance with a valid current price can remain in the reporting total,
  but its source and affected aggregate are visibly `STALE` and cannot be used
  for financial authorization.
- A stale, malformed, conflicting, or unavailable BAL-001 valuation contributes
  no numeric USD value. The source remains visible as `UNAVAILABLE` and the
  affected aggregate becomes `PARTIAL` or `UNAVAILABLE`.
- An asset identity absent from the exact active KAN-61 mainnet registry is not
  priced. It appears only in `excludedSources`, contributes no value, and makes
  its wallet/network and the overall result incomplete.
- A genuinely current empty snapshot returns exact zero with `COMPLETE`
  completeness. A stale empty snapshot also returns exact zero, but the
  overall freshness is `STALE`.
- Duplicate observation IDs or duplicate wallet/network/asset rows invalidate
  the entire balance snapshot. This prevents double counting.

Overall and group totals preserve all unavailable/stale evidence instead of
silently presenting the sum of the remaining sources as complete.

## Trust boundaries

The balance-reader request is account scoped and includes only the authenticated
`AccountId`, trusted server evaluation time, and request correlation ID. Its
result deliberately contains no account ID that an adapter could use to change
the subject. The runtime parser accepts only a bounded closed snapshot shape,
canonical UUIDs and timestamps, supported CAIP network forms, canonical atomic
amounts, and at most 512 unique source observations.

The price reader is requested once for each unique registry-normalized asset.
Price payloads are bounded and passed through the existing BAL-001 evaluator,
which verifies asset binding, timestamps, source watermarks, conservative
selection, and the pending-approval policy. Reader exceptions and malformed
payloads become unavailable evidence and do not leak through HTTP.

Opaque snapshot IDs are restricted to non-secret safe characters and lengths.
The response includes wallet IDs needed for grouping but never includes an
account ID, session material, provider credential, RPC URL, raw adapter error,
or internal stack trace.

## Honest integration gates

- **IDX-005 / KAN-65:** its durable account-scoped multi-chain balance reader is
  not part of this branch. The local fake demonstrates the port contract, but
  live indexing, reorg handling, durable freshness, and account isolation must
  be proven before wiring the port.
- **BAL-001 / KAN-66:** the pure valuation boundary is present, but real price
  evidence remains blocked on KAN-252 provider/Risk approval and KAN-231 exact
  egress approval. No market-data adapter or RPC fallback is configured.
- **Wallet presentation:** this API intentionally emits opaque wallet IDs.
  Connector lifecycle state and user-facing wallet labels can be joined by the
  UI only after their independent branches are merged and reviewed.
- **Buying power / KAN-68:** reporting totals are not collateral values and
  cannot authorize a quote, intent, transfer, or buying-power increase.
- **Live acceptance:** provider timestamps, source independence, throttling,
  outage behavior, reorg recovery, durable replay protection, and operational
  alerting require later approved live-integration evidence.

There were no installs, network/RPC/provider calls, cloud/database services,
trials, deployments, pushes, or paid actions in this implementation.

## Local verification

All tests use deterministic injected readers and an injected clock.

```powershell
npm test --workspace @crypto-lending/api -- --runInBand src/portfolio/domain/portfolio-balance-snapshot.spec.ts src/portfolio/application/portfolio.service.spec.ts
npm run test:e2e --workspace @crypto-lending/api -- --runInBand test/portfolio.e2e-spec.ts
npm run typecheck --workspace @crypto-lending/api
npm run lint --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm run format:check
npm run security:scan:secrets
git diff --check main...HEAD
```
