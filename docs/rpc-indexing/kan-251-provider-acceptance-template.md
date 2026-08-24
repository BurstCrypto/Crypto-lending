# KAN-251 provider authorization and validation record

> Status: `NOT_AUTHORIZED` / `NOT_RUN`
>
> This template does not authorize a provider account, trial, plan, payment
> method, credential, endpoint, DNS/TLS lookup, RPC request, deployment, egress,
> or spend. `NO_EXTERNAL_EGRESS` remains mandatory until KAN-231 separately
> approves exact destinations.

## Record and parent binding

| Field                                   | Value                                                              |
| --------------------------------------- | ------------------------------------------------------------------ |
| Record ID                               | `NOT_RUN`                                                          |
| KAN-62 merged commit/tree SHA           | `NOT_RUN`                                                          |
| KAN-62 decision path                    | `docs/rpc-indexing/kan-62-provider-decision.json`                  |
| Expected KAN-62 decision SHA-256        | `82876c3e7872f6b2fa604e931e8d226e7740c323fd9632605061f8092efb6924` |
| Observed KAN-62 decision SHA-256        | `NOT_RUN`                                                          |
| Adapter/configuration SHA-256           | `NOT_RUN`                                                          |
| Environment/account alias/Region        | `NOT_RUN`                                                          |
| Exercise start/end (UTC)                | `NOT_RUN` / `NOT_RUN`                                              |
| Decision                                | `NOT_RUN` (`ACCEPT`, `CONDITIONAL`, or `REJECT`)                   |
| Independent verifier / decided at (UTC) | `NOT_ASSIGNED` / `NOT_RUN`                                         |

## Independent approvals

| Role                            | Reviewer alias | Decision         | Approved at / expires at (UTC) | Evidence reference |
| ------------------------------- | -------------- | ---------------- | ------------------------------ | ------------------ |
| Architecture                    | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`          | `NOT_RUN`          |
| Security                        | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`          | `NOT_RUN`          |
| Privacy/Legal                   | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`          | `NOT_RUN`          |
| Availability/SRE                | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`          | `NOT_RUN`          |
| Finance                         | `NOT_ASSIGNED` | `NOT_RUN`        | `NOT_RUN` / `NOT_RUN`          | `NOT_RUN`          |
| KAN-231 exact-host egress       | `NOT_ASSIGNED` | `NOT_APPROVED`   | `NOT_RUN` / `NOT_RUN`          | `NOT_RUN`          |
| Non-production traffic/exercise | `NOT_ASSIGNED` | `NOT_AUTHORIZED` | `NOT_RUN` / `NOT_RUN`          | `NOT_RUN`          |

Reviewers must be independent of provider sales and implementation ownership.
Record conflicts, recusals, exceptions, and expiries explicitly.

## Commercial, legal, privacy, and operational selection

Complete separately for proposed primary Alchemy and fallback QuickNode.

| Field                                              | Alchemy          | QuickNode        |
| -------------------------------------------------- | ---------------- | ---------------- |
| Exact legal entity/contract/version                | `NOT_RUN`        | `NOT_RUN`        |
| Exact plan and approved features                   | `NOT_RUN`        | `NOT_RUN`        |
| Base price, quotas, unit rates, overages, taxes    | `NOT_RUN`        | `NOT_RUN`        |
| Monthly warning/stop/absolute ceiling              | `NOT_RUN`        | `NOT_RUN`        |
| Trial/account/payment authorization                | `NOT_AUTHORIZED` | `NOT_AUTHORIZED` |
| SLA/support/escalation/credits                     | `NOT_RUN`        | `NOT_RUN`        |
| DPA, subprocessors, residency/Regions              | `NOT_RUN`        | `NOT_RUN`        |
| Request/log/metadata retention and deletion        | `NOT_RUN`        | `NOT_RUN`        |
| Safe HTTPS/WSS endpoint/configuration aliases      | `NOT_RUN`        | `NOT_RUN`        |
| Controlled KAN-231 exact-host reference / SHA-256  | `NOT_RUN`        | `NOT_RUN`        |
| Credential reference/custodian/rotation/revocation | `NOT_RUN`        | `NOT_RUN`        |
| Availability/failure-domain evidence               | `NOT_RUN`        | `NOT_RUN`        |
| Termination, export, deletion, and cleanup terms   | `NOT_RUN`        | `NOT_RUN`        |

Record only safe endpoint aliases and credential references in this general
evidence packet. Exact hosts belong only in the access-controlled KAN-231
record. Each provider's KAN-251 row must reference that record and its SHA-256
so an authorized verifier can prove the alias maps to the approved host without
copying it here. Raw or credential-bearing endpoint URLs and secrets never
belong in this packet.

## Test-network matrix

Run every row against both providers only after authorization.

