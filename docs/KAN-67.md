# KAN-67: unified balance and portfolio-value API

Status: `DURABLE_READERS_CONNECTED` / `AGREEMENT_EVIDENCE_OWNER_ONLY` /
`LIVE_INGESTION_BLOCKED`

KAN-67 adds an authenticated, reporting-only `GET /api/v1/portfolio` boundary.
It combines one account-scoped indexed-balance snapshot with immutable BAL-001
price evidence, then returns exact USD totals by wallet, network, stablecoin,
and source. The implementation is provider-neutral. Its production composition
now reads only from the PostgreSQL balance and price-evidence read models; it
does not call a wallet, RPC, market-data provider, cloud service, or network
endpoint.

The application module installs the migration-`0020` balance reader and the
migration-`0021` price-evidence reader. Missing, stale, or malformed durable
evidence remains explicit and can never become an invented zero balance or an
implicit one-dollar price. Adapter/parser failures still return the generic
retryable `503` contract.

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
| B      | Ethereum mainnet | USDT  | `3500.000000000000000000` |

The resulting wallet totals are `7500` and `3500`; USDC totals `8500`, USDT
totals `2500`, and the overall result is exactly
`11000.000000000000000000` USD. Source attribution remains present beside the
aggregate, so the total is auditable without recomputing from a floating-point
display value.

This deterministic acceptance example uses only the current Ethereum/Solana
launch allowlist. It proves arithmetic and attribution with injected local
evidence; it does not count a provider, prove a live read, or authorize a chain
request.

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

The balance read locks and compares the exact active wallet roster supplied by
the authenticated account-scoped wallet reader. It accepts only Ethereum
mainnet and Solana mainnet, and each available wallet observation must contain
the exact registry-pinned USDC, USDT, and PYUSD rows. The API role can execute
the roster read but cannot select the underlying raw/history/projection tables.
Every source row remains provisional reporting evidence and cannot authorize a
financial action.

## Honest integration gates

- **IDX-005 / KAN-65:** the durable account-scoped balance reader, append-only
  observations/events, revisioned projection, stale preservation, and reorg
  replacement are present and PostgreSQL-tested. A worker-only exact-wallet
  resolver and dormant Ethereum/Solana transcript adapters are also present. A
  finalized-only, two-source agreement coordinator now requires an exact,
  time-bounded source-pair registry; distinct source IDs, failure families, and
  reader instances; current identity-validated evidence; an exact Ethereum
  block-number/hash/parent checkpoint or Solana rooted finalized-slot/block/
  parent checkpoint; identical complete stablecoin balances; and an approved
  deployment-manifest fingerprint that exactly matches each source's approved-
  manifest claim, while the two domain-separated observed deployment-identity
  fingerprints must match each other. Its immutable V2 candidate preserves both
  deployment-aware source attestations and a domain-separated agreement
  fingerprint, while setting both persistence and financial authority false.
  Migration `0027` established the separate append-only
  `balance_sync_financial_agreement_evidence` table and owner-only V1 recorder.
  Migration `0032` leaves that V1 relation, its functions, constraints,
  manifest, and verifier byte-for-byte unchanged. V1 remains fail-closed: its
  committed PostgreSQL position-ID expression attempts to construct NUL text
  with `chr(0)`, so it cannot accept otherwise-valid agreement evidence.
  Migration `0032` neither awakens nor replaces that path. It adds a distinct
  permanent append-only `balance_sync_financial_agreement_evidence_v2` relation plus
  owner-only V2 envelope validation and recording functions, repairing only
  the derived V2 position-ID hash with bytea `convert_to(...) ||
decode('00', 'hex')` separators. The V2 database path
  revalidates the complete closed envelope, the exact active three-asset set,
  canonical position IDs, the later retrieval time, both ordered and
  independent attestations, exact finalized checkpoint, deployment-identity
  agreement, all 51 coordinator-declared JSON string types, and every
  coordinator-V2 domain-separated SHA-256 fingerprint before recording. When a
  candidate is presented to the V2 recorder, it
  rejects a fingerprint already committed in V1 and accepts only an exact V2
  replay. V1 remains untouched; this is not a bidirectional or global
  concurrent-serialization claim.
  It locks and binds the active registered wallet and accepts a new record only
  while the source-pair approval and chain freshness window remain current.
  Exact replay returns `IDEMPOTENT_REPLAY`; same-fingerprint content conflict is
  rejected. Both row mutation and truncation are protected by `ALWAYS`
  append-only triggers, and rollback refuses to delete history once any row
  exists. The table, its columns, row type, validators, and recorder remain
  schema-owner only: API, worker, legacy, migration, and `PUBLIC` receive no
  table, column, type, or function capability. Migration `0032` supersedes the
  cumulative `0031` verifier, so it
  preserves the earlier stablecoin-ingestion and generic-worker suspensions as
  well as the dormant provider-position boundaries.
  The checked-in source-pair registry is empty and `NOT_APPROVED`; the
  coordinator and transcript adapters remain unregistered and own no endpoint
  or egress path. Production preflight now also byte-pins the dormant Ethereum
  and Solana deployment manifests and concrete identity verifiers, including
  their empty `NOT_APPROVED` state, external fingerprint gates, chain-specific
  checkpoint semantics, and absence from launch roots. These sources do not
  constitute approval. Activation remains blocked on a separately governed,
  release-bound manifest-fingerprint approval; evidence that an approved Solana
  provider can satisfy the `getMultipleAccounts` exact-slot contract; and an
  independently captured real PYUSD Token-2022 golden fixture with its exact
  extension inventory and reviewed mutable-field window policy. Distinct
  synthetic aliases do not establish real provider independence. An isolated
  balance-sync source/DLQ and publisher contract exist, but no dedicated
  consumer task/service or receive/delete IAM capability is active. Live
  indexing is still blocked on that approved consumer/runtime, durable message
  idempotency, independently approved RPC identities and live evidence, secrets,
  egress, and operational controls. The boundary is deliberately not registered
  in Nest, the balance worker, or any endpoint and does not make `mayPersist` or
  financial authority true.
  Persisting only the nested observation candidate would discard required
  provenance and remains prohibited.
