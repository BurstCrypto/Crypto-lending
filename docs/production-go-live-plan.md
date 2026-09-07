# Production go-live critical path

Status date: **2026-09-06**

Status: **PLANNING — PUBLIC ACCESS AND MAINNET FINANCIAL ACTIONS ARE NOT
APPROVED**

The working objective is to reach a production go/no-go review in three weeks
without weakening the [mainnet safety boundary](mainnet-rollout.md). The dates in
this plan are coordination targets, not authorization. An open hard gate moves
the launch; it is never converted into an accepted risk merely because a date
arrives.

The bounded [offline production preflight](production-preflight.md) reports the
current repository blockers without reading secrets or contacting cloud or
provider systems. Its local checks supplement, but never replace, deployed
evidence and independent approval.

## Active release scope

The candidate production/mainnet scope is Ethereum and Solana only. Base and
BNB Smart Chain are explicitly deferred and cannot satisfy a launch count,
provider gate, chain gate, or fallback requirement. Historical Base and BNB
research remains useful evidence of what was reviewed at that time, but it is
not evidence for an Ethereum or Solana deployment.

The active planning directory contains exactly ten unavailable candidates: six
on Ethereum (Aave, Morpho, Compound, Spark, Euler, and Gearbox) and four on
Solana (Kamino, Save, Project 0 / marginfi v2, and Jupiter). This is a planning
scope, not a readiness claim. All ten remain unavailable until their exact
chain-specific evidence and every applicable gate pass.

## What "ten providers" means

In this plan, a **lending provider** is a distinct lending protocol/provider
identity. A provider deployed on two networks is counted once. Alchemy,
QuickNode, or another RPC/indexing vendor is infrastructure and does not count
toward the lending-provider total.

The four product states must be reported separately:

- **Cataloged** means a checked-in, point-in-time research capture exists. It
  makes no production request and cannot authorize an action.
- **Planned** means a provider identity appears in the production planning
  directory with no connected data or supported action. Planned does not imply
  that a dated research capture or deployment review exists.
- **Live read-only** means a production adapter reads an approved mainnet
  deployment through approved infrastructure and passes identity, freshness,
  divergence, and fail-closed checks.
- **Transaction-enabled** means an exact chain, deployment, market, asset, and
  action have passed the additional write gates and are exposed through a
  reviewed allowlist. A wallet connection or ownership signature does not
  qualify.

| Count                                                        | Current on 2026-09-06 |                                                Program target | Honest launch claim                                                                           |
| ------------------------------------------------------------ | --------------------: | ------------------------------------------------------------: | --------------------------------------------------------------------------------------------- |
| Distinct active-scope planned directory providers            |                    10 |                                                   At least 10 | Named Ethereum/Solana roadmap candidates; 0 available                                         |
| Active-scope providers with matching dated research captures |                    10 |                                                   At least 10 | Research input only; all ten have chain-matched static inputs, but none has live proof        |
| Distinct production live read-only providers                 |                     0 |  At least 10 after both active-chain decisions and every gate | Do not call a provider live until its adapter and exact deployment evidence pass              |
| Distinct production transaction-enabled providers            |                     0 | At least 10 as a later, separately approved program milestone | No write provider or action is selected; Base candidates are excluded from this release scope |

The ten-provider requirement is met only as an active-scope planning-directory
count. It is **not** met by chain-matched research, live reads, or user lending.
Retired local-harness fixtures and broader historical chain catalogs do not
establish the active launch count. Product copy, API fields, dashboards, and
release notes must not collapse these states into a single "providers
available" number.

## Implemented planning-directory slice

The repository exposes authenticated, GET-only
`GET /api/v1/mainnet-platforms` and the `/platforms` page. This slice publishes
ten planned Ethereum/Solana identities while stating **0 available now**. Every entry is
`PLANNED`, `NOT_CONNECTED`, `UNAVAILABLE`, `NOT_ASSESSED`, and has no supported
actions; the response also fixes `mayAuthorizeFinancialAction` to `false`.

This planning directory is deliberately separate from fixture snapshots, live
market data, portfolio readers, RPC connectivity, quotes, and transaction
modules. It makes the roadmap visible after sign-in but increments neither the
live read-only count nor the transaction-enabled count.

The sign-in gate controls the rendered experience and API response; it is not a
confidentiality boundary for provider names. The browser bundle intentionally
contains the exact non-secret provider allowlist so it can reject altered or
unexpected directory responses. No market, account, balance, endpoint,
credential, or transaction data is embedded in that allowlist.

## Researched provider set and rollout disposition

The table below separates the selected target chain from evidence already in
the repository. `Planned` and `cataloged` still mean **unavailable**; neither
state increments a live or transaction-enabled count.

|   # | Provider / protocol     | Active launch network | Evidence and read-only disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Transaction disposition |
| --: | ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
|   1 | Aave / Aave V3          | Ethereum              | A fixed, wallet-free Ethereum Core market adapter and unavailable-by-default deployment-evidence boundary now exist. The boundary defines a canonical finalized-block read plan, unregistered synthetic-tested 19-call executor, full-state two-source comparator, and bounded 1–64-block continuity verifier. Its dormant PostgreSQL workflow supports separate ACTIVE backfill and sticky-quarantine recovery operations with exact head/source/pair/nonce/expiry binding and append-only lineage/audit history. No real historical reader, approved source-pair registry, cryptographic authorization issuer/verifier, provider endpoint, credential, live exercise, or production approval exists                                                                                                                     | Not selected            |
|   2 | Morpho / Morpho Blue    | Ethereum              | A dormant finalized-block transcript adapter now validates a caller-pinned Morpho Blue deployment, exact market tuple and market ID, IRM/LLTV relationships, runtime-code hashes, raw market invariants, registry binding, and bounded freshness. It has no endpoint, approved market manifest, independent second source, live capability proof, risk approval, runtime registration, or write path                                                                                                                                                                                                                                                                                                                                                                                                                      | Not selected            |
|   3 | Compound / Compound III | Ethereum              | A dormant finalized-block transcript adapter now pins the official Ethereum USDC Comet proxy and validates implementation/admin/base-token relationships, code hashes, utilization, supply rate, pause state, totals, registry binding, and bounded freshness. It has no endpoint, independent second source, live capability proof, risk approval, runtime registration, or write path                                                                                                                                                                                                                                                                                                                                                                                                                                   | Not selected            |
|   4 | Spark / SparkLend       | Ethereum              | A dormant finalized-block transcript adapter now pins the reviewed SparkLend Ethereum USDC deployment and validates provider/pool/configurator/data-provider/token relationships, code hashes, reserve configuration, caps, pause state, supply rate, totals, registry binding, and bounded freshness. It has no endpoint, independent second source, live capability proof, risk approval, runtime registration, or write path                                                                                                                                                                                                                                                                                                                                                                                           | Not selected            |
|   5 | Euler / Euler V2        | Ethereum              | A dormant finalized-block transcript adapter now validates a caller-pinned Euler V2 vault and asset against the official factory/module identities, MetaProxy trailing-data binding, code hashes, governor/hooks/configuration/caps, totals, conversions, deposit limit, registry binding, and bounded freshness. No vault is approved, and no yield/liquidity proof, endpoint, independent second source, live capability proof, risk approval, runtime registration, or write path exists                                                                                                                                                                                                                                                                                                                               | Not selected            |
|   6 | Gearbox / Gearbox V3    | Ethereum              | A dormant finalized-block transcript adapter now pins the official direct V3 Ethereum USDC pool and validates AddressProvider/ContractsRegister membership, pool/token/version relationships, code hashes, liquidity, shares, supply rate, pause state, debt limit, registry binding, and bounded freshness. It has no endpoint, independent second source, live capability proof, risk approval, runtime registration, or write path                                                                                                                                                                                                                                                                                                                                                                                     | Not selected            |
|   7 | Kamino / Kamino Lend    | Solana                | A dormant finalized-slot transcript adapter now pins the official Kamino main program, main lending market, USDC reserve, native-USDC mint, source revisions, and exact account layouts. It validates one caller-bound snapshot, Program-to-ProgramData linkage and binary fingerprint, owners, reserve freshness and active state, mint state, block identity, genesis identity, and registry binding. It has no approved deployment manifest, reproducible bytecode proof, independent source, yield/capacity semantics, endpoint, live capability proof, risk approval, runtime registration, persistence path, or write path                                                                                                                                                                                          | Not selected            |
|   8 | Save / Save lending     | Solana                | A dormant finalized-slot transcript adapter now scopes Save's main-market native-USDC reserve. It pins the official Solend/Save program and market identities, while explicitly treating the reserve address discovered through Save's production configuration API as untrusted research evidence requiring corroboration. Its exact seven-call transcript validates Program/ProgramData linkage and hashes, market/reserve/mint layouts and ownership, reserve freshness, finalized block continuity, genesis identity, registry binding, and bounded time freshness. It exposes raw reserve integers only—not APR/APY, capacity, recommendation, or persistence. No approved deployment manifest, reproduced deployed binary, independent source, endpoint, risk approval, runtime registration, or write path exists. | Not selected            |
|   9 | Project 0 / marginfi v2 | Solana                | A dormant finalized-slot transcript adapter now scopes the documented Marginfi production-group native-USDC bank. It pins official program/group/bank/mint identities and rederived vault PDAs, then validates one exact eight-account snapshot covering Program/ProgramData, group, bank, mint, and three SPL vaults; exact hashes/layouts/owners; operational and oracle configuration; cached timestamp freshness; finalized block continuity; genesis identity; and registry binding. It exposes raw share, vault, limit, and cached-oracle fields only—not current external-oracle proof, APR/APY, capacity, recommendation, or persistence. No approved deployment manifest, reproduced deployed binary, independent source, endpoint, risk approval, runtime registration, or write path exists.                   | Not selected            |
|  10 | Jupiter / Jupiter Lend  | Solana                | A dormant finalized-slot transcript adapter now scopes the Jupiter Lend Earn native-USDC market. It pins the official docs and integration revisions, exact Lending IDL, captured read-SDK package, program identities, and rederived USDC-market PDAs. Its exact seven-call transcript validates Program/ProgramData linkage and binary identity, the 196-byte Lending account, USDC and jlUSDC mint state, finalized block continuity, genesis identity, registry binding, and bounded freshness. It exposes only the two stored raw exchange-price integers and raw mint supplies—not APR/APY, yield, liquidity, capacity, recommendation, or persistence. No approved deployment manifest, independent source, live code/authority proof, endpoint, risk approval, runtime registration, or write path exists.        | Not selected            |

