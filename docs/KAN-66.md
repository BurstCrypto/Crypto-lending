# KAN-66: stablecoin valuation and depeg decision packet

Status: `READY_FOR_INDEPENDENT_REVIEW` / `PENDING_EXTERNAL_APPROVAL`

This packet proposes Pyth Core as the primary USD market-price source and
Chainlink Data Feeds as a fallback and cross-check for KAN-61 mainnet USDC,
USDT, and PYUSD. It defines a conservative, deterministic valuation contract:
cap upside at one dollar, preserve downside, subtract Pyth's published absolute
confidence amount, and fail closed when data is old, malformed, or materially
conflicting.

This is a review proposal, not a provider, Risk, Finance, Legal, Security,
Privacy, Architecture, egress, runtime, or financial-use approval. No provider
account or trial was opened, no plan or payment method was selected, no API or
RPC credential was issued, no market-data API or RPC request was sent, and no
onchain write was made. Local work incurred `0.00 USD` of provider or
infrastructure cost.

The closed machine-readable record is
[`valuation/kan-66-stablecoin-valuation-decision.json`](valuation/kan-66-stablecoin-valuation-decision.json).
Its exact bytes are bound by
[`valuation/kan-66-stablecoin-valuation-decision.sha256`](valuation/kan-66-stablecoin-valuation-decision.sha256).
That sidecar binds only the JSON bytes; it is not an approval and cannot bind a
future merge by itself. The independent approval record must bind the exact
merged Git commit and tree, this packet's exact SHA-256, and the KAN-61 registry
fingerprint together. The approved commit, tree, packet hash, and registry hash
fields remain `null` until that post-merge review exists.

The validator reads the decision and sidecar as non-empty, bounded, stable,
single-link regular files at canonical local paths. It rejects linked path
components, hard links, replacement or metadata drift, duplicate JSON keys at
any depth, malformed UTF-8, and byte-order marks before semantic validation.
The decision is limited to 128 KiB and the exact digest sidecar to 65 bytes.
These checks supplement the compiled reviewed exact-byte and canonical semantic
fingerprints; neither fingerprint constitutes approval.

## Proposed source decision

| Role                     | Candidate                                      | Why it is realistic                                                                                                                                                          | Important limitation                                                                                                                                                           |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primary                  | Pyth Core signed price feeds                   | Official documentation covers all three USD pairs, exact stable feed IDs, `publish_time`, and a published absolute `conf` amount. The advertised update model is sub-minute. | Production API access is commercial and authenticated. The plan, exact hostnames, API rights, rate limits, SLA, and live 60-second behavior are not approved or proven.        |
| Fallback and cross-check | Chainlink Ethereum mainnet Standard Data Feeds | Official feed pages cover all three pairs; `latestRoundData` exposes the price and `updatedAt`; ENS selectors offer a stable discovery name.                                 | The response publishes no native confidence interval. Exact proxy addresses and heartbeats are not pinned, and access also depends on a separately approved Ethereum RPC path. |

Pyth is first because it supplies both a source timestamp and a published
confidence amount that can be used as a conservative lower bound. Chainlink is
second because it can provide a separately operated oracle-network result and
an explicit source timestamp, but it cannot honestly be assigned a fabricated
confidence value. A current Chainlink-only observation is therefore always
`LOW` confidence and reporting-only.

The candidates are not yet proven independent in the financial-risk sense.
They use different oracle protocols and delivery paths, but their publishers,
data providers, exchanges, liquidity venues, clouds, DNS, and other failure
domains may overlap. KAN-252 must measure and approve that overlap before the
fallback can be described as independently risk-reducing.

## Exact asset and feed candidates

The valuation boundary accepts only an exact active identity in KAN-61 mainnet
registry version 1 with fingerprint
`5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d`.
The price feed is selected only after that identity resolves to a supported
stablecoin. A provider symbol or payload can never identify the asset or
network. KAN-61 testnet assets are explicitly nonfinancial and rejected by
this policy.

