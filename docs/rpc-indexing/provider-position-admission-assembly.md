# Dormant provider-position admission and assembly boundary

Status: dormant, unregistered, read-only, and non-persistable from the
application graph. Migration `0029` defines dormant evidence persistence, and
migration `0030` adds a dormant deadline-bound record/reconcile boundary.
Migration `0031` and recorder V2 now provide retained one-shot record intents,
while a separate processor provides source-only reconciliation and a bounded
direct-import-only lifecycle can sequence processor calls when explicitly run.
No evidence writer or reconciliation schedule is composed, and none of the
private reader, recorder, processor, or lifecycle is registered, granted runtime
authority, or runtime-reachable.

## What the coordinator establishes

`DormantProviderPositionAdmissionCoordinator` is an application boundary between independently implemented provider/account readers and the existing mainnet provider-position coverage domain. For every authoritative active wallet × approved provider market, it:

1. Parses the caller-supplied approved observation policy with the existing policy parser and requires its separately supplied exact fingerprint.
2. Reads the authoritative active-wallet roster through the existing portfolio wallet port inside the same absolute-deadline runner used by later work, then parses it with `parseActivePortfolioWalletRegistrations`.
3. Derives the same wallet × market target product used by the coverage domain, using only active registry assets and policy-approved market attribution.
4. Requires one configured binding for every policy source and at least two distinct `sourceFamilyId` values for every active target's network.
5. Sends every source an account-, correlation-, deadline-, abort-signal-, wallet-, network-, provider-, protocol-, market-, and asset-bound request.
6. Accepts only exact, bounded, descriptor-safe plain-data responses marked `COMPLETE`; it rejects missing/extra fields, unknown assets, duplicate positions, malformed integers, stale evidence, and continuity-floor regressions.
7. Requires every independent source to report the exact same canonical position set and atomic balances. It never substitutes a missing response with zero. An empty set is admitted only when every required independent source explicitly and currently reports that complete empty set.
8. Canonically orders targets, positions, and source evidence, then produces deterministic SHA-256 fingerprints and a valid `MainnetProviderPositionCoverageManifestV1` with `COMPLETE` / `AGREED` targets.

Concurrency is bounded by a validated maximum of eight. The wallet-roster,
provider-source, and trusted-assembly runner invocations share one `AbortSignal`
and one exclusive server-authored deadline; every provider request receives that
exact signal. The first parallel source failure aborts it immediately, prevents
queued work from starting, and drains already-started cooperative reads before
the coordinator settles. The signal is also aborted on every failed preparation
and after either successful terminal path; it remains live through final trusted
assembly verification. The returned candidate and covered snapshot expose no
controller or signal.

Deadline enforcement remains delegated to an injected runner. A concrete Node
implementation now exists as dormant infrastructure source only. It accepts an
exclusive deadline no more than 30 seconds ahead, schedules one unreferenced
timer, invokes the coordinator's narrow admission-abort authority on deadline or
operation failure, rechecks the clock after physical settlement, and removes its
timer and abort listener on every exit. It returns only fixed, sanitized failure
codes and has no network, environment, decorator, provider, persistence, or
financial capability.

The runner deliberately awaits an already-started operation after signaling
abort; it cannot make a non-cooperative promise settle. Production provider
transports must stop and settle on the supplied signal and retain their own
lower-level transport bounds. The coordinator now also passes the exact shared
signal through the optional portfolio wallet-reader request, the registered
reader, wallet service and repository port, and the PostgreSQL wallet
repository. The adapter and repository each capture it once to prevent
repeated-read/TOCTOU substitution. The signaled branch calls
`PostgresService.queryWithCancellation`; the legacy unsigned portfolio branch
still calls the ordinary query path. Neither
branch uses `Promise.race`, creates a replacement signal, or falls back from a
failed cancellable query.

`PostgresService` rechecks cancellation after acquiring its dedicated client,
then drains query settlement and discarded-client teardown before returning.
Active `pg` pool acquisition has no native signal cancellation, however, so
acquisition and the required drain can extend past the logical admission
deadline. A production `connectionTimeoutMs` must be no greater than the
configured admission bound. These local contracts establish propagation and
drain behavior, not a hard latency or deployed-configuration guarantee.

