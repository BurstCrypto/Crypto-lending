# Offline production preflight

Run the bounded production blocker audit from the repository root:

```powershell
npm run production:preflight
```

The command defaults to the authenticated read-only target. To inspect the
stricter mainnet-write target or consume deterministic JSON, run:

```powershell
npx tsx scripts/production-go-live-preflight.ts --target mainnet-write
npm run --silent production:preflight:json
```

This is currently a `BOOTSTRAP_BLOCKER_AUDIT`, not a launch-certification
command. With no explicit bundle, its repository loader does not discover or
ingest controlled production evidence, so both targets remain blocked today.

`PRODUCTION_INFRASTRUCTURE` first inspects the exact, unchanged
`NON_PRODUCTION_ONLY` KAN-34 parent/child/migration/guardrail matrix and then
securely loads a separate, exact-hash production contract set. That set binds
the default-zero contract template, its non-production deployment guard, the
billing, egress, fixed-slot, auth/wallet, and Redis transition validators, and
the empty production-target registry. The resulting private
`PRODUCTION_ENABLED` brand means only that this static production path is
defined and reviewed. It does not mean that resources exist, a deployment was
authorized, or production was activated.

The contract has `Resources: {}`, admits only `ActivationMode: DISABLED`, fixes
all desired counts and incremental cost ceilings at zero, permits no external
egress, limits network identity to Ethereum and Solana mainnet, requires future
credential transitions to use exact secret VersionIds, and keeps rollback and
both kill switches as mandatory declared states for any future nonzero path.
Those metadata declarations are not executable controls. The empty resource map
is a contract/envelope milestone, not a deployable application stack.
Consequently local inspection is `PASS`, while launch readiness remains
hard-blocked by
`PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_AUTHORITY_MISSING` and
`PRODUCTION_INFRASTRUCTURE_DEPLOYED_EVIDENCE_MISSING`. Missing, malformed,
forged, or byte-drifted contract artifacts instead emit
`PRODUCTION_INFRASTRUCTURE_INSPECTION_FAILED`. The release-candidate manifest
also binds the exact contract file, so a release cannot silently omit or
substitute it.

A standalone offline deployment-intent validator now defines a closed,
canonical JSON envelope for `PROVISION_INERT`, `ACTIVATE_READ_ONLY`, `ROLLBACK`,
`EMERGENCY_KILL`, and `DELETE`. It binds the exact deployment coordinates,
source revision, release manifest, deployment target, infrastructure inputs,
current/proposed authority, rollback and kill state, and predecessor chain.
Operational acceptance would require distinct Ed25519 signatures from reviewed
deployment-owner and independent-security keys. The checked-in production trust
registry and deployment-target registry are both empty, the checked-in example
is unsigned and inert, and the validator has no executor; every result retains
`executionAllowed: false`. Test-only injected keys can exercise verification but
cannot mint the private production brand. Production entry points do not accept
a caller-supplied evaluation time: they capture wall and module-held monotonic
clocks before validation and again immediately before branding. Private,
sticky authorization metadata binds the final observation, absolute expiration,
and monotonic deadline. The production-brand predicate and application
revalidation recapture both clocks and permanently invalidate that report after
any observed wall/monotonic rollback or either expiration boundary. Only an
isolated, explicitly unbranded test metadata path permits deterministic clock
injection and it cannot grant production authority or execution.
`EMERGENCY_KILL` and `DELETE` require
the exact zero-count/no-egress/no-write kill state, while rollback cannot
increase authority and no operation permits financial writes. Predecessor
validation is a point-in-time check against caller-supplied expected state; any
future executor must also consume and advance that chain atomically. The release
manifest binds both the validator and inert example. This source milestone does
not clear either production-infrastructure blocker or authorize a cloud call.

The application-baseline validator also rejects `NODE_OPTIONS` and unreviewed
automatic-instrumentation names with the `DD_TRACE`, `NEW_RELIC`, `ELASTIC_APM`,
or `OTEL` prefixes from every API, web, and worker task `Environment` or
`Secrets` block. The built-API-runtime validator separately rejects a production
artifact that can resolve or that loads `@opentelemetry/instrumentation-pg`,
`dd-trace`, `newrelic`, or `elastic-apm-node`; the web artifact retains its
separate existing package policy. These are zero-cost local template and
artifact protections against an unreviewed PostgreSQL preload/interception path.
They do not build or deploy an image, enable telemetry, make a database or
network call, or supply live evidence.

This check recognizes the selected environment contract and guard markers; it
is not a substitute for the dedicated CloudFormation linters and artifact
validators. The standalone `sqs-foundation.yaml` is intentionally outside this
matrix because the KAN-34 parent owns its queues and is mutually exclusive with
that alternative stack for one environment. The standalone template remains
covered by its own validator and CI suite. Making the path deployable requires a
separate reviewed source change that introduces resources and nonzero ceilings,
plus independently approved billing, egress, credential-transition, rollback,
deployment-target, release, and live deployment evidence. This checkpoint does
not widen an existing template or authorize a deployment.

`BALANCE_CONSUMER` separately binds and inspects the exact release-bound
standalone balance-consumer envelope together with its validator and dormant
application source. That envelope is not referenced or composed by the
application parent or the deployment target. It admits only non-production
environment names, requires the explicit
`I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES` parameter before any
deployment, and fixes its ECS service at literal `DesiredCount: 0`. The
inspector performs local filesystem/source checks only; it makes no cloud,
provider, or other external request and cannot incur cloud cost.

The `BALANCE_CONSUMER` inspection also byte-pins and semantically validates the
source-only lifecycle coordinator. It requires exact one-shot cancellation,
run-drain-before-close behavior, fixed operator outcomes, and absence from the
runtime, CLI, activation, module, barrel, application, package, template, and
container launch roots. Passing that local inspection does not compose the
coordinator or change any blocker below.

The same inspection now byte-pins the provider-neutral JSON-RPC helper, the
Ethereum and Solana mainnet balance adapters, and their closed mainnet router.
The router recognizes exactly `eip155:1` and
`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`: Base and every other third chain are
rejected without fallback. It validates account and wallet UUIDs, snapshots
only the exact read or rescan fields into frozen null-prototype records, rejects
accessors, requires distinct injected chain indexers, and captures each data
method once before dispatch. Mutation tests cover a third-chain substitution,
fallback, raw-request forwarding, method redirection, shared indexers, and loss
of the immutable snapshot boundary.

The pinned failure boundary accepts provider/retry classifications only from a
privately branded, unchanged, frozen `BalanceSyncIndexerFailure`. Review uses
descriptor snapshots and never `instanceof` trust; counterfeit, proxy, accessor,
mutable, resolver, and clock failures become fixed unclassified or invalid-data
outcomes. The per-chain transports remain injected behind the shared interface,
with no owned HTTP/client, URL, credential, environment, timer, retry-loop, or
Nest/runtime capability and no adapter/helper/router identity in launch roots.
The already reviewed barrel exports remain allowed because they neither
construct a transport nor register a provider. The adapter contract also
requires each five-field read request to be narrowed to the resolver's frozen
three-key account, wallet, and network scope. All of this is static source
integrity only: it cannot select a live provider, permit egress, activate the
consumer, or clear any deployment or live-evidence blocker.

Each chain adapter must also receive an opaque, privately branded deployment-
identity verifier. The adapter binds a nonzero approved-manifest fingerprint
and observed-identity fingerprint into its candidate only after the verifier
authenticates the exact request and deployment. The V2 agreement coordinator
requires each source's approved-manifest fingerprint to match the registry and
requires the two independently observed deployment-identity fingerprints to
match each other. The manifest and observed-identity fingerprints are distinct,
domain-separated values. The checked-in registry remains empty and
`NOT_APPROVED`; no verifier constructor appears outside its owned dormant
source. These pins establish a dormant source contract, not a live deployment
identity or provider approval.

Preflight also byte-pins the concrete dormant Ethereum and Solana deployment
manifests and identity verifiers. It requires the checked-in manifests to remain
`NOT_APPROVED` with empty deployment inventories, preserves Ethereum's exact
EIP-1898 canonical block-hash checks and Solana's exact-slot response gate, and
rejects owned endpoints, credentials, environment lookup, network clients,
timers, or any barrel/runtime registration. This does not approve either
manifest. Activation remains explicitly blocked until a separately governed,
release-bound manifest fingerprint is approved; an approved Solana provider
demonstrates that `getMultipleAccounts` can satisfy the verifier's exact-slot
contract; and an independently captured real PYUSD Token-2022 golden fixture,
exact extension inventory, and reviewed mutable-field window policy exist.