| Asset | Pyth Core symbol and stable feed ID                                                     | Chainlink Ethereum selector | Chainlink documented deviation | Still required before activation                                                                         |
| ----- | --------------------------------------------------------------------------------------- | --------------------------- | -----------------------------: | -------------------------------------------------------------------------------------------------------- |
| USDC  | `Crypto.USDC/USD` / `eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a`  | `usdc-usd.data.eth`         |                         25 bps | Exact current proxy/aggregator identity, decimals, heartbeat, lifecycle status, and live freshness proof |
| USDT  | `Crypto.USDT/USD` / `2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b`  | `usdt-usd.data.eth`         |                         25 bps | Exact current proxy/aggregator identity, decimals, heartbeat, lifecycle status, and live freshness proof |
| PYUSD | `Crypto.PYUSD/USD` / `c1da1b73d7f01e7ddd54b3766cf7fcd644395ad14f70aa706ec5384c59e76692` | `pyusd-usd.data.eth`        |                         30 bps | Exact current proxy/aggregator identity, decimals, heartbeat, lifecycle status, and live freshness proof |

The Chainlink deviation figures are feed-publication triggers, not guarantees
of accuracy, timeliness, or agreement with another oracle. The static official
pages reviewed for this packet did not establish the exact heartbeat values.
Those fields remain `null` and `PENDING_KAN_252`; an undocumented or long
provider heartbeat must never expand the Risk-owned freshness ceiling.

## Closed valuation policy

All amounts, prices, confidence values, comparisons, and USD calculations use
bounded integer arithmetic. Rates normalize to eight decimal places, output
USD values use 18 decimal places, and division uses round-half-to-even. A
floating-point or implicit one-dollar calculation is not permitted.

For each observation:

1. Require the exact mainnet registry version, fingerprint, network-qualified
   token identity, stablecoin feed reference, source sequence, source update
   identifier, and timestamp fields.
2. Compute age as `evaluatedAt - pricedAt`. `observedAt` records ingestion
   evidence but cannot make a cached quote current. Reject a future
   `pricedAt`, a `pricedAt` later than `observedAt`, a missing timestamp, a
   sequence regression, an update ID duplicated within the request or equal to
   the supplied last-accepted ID, or a timestamp regression against that
   checkpoint. The pure evaluator can compare observations supplied together
   and the immediate predecessor checkpoint, but it is not a durable replay
   database and cannot itself detect a cross-request update-ID sequence such as
   `A -> B -> A`. Migration `0021` and its PostgreSQL adapters now load
   and atomically advance a trusted last-accepted checkpoint for each exact
   asset/source/reference; restarting a process does not erase that watermark.
   Each append-only transition retains both the accepted observation and its
   immediate predecessor sequence, `pricedAt`, `observedAt`, update ID, and
   observation identity. The read adapter deliberately supplies that predecessor
   to the evaluator rather than feeding the observation its own current
   watermark. The database also enforces durable update-ID uniqueness over the
   registry version/fingerprint, exact network-qualified asset, source, and
   source reference before data reaches either evaluator. A provider
   `pricedAt` or `observedAt` may remain equal when sequence advances and the
   update ID passes that repository uniqueness check, but either timestamp may
   never regress.
3. Classify age at most `60` seconds as `CURRENT`, age above `60` and at most
   `300` seconds as `STALE`, and age above `300` as `UNAVAILABLE`. Only
   `CURRENT` observations are eligible for a numeric financial valuation.
4. For Pyth, require the published absolute USD confidence amount and calculate
   `max(price - confidence, 0)`. More than 50 bps of confidence width is
   ineligible. For Chainlink, use the price itself as its lower bound and mark
   confidence as not published; never replace missing confidence with zero.
5. With no current eligible source, return `UNAVAILABLE` and a null numeric
   rate/value. With exactly one current eligible source, return the conservative
   rate as `AVAILABLE` / `LOW` / reporting-only and block any increase in buying
   power.
6. With two current eligible sources, compare their central prices against the
   one-dollar peg. At most 25 bps of divergence is `CORROBORATED`; it can be
   `MEDIUM` only when Pyth confidence is also at most 25 bps. Divergence above
   25 and at most 50 bps is `SOFT_DISAGREEMENT`, `LOW`, and reporting-only.
   Select the smaller conservative lower bound in either usable case.
7. More than 50 bps of divergence is `SOURCE_CONFLICT`: preserve both source
   observations, return a null numeric valuation, and freeze new financial
   action. If either eligible lower bound is at least 200 bps below one dollar,
   also emit the explicit `OUTSIDE_POLICY` downside alarm so refusing to choose
   a trusted rate does not suppress a depeg incident.
8. For every available rate, use `min(conservative lower bounds, 1 USD)`. This
   prevents a temporary premium from increasing collateral value while
   retaining the complete observed downside.

