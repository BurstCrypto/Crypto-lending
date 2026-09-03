# Production go-live critical path

Status date: **2026-09-03**

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

| Count                                                        | Current on 2026-09-03 |                                                Program target | Honest launch claim                                                                           |
| ------------------------------------------------------------ | --------------------: | ------------------------------------------------------------: | --------------------------------------------------------------------------------------------- |
| Distinct active-scope planned directory providers            |                    10 |                                                   At least 10 | Named Ethereum/Solana roadmap candidates; 0 available                                         |
| Active-scope providers with matching dated research captures |                     6 |                                                   At least 10 | Research input only; four active-scope chain evidence packages are still missing              |
| Distinct production live read-only providers                 |                     0 |  At least 10 after both active-chain decisions and every gate | Do not call a provider live until its adapter and exact deployment evidence pass              |
| Distinct production transaction-enabled providers            |                     0 | At least 10 as a later, separately approved program milestone | No write provider or action is selected; Base candidates are excluded from this release scope |

The ten-provider requirement is met only as an active-scope planning-directory
count. It is **not** met by chain-matched research, live reads, or user lending.
The older local-demo catalog retains ten historical entries across several
chains; those entries do not establish the active launch count. Product copy,
API fields, dashboards, and release notes must not collapse these states into a
single "providers available" number.

## Implemented planning-directory slice

The current branch adds authenticated, GET-only
`GET /api/v1/mainnet-platforms` and the `/platforms` page. This slice publishes
ten planned Ethereum/Solana identities while stating **0 available now**. Every entry is
`PLANNED`, `NOT_CONNECTED`, `UNAVAILABLE`, `NOT_ASSESSED`, and has no supported
actions; the response also fixes `mayAuthorizeFinancialAction` to `false`.

This planning directory is deliberately separate from demo snapshots, live
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