Separately from that 73-artifact byte-pinned contract, the repository loader
derives a private runtime-absence attestation from every lowercase `.ts` and
`.tsx` file under `apps/api/src` that is not excluded by the exact pinned build
exclusions (`*.spec.ts` and `*.e2e-spec.ts`). After the migration-`0033` binding
correction in `5976d32`, the
direct-import-only durable port and PostgreSQL adapter in `b7289ac`, the
address-bound migration/adapter updates in `9af00ef` and `79c4b71`, and the
authenticated-finality producer, sidecar, and migration through `4f0a79f`, the
current snapshot contains 403 files and 6,704,387 bytes. Its aggregate SHA-256
is `d1854a4f4e55ed4321e06a7bf6684bdf164f82819b8a4e751c0c94b8747621e5`.
The aggregate also binds the exact `nest-cli.json`, `tsconfig.json`, and
`tsconfig.build.json` build inputs and the resolved
`src/blockchain/domain/local-evm-development-manifest.json` runtime data input.
One reviewed SHA-256 binds that whole snapshot; any covered API runtime source,
configuration, or data change requires an explicit review and fingerprint
rebaseline. The offline scan is bounded to 512 reviewed sources, 384 KiB per
source, 8 MiB of source, 1,024 total tree entries, 192 directories, 256 KiB of
topology, and 32 path segments. It repeatedly enumerates canonical physical
paths, rejects linked or noncanonical paths, rejects hardlinked covered inputs
and case-folded duplicate covered-source paths, rejects unsupported script
extensions, traversal, topology or byte drift, and parses each stable source with
the pinned local TypeScript parser.

As defense in depth, the six concrete verifier/manifest symbols and module
basenames are allowed only in the exact four owned manifest/verifier sources.
Recognizable runtime imports of test-named modules, escaping local module paths,
computed dynamic `import`/`require` calls, and unreviewed loader aliases
also fail closed, as does any new local JSON module import until its input is
explicitly reviewed. The full scan automatically includes entrypoints such as
`outbox-worker-health.cli.ts`; `.test.ts` and TSX test-name variants are scanned
because the pinned build config does not exclude them. Only the secure
repository loader can place the frozen point-in-time attestation in the private
accepted set; the injected-snapshot test seam is deliberately unbranded, and a
missing or forged token makes `BALANCE_CONSUMER` local validation fail. Like the
existing source brands, this cached token is not permanent runtime evidence or
launch authority; final launch still requires the immutable release/image-bound
evidence gates.

The same closed artifact set now includes one provider-neutral, source-only
Node HTTPS transport capsule. Preflight pins its exact SHA-256 and requires its
reviewed class/import surface, per-exchange cancellable A+AAAA resolver, public
address and family pinning, hostname-verifying TLS, bounded request/response
teardown, abort handling, strict JSON limits, and sanitized fixed failures. It
also rejects an embedded endpoint, assigned credential, environment lookup, or
Nest/provider binding and requires the transport identity to remain absent from
barrels, composition, runtime, configuration loaders, templates, packages, and
the release manifest. These checks do not construct the class or perform DNS or
HTTPS I/O.

The inspection now also byte-pins the consumer service, balance-sync port
contract, dispatcher, composition, orchestrator, dormant two-source
coordinator, router, JSON-RPC helper, both chain adapters, their public export
root, PostgreSQL resolver/repository/service, persistence facade,
infrastructure timeout policy, API dependency manifest, and root lockfile as
one execution-cancellation boundary. Each accepted job receives a privately
branded context, and the production path must pass that same context and signal
explicitly through wallet resolution, JSON-RPC, and every checkpoint operation
without an inert default. The reviewed policy calls the limit `jobTimeoutMs`,
defaults it to three hours, and accepts only two through six hours. Deadline
and shutdown are retained out of band and map to fixed timeout and unavailable
classifications without reading or forwarding an abort reason. The helper
checks cancellation before transport, after a rejected transport call, and
after a successful response; transports must accept the signal, and neither
the helper nor downstream path may detach work with `Promise.race`. The dormant
two-source coordinator captures `Promise.allSettled` behind an abort-aware
helper. Without cancellation it observes both same-signal reads to settlement;
cancellation returns a fixed unavailable result promptly while the already-
started pair remains observed by the captured all-settled promise. The
coordinator rechecks the branded execution context before accessing either
value. Rescan preserves the two cancellation classifications, while the
existing SQS receipt remains the sole retry/redrive authority.

The resolver and all checkpoint operations review the branded context, pass
its exact signal to `PostgresService.queryWithCancellation`, and recheck after
settlement. That service closes admission synchronously, memoizes close before
aborting accepted work, owns a dedicated client, enforces a 16-second local
operation timer, discards with `client.release(error)`, and awaits the exact
pool removal plus query settlement. Teardown uncertainty is a fixed failure;
it is not reported as a drain. The balance workload caps pool acquisition and
lock waits at 5 seconds and statements at 15 seconds. Because active `pg`
acquisition has no native signal cancellation, shutdown may still wait for its
configured 5-second acquisition bound. The inspector pins direct `pg` 8.23.0
and the lockfile's single `pg-pool` 3.14.0 resolution.

Aggregate close is published before cleanup starts and has a fixed 25-second
watchdog under the dormant task's 30-second ECS `StopTimeout`. The timer is
unrefed and cleared on normal settlement; timeout rejects with a fixed outcome
while late cleanup remains observed and continues. The lifecycle shell starts
that close path when shutdown is handed to the accepted run, so a hung run
cannot suppress the watchdog. These contracts do not prove physical socket or
process shutdown against live PostgreSQL. The reviewed HTTPS transport is still
dormant: no provider, hostname/path endpoint, credential source, runtime wiring,
or exact-host egress has been approved or supplied. Its strict response policy
accepts exactly one bounded framing: either one canonical `Content-Length` or
one standalone case-insensitive `Transfer-Encoding: chunked` on HTTP/1.1, never both. It
rejects compression, declared or received trailers, duplicate or compound
transfer encodings, incomplete bodies, excess decoded bytes, and excess decoded
body `data` events. Node validates and removes wire chunk framing before these
application counters run, so chunk extensions and wire-framing overhead are not
observable here. Provider compatibility remains unproved. Deployed Node
resolver, TLS, socket-teardown, and live provider evidence remain explicit
activation blockers. All checks are local and make no network, chain, cloud, or
billable call.

The adapter dependency closure is byte-pinned too: the supported-asset
registry, wallet identity parser, and Solana token-account parser are now part
of the exact balance-consumer artifact shape. The launch adapters filter the
registry down to exactly three active Ethereum mainnet assets and three active
Solana mainnet assets: USDC, USDT, and PYUSD on each chain. The broader registry
and wallet catalog may retain reviewed Base, Arbitrum, and testnet metadata for
future work; those entries are not launch routes, because neither adapter can
select them and the closed router still rejects every network except Ethereum
and Solana mainnet.

The dependency inspection requires strict canonical EVM parsing, canonical
32-byte round-tripped Solana addresses, the exact legacy and Token-2022 program
IDs, a 165-byte legacy layout, and Token-2022 data bounded at 4,096 bytes with
its account-type discriminator and COption checks. Solana account data is copied
before parsing, canonical base64 is bounded before decoding, and PYUSD remains
bound to Token-2022 while USDC and USDT remain bound to the legacy program. A
Solana balance read also brackets all token-account calls with two reads of the
selected block header; null or any position/hash/parent mismatch fails as
`PROVIDER_UNAVAILABLE`. These are source-integrity checks, not provider or
mainnet observations.

The 73-artifact balance-consumer slice also byte-pins the exact migration
`0005` principal constants inherited through `0028`, immutable migration
`0027`, migration `0032`, and the migration index whose reviewed tail now ends
with `0035`. The dedicated dormant-action validator, rather than balance-
consumer semantics, owns migrations `0033` through `0035`. Its semantic
inspection requires a separate permanent append-only
`balance_sync_financial_agreement_evidence_v2` relation, the exact V2 source-
attestation and agreement fingerprint domains, all 51 generated coordinator-
declared JSON string-type gates, owner-only V2 envelope validator and recorder
functions, and production/test-schema registration after `0031`.
The migration must supersede `0031`; preserve migration `0027`'s V1 relation,
functions, constraints, manifest, and verifier byte-for-byte; reject, at V2
admission, a fingerprint already committed in V1; accept only exact V2 replay;
and refuse rollback once the V2 relation has data. Because V1 remains
untouched, this check does not claim bidirectional or global concurrent
serialization. The immutable V1 validator remains fail-closed because its
committed position-ID expression attempts PostgreSQL NUL text with `chr(0)`;
`0032` must not awaken or replace it and repairs only the derived V2 expression
with bytea `convert_to(...) || decode('00', 'hex')` separators. It must expose
no table, column, row-type, or function grant to API, worker, legacy,
migration, balance-consumer, or `PUBLIC` and remain absent from runtime
composition and launch roots. A passing source inspection still reports
`databaseCapability: DORMANT_SOURCE_ONLY`; it does not clear
`BALANCE_CONSUMER_DATABASE_CAPABILITY_NOT_ENABLED` or any other activation or
live-evidence blocker.