Even a locally `AVAILABLE` result remains unauthorized for production or
financial use while KAN-252 and KAN-231 are pending. `MEDIUM` is the highest
possible local confidence class; the proposal has no `HIGH` class.

## Deterministic thresholds

| Decision                 | Exact boundary                                  | Result                                                  |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------- |
| Current                  | age `<=60 s`                                    | Eligible if all other checks pass                       |
| Stale                    | age `>60 s` and `<=300 s`                       | Ineligible for numeric valuation; display metadata only |
| Unavailable              | age `>300 s`, future, missing, or non-monotonic | Ineligible and fail closed                              |
| Pyth confidence          | `0..25 bps`                                     | May support dual-source `MEDIUM`                        |
| Pyth confidence          | `>25 bps` and `<=50 bps`                        | Eligible only as `LOW`                                  |
| Pyth confidence          | `>50 bps`                                       | Ineligible                                              |
| Dual-source divergence   | `0..25 bps`                                     | `CORROBORATED`; conservative minimum                    |
| Dual-source divergence   | `>25 bps` and `<=50 bps`                        | `SOFT_DISAGREEMENT`; `LOW`; no financial increase       |
| Dual-source divergence   | `>50 bps`                                       | `SOURCE_CONFLICT`; numeric value null; freeze           |
| Downside from one dollar | `0..50 bps`                                     | `NORMAL`                                                |
| Downside from one dollar | `>50 bps` and `<200 bps`                        | `WATCH`; block new financial increase                   |
| Downside from one dollar | `>=200 bps`                                     | `DEPEGGED`; latch required; block financial increase    |

These are Risk-policy proposals, not claims about either provider's SLA or
heartbeat. The absolute 60-second ceiling applies regardless of the provider's
advertised publication trigger.

## Deterministic examples

Each valuation example values exactly 10 units of a six-decimal stablecoin. The
machine record contains each compact valuation observation, confidence value, age, and
exact 18-decimal result. Its recovery example instead records closed compact
predicates that the focused test mapper expands into deterministic synthetic
samples; it does not claim to store provider observations.

The machine `result` object is a tested compact projection, not a serialized
`StablecoinValuationResult`. The focused domain test mapper supplies an exact
KAN-61 mainnet asset reference, canonical timestamps, update IDs, and explicit
all-null first-use checkpoint fixtures, then compares the projection's
engine-named selection,
source, agreement, confidence, rate, value, downside, depeg, and financial
fields. `recoveryStatus` is compared with the separate recovery evaluator; it
is not folded into `depegClass`.

