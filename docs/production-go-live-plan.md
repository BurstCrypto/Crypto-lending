# Production go-live critical path

Status date: **2026-09-02**

Status: **PLANNING — PUBLIC ACCESS AND MAINNET FINANCIAL ACTIONS ARE NOT
APPROVED**

The working objective is to reach a production go/no-go review in three weeks
without weakening the [Base mainnet boundary](mainnet-rollout.md). The dates in
this plan are coordination targets, not authorization. An open hard gate moves
the launch; it is never converted into an accepted risk merely because a date
arrives.

The bounded [offline production preflight](production-preflight.md) reports the
current repository blockers without reading secrets or contacting cloud or
provider systems. Its local checks supplement, but never replace, deployed
evidence and independent approval.

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

| Count                                             | Current on 2026-09-02 |                                                Program target | Honest launch claim                                                                                              |
| ------------------------------------------------- | --------------------: | ------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------- |
| Distinct cataloged lending providers              |                    10 |                                                   At least 10 | Research candidates only                                                                                         |
| Distinct planned directory providers              |                    11 |                                                   At least 10 | Named roadmap candidates; 0 available                                                                            |
| Distinct production live read-only providers      |                     0 |               At least 10 after every required chain decision | Do not call a provider live until its adapter and deployment evidence pass                                       |
| Distinct production transaction-enabled providers |                     0 | At least 10 as a later, separately approved program milestone | Initial Base release remains zero by default; at most one first Base provider can advance after every write gate |

The ten-provider requirement is therefore already met only at the research
catalog and planning-directory levels. It is **not** met for live reads or user
lending. Product copy, API fields, dashboards, and release notes must not
collapse these counts into a single "providers available" number.

## Implemented planning-directory slice

The current branch adds authenticated, GET-only
`GET /api/v1/mainnet-platforms` and the `/platforms` page. This slice publishes
eleven planned identities while stating **0 available now**. Every entry is
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

Rows 1-10 are currently `CATALOGED_ONLY`, with financial authorization set to
false in the local-demo snapshots. Row 11 is a planning candidate supported by
current official documentation but does not count as cataloged until a dated,
reproducible evidence capture is checked in and reviewed.