The coordinator owns no endpoint, environment lookup, network client, credentials, database, persistence port, writer, or financial-action capability.

## Why `admit` does not emit `MainnetProviderPositionSnapshotV1`

The existing snapshot parser correctly requires a `MainnetProviderPositionChainAssessmentV1` and an opaque trusted verifier capability. Verification is bound to all normalized observation fields, including:

- the final snapshot ID;
- observation ID and fingerprint;
- wallet/provider/protocol/market/position attribution;
- selected source identity and observation ID;
- exact chain anchor and balance;
- observed, captured, evaluated, assessed, and stale timestamps; and
- policy and asset-registry fingerprints.

Independent source results arrive before those final assembly choices exist. Their capabilities cannot safely be merged, copied, or reconstructed by this coordinator. Doing so would either bypass the existing verifier or falsely claim trusted chain identity/progression/finality.

The output therefore has:

- `mayAuthorizeFinancialAction: false`;
- `mayPersist: false`;
- `mayCreatePositionSnapshot: false`; and
- `assemblyStatus: BLOCKED_PENDING_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY`.

It contains a deterministic proposed snapshot ID, agreed normalized positions, accepted source evidence, and a parsed coverage manifest, but it is not itself a provider-position snapshot.

## Dormant trusted assembly boundary

`ProviderPositionTrustedChainAssessmentAssemblyPort` closes the in-process assembly contract. Although the coordinator retains an optional port for fail-closed construction, this private composition supplies it unconditionally. A concrete `DormantProviderPositionTrustedChainAssessmentAssembler` implements it over `ProviderPositionDurableChainAnchorReaderPort`, and a concrete `PostgresProviderPositionDurableChainAnchorReader` implements that port against migration `0029`'s exact read function. The composition constructs the PostgreSQL reader from its owned `PostgresService`, then constructs the assembler inside the same owned-resource rollback boundary and passes only that assembler to the coordinator. Callers can inject neither a raw durable reader nor a raw trusted-assembly port. None of the reader, port, or assembler is exported by the feature barrel, registered in the Nest module, or reachable from an HTTP endpoint.

The coordinator retains the same-cycle authoritative wallet roster and parsed policy rather than rereading or reconstructing either one. It deterministically selects the first canonically ordered accepted independent source for every agreed target position and builds immutable observation input. The assembly request binds:

- the complete admission candidate and its fingerprint;
- the coverage-manifest fingerprint;
- account, correlation, snapshot, policy, and asset-registry identities;
- every selected position, balance, source observation, chain anchor, and evidence timestamp;
- a server-authored evaluation time and exclusive deadline; and
- the same abort signal used by the bounded admission operation.

One server-side port instance must issue the assessment, verify the whole assembly request, and verify every normalized nonempty observation. Its exact returned object is passed unchanged as the opaque verifier capability; a structurally identical clone or deserialized object is not sufficient. The port cannot return a verifier, approval boolean, writer, persistence handle, or final snapshot. The existing coverage and snapshot parsers remain the only path to the returned covered snapshot.

The returned read-only envelope retains the original blocked admission
candidate, the exact server-authored evaluation time used by the coverage
parser, and the covered snapshot, while exposing neither the raw assessment nor
its capability. A final clock read must still pass the exclusive admission and
evidence-expiry bounds before that earlier parser time can be returned. The
coordinator records that exact envelope in a module-private `WeakSet` only
after the final gate. The composition's direct-source identity reviewer checks
issuance before extracting any result property and is not exported through the
feature barrel. The envelope explicitly has `mayAuthorizeFinancialAction: false` and
`mayPersist: false`. For every target, including a zero-position target, the
request separately carries the canonical selected source and anchor. An
independently agreed empty position set invokes whole-assembly verification
before using the coverage parser's explicit empty-snapshot path; it does not
fabricate an observation or anchor.

Assembly shares the admission deadline, captures the port's methods once without invoking accessors, is rejected if the server clock regresses or reaches the exclusive deadline or evidence-expiry boundary before or after verification, and aborts the shared signal when the operation finishes. A failed port, counterfeit capability, missing or extra assessment entry, changed source/anchor, or parser rejection returns no partial snapshot and is sanitized to `ASSEMBLY_UNAVAILABLE`.

## Required production binding