| Example                                   | Inputs and boundary exercised                                                                 | Expected result                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `NORMAL_DUAL_SOURCE`                      | Pyth `1.0000 - 0.0001`; Chainlink `0.9998`; 2 bps central divergence                          | `AVAILABLE`, `MEDIUM`, rate `0.9998`, value `9.998`, `NORMAL`                  |
| `UPSIDE_CAP_DUAL_SOURCE`                  | Both central prices above one dollar                                                          | `AVAILABLE`, rate capped at `1.0000`, value `10`, `NORMAL`                     |
| `SOFT_DISAGREEMENT_WATCH`                 | Central divergence 45 bps; minimum lower bound `0.9915`                                       | `AVAILABLE`, `LOW`, value `9.915`, `WATCH`, increase blocked                   |
| `CORROBORATED_DEPEG`                      | Corroborated prices near `0.975`; Pyth lower bound `0.9748`                                   | `AVAILABLE`, `MEDIUM`, value `9.748`, `DEPEGGED`, latch required               |
| `PYTH_PRIMARY_ONLY`                       | Pyth current; Chainlink 61 seconds old                                                        | `AVAILABLE`, `LOW`, rate `0.9985`, reporting-only                              |
| `CHAINLINK_FALLBACK_ONLY`                 | Pyth 301 seconds old; Chainlink current at `0.997`                                            | `AVAILABLE`, `LOW`, rate `0.997`, reporting-only                               |
| `SOURCE_CONFLICT_DOWNSIDE_ALARM`          | Current prices `1.0000` and `0.9700`                                                          | `UNAVAILABLE`, null rate/value, `CONFLICT`, `OUTSIDE_POLICY`, frozen           |
| `NO_CURRENT_SOURCE`                       | One stale and one unavailable observation                                                     | `UNAVAILABLE`, null rate/value, agreement `NOT_AVAILABLE`                      |
| `REPEG_OBSERVATIONS_MANUAL_CLEAR_MISSING` | Asset-bound latch, four qualifying post-latch samples over 1,800 seconds, but no Risk clear   | Rate may be reported; `MANUAL_RISK_CLEAR_REQUIRED`; financial increase blocked |
| `BOUNDARY_25_BPS_EXACT`                   | Divergence and Pyth confidence exactly 25 bps                                                 | `CORROBORATED`, `MEDIUM`, available                                            |
| `BOUNDARY_25_BPS_ONE_RATE_UNIT_OVER`      | Divergence and Pyth confidence 25 bps plus one `10^-8 USD` rate unit                          | `SOFT_DISAGREEMENT`, `LOW`, available                                          |
| `BOUNDARY_50_BPS_EXACT`                   | Divergence, Pyth confidence, and selected downside exactly 50 bps                             | `SOFT_DISAGREEMENT`, `LOW`, `NORMAL`, available                                |
| `DIVERGENCE_50_BPS_ONE_RATE_UNIT_OVER`    | Divergence 50 bps plus one rate unit                                                          | `CONFLICT`, numeric value null, frozen                                         |
| `CONFIDENCE_50_BPS_ONE_RATE_UNIT_OVER`    | Pyth confidence 50 bps plus one rate unit; Chainlink current at 50 bps plus one downside unit | Pyth ineligible; fallback `LOW`; `WATCH`                                       |
| `DOWNSIDE_200_BPS_ONE_RATE_UNIT_BELOW`    | Corroborated downside one rate unit below 200 bps                                             | `WATCH`, within policy                                                         |
| `DOWNSIDE_200_BPS_EXACT`                  | Corroborated downside exactly 200 bps                                                         | `DEPEGGED`, outside policy, latch required                                     |
| `DOWNSIDE_200_BPS_ONE_RATE_UNIT_OVER`     | Corroborated downside 200 bps plus one rate unit                                              | `DEPEGGED`, outside policy, latch required                                     |

## Stale, unavailable, and recovery behavior

A stale-only result has no financial valuation. A last-good value may be shown
only as separate display metadata labeled `STALE` with its original source
timestamp; it must never be returned or consumed as a current rate. New quotes,
new risk, and buying-power increases fail closed when valuation is unavailable.
An already settled asset movement is still journaled in exact asset units with
an unavailable valuation marker; any later valuation is an append-only
backfill that references the original snapshot, never a rewrite.

The pure evaluator signals that a depeg latch is required but does not itself
perform persistence or authentication. Migration `0019` and the companion
PostgreSQL repository now durably enforce append-only exact-asset latch/clear
events, sticky projections, unique identifiers and nonces, and one-use bounded
clear admission; that runtime boundary remains dormant. Recovery accepts a
closed latch reference containing the exact KAN-61 asset, a 64-character
lowercase hexadecimal opaque latch ID, and canonical `latchedAt`, plus a trusted
server `evaluatedAt`. A null latch means recovery is not applicable and cannot
carry a clear. Such a latch cannot clear automatically. Recovery requires all
of the following:

- the latch and every sample `evaluatedAt`, `pricedAt`, and `observedAt` are at
  or before the trusted recovery `evaluatedAt`;
- every sample `evaluatedAt`, `pricedAt`, and `observedAt` is at or after the
  asset-bound `latchedAt`, so pre-depeg evidence cannot clear a later latch;
- four distinct samples with strictly increasing evaluation times;
- a strictly increasing sequence and an update ID that is unique for each
  source across the entire recovery window;
- non-regressing source price and observation timestamps (equality is allowed
  only with the advancing sequence and unique update ID);
- both current sources on every observation;
- corroborated central prices within 25 bps;
- Pyth confidence at most 25 bps;
- each conservative rate within 25 bps below one dollar;
- at least 1,800 seconds from the earliest to the latest supplied qualifying
  sample (with at least four samples total);
- no watch, conflict, stale, or unavailable condition; and
- an explicit manual Risk clear with the exact KAN-61 asset, a distinct
  64-character lowercase hexadecimal clear ID, the matching latch ID, and canonical
  `clearedAt` at or after the final qualifying sample and at or before the
  trusted recovery `evaluatedAt`.

