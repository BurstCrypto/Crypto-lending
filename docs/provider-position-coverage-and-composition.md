# Provider-position coverage and portfolio composition

Status: repository-owned domain plus private dormant position reader,
PostgreSQL durable-chain-anchor reader, and trusted-chain-assessment assembler
implementations. The private dormant composition constructs the PostgreSQL
reader from its owned `PostgresService` and passes it only to a newly constructed
assembler; it accepts neither a raw durable reader nor a raw trusted-assembly
bypass. None of this graph is registered in Nest or reachable through
HTTP/RPC/API runtime wiring. Migration `0029` supplies the reader's dormant
database evidence boundary, and migration `0030` adds a dormant, deadline-bound
record/reconcile boundary around it. Migration `0031` adds retained one-shot
record intents around that guarded operation. An authority-free two-source
candidate producer exists behind an exact source port, but its checked-in
mainnet registry is empty and `NOT_APPROVED`. Recorder V2 durably prepares the
`0031` intent before at most one guarded dispatch; a separate one-shot processor
can perform only source-only reconciliation, and a bounded direct-import-only
lifecycle can sequence processor calls only when explicitly run. The recorder,
processor, and lifecycle are unregistered and ungranted. Six endpoint-free
provider-target source implementations now exist locally for Aave V3 Ethereum,
Kamino Solana, Compound III Ethereum, SparkLend Ethereum, Morpho Blue Ethereum,
and Euler V2 Ethereum, but each remains direct-import-only, dormant, and
unregistered. No approved independent source
pair, owner-authorized workload/principal/credential, populated evidence,
production migration execution, runtime activation, deployment, or live proof
exists.

Gearbox commit `5fcc7ca` adds a pure evaluator for an already decoded,
caller-asserted exhaustive manager/account transcript that matches the caller-
supplied approval list; inventory commit `040e93a` byte-pins it and its hostile-
path specification. It has no endpoint,
authenticated acquisition, independent source, clock, persistence, runtime, or
authority and explicitly leaves completeness unestablished. It is therefore an
incomplete transcript foundation, not a seventh complete provider-position
source. The six-source count and both 0-of-10 live-evidence counts remain
unchanged.

## Exact coverage (version 1)

MainnetProviderPositionCoverageManifestV1 binds one account and one position
snapshot to the parsed provider observation policy and active mainnet asset
registry. Its expected targets are derived, not supplied by the caller:

each authoritative active wallet x each approved market on that wallet's network

Every derived target must occur exactly once. The target must repeat the exact
approved provider, protocol, market, network, asset identities, and complete
policy source set. It must be current, COMPLETE, and AGREED. The manifest's
canonical SHA-256 fingerprint covers all normalized fields.

An empty position array means "zero positions" only when all expected targets
are present and each declares positionCount 0. Missing, extra, duplicate,
partial, unavailable, stale, divergent, policy-drifted, or cross-account /
wallet / network / asset input fails as unavailable. A non-empty snapshot still
passes the existing observation-policy and opaque chain-assessment verifier
before its observations are matched back to the manifest counts.

`MainnetProviderPositionReaderV3` accepts exactly an account ID and correlation
ID; callers cannot supply the evaluation time. It returns an exact frozen
read-only envelope containing the server-authored canonical time used by the
coverage parser and the `CoveredMainnetProviderPositionSnapshotV1`. Its
response therefore retains the account identity plus the snapshot,
observation-policy, asset-registry, and coverage bindings needed to distinguish
proven zero positions from missing work. A bare or unenveloped covered snapshot
is rejected at the type boundary. Raw admission candidates, chain assessments,
verifier capabilities, lifecycle handles, persistence authority, and
financial-action authority do not cross the reader capability.

