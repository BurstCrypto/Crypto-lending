# Stablecoin price-evidence read model

Status: `IMPLEMENTED_LOCAL_READ_PATH` / `PRODUCTION_INPUTS_UNAVAILABLE`

Migration `0021` adds the durable persistence boundary required by KAN-66 for
the six active KAN-61 launch assets only: USDC, USDT, and PYUSD on Ethereum
mainnet and Solana mainnet. Base, Arbitrum, testnets, unregistered token
identities, and any changed registry version or fingerprint fail closed.

The static source catalog contains exactly Pyth Core and Chainlink Data Feeds
for each asset. It binds the exact KAN-61 registry fingerprint and KAN-66 feed
reference. A provider symbol, request payload, or bare token address cannot
select another asset or source.

## Durable model

The database stores five related records:

- an immutable 12-row exact asset/source catalog;
- append-only evidence identities, internal adapter identities, verification
  timestamps, and cryptographic evidence fingerprints;
- append-only normalized observations with exact source sequence, update ID,
  timestamps, rate, and source-specific confidence representation;
- append-only watermark-transition events that retain both the new observation
  and its immediate predecessor watermark; and
- a current source-watermark projection guarded against invalid transitions.

Update-ID uniqueness is scoped by registry version and fingerprint, exact
network-qualified asset, source ID, and source reference. It is intentionally
not global: one Pyth update can carry several feeds, and provider round/update
identifiers can repeat across distinct feeds. Source sequence is unique and
strictly increasing within that same exact scope. Price and observation
timestamps may remain equal when sequence advances, but neither may regress.

The API read function selects the latest accepted event at or before the
trusted evaluation timestamp. For each selected observation it returns the
predecessor captured by that event. It never returns the projection's current
update as the observation's prior watermark; doing so would make every valid
observation look like a replay. Empty history produces two all-null first-use
watermarks and no observation, so valuation remains unavailable rather than
inventing a price.

## Capability and privilege boundary

Runtime principals have no table or composite-row-type privileges. The API
role can execute only the read function. The worker role can execute only the
atomic record function. Both functions are `SECURITY DEFINER` with a fixed
`pg_catalog`, migration-schema, `pg_temp` search path. Update, delete, and
truncate attempts against history are rejected by always-enabled triggers;
the current projection accepts only a transition backed by the matching
append-only event. Rollback refuses to destroy any recorded evidence.

The cumulative runtime verifier uses only `pg_catalog`: it checks the immutable
registry manifest and exact binding constraints, exact function-signature OIDs,
and each trigger's table, function, timing, and event mask. Runtime health checks
therefore need no direct table read grant. The isolated migration verifier also
checks the seeded catalog contains exactly 12 rows.

The TypeScript writer normalizes and fingerprints already-verified evidence;
it does not authenticate provider bytes. The portfolio reader strictly maps
database rows and derives an opaque snapshot fingerprint including the exact
registry binding and evidence/event identities. It performs no HTTP, RPC,
oracle, wallet, or blockchain access.

## Read-only activation and remaining gates

`ValuationModule` exposes only `PostgresPortfolioPriceEvidenceReader`, and
`PortfolioModule` binds that reader to the production API price-read port. The
API can therefore consume durable evidence after migration `0021`, while empty,
stale, divergent, or malformed history remains unavailable through the
existing portfolio policy. The evidence writer and every external feed adapter
remain unregistered. This read-only wiring does not make stored evidence
authentic and cannot create evidence, provision a provider account, contact an
endpoint, open egress, or perform an RPC or blockchain operation.

Production activation still requires all of the following:

- approved and cryptographically/on-chain authenticated Pyth and Chainlink
  adapters for every exact feed;
- exact current Chainlink proxy/aggregator, decimals, heartbeat, lifecycle, and
  Ethereum RPC evidence;
- approved provider/RPC contracts, hostnames, credentials, quotas, cost
  controls, egress, and independent-source analysis under KAN-252;
- independent Risk, Finance, Security, Legal/Privacy, and SRE approval under
  KAN-231 and the public-launch gate;
- deployed stale/divergence/replay alarms, outage exercises, retention and
  recovery procedures, and release-candidate evidence; and
- explicit runtime wiring only after both the balance and price readers have
  passed deployed fail-closed acceptance tests.

This local implementation authorizes no financial action and made no external
request or mainnet write.