Migration `0029` adds append-only global Ethereum/Solana chain-anchor evidence
and append-only `INVALIDATED`/`QUARANTINED` controls. Neither table has account
or wallet PII columns. Its one runtime grant is exact API-role `EXECUTE` on a
`SECURITY DEFINER` read function that first requires an active chain-bound
wallet; its record and control functions have no runtime grants and remain
owner-controlled. The cumulative verifier preserves migration `0028`'s
generic-worker balance-authority suspension. A source observation ID must be
one of the canonical chain-global evidence identities
`ethereum-block-<exact anchor blockNumber>` or
`solana-slot-<exact anchor slot>`, rather than an arbitrary wallet or request
identifier. The read boundary also caps the
evaluation-to-deadline span at 30 seconds and rechecks the deadline, approval,
current-head, and finality freshness against database time after wallet and
evidence locks.

Migration `0030` refuses installation if any `0029` evidence already exists,
holding an access-exclusive lock so the legacy owner writer cannot race that
check. Its append-only, wallet-free sidecar binds each evidence fingerprint to
the original canonical producer deadline, exact database `recorded_at`, fixed
version/use and false persistence/financial-authority fields, and a
domain-separated SHA-256 digest. The sidecar references the evidence row, and a
reverse `DEFERRABLE INITIALLY DEFERRED` foreign key requires every new evidence
row to reference the sidecar before commit. A direct legacy `0029` record call
therefore cannot commit an unbound row.

The new owner-only guarded function requires `READ COMMITTED` and serializes
both modes on the same read-binding advisory transaction lock. `RECORD` resolves
an exact existing evidence/deadline pair before considering a write, samples
canonical database time immediately after acquiring the lock, and does not call
the old writer when already late. Its single old-writer call and sidecar insert
share a subtransaction; a late or regressing post-call database clock rolls both
back. `RECONCILE_ONLY` acquires the same lock but performs reads only and never
calls a writer. It returns `IDEMPOTENT_REPLAY` only for exact evidence with its
matching original deadline binding, `NOT_RECORDED` for absence, and
`DEADLINE_VIOLATION` for a missing, invalid, mismatched, or late deadline
binding; conflicting evidence raises and fails closed. No runtime principal
receives a grant on the new table or functions.

Migration `0031` refuses installation over existing evidence or deadline
history. It adds a retained, wallet-free record-intent table whose identity
binds the evidence fingerprint and original producer deadline. Its append-only
and transition guards permit at most one record dispatch, retain only
domain-separated SHA-256 dispatch and reconciliation lease-token digests, and
reject invalid or regressing state. Deferred foreign keys and a deferred
terminal trigger bind terminal evidence/deadline rows to the exact intent. A
`SKIP LOCKED` lease selects only due `NEW`, `RECORD_DISPATCHED`, or `UNKNOWN`
work. Rollback refuses any evidence, control, deadline, or intent history. The
table and every new function are revoked from `PUBLIC`, API, worker, legacy,
balance-consumer, and migration runtime roles.

Recorder V2 prepares this durable intent before any record dispatch, generates
one private nonzero 32-byte dispatch token, claims the one allowed dispatch,
and executes migration `0030`'s guarded `RECORD` operation at most once. An
ambiguous prepare, claim, execute, or mark response yields only an authenticated
`RECONCILIATION_REQUIRED` result; the recorder never retries `RECORD`. The raw
token is zeroed after use. The separate dormant one-shot processor generates
and zeroes one private lease token, leases at most one due intent, and invokes
only `RECONCILE_ONLY`. It cannot select an intent supplied by its caller,
release a lease, or dispatch a record, and it has no timer or module
registration.

The dormant lifecycle processes those one-shot calls sequentially only after an
explicit `run`, rejects overlapping runs, authenticates every opaque processor
result against its exact generated request, and returns fixed non-authorizing
run outcomes. Reviewed policy bounds it to 1 through 64 work items and 10
milliseconds through 30 seconds. It propagates external abort through one
internal signal, waits for authenticated `retryNotBefore` only inside the run
deadline, and cleans up the injected deadline/retry timers and abort listeners.
Import and construction start no work. The lifecycle has no provider, network,
database, persistence, logging, or financial-action port and is absent from the
module, barrel, controller, CLI, and runtime composition.

