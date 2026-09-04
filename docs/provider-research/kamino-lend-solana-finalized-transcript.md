# Kamino Lend Solana finalized transcript foundation

- Status: dormant research boundary only
- Reviewed: 2026-09-04
- Network: Solana mainnet-beta
- Asset: native USDC (6 decimals)
- Market selection: Kamino Main Market, restricted to the official identities below

## Decision

This slice implements a fail-closed parser for one caller-supplied Solana JSON-RPC transcript. It does not create a client, choose an RPC endpoint, read live data, register dependency injection, persist evidence, rank a provider, recommend a deposit, or authorize a transaction.

The official source snapshot is sufficient to select these identities:

| Role                        | Pinned identity                                | Primary evidence                                                                                                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kamino Lend mainnet program | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`  | Kamino's [deployment README at `a0876097`](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/README.md) and [interface program constant](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/libs/klend-interface/src/lib.rs)    |
| Main lending market         | `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF` | Kamino SDK [example constants at `38845294`](https://github.com/Kamino-Finance/klend-sdk/blob/38845294447623f6de3afc9dec29875f959f6f48/examples/utils/constants.ts) and [SDK usage documentation](https://github.com/Kamino-Finance/klend-sdk/blob/38845294447623f6de3afc9dec29875f959f6f48/README.md) |
| Main-market USDC reserve    | `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59` | Kamino SDK [example constants at `38845294`](https://github.com/Kamino-Finance/klend-sdk/blob/38845294447623f6de3afc9dec29875f959f6f48/examples/utils/constants.ts)                                                                                                                                    |
| Native USDC mint            | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | The same Kamino SDK constants and Circle's [official USDC contract-address registry](https://developers.circle.com/stablecoins/usdc-contract-addresses)                                                                                                                                                |

That source evidence does **not** establish the currently deployed ProgramData address, deployed bytecode, deployment slot, or upgrade authority. Those values therefore remain caller-supplied, require a separate exact manifest fingerprint, and have no approval meaning in this repository. No default manifest is shipped.

## Source and layout pins

- Kamino program/interface repository: `Kamino-Finance/klend@a08760976f51a3a58c4a0c6ea27b4a0e565bca79`.
- Kamino SDK repository: `Kamino-Finance/klend-sdk@38845294447623f6de3afc9dec29875f959f6f48`.
- Upgradeable-loader reference: archived official Solana source `solana-labs/solana@7700cb3128c1f19820de67b81aa45d18f73d2ac0`, [`bpf_loader_upgradeable.rs`](https://github.com/solana-labs/solana/blob/7700cb3128c1f19820de67b81aa45d18f73d2ac0/sdk/program/src/bpf_loader_upgradeable.rs).
- Legacy SPL Token mint reference: `solana-program/token@0087ca54bd5a5b07e1df7e1b52303529047a1186`, [`interface/src/state.rs`](https://github.com/solana-program/token/blob/0087ca54bd5a5b07e1df7e1b52303529047a1186/interface/src/state.rs).

The Kamino offsets come from the pinned, `#[repr(C)]`, `Pod` interface definitions, not from reverse engineering a live response:

