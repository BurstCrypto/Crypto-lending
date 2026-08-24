# KAN-252 stablecoin valuation authorization and validation record

> Status: `NOT_AUTHORIZED` / `NOT_RUN`
>
> This record does not authorize provider research requiring an account,
> acceptance of terms, a trial, plan, payment method, credential, endpoint,
> DNS/TLS lookup, live market-data request, deployment, egress, or spend.
> `NO_EXTERNAL_EGRESS` remains mandatory until KAN-231 separately approves
> exact destinations.

## Record and immutable binding

| Field                                      | Value                                                              |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Record ID                                  | `NOT_RUN`                                                          |
| KAN-66 merged commit/tree SHA              | `NOT_RUN`                                                          |
| KAN-66 decision path                       | `docs/valuation/kan-66-stablecoin-valuation-decision.json`         |
| Expected KAN-66 decision SHA-256           | `6c36c7bc78d70102c74255b9630f7a7e18e842e6daff52c9a73eed182121b7f3` |
| Observed KAN-66 decision SHA-256           | `NOT_RUN`                                                          |
| KAN-61 registry fingerprint SHA-256        | `5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d` |
| Observed KAN-61 registry fingerprint       | `NOT_RUN`                                                          |
| Adapter/policy/configuration SHA-256       | `NOT_RUN`                                                          |
| Deterministic validation harness SHA-256   | `NOT_RUN`                                                          |
| Fixture/capture manifest SHA-256           | `NOT_RUN`                                                          |
| Environment/account alias/Region           | `NOT_RUN`                                                          |
| Exercise start/end (UTC)                   | `NOT_RUN` / `NOT_RUN`                                              |
| Decision                                   | `NOT_RUN` (`ACCEPT`, `CONDITIONAL`, or `REJECT`)                   |
| Independent verifier / decided at (UTC)    | `NOT_ASSIGNED` / `NOT_RUN`                                         |
| Evidence manifest SHA-256 / storage record | `NOT_RUN` / `NOT_RUN`                                              |

Digest equality proves file identity only. It does not establish that feed
identity, provider behavior, terms, prices, availability, or approvals are
current.

## Independent approvals