The generated verifier also requires an ordinary permanent nonpartitioned
relation with no RLS, policies, or non-internal rules; exact column order,
types, nullability, identity/generated/default/collation state; exact PL/pgSQL
input/output signatures and function-body hashes; and no non-owner table,
column, row-type, or function ACL. A guarded disposable loopback PostgreSQL run
on 2026-09-07 passed 11/11 mainnet balance-agreement cases and 6/6 related
provider-position cases. The mainnet cases prove V1 rejection leaves zero rows,
the upgrade preserves the empty V1 relation and objects, and genuine Ethereum
and Solana V2 envelopes record successfully. Migration `0032` also pins
SHA-256 hashes of PostgreSQL 16's non-pretty
`pg_get_expr(conbin, conrelid, false)` output for exactly four V2 CHECK
expressions while retaining its structural, ACL, and function checks. Its
catalog verifier therefore fails closed on CHECK-expression drift and unless
`server_version_num` is at least `160000` and below `170000`. The local database
proof changed and restored each CHECK while preserving every earlier marker
substring. Moving off PostgreSQL 16 requires a reviewed verifier change and
live-catalog revalidation; any deparser-output change, including within 16.x,
additionally requires a reviewed hash rebaseline. This remains local-only
integration evidence, not live-provider, deployed, production-catalog, or
recursive historical-verifier closure.
Verification against the eventual live catalog remains a pre-grant blocker and
does not activate the dormant capability.

The inspected source keeps activation false, sets
`BALANCE_CONSUMER_MODE=disabled`, and leaves the runtime uncomposed. The task
has no database secret/grants, metadata key, RPC/provider input, Redis, auth,
generic jobs queue, public IP, or ECS Exec. Its loopback-only security group has
no external egress. Its task role is limited to receive/delete/change-visibility
on the exact balance source plus KMS decrypt through SQS; jobs/DLQ access,
send/publish, `GetQueueAttributes`, Secrets Manager, Redis, auth, provider, and
RPC actions are absent. Its execution role can only pull the same-account
digest-pinned image and write dedicated logs. The Fargate `1.4.0` task is
non-root, read-only-root, and drops all Linux capabilities. A valid local
inspection proves these dormant source constraints only; it never turns them
into deployed or production-ready evidence.

`PROVIDER_POSITION_READ_BOUNDARY` independently snapshots and byte-pins the
coverage-aware reader v3 port, trusted-assessment assembly port,
durable-chain-anchor reader port, concrete PostgreSQL durable-anchor reader,
dormant chain-anchor evidence source port and two-source producer, pure
candidate-finality port and dormant finalizer, recorder V2 port and concrete
PostgreSQL recorder, record-intent reconciliation port and one-shot PostgreSQL
reconciliation processor, bounded reconciliation lifecycle, dormant
trusted-chain-assessment assembler,
admission coordinator, concrete Node deadline runner, wallet-roster reader port
and adapter, wallet service and repository port, PostgreSQL wallet repository,
shared PostgreSQL cancellation service, dormant runtime-budget resource,
private dormant runtime composition, infrastructure configuration loader,
runtime PostgreSQL pool factory, coverage/observation/assessment/policy domains,
exact Ethereum/Solana mainnet launch-network policy, migration `0029`, the
deadline-bound migration `0030`, record-intent migration `0031`, the migration
index, feature module, feature barrel, HTTP controller, and the concrete Aave,
Kamino, Compound, and Spark provider-target sources as one selected local
critical-source slice. The historical candidate-finality milestone covered 38
artifacts. Aave, Kamino, and Compound preflight commits `ecff5b9`, `b41cc62`,
and `91bd9bc` brought the committed set to 41; Spark preflight commit `2978367`
pins source commit `d684428` and brings the selected set to 42. Within that
slice, the local semantic
inspection requires an exact account/correlation
reader request with no caller-supplied evaluation time and an exact frozen
result envelope containing the server-authored parser time and covered-snapshot
identity. It binds result account, correlation, time, manifest fingerprints and
targets through a private coordinator-issued assembly identity, while retaining
complete and agreeing coverage (including explicit zero counts), whole-assembly
and per-observation verification, descriptor-stable source-method capture with
proxy/accessor rejection, final clock checks, false persistence/financial
authority, one shared source abort signal, terminal controller removal,
first-failure queue stop/drain behavior, and one selected source and anchor for
every target. It also requires an exact API database role,
loader maxima, query/fragment-free connection strings, owned immutable
database/TLS and admission-options snapshots, a connection timeout no greater
than an admission deadline capped at 30,000 milliseconds, concurrency from 1
through 8, and direct pool construction from the reviewed snapshot only.

The coordinator records each returned read-only assembly in a module-private
`WeakSet` only after the final post-parser clock gate. The composition invokes
the exported direct-source identity reviewer before extracting any candidate or
snapshot property; structurally identical clones therefore fail without
running hostile accessors. That reviewer is deliberately absent from the
feature barrel, module, controller, and reader surface.

The six provider-target sources are endpoint-free and direct-import-only.
They obtain authenticated durable wallet and chain-continuity context before
accepting bounded finalized transcripts, bind exact provider/protocol/market/
network/source identities, and retain false financial-action authority and
explicit `COMPLETE` zero semantics. Their source commits are Aave `1538ec7`,
Kamino `1e70d80`, Compound `7e10077`, Spark `d684428`, Morpho `5910ebf`, and
Euler `d478f3b`. Their presence does
not register a provider, create a source pair, permit egress, add a credential,
or produce live evidence.

The durable-anchor reader port is an exact Ethereum-mainnet/Solana-mainnet-only,
authority-free boundary. Each frozen null-prototype request binds account and
correlation IDs, candidate fingerprint, target/wallet/provider/protocol/market/network
identity, selected source family/id/kind/observation identity, continuity floor
and chain anchor, observed/captured/evaluated/deadline times, and the
admission-owned signal. `readAnchor` returns only an opaque value; the same
reader must authenticate that exact value against that exact request before any
returned property is inspected, and capability or request clones must fail.

The concrete dormant trusted-chain-assessment assembler descriptor-captures its
injected reader methods, rejects accessors, proxies, and first-call-learning
readers, and performs sequential fail-stop reads for every selected target,
including zero-position targets. After authentication, it accepts only exact
`VERIFIED`/`CURRENT`/`HEALTHY` claims with matching non-regressing anchors and an
`assessedAt` between observation and capture, current at evaluation, and before
the exclusive deadline. It recomputes each observation fingerprint including
`capturedAt`, then seals the final assessment identity, original assembly-request
identity, and exact verification contexts in a private `WeakMap`; assessment,
request, and context drift fail closed. The assembler has no ambient provider,
network, storage, persistence, or financial-action capability.

The concrete PostgreSQL durable-anchor reader captures only the shared
service's cancellable-query method at construction. Every read sends the exact
13 arguments required by migration `0029`, with the unchanged admission signal,
to its exact `read_provider_position_chain_anchor_evidence` function. It accepts
only zero rows (unavailable) or one strictly reviewed row; extra rows, shape,
network, anchor, status, or canonical-timing drift fail closed. An accepted
frozen assessment is sealed with its exact frozen request identity in a private
`WeakMap`, so result or request clones do not verify. It has no evidence-record,
control, ordinary-query, provider, network, persistence, or financial-action
capability. The admission source reviewer, observation parser, PostgreSQL reader,
and migration all derive the same chain-global identity from the exact anchor:
`ethereum-block-<blockNumber>` or `solana-slot-<slot>`. A request-scoped or
otherwise arbitrary observation ID therefore cannot cross any stage of this
boundary.

The dormant evidence producer accepts one already-observed, canonical selected
source identity and anchor, then requires the exact approved pair's primary and
corroborating source implementations to attest to that same chain fact. It
descriptor-captures both source methods, gives both reads the same
producer-authored evaluation time, caller deadline, and abort signal, and uses
`Promise.allSettled` so both started reads settle before failure is returned.
Both opaque capabilities must authenticate against their exact request objects
before either attestation is inspected. The producer rejects reused source
receivers or capabilities, source-pair, current-head, or finalized-head
disagreement, noncanonical anchors/times, stale head or finality facts, and
invalid proof digests. It derives the three stored proof hashes from the
ordered two-source witness pair and emits only an authority-free opaque
candidate containing migration `0029`'s exact 23 record arguments. A private
`WeakMap` binds that candidate to the exact producer request; copies and request
clones fail review.