The Compound, Euler, Gearbox, and Jupiter inputs are bound by
`docs/provider-research/active-scope-2026-09-04/ethereum-solana-missing-provider-captures.json`
and its SHA-256 sidecar. The offline validator keeps those records explicitly
dormant, unavailable, unapproved, and unable to authorize any read, egress, or
financial action.

Locally tested, dormant finalized-transcript adapters now exist for all ten
active-scope candidates: six on Ethereum and four on Solana. Their synthetic
suites and the exact-inventory validator close parser, protocol-shape, and
scope-drift work only; they do not convert research captures into approved
deployment evidence, add an endpoint, enable egress, satisfy independent-source
agreement, increment the live-provider count, or authorize a financial action.

Four account-scoped provider-position source artifacts now sit behind those
market-level transcript boundaries: Aave V3 Ethereum (`1538ec7`), Kamino Solana
(`1e70d80`), Compound III Ethereum (`7e10077`), and SparkLend Ethereum
(`d684428`). They are endpoint-free, direct-import-only, dormant, unregistered,
and depend on injected authenticated durable wallet/continuity context plus
bounded finalized transcripts. The Aave, Kamino, and Compound preflight pins
are committed in `ecff5b9`, `b41cc62`, and `91bd9bc`, taking the selected local
critical slice from its historical 38 artifacts to 41. Spark's focused source
specification, API typecheck, and targeted static/format checks pass; preflight
commit `2978367` pins source commit `d684428` and brings the slice to 42
artifacts. All 68 cases passed for that exact slice in a current focused rerun.
None of these sources adds a live endpoint,
credential, approved independent source pair, runtime activation, persistence
or financial-action authority, production approval, or live evidence.

The Aave deployment-evidence boundary is pinned to official address-book
v4.66.3, commit `12963110f29699d214531b9ab4c7cfcec460c298`, and Ethereum-module
SHA-256 `371c9a43983d32fad37559d83724695f8458f2888552041ba8a05001b666522d`.
Its closed plan requires source reads at one canonically bound finalized block;
the parser checks source-returned per-operation binding attestations, runtime
code presence, and observed Pool proxy/admin/AddressesProvider, DataProvider,
USDC, and USDT relationships, including an implementation pointer returned by
a simulated admin-context `eth_call`. A concrete transcript executor exists and
is synthetic-tested, but it is deliberately unregistered and has no provider
endpoint or credential; the runtime source remains unavailable and code hashes
remain unapproved. This is a local, read-only corroboration milestone, not live
evidence or approval. It cannot authorize a recommendation or any write. Aave
remains unavailable until approved primary and independent RPC sources,
runtime-code hashes, live exercise of the durable checkpoints, bounded
height-gap recovery, authorized quarantine recovery, and transcript-backed
independent-source proof pass the release-candidate gates.

Historical Base evidence for Aave, Morpho, Compound, Moonwell, and Euler is
retained but deferred. Moonwell is not an active launch candidate. Venus and
its BNB Smart Chain evidence are also deferred. None of those deferred
deployments can fill an Ethereum/Solana evidence gap or increment a launch
count. Aave and Morpho remain one provider identity each and cannot be
double-counted across historical networks.

## Three-week critical path

### Week 1 — decisions and release-scope freeze (September 2–8)

1. Name accountable Product, Engineering, Security, SRE, Finance, Privacy, and
   Legal owners. Record one decision owner for the go/no-go meeting.
2. Decide whether the candidate launch is authenticated read-only or includes
   any real-value action. The default remains read-only. Selecting a write
   release does not itself approve one.
3. Close or explicitly stop on the public-launch legal and regulatory gate,
   including launch entities, jurisdictions, geo-controls, customer due
   diligence, sanctions/AML, disclosures, support, and vendor/license terms.
4. Approve the exact Cognito tenant, public app client, callback/logout origins,
   MFA/recovery policy, key custody, rotation policy, and non-production test
   account plan.
5. Approve two independent RPC/indexing paths for both required launch
   networks, Ethereum and Solana. Record exact plans, quotas, regions,
   credential owners, spend alarms, and exact-host egress, then complete a
   network-specific acceptance record after authorized non-production testing.
   Base and BNB Smart Chain are deferred and their evidence cannot satisfy
   either active-chain gate.
6. Freeze all ten read candidates by exact chain, deployment or program,
   proxy/implementation identity where applicable, market, supported asset
   contract or mint, decimals, oracle, and pause/cap semantics. A catalog
   snapshot is input to review, not evidence that a deployment remains current.
7. Approve separate Ethereum and Solana product/network decision records,
   including chain-bound wallet ownership and registration flows. Do not treat
   one network's wallet/provider evidence as evidence for another, and do not
   use dormant Base support as an active-chain fallback.
8. Complete and independently review activation evidence packages for all ten
   candidates. The checked-in chain-matched research and dormant transcript
   adapters are inputs only; each exact deployment/program, market, asset,
   code or ProgramData identity, authority state, and operational policy must
   still receive release-bound approval before a provider can leave `PLANNED`.

**Week 1 exit:** signed scope and owner record; approved non-production identity,
per-network RPC and egress plans; immutable deployment review inputs for all ten
selected candidates; chain-bound wallet proof designs; no unresolved question
about whether the release is read-only.
Missing approval means the affected adapter cannot start. Count only the
Ethereum and Solana provider bundles that passed; do not satisfy or advertise
the ten-live-provider target with a Base or BNB bundle. If either active chain
remains unapproved, the ten-provider launch target moves. There is no Base-only
fallback milestone in this release plan.

### Week 2 — live read-only slice in non-production (September 9–15)

1. Provision only the approved non-production Cognito and provider resources,
   then enable only the exact approved egress destinations and browser policy.
