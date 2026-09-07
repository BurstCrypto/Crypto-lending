# Save Lend Solana finalized transcript foundation

- Status: dormant research boundary only
- Reviewed: 2026-09-04
- Network: Solana mainnet-beta
- Asset: native USDC (6 decimals)
- Market selection: Save main market (the protocol and repositories retain the Solend name)

## Decision

This slice implements a fail-closed parser for one caller-supplied Solana JSON-RPC transcript. It does not create a client, choose or accept an RPC endpoint, read live data, register dependency injection, persist evidence, calculate a rate, calculate deposit capacity, rank Save, recommend a deposit, or authorize a transaction.

The pinned official source snapshots establish the program and main-market identities. The main-market USDC reserve identity was observed through Save's production configuration API during read-only research on 2026-09-04. That API response is expressly treated as untrusted identity-discovery evidence, not a runtime dependency, an independent source, or approval.

| Role                        | Pinned identity                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Save/Solend lending program | `So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo`  | The official public SDK [production program constant at `b3b46ffb`](https://github.com/solendprotocol/public/blob/b3b46ffbc2f5162b6e5680dd3cad1042c2eb3f8e/solend-sdk/src/core/constants.ts) and the program SDK's [`declare_id!` at `d04ce00b`](https://github.com/solendprotocol/solana-program-library/blob/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending/sdk/src/lib.rs)             |
| Main lending market         | `4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY` | The official public SDK [`MAIN_POOL_ADDRESS` at `b3b46ffb`](https://github.com/solendprotocol/public/blob/b3b46ffbc2f5162b6e5680dd3cad1042c2eb3f8e/solend-sdk/src/core/constants.ts)                                                                                                                                                                                                              |
| Main-market USDC reserve    | `BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw` | Read-only research result from the production configuration route used by the official SDK's pinned [`fetchPoolMetadata`](https://github.com/solendprotocol/public/blob/b3b46ffbc2f5162b6e5680dd3cad1042c2eb3f8e/solend-sdk/src/core/utils/config.ts). The response is not trusted as account state, is not embedded as a captured approval artifact, and must be corroborated before activation. |
| Native USDC mint            | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | The repository's [mainnet test identity](https://github.com/solendprotocol/solana-program-library/blob/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending/program/tests/helpers/mod.rs) and Circle's [official USDC address registry](https://developers.circle.com/stablecoins/usdc-contract-addresses)                                                                                      |

The source evidence does **not** establish the currently deployed ProgramData address, deployed binary, deployment slot, upgrade authority, or current account contents. No default manifest is shipped. A caller must provide all of those values, exact account SHA-256 values, and a separate exact fingerprint of the complete canonical manifest.

## Source and layout pins

- Public SDK/application repository: `solendprotocol/public@b3b46ffbc2f5162b6e5680dd3cad1042c2eb3f8e`.
- Lending program repository, `mainnet` branch snapshot: `solendprotocol/solana-program-library@d04ce00bbf4356c4fd32b3be38eb9760b696bb3e`.
- Upgradeable-loader reference: archived official Solana source `solana-labs/solana@7700cb3128c1f19820de67b81aa45d18f73d2ac0`, [`bpf_loader_upgradeable.rs`](https://github.com/solana-labs/solana/blob/7700cb3128c1f19820de67b81aa45d18f73d2ac0/sdk/program/src/bpf_loader_upgradeable.rs).
- Legacy SPL Token mint reference: `solana-program/token@0087ca54bd5a5b07e1df7e1b52303529047a1186`, [`interface/src/state.rs`](https://github.com/solana-program/token/blob/0087ca54bd5a5b07e1df7e1b52303529047a1186/interface/src/state.rs).

The Save offsets come from the pinned program's `Pack` implementations, not from reverse engineering a live account:

- [`LendingMarket`](https://github.com/solendprotocol/solana-program-library/blob/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending/sdk/src/state/lending_market.rs) has an exact packed length of 290 bytes.
- [`Reserve`](https://github.com/solendprotocol/solana-program-library/blob/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending/sdk/src/state/reserve.rs) has an exact packed length of 619 bytes.
- [`LastUpdate`](https://github.com/solendprotocol/solana-program-library/blob/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending/sdk/src/state/last_update.rs) stores only an update slot and stale flag. The pinned program declares a reserve stale when one or more slots have elapsed.
- [`RateLimiter`](https://github.com/solendprotocol/solana-program-library/blob/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending/sdk/src/state/rate_limiter.rs) accounts for the 56-byte packed regions in the market and reserve layouts.

Decoded bytes are intentionally narrow:

| Account             | Account-data byte offsets used                                           | Meaning enforced                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upgradeable Program | `0..3`, `4..35`                                                          | bincode `Program` variant and exact embedded ProgramData public key; exact length 36                                                                                                                      |
| ProgramData         | `0..3`, `4..11`, `12`, `13..44`, `45..`                                  | `ProgramData` variant, deployment slot, decoded optional authority, ELF marker, complete account hash, and SHA-256 of the full binary region                                                              |
| LendingMarket       | `0`, `2..33`, `66..97`, `250..281`                                       | exact source version 1, nonzero owner, legacy SPL Token program, and effective risk authority (including the pinned program's zero-to-owner migration fallback); length 290                               |
| Reserve             | `0..9`, `10..73`, `74`, `171..194`, `259..266`, `323..338`, `469`, `521` | exact source version 1, current-slot non-stale refresh, exact market and mint, 6 decimals, valid reserve/option enums, and raw available, borrowed-WAD, collateral-supply, and limit integers; length 619 |
| SPL Token mint      | `0..81`                                                                  | canonical COptions, nonzero supply, 6 decimals, initialized flag, mint authority, and freeze authority; exact length 82                                                                                   |

The complete Program record, complete ProgramData record, market, reserve, and mint each require a nonzero caller-pinned SHA-256. ProgramData additionally requires an independently pinned hash of all bytes after its 45-byte metadata header. Exact hashes detect substitution relative to the caller manifest; they do not prove how the caller obtained or approved those bytes.

## Transcript binding

The injected transport must return this exact sequence:

1. `getGenesisHash`, equal to Solana mainnet-beta's pinned genesis hash.
2. `getSlot({ commitment: "finalized" })` to establish the minimum context slot.
3. One `getMultipleAccounts` for exactly Program, ProgramData, LendingMarket, Reserve, and USDC mint, with `commitment: "finalized"`, `encoding: "base64"`, and that `minContextSlot`.
4. `getBlock(snapshotSlot, { commitment: "finalized", transactionDetails: "none", rewards: false })` with a nonzero blockhash and block time.
5. A finalized `getSlot` progress recheck using the snapshot slot as `minContextSlot`.
6. A second read of the same finalized block; blockhash, previous blockhash, parent slot, block height, and block time must match exactly.
7. A final `getGenesisHash` identity recheck.

Solana documents that [`getMultipleAccounts`](https://solana.com/docs/rpc/http/getmultipleaccounts) returns account values in request order and supports `commitment` and `minContextSlot`. [`getSlot`](https://solana.com/docs/rpc/http/getslot) reports the slot for a commitment, and [`getBlock`](https://solana.com/docs/rpc/http/getblock) supplies the block identity and estimated time used here.

All five accounts must be present in the same returned context and match exact owner, executable flag, data length, canonical base64, space, and bounded metadata. Inputs and RPC responses must be acyclic plain data with no accessors, symbols, sparse arrays, custom prototypes, floating-point numbers, or unbounded strings. RPC errors and every parse failure collapse to one sanitized unavailable error.

## Freshness

Save's pinned `LastUpdate` has no timestamp. The adapter therefore keeps two different freshness checks explicit:

- The finalized block time must be in the past and strictly younger than the caller's positive bound, capped at 3,600 seconds. Age equal to the bound fails.
- The reserve's stored stale flag must be false and `last_update.slot` must equal the single account snapshot slot. The manifest field `maximumReserveSlotLag` is required to equal canonical string `"0"`, matching the pinned program's `STALE_AFTER_SLOTS_ELAPSED = 1` behavior. There is no seconds-based estimate derived from slot duration.

Clock values must have exactly `Date.prototype`. Invalid Dates, Date subclasses, and Date proxies fail. Own `getTime` or `toISOString` overrides are never invoked.

## Deliberately absent calculations and authority

The candidate exposes only raw integer strings from the pinned packed fields. In particular, it does not:

- apply Save's WAD scale to borrowed liquidity;
- calculate utilization, supply APR, borrow APR, or APY;
- consume or interpret Pyth, Switchboard, or extra-oracle values;
- subtract borrows, outflow limits, protocol fees, or withdrawal constraints to infer capacity;
- value collateral or attribute risk; or
- turn a configured deposit limit into currently available deposit capacity.

Every accepted result states:

- `sourceAuthenticity: UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT`;
- `yieldEvidenceStatus: ABSENT_NOT_COMPUTED`;
- `liquidityEvidenceStatus: RAW_AVAILABLE_AMOUNT_ONLY_NOT_CAPACITY`;
- `mayPersist: false`;
- `mayEstablishRecommendationEligibility: false`; and
- `mayAuthorizeFinancialAction: false`.

Repeated finalized-slot, block, and genesis checks detect internal transcript inconsistency. They do not make one injected RPC independent, Byzantine-resistant, or authentic. `minContextSlot` is a node constraint rather than an account-state proof. Block time is an estimate and is used only as a bounded freshness signal.

## Dormant account-position semantics foundation

The 2026-09-06 account-position slice separately pins the exact content SHA-256
of the program's `Obligation`, `Reserve`, state constants, Decimal math, and WAD
definitions, plus the corresponding public SDK layouts. It implements only a
pure evaluator over caller-supplied bytes; it owns no RPC endpoint or client and
is not exported or registered at runtime.

The reviewed obligation layout is exactly 1,300 bytes. It binds the lending
market at offset 10 and owner at offset 42, reads declared deposit and borrow
counts at offsets 202 and 203, rejects entries beyond the 1,096-byte packed
region, and inspects every declared entry. For the selected USDC reserve it:

- converts deposited collateral to underlying liquidity using the pinned
  reserve total-supply and collateral-exchange-rate sequence, excluding accrued
  protocol fees and flooring exactly where the program floors;
- accrues each stored borrow from its obligation cumulative rate to the
  same-context reserve cumulative rate using the pinned two-step WAD math, then
  ceilings the atomic debt as the program's repay path does; and
- rejects negative interest, noncanonical booleans/base64, duplicate accounts
  or reserve entries, wrong owner/market/program, digest or context mismatch,
  stale reserve state, and every checked U192/U128/U64 overflow.

The discovery plan applies exact `dataSize`, market, and owner filters and uses
finalized `withContext` plus an authenticated durable `minContextSlot`. Standard
Solana JSON-RPC does not authenticate that `getProgramAccounts` was exhaustive
or untruncated, however, and independently issued reserve and obligation calls
do not by themselves prove one atomic state view. Consequently every result is
explicitly `INCOMPLETE_UNVERIFIED_DISCOVERY`, with persistence, complete-position
authority, and financial-action authority all hard-coded false.

## Residual production gates

Before any runtime export or persistence path is considered, all of the following remain required:

1. Independently corroborate the Save main-market USDC reserve identity. The production configuration API observation alone is insufficient.
2. Approve an exact ProgramData public key, Program and ProgramData account hashes, account length, deployment slot, binary hash, upgrade-authority state, and current market/reserve/mint hashes in a separately controlled signed manifest.
3. Derive and verify the ProgramData PDA, and reproduce the deployed binary from reviewed source and toolchain inputs or approve a documented equivalent provenance control.
4. Obtain the same snapshot from independently operated, allowlisted Solana sources or verify cryptographic account proofs against an independently trusted root. Multiple URLs operated by one vendor are not independent.
5. Review Save's upgrade governance, administrative authorities, incident controls, oracle configuration, price freshness, withdrawal mechanics, utilization, rate limiters, reserve type, caps, bad debt, and asset-specific risk.
6. Extend the now-pinned deposit/debt accounting with independently reviewed withdrawal semantics, capacity, and APR-to-APY methodology plus independent price evidence.
7. Define durable observations, replay/idempotency, monitoring, alerting, circuit breakers, and rollback before adding a writer or recommendation consumer.
8. Complete legal/compliance, security, finance, operational, and product approval. Only then may a separately reviewed change add DI registration, an allowlisted endpoint, egress, or transaction capability.

The unit transcript is synthetic. This slice performed no live mainnet RPC read, transaction, secret access, database write, provider activation, or user recommendation. The research-only configuration lookup is not reachable from application code.
