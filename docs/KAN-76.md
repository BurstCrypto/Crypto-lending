# KAN-76: Versioned routing-fee rules

KAN-76 implements the local, provider-neutral policy boundary for `FEE-001`.
It does not contact a chain, quote provider, billing provider, cloud service, or
testnet, and it cannot create a charge or move value.

## Version 1

Rule reference `76000000-0000-4000-8000-000000000001` is effective from
`2026-08-25T00:00:00.000Z` until superseded by a later non-overlapping version.
Its exact material-orchestration rates are:

| Tier       |  Exact decimal ratio | Percentage | Basis points |
| ---------- | -------------------: | ---------: | -----------: |
| Free       |  `20 / 10^4 = 0.002` |    `0.20%` |         `20` |
| Individual | `12 / 10^4 = 0.0012` |    `0.12%` |         `12` |
| Pro        |  `8 / 10^4 = 0.0008` |    `0.08%` |          `8` |

Rates are stored as decimal `mantissa` and `scale`, never as JavaScript
floating-point values. An unavailable subscription tier resolves to Free. An
unknown explicit tier fails closed.

The catalog rejects duplicate rule references, duplicate or regressing version
numbers, overlapping effective periods, and an open-ended version followed by
another version. Gaps are permitted but no quote can resolve a rule during a
gap. Effective starts are inclusive and ends are exclusive, so a boundary
instant belongs to exactly one valid version.

## Route classification

The version 1 classifier accepts a bounded, continuous sequence of canonical
route legs:

- `DIRECT_SETTLEMENT` must preserve both network and asset identity;
- `SWAP` must change the asset on the same network; and
- `BRIDGE` must change the network.

Only one identity-preserving direct-settlement leg is `DIRECT_COMPATIBLE`.
Its platform rate is exactly zero for every tier. Any swap, bridge, or route
with more than one leg is `MATERIAL_ORCHESTRATION` and receives the effective
tier rate. The decision includes stable reason codes and the classifier version
so the later quote snapshot can be reproduced.

Malformed endpoints, impossible leg semantics, discontinuities, sparse arrays,
extra fields, accessors, foreign prototypes, and oversized routes are rejected.
The normalizer copies and recursively freezes accepted policy and route data.

## Boundary

KAN-76 defines policy and classification only. It does not select a route,
verify a provider quote, grant a paid entitlement, persist a ledger snapshot,
or approve Finance/Legal accounting treatment. KAN-77 consumes this policy for
calculation; KAN-78 owns persistence against the existing immutable-ledger
controls.