- [`LendingMarket`](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/libs/klend-interface/src/state/lending_market.rs) is 4,656 bytes plus the 8-byte Anchor discriminator.
- [`Reserve`](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/libs/klend-interface/src/state/reserve.rs) is 8,616 bytes plus the 8-byte Anchor discriminator.
- [`LastUpdate`](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/libs/klend-interface/src/state/common.rs) fixes the reserve refresh slot, stale flag, price-status byte, and timestamp layout.
- The separately pinned SDK-generated [`LendingMarket`](https://github.com/Kamino-Finance/klend-sdk/blob/38845294447623f6de3afc9dec29875f959f6f48/src/%40codegen/klend/accounts/LendingMarket.ts) and [`Reserve`](https://github.com/Kamino-Finance/klend-sdk/blob/38845294447623f6de3afc9dec29875f959f6f48/src/%40codegen/klend/accounts/Reserve.ts) layouts corroborate the discriminators and field order.

Decoded bytes are intentionally narrow:

| Account             | Account-data byte offsets used                                                                                    | Meaning enforced                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upgradeable Program | `0..3`, `4..35`                                                                                                   | bincode `Program` variant and embedded ProgramData public key; exact length 36                                                                                                                                         |
| ProgramData         | `0..3`, `4..11`, `12`, `13..44`, `45..`                                                                           | `ProgramData` variant, last deployment slot, optional authority, and SHA-256 of the complete program-binary region; ELF magic is required                                                                              |
| LendingMarket       | `0..7`, `8..15`, `122`, `123`, `124`                                                                              | discriminator, caller-pinned version, valid boolean flags, emergency mode off, borrowing not globally disabled                                                                                                         |
| Reserve             | `0..7`, `8..15`, `16..31`, `32..63`, `128..159`, `224..239`, `272..279`, `408..439`, `4856`, `4864`, `5016..5031` | discriminator/version, fresh non-stale update, exact market/mint/token-program binding, raw available amount, raw borrowed scaled fraction, 6 decimals, active/non-emergency status, nonzero deposit and borrow limits |
| SPL Token mint      | full 82-byte packed mint; fields at `0..81`                                                                       | canonical COptions, nonzero supply, 6 decimals, initialized flag, mint/freeze authorities                                                                                                                              |

The raw `borrowed_amount_sf` value is deliberately exposed only as an integer string. This boundary does not apply Kamino's fractional scale, calculate utilization, interpret oracle prices, derive APR/APY, or infer deposit capacity.

## Transcript binding

The injected transport must return this exact sequence:

1. `getGenesisHash`, equal to Solana mainnet-beta's pinned genesis hash.
2. `getSlot({ commitment: "finalized" })` to establish the minimum context slot.
3. One `getMultipleAccounts` for exactly Program, ProgramData, LendingMarket, Reserve, and USDC mint, with `commitment: "finalized"`, `encoding: "base64"`, and that `minContextSlot`.
4. `getBlock(snapshotSlot, { commitment: "finalized", transactionDetails: "none", rewards: false })` with a nonzero blockhash and block time.
5. A finalized `getSlot` recheck using the snapshot as `minContextSlot`.
6. A second read of the same snapshot block; blockhash, parent, height, and time must match exactly.
7. A final `getGenesisHash` identity recheck.

Solana documents that [`getMultipleAccounts`](https://solana.com/docs/rpc/http/getmultipleaccounts) returns account values in request order and supports `commitment` and `minContextSlot`. The official [`getSlot`](https://solana.com/docs/rpc/http/getslot) method returns the slot at the requested commitment. [`getBlock`](https://solana.com/docs/rpc/http/getblock) supplies the blockhash, previous blockhash, parent slot, height, and estimated block time used here.

Every account must be present in the single snapshot and match exact owner, executable flag, data length, canonical base64, and bounded metadata. The adapter validates the upgradeable-loader Program-to-ProgramData link, caller-pinned deployment slot and authority state, and caller-pinned SHA-256 of bytes after the 45-byte ProgramData header. The loader source describes the 36-byte Program record, 45-byte ProgramData metadata, and authority-based upgrade model. A revoked authority is reported as caller-pinned evidence; an authority that remains present is reported explicitly and is never treated as immutable.

The active `MAINNET` supported-asset registry must still be version 1 with its exact in-process fingerprint and must still identify this mint as active, 6-decimal Solana USDC. Registry drift fails closed.

## Freshness and parser controls

- The caller must choose a positive maximum age no greater than 3,600 seconds.
- The bound applies independently to the finalized block time and reserve `LastUpdate.timestamp`.
- A future timestamp fails. Age equal to the bound fails; only age strictly less than the bound passes.
- Clock values must have exactly `Date.prototype`. Date subclasses and invalid Dates fail, while own `getTime`/`toISOString` overrides are never invoked.
- Inputs and responses must be bounded, acyclic plain data with no accessors, symbol keys, sparse arrays, custom prototypes, floats, or unbounded strings.
- Base58 public keys and base64 account data must round-trip canonically.
- Integer decoding uses `DataView`/`bigint`; no floating-point monetary calculation is performed.
- All transport and parsing failures collapse to one sanitized unavailable error.

## What this evidence does not prove

The candidate always states:

- `sourceAuthenticity: UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT`;
- `mayPersist: false`;
- `mayEstablishRecommendationEligibility: false`;
- `mayAuthorizeFinancialAction: false`;
- no yield evidence; and
- raw available amount only, not liquidity or deposit capacity.

Repeated finalized-slot and genesis checks detect an internally inconsistent transcript but do not make one RPC independent, Byzantine-resistant, or authentic. `minContextSlot` constrains the node's context; it is not an account-state proof. `getBlock` block time is an estimate and is used only as a bounded freshness signal. SHA-256 binds bytes to the caller's manifest but does not prove those bytes were audited, built from the pinned source, or obtained from an honest node.

## Residual production gates

Before any runtime export or persistence path is considered, all of the following remain required:

1. Approve an exact ProgramData public key, account length, deployed slot, binary SHA-256, upgrade-authority state, lending-market version, and reserve version in a separately controlled and signed manifest.
2. Independently derive and verify the ProgramData PDA and reproduce the deployed binary from reviewed source/toolchain inputs, or document why reproducibility is not achievable and approve an equivalent binary-provenance control.
3. Capture the exact accounts from independently operated, allowlisted Solana data sources or verify cryptographic account proofs against an independently trusted root. Multiple URLs operated by one vendor are not independent.
4. Review Kamino upgrade governance and incident controls. A present upgrade authority is a live code-change risk; revocation alone does not prove historical code provenance.
5. Review reserve oracle configuration, price freshness, withdrawal constraints, utilization, caps, insolvency/elevation-group behavior, token authorities, and asset-specific risk. None is inferred by this adapter.
6. Define and validate provider-native supply/share conversion, withdrawal semantics, capacity, and APR-to-APY methodology using exact protocol rules and independent price evidence.
7. Define observation durability, replay/idempotency, monitoring, alerting, circuit breakers, and incident rollback before adding any writer or recommendation consumer.
8. Perform legal/compliance, security, operational, and product approval. Then add explicit dependency injection and egress policy in a separately reviewed change.

The unit transcript is synthetic. No live mainnet read, transaction, secret, endpoint, environment variable, database write, provider activation, or user recommendation was performed by this slice.