2. Complete and activate the dormant read-only provider-position boundary.
   Keep wallet balances in the existing portfolio balance reader: its
   wallet/network/asset identity cannot distinguish two protocol positions in
   the same asset. The local position evidence and composition contracts retain
   provider, protocol, market, position, wallet, network, asset, source, and
   observation identity, but no persistence admission, approved policy binding,
   deployed pool-timeout binding, or production registration exists. A
   concrete Node deadline runner now exists
   as dormant source only: it propagates deadline cancellation, waits for
   started work to settle, and cleans up its timer and listener. The dormant coordinator sends
   one abort signal to every provider read and through the complete
   wallet-roster service/repository path into the cancellable PostgreSQL query,
   stops queued work on first failure, drains started cooperative reads, and
   closes the signal on every terminal path. The legacy unsigned portfolio
   roster path remains available. Because active `pg` pool acquisition cannot
   consume the signal, acquisition and teardown may extend past the logical
   deadline. A dormant runtime-budget resource now snapshots the exact API
   database/TLS configuration and full admission options, rejects database
   connection timeouts above the admission deadline, and constructs the lazy
   pool from that owned snapshot. A private dormant composition now passes that
   exact pool through the PostgreSQL wallet-roster chain and passes the
   resource's exact frozen options to coordinator construction. Its separate
   frozen null-prototype reader v3 accepts only account and correlation IDs,
   uses the captured `admitAndAssemble` method, and returns an exact frozen
   envelope with the server-authored parser time and covered-snapshot identity;
   callers cannot supply evaluation time or reach raw admission, verifier,
   lifecycle, persistence, or financial-action capabilities. Before result
   extraction it requires the exact module-private coordinator-issued assembly;
   clones fail and the identity reviewer is not feature-barrel exported.
   A concrete dormant trusted-chain-assessment assembler now exists behind an
   exact Ethereum/Solana-only durable-anchor reader port. It captures the
   reader methods once, verifies an unissued sentinel is rejected,
   reads every target sequentially including zero-position targets,
   authenticates each opaque result against the exact frozen request before
   inspection, and rejects capability or request clones. It validates anchor
   identity, non-regression, finality, and capture/evaluation/deadline bounds,
   recomputes observation fingerprints including `capturedAt`, and seals the
   resulting assessment and exact verification contexts by private object
   identity. A concrete PostgreSQL durable reader captures only the shared
   service's cancellable-query method, calls migration `0029`'s exact read with
   all 13 values and the unchanged admission signal, strictly reviews zero-or-one
   returned row, and binds accepted opaque assessments to exact request identity
   in a private `WeakMap`. Admission, observation, reader, and database layers all
   derive the same chain-global observation ID from the exact anchor. The dormant composition accepts no raw reader or
   trusted-assembly dependency; it constructs the PostgreSQL reader and assembler
   privately after its deadline runner and before its coordinator, and exposes
   neither object. Construction performs no ambient I/O.
   Migration `0029` now defines dormant append-only global Ethereum/Solana
   chain-anchor evidence and append-only invalidation/quarantine controls, with
   no account or wallet PII columns. Source observation IDs are exactly
   `ethereum-block-<exact anchor blockNumber>` or
   `solana-slot-<exact anchor slot>`, never arbitrary wallet/request IDs. The
   exact API runtime role alone receives the read function's runtime `EXECUTE`
   grant. That `SECURITY DEFINER` function requires an active chain-bound wallet, caps the
   evaluation-to-deadline span at 30 seconds, and rechecks the deadline,
   approval, current-head, and finality windows against database time after
   wallet and evidence locks. Record and control functions remain
   owner-controlled with no runtime grants, while the cumulative verifier
   preserves migration `0028`'s worker suspension. Migration `0030` now adds the
   ungranted original-deadline sidecar, reverse deferred evidence constraint,
   and owner-only guarded atomic-late-rollback/read-only-reconcile function
   described below. A dormant authority-free
   producer can now drain and authenticate an exact primary/corroborating source
   pair and issue only the migration's opaque 23-argument record candidate. Its
   agreed finalized heads alone do not prove the selected candidate anchor
   finalized. A pure direct-import-only finalizer now authenticates the exact
   producer capability and request before inspection and again immediately
   before issuing a display-only assessment. Ethereum candidates stay pending
   below the finalized height, quarantine an equal-height hash conflict, and
   require authenticated lineage when a higher finalized height covers the
   candidate. Solana compares the candidate slot with the finalized root, never
   merely the finalized slot, quarantines root regression, and makes no
   same-slot fork-detection claim. Server clock, abort/clock-regression checks,
   and exclusive producer, approval, and head-freshness deadlines fail closed;
   pending results never upgrade in place. All financial-action, persistence,
   and position-snapshot flags remain false. Even a locally classified
   `FINALIZED` result leaves the producer artifact `PROVISIONAL`, `DISPLAY_ONLY`,
   and `mayAuthorizeFinancialAction: false` until a separately reviewed and
   activated authority boundary exists. Its
   version-2 PostgreSQL recorder authenticates that producer capability before
   dispatch, prepares migration `0031`'s retained intent with the exact 23-value
   evidence payload and original deadline, claims one dispatch with a private
   32-byte token, and executes the migration `0030` guarded `RECORD` operation
   through `0031`. The database stores only domain-separated token digests. The
   recorder never automatically retries the record operation; an uncertain
   prepare, claim, execution, or mark result becomes an authenticated
   `RECONCILIATION_REQUIRED` result. The producer's 30-second bound is against
   its private `evaluatedAt`; the recorder correctly does not infer the bound
   from `deadlineAt - observedAt`. A separate dormant one-shot reconciliation
   processor leases at most one due `NEW`, `RECORD_DISPATCHED`, or `UNKNOWN`
   intent and calls only `RECONCILE_ONLY`, never a second `RECORD`. Both
   components zero their private raw tokens after use. The
   checked-in mainnet pair registry is empty and
   `NOT_APPROVED`, and no live chain-witness source or owner-authorized recorder
   workload, principal, credential, or grant exists. There is no populated
   evidence claim, runtime registration or activation, deployment, or live
   evidence. Construction
   performs no query or provider call, remains unregistered, and rolls back its
   owned pool if downstream construction fails. Close seals and aborts
   admission, drains PostgreSQL and admitted calls, then ends the pool; a
   non-cooperative provider can still delay physical drain indefinitely. This
   closes the local configuration-ordering gap only, not a deployed binding or
   hard end-to-end latency evidence.
   Migration `0030` locally enforces the producer deadline for calls through its
   guarded function and rolls its evidence plus deadline binding back atomically
   when the post-call database clock is late or regresses. Query rejection or
   connection interruption can still hide the physical commit acknowledgement.
   Migration `0031`, recorder V2, and the reconciliation processor now close the
   local durable one-shot intent and source-only unknown-outcome recovery gap.
   They do not claim physical commit acknowledgement or production activation:
   the processor has no timer or module registration, and neither component has
   an owner-authorized workload, principal, credential, database grant,
   deployment, or live evidence.
3. Run two independently reviewed read-adapter lanes in parallel: six Ethereum
   candidates (Aave, Morpho, Compound, Spark, Euler, and Gearbox) and four
   Solana candidates (Kamino, Save, Project 0, and Jupiter). Do not start or
   count a Base or BNB adapter. Keep per-provider and per-network kill switches;
   every unsupported network, stale result, identity mismatch, incomplete
   result, provider disagreement, and deployment drift must fail closed.
4. Record server-owned `observedAt`, `staleAfter`, block number/hash or Solana
   slot/root, source attribution, and provider status. Never reuse a fixture or
   planning-directory record as current production data.
5. Exercise Cognito registration, login, callback, secure cookies, logout,
   recovery, MFA, JWKS rotation, provider outage, and account/session revocation
   through the deployed HTTPS/ALB topology.
6. Exercise Ethereum and Solana wallet discovery, chain/network checks,
   challenge/proof registration, account changes, disconnects, account-scoped
   idempotent removal, stale pre-removal challenge rejection, fresh-proof
   re-registration, and stale-session recovery. No launch balance or position
   may be associated through a Base proof, even if dormant local Base support
   remains in the repository.
7. Exercise both approved RPC/indexing paths on every launch network for chain
   identity, freshness, archive boundary, rate limits, WSS gaps, HTTPS backfill,
   divergence, reorg, failover/failback, redaction, cost, and kill-switch
   behavior.
8. Observe the complete staging slice for at least 48 hours with spend,
   availability, stale-data, divergence, authentication-failure, and dependency
   alarms enabled. Resolve every critical/high finding and assign every lower
   finding an owner and reviewed disposition.

**Week 2 exit:** an authenticated staging user can see only current,
source-attributed, approved data for the network/provider pairs whose evidence
bundles passed; unavailable inputs remain visibly unavailable; no mainnet
transaction method or button is reachable. The ten-provider exit passes only
if all ten distinct provider bundles pass. Any smaller number must be reported
exactly and moves the ten-provider launch target.

### Week 3 — assurance, recovery, and go/no-go (September 16–22)

1. Freeze the candidate revision and generated artifacts. Run the complete
   local, integration, infrastructure, security, migration, and deployed smoke
   lanes below against that exact revision.
2. Exercise identity outage, both-RPC outage, provider divergence, stale data,
   deployment drift, database/queue/worker interruption, rollback, credential
   revocation, and per-provider/global kill switches. Bind sanitized evidence
   to the candidate revision.
3. Complete independent architecture, application-security, smart-contract,
   privacy/legal, regulatory, and SRE review. No implementer self-approves their
   own release gate.
4. Verify support coverage, incident commander/on-call ownership, customer
   messaging, status page, withdrawal/recovery escalation, evidence retention,
   and rollback authority.
5. No write candidate is selected. If and only if a real-value action is later
   separately approved, select one exact Ethereum or Solana
   provider/market/asset action, then evaluate it through fork/simulation and an
   allowlisted staff-wallet canary with zero-by-default limits. Do not reuse the
   deferred Base canary plan. Keep the public transaction UI absent until that
   canary and every write gate pass.
6. Hold a recorded go/no-go review no earlier than September 23. Re-run the
   blocker audit immediately before the decision. The exact clean release
   manifest, checked-in schema-v2 deployment target, and live-read evidence must
   first receive the two-role Ed25519 technical quorum; the separately signed
   seven-role public-launch decision must bind that verified technical bundle.
   Both authority registries and the deployment-target registry are empty
   today, so local tests cannot manufacture this evidence.

**Week 3 exit:** every applicable hard gate has a named, dated, unexpired
approval and revision-bound evidence. If write gates remain open, the release
can only be considered as read-only. If the public-access gate remains open,
there is no public launch at all.

## Per-provider evidence required for counting

A provider increments the live read-only count only when one evidence bundle
contains all of:

- canonical provider/protocol ID and an exact CAIP-2 network ID;
- deployment, proxy implementation, market, asset address or mint, decimals,
  oracle, pause/freeze, supply cap, and bytecode/program identity;
- approved primary and independent fallback RPC/indexing paths with observed
  chain identity and bounded freshness/finality behavior;
- a production adapter that cannot send, sign, broadcast, or invoke an
  unapproved method and that fails closed on stale, divergent, incomplete, or
  regressing evidence;
