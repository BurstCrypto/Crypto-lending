# Provider-position coverage and portfolio composition

Status: repository-owned domain plus private dormant position reader,
PostgreSQL durable-chain-anchor reader, and trusted-chain-assessment assembler
implementations. The private dormant composition constructs the PostgreSQL
reader from its owned `PostgresService` and passes it only to a newly constructed
assembler; it accepts neither a raw durable reader nor a raw trusted-assembly
bypass. None of this graph is registered in Nest or reachable through
HTTP/RPC/API runtime wiring. Migration `0029` supplies the reader's dormant
database evidence boundary, and migration `0030` adds a dormant, deadline-bound
record/reconcile boundary around it. An authority-free two-source candidate
producer now exists behind an exact source port, but its checked-in mainnet
registry is empty and `NOT_APPROVED`. The existing exact recorder still calls
migration `0029` directly; once `0030` is applied, that legacy call cannot commit
because every evidence row must have its matching deadline binding. The recorder
is unregistered and ungranted, and no concrete source, owner-authorized
workload/principal/credential, populated evidence, runtime activation,
deployment, or live proof exists.

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
recorder, module, barrel, and controller sources together with migrations `0029`
and `0030` and the migration index as one selected thirty-two-file dormant
critical-source slice. A passing local source inspection does not prove
recursive dependency closure, whole-application registration absence, populated
or deployed evidence, or live behavior. It does pin the private construction
path that passes the composition-owned PostgreSQL reader only to a newly
constructed assembler and passes that local assembler only to the coordinator;
neither the outer facade nor its reader sub-capability exposes either object.
The reader, trusted-assessment, and deadline-runner feature-registration
blockers all remain open.

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
`PROVISIONAL`, `DISPLAY_ONLY`, and `mayAuthorizeFinancialAction: false` until a
separate candidate-finalization gate passes. There is still no live source implementation,
owner-authorized recorder workload/principal/credential/grant, populated
evidence claim, runtime registration or activation, deployment, or live
evidence. Consequently all three
provider-position registration blockers remain
`PROVIDER_POSITION_READER_FEATURE_REGISTRATION_MISSING`,
`PROVIDER_POSITION_TRUSTED_ASSESSMENT_FEATURE_REGISTRATION_MISSING`, and
`PROVIDER_POSITION_DEADLINE_RUNNER_FEATURE_REGISTRATION_MISSING`, and the
live-provider count remains zero.

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

The concrete recorder authenticates the exact producer capability both before
and after one cancellable PostgreSQL call, uses the unchanged abort signal, and
maps the candidate to migration `0029`'s exact 23 SQL arguments. It rejects
non-native promises, extra or malformed rows, noncanonical record times, expired
pair approval, and stale Ethereum/Solana current or finalized heads. Its frozen
null-prototype receipt is bound to the exact request in a private `WeakMap`; it
has no generic-query fallback, retry loop, registration, runtime grant, or
financial authority. The producer's 30-second bound is measured from its private
`evaluatedAt`, not from the recorder-visible `observedAt`, so the recorder relies
on authentic producer review rather than inventing a deadline-minus-observation
check.

The current recorder still targets migration `0029`'s 23-argument function, so
it is deliberately incompatible with `0030` and cannot commit after that
migration adds the reverse foreign key. It does not call the new deadline-bound
`RECORD`/`RECONCILE_ONLY` function, persist a one-shot intent before dispatch, or
recover a dispatched operation after process restart. Migration `0030` closes
the local late-write gap for callers of its guarded function, but physical
commit acknowledgement is not guaranteed: a rejected query or interrupted
connection can still leave the caller uncertain whether the database committed.
A versioned migration `0031` recorder adaptation with durable one-shot intent,
reconciliation-only recovery, and restart processing remains an activation
prerequisite.

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