While any automated predicate fails, the asset remains `RECOVERY_PENDING`.
Once every automated predicate passes but no Risk clear exists, the result is
`MANUAL_RISK_CLEAR_REQUIRED`. A syntactically valid but mismatched, early, or
future clear is not accepted. A bound clear yields only the local
`RECOVERY_CANDIDATE_CLEARED` state and is echoed as the accepted reference; it
does not authorize financial use while the external gates remain pending.
KAN-66 does not grant or authenticate either event. The dormant `0019`
repository persists them and proves local uniqueness, but KAN-252 must still
require a cryptographically authenticated Risk approval and deployed evidence
before runtime use.

## Issuer redemption is context, not a price source

Circle, Tether, and Paxos publish one-dollar issuance or redemption claims and
reserve information for their respective stablecoins. Those mechanisms can
have account eligibility, identity-verification, minimum-size, fee,
availability, banking, jurisdiction, and settlement constraints. They are not
continuous executable market quotes and cannot justify assigning one dollar
to a token during a market depeg. This policy therefore caps observed upside
at one dollar but never floors downside at the nominal peg.

Issuer pages remain useful for asset-identity and redemption-risk review:

- [Circle transparency](https://www.circle.com/transparency) and
  [USDC terms](https://www.circle.com/legal/usdc-terms);
- [Tether supported protocols](https://tether.to/en/supported-protocols/) and
  [legal terms](https://tether.to/en/legal/); and
- [Paxos mint and redeem](https://www.paxos.com/mint-and-redeem) and
  [PYUSD documentation](https://docs.paxos.com/guides/stablecoin/pyusd/mainnet).

## Current commercial, terms, and operational evidence

The Pyth Core upgrade announcement dated May 26, 2026 says API access requires
a subscription, plans start at `500 USD/month`, the Starter tier supplies
one-second updates, and an API key is required. The announcement names a July
31 cutover while current Developer Hub banners name August 26, 2026 at 16:00
UTC. Neither the schedule nor the resulting endpoint behavior is operationally
approved; KAN-252 must resolve the documentation drift directly with current
binding terms. The published price is research, not an authorization or a cost
estimate. The exact current plan, feed coverage, allowance, overage, rate
limit, license, display/non-display, storage, derivative-data, redistribution,
SLA, support, tax, cancellation, Region, residency, retention, subprocessor,
and incident terms remain pending.

Chainlink documents Standard Data Feeds as an oracle-network resource, but a
read still requires an Ethereum RPC service and its terms, availability,
limits, and total cost. This packet makes no zero-cost production claim for
Chainlink and approves no KAN-62 provider or endpoint. Chainlink also assigns
the consumer responsibility for source quality, feed shutdown/deprecation,
circuit breakers, and stablecoin market-price behavior.

Provider documentation is not an SLA and is not live acceptance evidence. No
production hostname, exact contract address, API token, RPC URL, Region,
support plan, cost cap, or service commitment is recorded in the decision
because none is approved.

## Official source evidence reviewed on 2026-08-22

No URL below was used as a market-data endpoint. The review read static public
documentation only.

| Topic                         | Current official source                                                                                                                                                                                             | What it establishes                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Pyth product and update model | [Pyth Core overview](https://docs.pyth.network/price-feeds/core)                                                                                                                                                    | Aggregated first-party feeds, push/pull delivery, advertised 400 ms update model, broad chain coverage                       |
| Pyth exact symbols/IDs        | [Price feed IDs](https://docs.pyth.network/price-feeds/core/price-feeds/price-feed-ids)                                                                                                                             | Stable feed identifiers for USDC/USD, USDT/USD, and PYUSD/USD                                                                |
| Pyth transport/auth           | [Fetch price updates](https://docs.pyth.network/price-feeds/core/fetch-price-updates)                                                                                                                               | Hermes REST/stream/SDK access keyed by feed ID and bearer authentication                                                     |
| Pyth fields                   | [Hermes](https://docs.pyth.network/price-feeds/core/how-pyth-works/hermes)                                                                                                                                          | Integer price, `conf`, exponent, and `publish_time` response semantics                                                       |
| Pyth limits and fees          | [Rate limits](https://docs.pyth.network/price-feeds/core/rate-limits) and [current fees](https://docs.pyth.network/price-feeds/core/current-fees)                                                                   | Published public limit and separate onchain-update fees; neither proves an approved production plan                          |
| Pyth commercial model         | [Pyth Core upgrade](https://www.pyth.network/blog/the-pyth-core-upgrade)                                                                                                                                            | Subscription/API-key requirement and published starting price                                                                |
| Pyth legal/risk               | [Price-feed disclaimer](https://www.pyth.network/legal/disclaimer-for-pyth-network-price-feeds) and [terms](https://www.pyth.network/legal/terms-conditions)                                                        | As-is/availability risks and the need for exact production data-rights review                                                |
| Chainlink response            | [Using Data Feeds](https://docs.chain.link/data-feeds/using-data-feeds)                                                                                                                                             | Read-only `latestRoundData` price and `updatedAt`; no native confidence field                                                |
| Chainlink coverage            | [USDC/USD](https://data.chain.link/feeds/ethereum/mainnet/usdc-usd), [USDT/USD](https://data.chain.link/feeds/ethereum/mainnet/usdt-usd), and [PYUSD/USD](https://data.chain.link/feeds/ethereum/mainnet/pyusd-usd) | Ethereum mainnet feed catalog entries and documented deviation triggers                                                      |
| Chainlink model               | [Data Feeds overview](https://chain.link/data-feeds)                                                                                                                                                                | Aggregation across data providers and oracle nodes; not proof of no overlap with Pyth                                        |
| Chainlink consumer duties     | [Selecting Quality Data Feeds](https://docs.chain.link/data-feeds/selecting-data-feeds)                                                                                                                             | Consumer risk responsibility, shutdown behavior, circuit breakers, monitoring, and stablecoin ceiling/full-downside guidance |

## External gates

KAN-252 is the independent provider and valuation-policy approval gate. Before
any runtime or financial activation it must obtain and record:

- explicit Risk, Finance, Accounting, Legal, Security, Privacy, Architecture,
  Operations, and product decisions;
- exact provider products, account owners, plans, terms, monthly and burst cost
  caps, cancellation, and incident/support obligations;
- one tamper-evident approval record binding the exact merged Git commit and
  tree, the packet SHA-256, and the KAN-61 registry fingerprint; a branch or
  pre-merge hash is insufficient;
- exact Pyth hostnames, credential references, plan limits, feed IDs, and live
  timestamp/confidence evidence for all three assets;
- exact Chainlink proxy and aggregator addresses, decimals, heartbeat and
  lifecycle behavior, plus the approved KAN-62 RPC dependency;
- exact provider sequence semantics and independent confirmation that the
  locally implemented `0021` scoped update-ID uniqueness and predecessor
  checkpoints correctly bind sequence, `pricedAt`, `observedAt`, and update
  identity to authenticated provider evidence: Chainlink
  `roundId`/round timestamps and a collision-safe Pyth signed-update identity or
  cursor, because `publish_time` alone may repeat;
- measured 60-second freshness, latency, availability, throttling, and cost
  behavior in normal, stale, unavailable, fallback, conflict, depeg, and
  recovery exercises;
- durable exact-asset depeg-latch records, unique latch and clear IDs,
  authenticated manual Risk-clear records bound to the same latch, trusted
  server evaluation time, and atomic state-transition evidence;
- underlying provider/publisher/venue/cloud/network overlap and correlated
  failure analysis; and
- approved retention, residency, redaction, subprocessors, monitoring,
  incident, termination, and kill-switch evidence.

KAN-231 is a separate exact-host egress gate. It may approve only the exact API
and RPC destinations, caller, protocol, methods, environment, TLS/DNS controls,
and kill switch after KAN-252 selects them. It cannot approve a provider plan,
price semantics, Risk policy, or financial use. Neither ticket is currently
approved.

## Local verification

The validators are filesystem-only and make no provider, RPC, cloud, or Jira
request.

```powershell
npm run infra:validate:valuation
npm run infra:test:valuation
npm test --workspace @crypto-lending/api -- --runInBand src/valuation/domain/stablecoin-valuation-policy.spec.ts
npm test --workspace @crypto-lending/api -- --runInBand src/valuation/domain/stablecoin-price-evidence.spec.ts src/valuation/infrastructure/postgres/postgres-stablecoin-price-evidence.store.spec.ts src/infrastructure/database/migrations/0021-create-stablecoin-price-evidence-read-model.migration.spec.ts
# With the documented loopback PostgreSQL integration environment:
npm run test:integration --workspace @crypto-lending/api -- --runTestsByPath test/infrastructure/stablecoin-price-evidence.integration-spec.ts
npm run typecheck --workspace @crypto-lending/api
npm run format:check
npm run security:scan:secrets
git diff --check
```
