# Provider-position coverage and portfolio composition

Status: repository-owned domain and reader contracts only. The dormant
coverage-aware reader v2 boundary has no implementation, adapter, HTTP route,
RPC/API access, or runtime registration.

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

`MainnetProviderPositionReaderV2` can return only a
`CoveredMainnetProviderPositionSnapshotV1`. Its response therefore retains the
account identity plus the snapshot, observation-policy, asset-registry, and
coverage bindings needed to distinguish proven zero positions from missing
work. A bare observation snapshot is rejected at the type boundary. Raw chain
assessments, verifier capabilities, persistence authority, and financial-action
authority do not cross the reader port.

The offline production preflight now pins this reader together with the
coverage, observation, assessment, policy, trusted-assembly, admission, module,
barrel, and controller sources as one selected dormant critical-source slice. A
passing local source inspection does not prove recursive dependency closure,
whole-application registration absence, an implementation, or live evidence;
the reader and trusted-assessment feature-registration blockers remain open.

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