The direct-import-only candidate-finality boundary authenticates that exact
producer capability and request before it inspects the candidate and again
immediately before it issues a result. Its injected clock authors the
assessment time. Ethereum compares the candidate block height with the agreed
finalized height: a lower height stays `PENDING`, an equal height requires the
same block hash or is `QUARANTINED`, and a higher height is `FINALIZED` only
with the authenticated nonzero lineage proof. Solana compares the candidate
slot only with the agreed finalized root, never the finalized slot; it
quarantines a root regression and explicitly sets its same-slot fork-detection
claim false. Producer deadline, source-pair approval, and current/finalized-head
freshness boundaries are exclusive. Abort and clock regression fail closed,
and a frozen `PENDING` capability is never upgraded in place.

The finality request and result keep `mayAuthorizeFinancialAction`,
`mayPersist`, and `mayCreatePositionSnapshot` false. Results are frozen,
null-prototype capabilities bound by `WeakMap` to the exact request. This pure
classification performs no database, network, timer, environment, provider,
persistence, snapshot, or financial action.

The recorder V2 port exposes only opaque record and result-review capabilities.
The concrete dormant PostgreSQL recorder accepts exact frozen plain- or
null-prototype outer and nested producer requests with one genuine, unchanged
abort signal. At construction it descriptor-captures only
`queryWithCancellation` and the canonical `reviewCandidate` method from a
genuine producer instance; it performs no I/O. It authenticates and reconstructs
the exact 23-value candidate, appends the producer deadline, and prepares
migration `0031`'s durable intent before any record dispatch. For a new intent it
generates one nonzero 32-byte dispatch token, claims that token, and calls the
intent executor at most once. The executor invokes migration `0030`'s guarded
`RECORD` path. The raw token is never retained by PostgreSQL and is zeroed by the
recorder after use.

Known terminal outcomes become frozen, null-prototype, non-authorizing results
privately bound to the exact request in a `WeakMap`. A failed or ambiguous
prepare, claim, execute, or mark response becomes an authenticated
`RECONCILIATION_REQUIRED` result; the recorder never automatically retries
`RECORD`. Exact signal, intent/evidence/deadline identity, row shape, producer
review, approval, and Ethereum/Solana freshness drift fail closed. There is no
generic query fallback, loop, network/provider capability, registration,
feature export, runtime composition, credential, or database grant.

The recorder deliberately does not claim that `deadlineAt - observedAt` is at
most 30 seconds. That bound belongs to the producer's private `evaluatedAt`, which
is not present in the recorder request, and is preserved by authentic pre- and
post-query producer review.

The finalizer closes only the local candidate-classification source gap. It
does not update migration `0029`, persist an assessment, create a position
snapshot, or grant a downstream ledger capability. Even an authenticated
`FINALIZED` classification is display-only here; the recorded candidate remains
`PROVISIONAL`, `DISPLAY_ONLY`, and `mayAuthorizeFinancialAction: false` until a
separately reviewed and activated authority boundary can consume it.

The checked-in mainnet source-pair registry is exactly empty and
`NOT_APPROVED`, and no concrete source binding is checked in. The producer has
no database writer, transport, endpoint, credential, environment lookup,
provider SDK, Nest decorator, module registration, barrel export, or runtime
composition. The finalizer, recorder, reconciliation processor, and bounded
lifecycle are likewise unregistered and ungranted, so these dormant artifacts
cannot populate migration `0029` or `0031`, contact a chain, or change any
production blocker.

Migration `0029` adds a dormant, append-only PostgreSQL boundary for global
Ethereum and Solana chain-anchor evidence plus append-only `INVALIDATED` and
`QUARANTINED` control events. Its evidence and control tables contain no account
or wallet PII columns. Every source observation ID is chain-global and canonical:
`ethereum-block-<exact anchor blockNumber>` or
`solana-slot-<exact anchor slot>`; arbitrary wallet or request identifiers are
rejected. Only the exact API role receives `EXECUTE` on the `SECURITY DEFINER`
read function, which authorizes each request against an active chain-bound wallet
before returning global evidence. The evaluation-to-deadline span is capped at
30 seconds, and deadline, approval, current-head, and finality freshness are
rechecked against database time after wallet and evidence locks.
Evidence-recording and control functions have no runtime grants and remain
schema-owner-controlled. The cumulative verifier preserves migration `0028`'s
generic-worker resolver and checkpoint suspension.

Migration `0030` refuses installation over existing `0029` evidence while an
access-exclusive evidence-table lock prevents the legacy owner writer from
racing the empty-history check. It adds an append-only, wallet-free sidecar with
fixed version/use and false persistence/financial-authority fields. Each row
durably binds the evidence fingerprint to its original canonical producer
deadline and exact database `recorded_at` through a domain-separated SHA-256
digest. The sidecar references the evidence row, and a reverse `DEFERRABLE
INITIALLY DEFERRED` foreign key makes a direct legacy `0029` writer call fail at
commit unless the matching sidecar exists.

The owner-only guarded function requires `READ COMMITTED` and uses the same
read-binding advisory transaction lock for `RECORD` and `RECONCILE_ONLY`.
`RECORD` checks for an exact existing evidence/deadline binding first, samples
canonical database time immediately after the lock, and never calls the old
writer if already late. Its one writer call and sidecar insert run in a
subtransaction; a late or regressing post-call database clock rolls both back.
`RECONCILE_ONLY` takes the same lock but performs reads only and never invokes
the old writer. It returns `IDEMPOTENT_REPLAY` only for exact evidence with its
matching original deadline binding, `NOT_RECORDED` for absence, and
`DEADLINE_VIOLATION` for a missing, invalid, mismatched, or late deadline
binding; conflicting evidence raises and fails closed. Migration `0030` adds no
runtime grants, registration, deployment, or live evidence.

Migration `0031` refuses installation when migration `0029` evidence or
migration `0030` deadline history already exists. It adds a retained,
wallet-free intent table whose canonical identity binds the evidence
fingerprint and producer deadline. Append-only and transition guards allow at
most one record dispatch, store only domain-separated SHA-256 dispatch and
reconciliation lease-token digests, and reject invalid or regressing lifecycle
state. Deferred foreign keys and a deferred terminal trigger bind terminal
evidence/deadline rows back to the exact durable intent. A due-intent lease uses
`SKIP LOCKED` and supports only bounded `NEW`, `RECORD_DISPATCHED`, and `UNKNOWN`
recovery. Migration down refuses any evidence, control, deadline, or intent
history.

The separate dormant reconciliation port gives callers no intent-selection,
token, storage, or financial authority. Its PostgreSQL processor creates one
private nonzero 32-byte lease token, leases at most one due unresolved intent,
and performs at most one `RECONCILE_ONLY` statement. It never calls `RECORD`,
does not expose or release the lease, returns an opaque authenticated
`IDLE`/terminal/`DEFERRED` result, and zeroes the raw token after use. It is a
direct-import-only source artifact with no timer, decorator, module, barrel,
controller, environment, endpoint, credential, or network capability.

The dormant direct-import-only reconciliation lifecycle adds a bounded caller-
invoked runner around that one-shot processor without registering or scheduling
it. It processes requests sequentially, permits only one run at a time, accepts
an exact false-authority request, and bounds each run to 1 through 64 attempts
and 10 milliseconds through 30 seconds. An injected timer and monotonic clock
enforce the deadline; one internal abort signal reaches every processor attempt,
and external abort, deadline, retry deferral, work limit, idle state, and cleanup
have fixed reviewed outcomes. Each opaque processor result is authenticated
against the exact generated request before inspection. Importing or constructing
the lifecycle starts no work, and it has no provider, network, database,
persistence, logging, or financial-action capability of its own. It remains
absent from the module, barrel, controller, CLI, and runtime composition.

Physical commit acknowledgement is still not guaranteed: a rejected query or
interrupted connection can leave the original caller uncertain whether the
transaction committed. Migration `0031`, recorder V2, and the one-shot
processor close the local durable pre-dispatch intent and source-only recovery
implementation gap, and the lifecycle adds a local bounded run/abort/cleanup
policy around the processor. They do not close runtime scheduling, workload
ownership and shutdown integration, logging/redaction, database-principal/grant,
deployment, or live recovery evidence.

The private dormant composition accepts no raw trust dependency. It constructs
the concrete PostgreSQL reader from its owned `PostgresService`, constructs the
assembler inside the owned-resource rollback boundary, and passes that local
assembler—not the raw reader—to the coordinator. Raw durable-reader and
trusted-assembly dependencies are rejected. Neither the outer facade nor its
reader sub-capability exposes the durable reader or assembler.

The coordinator binds the account, evaluation time, correlation ID, and exact
shared signal into the roster request. The adapter and PostgreSQL repository
each capture that signal once; the service preserves the parsed account ID and
forwards the same signal through the repository port. The signaled repository
path uses `PostgresService.queryWithCancellation`, while the existing unsigned
portfolio path remains an ordinary query. The selected sources reject signal
drop/substitution, detached `Promise.race` work, and query fallback. The shared
PostgreSQL service rechecks cancellation after pool acquisition and drains query
settlement and teardown before returning.