Production still needs reviewed live implementations for both members of each
approved source pair, an owner-authorized recorder workload, principal,
credential, and grant, a reviewed runtime reconciliation schedule and workload
shutdown integration, logging/redaction controls, populated evidence,
production registration, and deployed proof. The local private wiring constructs
the PostgreSQL durable reader unconditionally from the same owned
`PostgresService`, after the deadline runner and before the assembler and
coordinator, and never exposes the reader or assembler through the facade or
reader sub-capability. The local assembler already binds each exact
Ethereum or Solana target and selected source to its continuity floor, anchor,
evidence times, candidate fingerprint, account, correlation ID, deadline, and
shared abort signal. It authenticates the opaque reader result against the exact
request before inspection, rejects unissued values and clones, validates
progression/finality/freshness, and issues an object-identity assessment
capability bound to the original whole-assembly request and exact
observation-verification contexts.

The concrete PostgreSQL reader descriptor-captures only
`queryWithCancellation`, sends the exact 13 migration arguments and admission
signal, rejects nonzero unexpected cardinality, strictly reviews the returned
row and canonical anchors/timestamps/statuses, and seals its opaque result to the
exact request identity in a private `WeakMap`. It has no writer function or
ordinary-query fallback. Admission source review, observation parsing, this
reader, and migration `0029` all derive the same chain-global observation ID
from the exact anchor. The private dormant runtime composition continues to
expose only its frozen null-prototype reader v3 sub-capability. No evidence
source or writer is composed, no source pair is approved, and no populated
evidence rows, registered production composition, runtime activation, deployed
binding, or live chain evidence exists, so neither
the PostgreSQL reader nor `admitAndAssemble` is a live application path. All three
provider-position registration blockers remain
`PROVIDER_POSITION_READER_FEATURE_REGISTRATION_MISSING`,
`PROVIDER_POSITION_TRUSTED_ASSESSMENT_FEATURE_REGISTRATION_MISSING`, and
`PROVIDER_POSITION_DEADLINE_RUNNER_FEATURE_REGISTRATION_MISSING`, and the
live-provider count remains zero.

The offline production preflight now byte-pins this coordinator, assembly port,
durable-anchor reader port, concrete PostgreSQL durable reader, chain-anchor
evidence source port, dormant two-source evidence producer, exact recorder port,
concrete PostgreSQL recorder, record-intent reconciliation port, one-shot
PostgreSQL reconciliation processor, bounded reconciliation lifecycle, dormant
trusted-chain-assessment assembler,
exact mainnet launch-network policy, concrete deadline runner, complete
wallet-roster cancellation chain, shared PostgreSQL cancellation service,
runtime-budget resource, private dormant composition, migrations `0029`,
`0030`, and `0031`, and the migration index with a selected thirty-six-file
reader/domain/infrastructure/database/module/barrel/controller critical-source
slice.
Its local check rejects trust, timing, source-method substitution, active-controller
lifecycle, signal substitution, cancellation/drain/cleanup, query fallback,
result-cardinality/row-validation weakening, recorder SQL/value order,
durable-intent/token/one-shot/reconciliation/lifecycle drift, pre/post-producer
authentication, raw reader or trusted-assembly
injection, private reader/assembler construction/argument bypass, facade
exposure, zero-target anchor,
authority, or feature-surface drift inside that slice, but deliberately reports the reader,
trusted-assessment, and deadline-runner feature registrations as missing. It
does not prove recursive dependency closure or scan every application module,
and it performs no provider, chain, network, cloud, secret, transaction, or
billable operation.

The selected slice's authority-free producer accepts one canonical
selected-source observation and uses the configured corroborating member only
as an independent witness to the same chain fact. Both descriptor-captured
reads receive the same producer-authored evaluation time, exclusive deadline,
and abort signal and are drained with `Promise.allSettled`. Both opaque results
must authenticate against their exact request objects before inspection;
distinct receiver and capability identities, exact current/finalized head
agreement, strict timing and freshness, and nonzero SHA-256 identity,
live-capability, and lineage proofs are required. The ordered pair derives the
stored proof hashes, and the producer issues only an opaque, exact 23-argument
migration-record candidate bound to its original request in a private
`WeakMap`.