- source attribution, observation time, stale deadline, liquidity/utilization
  interpretation, risk classification, and user-facing availability language;
- provider-specific kill switch, outage/drift runbook, monitoring and spend
  alarms, integration tests, and an independent acceptance decision bound to
  the deployed revision.

A provider increments the transaction-enabled count only after the same bundle
also contains an approved action allowlist, exact transaction meaning and
calldata/program constraints, simulation, allowance policy, gas/fee reserve,
zero-default per-action/per-wallet/global limits, durable idempotent intent and
reconciliation state, finality/reorg handling, withdrawal/recovery testing,
staff canary evidence, independent smart-contract security review, and tested
pause/rollback controls.

The API production root is physically separate from the local harness root.
`NODE_ENV=production`, an absent runtime label, and every unrecognized label load
only `AppModule`; they neither import nor execute the synthetic local-demo and
Solana/EVM public-testnet module graph. Only exact `development` or `test`
runtimes dynamically import the isolated harness root, where its existing
loopback configuration gates still apply. The public portfolio route no longer
contains a flag-controlled demo branch, and the legacy Solana testnet SDK is a
development-only dependency. The checked-in OpenAPI artifact is generated from
the production root and tests reject every `/api/v1/local-demo` and
`/api/v1/public-testnet` path. This closes the repository route and startup-graph
gap; it does not approve a mainnet read or write path.

The zero-cost application-template validator rejects `NODE_OPTIONS` and
unreviewed `DD_TRACE*`, `NEW_RELIC*`, `ELASTIC_APM*`, or `OTEL*` bindings from
every API, web, and worker task environment or secrets block. The built API
artifact validator separately rejects a production artifact that can resolve or
that loads `@opentelemetry/instrumentation-pg`, `dd-trace`, `newrelic`, or
`elastic-apm-node`. These checks guard the database boundary from an unreviewed
preload/interception path; they do not add instrumentation, build or deploy an
image, call PostgreSQL or a provider, or supply live production evidence.

### Dormant balance-consumer deployment envelope

The release manifest and offline preflight now bind and locally inspect a
standalone balance-consumer CloudFormation envelope. It is deliberately outside
the application parent and checked-in deployment target: neither references or
composes it, and no task, service, or IAM role has been provisioned. Its
environment selector accepts only non-production names, and an actual
deployment requires the literal
`I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES` acknowledgement. This work
performed no deployment, cloud/provider request, or other external action and
incurred no cloud cost.

The source fixes `DesiredCount: 0`, while immutable source activation remains
false, `BALANCE_CONSUMER_MODE=disabled`, and the runtime remains uncomposed. It
attaches no database secret or grant, metadata key, RPC/provider input, Redis,
auth, or generic jobs-queue configuration. The security group has no ingress
and permits only loopback egress; public IP assignment and ECS Exec are
disabled. The task role is limited to receive/delete/change-visibility on the
exact balance source queue plus KMS decrypt only through SQS. It cannot access
jobs or the DLQ, send/publish, inspect queue attributes, read Secrets Manager,
use Redis/auth/provider authority, or reach an RPC. The execution role is
limited to pulling the same-account digest-pinned API image and writing the
dedicated encrypted log stream. The Fargate `1.4.0` task uses a non-root user,
a read-only root filesystem, dropped Linux capabilities, and only the
balance-consumer CLI.

Those are hardening properties of source for a dormant non-production envelope,
not deployed evidence or production readiness. Preflight must retain
`BALANCE_CONSUMER_TASK_NOT_PROVISIONED`,
`BALANCE_CONSUMER_IAM_NOT_PROVISIONED`, and
`BALANCE_CONSUMER_DEPLOYED_EVIDENCE_MISSING`. Source activation, runtime,
database, external-egress, RPC/provider, operations, authority, and every other
production blocker remain open.

The same offline inspection now pins the exact dormant Ethereum and Solana
deployment manifests and identity-verifier implementations. Both checked-in
manifests remain empty and `NOT_APPROVED`, and neither concrete verifier is
registered or composed into a runtime. Separately, one reviewed aggregate
SHA-256 binds the exact API build configuration, the one resolved local JSON
runtime input, and all 388 current lowercase TypeScript/TSX sources not excluded
by the pinned `*.spec.ts` / `*.e2e-spec.ts` build exclusions, including the
outbox-worker health CLI. The secure loader applies canonical-path, link,
hardlink-on-covered-input, covered-source duplicate, size/count/depth, repeated-
topology, double-read, and TOCTOU checks before it can mint a private point-in-
time attestation. Recognizable test-named module imports, unreviewed local JSON
imports, escaping local module paths, dynamic loaders, or concrete identity
references outside the four owned verifier/manifest files fail as defense in
depth. The existing byte-pinned artifact count remains 72. Any covered runtime
input change requires review and an aggregate-fingerprint rebaseline; this
cached source attestation is not permanent runtime or launch evidence. This
closes a local source-integrity gap only. Three activation blockers remain
machine-readable:
`BALANCE_CONSUMER_DEPLOYMENT_MANIFEST_FINGERPRINT_APPROVAL_MISSING` requires a
separately governed, release-bound approval;
`BALANCE_CONSUMER_SOLANA_EXACT_SLOT_RPC_CAPABILITY_EVIDENCE_MISSING` requires
no-cost validation that an approved provider can satisfy the verifier's
exact-slot `getMultipleAccounts` contract; and
`BALANCE_CONSUMER_SOLANA_PYUSD_TOKEN_2022_POLICY_EVIDENCE_MISSING` requires an
independently captured real PYUSD mint golden fixture, exact Token-2022 extension
inventory, and reviewed mutable-field window policy. None of that evidence is
fabricated or inferred by this source-only slice.

### Dormant provider-position record-intent boundary

Migration `0030` locally supersedes migration `0029`'s record verification. It
refuses installation over existing provider-position evidence while holding an
access-exclusive evidence-table lock. Its append-only, wallet-free sidecar
durably binds each evidence fingerprint to the original canonical producer
deadline, exact database `recorded_at`, fixed version/use and false
persistence/financial-authority fields, and a domain-separated SHA-256 digest.
A sidecar-to-evidence foreign key plus a reverse `DEFERRABLE INITIALLY DEFERRED`
foreign key means the legacy `0029` owner function cannot commit an unbound
evidence row.

The owner-only guarded function requires `READ COMMITTED` and serializes
`RECORD` and `RECONCILE_ONLY` with the same read-binding advisory transaction
lock. It resolves an exact existing evidence/deadline pair before writing and
samples canonical database time immediately after the lock. A first `RECORD`
calls the old writer only while timely and inserts the sidecar in the same
subtransaction; late or regressing post-call time rolls both writes back.
`RECONCILE_ONLY` takes the same lock but is read-only and never invokes the old
writer. It returns `IDEMPOTENT_REPLAY` only for exact evidence with its matching
original deadline binding, `NOT_RECORDED` for absence, and
`DEADLINE_VIOLATION` for a missing, invalid, mismatched, or late deadline
binding; conflicting evidence raises and fails closed.

Migration `0031` adds a retained, wallet-free record-intent table and an exact
prepare/claim/execute/mark/lease/reconcile lifecycle around migration `0030`.
Each canonical evidence fingerprint and producer deadline derive one intent;
the database permits at most one record dispatch, stores only domain-separated
SHA-256 dispatch and lease-token digests, restricts lifecycle transitions,
leases due unresolved intents with `SKIP LOCKED`, and requires terminal deadline
rows to bind back to their intent through deferred constraints. Direct legacy
`0029` writes still fail at commit. Installation refuses pre-existing evidence
or deadline history, and rollback refuses any evidence, control, deadline, or
intent history.

Recorder V2 prepares the durable intent before dispatch, claims one private
32-byte token, and performs at most one guarded record execution. It returns a
reviewable reconciliation-required result whenever database acknowledgement is
uncertain rather than resubmitting. The separate one-shot processor leases at
most one due unresolved intent and invokes only migration `0030`'s
`RECONCILE_ONLY` path; it never releases a lease or dispatches `RECORD`, and its
raw token is zeroed after use. The processor remains deliberately dormant and
unregistered, with no timer.

A separate direct-import-only lifecycle can drive that processor sequentially
only after an explicit `run` call. It rejects overlapping runs, authenticates
each processor result, enforces a reviewed 1-through-64 work-item limit and a
10-millisecond-through-30-second run deadline, propagates external abort through
one internal signal, and bounds retry deferrals to the remaining run window. Its
clock and timer are injected and cleaned up; import and construction start no
work. It has no provider, network, database, persistence, logging, or
financial-action port and remains absent from modules, barrels, controllers,
CLIs, and runtime composition.

A separate pure candidate-finality port and finalizer now form a dormant
display-only boundary after the authenticated producer. The finalizer uses an
injected server clock, re-authenticates exact producer capability/request
identity immediately before issuing its immutable null-prototype result, and
keeps all authority, persistence, and position-snapshot flags false. Ethereum
classification compares finalized height and hash and requires authenticated
lineage above the candidate height. Solana classification compares the candidate
slot only with the finalized root, quarantines root regression, and does not
claim same-slot fork detection. Exclusive validity/freshness deadlines, abort,
and clock regression fail closed, and pending assessments are never upgraded in
place. The finalizer has no database, network, environment, timer, provider,
module, barrel, controller, or runtime registration and cannot update the
underlying `PROVISIONAL`, `DISPLAY_ONLY` candidate.