The deadline-runner inspection permits only its reviewed, 30-second-bounded
timer capability; it requires cancellation authority, post-operation deadline
validation, started-operation settlement, and timer and abort-listener cleanup
while rejecting network, environment, dynamic-import, and decorator
capabilities. It also confirms that the pinned feature module, barrel, and HTTP
controller do not register or expose the coordinator, PostgreSQL durable reader,
PostgreSQL recorder, record-intent reconciliation processor, bounded
reconciliation lifecycle, trusted assembly, deadline runner, runtime-budget
resource, or runtime composition.

The current exact source passes local inspection. The mainnet feature module now
registers only a lifecycle owner and its narrow reader-v3 token. The owner's
source-authored mainnet registry is exactly Ethereum plus Solana, empty,
`NOT_APPROVED`, and `DISABLED`; it cannot be populated through environment or
secret input. Its frozen null-prototype reader rejects as unavailable without
inspecting the request and owns no provider, endpoint, credential, database,
timer, writer, or asynchronous work. No provider-position route or transaction
capability is exposed.

Separately, the dormant runtime-budget resource constructs a lazy pool from its
owned reviewed API configuration and returns that pool with the exact frozen
admission-options snapshot. A private dormant composition consumes that exact
pool and options object into the concrete PostgreSQL -> wallet repository ->
wallet service -> portfolio wallet reader -> deadline runner -> private
PostgreSQL durable reader -> private trusted assembler -> coordinator graph. Its
outer facade retains
diagnostic admission, admission-and-assembly, and memoized close operations. A
separate frozen null-prototype reader sub-capability exposes only its three
version fields and `readCurrentPositions`; it invokes only the
descriptor-captured `admitAndAssemble` method and exposes no raw candidate,
trusted verifier, pool, close, persistence, or financial-action authority.
Construction performs no query or provider call; downstream construction
failure drains the owned PostgreSQL service when present and ends the same pool.

Composition close first seals and aborts coordinator admission, attempts every
captured active controller even if one abort throws, closes/drains PostgreSQL
roster work, waits all admitted facade calls, and only then ends the pool. The
runtime-budget resource, composition, sources, assembler, durable reader,
recorder, finalizer, and deadline runner remain absent from the feature module,
barrel, and controller. The registered token therefore closes only the inert
application wiring gap; it does not activate the private dormant graph.

Launch readiness remains blocked by
`PROVIDER_POSITION_RUNTIME_ACTIVATION_POLICY_NOT_APPROVED`,
`PROVIDER_POSITION_APPROVED_SOURCE_BINDINGS_MISSING`, and
`PROVIDER_POSITION_DEPLOYED_EVIDENCE_MISSING`. The inert token registration does
not clear these blockers: the dormant producer is not composed, its checked-in
production registry approves no pair, the finalizer is not composed, no live
evidence-source implementation exists, and the concrete assembler, PostgreSQL
reader, recorder, and reconciliation processor have no owner-authorized
workload, principal, credential, grant, composition, schedule, deployment, or
populated evidence claim. The private composition is not registered in the
Nest/module/HTTP graph, no runtime is activated, and no deployment or live
evidence exists. The live-provider count, `liveReadEvidenceBound`, and
`transactionEvidenceBound` therefore all remain zero. The concrete
runner remains dormant and unregistered. Provider sources must cooperate with
abort and settle before the runner can return. Wallet-roster cancellation now
reaches the PostgreSQL query boundary, but active `pg` pool acquisition has no
native signal cancellation. Acquisition and its subsequent teardown may
therefore extend beyond the logical admission deadline. The local resource
rejects a `connectionTimeoutMs` greater than its admission bound and the dormant
composition consumes its exact returned options, but no deployed binding or
hard end-to-end latency evidence exists. A started provider that ignores abort
can still delay composition close indefinitely; physical work is never allowed
to escape merely to make shutdown appear bounded.
The inspection has a private in-process brand and rejects missing, extra,
accessor, symbol, proxy, oversized, non-string, or byte-drifted inputs. It reads
local source only; it neither invokes these components nor performs network,
chain, provider, cloud, secret, transaction, or billable operations.

This check does not claim a recursive dependency closure or scan every
application module for alternate registration. Shared launch roots and some
dependencies have separate preflight pins, but a future implementation still
requires candidate-wide dependency, module-graph, and deployment review before
any feature-registration blocker can be replaced with live evidence.

The offline ingestion boundary is opt-in only:

```powershell
npx tsx scripts/production-go-live-preflight.ts `
  --evidence-bundle <controlled-canonical-json-path> `
  --release-manifest <verified-release-manifest-path> `
  --source-revision <current-clean-40-hex-revision> `
  --public-launch-authority-decision <seven-role-canonical-json-path>
```

The first three technical-evidence arguments are required together and are
rejected with the `mainnet-write` target. The authority path is accepted only
alongside that complete trio. Supplying the technical trio without the
authority path is allowed so the report can return
`PUBLIC_LAUNCH_AUTHORITY_DECISION_MISSING` with exit code `1`; an authority path
alone, a partial trio, a duplicate option, or a missing option value is an
argument error with exit code `2`.

The evidence path must identify a nonempty, single-link regular file capped at
256 KiB. Every existing intermediate path component and the final path is
checked for a symbolic link or Windows junction before and after the read. The
file is read twice through one descriptor; both byte sequences must match, and
the opened file's identity, link count, size, and timestamps must remain stable.
The authority-decision file has the same fail-closed link, regular-file,
identity, and double-read requirements with a 128 KiB cap.
There is no environment variable, default path, directory scan, secret-store
lookup, or network fallback for either controlled artifact. Input must be
strict UTF-8 and the entire file must be the compact, sorted-key canonical JSON
representation of the closed schema; a BOM, trailing newline, duplicate or
unknown field, malformed encoding, and noncanonical whitespace are rejected.

The release manifest is not a caller-provided revision assertion. Preflight
accepts only the exact object branded by
`loadAndVerifyReleaseManifest(workspaceRoot, path, expectedRevision)`, which
requires the requested revision to be the current clean `HEAD`/tree and
recomputes the fixed release components. The signed
`releaseCandidateManifestSha256` must equal that object's domain-separated
`payloadSha256`, and the bundle revision must equal its source revision. The
same branded manifest and source state are revalidated after bundle verification
and immediately before evidence application.

The closed schema-v3 bundle is `READ_ONLY`. It binds canonical issuance/expiry
timestamps, the branded release candidate, platform-directory SHA-256, a
checked-in deployment-target ID and SHA-256, direct authentication-deployment,
RDS-master-lifecycle, external-egress, and RPC-live observations, and the
live-read evidence index. The v3 signing domain covers the complete new shape;
a legacy schema-v1/v2 bundle or v1/v2-domain signature fails closed rather than
being silently upgraded.

The nested live-read index is schema v2 and has one exact, ordered
schema-v1 provider record for each of the fixed ten-provider scope: six on
Ethereum mainnet and four on Solana mainnet. Each record binds its exact
provider/protocol/network tuple; deployment, runtime, and market identities;
asset, oracle, pause/cap, and code evidence digests; distinct source and
operator identifiers; finalized anchor, freshness, and finality evidence;
read-only fail-closed adapter behavior; a retained sanitized-capture digest;
risk acceptance; provider/network kill-switch exercises; monitoring, spend,
and outage/runbook evidence; and a separate independent acceptance decision.
The index source revision and directory digest must equal the outer bundle and
the active platform directory, and its observation deadlines are revalidated
with the bundle. These hashes and references are signed attestations, not live
chain probes: validation does not open the retained captures, establish source
operator independence, or prove that any referenced deployment, observation,
decision, or exercise occurred.
Arbitrary evidence paths, reference IDs, and caller-asserted artifact hashes are
not part of an authority decision. `mainnetWriteEvidenceIndex` must be literal
`null`; write scope, action-binding, simulation, reconciliation, or financial-
authorization claims fail the closed schema. The validity window is at most 24
hours, each observation must precede issuance by no more than one hour, issuance
cannot be in the future, and expiry is exclusive. Freshness is checked when the
bundle is verified, when it is applied, and whenever the exact branded input is
evaluated.

Every accepted payload needs an Ed25519 quorum over identical domain-separated
canonical bytes: one `DEPLOYMENT_EVIDENCE_ISSUER` and one separately scoped
`INDEPENDENT_RELEASE_VERIFIER`. Role, scope, key ID, and signature are closed
fields. The two roles must use distinct key IDs and distinct public-key material;
one physical key cannot occupy both roles. Additional recognized release-review
signatures may be cryptographically retained in the technical bundle, but
cannot replace either technical role, increase this read-only evidence
authority, or satisfy the separate public-launch authority gate.

