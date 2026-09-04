# Jupiter Lend Solana finalized transcript research

Status: **dormant and unregistered**. This reader is a corroboration seam, not a production market feed. It owns no endpoint, RPC client, environment variable, credential, writer, retry loop, or dependency-injection registration.

## Narrow scope

The adapter reads exactly the Jupiter Lend Earn USDC market on Solana mainnet. It emits the two stored `u64` exchange-price fields from the Lending account as raw decimal integers. It does not calculate, label, or imply APR/APY, yield, liquidity, capacity, withdrawability, recommendation eligibility, or permission to transact. It also reports the underlying and jlUSDC mint supplies only as raw mint evidence.

Every successful value remains:

- `UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT`;
- `BLOCKED_PENDING_INDEPENDENT_SOURCE_AND_RISK_VERIFICATION`;
- `mayPersist: false`;
- `mayEstablishRecommendationEligibility: false`; and
- `mayAuthorizeFinancialAction: false`.

## Official evidence reviewed

The local research capture is rooted at `C:\Users\Admin\AppData\Local\Temp\codex-jupiter-research-20260904`.

- The official [`jup-ag/jupiter-lend` repository](https://github.com/jup-ag/jupiter-lend/tree/33a22cf7a5bfdd32ab1712dda4adfbeb9b348ad9) was reviewed at commit `33a22cf7a5bfdd32ab1712dda4adfbeb9b348ad9`. The checkout's origin is `https://github.com/jup-ag/jupiter-lend.git`.
- [`target/idl/lending.json`](https://github.com/jup-ag/jupiter-lend/blob/33a22cf7a5bfdd32ab1712dda4adfbeb9b348ad9/target/idl/lending.json) is 41,287 bytes with SHA-256 `370f421ba919ed331ba952f0fa8566dcf7ffb3460bb87a7928a04f0422b979e2`. It identifies program `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9`, IDL version `0.1.4`, discriminator `[135,199,82,16,249,131,182,241]`, and the exact Lending field order used by the parser.
- The official [Earn SDK guide](https://github.com/jup-ag/jupiter-lend/blob/33a22cf7a5bfdd32ab1712dda4adfbeb9b348ad9/docs/earn/sdk.md) identifies Solana mainnet USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and example jlUSDC mint `9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D`.
- The captured official `@jup-ag/lend-read` `0.0.14` tarball is 256,048 bytes with SHA-256 `eb2c99852604c178f163b484e55e6b7ce73d4f7093f5ccffeb1701d1460a3f82`. Its README identifies the Lending, Liquidity, and Lending Reward Rate Model mainnet programs, and its PDA helpers expose the exact seed recipes below.
- The adapter also pins the official Jupiter docs snapshot `jup-ag/docs@c4b7ee1172ebb1c58407e479e7153bf225690aaf`; the caller must reproduce and approve the complete manifest fingerprint rather than accepting repository names alone.
- Solana documents that [`getMultipleAccounts`](https://solana.com/docs/rpc/http/getmultipleaccounts) returns accounts in request order in one RPC response context and supports both `commitment` and `minContextSlot`. Solana's [`getBlock`](https://solana.com/docs/rpc/http/getblock) contract exposes the selected slot's block hash, previous block hash, parent slot, height, and time and supports `finalized` commitment.

The PDA identities were reproduced from the official read SDK's seeds and program IDs:

| Identity                | Derivation / value                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| jlUSDC mint             | `findProgramAddress(["f_token_mint", USDC], LendingProgram)` → `9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D`                       |
| USDC Lending            | `findProgramAddress(["lending", USDC, jlUSDC], LendingProgram)` → `2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ`                    |
| Liquidity reserve       | `findProgramAddress(["reserve", USDC], LiquidityProgram)` → `94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu`                           |
| Lending supply position | `findProgramAddress(["user_supply_position", USDC, Lending], LiquidityProgram)` → `Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF`    |
| Reward-rate model       | `findProgramAddress(["lending_rewards_rate_model", USDC], RewardRateModelProgram)` → `5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd` |

The active repository asset registry is also part of the caller manifest fingerprint. The manifest becomes invalid if active mainnet USDC registry version 1, its address, its six decimals, or its fingerprint no longer match.

## Transcript and validation contract

The injected transport must return this exact bounded seven-call transcript:

1. `getGenesisHash` equals the Solana mainnet genesis hash.
2. `getSlot({commitment:"finalized"})` chooses a lower bound.
3. One ordered `getMultipleAccounts` call reads the upgradeable Program, ProgramData, Lending, USDC mint, and jlUSDC mint with `commitment:"finalized"`, `encoding:"base64"`, and that `minContextSlot`.
4. `getBlock(context.slot, {commitment:"finalized",transactionDetails:"none",rewards:false})` binds the context slot to block identity and parent evidence.
5. A second finalized `getSlot` with `minContextSlot: context.slot` prevents reported finalized progress from regressing.
6. The same slot is read again and every accepted block field must match.
7. `getGenesisHash` is rechecked to detect a transport that switches networks mid-transcript.

The parser rejects unknown or missing keys, accessors, symbols, cycles, custom object/array prototypes, non-integer JSON numbers, oversized/deep transcripts, noncanonical base64/base58, missing accounts, owner/executable/space drift, wrong layouts or discriminators, bad cross-account addresses, code-hash drift, invalid SPL COptions, zero stored prices, invalid timestamps, and any same-slot block mismatch. Transport failures collapse to one bounded sanitized `JupiterLendSolanaTranscriptUnavailableError` and never expose upstream details.

The caller supplies and separately pins:

- the complete source and active-asset-registry manifest;
- ProgramData address, exact account length, runtime binary SHA-256, deployment slot, and upgrade authority (including explicit `null` for a revoked authority);
- Lending ID; and
- jlUSDC mint and freeze authorities.

The maximum freshness is a positive canonical number of seconds no greater than 3,600. Both the block time and Lending account `last_update_timestamp` must be strictly younger than the bound; equality is stale. `staleAfter` uses the earlier of those two source times.

## Why the exchange prices remain raw

The IDL calls `liquidity_exchange_price` the underlying asset's liquidity-protocol exchange price without rewards and `token_exchange_price` the fToken-to-underlying exchange price with rewards. The official read SDK's current-value path combines additional reserve, reward-model, supply, and time inputs and may simulate an `update_rate` instruction. This adapter intentionally does none of that. It only reports the two stored account integers and does not attach rate, return, or yield semantics.

That distinction is especially important because Jupiter publishes a [Lend Liquidity security assessment](https://dev.jup.ag/assets/files/lend-liquidity-offside-e7263e513a28a25f7430215e7fb987fb.pdf) that includes exchange-price/update-time findings. A successful decode is not a risk approval or proof that a stored price is economically current.

## Remaining live gates

Before this code can be registered or its result persisted, all of the following remain required:

1. Reproduce the source, package, PDA, ProgramData, code-hash, authority, Lending-ID, and jlUSDC-authority evidence through a reviewed release process.
2. Approve at least two operationally independent, authenticated Solana mainnet RPC sources and define quorum/disagreement handling. Repeating calls to one endpoint is continuity checking, not independent authenticity proof.
3. Perform a protocol/security review covering upgrade authority, admin/pause/lockdown controls, oracle and liquidity dependencies, reward model, audits, incident response, and deployment history.
4. Define a separate current-rate methodology if the product later needs rates. The two raw stored exchange prices are not APR/APY and are insufficient on their own.
5. Define capacity/withdrawability evidence separately. Neither mint supply nor a Lending exchange price establishes available liquidity.
6. Add endpoint configuration, authentication, timeouts, retries, circuit breaking, telemetry, quorum logic, and controlled runtime registration in a separately reviewed change.
7. Run live-provider conformance captures without weakening this parser, then obtain explicit market and persistence approval.

Until those gates are complete, this adapter must stay dormant and unexported from runtime composition.