The private dormant runtime composition creates that reader as a frozen
null-prototype sub-capability over its descriptor-captured coordinator method.
It calls only `admitAndAssemble`. Before reading any result property, it requires
the exact assembly object issued into the coordinator module's private
`WeakSet`; a clone fails through a direct-source reviewer that is not exposed by
the feature barrel. It then returns the exact parsed covered-snapshot identity,
rejects result/account/time/binding drift with one fixed error, and participates
in the composition's admission drain. The surrounding dormant facade retains
its diagnostic candidate operations and memoized close, but none of those
operations is reachable through the reader object.

The offline production preflight now pins this reader together with the
durable-anchor reader port, concrete PostgreSQL reader, dormant
trusted-chain-assessment assembler, exact mainnet launch-network policy,
coverage, observation, assessment, observation-policy, trusted-assembly,
admission, source port, two-source producer, recorder port, concrete PostgreSQL
recorder, record-intent reconciliation port and PostgreSQL processor, bounded
reconciliation lifecycle, pure candidate-finality port and dormant finalizer,
module, barrel, and controller sources together with migrations `0029`, `0030`,
and `0031` and the migration index. The historical candidate-finality preflight
covered 38 artifacts. The committed Aave, Kamino, and Compound source pins
expanded that selected set to 41. Spark preflight commit `2978367` pins source
commit `d684428` and brought the selected local set to 42 critical artifacts.
The inert runtime owner then brought the slice to 43. Morpho and Euler source
commits `5910ebf` and `d478f3b`, inventory commit `a77a57e`, and preflight
commit `5550fbf` now bring the selected boundary to 45 artifacts. The Gearbox
transcript and migration `0033` remain outside this slice and are guarded by
their dedicated dormant-inventory and dormant-action validators. A passing
local source inspection
does not prove recursive dependency closure, whole-application registration
absence, populated or deployed evidence, or live behavior. It does pin the
private construction path that passes the composition-owned PostgreSQL reader
only to a newly constructed assembler and passes that local assembler only to
the coordinator;
neither the outer facade nor its reader sub-capability exposes either object.
The reader, trusted-assessment, and deadline-runner feature-registration
blockers all remain open.

At the candidate-finality milestone implemented in `387a2dc` and verified in
`7f7347a`, all 64 focused cases in `production-go-live-preflight.test.ts` passed
for the then-current 38-artifact slice. Subsequent source/preflight milestones
are Aave `1538ec7` / `ecff5b9`, Kamino `1e70d80` / `b41cc62`, and Compound
`7e10077` / `91bd9bc`. Spark source commit `d684428` passed its focused source
specification, API typecheck, and targeted static/format checks; preflight commit
`2978367` pins it, and all 68 cases passed for the resulting exact 42-artifact
historical slice. The later inert-registration boundary passed 81 cases at 43
artifacts. The current boundary still passes all 85 focused cases at 45
artifacts. After Gearbox commits `5fcc7ca` and `040e93a`, dormant lifecycle
commits `ee9204d`, `a387124`, and `a61bb57`, and preflight rebaseline `667b112`,
the reviewed whole-API snapshot contains 395 files and 6,265,963 bytes with
SHA-256 `e3c282da6404df5d631b6b110dc52f48111beb1e087b0c56648661b70db737ad`.
Six focused PostgreSQL 16 integration cases also passed for the
migration/recorder/processor path. That is local source and disposable-database
evidence only, not proof of a production migration, runtime
registration, provider call, deployment, or live recovery.