| Authority                             | Reviewer alias | Decision         | Approved / expires (UTC) | Evidence reference |
| ------------------------------------- | -------------- | ---------------- | ------------------------ | ------------------ |
| Risk                                  | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`    | `NOT_RUN`          |
| Finance/Accounting                    | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`    | `NOT_RUN`          |
| Data/Architecture                     | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`    | `NOT_RUN`          |
| Security                              | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`    | `NOT_RUN`          |
| Privacy/Legal                         | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`    | `NOT_RUN`          |
| Availability/Operations               | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`    | `NOT_RUN`          |
| Product                               | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`    | `NOT_RUN`          |
| KAN-231 exact-host egress             | `NOT_ASSIGNED` | `NOT_APPROVED`   | `NOT_RUN` / `NOT_RUN`    | `NOT_RUN`          |
| Non-production account/traffic window | `NOT_ASSIGNED` | `NOT_AUTHORIZED` | `NOT_RUN` / `NOT_RUN`    | `NOT_RUN`          |

No role's approval implies another. Record conflicts, recusals, exceptions,
conditions, and expiry. The final verifier must be independent of provider
selection, implementation, evidence collection, and finding ownership.

## Exact provider and product selection

Complete each cell from approved, current evidence for the exact product and
legal entity. Safe aliases belong here; secrets and raw endpoint URLs do not.

| Field                                              | Pyth Core primary | Chainlink Data Feeds fallback |
| -------------------------------------------------- | ----------------- | ----------------------------- |
| Exact legal entity/contract/version                | `NOT_RUN`         | `NOT_RUN`                     |
| Exact product/version/network                      | `NOT_RUN`         | `NOT_RUN`                     |
| Account/plan/payment authorization                 | `NOT_AUTHORIZED`  | `NOT_AUTHORIZED`              |
| Exact approved hostname or RPC dependency alias    | `NOT_RUN`         | `NOT_RUN`                     |
| Credential reference/custodian/rotation/revocation | `NOT_RUN`         | `NOT_RUN`                     |
| TLS/DNS/certificate and redirect controls          | `NOT_RUN`         | `NOT_RUN`                     |
| SLA/support/status/escalation/incident terms       | `NOT_RUN`         | `NOT_RUN`                     |
| DPA/subprocessors/residency/retention/deletion     | `NOT_RUN`         | `NOT_RUN`                     |
| Permitted use, redistribution, audit, termination  | `NOT_RUN`         | `NOT_RUN`                     |
| Base price, quotas, units, overages, taxes         | `NOT_RUN`         | `NOT_RUN`                     |
| Monthly warning/stop/absolute cost ceiling         | `NOT_RUN`         | `NOT_RUN`                     |
| Underlying publisher/venue/cloud/network mapping   | `NOT_RUN`         | `NOT_RUN`                     |
| Independence/correlated-failure assessment         | `NOT_RUN`         | `NOT_RUN`                     |

## Exact asset/feed identity

The candidate identifiers below come from KAN-66 and remain unapproved until
current identity and lifecycle evidence is captured. The Chainlink path also
depends on the separately approved KAN-62 RPC path.

| Asset | Pyth symbol / stable feed ID                                                            | Chainlink selector / exact proxy and aggregator | Decimals / heartbeat / lifecycle | Result    |
| ----- | --------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------- | --------- |
| USDC  | `Crypto.USDC/USD` / `eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a`  | `usdc-usd.data.eth` / `NOT_RUN`                 | `NOT_RUN`                        | `NOT_RUN` |
| USDT  | `Crypto.USDT/USD` / `2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b`  | `usdt-usd.data.eth` / `NOT_RUN`                 | `NOT_RUN`                        | `NOT_RUN` |
| PYUSD | `Crypto.PYUSD/USD` / `c1da1b73d7f01e7ddd54b3766cf7fcd644395ad14f70aa706ec5384c59e76692` | `pyusd-usd.data.eth` / `NOT_RUN`                | `NOT_RUN`                        | `NOT_RUN` |

For every source and asset, record the exact observed identity, UTC interval,
source timestamp, observation timestamp, signed update or round identity,
sequence behavior, confidence semantics, response evidence SHA-256, request
count, byte estimate, latency, and cost. Prove durable uniqueness/checkpointing
for Pyth signed-update identity plus `publish_time` and Chainlink `roundId` plus
round timestamps; publish time alone is not a safe sequence key.

## Risk and valuation-policy decision

Risk and Finance must explicitly accept, condition, or reject each immutable
rule. A blank or inherited decision is not approval.

| Rule                                      | Proposed value                                                        | Decision / evidence |
| ----------------------------------------- | --------------------------------------------------------------------- | ------------------- |
| Current / stale maximum age               | 60 seconds / 300 seconds                                              | `NOT_RUN`           |
| Pyth maximum confidence                   | 50 bps                                                                | `NOT_RUN`           |
| Medium / maximum usable source divergence | 25 bps / 50 bps                                                       | `NOT_RUN`           |
| Normal / depegged downside boundary       | at most 50 bps / at least 200 bps                                     | `NOT_RUN`           |
| Conservative valuation                    | minimum eligible lower bound, capped at USD 1                         | `NOT_RUN`           |
| Stale or unavailable                      | ineligible; reject/block new financial increase                       | `NOT_RUN`           |
| Source conflict above 50 bps              | null valuation, freeze, retain both observations                      | `NOT_RUN`           |
| Repeg evidence                            | 4 distinct corroborated samples over at least 1,800 seconds           | `NOT_RUN`           |
| Repeg quality                             | at most 25 bps downside and Pyth confidence                           | `NOT_RUN`           |
| Clear                                     | authenticated manual Risk clear bound to the exact durable latch      | `NOT_RUN`           |
| Manual override                           | named authority, scope, reason, expiry, audit, rollback, no repricing | `NOT_RUN`           |
| Financial activation                      | separate explicit approval after every gate                           | `NOT_APPROVED`      |

Record the incident owner, 24x7 escalation path, authority to latch and clear,
separation of duties, evidence retention, customer-impact decision, kill switch,
and maximum time to acknowledge each depeg, conflict, stale, and unavailable
state.

## Authorized evidence matrix

Evidence has two non-interchangeable modes:

- `BOUNDED_LIVE_READ` verifies approved source identity and naturally occurring
  normal-path behavior using a pre-approved request, time, and cost envelope. It
  must not wait for, manufacture, or claim exact market/failure thresholds.
- `LOCAL_DETERMINISTIC` runs the digest-bound policy harness against explicitly
  synthetic source-shaped fixtures or an independently authenticated immutable
  capture replay. It makes no provider request. Synthetic/replayed observations
  must be labeled as such and can never be represented as current live prices.

Provider manipulation, oracle/publisher influence, request flooding, deliberate
quota exhaustion, waiting for a depeg, and traffic intended to force a timeout,
429, stale value, divergence, or outage are prohibited. A naturally observed
live anomaly may be retained under the approved evidence policy, but acceptance
cannot depend on one occurring.

| Scenario                           | Evidence mode         | Required result                                                               | USDC      | USDT      | PYUSD     |
| ---------------------------------- | --------------------- | ----------------------------------------------------------------------------- | --------- | --------- | --------- |
| Exact source identity/current read | `BOUNDED_LIVE_READ`   | Approved identity, source time/update ID, provenance, redaction, bounded cost | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Naturally observed normal path     | `BOUNDED_LIVE_READ`   | Integer result and provenance; no upside above USD 1                          | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Pyth confidence boundary           | `LOCAL_DETERMINISTIC` | Exact 50 bps usable; above 50 bps unavailable                                 | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| 60-second freshness boundary       | `LOCAL_DETERMINISTIC` | Exact boundary current; later observation stale                               | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Stale primary/current fallback     | `LOCAL_DETERMINISTIC` | Low-confidence reporting only; no new financial increase                      | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Both stale/unavailable             | `LOCAL_DETERMINISTIC` | Null valuation; reject/block; timestamped last-good display only              | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Source disagreement 25/50 bps      | `LOCAL_DETERMINISTIC` | Class changes at exact boundaries without silent source choice                | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Source conflict above 50 bps       | `LOCAL_DETERMINISTIC` | Freeze/null; preserve both; trigger downside alarm when applicable            | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Downside 50/200 bps                | `LOCAL_DETERMINISTIC` | Normal/watch/depegged transition occurs at exact boundaries                   | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Durable depeg latch                | `LOCAL_DETERMINISTIC` | Atomic asset-bound unique latch survives restart and concurrent evaluation    | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Repeg candidate                    | `LOCAL_DETERMINISTIC` | Four unique monotonic samples span 1,800 seconds; no automatic clear          | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Authenticated manual clear         | `LOCAL_DETERMINISTIC` | Distinct clear ID binds latch, follows final sample, is auditable and atomic  | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Duplicate/replayed update          | `LOCAL_DETERMINISTIC` | Durable uniqueness rejects replay without changing accepted checkpoint        | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Nonmonotonic/future timestamp      | `LOCAL_DETERMINISTIC` | Observation unavailable; no checkpoint or financial-state advance             | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Primary outage/fallback/recovery   | `LOCAL_DETERMINISTIC` | Bounded fallback, explicit low confidence, reconciled failback                | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |
| Rate limit/timeout/invalid payload | `LOCAL_DETERMINISTIC` | Bounded retry/backoff; fail closed; no secret/raw payload leakage             | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` |