|   # | Provider / protocol     | Active launch network | Evidence and read-only disposition                                                                                                                                                                                                       | Transaction disposition |
| --: | ----------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
|   1 | Aave / Aave V3          | Ethereum              | A fixed, wallet-free Ethereum Core corroboration adapter and strict USDC/USDT schema parser now exist; authenticated block freshness, exact deployment evidence, egress approval, risk approval, and production activation remain absent | Not selected            |
|   2 | Morpho / Morpho Blue    | Ethereum              | Existing research includes Ethereum, but the exact deployment and production adapter remain unapproved                                                                                                                                   | Not selected            |
|   3 | Compound / Compound III | Ethereum              | Planned only for this chain; the existing checked-in capture is Base-specific, so a dated Ethereum evidence package is required                                                                                                          | Not selected            |
|   4 | Spark / SparkLend       | Ethereum              | Existing Ethereum research is an input only; exact deployment and production adapter evidence remain unapproved                                                                                                                          | Not selected            |
|   5 | Euler / Euler V2        | Ethereum              | Planned only for this chain; the existing checked-in capture is Base-specific, so a dated Ethereum evidence package is required                                                                                                          | Not selected            |
|   6 | Gearbox / Gearbox V3    | Ethereum              | Planned only; the [official SDK setup](https://docs.gearbox.finance/developers/sdk-setup) is a research input, and a dated, reproducible Ethereum deployment evidence capture and independent review are required                        | Not selected            |
|   7 | Kamino / Kamino Lend    | Solana                | Existing Solana research is an input only; exact program/market and production adapter evidence remain unapproved                                                                                                                        | Not selected            |
|   8 | Save / Save lending     | Solana                | Existing research retains the legacy `SOLEND` protocol ID, and the Devnet executor is test-only; exact mainnet program/market evidence remains unapproved                                                                                | Not selected            |
|   9 | Project 0 / marginfi v2 | Solana                | Existing Solana research is an input only; exact program/market and production adapter evidence remain unapproved                                                                                                                        | Not selected            |
|  10 | Jupiter / Jupiter Lend  | Solana                | Planned only; [official overview](https://developers.jup.ag/docs/lend) and [program identities](https://developers.jup.ag/docs/lend/program-addresses) still require a dated capture and independent review                              | Not selected            |

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
8. Produce and independently review the missing chain-matched evidence packages
   for Compound, Euler, and Gearbox on Ethereum and Jupiter on Solana before
   those providers can leave `PLANNED`. Revalidate the existing evidence for
   the other six candidates against their exact active-chain deployments.

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
2. Add a dedicated read-only provider-market and position bounded context. Keep
   wallet balances in the existing portfolio balance reader: its wallet/network/
   asset identity cannot distinguish two protocol positions in the same asset.
   The new model must retain provider, protocol, market, position, wallet,
   network, asset, source, and observation identity before the reporting layer
   composes wallet balances and lending positions.
3. Run two independently reviewed read-adapter lanes in parallel: six Ethereum
   candidates (Aave, Morpho, Compound, Spark, Euler, and Gearbox) and four
   Solana candidates (Kamino, Save, Project 0, and Jupiter). Do not start or
   count a Base or BNB adapter. Keep per-provider and per-network kill switches;
   every unsupported network, stale result, identity mismatch, incomplete
   result, provider disagreement, and deployment drift must fail closed.
4. Record server-owned `observedAt`, `staleAfter`, block number/hash or Solana
   slot/root, source attribution, and provider status. Never reuse the static
   local-demo catalog as current production data.
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
   blocker audit immediately before the decision.

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

## Hard launch gates

| Gate                | Current blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Closed only when                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public/legal        | `docs/wallets/license-review/public-launch-legal-gate.md` says public access is not approved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Required legal, regulatory, privacy, OSS/vendor, jurisdiction, and product approvals are named, dated, unexpired, and bound to the shipped artifacts                                                                                                     |
| Authentication      | Cognito is selected but not provisioned or exercised; authentication remains deny-all without complete configuration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Deployed non-production Cognito evidence covers the full login/session/recovery/outage contract and production secrets/configuration have approved custody and rotation                                                                                  |
| External egress     | KAN-231 remains `NO_EXTERNAL_EGRESS`. Code contains fixed, disabled Aave, DefiLlama, and LI.FI destinations, but production activation is rejected. The Aave request is wallet-free and fixed to Ethereum Core; LI.FI would receive linked Ethereum/Solana wallet addresses, assets, and exact amounts, so privacy, processor, retention, and query-log treatment are unresolved.                                                                                                                                                                                                                                  | Exact destinations, callers, disclosed fields, purpose/legal basis, processors, retention, ports, TLS/DNS behavior, spend/rate limits, approval expiry, activation manifest, and kill switches are approved and tested                                   |
| RPC/indexing        | KAN-251 is `NOT_AUTHORIZED` / `NOT_RUN`; Alchemy and QuickNode are proposals only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Two independent suppliers pass the complete authorized acceptance matrix and have approved commercial, privacy, reliability, and cost terms                                                                                                              |
| Provider positions  | The versioned observation contract now preserves provider, market, position, position-kind, wallet, network, and asset identity, but production policy/approval bindings, live adapters, and composition with wallet balances are not implemented or evidenced                                                                                                                                                                                                                                                                                                                                                     | Reviewed policy and approval bindings, live provider adapters, wallet-balance composition, and duplicate-asset/provider isolation evidence all pass for the shipped revision                                                                             |
| Chain-bound wallets | Local production UI and HTTP handoffs now expose only separately bound Ethereum and Solana ownership proofs plus an account-scoped durable roster; Base mainnet fails closed. Account-scoped idempotent soft revocation is locally implemented, including rejection of pre-removal challenges and a fresh-proof requirement to re-add, but deployed HTTPS/provider evidence, lifecycle recovery, historical encryption-key rotation, privacy retention/DSAR validation, and independent review remain absent                                                                                                       | Ethereum/Solana ownership, roster, revocation, and key-rotation flows plus privacy-retention/DSAR controls pass chain-bound challenge, account-change, disconnect, stale-session, deployed-browser, migration, recovery, and independent-review evidence |
| Production reads    | The server now requires an exact active wallet/network coverage manifest and cannot turn unread targets into complete zero. Disabled-by-default aggregate-market, wallet-free Aave Ethereum Core, and read-only Ethereum/Solana round-trip quote adapters are implemented, but none is an approved production feed or can establish provider eligibility. A strict allocation-input composer is wired to unavailable defaults; production wallet-balance/valuation, approved-opportunity, policy/consent, full-cost, authenticated chain-freshness, and the other nine provider-native readers remain unavailable. | Every counted provider has a live provider-native adapter and evidence bundle; server-owned freshness deadlines are enforced; stale/divergent/incomplete data is unavailable rather than zero or current                                                 |
| Ten live providers  | Ten Ethereum/Solana identities are planned and unavailable; six have matching-chain historical research inputs, four require new matching-chain captures, and zero have live evidence                                                                                                                                                                                                                                                                                                                                                                                                                              | All ten exact active-scope provider bundles pass on Ethereum or Solana; planned, cataloged, Base, and BNB entries do not count                                                                                                                           |
| Mainnet writes      | No mainnet transaction bounded context, route, intent store, manifest, or write approval exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Every additional write gate in `mainnet-rollout.md` and the per-provider transaction evidence above passes for an exact allowlisted action                                                                                                               |
| Operations/security | No deployed revision-bound production exercise or independent acceptance is recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Threat model, observability, incident, rollback, recovery, provider drift/outage, finality/reorg, key/credential, and canary evidence pass with no unresolved critical/high finding                                                                      |
| Dependencies        | Compatible `qs` and `fast-uri` fixes are applied; the audit's three remaining moderate package findings trace to the transitive `uuid` advisory under `@solana/web3.js`/Jayson. Installed Jayson calls UUID v4, while the advisory names v3/v5/v6 buffer paths, but the residual risk is not independently accepted                                                                                                                                                                                                                                                                                                | A compatible upstream remediation is pinned and verified, or Security records a dated, expiring disposition tied to exact dependency versions and observed call paths; do not use npm's forced Solana SDK downgrade                                      |

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

## Exact verification lanes

### Research-catalog count (offline only)

This test proves ten distinct static catalog identities and their permanently
non-executable policy. It does not prove current rates, live connectivity, risk
acceptance, deposits, or withdrawals.

That historical catalog includes deferred Base and BNB entries, so its count
cannot satisfy the active Ethereum/Solana provider target. The separate
planning-directory check below proves only that the exact ten active-scope
identities remain named and unavailable.

```powershell
npm --workspace @crypto-lending/api run test -- local-demo/local-demo-yield-catalog.service.spec.ts
```

The planning-directory safety contract has its own focused check:

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

These bootstrap commands must exit `1` today because they deliberately do not
ingest controlled production evidence. They identify local structure and named
blockers; they cannot become the final go/no-go gate or authorize a launch. A
separate sanitized, revision-bound evidence-ingestion boundary and final release
gate must be designed, reviewed, and implemented before a go decision. Do not
suppress the current nonzero exit, reinterpret `local validation PASS` as
approval, or use the read-only result to authorize a mainnet write.

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
