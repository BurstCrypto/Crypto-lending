# Marginfi v2 Solana finalized transcript foundation

- Status: dormant research boundary only
- Reviewed: 2026-09-04
- Network: Solana mainnet-beta
- Asset: native USDC (6 decimals)
- Selection: Marginfi production group, documented native-USDC bank

## Decision

This slice implements a fail-closed parser for one caller-supplied Solana JSON-RPC transcript. It does not contain an RPC endpoint or client, perform egress, register dependency injection, persist an observation, calculate yield or deposit capacity, rank Marginfi, recommend a deposit, or authorize a transaction.

The parser is intentionally dormant. Accepted output remains untrusted corroboration evidence and explicitly sets every persistence, recommendation, and financial-action capability to `false`.

## Official source and identity evidence

Both research repositories were cloned independently and `git rev-parse HEAD` was checked on 2026-09-04:

- `0dotxyz/marginfi-v2@5c97c5efb68a24f68041d2bb7d90917b8dc989e2`
- `0dotxyz/p0-ts-sdk@64773b237961c17e5dacbbf4bfe87b8af22e885b`

| Role                 | Pinned identity                                | Official evidence                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marginfi v2 program  | `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`  | Pinned [`declare_id!`](https://github.com/0dotxyz/marginfi-v2/blob/5c97c5efb68a24f68041d2bb7d90917b8dc989e2/id-crate/src/lib.rs), mainnet [`Anchor.toml`](https://github.com/0dotxyz/marginfi-v2/blob/5c97c5efb68a24f68041d2bb7d90917b8dc989e2/Anchor.toml), and SDK [production configuration](https://github.com/0dotxyz/p0-ts-sdk/blob/64773b237961c17e5dacbbf4bfe87b8af22e885b/src/configs.json) |
| Production group     | `4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8` | Pinned SDK [production configuration](https://github.com/0dotxyz/p0-ts-sdk/blob/64773b237961c17e5dacbbf4bfe87b8af22e885b/src/configs.json) and the program repository's [mainnet validator clone entry](https://github.com/0dotxyz/marginfi-v2/blob/5c97c5efb68a24f68041d2bb7d90917b8dc989e2/Anchor.toml)                                                                                            |
| Documented USDC bank | `3uxNepDbmkDNq6JhRja5Z8QwbTrfmkKP8AKZV5chYDGG` | Marginfi's official [Rust SDK deposit walkthrough](https://docs.marginfi.com/rust-sdk) identifies this bank for its native-USDC example                                                                                                                                                                                                                                                              |
| Native USDC mint     | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Marginfi's official [bank and price documentation](https://docs.marginfi.com/typescript-sdk/banks-and-prices) and Circle's [official USDC address registry](https://developers.circle.com/stablecoins/usdc-contract-addresses)                                                                                                                                                                       |

The bank identity is documentation evidence, not a current-state attestation. These sources do not establish the currently deployed ProgramData account, deployed bytecode, deployment slot, upgrade authority, current group/bank configuration, or current account contents. Consequently, no default deployment manifest is shipped.

Additional immutable parser references are:

- Solana upgradeable-loader format: `solana-labs/solana@7700cb3128c1f19820de67b81aa45d18f73d2ac0`, [`bpf_loader_upgradeable.rs`](https://github.com/solana-labs/solana/blob/7700cb3128c1f19820de67b81aa45d18f73d2ac0/sdk/program/src/bpf_loader_upgradeable.rs).
- Legacy SPL Token mint/account format: `solana-program/token@0087ca54bd5a5b07e1df7e1b52303529047a1186`, [`interface/src/state.rs`](https://github.com/solana-program/token/blob/0087ca54bd5a5b07e1df7e1b52303529047a1186/interface/src/state.rs).

## Source-derived account layouts

Marginfi's pinned [`Bank`](https://github.com/0dotxyz/marginfi-v2/blob/5c97c5efb68a24f68041d2bb7d90917b8dc989e2/type-crate/src/types/bank.rs) is `#[repr(C)]`, aligned to 8 bytes, and compile-time asserted to have a 1,856-byte payload. Its Anchor account discriminator is `[142, 49, 166, 242, 50, 66, 97, 188]`, so accepted account data is exactly 1,864 bytes. The pinned SDK's [`marginfi_0.1.11.json`](https://github.com/0dotxyz/p0-ts-sdk/blob/64773b237961c17e5dacbbf4bfe87b8af22e885b/src/idl/marginfi_0.1.11.json) and raw-bank decoder independently corroborate the discriminator, field order, and bytemuck serialization.

The nested [`BankConfig`](https://github.com/0dotxyz/marginfi-v2/blob/5c97c5efb68a24f68041d2bb7d90917b8dc989e2/type-crate/src/types/bank_config.rs) is exactly 544 bytes. The [`BankCache`](https://github.com/0dotxyz/marginfi-v2/blob/5c97c5efb68a24f68041d2bb7d90917b8dc989e2/type-crate/src/types/bank_cache.rs) is exactly 160 bytes. Offsets below are account-data offsets and therefore include the 8-byte Anchor discriminator.

| Account offsets                    | Enforced meaning                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bank `0..7`                        | Exact Bank discriminator                                                                                                                         |
| `8..40`, `40`, `41..72`            | Native-USDC mint, 6 decimals, exact production-group link                                                                                        |
| `80..111`, `256..287`              | Positive raw asset/liability share values and nonnegative raw total liability/asset shares; emitted only as canonical little-endian I80F48 bytes |
| `112..145`, `146..179`, `200..233` | Exact liquidity, insurance, and fee vault public keys plus exact vault/authority bumps                                                           |
| `288..295`                         | Positive `last_update` Unix seconds for the last interest accrual                                                                                |
| `360..367`, `776..783`             | Caller-pinned raw deposit and borrow limits                                                                                                      |
| `608`, `784`, `785`                | Operational state `Operational` (1), risk tier `Collateral` (0), asset tag `DEFAULT` (0)                                                         |
| `609`, `610..641`, `800..801`      | Caller-pinned current external-oracle setup, nonzero primary oracle key, and source-valid minimum oracle age                                     |
| `840..847`                         | Known source flags only; Token-2022 flag must be clear for native classic-SPL USDC                                                               |
| `1408..1447`                       | Positive cached oracle price, positive timestamp, and nonnegative confidence, retained as raw I80F48 bytes and Unix seconds                      |
| `1448`, `1536..1543`               | Valid cache flag bits and raw signed lending/borrowing position counts                                                                           |
| `1560..1655`                       | All three integration accounts zero for a default/native bank                                                                                    |
| `1776`                             | Circuit-breaker tier zero                                                                                                                        |

The pinned `BankOperationalState` representation defines `Paused=0`, `Operational=1`, `ReduceOnly=2`, `KilledByBankruptcy=3`, `Uninitialized=4`, `ReduceOnlyWithBorrowingPower=5`, and `CircuitBroken=6`. Only `Operational` is accepted. Deprecated, unset, fixed-price, and integration-specific oracle configurations are rejected. This dormant native-USDC boundary permits only source-defined external configurations Pyth Push (3), Switchboard Pull (4), or Scope (18), and the exact observed choice must also match the caller manifest.

The pinned [`MarginfiGroup`](https://github.com/0dotxyz/marginfi-v2/blob/5c97c5efb68a24f68041d2bb7d90917b8dc989e2/type-crate/src/types/group.rs) defines a current 9,248-byte payload and explicitly documents a byte-identical legacy 1,056-byte prefix. The caller must pin exactly one corresponding account length, 9,256 or 1,064 bytes including the discriminator. The parser checks the exact discriminator, nonzero admin, and currently defined group flag mask; its exact whole-account hash binds every unparsed field.

## Vault PDA and SPL-account binding

The seed constants come from the pinned program's [`constants.rs`](https://github.com/0dotxyz/marginfi-v2/blob/5c97c5efb68a24f68041d2bb7d90917b8dc989e2/type-crate/src/constants.rs). The pinned SDK's [`pda.utils.ts`](https://github.com/0dotxyz/p0-ts-sdk/blob/64773b237961c17e5dacbbf4bfe87b8af22e885b/src/utils/pda.utils.ts) independently shows `findProgramAddressSync([seed, bank.toBuffer()], programId)`. Tests independently rederive all six values:

| Seed                   | PDA                                            | Bump |
| ---------------------- | ---------------------------------------------- | ---: |
| `liquidity_vault`      | `BKkAkaN9hzbY1SUu2kmZQYGm2yfngyjq1p8opdUVtEXU` |  252 |
| `liquidity_vault_auth` | `6U6X3Xn9gcc4Bu1ubmvMbGmuHwHFR4KgvMzHw9mk5VVT` |  253 |
| `insurance_vault`      | `72v6pWXgaBx9sFRBC4J2knf1AWwAddFTzW3UvF1FYmUV` |  254 |
| `insurance_vault_auth` | `5stbFPAJSgNTZ4M8Q11bMDYjmunTymABKtiuE4kVzTea` |  255 |
| `fee_vault`            | `CijyE1PABfZE7WUVCmqfGTFkHMV1KpqefvD7WGgr2wdL` |  253 |
| `fee_vault_auth`       | `9yvBHzFpm1EtuhoaP8qo4ZtbWrg5vQqChbrP239DM57Z` |  255 |

Each 165-byte vault must be owned by the legacy SPL Token program, link native USDC to the matching derived authority, be initialized, and have no delegate, native reserve, delegated amount, or close authority. Vault amounts are emitted as raw atomic integers only; they are not withdrawable liquidity or deposit capacity.

## Caller-bound manifest

A caller must provide all of the following without defaults:

- exact ProgramData public key, Program and ProgramData account SHA-256 values, ProgramData length, full binary-region SHA-256, last deployed slot, and nullable upgrade authority;
- exact group, bank, mint, and three vault account SHA-256 values;
- exact group account length;
- exact operational/risk/asset states, external oracle setup and primary key, deposit limit, borrow limit, and oracle maximum age; and
- the current mainnet supported-asset-registry fingerprint.

Three domain-separated SHA-256 fingerprints are canonicalized:

1. `sourceFingerprintSha256` binds official source commits/layout tokens, registry identity, network, program/group/bank/mint identities, loader/token-program identities, and all vault PDAs.
2. `deploymentFingerprintSha256` binds the caller's complete deployment and account/configuration manifest.
3. `manifestFingerprintSha256` binds the complete canonical manifest plus the two preceding fingerprints.

The adapter constructor requires exact independent caller pins for all three. Supplying only some embedded fingerprints, changing any field, using noncanonical integer text, or substituting a zero digest fails before transport use. Hash equality detects substitution relative to a caller-approved manifest; it does not prove that the manifest capture itself was authentic.

## Finalized transcript binding

The injected transport must return exactly this sequence:

1. `getGenesisHash`, equal to the pinned Solana mainnet-beta genesis hash.
2. `getSlot({ commitment: "finalized" })` for the minimum context slot.
3. One `getMultipleAccounts` for exactly Program, ProgramData, production group, documented USDC bank, native-USDC mint, liquidity vault, insurance vault, and fee vault, with `commitment: "finalized"`, canonical `base64`, and that `minContextSlot`.
4. `getBlock(snapshotSlot, { commitment: "finalized", transactionDetails: "none", rewards: false })`.
5. A finalized progress-slot recheck constrained by the snapshot slot.
6. The same finalized block read again; blockhash, previous blockhash, parent slot, block height, and block time must be identical.
7. A final mainnet genesis-hash recheck.

Solana documents the ordering and context behavior of [`getMultipleAccounts`](https://solana.com/docs/rpc/http/getmultipleaccounts), finalized [`getSlot`](https://solana.com/docs/rpc/http/getslot), and [`getBlock`](https://solana.com/docs/rpc/http/getblock). All eight accounts must be present in one context and match exact owner, executable flag, space, data length, canonical base64, and nonzero caller-pinned digest.

Inputs are bounded, acyclic plain data. Accessors, symbols, sparse arrays, custom prototypes, non-integer JSON numbers, oversized values, malformed envelopes, RPC errors, and transport exceptions all collapse to the same sanitized unavailable error.

## Freshness and deliberately raw output

The finalized block time, Bank interest-accrual `last_update`, and cached-oracle timestamp must all be nonfuture and strictly younger than the caller's positive bound, capped at 3,600 seconds. Bank and cached-oracle timestamps cannot be later than the snapshot block time. Cached-oracle age additionally uses the tighter of the caller bound and the bank's exact configured `oracle_max_age`. Equality at any age boundary fails.

The Bank source warns that cached oracle values update only when an instruction consumes an oracle price; deposit and repay operations need not update them. Therefore an accepted candidate says `CURRENT_CACHED_TIMESTAMP_ONLY_NO_ORACLE_ACCOUNT_PROOF`. It does not claim to have fetched or decoded the current external oracle account.

Although `BankCache` contains rate fields, this adapter deliberately does not emit or transform them. It emits no APR, APY, utilization, token-value conversion, price conversion, or capacity. Raw vault balances, raw share fields, and configured limits cannot independently establish depositable or withdrawable liquidity.

## Residual production gates

Before any export, DI registration, writer, recommendation consumer, or transaction path is considered, all of these gates remain open:

1. Capture the complete manifest and finalized transcript from an allowlisted mainnet source, then independently corroborate the same slot and accounts with a separately operated source or cryptographic account proofs rooted in independently trusted state.
2. Derive the ProgramData PDA independently and reproduce or otherwise approve the deployed binary against reviewed source, toolchain, build inputs, and deployment governance. A source commit pin alone does not prove deployed-code equivalence.
3. Add separately reviewed oracle-account evidence for the exact active setup: identity, owner/program, format/version, publication slot/time, status, confidence, exponent, and source-specific freshness. The cache-only evidence here is insufficient for valuation or recommendations.
4. Review upgrade and group authorities, delegates, configuration flags, oracle migration controls, circuit breaker, panic/rate-limit state, withdrawal mechanics, caps, insolvency/bad-debt behavior, incidents, and asset-specific risk.
5. Implement and verify Marginfi-native share accounting, interest/rate semantics, utilization, fees, deposit/withdraw constraints, and APR-to-APY policy. Do not infer capacity from vault balance or deposit limit.
6. Define signed-manifest custody and rotation, quorum policy, replay/idempotency, durable observation schema, monitoring, alerting, kill switches, incident response, and rollback.
7. Complete security, legal/compliance, finance, product, and operations approval before activation.

The 126 focused tests use synthetic account bytes. This slice performed no live mainnet RPC read, transaction, secret access, database write, runtime registration, provider activation, or user recommendation.
