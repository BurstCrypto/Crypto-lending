# Provider-position coverage and portfolio composition

Status: repository-owned domain plus private dormant reader and
trusted-chain-assessment assembler implementations. The private dormant
composition accepts only an optional durable-chain-anchor reader and constructs
the assembler internally; it does not accept a raw trusted-assembly bypass.
None of this graph is registered in Nest or reachable through HTTP/RPC/API
runtime wiring. The assembler has no ambient I/O capability, and no concrete
durable-chain-anchor reader implementation exists.

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
durable-anchor reader port, dormant trusted-chain-assessment assembler, exact
mainnet launch-network policy, coverage, observation, assessment,
observation-policy, trusted-assembly, admission, module, barrel, and controller
sources as one selected twenty-four-file dormant critical-source slice. A
passing local source inspection does not prove recursive dependency closure,
whole-application registration absence, a concrete durable-anchor reader,
or deployed/live evidence. It does pin the private construction path that
passes the optional reader only to a newly constructed assembler and passes
that local assembler only to the coordinator; neither the outer facade nor its
reader sub-capability exposes either object. The reader, trusted-assessment, and
deadline-runner feature-registration blockers all remain open.

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