Migration `0029`'s two append-only tables hold global Ethereum/Solana chain-anchor
evidence and `INVALIDATED`/`QUARANTINED` control events without account or wallet
PII columns. A source observation ID must be exactly
`ethereum-block-<exact anchor blockNumber>` or
`solana-slot-<exact anchor slot>`; it cannot carry an arbitrary wallet or request
identifier. The exact API runtime role alone receives an `EXECUTE` grant on its
`SECURITY DEFINER` reader, and that reader permits a lookup only after validating
the request's active chain-bound wallet. It caps evaluation-to-deadline at 30
seconds and rechecks deadline, approval, current-head, and finality freshness
against database time after wallet and evidence locks. Its evidence-recording
and control functions have no runtime grants and remain owner-controlled. The
cumulative verifier retains migration `0028`'s generic-worker suspension. The
concrete application reader uses only the exact cancellable migration read,
strictly reviews a zero-or-one-row result, and seals each accepted assessment to
the exact request identity; it exposes no write function. Admission, observation,
reader, and database validation all derive the same chain-global observation ID
from the exact anchor. The dormant two-source producer drains two
descriptor-captured, same-signal source reads, requires authenticated pair
agreement, derives pair-bound proof hashes, and seals the exact 23-argument
record candidate to the original request in a private `WeakMap`. Its checked-in
mainnet pair registry is empty and `NOT_APPROVED`, and it has no persistence or
runtime capability. Pair agreement on finalized heads does not prove the
selected candidate anchor itself is finalized: the artifact remains
`PROVISIONAL`, `DISPLAY_ONLY`, and `mayAuthorizeFinancialAction: false`. The new
pure, direct-import-only finalizer provides the local classification boundary
without activating it. It
authenticates the exact producer capability and request before inspecting the
candidate and again immediately before issuing an assessment. For Ethereum it
keeps a candidate pending below its height, quarantines an equal-height hash
conflict, and requires the producer-authenticated lineage proof before treating
a higher finalized height as covering the candidate. For Solana it compares the
candidate slot only with the finalized root, quarantines root regression, and
explicitly makes no same-slot fork-detection claim. A server-owned monotonic
clock, exclusive producer/approval/head-freshness deadlines, and abort checks
fail closed; an issued pending result is never upgraded in place. Its immutable
null-prototype, exact-identity result keeps financial-action, persistence, and
position-snapshot authority false. Even a locally classified `FINALIZED` result
does not persist or update migration `0029`; the producer artifact remains
`PROVISIONAL` and `DISPLAY_ONLY` until a separately reviewed and activated
authority boundary exists.

The six concrete provider-target sources remain local artifacts rather than
live implementations: none owns an endpoint, provider credential, source
registration, or financial-action authority. A module-level reader-v3 token is
now registered, but it resolves only to a frozen rejecting facade backed by an
empty, `NOT_APPROVED`, and `DISABLED` Ethereum/Solana activation registry.
There is still no approved independent source pair, owner-authorized recorder
workload/principal/credential/grant, populated evidence claim, private
composition activation, deployment, or live evidence. The finalizer also has
no module, barrel, controller, scheduler, or composition registration.
Consequently the remaining provider-position blockers are
`PROVIDER_POSITION_RUNTIME_ACTIVATION_POLICY_NOT_APPROVED`,
`PROVIDER_POSITION_APPROVED_SOURCE_BINDINGS_MISSING`, and
`PROVIDER_POSITION_DEPLOYED_EVIDENCE_MISSING`, and the live-provider count,
`liveReadEvidenceBound`, and `transactionEvidenceBound` all remain zero.
For Gearbox specifically, authenticated transcript acquisition, approved
dynamic code/topology fingerprints, a second independent source, durable
wallet/continuity context, risk approval, and deployed conformance evidence all
remain missing.

Migration `0030` refuses installation over any existing `0029` evidence while
holding an access-exclusive evidence-table lock. It adds an append-only,
wallet-free sidecar that durably binds each evidence fingerprint to the original
canonical producer deadline, the exact database `recorded_at`, fixed version/use
and non-authorizing/non-persisting fields, and a domain-separated SHA-256 digest.
The sidecar references its evidence row, while a reverse `DEFERRABLE INITIALLY
DEFERRED` foreign key requires every evidence row to acquire a sidecar before
commit. A direct call to the legacy `0029` owner function therefore cannot
commit an unbound record.