`PUBLIC_LAUNCH_AUTHORITIES` is a non-bypassable check in both read-only and
mainnet-write readiness. It requires one distinct, current Ed25519 decision for
each exact `PUBLIC_MAINNET_LAUNCH` role: Legal Public Launch, Regulatory
Compliance, Privacy, Operations Acceptance, Independent Security, Dependency
Risk, and Deployment Owner. Every decision says explicit `APPROVED`, expires
within seven days, uses distinct key material, and signs the same binding. The
binding is derived only from the already verified technical bundle:

- `releaseCandidateManifestSha256` is the bundle's exact release-manifest hash;
- `deploymentTargetId` is the bundle's exact checked-in target ID;
- `deploymentTargetConfigurationSha256` is the bundle's exact
  `deploymentTargetSha256`; and
- `productionEvidenceBundleSha256` is the bundle's exact `bundleSha256`.

The public-launch artifact and signing domain are schema version 2. Omitting or changing the
technical-evidence bundle hash invalidates all seven signatures, so a version-1 decision or an
approval replayed with replacement technical evidence fails closed.

The CLI does not accept any of those binding values from separate arguments.
It loads the authority artifact only after technical-evidence verification and
then, immediately before calculating readiness, revalidates the branded
technical bundle, current clean release-manifest/worktree state, evidence
expiry, and the authority decision's private production brand, signatures,
binding, and expiry. Test-registry results, booleans, structural copies, stale
decisions, and caller-created bindings emit
`PUBLIC_LAUNCH_AUTHORITY_DECISION_UNVERIFIED`; they cannot clear the check. See
the [public launch authority gate](public-launch-authority-gate.md) for the
closed format and filesystem boundary.

Trust anchors come only from the exact checked-in authority-key registries; an
artifact cannot add a key or change key role/scope. Both the technical-evidence
and public-launch registries have no approved key today. The exact checked-in
deployment-target registry is also empty. A future schema-v2 target record and
the v2 target-hash domain must bind environment, AWS account and region, HTTPS
public origin, coherent Cognito pool/client/login-host/issuer values, and
immutable digest-pinned image plus task-definition identities for the API, web,
outbox worker, and migration task. Its closed `rds` block must identify the
CloudFormation stack ID, database instance ARN, database resource ID,
RDS-managed secret ARN, and application-data KMS key ARN. API, worker, and
migration may share an image digest, but all task-definition revisions must be
distinct. Adding either a key or a target is a separate reviewed source change
and has not happened here.

Verified evidence may only supplement the closed live/deployed evidence fields,
the manifest-bound source revision, and signed live-read index. It cannot
override the repository's authentication wiring inspection, RDS-managed-master
template inspection, egress policy status or mode, RPC
decision/approval/runtime status, platform directory, or any other local
approval boundary. A signed claim therefore cannot turn `NOT_APPROVED` into
`APPROVED`; those repository-side blockers continue to win. Outer schema v3 always
sets supplied write evidence to `null` and cannot affect mainnet-write
readiness.

For the current release decision, the only active mainnet networks are
Ethereum and Solana. The ten-provider target is the exact six-Ethereum/four-
Solana planning set in the [production go-live plan](production-go-live-plan.md).
Base and BNB Smart Chain are deferred. A preflight or evidence total that
includes either deferred chain cannot satisfy the active launch target.

Exit code `1` means at least one named blocker remains. Exit code `2` means the
arguments or controlled evidence were rejected. CLI failures are reduced to
`PRODUCTION_PREFLIGHT_ARGUMENT_INVALID` or
`PRODUCTION_PREFLIGHT_EVIDENCE_BUNDLE_INVALID`, or
`PUBLIC_LAUNCH_AUTHORITY_DECISION_INVALID`; paths, artifact contents, key
material, parser details, and signature details are never printed. Structural
or synthetic technical inputs cannot return exit code `0` without the private,
current seven-role production decision brand. The checked-in empty registries,
missing infrastructure deployment authority, and missing deployed evidence
independently make exit code `0` impossible today. Even after independently
approved keys, evidence, decisions, and a deployable production path exist,
`LOCAL_VALIDATION_IS_NOT_PRODUCTION_APPROVAL` remains in the report.

The audit reads only local repository, non-secret artifacts: selected KAN-34
environment-contract and guard markers, ECS environment and secret-reference
names, the inert KAN-231 egress example, the KAN-62 provider decision record and
digest, the exact dormant ten-provider adapter/spec/research inventory, the
bounded API runtime-source tree, and the mainnet platform capability directory. It
parses the egress record as strict UTF-8 JSON and rejects byte-order marks or
duplicate object keys before evaluating its status, mode, or evidence fields. It
loads that record through the same bounded, canonical-path, stable double-read
boundary used by the standalone egress gate. It
derives KAN-62 local validation and every provider approval/runtime field from
one immutable parsed snapshot of the exact decision bytes bound by that digest;
it never re-reads status fields from a second, potentially different snapshot.
Both controlled files must be non-empty, bounded, single-link regular files at
canonical repository paths. Each file is descriptor-bound and read twice, so a
linked path, path replacement, size change, metadata change, or same-size rewrite
fails closed behind one sanitized validation error.
The decision must also be strict UTF-8 JSON without a byte-order mark or
duplicate object keys at any depth. Recomputing the SHA-256 sidecar cannot make
an ambiguous duplicate-key document eligible for local validation.
The provider-decision parser does not scan implementation source for status
phrases or accept catalog status strings as adapter evidence. A separate
dormant-inventory check requires the exact six Ethereum and four Solana adapter,
hostile-path spec, and research artifacts; false persistence, recommendation,
and financial-authority markers; no Nest registration decorator; and no exact
adapter class or import-stem reference elsewhere in the bounded API runtime
source scan. Artifact reads are capped at 2 MiB each, and the runtime scan is
capped at 4,096 files and 24 MiB total. Decision validation and dormant-inventory
validation have distinct blockers, and both must pass for `RPC_INDEXING` local
validation to pass. Gearbox's pure account-position transcript from `5fcc7ca`
is separately byte-pinned by inventory commit `040e93a`; the inventory rejects
runtime references or any attempt to count that unauthenticated, incomplete
evaluator as source seven. The separately validated dormant mainnet action boundary
must pass `READ_ONLY_ISOLATION` and `MAINNET_WRITES`; its failure emits
`MAINNET_ACTION_BOUNDARY_LOCAL_VALIDATION_FAILED`, never an RPC inventory blocker.
Since `ee9204d` and `a387124`, that validator independently pins migration
`0033`, its focused specification, and exact migration-index registration.
Commit `5976d32` corrects initial signed-submission binding and adds a guarded
transition case. The validator now also pins the direct-import-only durable port,
PostgreSQL adapter, focused unit specification, and guarded loopback integration
specification added in `b7289ac` and `b0b39d9`. It requires owner-only
append-only lifecycle state, digest-only private evidence, post-bind crash
recovery, and no runtime registration, database grant, route, worker, signer,
broadcaster, retry, settlement, or other financial-action authority. Commit
`a61bb57` separately supplies three isolated test-schema/verifier-control cases
against disposable PostgreSQL 16.

Validator commit `f81273c` extends that exact boundary through the finality
source contract and producer, one-shot PostgreSQL sidecar, and owner-only
migration `0035`, including every focused unit/integration artifact and the
production/test migration-index tail. Its semantic checks retain exact
Ethereum/Solana and `SUPPLY`/`WITHDRAW` scope, two distinct sources, earliest
deadline/authority/evidence expiry, cooperative abort, legacy terminal-write
exclusion, frozen one-shot cursor provenance, the 24/25/2-argument SQL
allowlists, empty authority tables, deferred authenticated admission, and sticky
post-finality quarantine with every returned financial-action, signing,
broadcast, resend, settlement, and ledger capability false. The runtime scan
now includes `.tsx` and rejects add/remove/rename races by comparing a bounded,
metadata-bound tree inventory before and after secure reads. All 30 focused
cases pass.

The adapter accepts only the registry's active USDC, USDT, and PYUSD identities
on Ethereum and Solana mainnet and an exact static allowlist of six Ethereum and
four Solana provider/protocol bindings. These are input restrictions, not live
providers: the live-provider count remains 0/10. Each database method validates
before I/O and can issue at most one fixed migration-`0033` function call,
without a loop or automatic retry. A thrown, aborted, or malformed post-dispatch
result is `DATABASE_OUTCOME_UNKNOWN`; post-wallet ambiguity is
`READ_THEN_RECONCILE_ONLY` and cannot authorize resend.

This boundary remains unregistered and ungranted. The lifecycle adapter derives
wallet identity internally, but no concrete finality prerequisite/source adapter,
cryptographic transaction-payload/signature verification, controlled `0035`
authority population, unresolved-work claim/lease scheduler, provider credential
or approved write manifest, provider/legal/security/finance approval, or
release-bound deployed evidence exists. Migration `0035` can record a deep-reorg
quarantine locally, but no runtime review scheduler or downstream ledger-
remediation policy exists; quarantine never rewrites terminal history or
authorizes a ledger reversal.

