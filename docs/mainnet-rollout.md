# Mainnet rollout boundary

## Selected direction

- The active production/mainnet release scope is **Ethereum mainnet**
  (`eip155:1`) and **Solana mainnet**
  (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`) only. Each chain remains a
  separate product and protocol integration; registering ownership of an
  account does not approve its data providers, lending protocols, or
  transactions.
- **Base mainnet is explicitly deferred.** Existing Base registry entries,
  research captures, fixtures, and wallet-proof code remain historical or
  dormant implementation evidence. They do not count toward this launch, and
  they do not authorize a Base provider, read, position, or transaction.
- The production mainnet wallet-registration launch allowlist accepts only
  Ethereum and Solana. Base mainnet challenge issuance and roster reads fail
  closed. Broader canonical registry and testnet artifacts may still represent
  Base for historical or non-production evidence, but they cannot enter the
  mainnet release surface. Every accepted proof and stored roster entry remains
  bound to one exact chain and address.
- Account identity uses Amazon Cognito User Pools through the existing managed
  OIDC boundary. Wallet ownership remains a separate, account-bound message
  proof.
- The existing Base Sepolia and Solana Devnet transaction-proof modules remain
  test-only. The production API route graph and checked-in public OpenAPI
  contract omit them entirely; only an exact `development` or `test` runtime
  may register them behind their loopback configuration gates. They must never
  be relabeled, imported by a mainnet module, or enabled by changing an
  environment name.
- Initial mainnet delivery is authenticated and read-only. It may request one
  explicit, user-approved ownership message after account verification:
  `personal_sign` for Ethereum or `signMessage` for Solana. No mainnet
  transaction builder, transaction signature request, transaction submission,
  or broadcast is enabled by this decision.

The dated critical path, ten-provider program target, count definitions, and
go/no-go checks are tracked in the
[production go-live plan](production-go-live-plan.md). A provider appearing in
the checked-in research catalog does not make it live, readable from production,
or transaction-enabled.

Exactly ten Ethereum/Solana provider identities currently have dormant,
synthetic transcript boundaries: six Ethereum and four Solana. All ten remain
unregistered and unavailable. The live read-only and transaction-enabled
provider counts are both zero.

Six account-scoped provider-position source artifacts also exist: Aave V3
Ethereum (`1538ec7`), Kamino Solana (`1e70d80`), Compound III Ethereum
(`7e10077`), SparkLend Ethereum (`d684428`), Morpho Blue Ethereum (`5910ebf`),
and Euler V2 Ethereum (`d478f3b`). They are endpoint-free,
direct-import-only, dormant, and unregistered. Each requires injected
authenticated durable wallet/continuity context and a bounded finalized
transcript. None supplies an endpoint, credential, approved independent source
pair, runtime activation, persistence or financial-action authority, or live
evidence, so these artifacts do not change either zero count.

Gearbox commit `5fcc7ca` adds a pure evaluator for a caller-asserted exhaustive,
already decoded account-position transcript that matches the caller-supplied
approval list, and inventory commit `040e93a` pins it and its focused hostile-
path specification. It owns no transport, database, clock, credential, or
runtime registration and cannot authenticate its caller, chain, or RPC
observations. Its completeness remains explicitly unestablished, so it is not a
seventh complete dormant provider-position source and does not change the six-
source or 0-of-10 live-evidence counts.

## Required architecture boundary

Any future financial action must use a new mainnet bounded context with its own
routes, response types, intent domain, durable storage, provider registry,
contract manifest, recovery state, audit events, and per-chain kill switch.
Mainnet mode must be an explicit no-default allowlist; it must not be inferred
from `NODE_ENV`, `APP_ENV`, `LOCAL_DEMO_MODE`, or the public-testnet flags.

For every chain, the browser wallet remains the only possible transaction
signer and broadcaster. The API may eventually prepare and verify a bounded
intent after separate approval, but it must not hold a signing key or relay a
transaction.

## Gates before read-only live data

1. Approve two independent RPC/indexing providers for both active live-read
   chains, Ethereum and Solana, including their exact hosts, plans, regions,
   quotas, credentials, and spend alarms. Base evidence does not satisfy either
   chain's gate.
2. Approve controlled outbound access under KAN-231. The current ECS baseline
   has no general internet egress and cannot reach Cognito OAuth/JWKS or any
   mainnet RPC endpoint.
3. Pin reviewed deployment manifests and the exact supported-asset registry for
   each counted Ethereum or Solana provider. Validate chain identity, bytecode
   or program identity, proxy implementation, market, oracle, pause/freeze,
   cap, and drift before accepting data.
4. Activate the existing durable portfolio readers only through an approved,
   dedicated balance-sync consumer and chain-specific adapters. The isolated
   balance queue and publisher contract exist, but no consumer task/service or
   receive/delete IAM capability exists and the dormant Ethereum/Solana RPC
   adapters remain unregistered. The server coverage contract must report every
   active `{walletId, networkId}` target as `COMPLETE`, `PARTIAL`, or
   `UNAVAILABLE` and must fail closed on missing, extra, stale, divergent,
   incomplete, or regressing evidence. Define an explicit server-owned
   `staleAfter` deadline and focus/revalidation policy so a long-lived page
   cannot claim indefinite freshness. The browser must reconcile the returned
   chain and wallet totals and must never render unread coverage as zero.
5. Complete non-production Cognito callback, secure-cookie, logout, recovery,
   MFA, JWKS-rotation, and outage evidence.
6. Bind the exact clean release manifest, deployment target, and live-read
   evidence into the two-role signed technical bundle, then obtain the separate
   seven-role signed public-launch decision. Both checked-in trust registries
   and the deployment-target registry are empty today, so this gate cannot pass
   locally.

## Dormant chain-anchor finality and record-intent milestone

Commit `387a2dc` adds a pure, direct-import-only finality boundary after the
authenticated two-source producer. It authenticates the exact producer
capability and request before inspecting the candidate and again immediately
before issuing a frozen, null-prototype, exact-request-bound result. Ethereum
classification compares the candidate block height with the agreed finalized
height, requires the authenticated lineage proof when the finalized height is
higher, and quarantines an equal-height hash conflict. Solana classification
compares the candidate slot only with the agreed finalized root, quarantines a
root regression, and never treats the finalized slot as proof. It explicitly
makes no same-slot fork-detection claim. Its clock is injected and
server-controlled; deadlines, source-pair approval, and head-freshness bounds
are exclusive, and abort or clock regression fails closed. `PENDING` never
upgrades in place.

Every request and result keeps financial-action, persistence, and position-
snapshot authority false. The finalizer neither persists nor updates migration
`0029`'s candidate: even a locally classified `FINALIZED` result remains a
dormant display-only assessment, and the recorded candidate remains
`PROVISIONAL`, `DISPLAY_ONLY`, and non-authorizing.

Migration `0031` now wraps migration `0030`'s deadline-guarded evidence writer
in a retained PostgreSQL intent lifecycle. Recorder V2 prepares the exact
Ethereum/Solana evidence intent before claiming one record dispatch, stores only
hashed token material, and never automatically resubmits an ambiguous record.
A separate one-shot processor can lease one due unresolved intent and inspect
the result only through `RECONCILE_ONLY`; it cannot dispatch `RECORD`. A dormant,
direct-import-only lifecycle can invoke that processor sequentially within a
reviewed 1-through-64 work-item limit and a 10-millisecond-through-30-second run
deadline. It accepts one run at a time, propagates aborts, honors authenticated
retry deferrals only inside the deadline, and cleans up its injected timers and
listeners. Import and construction start no work. At the inert-registration
milestone, preflight commit `a684735` pinned 43 provider-position artifacts.
Morpho/Euler inventory commit `a77a57e` and preflight commit `5550fbf` now pin
the six dormant provider-position sources in a 45-artifact boundary. The
dedicated inventory validator covers Gearbox commits `5fcc7ca` and `040e93a`,
and the dedicated dormant-action validator covers lifecycle commits `ee9204d`
and `a387124`; `a61bb57` is separate disposable PostgreSQL integration
coverage. None is added to that 45-artifact provider slice. Preflight rebaseline
`667b112` pins the complete reviewed API source snapshot at 395 files and
6,265,963 bytes with SHA-256
`e3c282da6404df5d631b6b110dc52f48111beb1e087b0c56648661b70db737ad`.
All 85 focused cases in `production-go-live-preflight.test.ts` pass for that
exact slice. The earlier six focused record-intent cases also passed against an
isolated local PostgreSQL 16 instance.

This closes a local evidence-recording, bounded-run, and inert-registration gap
only. The exported reader-v3 facade rejects every request without inspecting
input because its source-owned Ethereum/Solana activation registry is empty,
`NOT_APPROVED`, and `DISABLED`. The private composition, finalizer, recorder,
reconciliation processor, and reconciliation lifecycle remain direct-import-
only, unregistered, unscheduled, ungranted, and undeployed. They have no
approved source pair, endpoint, credential, external transport, populated
mainnet evidence, or financial-action authority, and physical commit
acknowledgement can still be ambiguous across a broken connection. The report
emits `PROVIDER_POSITION_RUNTIME_ACTIVATION_POLICY_NOT_APPROVED`,
`PROVIDER_POSITION_APPROVED_SOURCE_BINDINGS_MISSING`, and
`PROVIDER_POSITION_DEPLOYED_EVIDENCE_MISSING`; `liveReadEvidenceBound` and
`transactionEvidenceBound` both remain zero. These local tests do not increment
the zero live-provider count or clear any read-only or real-value launch gate.

The zero-cost application-template validator now rejects `NODE_OPTIONS` and
unreviewed `DD_TRACE*`, `NEW_RELIC*`, `ELASTIC_APM*`, or `OTEL*` bindings from
every task environment and secrets block. The built API artifact validator also
rejects resolvable or loaded PostgreSQL auto-instrumentation packages, including
`@opentelemetry/instrumentation-pg`, `dd-trace`, `newrelic`, and
`elastic-apm-node`. These local protections add no instrumentation, database or
provider call, image build, deployment, or live evidence.

## Dormant financial-action intent boundary

The `apps/api/src/mainnet-actions/domain` subtree is an isolated, direct-import-
only description and validation boundary for a possible future action intent.
It binds one intent to one Ethereum or Solana wallet, provider/protocol pair,
market/program, current registry asset, action, exact allowance, fee caps,
post-action reserve, value estimate, UUIDv4 replay identifier, idempotency-key
digest, issuance time, and exclusive expiry no more than five minutes after
issuance. Cross-chain execution, API signing, API broadcast, automatic resend,
and automatic fee escalation are all explicitly false; the user wallet is the
only named signer and broadcaster.

The policy/domain subtree has no route, module, dependency-injection
registration, runtime or environment configuration, transport, RPC call,
transaction construction, signing, submission, or credential. Its only
exported policy is immutable and `DISABLED`: both chain kill switches are
`HALT`, every provider/market/asset/action/wallet approval list is empty, and the per-
transaction, per-wallet daily, global daily, total-outstanding, network-fee,
allowance, unresolved-intent, and wallet-allowlist limits are all zero. Consequently every
well-formed candidate is still returned as `DENY` with financial-action
authority false; syntactic validation is not provider, market, or write
approval and does not change the zero transaction-enabled-provider count.

Migration `0033` in commit `ee9204d` adds an owner-only, append-only dormant
database lifecycle for exact Ethereum/Solana `SUPPLY` and `WITHDRAW` intents,
submission binding, ambiguous broadcast observation, and reconciliation. It
stores canonical public transaction identity but only digests for private
signed payload, signature, and evidence material; it permits direct post-crash
reconciliation from a signed-bound submission and does not strand post-bind
evidence after wallet revocation, operation drift, or expiry. Commit `a387124`
adds the dedicated fail-closed source validator, and commit `a61bb57` exercises
three isolated test-schema/verifier controls against disposable local PostgreSQL
16 without seeding lifecycle rows.

Commits `b7289ac` and `b0b39d9` add and exercise a direct-import-only PostgreSQL
adapter for that durable lifecycle. It performs one cancellable database call
per operation, never retries a post-dispatch ambiguity, and returns only a
read-only `DATABASE_OUTCOME_UNKNOWN` recovery capability when the database
result is uncertain. Migration `0034` in commit `9af00ef` and the adapter update
in `79c4b71` additionally require the parsed canonical Ethereum or Solana
address to match the requested registered wallet's exact current HMAC key set
and same-account `ACTIVE`, nonrevoked identity aliases before preparation. The
database retains the immutable registration-era digest as its audit anchor, so
v1-parent/v2-current key rotation remains valid; address A paired with wallet B
is rejected without creating lifecycle history.

This closes the local schema-and-adapter portion of durable replay, restart
state, and wallet-identity binding. It does not create API/worker composition,
a runtime grant, unresolved-work discovery/claim/lease processing, a scheduled
reconciler, authenticated chain-finality admission, a post-finality reorg
record, an exact transaction-payload verifier, a signer, a broadcaster, a
mainnet provider binding, or write authority. Both migrations are registered
solely in the cumulative migration index; V2 and its V1 owner-only delegate
remain unavailable to application principals, the adapter is unregistered,
and all policy limits and approvals remain zero.

## Additional gates before any real-value write

- Select and approve an exact Ethereum or Solana provider, market/program,
  supplied asset, and transaction meaning. No write candidate is selected by
  this document, and the deferred Base canary plan must not be reused.
- Encode hard per-transaction, per-wallet daily, global daily, and total-value
  ceilings. All limits default to zero.
- Encode absolute and percentage gas caps, a post-transaction gas reserve, one
  unresolved transaction per wallet, and no automatic resend or fee escalation.
- Use exact allowances by default. Any unlimited allowance needs a separate
  security decision and explicit user disclosure.
- Authorize and register only the address-bound `0034` V2 adapter through a
  separately reviewed transactional prepare-before-dispatch runtime. Add
  durable unresolved-work discovery, claim/lease recovery, and reconciliation
  without automatic resubmission; never log its HMAC candidate arrays.
- Authenticate network observations and transaction payload/signature evidence,
  then record post-finality reorgs without silently rewriting terminal history.
- Define provisional, safe, finalized, and accepted financial-finality states.
- Exercise pause, provider divergence, deployment drift, recovery, withdrawal,
  and incident runbooks in a fork or simulation, then obtain independent
  security review.
- Start with allowlisted staff wallets and an organization-approved tiny canary
  ceiling. Raising a limit or expanding the allowlist is a separate reviewed
  release.

Solana wallet ownership registration does not approve a Solana lending
integration. The current Devnet Save module includes deployment-specific
accounts and an API broadcast path; it remains test-only and requires an
independent protocol, asset, custody, provider, and rollout decision before any
mainnet read or write is enabled.

## Current safety statement

No code in this rollout boundary authorizes a mainnet financial action. The
wallet flow can make injected-provider connection and exact chain checks and
can ask for one user-approved ownership-only message signature; it cannot
request a transaction signature. No public Ethereum or Solana RPC/indexing
request, transaction submission, broadcast, provider account, cloud
deployment, or paid resource is created by the local implementation. The
separate balance-sync queue definition has no activated consumer or chain
egress and grants no live-read authority. Migration `0031`, recorder V2, the
dormant reconciliation processor, its bounded lifecycle, owner-only migrations
`0033`/`0034`, and the direct-import-only durable adapter add no application
database grant, runtime composition, or external egress. The same is true of
the deferred Base artifacts retained outside the Ethereum/Solana launch scope.