These are local schema and source guarantees only. Migrations `0030` and `0031`
add no runtime grant, deployment, populated row, or live evidence. The mainnet
feature module now registers a lifecycle owner and narrow reader-v3 token, but
its source-authored Ethereum/Solana registry remains exactly empty,
`NOT_APPROVED`, and `DISABLED`. The frozen reader rejects without inspecting
the request and owns no provider, endpoint, credential, database, timer, writer,
or asynchronous work; no provider-position route or transaction capability is
exposed.

Physical commit acknowledgement still cannot be guaranteed across a rejected
query or broken connection, so production activation still requires reviewed
workload ownership, runtime scheduling, shutdown integration, logging/redaction,
deployment, and live recovery evidence. The local report must continue
to emit `PROVIDER_POSITION_RUNTIME_ACTIVATION_POLICY_NOT_APPROVED`,
`PROVIDER_POSITION_APPROVED_SOURCE_BINDINGS_MISSING`, and
`PROVIDER_POSITION_DEPLOYED_EVIDENCE_MISSING`; its
live-provider count, `liveReadEvidenceBound`, and `transactionEvidenceBound`
counts all remain zero.

The repository also contains a standalone, offline production deployment-intent
contract and validator. Its closed canonical envelope binds one of exactly five
operations, the exact account/Region/stack/change set, source and release,
deployment target, infrastructure/configuration/control digests, current and
proposed authority, rollback/kill state, and predecessor chain. Any future
operational intent requires distinct Ed25519 signatures from reviewed
deployment-owner and independent-security keys. The checked-in production key
registry and deployment-target registry are intentionally empty, the example is
unsigned and `PROVISION_INERT`, and no executor or runtime integration exists.
Every validation report remains non-executable. Kill/delete require exact zero
desired counts and no egress or writes; rollback cannot increase authority; no
operation can enable financial writes. A future executor must atomically consume
the validated predecessor because the offline validator provides only a
point-in-time expected-chain check. The release manifest binds the validator and
inert example, but this does not authorize or perform a deployment and does not
clear the infrastructure authority or deployed-evidence blockers.

## Hard launch gates

| Gate                      | Current blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Closed only when                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public/legal              | `docs/wallets/license-review/public-launch-legal-gate.md` says public access is not approved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Required legal, regulatory, privacy, OSS/vendor, jurisdiction, and product approvals are named, dated, unexpired, and bound to the shipped artifacts                                                                                                                                                                          |
| Production infrastructure | The exact non-production KAN-34 matrix remains unchanged. A separate exact-hash production contract is now locally branded `PRODUCTION_ENABLED`, but it is default-zero and inert: `Resources: {}`, only `ActivationMode: DISABLED`, zero desired counts and cost ceilings, no external egress, exact Ethereum/Solana mainnet identities, exact-version-only credential transitions, mandatory declared rollback/kill-switch states (not executable controls), an empty deployment-target registry, and no deployment authority. The empty resource map is a contract/envelope milestone, not a deployable application stack. The release-candidate manifest binds the exact contract file. Both targets remain blocked by `PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_AUTHORITY_MISSING` and `PRODUCTION_INFRASTRUCTURE_DEPLOYED_EVIDENCE_MISSING`; nothing was deployed or authorized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Introduce deployable resources and nonzero ceilings only through a separate reviewed source change, then bind independently approved billing, egress, credential transition, rollback, target authority, exact release, and deployed evidence.                                                                                |
| Authentication            | Migration `0025` and the application locally enforce bounded identity/session/CSRF HMAC overlap, provider/issuer/account-bound identity aliases, candidate-bound session/replay handling, and cross-version rate limiting. The zero-desired-count production task selects the pre-authentication key plus all six canonical authentication/wallet ring documents from one exact immutable Secrets Manager VersionId and forbids legacy or mutable-stage selectors. A dedicated two-role-signed offline guard now validates no-op adoption and one-purpose current-to-target transitions, and the deployment wrapper binds its verified report, signed predecessor, authority-registry digest, deployed chain head, task replacement, and service update. The production authority registry is intentionally empty; no authorized record, Cognito tenant, populated external ring secret, KMS custody, egress, live capture/drill, independent approval, deployed evidence, or production deployment exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Add reviewed production trust anchors and independently signed records; obtain deployed non-production Cognito, secret/KMS custody and exact-version field-read evidence, staged rotation, task replacement, old-function denial, recovery/outage, retained live captures, and independent-review evidence                    |
| Release authority         | The offline preflight verifies a clean release manifest, checked-in schema-v2 deployment target, a two-role signed technical read-evidence bundle, and a separately bound seven-role signed public-launch decision. The target's v2 hash covers its exact CloudFormation stack, RDS database/resource/managed-secret/application-key identities, and the other closed deployment identities. The technical-key, public-authority-key, and deployment-target registries are intentionally empty; no repository-local artifact can satisfy them today.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Approved trust anchors and target are reviewed source changes, every signature and freshness/binding check passes, and the external technical and public-launch authorities approve the exact release and target                                                                                                              |
| External egress           | KAN-231 remains `NO_EXTERNAL_EGRESS`. Code contains fixed, disabled Aave, DefiLlama, and LI.FI destinations, but production activation is rejected. The Aave request is wallet-free and fixed to Ethereum Core; LI.FI would receive linked Ethereum/Solana wallet addresses, assets, and exact amounts, so privacy, processor, retention, and query-log treatment are unresolved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Exact destinations, callers, disclosed fields, purpose/legal basis, processors, retention, ports, TLS/DNS behavior, spend/rate limits, approval expiry, activation manifest, and kill switches are approved and tested                                                                                                        |
| RPC/indexing              | KAN-251 is `NOT_AUTHORIZED` / `NOT_RUN`; Alchemy and QuickNode are proposals only. A dormant durable Aave finalized-checkpoint boundary now has locally tested bounded continuity backfill and quarantine-recovery contracts, but it has no approved RPC sources, real historical readers, source-pair registry, cryptographic authorization issuer/verifier, runtime registration, or live continuity/finality/recovery evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Two independent suppliers pass the complete authorized acceptance matrix and have approved commercial, privacy, reliability, and cost terms; durable checkpoints and independent-source live proof pass for the release candidate                                                                                             |
| Provider positions        | Dormant contracts preserve provider, protocol, market, position, position-kind, wallet, network, asset, source, and coverage identity. The coverage-aware reader v3 accepts only account and correlation IDs and returns an exact frozen envelope containing the server-authored parser time and exact covered-snapshot identity; callers cannot supply evaluation time or access raw admission, verifier, lifecycle, persistence, or financial-action capabilities. An empty set can mean zero only when every exact wallet × approved-market target is complete, agreeing, current, and declares zero positions. The private frozen null-prototype reader invokes only the composition's captured `admitAndAssemble` method. A concrete trusted-chain-assessment assembler authenticates each opaque result before inspection, rejects request and capability clones, reads every target sequentially, and privately seals exact request and verification-context identity. A concrete PostgreSQL durable-anchor reader captures only the shared cancellable-query method, sends migration `0029`'s exact 13 values with the unchanged signal, strictly reviews zero-or-one returned row, and seals accepted assessments to exact request identity in a private `WeakMap`; it exposes no writer or ordinary-query fallback. Migration `0029` provides append-only global Ethereum/Solana anchor evidence and invalidation/quarantine controls without account or wallet PII columns; only its active-chain-bound-wallet-gated API read has a runtime grant, while record/control operations remain owner-only. A concrete but unregistered Node deadline runner aborts the shared admission on bounded deadlines or failures, waits for started cooperative work to settle, and cleans up its timer/listener. The exact signal reaches both PostgreSQL anchor and wallet-roster reads while preserving the legacy unsigned wallet path; non-cancellable pool acquisition may still extend drain beyond the logical deadline. A dormant runtime-budget resource directly constructs a lazy API pool from owned immutable configuration only after proving `connectionTimeoutMs <= deadlineMilliseconds <= 30_000` and concurrency from 1 through 8. The dormant composition privately constructs the durable reader and assembler from that owned PostgreSQL service and accepts no raw trust dependency. A non-cooperative provider can still delay physical drain indefinitely. A dormant two-source producer and pure finalizer use exact producer pre/post authentication to classify Ethereum height/hash and Solana finalized root without claiming same-slot fork detection. Results are display-only with persistence, snapshot, and financial authority false. A lifecycle owner and its narrow reader-v3 token are registered in the mainnet module, but the source-authored Ethereum/Solana activation registry is empty, `NOT_APPROVED`, and `DISABLED`; reads reject without inspecting input or acquiring capabilities. Four local provider-target sources remain unregistered and unavailable. Migration `0031`, recorder V2, the one-shot processor, lifecycle, and finalizer remain unregistered and ungranted; no authorized workload, populated anchor evidence, deployed binding, or live evidence exists, and the live-provider, `liveReadEvidenceBound`, and `transactionEvidenceBound` counts are zero. Preflight now pins all 43 artifacts, including the inert registration; all 81 focused cases pass. It does not claim recursive dependency or whole-module-graph coverage. Conservative composition keeps liquid and supplied assets separate from borrow liabilities and preserves signed negative net positions. The local gate reports `PROVIDER_POSITION_RUNTIME_ACTIVATION_POLICY_NOT_APPROVED`, `PROVIDER_POSITION_APPROVED_SOURCE_BINDINGS_MISSING`, and `PROVIDER_POSITION_DEPLOYED_EVIDENCE_MISSING`; the registered reader remains intentionally inert, and the private composition, approved source bindings, and deployed live evidence are absent. No provider source or ingestion adapter is bound, and production activation policy, approved source bindings, and wallet-balance composition runtime remain disabled. | Reviewed policy and approval bindings, live provider adapters, wallet-balance composition, and duplicate-asset/provider isolation evidence all pass for the shipped revision                                                                                                                                                  |
| Chain-bound wallets       | Local production UI and HTTP handoffs now expose only separately bound Ethereum and Solana ownership proofs plus an account-scoped durable roster; Base mainnet fails closed. Account-scoped idempotent soft revocation is locally implemented, including rejection of pre-removal challenges and a fresh-proof requirement to re-add, but deployed HTTPS/provider evidence, lifecycle recovery, historical encryption-key rotation, privacy retention/DSAR validation, and independent review remain absent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Ethereum/Solana ownership, roster, revocation, and key-rotation flows plus privacy-retention/DSAR controls pass chain-bound challenge, account-change, disconnect, stale-session, deployed-browser, migration, recovery, and independent-review evidence                                                                      |
| Production reads          | The portfolio API binds read-only projections for exact active-wallet balance coverage and two-source stablecoin price evidence; both fail closed on missing, stale, divergent, malformed, or incomplete state. Locally, its loader accepts only the exact `APP_ENV` same-account source/DLQ; generic and unknown SQS variables fail closed. Its pinned receive/delete/change-visibility/parse port has no publish or caller `QueueUrl`; raw balance `SqsService` publish/batch/health is denied. The cumulative migration chain through `0032` preserves migration `0028`'s revocation of the generic worker's resolver and four checkpoint grants; `0029` gives no balance-consumer authority, and `0032` keeps its V2 agreement recorder schema-owner-only. Runtime/task/service, receive/delete IAM, dedicated database grants, RPC, and deployed evidence remain blocked. All ten planned providers have dormant synthetic finalized-transcript boundaries: six Ethereum and four Solana. They remain unregistered and unavailable; none has approved endpoints/source pairs, credentials, release-bound deployment manifests and code identities, provider-risk approval, live capability exercises, or production approval. Provider-position persistence admission, approved-opportunity, policy/consent, and full-cost runtime composition also remain unavailable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Every counted provider has a live provider-native adapter and evidence bundle; server-owned freshness deadlines are enforced; stale/divergent/incomplete data is unavailable rather than zero or current                                                                                                                      |
| Ten live providers        | Ten Ethereum/Solana identities are planned, cataloged, and represented by dormant synthetic transcript boundaries, but all remain unavailable. Zero have complete independent live evidence or production approval                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | All ten exact active-scope provider bundles pass on Ethereum or Solana; planned, cataloged, Base, and BNB entries do not count                                                                                                                                                                                                |
| Mainnet writes            | No mainnet transaction bounded context, route, intent store, manifest, or write approval exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Every additional write gate in `mainnet-rollout.md` and the per-provider transaction evidence above passes for an exact allowlisted action                                                                                                                                                                                    |
| Operations/security       | Eight queue, DLQ, application-failure, and Redis access-denial alarms route both `ALARM` and `OK` transitions to one operator-supplied, same-account/same-Region SNS topic. Redis metrics use the actual node-level member identities across failover. The dormant Redis operator user and one-off task share one exact stage-free secret VersionId captured with a singleton schema-v3 history; ordinary/A-B updates preserve it. A dedicated two-role-signed offline validator and deployment intent now constrain no-op Redis-chain adoption and one disabled-operator VersionId append while preserving the A/B and auth/wallet state and advancing the Redis/composite chains together. Its production authority registry is intentionally empty. Strict local template and invocation validators are green, while production preflight honestly remains blocked; nothing has been deployed or run. No real topic, confirmed subscriptions, escalation ownership, deployed dashboard, authorized/signed operator transition, external secret custody or staging, live candidate/old-credential proof, delivery proof, revocation drill, revision-bound exercise, or independent acceptance exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Threat model, observability, incident, rollback, recovery, provider drift/outage, finality/reorg, authorized externally custodied operator-key rotation, alarm-delivery, revocation, and canary evidence pass with no unresolved critical/high finding                                                                        |
| Dependencies              | The legacy public-testnet `@solana/web3.js` graph is development-only and absent from the production startup/web bundle. `npm audit --omit=dev` reports zero findings on 2026-09-04. CI produces candidate SPDX inventories for the API and web images and binds them into the release stage; retained SBOMs for the final registry artifacts, final-image scans, provenance, and independent dependency-risk acceptance remain absent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The exact immutable API and web images have retained SBOMs and provenance, pass the approved image scanner and policy, and receive a dated, expiring independent dependency-risk decision bound to the release and image digests; the API digest is reused by the distinct API, outbox-worker, and migration task definitions |

