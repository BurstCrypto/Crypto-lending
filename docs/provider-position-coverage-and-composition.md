# Provider-position coverage and portfolio composition

Status: repository-owned domain contract only. No provider-position reader,
adapter, HTTP route, RPC/API access, or runtime registration is enabled.

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