For every row, record mode, harness and input/capture digest, exact policy and
adapter revision, UTC interval, result/evidence digest, reviewer, and whether
the input was synthetic, replayed, or naturally observed live data.
`LOCAL_DETERMINISTIC` provenance is only `SYNTHETIC` or `CAPTURE_REPLAY`;
`BOUNDED_LIVE_READ` provenance is only `NATURALLY_OBSERVED_LIVE`.

## Security, privacy, operations, and cost evidence

| Control                                                            | Owner          | Evidence SHA-256/reference | Result    |
| ------------------------------------------------------------------ | -------------- | -------------------------- | --------- |
| Exact-host KAN-231 allowlist, caller/method scope, and kill switch | `NOT_ASSIGNED` | `NOT_RUN`                  | `NOT_RUN` |
| Credential least privilege, custody, rotation, and revocation      | `NOT_ASSIGNED` | `NOT_RUN`                  | `NOT_RUN` |
| TLS/DNS pinning policy, redirect denial, and endpoint validation   | `NOT_ASSIGNED` | `NOT_RUN`                  | `NOT_RUN` |
| Log/metric/trace redaction and bounded identifiers                 | `NOT_ASSIGNED` | `NOT_RUN`                  | `NOT_RUN` |
| Retention, deletion, residency, access audit, and subprocessors    | `NOT_ASSIGNED` | `NOT_RUN`                  | `NOT_RUN` |
| Rate limits, latency, availability, recovery, and escalation       | `NOT_ASSIGNED` | `NOT_RUN`                  | `NOT_RUN` |
| Request/cost meter, warnings, hard stop, and absolute ceiling      | `NOT_ASSIGNED` | `NOT_RUN`                  | `NOT_RUN` |
| Source overlap and correlated-failure exercise                     | `NOT_ASSIGNED` | `NOT_RUN`                  | `NOT_RUN` |

## Findings, cleanup, and final decision

| Finding ID | Severity  | Safe description | Owner          | Due (UTC) | Disposition | Retest hash/result    |
| ---------- | --------- | ---------------- | -------------- | --------- | ----------- | --------------------- |
| `NOT_RUN`  | `NOT_RUN` | `NOT_RUN`        | `NOT_ASSIGNED` | `NOT_RUN` | `NOT_RUN`   | `NOT_RUN` / `NOT_RUN` |

| Cleanup item                                                           | Owner          | Evidence/reference | Result    |
| ---------------------------------------------------------------------- | -------------- | ------------------ | --------- |
| Provider and RPC traffic stopped; kill switches verified               | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |
| Credentials revoked/rotated and exact-host egress returned to baseline | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |
| Trial/account/plan/endpoints deleted or explicitly retained            | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |
| Provider-side data deletion/retention disposition recorded             | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |
| Observed spend, unbilled estimate, retained cost, final recheck        | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |
| Evidence sealed with least access and retention/expiry recorded        | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |

Final acceptance requires current independent approvals, exact immutable
bindings, all three assets and both sources, durable replay/latch/clear proof,
normal and failure exercises, no unresolved high/critical finding, cleanup and
cost accounting, and an independent signed decision. Acceptance here does not
authorize production traffic or financial activation.