| Network          | Expected identity                                                | Alchemy result/evidence | QuickNode result/evidence |
| ---------------- | ---------------------------------------------------------------- | ----------------------- | ------------------------- |
| Ethereum Sepolia | `eth_chainId = 0xaa36a7`                                         | `NOT_RUN`               | `NOT_RUN`                 |
| Base Sepolia     | `eth_chainId = 0x14a34`                                          | `NOT_RUN`               | `NOT_RUN`                 |
| Arbitrum Sepolia | `eth_chainId = 0x66eee`                                          | `NOT_RUN`               | `NOT_RUN`                 |
| Solana Devnet    | Full genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` | `NOT_RUN`               | `NOT_RUN`                 |

For each provider/network record UTC interval, endpoint/config alias, controlled
KAN-231 exact-host record reference and digest, method-profile version, request
count, byte estimate, evidence SHA-256, observed cost, and cleanup/disposition.
Testnet results are not mainnet SLA or archive proof.

## Capability and boundary tests

| Test                                        | Required observation                                           | Alchemy   | QuickNode |
| ------------------------------------------- | -------------------------------------------------------------- | --------- | --------- |
| Exact chain identity before data acceptance | Mismatch fails closed                                          | `NOT_RUN` | `NOT_RUN` |
| Required standard HTTPS methods             | Every KAN-62 method supported with bounded response            | `NOT_RUN` | `NOT_RUN` |
| Required standard WSS subscriptions         | Connect, receive, disconnect, reconnect                        | `NOT_RUN` | `NOT_RUN` |
| WSS gap recovery                            | Stop advance; bounded HTTPS backfill; continuity before resume | `NOT_RUN` | `NOT_RUN` |
| Polling recovery                            | Idempotent reads recover without duplicate financial effect    | `NOT_RUN` | `NOT_RUN` |
| Archive boundary                            | Earliest successful/failed block or slot and exact error class | `NOT_RUN` | `NOT_RUN` |
| Rate limit / 429                            | Headers/status, bounded backoff/jitter, no unbounded retry     | `NOT_RUN` | `NOT_RUN` |
| Freshness/finality                          | Signals and thresholds match the reviewed per-chain policy     | `NOT_RUN` | `NOT_RUN` |
| Parent/hash continuity                      | Reorg/divergence stops advance and finds common ancestor       | `NOT_RUN` | `NOT_RUN` |
| Stale/unavailable behavior                  | No credit or irreversible state advance                        | `NOT_RUN` | `NOT_RUN` |
| Standard-only boundary                      | Vendor/add-on/debug/trace/write namespaces remain disabled     | `NOT_RUN` | `NOT_RUN` |
| Transaction safety                          | No send/sign/broadcast or automatic resubmission occurs        | `NOT_RUN` | `NOT_RUN` |
| Logging/redaction                           | Credentials, URLs, payloads, raw errors/signatures absent      | `NOT_RUN` | `NOT_RUN` |

## Cross-provider disagreement and failover

| Scenario                                     | Expected result                                                         | Evidence SHA-256 | Result    |
| -------------------------------------------- | ----------------------------------------------------------------------- | ---------------- | --------- |
| Same-network head skew inside approved bound | Mark provisional and reconcile by policy                                | `NOT_RUN`        | `NOT_RUN` |
| Identity mismatch                            | Reject provider response and stop financial advance                     | `NOT_RUN`        | `NOT_RUN` |
| Hash/parent divergence                       | Stop, retain both observations, find common ancestor                    | `NOT_RUN`        | `NOT_RUN` |
| Primary timeout/unavailable                  | Bounded idempotent reads only; fallback requires identity/parity checks | `NOT_RUN`        | `NOT_RUN` |
| WSS disconnect during failover               | Stop advance and complete HTTPS gap recovery first                      | `NOT_RUN`        | `NOT_RUN` |
| Fallback history unavailable                 | Fail closed; do not silently truncate requested range                   | `NOT_RUN`        | `NOT_RUN` |
| Primary restoration/failback                 | Reconcile continuity/finality before switch                             | `NOT_RUN`        | `NOT_RUN` |
| Ambiguous disagreement                       | Escalate; no credit, execution, or automatic resubmission               | `NOT_RUN`        | `NOT_RUN` |

## Performance, cost, findings, and cleanup

Record measured latency/throughput/error/rate-limit distributions per method,
network, transport, and provider using bounded aggregates. Do not place request,
wallet, transaction, endpoint, or credential identifiers in metric dimensions.

| Finding ID | Severity  | Safe description | Owner          | Due at (UTC) | Disposition | Retest hash/result    |
| ---------- | --------- | ---------------- | -------------- | ------------ | ----------- | --------------------- |
| `NOT_RUN`  | `NOT_RUN` | `NOT_RUN`        | `NOT_ASSIGNED` | `NOT_RUN`    | `NOT_RUN`   | `NOT_RUN` / `NOT_RUN` |

| Cleanup item                                                           | Owner          | Evidence/reference | Result    |
| ---------------------------------------------------------------------- | -------------- | ------------------ | --------- |
| Test traffic stopped and adapter kill switch verified                  | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |
| Provider credentials revoked/rotated                                   | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |
| Trial/account/plan/endpoints deleted or explicitly retained            | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |
| KAN-231 egress returned to approved disabled/baseline state            | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |
| Provider-side data deletion/retention disposition recorded             | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |
| Observed cost, unbilled/overage estimate, retained cost, final recheck | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN` |

Final acceptance requires current approvals, both-provider/eight-endpoint
coverage, no unresolved high/critical finding, fail-closed evidence, completed
cleanup/cost accounting, exact KAN-62 and controlled KAN-231 digest bindings,
and an independent decision. Nothing in this template approves production or
mainnet writes.