The concrete recorder captures the canonical producer reviewer and
`queryWithCancellation` without construction-time I/O. It accepts exact frozen
plain- or null-prototype recorder and producer requests carrying the same genuine
signal. It authenticates the opaque producer capability before candidate
inspection and reconstructs the exact migration `0029` evidence payload, then
uses migration `0031`'s exact prepare/claim/execute/mark statements with the same
signal. The prepare persists the 23-value evidence payload and producer deadline
before dispatch. One private nonzero 32-byte token can claim and execute only one
guarded `RECORD`; PostgreSQL retains only its digest, and the recorder zeroes the
raw token. Known terminal outcomes issue frozen null-prototype results bound to
the original request in a private `WeakMap`. Ambiguity at any database phase
returns a reviewable `RECONCILIATION_REQUIRED` result and never triggers an
automatic second record attempt. There is no ordinary-query fallback, provider
transport, registration, feature export, runtime composition, database
credential, or grant. The producer's 30-second limit remains tied to its private
`evaluatedAt`; the recorder does not substitute an incorrect
`deadlineAt - observedAt` bound.

The reconciliation processor captures only `queryWithCancellation`, owns its
private 32-byte lease token, and makes at most one lease query followed by one
`RECONCILE_ONLY` query. It accepts no caller-selected intent or token and exposes
only opaque `IDLE`, terminal, or `DEFERRED` status after exact request-identity
review. It cannot invoke `RECORD`, release the lease, contact a provider, or
register or schedule itself. A rejected query or broken connection can still
hide physical commit acknowledgement, but the durable intent remains available
for source-only recovery without a second dispatch.

The bounded lifecycle captures only the processor's `reconcileNext` and
`reviewResult` methods plus the injected clock and timer. It allows one run at a
time, gives every sequential attempt the same internally controlled abort
signal, authenticates the returned capability before reading its exact outcome,
and stops at idle, deferral, work limit, run deadline, or external abort. It does
not turn this source artifact into a scheduler or runtime worker.

At the preflight milestone verified in `6f35a91`, all 63 focused cases in
`production-go-live-preflight.test.ts` passed for this exact 36-artifact slice.
Six focused integration cases also passed against an
isolated local PostgreSQL 16 instance, including the cumulative verifier,
Ethereum/Solana intent preparation, one-shot/idempotent execution,
expired-`NEW` reconciliation, token rejection, and deferred-constraint
rollback. This is local database evidence, not deployed or mainnet evidence.

Agreement on the two sources' finalized heads does not prove that the selected
candidate anchor itself is finalized. Migration `0029` and this producer keep
the artifact `PROVISIONAL`, `DISPLAY_ONLY`, and
`mayAuthorizeFinancialAction: false`. A separately reviewed
candidate-finalization gate is required before any ledger mutation or financial
authority may consume it.

The checked-in mainnet source-pair registry remains empty and `NOT_APPROVED`.
No concrete source, endpoint, owner-authorized recorder or reconciliation
workload/principal/credential/grant, module provider, barrel export, composition
dependency, lifecycle registration, schedule, deployment, or runtime activation
is added, so all three
registration blockers remain `PROVIDER_POSITION_READER_FEATURE_REGISTRATION_MISSING`,
`PROVIDER_POSITION_TRUSTED_ASSESSMENT_FEATURE_REGISTRATION_MISSING`, and
`PROVIDER_POSITION_DEADLINE_RUNNER_FEATURE_REGISTRATION_MISSING`, and the
live-provider count remains zero.

That production change must also provide:

- reviewed policy bindings with two genuinely independent operators/source families per active Ethereum and Solana target;
- upstream live provider-position readers that enforce account and wallet ownership boundaries;
- wallet-free chain-witness implementations for both independently operated members of every approved pair;
- transport-level timeouts, cancellation, authentication, and observability;
- durable continuity floors rather than accepting an upstream service's unsupported history claim;
- disagreement quarantine and operator alerting;
- retention/replay rules for source observation IDs;
- reviewed ownership, scheduling, bounded retries, shutdown, logging/redaction,
  and deployed restart-recovery evidence for the dormant recorder and
  reconciliation processor, plus explicit physical commit-acknowledgement
  handling; and
- explicit persistence and display approval after live conformance tests.

Until those gates are satisfied, the coordinator and its candidate must remain unregistered and must not be used to imply an available balance, recommendation, or permission to move funds.