- **BAL-001 / KAN-66:** the durable price-evidence reader/store and dormant Pyth
  Hermes and Ethereum Chainlink transcript parsers are present. Pyth binary
  signatures are not verified, and Chainlink requires an independently approved
  exact deployment manifest and source agreement; neither parser is registered
  or persistence-eligible. Real evidence ingestion remains blocked on those
  authenticity controls, KAN-252 provider/Risk approval, KAN-231 exact egress
  approval, a durable consumer, and operations evidence. An empty store still
  cannot produce an available valuation.
- **Wallet presentation:** this API intentionally emits opaque wallet IDs and
  no address. The authenticated production UI manages the account-scoped wallet
  roster separately and deliberately renders only aggregate reporting data.
- **Buying power / KAN-68:** reporting totals are not collateral values and
  cannot authorize a quote, intent, transfer, or buying-power increase.
- **Live acceptance:** provider timestamps, source independence, throttling,
  outage behavior, reorg recovery, durable replay protection, and operational
  alerting require later approved live-integration evidence.

There were no installs, external network/RPC/provider calls, cloud services,
trials, deployments, pushes, or paid actions in this implementation. On
2026-09-07, the guarded disposable loopback PostgreSQL run passed 11/11 mainnet
balance-agreement cases and the related provider-position lane passed 6/6. The
mainnet lane covered V1 rejection with zero rows, upgrade preservation of the
empty V1 relation and its objects, and genuine Ethereum and Solana V2
acceptance. Migration `0032` now pins SHA-256 hashes of PostgreSQL 16's
non-pretty `pg_get_expr(conbin, conrelid, false)` output for exactly four V2
CHECK expressions. It retains the structural, ACL, and function checks and
fails closed when those catalog expressions drift or when
`server_version_num` is outside the PostgreSQL 16 range from `160000` through
`169999`; the database proof changed and restored each CHECK while preserving
its earlier marker substrings. This is local-only database evidence, not a live
provider, blockchain, deployment, or production-catalog result. Moving off
PostgreSQL 16 requires a reviewed verifier change and live-catalog revalidation;
any deparser-output change, including within 16.x, additionally requires a
reviewed hash rebaseline. Verification against the eventual live catalog
remains a pre-grant blocker and no activation is implied.

## Local verification

All tests use deterministic injected readers and an injected clock.

```powershell
npm test --workspace @crypto-lending/api -- --runInBand src/blockchain-sync/application/mainnet-balance-two-source-agreement.coordinator.spec.ts
npm test --workspace @crypto-lending/api -- --runInBand src/infrastructure/database/migrations/0027-create-mainnet-balance-agreement-evidence.migration.spec.ts
npm test --workspace @crypto-lending/api -- --runInBand src/infrastructure/database/migrations/0032-upgrade-mainnet-balance-agreement-evidence-v2.migration.spec.ts
npm test --workspace @crypto-lending/api -- --runInBand src/portfolio/domain/portfolio-balance-snapshot.spec.ts src/portfolio/application/portfolio.service.spec.ts
npm run test:e2e --workspace @crypto-lending/api -- --runInBand test/portfolio.e2e-spec.ts
npm run typecheck --workspace @crypto-lending/api
npm run lint --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm run format:check
npm run security:scan:secrets
git diff --check main...HEAD
```

The optional PostgreSQL integration suite is
`test/infrastructure/mainnet-balance-agreement-evidence.integration-spec.ts`.
It remains guarded by `RUN_INFRASTRUCTURE_INTEGRATION=1`, requires the exact
marked loopback fixture, and is not a live provider or blockchain test.