A third independent local result validates the closed,
reviewed four-provider capture packet for Compound, Euler, Gearbox, and Jupiter,
including its exact compiled SHA-256 and sidecar. This packet covers the four
dated captures that completed the research set; it is not a substitute for the
other six providers' artifacts or evidence that any of the ten are live. Any
capture parse, shape, status, identity, hash, sidecar, path, or stable-read
failure emits
`RPC_PROVIDER_ACTIVE_SCOPE_RESEARCH_CAPTURE_LOCAL_VALIDATION_FAILED`. This does
not prove an adapter is live, approved, current, or safe to activate.

The audit does not derive application configuration from process-environment
values, read secret material or `.env` files, contact provider endpoints, or
execute adapter code. An
explicit evidence flow adds bounded local manifest/evidence reads and the
release-manifest boundary's scrubbed, noninteractive local Git inspection. It
may copy the minimum operating-system variables needed to launch trusted Git,
but does not treat them as application configuration and does not trust caller
Git control variables. The command performs no DNS,
network, cloud, provider, secret, credential, transaction, or filesystem-write
operation.

`localValidation: PASS` means only that static inspection or an artifact's
structural contract passed. `launchReadiness: BLOCKED` takes precedence when
approval, runtime evidence, production wiring, or the provider target remains
incomplete. Provider counts can advance only from a closed-shape evidence index
that is independently bound to the exact source revision and platform-directory
SHA-256. Read evidence also requires explicit adapter-binding and composition
evidence; write evidence additionally requires action binding, simulation,
reconciliation, and independent security-review evidence.

Bootstrap mode deliberately sets `sourceRevision` to `null`: reading Git `HEAD`
alone cannot prove that the index and worktree are clean. Controlled ingestion
obtains the revision from the independently recomputed and branded release
manifest, then requires the signed bundle to match it exactly. The read-only
evidence schema cannot carry a write provider set.

The read-only target has a separate isolation gate. It is blocked if the
directory exposes any financial-authorization flag, transaction-enabled status,
or supported action, including when the surrounding directory is malformed.

Separately, the production API module graph and generated OpenAPI contract omit
all synthetic local-demo and Solana/EVM public-testnet transaction controllers.
Unknown or absent runtime labels fail to that smaller graph; only exact
`development` or `test` labels may add the local harness, whose loopback gates
remain in force. API unit tests and the CI OpenAPI regeneration check protect
this route-surface boundary. It does not alter any provider approval or preflight
blocker status.

Relevant machine-readable launch blocker IDs include:

- `PRODUCTION_INFRASTRUCTURE_INSPECTION_FAILED`
- `PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_PATH_NOT_ENABLED`
- `PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_AUTHORITY_MISSING`
- `PRODUCTION_INFRASTRUCTURE_DEPLOYED_EVIDENCE_MISSING`
- `BALANCE_CONSUMER_SOURCE_ACTIVATION_DISABLED`
- `BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED`
- `BALANCE_CONSUMER_TASK_NOT_PROVISIONED`
- `BALANCE_CONSUMER_IAM_NOT_PROVISIONED`
- `BALANCE_CONSUMER_DATABASE_CAPABILITY_NOT_ENABLED`
- `BALANCE_CONSUMER_DEPLOYED_EVIDENCE_MISSING`
- `BALANCE_CONSUMER_SOLANA_EXACT_SLOT_RPC_CAPABILITY_EVIDENCE_MISSING`
- `BALANCE_CONSUMER_SOLANA_PYUSD_TOKEN_2022_POLICY_EVIDENCE_MISSING`
- `BALANCE_CONSUMER_DEPLOYMENT_MANIFEST_FINGERPRINT_APPROVAL_MISSING`
- `AUTH_DEPLOYED_EVIDENCE_MISSING`
- `DATABASE_MASTER_SECRET_NOT_RDS_MANAGED`
- `RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING`
- `REDIS_OPERATOR_SECRET_VERSION_NOT_WIRED`
- `EGRESS_POLICY_NOT_ACCEPTED`
- `EXTERNAL_EGRESS_DISABLED`
- `RPC_PROVIDER_DECISION_LOCAL_VALIDATION_FAILED`
- `RPC_PROVIDER_DORMANT_INVENTORY_LOCAL_VALIDATION_FAILED`
- `RPC_PROVIDER_ACTIVE_SCOPE_RESEARCH_CAPTURE_LOCAL_VALIDATION_FAILED`
- `RPC_PROVIDER_EXTERNAL_APPROVAL_PENDING`
- `RPC_PROVIDER_RUNTIME_NOT_APPROVED`
- `LIVE_READ_EVIDENCE_INDEX_MISSING`
- `LIVE_PROVIDER_TARGET_NOT_MET`
- `PUBLIC_LAUNCH_AUTHORITY_DECISION_MISSING`
- `MAINNET_WRITE_EVIDENCE_INDEX_MISSING`
- `MAINNET_TRANSACTION_PROVIDER_TARGET_NOT_MET`

Static inspection currently requires the complete Cognito/OIDC, API
mainnet-wallet, current pre-authentication key, all six authentication/wallet
ring-document selectors, and web-origin task wiring with its exact reviewed
values and CloudFormation expressions. It pins `NODE_ENV=production`, requires
`LOCAL_DEMO_MODE` to be absent, rejects every legacy single-key auth/wallet
selector, and checks the Cognito issuer/JWKS and login-host derivations,
client/audience reference, HTTPS callback/origin paths, algorithm, token use,
timeouts, TTLs, trusted-proxy inputs, mainnet wallet mode, and each JSON secret
selector under the one external secret ARN. Inspection also requires one exact,
top-level, no-default/no-`NoEcho` `AuthWalletKeysSecretVersionId` parameter and
binds all seven selectors to it with an empty stage. An omitted version,
`AWSCURRENT`, `AWSPREVIOUS`, alternate version parameter, counterfeit nested
parameter, nonempty substitute, alternate `!Ref`/`!Sub`, attacker-controlled
host, wrong selector, extra legacy field, or safe-looking mode change is not
counted as the required binding and emits the applicable
configuration/reference blocker. The current exact template omits those local
wiring blocker IDs and remains at zero desired tasks. This proves only that the
authored template matches the migration-`0025` fail-closed configuration
contract; it does not prove that the secret/version exists, its rings are valid,
or a task can read it.

The same offline inspection loads the exact parent, workload-boundary child,
and observability child for the Redis break-glass credential. It requires one
explicit no-default `RedisOperatorSecretVersionId` propagated to both children,
an all-seven inert `UNPINNED` adoption gate, an off/passwordless operator user
before adoption, and the same exact stage-free version in the ElastiCache user
and conditional ECS revocation task. Omitted versions, `AWSCURRENT`,
`AWSPREVIOUS`, alternate parameters, mismatched child propagation, or an enabled
unpinned task emit `REDIS_OPERATOR_SECRET_VERSION_NOT_WIRED`.

Separate from that authored-template check, the repository now has a schema-v3
fixed-slot state with append-only Redis operator VersionId history, a dedicated
two-role-signed Redis-operator validator, and a deployment-integrated
`REDIS_OPERATOR_TRANSITION` intent. The local path accepts only no-op chain
adoption or one fresh VersionId append while the operator stays disabled and
its task stays absent; it binds the Redis, composite credential, and preserved
auth/wallet predecessors and constrains the reviewed nested change to the exact
operator-user authentication update. The production Redis-operator authority
registry is intentionally empty. This preflight does not ingest that transition
artifact or treat the local guard as live evidence: no operational record is
authorized, and no secret staging, AWS/Redis operation, deployment, or rotation
has occurred. External custody, signatures, approvals, live capture,
candidate/old-credential authentication, continuity, recovery, and deployed
verification remain blockers.

Parent-template inspection separately requires the RDS database to use the
literal `crypto_admin` master username, `ManageMasterUserPassword: true`, and
`MasterUserSecret.KmsKeyId: !GetAtt ApplicationDataKey.Arn`. It rejects a
custom `DatabaseCredentialsSecret`, any `MasterUserPassword` or Secrets Manager
dynamic reference, a different KMS binding, and a compatibility output that is
not exactly `!GetAtt Database.MasterUserSecret.SecretArn`. Missing or altered
wiring emits `DATABASE_MASTER_SECRET_NOT_RDS_MANAGED`. This check proves only
the exact hash-bound authored RDS-managed boundary; a private in-process brand
prevents callers from clearing it with a forged pair of success booleans. It
cannot prove the managed secret exists, uses the intended live key, is readable
only by the bootstrap operator, or follows the default seven-day rotation. A
recovery exercise must establish and bind the restored or replacement
database's managed-secret ARN; the original secret need not survive. Those
items remain deployed evidence and recovery gates.

