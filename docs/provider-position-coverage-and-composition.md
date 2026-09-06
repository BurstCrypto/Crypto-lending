# Provider-position coverage and portfolio composition

Status: repository-owned domain plus private dormant position reader,
PostgreSQL durable-chain-anchor reader, and trusted-chain-assessment assembler
implementations. The private dormant composition constructs the PostgreSQL
reader from its owned `PostgresService` and passes it only to a newly constructed
assembler; it accepts neither a raw durable reader nor a raw trusted-assembly
bypass. None of this graph is registered in Nest or reachable through
HTTP/RPC/API runtime wiring. Migration `0029` supplies the reader's dormant
database evidence boundary, but no evidence writer, populated evidence, runtime
activation, deployment, or live proof exists.

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
admission, module, barrel, and controller sources together with migration `0029`
and the migration index as one selected twenty-seven-file dormant
critical-source slice. A passing local source inspection does not prove
recursive dependency closure, whole-application registration absence, populated
or deployed evidence, or live behavior. It does pin the private construction
path that passes the composition-owned PostgreSQL reader only to a newly
constructed assembler and passes that local assembler only to the coordinator;
neither the outer facade nor its reader sub-capability exposes either object.
The reader, trusted-assessment, and deadline-runner feature-registration
blockers all remain open.

The migration's two append-only tables hold global Ethereum/Solana chain-anchor
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
from the exact anchor. There is still no
evidence writer/producer, populated evidence claim, runtime registration or
activation, deployment, or live evidence. Consequently all three
provider-position registration blockers remain
`MISSING`, and the live-provider count remains zero.

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
