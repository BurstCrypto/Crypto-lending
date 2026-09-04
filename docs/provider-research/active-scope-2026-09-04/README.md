# Active-scope provider research capture

Capture date: **2026-09-04**

This directory supplies the four dated, chain-matched research captures that
were missing from the Ethereum-and-Solana planning scope:

| Provider | Protocol     | Captured network                                   | Bounded identity evidence                                      |
| -------- | ------------ | -------------------------------------------------- | -------------------------------------------------------------- |
| Compound | Compound III | Ethereum (`eip155:1`)                              | Official `mainnet/usdc` Comet proxy                            |
| Euler    | Euler V2     | Ethereum (`eip155:1`)                              | Official Ethereum production registry and three core contracts |
| Gearbox  | Gearbox V3   | Ethereum (`eip155:1`)                              | Official V3 Ethereum scope and `AddressProviderV3`             |
| Jupiter  | Jupiter Lend | Solana (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`) | Official mainnet program-address table                         |

The machine-readable artifact is
[`ethereum-solana-missing-provider-captures.json`](ethereum-solana-missing-provider-captures.json).
Its sidecar hashes the exact canonical UTF-8 bytes. The offline validator is
`infra/providers/validate-active-provider-research-captures.mjs`.

## Interpretation boundary

`CATALOGED_OFFLINE_RESEARCH_ONLY` means only that an official, static source was
reviewed and its bounded facts were recorded on the capture date. It does not
mean that an address is approved, current on-chain, safe, complete, reachable,
or suitable for any user. The source-byte hashes prove only which repository
files were reviewed; they are not contract-code hashes, deployment proofs, or
live-chain observations.

Every provider remains `DORMANT_UNREGISTERED`, `UNAVAILABLE`, `NOT_APPROVED`,
`NOT_ASSESSED`, and without supported actions. This artifact is not imported by
application code and cannot authorize a read, egress rule, wallet request,
transaction, or financial action. Base, BNB Smart Chain, and all testnets are
outside this capture.

## Official sources

All immutable evidence URLs are pinned to a full commit in an official project
repository. The JSON artifact records the exact source-byte SHA-256 and byte
length used during research.

- [Compound chain configuration](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/hardhat.config.ts)
- [Compound Comet Ethereum USDC roots](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/deployments/mainnet/usdc/roots.json)
- [Euler chain registry](https://github.com/euler-xyz/euler-interfaces/blob/d0e9a428523b3de6cb3e6c7a06ad55b6e59223f3/EulerChains.json)
- [Gearbox V3 Ethereum scope](https://github.com/Gearbox-protocol/security/blob/3a8af446a2c9f2902b191635ec548e35fdb97dda/bug-bounty/v3-scope.md)
- [Jupiter Lend overview](https://github.com/jup-ag/docs/blob/c4b7ee1172ebb1c58407e479e7153bf225690aaf/lend/index.mdx)
- [Jupiter Lend mainnet program addresses](https://github.com/jup-ag/docs/blob/c4b7ee1172ebb1c58407e479e7153bf225690aaf/lend/program-addresses.mdx)

The mutable documentation entry points are also recorded in the JSON for future
rechecks. They are not substituted for the commit-pinned evidence.

## Remaining work

The JSON lists provider-specific unresolved fields. At minimum, production still
needs an approved market and asset allowlist, independent deployment and code
identity verification at a finalized chain point, provider-specific read-only
adapters, two independent approved data sources, completeness and divergence
handling, observability and incident evidence, and every legal, regulatory,
privacy, risk, security, dependency, finance, operations, egress, and deployment
approval. Transaction support remains a separate later gate requiring explicit
action allowlists, simulation policy, and fresh user authorization.

Run the deterministic local check with:

```console
node infra/providers/validate-active-provider-research-captures.mjs
```

The validator reads only the checked-in artifact and sidecar. It has no network,
RPC, provider API, cloud, credential, subprocess, or transaction path.