### RDS master credential gate

The application template delegates the stable `crypto_admin` master password to
RDS-managed Secrets Manager custody, encrypted with `ApplicationDataKey`. It
contains no custom master secret, `MasterUserPassword`, mutable-stage dynamic
reference, fixed-slot VersionId, or task injection. The existing
`DatabaseCredentialsSecretArn` output remains an ARN-only compatibility surface
only. Separate bootstrap IAM and KMS authorization is still required. RDS owns
the password and its default seven-day rotation; application and fixed-slot
updates neither pin nor roll it back, and operators must not mutate the managed
value through a generic Secrets Manager update. The managed secret's KMS key is
an adoption/recovery-time binding, not a routine rotation field. Stop on key
drift and route any key migration through a separately reviewed database/secret
recovery path.

This static contract is not launch evidence. Before go-live, an authorized
non-production exercise must bind the exact database and managed-secret ARN,
prove customer-key access and bootstrap-only IAM, drain master sessions, observe
a managed rotation, verify new authentication and old-password denial while
API/worker logins stay healthy, and restore a snapshot into the reviewed
recovery path. Because the managed secret follows the database lifecycle, the
restore exercise must rediscover and bind the restored secret rather than
assuming that the original compatibility output or credential survived.

The outer two-role-signed schema-v2 technical bundle covers a closed nested
schema-v1 `rdsMasterLifecycleEvidence` record with type
`RDS_MASTER_LIFECYCLE_EVIDENCE` and status `ACCEPTED` for that exercise. It
binds `crypto_admin` and the primary and restored database, managed-secret,
VersionId, compatibility-output, and KMS identities and requires exact `PASS`
results for bootstrap IAM/KMS, application and migration isolation, session
drain, rotation, new authentication, old-password denial, runtime continuity,
and restore/rebinding. The primary database ARN/resource ID, managed-secret ARN,
and application-key ARN must exactly match the target registry's closed `rds`
block; the signed v2 target hash also covers its CloudFormation stack ID.
Primary, rotated, and rebound secrets must be `active`, with distinct
`AWSPREVIOUS`/`AWSCURRENT` rotation versions and an `AWSCURRENT` rebound version.

The record's closed schema-v1 `supportingCapture` metadata commits to a
separately retained `RDS_MASTER_LIFECYCLE_CAPTURE` in
`SANITIZED_CANONICAL_JSON_V1` format through `captureSha256` and a bounded,
ordered collection/access/rotation/restore timeline. The bundle validator checks
the metadata, digest shape, statuses, stages, and timestamp order but does not
open the capture file. Both technical signing roles must independently calculate
and match its canonical digest before signing the outer bundle.

Repository/no-bundle, absent, forged, or unbranded
preflight input emits `RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING`; a malformed,
already stale, or counterfeit bundle is rejected during load/application as
sanitized `PRODUCTION_PREFLIGHT_EVIDENCE_BUNDLE_INVALID`, before any report.
Evaluation revalidates an exact branded input, so evidence that later becomes
stale restores the RDS blocker and can additionally produce
`PUBLIC_LAUNCH_AUTHORITY_DECISION_UNVERIFIED` when a launch decision is bound.
The schema and blockers do not perform the exercise or prove the cloud state;
no acceptable live record exists today. The separately controlled bundle may
carry only operational identifiers, never passwords, `SecretString`,
connections, or logs, and must never be committed to Git or Jira.

Updating an older deployed stack is not approved by this source change. The
master-username property can be replacement-sensitive even though the old
dynamic reference resolved to the same text, and removal of the former
`Retain`-policy secret can leave an orphaned billable secret while RDS creates
the managed replacement. The deployment guard rejects any database add, remove,
or possible replacement and any change to the legacy master-secret resource.
A separate migration must inventory the legacy secret; any eventual deletion
requires its own authorization after the managed credential and recovery
evidence pass.