The outer two-role-signed schema-v3 bundle now covers the closed nested
schema-v1 `rdsMasterLifecycleEvidence` record with type
`RDS_MASTER_LIFECYCLE_EVIDENCE` and status `ACCEPTED`. It binds the literal
`crypto_admin` master username, primary and restored database identities,
managed-secret ARNs and VersionIds, compatibility-output ARN, and
application-data/managed-secret KMS identities. Exact `PASS` fields cover
bootstrap IAM/KMS access, application and migration isolation, master-session
drain, completed managed rotation, new authentication, old-password denial,
runtime-credential continuity, and restore/rebinding. Its closed schema-v1
`supportingCapture` metadata names `RDS_MASTER_LIFECYCLE_CAPTURE` in
`SANITIZED_CANONICAL_JSON_V1` format, a lowercase `captureSha256`, and collection
start/completion timestamps. The outer signatures cover that digest, but the
validator deliberately does not open the separately retained capture file; the
issuer and independent verifier must each calculate the canonical capture hash
and match `captureSha256` before signing.

The primary database ARN, resource ID, managed-secret ARN, and application-data
key ARN must exactly match the schema-v2 deployment target's closed `rds` block;
the outer signatures also cover the v2 target digest, which includes that block's
CloudFormation stack ID. The
compatibility output and primary managed-secret ARN must agree, both primary and
restored secret KMS bindings must equal the target application-data key, and the
restored database and secret identities must be distinct and
target-account/Region bound. Primary, rotation, and restored managed-secret
status must be literal `active`; the current/previous rotation versions must be
distinct and labeled `AWSCURRENT`/`AWSPREVIOUS`, and the rebound restored version
must be labeled `AWSCURRENT`. Time ordering is closed as
`collectionStartedAt <= access.observedAt <= rotation.startedAt <
rotation.completedAt <= restore.startedAt < restore.completedAt =
collectionCompletedAt = observedAt`, within a maximum 24-hour capture window.

Preflight accepts that nested record only through the current outer
two-role-signed schema-v3 bundle bound to the exact release and deployment
target. Repository/no-bundle input, an absent or forged acceptance flag, and an
unbranded structural copy emit `RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING`. A
malformed, already stale, counterfeit, wrong-artifact/status/field, or
identity-mismatched bundle is rejected during load/application with the
sanitized `PRODUCTION_PREFLIGHT_EVIDENCE_BUNDLE_INVALID` error and produces no
preflight report. The exact branded input is revalidated during evaluation; if
previously accepted evidence later becomes stale,
`RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING` returns, and a bound launch decision can
additionally fail public-authority revalidation with
`PUBLIC_LAUNCH_AUTHORITY_DECISION_UNVERIFIED`. This validates the signed
attestation, not RDS itself; collecting the authorized live evidence remains
external and no such record or capture exists today. The controlled record and
capture contain operational identifiers only. Passwords, `SecretString`,
connection material, and logs are forbidden, and neither the controlled bundle
nor separately retained capture may be checked into Git or Jira.

`AUTH_DEPLOYED_EVIDENCE_MISSING` remains by design: the repository neither
provisions nor contacts Cognito, Secrets Manager, or KMS, and the inspector never
converts authored YAML into deployed acceptance.

The separate balance-sync source/DLQ, publisher wiring, and standalone hard-zero
consumer envelope likewise cannot clear a live-read blocker. No consumer is
composed or provisioned, no receive/delete IAM capability is deployed, and no
database authority or Ethereum/Solana RPC egress is active. Consequently
`BALANCE_CONSUMER_TASK_NOT_PROVISIONED`,
`BALANCE_CONSUMER_IAM_NOT_PROVISIONED`, and
`BALANCE_CONSUMER_DEPLOYED_EVIDENCE_MISSING` remain intentional blockers, along
with every database, external-egress, RPC/provider, authentication, authority,
and other production blocker described by the report.

The database source contract is therefore locally closed but operationally
blocked: no live PostgreSQL acquisition timeout, forced client discard, exact
pool-removal drain, aggregate watchdog, or ECS physical-stop evidence has been
collected. Preflight must not convert these source checks into deployment or
live-read readiness.

Run the focused checks with:

```powershell
npm run lint:production:preflight
npm run typecheck:production:preflight
npm run test:production:preflight
```

For the finality-aware provider-position preflight milestone implemented in
`387a2dc` and verified in `7f7347a`, all 64 focused cases in
`production-go-live-preflight.test.ts` passed for the then-current 38-artifact
slice. The later Aave, Kamino, Compound, and Spark preflight integrations are
committed in `ecff5b9`, `b41cc62`, `91bd9bc`, and `2978367`; the resulting exact
42-artifact slice passed all 68 cases in a current focused rerun.
Registration commit `7617800` adds the separately pinned inert runtime owner and
module wiring; that 43-artifact slice passed all 81 focused cases. Morpho/Euler
source commits `5910ebf` and `d478f3b`, inventory commit `a77a57e`, and preflight
commit `5550fbf` bring the current provider-position boundary to 45 artifacts and
85 passing focused cases. A dedicated inventory validator covers Gearbox
commits `5fcc7ca` and `040e93a`, while the dormant-action validator covers
`ee9204d`, `a387124`, `6ef71ff`, and the `0034`/adapter attestation in `51967aa`;
`a61bb57`, `b0b39d9`, `9af00ef`, and `79c4b71` supply separate disposable
PostgreSQL integration coverage. None enlarges that provider slice. The
authenticated-finality commits `bae3116`, `3e3ce75`, `e7e27b7`, and `4f0a79f`
are pinned by boundary commit `f81273c`. Preflight rebaseline `413af59` pins the
reviewed whole-API runtime snapshot at 403 files and 6,704,387 bytes with
SHA-256 `d1854a4f4e55ed4321e06a7bf6684bdf164f82819b8a4e751c0c94b8747621e5`.
The record-intent migration was also exercised
in a disposable local PostgreSQL 16 instance: all six focused integration cases
passed, covering clean up/down/up migration verification, Ethereum and Solana
preparation, one-shot claim and idempotent replay, expired-`NEW` reconciliation,
invalid dispatch-token rejection, and deferred-constraint rollback of a direct
late record. This is local database evidence only; it is not production
PostgreSQL, provider, mainnet, deployment, or external-service evidence.

Migration `0033` separately passed the three focused disposable PostgreSQL 16
schema/verifier-control cases from `a61bb57`: the test-schema migration chain
through `0033` plus its isolated-schema verifier, rejection of a rolled-back
reconciliation index or normalized-check tamper, and SQLSTATE `22023` rejection
of a null expected revision with zero retained history. The `5976d32` correction
adds a guarded lifecycle transition case that prepares and binds, then revokes
the wallet, fails the linked yield operation, and directly reconciles an
`UNKNOWN` result without a broadcast event, resend, or ledger authority. The
`b0b39d9` guarded adapter integration case additionally exercises prepare, bind,
direct reconciliation, authenticated result review, and read through the
shipped adapter. These use unique disposable schemas on loopback PostgreSQL 16
and digest-only private evidence. They do not run the production-principal
verifier or prove a provider, signature, mainnet transaction, deployment, or
write authorization.

Migration `0034` additionally passed eight focused unit cases, the 78-case
impacted migration-order set, and five guarded loopback PostgreSQL 16 cases.
Those cases cover both launch chains, hostile and cross-wallet digest arrays,
v1-parent/v2-current key rotation, revoked replay, exact owner-only ACLs,
history-safe rollback refusal, and forced two-client intent-before-wallet lock
ordering. The address-bound adapter passed 19 focused unit cases and one
separate PostgreSQL 16 lifecycle case. Validator `51967aa` passes 24 focused
mutation cases, and preflight `d51f85e` passes all 85 focused cases while its CLI
correctly remains `BLOCKED` with 10 planned, 0 live-read, and 0 transaction
providers. This is local safety evidence only and creates no runtime grant,
provider call, signing, broadcast, settlement, deployment, or mainnet authority.

The authenticated-finality producer/source pair passes 28 focused cases and the
sidecar port/adapter passes 23. Migration `0035` passes 10 focused unit cases,
the impacted 9-suite/88-case migration-order set, and 6 guarded loopback
PostgreSQL 16 cases spanning Ethereum and Solana admission, direct legacy-bypass
rejection, concurrent exact replay, authority controls, historical replay with
current review state, sticky deep-reorg quarantine, owner-only ACLs, and catalog
tampering. Boundary validation passes 30/30 focused cases. The five
directly impacted preflight cases and preflight typecheck pass; the offline CLI
still exits `1` with 10 planned, 0 live-read, and 0 transaction providers and
reports zero network, DNS, cloud, provider, secret, configuration-environment,
and write calls. These results remove stale local-drift failures only; all
external approval, deployed-evidence, and runtime-activation blockers remain.

These checks are also part of the root `lint`, `typecheck`, and `test` scripts
used by CI.