|   # | Provider / protocol     | Researched mainnet network(s) | Read-only rollout disposition                                                                                                                                                                                                 | Transaction rollout disposition               |
| --: | ----------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
|   1 | Aave / Aave V3          | Base, Ethereum                | Base-first candidate                                                                                                                                                                                                          | First Base write candidate only; not approved |
|   2 | Morpho / Morpho Blue    | Base, Ethereum                | Base-first candidate                                                                                                                                                                                                          | Not selected                                  |
|   3 | Compound / Compound III | Base                          | Base-first candidate                                                                                                                                                                                                          | Not selected                                  |
|   4 | Moonwell / Moonwell V2  | Base                          | Base-first candidate                                                                                                                                                                                                          | Not selected                                  |
|   5 | Euler / Euler V2        | Base                          | Base-first candidate                                                                                                                                                                                                          | Not selected                                  |
|   6 | Spark / SparkLend       | Ethereum                      | Requires a separate Ethereum product/network decision                                                                                                                                                                         | Not selected                                  |
|   7 | Venus / Venus Core Pool | BNB Smart Chain               | Requires a separate BNB Smart Chain product/network decision                                                                                                                                                                  | Not selected                                  |
|   8 | Kamino / Kamino Lend    | Solana                        | Requires a separate Solana mainnet product/network decision                                                                                                                                                                   | Not selected                                  |
|   9 | Save / Save lending     | Solana                        | Requires a separate Solana mainnet product/network decision; the research capture retains the legacy `SOLEND` protocol ID, and the existing Devnet executor is test-only                                                      | Not selected                                  |
|  10 | Project 0 / marginfi v2 | Solana                        | Requires a separate Solana mainnet product/network decision                                                                                                                                                                   | Not selected                                  |
|  11 | Jupiter / Jupiter Lend  | Solana                        | Planned read-only candidate; [official overview](https://developers.jup.ag/docs/lend) and [program identities](https://developers.jup.ag/docs/lend/program-addresses) require a dated evidence capture and independent review | Not selected                                  |

Only five distinct researched providers have a Base deployment in the current
catalog. The shortest ten-provider live-read path is those five Base providers,
Spark on Ethereum, and Kamino, Save, Project 0, and Jupiter on Solana. Venus
remains an eleventh planned fallback because BNB Smart Chain is absent from the
current production chain and asset registry. Aave and Morpho appearing on both
Base and Ethereum must not be double-counted.

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
5. If ten live read-only providers remains the launch requirement, approve two
   independent RPC/indexing paths for every required network: Base, Ethereum,
   and Solana. Record exact plans, quotas, regions, credential owners, spend
   alarms, and exact-host egress, then complete a network-specific acceptance
   record after authorized non-production testing. BNB Smart Chain requires an
   additional decision and registry revision before Venus can enter this path.
6. Freeze all ten read candidates by exact chain, deployment or program,
   proxy/implementation identity where applicable, market, supported asset
   contract or mint, decimals, oracle, and pause/cap semantics. A catalog
   snapshot is input to review, not evidence that a deployment remains current.
7. Approve separate Ethereum and Solana product/network decisions, including
   chain-bound wallet ownership and registration flows. A Base ownership proof
   is not an Ethereum or Solana ownership proof. Do not import another network
   through a Base configuration switch or treat one network's wallet/provider
   evidence as evidence for another.
8. Produce and independently review a dated Jupiter evidence capture before it
   can leave `PLANNED`; keep Venus unavailable unless a reviewed registry
   version adds BNB Smart Chain and its exact supported asset identities.

**Week 1 exit:** signed scope and owner record; approved non-production identity,
per-network RPC and egress plans; immutable deployment review inputs for all ten
selected candidates; chain-bound wallet proof designs; no unresolved question
about whether the release is read-only.
Missing approval means the affected adapter cannot start. If a required
non-Base decision remains open, count only the provider bundles that passed and
do not satisfy or advertise the ten-live-provider target. If both Ethereum and
Solana decisions remain open, the September review becomes a Base-only,
at-most-five-provider milestone.

### Week 2 — live read-only slice in non-production (September 9–15)

1. Provision only the approved non-production Cognito and provider resources,
   then enable only the exact approved egress destinations and browser policy.
2. Add a dedicated read-only provider-market and position bounded context. Keep
   wallet balances in the existing portfolio balance reader: its wallet/network/
   asset identity cannot distinguish two protocol positions in the same asset.
   The new model must retain provider, protocol, market, position, wallet,
   network, asset, source, and observation identity before the reporting layer
   composes wallet balances and lending positions.
3. Run three independently reviewed read-adapter lanes in parallel: the five
   Base candidates (Aave, Morpho, Compound, Moonwell, and Euler), the incremental
   Ethereum candidate (Spark), and the four Solana candidates (Kamino, Save,
   Project 0, and Jupiter). Aave and Morpho may also expose separately approved
   Ethereum observations, but each still counts as one distinct provider. Keep
   per-provider and per-network kill switches; every unsupported network, stale
   result, identity mismatch, incomplete result, provider disagreement, and
   deployment drift must fail closed.
4. Record server-owned `observedAt`, `staleAfter`, block number/hash or Solana
   slot/root, source attribution, and provider status. Never reuse the static
   local-demo catalog as current production data.
5. Exercise Cognito registration, login, callback, secure cookies, logout,
   recovery, MFA, JWKS rotation, provider outage, and account/session revocation
   through the deployed HTTPS/ALB topology.
6. Exercise Ethereum and Solana wallet discovery, chain/network checks,
   challenge/proof registration, account changes, disconnects, and stale-session
   recovery. No balance or position may be associated through a Base-only proof.
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
5. If and only if a real-value action was separately approved, evaluate one
   exact Aave V3 Base market/asset action through fork/simulation and an
   allowlisted staff-wallet canary with zero-by-default limits. Keep the public
   transaction UI absent until that canary and every write gate pass.
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

| Gate                | Current blocker                                                                                                                                                                                                                                                                                                     | Closed only when                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public/legal        | `docs/wallets/license-review/public-launch-legal-gate.md` says public access is not approved                                                                                                                                                                                                                        | Required legal, regulatory, privacy, OSS/vendor, jurisdiction, and product approvals are named, dated, unexpired, and bound to the shipped artifacts                                                                |
| Authentication      | Cognito is selected but not provisioned or exercised; authentication remains deny-all without complete configuration                                                                                                                                                                                                | Deployed non-production Cognito evidence covers the full login/session/recovery/outage contract and production secrets/configuration have approved custody and rotation                                             |
| External egress     | KAN-231 remains `NO_EXTERNAL_EGRESS`                                                                                                                                                                                                                                                                                | Exact destinations, callers, ports, TLS/DNS behavior, spend limits, approval expiry, and kill switch are approved and tested                                                                                        |
| RPC/indexing        | KAN-251 is `NOT_AUTHORIZED` / `NOT_RUN`; Alchemy and QuickNode are proposals only                                                                                                                                                                                                                                   | Two independent suppliers pass the complete authorized acceptance matrix and have approved commercial, privacy, reliability, and cost terms                                                                         |
| Provider positions  | A versioned provider/market/position observation contract and reader port now exist, but production policy and approval bindings, live adapters, and composition with wallet balances are not implemented or evidenced                                                                                              | Reviewed policy and approval bindings, live provider adapters, wallet-balance composition, and duplicate-asset/provider isolation evidence all pass for the shipped revision                                        |
| Chain-bound wallets | Production ownership UI is Base-only                                                                                                                                                                                                                                                                                | Ethereum and Solana ownership/registration flows pass chain-bound challenge, account-change, disconnect, and stale-session evidence                                                                                 |
| Production reads    | Production wallet-balance readers remain unavailable; no live provider-position adapter exists                                                                                                                                                                                                                      | Every counted provider has a live adapter and evidence bundle; stale/divergent/incomplete data is unavailable rather than zero or current                                                                           |
| Ten live providers  | Ten static research entries and eleven planned identities exist; only five are current Base candidates                                                                                                                                                                                                              | Ten distinct provider bundles pass, including separately approved Ethereum and Solana decisions; planned or cataloged entries do not count                                                                          |
| Mainnet writes      | No mainnet transaction bounded context, route, intent store, manifest, or write approval exists                                                                                                                                                                                                                     | Every additional write gate in `mainnet-rollout.md` and the per-provider transaction evidence above passes for an exact allowlisted action                                                                          |
| Operations/security | No deployed revision-bound production exercise or independent acceptance is recorded                                                                                                                                                                                                                                | Threat model, observability, incident, rollback, recovery, provider drift/outage, finality/reorg, key/credential, and canary evidence pass with no unresolved critical/high finding                                 |
| Dependencies        | Compatible `qs` and `fast-uri` fixes are applied; the audit's three remaining moderate package findings trace to the transitive `uuid` advisory under `@solana/web3.js`/Jayson. Installed Jayson calls UUID v4, while the advisory names v3/v5/v6 buffer paths, but the residual risk is not independently accepted | A compatible upstream remediation is pinned and verified, or Security records a dated, expiring disposition tied to exact dependency versions and observed call paths; do not use npm's forced Solana SDK downgrade |

No waiver may change the meaning of `cataloged`, `live read-only`, or
`transaction-enabled`. A waiver for a required hard gate means **no-go** for the
affected launch mode.

## Exact verification lanes

### Research-catalog count (offline only)

This test proves ten distinct static catalog identities and their permanently
non-executable policy. It does not prove current rates, live connectivity, risk
acceptance, deposits, or withdrawals.

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
authenticated request must return either current, fully attributed approved
data or the bounded `503` unavailable response—never fixture data or a partial
success.

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
- **No-go for claims of ten live providers** until ten distinct live read-only
  evidence bundles pass. Five approved Base providers may be described only as
  five approved Base providers.
- **No-go for any real-value action** while any write gate is open. Hide or
  remove transaction controls; do not ship a disabled-looking control wired to
  an executable route.
- **No-go on evidence drift:** a revision, dependency, provider deployment,
  contract/program, asset, oracle, endpoint, plan, policy, or approval-expiry
  change invalidates the affected evidence and requires review.
- **Go decisions are mode-specific:** read-only acceptance never authorizes a
  financial action, and one approved Base provider never authorizes another
  provider or chain.