Dependency audit update (2026-09-04): the retired demo/public-testnet modules
remain available to local regression tests but are no longer reachable from the
public portfolio route or imported by the API production root. Their legacy
Solana SDK is declared only as a development dependency. A fresh
`npm audit --omit=dev` reports zero vulnerabilities at every severity, and a
fresh optimized web build contains no `@solana/web3.js`, Jayson, `stream-json`,
or legacy `PublicKey` module signature. CI's candidate SPDX inventories do not
replace final-registry artifact retention, final-image scanning, signed
provenance, or the independent, release-bound dependency-risk decision required
by the table.

No waiver may change the meaning of `cataloged`, `live read-only`, or
`transaction-enabled`. A waiver for a required hard gate means **no-go** for the
affected launch mode.

### Wallet-revocation database rollout

Migration `0016` requires a coordinated application-and-database cutover. A
normal migrate-first rolling deployment is unsupported: the exact `0015`
readiness verifier correctly rejects the functions, triggers, indexes, and ACLs
introduced by `0016`, so an old API or worker task becomes unready as soon as
the migration commits. Do not leave old tasks serving or consuming work across
that boundary, and do not weaken either verifier to manufacture a mixed-version
readiness window.

Use this sequence:

1. Start the new API and worker revision as replacement capacity, but hold the
   API tasks out of every load-balancer target group and hold the worker tasks
   pending with queue polling and singleton/lease ownership disabled. They must
   not serve traffic or consume work before `0016` exists.
2. Quiesce the old worker and prepare one coordinated traffic switch. Apply
   `0016` with the migration principal and require the `0016` verifier to pass.
3. As one controlled cutover, register only the new API targets, transfer and
   enable worker ownership only for the new revision, and remove the old API
   targets. Drain and terminate the old API and worker tasks immediately; do
   not wait for their now-failing `0015` readiness checks to manage the switch.
4. Confirm every serving API replica uses guarded completion, every active
   worker runs the new revision, and exercise removal, stale-proof rejection,
   and fresh-proof re-registration through the deployed topology. Deploy the
   web removal control only after that evidence passes.

Migration `0016` intentionally retains the legacy completion function so its
database boundary remains fail-closed during the cutover, but that compatibility
does not make an old `0015` binary ready after migration. Application rollback
must use an explicitly `0016`-compatible artifact; do not reactivate an old
`0015` task. A later, independently reviewed contract migration may revoke
legacy completion after old tasks and incompatible rollback candidates have
drained. Do not roll `0016` down after any revoked wallet,
`WALLET_REVOKED` audit event, or revocation-rejected challenge exists; the
migration deliberately refuses that unsafe rollback.

### Aave-checkpoint database rollout

Migration `0017` extends the exact database-principal verifier from `0016` and
adds the append-only Aave finalized-checkpoint event/head boundary. Because the
`0016` verifier intentionally rejects the additional checkpoint functions and
grants, an `0016` application artifact becomes unready as soon as `0017`
commits. Treat this as another coordinated application-and-database cutover,
not a normal mixed-version rolling migration.

Use the same hold, quiesce, migrate, verify, switch, and drain sequence above,
substituting the `0017` verifier and an explicitly `0017`-compatible API/worker
artifact. Do not register the checkpoint writer during this cutover: it remains
dormant until two approved independent sources, live continuity/finality
evidence, bounded historical gap recovery, and authenticated quarantine
recovery are separately reviewed. Do not roll `0017` down after any checkpoint
event or head exists; its rollback deliberately refuses that unsafe operation.

### Cumulative `0018` through `0032` database rollout

Migrations `0018` through `0032` continue the exact, cumulative principal
verifier chain. They must ship as one coordinated maintenance-window cutover
with an application artifact that expects `0032`; they are not compatible with
a mixed fleet whose older tasks expect `0017` or any intermediate verifier.
The sequence adds, in order:

1. reviewed-only outbox admission (`0018`);
2. append-only stablecoin depeg latch state (`0019`);
3. append-only Ethereum/Solana balance observations, checkpoints, and portfolio
   projection (`0020`);
4. append-only Pyth/Chainlink price-evidence observations and watermarks
   (`0021`);
5. wallet identity-digest aliases and the database-owned key-version policy
   (`0022`);
6. the sealed, exact-wallet address resolver for the worker role (`0023`);
7. the dormant schema-owner-only wallet metadata rewrap and retirement-
   readiness boundary (`0024`);
8. authentication identity/session/CSRF key policies, aliases, candidate-aware
   entry points, and retirement-readiness controls (`0025`);
9. suspension of unapproved stablecoin-ingestion mutation authority (`0026`);
10. dormant owner-only mainnet balance-agreement evidence (`0027`);
11. suspension of generic-worker wallet-resolution and balance-checkpoint
    authority (`0028`);
12. dormant append-only global Ethereum/Solana provider-position chain-anchor
    evidence, invalidation/quarantine controls, and an API-only active-wallet-
    gated read (`0029`);
13. a dormant append-only original producer-deadline binding, reverse deferred
    evidence constraint, and owner-only atomic-late-rollback/read-only-reconcile
    function (`0030`);
14. retained one-shot provider-position record intents, constrained lifecycle
    transitions, hashed dispatch/reconciliation tokens, deferred terminal
    bindings, and owner-only prepare/claim/execute/mark/lease/reconcile
    functions (`0031`); and
15. a separate permanent append-only deployment-aware V2 balance-agreement evidence
    relation with owner-only validation and recording, while preserving the
    immutable V1 relation and functions byte-for-byte (`0032`). V2 admission
    rejects a fingerprint already committed in V1; because V1 remains
    untouched, this is not a bidirectional or global concurrent-serialization
    guarantee. V1 also remains fail-closed because its committed position-ID
    expression attempts PostgreSQL NUL text with `chr(0)`; `0032` repairs only
    the derived V2 expression with bytea `convert_to(...) || decode('00',
'hex')` separators, retains all 51 generated JSON string-type gates, and
    does not awaken or replace V1.

Use the same hold, quiesce, migrate, verify, switch, and drain pattern required
for `0016` and `0017`. Before the migration starts, take the approved backup and
record the exact release, database target, and migration checksums. Hold the new
API out of its target group and keep every old and new worker from polling.
Quiesce old API writes, apply all fifteen migrations with the migration principal,
then require repeated `0032` readiness checks through both API and worker
database credentials before serving traffic. Register only the new API and the
existing reviewed outbox publisher after those checks pass; drain all older
tasks immediately.

Recorder V2 is migration-`0031` compatible: it durably prepares an intent before
claiming one dispatch and calls the guarded record operation at most once.
Unknown or restarted work is recovered only by the separate one-shot
reconciliation processor through `RECONCILE_ONLY`, never a second `RECORD`. The
bounded lifecycle can sequence those one-shot calls with source-level deadline,
abort, work-limit, and cleanup controls, but it is not a runtime scheduler.
Do not grant, register, deploy, schedule, or invoke any of these dormant
components during this cutover; no owner-authorized runtime binding exists.
Neither `0030`, `0031`, `0032`, nor this rollout claims physical commit
acknowledgement.

The guarded disposable loopback PostgreSQL run on 2026-09-07 passed 11/11
mainnet balance-agreement cases and 6/6 related provider-position cases. It
proved local V1 rejection with zero rows, empty V1 relation/object preservation
through the upgrade, and genuine Ethereum and Solana V2 acceptance. This is
local-only integration evidence, not deployed or production-catalog evidence.
Migration `0032` now pins SHA-256 hashes of PostgreSQL 16's non-pretty
`pg_get_expr(conbin, conrelid, false)` output for exactly four V2 CHECK
expressions, retains its structural, ACL, and function checks, and fails closed
on CHECK-expression catalog drift or when `server_version_num` is outside the
PostgreSQL 16 range from `160000` through `169999`. The local database proof
changed and restored each CHECK while preserving every earlier marker
substring. Moving off PostgreSQL 16 requires a reviewed verifier change and
live-catalog revalidation; any deparser-output change, including within 16.x,
additionally requires a reviewed hash rebaseline. Verification against the
eventual live catalog remains a pre-grant blocker; this slice does not activate
the dormant capability or claim recursive historical-verifier closure.

This cutover does **not** activate an oracle writer, chain indexer, Aave
checkpoint writer, balance consumer, provider endpoint, or financial action.
Their adapters and durable stores remain dormant until their separate provider,
egress, custody, monitoring, and deployment gates pass. In particular, the
metadata-only consumer secret must never be replaced by the bundled API
authentication/wallet secret.

Treat rollback as a data-preservation decision, not a routine binary rollback.
Migration `0023` owns no data and can be revoked and dropped with `RESTRICT`
after the future balance consumer is quiesced. Migrations `0019`, `0020`, and
`0021` deliberately refuse rollback after their append-only stores have been
used. Migration `0022` refuses rollback after multi-version identity use, and a
metadata key still cannot be retired until the dormant `0024` rewrap workflow
has an approved operator and proves aggregate readiness. Migration `0024`
refuses rollback after a rewrap preparation or post-migration material
admission. Migration `0025` refuses rollback after aliases, non-initial policy,
or retained multi-version authentication state exists. Rolling back `0018`
restores direct API outbox-column access and is an explicit
security downgrade. Migration `0029` refuses rollback after any anchor-evidence
or control row exists. Migration `0030` additionally locks its evidence,
control, and deadline tables and refuses rollback after any of them has data.
Migration `0031` locks all four stores and refuses rollback after any evidence,
control, deadline, or intent row exists.
Migration `0032` preserves the V1 relation and refuses rollback after any
deployment-aware V2 evidence has been recorded; an unused rollback removes
only the separate V2 relation and functions.
Any schema rollback also requires an exactly compatible application artifact;
never force a down migration, delete retained history, or weaken a verifier to
make an old task appear ready.