The owner-only guarded function requires `READ COMMITTED` and serializes
`RECORD` and `RECONCILE_ONLY` on the same read-binding advisory transaction
lock. `RECORD` first resolves exact existing evidence and its immutable original
deadline. For an absent row it samples canonical database time immediately
after the lock and never invokes the old writer when already late. Its only
writer call and sidecar insert run in one subtransaction; a late or regressing
post-call database clock raises a private sentinel that rolls both inserts back.
`RECONCILE_ONLY` takes the same lock but performs only reads and never calls the
old writer. It returns `IDEMPOTENT_REPLAY` only for exact evidence with its
matching original deadline binding, `NOT_RECORDED` for absence, and
`DEADLINE_VIOLATION` for a missing, invalid, mismatched, or late deadline
binding; conflicting evidence raises and fails closed. Migration `0030` grants
none of its sidecar or functions to a runtime principal.

Migration `0031` refuses installation over existing evidence or deadline
history. Its retained wallet-free intent table binds the exact evidence
fingerprint and original producer deadline, permits at most one record dispatch,
stores only domain-separated dispatch and reconciliation lease-token digests,
and rejects invalid or regressing transitions. Deferred constraints bind
terminal evidence and deadline rows back to the intent, while a `SKIP LOCKED`
lease exposes only due `NEW`, `RECORD_DISPATCHED`, or `UNKNOWN` recovery. No new
table or function is granted to a runtime principal.

Recorder V2 authenticates the exact producer capability before candidate
inspection, reconstructs migration `0029`'s exact 23-value payload, appends the
producer deadline, and uses migration `0031`'s prepare/claim/execute/mark flow
with the unchanged abort signal. It prepares the durable intent before any
dispatch, generates one private nonzero 32-byte token, and calls migration
`0030`'s guarded `RECORD` operation at most once. PostgreSQL retains only the
token digest, and the raw token is zeroed after use. Known terminal outcomes are
frozen null-prototype results bound to the exact request in a private `WeakMap`;
an ambiguous database phase becomes an authenticated `RECONCILIATION_REQUIRED`
result and never an automatic second dispatch. Producer approval and
Ethereum/Solana freshness are rechecked, and there is no generic-query fallback,
provider transport, registration, runtime grant, or financial authority. The
producer's 30-second bound still derives from its private `evaluatedAt`, not an
invented deadline-minus-observation check.

The separate PostgreSQL processor owns and zeroes one private lease token,
leases at most one due intent, and invokes only `RECONCILE_ONLY`. It cannot accept
a caller-selected intent or token, release a lease, or dispatch `RECORD`; it
returns only opaque authenticated `IDLE`, terminal, or `DEFERRED` results. The
direct-import-only lifecycle can sequence those one-shot processor calls only
after an explicit `run`. It rejects overlapping runs, authenticates each exact
result, enforces 1 through 64 work items and a 10-millisecond-through-30-second
deadline, propagates abort through one internal signal, bounds retry deferrals,
and cleans up its injected timers and listeners. Import and construction start
no work. Neither source artifact is registered, scheduled, composed, or given a
provider, network, database, persistence, logging, or financial-action port of
its own.

Physical commit acknowledgement is still not guaranteed: a rejected query or
interrupted connection can leave the caller uncertain whether the transaction
committed. The durable intent, reconciliation-only processor, and bounded
lifecycle close the corresponding local source gaps, but an owner-authorized
runtime schedule, workload shutdown integration, logging/redaction,
database-principal/grant, deployment, and live recovery evidence remain
activation prerequisites.

## Conservative composition (version 1)

Composition requires both exact provider coverage and complete, current wallet
balance coverage. It creates per-wallet, per-network, per-asset totals:

- gross assets = liquid wallet balance + SUPPLY positions
- borrowed liability = BORROW positions
- net position = gross assets - borrowed liability

A borrowed token that remains in the wallet is therefore counted once in the
liquid wallet balance and once as a liability; BORROW is never also added to
gross assets. Negative net positions remain negative. Full
provider/protocol/market/position/source identity remains in providerPositions,
so aggregation does not erase provenance.

The result is reporting-only, has no USD valuation or cross-chain netting, and
sets both mayAuthorizeFinancialAction and mayIncreaseBuyingPower to false. Any
unsupported asset, duplicate cross-source observation identity, incomplete
wallet coverage, or invalid provider proof makes composition unavailable.