## Exact verification lanes

### Active-scope provider inventory (offline only)

These validators prove the exact ten Ethereum/Solana planning identities,
matching dated research inputs, ten dormant adapter artifacts, and zero runtime
registrations. They do not prove current rates, live connectivity, risk
acceptance, deposits, or withdrawals.

```powershell
npm run infra:validate:providers
npm run infra:test:providers
```

The offline production preflight also runs the dormant-inventory validator as
an independent part of `RPC_INDEXING`. Inventory drift emits
`RPC_PROVIDER_DORMANT_INVENTORY_LOCAL_VALIDATION_FAILED`, separately from a
KAN-62 decision-record failure. It also validates the exact reviewed
four-provider Compound/Euler/Gearbox/Jupiter capture packet and compiled digest;
that separate failure is
`RPC_PROVIDER_ACTIVE_SCOPE_RESEARCH_CAPTURE_LOCAL_VALIDATION_FAILED`. Any of
these local failures blocks both launch targets. Passing all three preserves the
current zero-live-provider count and does not clear provider approval, runtime,
egress, deployment, or live-evidence blockers.

The authenticated planning-directory safety contract has its own focused
check:

```powershell
npm --workspace @crypto-lending/api run test -- mainnet-platforms
```

### Candidate revision lane

Run from a clean checkout of the exact release candidate with the lockfile
unchanged:

```powershell
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test
npm run test:e2e --workspace @crypto-lending/api
npm run openapi:generate
git diff --exit-code -- apps/api/openapi.json
npm run infra:validate
npm run security:audit
git diff --check
git status --short
```

The final `git status --short` must be empty. A passing validator proves only
that the checked-in record is internally consistent; it does not turn example,
`NOT_RUN`, or `NOT_APPROVED` evidence into approval.

Run the infrastructure integration lane against the same local dependencies and
migration sequence used by CI. The JSON assertion prevents Jest's successful
"all skipped" result from being mistaken for live infrastructure coverage:

```powershell
$GoLiveIntegrationReport = Join-Path ([System.IO.Path]::GetTempPath()) "crypto-lending-integration-$PID.json"
try {
  docker compose up --detach --build --wait --wait-timeout 120
  npm run db:migrate:compiled --workspace @crypto-lending/api
  npm run db:status:compiled --workspace @crypto-lending/api
  npm run db:rollback:compiled --workspace @crypto-lending/api
  npm run db:migrate:compiled --workspace @crypto-lending/api
  npm run db:status:compiled --workspace @crypto-lending/api
  $env:RUN_INFRASTRUCTURE_INTEGRATION = '1'
  npm run test:integration -- --json "--outputFile=$GoLiveIntegrationReport"
  if ($LASTEXITCODE -ne 0) { throw 'Infrastructure integration tests failed.' }
  $GoLiveIntegration = Get-Content -LiteralPath $GoLiveIntegrationReport -Raw | ConvertFrom-Json
  if ($GoLiveIntegration.numPendingTestSuites -ne 0 -or $GoLiveIntegration.numPendingTests -ne 0) {
    throw 'Infrastructure integration coverage was skipped.'
  }
} finally {
  Remove-Item Env:RUN_INFRASTRUCTURE_INTEGRATION -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $GoLiveIntegrationReport -ErrorAction SilentlyContinue
  docker compose down --volumes
}
```

Run the gate-specific validators separately in the evidence job so their logs
remain attributable:

```powershell
npm run security:scan:secrets
npm run security:validate:threat-model
npm run security:validate:logging-governance
npm run security:validate:wallet-review
npm run infra:validate:egress
npm run infra:validate:providers
npm run infra:validate:valuation
```

### Offline bootstrap blocker audit

Run the production preflight for the exact intended launch mode:

```powershell
npm run production:preflight
npx tsx scripts/production-go-live-preflight.ts --target mainnet-write
```

The dormant candidate-finality boundary implemented in `387a2dc` and pinned by
the production preflight in `7f7347a` passed all 64 focused cases in
`production-go-live-preflight.test.ts` across the then-current 38-artifact
provider-position production slice. Later preflight commits `ecff5b9`,
`b41cc62`, and `91bd9bc` pin the Aave, Kamino, and Compound account-position
sources and bring the committed slice to 41 artifacts. Spark source commit
`d684428` passed its focused specification, API typecheck, and targeted
static/format checks; preflight commit `2978367` pins it and brings the slice to
42 artifacts. All 68 cases passed for that exact slice in a current focused
rerun. Registration commit `7617800` adds the separately pinned inert runtime
owner and module wiring; the resulting 43-artifact slice passes all 81 focused
cases. The reviewed whole-API runtime snapshot now contains 389 files and
5,869,308 bytes with SHA-256
`a1479da28d229c2add6e07a9f4de88d74c6fceeac99e108bf558e47326ffe4c4`.
Six focused integration cases also passed
against a disposable local PostgreSQL 16 instance for the cumulative migration
verifier, both launch chains' intent preparation, one-shot and idempotent
execution, expired-intent reconciliation, dispatch-token rejection, and
deferred-constraint rollback. The finality checks cover exact producer
authentication order, Ethereum height/hash/lineage semantics, Solana
finalized-root semantics and root-regression quarantine, exclusive freshness,
server clock, exact identity, false authority flags, and the absence of a
same-slot-fork claim. They are local source/database evidence only and do not
satisfy any deployed, provider, mainnet, external-service, or approval gate.

These bootstrap commands must exit `1` today because they deliberately do not
ingest controlled production evidence. They identify local structure and named
blockers and cannot authorize a launch. The separate sanitized, revision-bound
technical-evidence bundle and seven-role public-launch authority gate are now
implemented and hostile-path tested, but their checked-in trust registries are
intentionally empty and no controlled evidence exists. Do not suppress the
current nonzero exit, reinterpret `local validation PASS` as approval, or use
the read-only result to authorize a mainnet write.

### Deployed non-production smoke lane

Set these values only to the exact approved HTTPS origins; do not place
credentials, tokens, wallet addresses, or provider URLs in shell history or
evidence output.

```powershell
$GoLiveApiOrigin = 'https://<approved-nonproduction-api-origin>'
$GoLiveWebOrigin = 'https://<approved-nonproduction-web-origin>'

(Invoke-WebRequest -UseBasicParsing -Uri "$GoLiveApiOrigin/api/v1/health").StatusCode
(Invoke-WebRequest -UseBasicParsing -Uri "$GoLiveApiOrigin/api/v1/health/dependencies").StatusCode
(Invoke-WebRequest -UseBasicParsing -Uri "$GoLiveApiOrigin/api/v1/version").StatusCode
(Invoke-WebRequest -UseBasicParsing -Uri $GoLiveWebOrigin).StatusCode
```

Every command must return `200`; dependency readiness must identify the exact
candidate revision and all required dependencies as ready. Then complete the
browser-based Cognito and authenticated portfolio cases because their secure
cookie and redirect behavior cannot be accepted from an unauthenticated health
probe. An unauthenticated `GET /api/v1/portfolio` must return `401`; an
authenticated request must return current, attributed approved data with the
exact wallet/network coverage manifest, including visibly partial or
unavailable targets when applicable, or the bounded `503` unavailable
response—never fixture data or an unlabeled partial result.

### Current blocker audit

The following read-only search is expected to find blockers today. Attach its
output to planning reviews; never interpret a successful command exit as a
passing launch gate.

```powershell
rg -n 'PUBLIC ACCESS IS NOT APPROVED|NOT_AUTHORIZED|NOT_APPROVED|NO_EXTERNAL_EGRESS' docs/wallets/license-review/public-launch-legal-gate.md docs/rpc-indexing/kan-251-provider-acceptance-template.md docs/KAN-231.md docs/rpc-indexing/kan-62-provider-decision.json
```

## Go/no-go decision rules

- **No-go for any public launch** while the public/legal, authentication,
  egress, RPC/indexing, production-read, or operations/security gate is open.
- **No-go for claims of ten live providers** until all ten exact Ethereum and
  Solana live read-only evidence bundles pass. Base and BNB provider bundles do
  not count toward this release.
- **No-go for any real-value action** while any write gate is open. Hide or
  remove transaction controls; do not ship a disabled-looking control wired to
  an executable route.
- **No-go on evidence drift:** a revision, dependency, provider deployment,
  contract/program, asset, oracle, endpoint, plan, policy, or approval-expiry
  change invalidates the affected evidence and requires review.
- **Go decisions are mode-specific:** read-only acceptance never authorizes a
  financial action, and one approved provider never authorizes another provider
  or chain. No approval in this plan activates Base.
