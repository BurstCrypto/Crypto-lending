# Morpho Blue Ethereum finalized transcript boundary

Status: **dormant and non-persistable**. This note records a parser/evidence
boundary, not an approved market, RPC provider, production feed, or activation
decision. Nothing in this slice is registered with Nest, a database writer, or
the provider registry.

## Narrow supported claim

Given a caller-supplied, separately fingerprinted manifest for exactly one
Ethereum-mainnet Morpho Blue market, the adapter can check that one injected
JSON-RPC transcript consistently reports:

- chain ID `0x1` and a `finalized` block header;
- the documented Ethereum Morpho address
  `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`;
- an exact caller-supplied Morpho runtime-code Keccak-256 hash;
- exact loan-token, collateral-token, oracle, IRM, and LLTV identities, including
  a recomputed market ID;
- exact caller-supplied runtime-code hashes for the four market dependencies;
- `isIrmEnabled(irm) == true` and `isLltvEnabled(lltv) == true`; and
- the six raw integer fields returned by `market(id)`.

Every `eth_getCode` and `eth_call` is pinned to the captured block with the
EIP-1898 object `{ blockHash, requireCanonical: true }`. The adapter then reads
the captured height again with `eth_getBlockByNumber` and requires the number,
hash, parent hash, state root, and timestamp to remain identical before checking
the chain ID again. Re-reading by height is intentional: a client can still
return an orphaned block when queried only by hash. The initial header, recheck
header, runtime code, ABI values, configured identities, manifest fingerprint,
and observation time are covered by a transcript fingerprint.

This is coherence evidence from one injected source. It is **not proof that the
RPC response is authentic, independently corroborated, or actually finalized**.
A malicious or faulty RPC can fabricate a self-consistent transcript. The
manifest fingerprint prevents accidental/substitution drift only; matching it
does not approve the manifest.

## Why the result is not a lending-market snapshot

Morpho's official `IMorpho` interface warns that the raw `market(id)` supply and
borrow asset totals do not include interest accrued since the last accrual, and
that supply shares can also omit newly accrued fee-recipient shares. The adapter
therefore labels the result `NOT_ACCRUED_RAW_MARKET_STORAGE` and does not compute
or expose:

- supply or borrow APY;
- accrued asset totals, liquidity, or utilization;
- oracle price or collateral health;
- provider supply-open status or capacity; or
- any recommendation/risk/transaction decision.

The existing provider-native market port requires a defensible base supply APY
and provider-native status. Filling those fields from this transcript would
invent data, so this candidate intentionally does not implement that port.
Likewise, it reads no wallet-specific `position(id, user)` state and therefore
cannot create a mainnet provider-position observation.

## Dormant account-position semantics

A separate content-fingerprinted artifact records the exact offline arithmetic
needed to interpret caller-supplied Morpho Blue account state. It remains
deliberately disconnected from the finalized-transcript adapter: it creates no
endpoint or client, performs no RPC or transaction, reads no environment
variable, registers no DI binding or route, and cannot persist or authorize a
financial action. Its output explicitly says both that completeness is not
established and that the calculation used only unauthenticated, caller-supplied
state. A versioned SHA-256 fingerprint covers its immutable source pins, ABI,
storage, accrual, conversion, discovery, and block-context rules so a semantic
change cannot be mistaken for the reviewed artifact. Version 1 is pinned as
`06825a41d6d93686df57e6c4e8e14b1026e8f0bcc8e4473b5517c3021eb73d4b`.

The storage meanings pinned from the official source are:

- `position(marketId, wallet)` returns `supplyShares` as `uint256`,
  `borrowShares` as `uint128`, and `collateral` as `uint128` for that exact
  owner key; and
- `market(marketId)` returns `totalSupplyAssets`, `totalSupplyShares`,
  `totalBorrowAssets`, `totalBorrowShares`, `lastUpdate`, and `fee`, all as
  `uint128`. The asset totals and the fee recipient's newly accrued supply
  shares are raw, unaccrued storage.

The dormant evaluator first enforces the source-level invariants, including a
positive `lastUpdate` no later than the selected block, paired zero/nonzero
borrow assets and shares, borrow assets no greater than supply assets, and a
maximum fee of `0.25e18`. This last bound is intentionally stricter than the
existing transcript parser's generic one-WAD structural ceiling: it is Morpho's
`MAX_FEE`, not a newly inferred policy.

### Accrual, fees, and share conversion

For `elapsed = selected block timestamp - lastUpdate`, the official view helper
calls the market IRM's `borrowRateView` only when elapsed time, raw borrow assets,
and the IRM address are all nonzero. The call arguments must be the exact market
parameters and raw six-word market tuple from the same selected block. The core
state-changing accrual path can call the IRM when borrow assets are zero, but its
balances remain unchanged; the dormant read calculation follows the official
view helper's narrower call gate and never sends `accrueInterest`.

Given the returned per-second WAD rate, the checked-integer calculation is:

```text
first      = rate * elapsed
second     = floor(first * first / (2 * 1e18))
third      = floor(second * first / (3 * 1e18))
compounded = first + second + third
interest   = floor(rawTotalBorrowAssets * compounded / 1e18)
```

Interest is added to both raw asset totals. Pending fee issuance is then:

```text
feeAmount = floor(interest * fee / 1e18)
feeShares = floor(
  feeAmount * (rawTotalSupplyShares + 1_000_000)
  / ((accruedTotalSupplyAssets - feeAmount) + 1)
)
```

`feeShares` is added to accrued total supply shares. If and only if the queried
wallet equals the `feeRecipient` read in the same block context, those pending
shares are also added to its raw position before supply conversion. Treating the
fee recipient as an ordinary account would understate its expected supply
assets.

Morpho's virtual values are one asset unit and 1,000,000 shares. The account
conversion therefore uses:

```text
supplyAssets = floor(
  adjustedSupplyShares * (accruedTotalSupplyAssets + 1)
  / (accruedTotalSupplyShares + 1_000_000)
)

borrowAssets = ceil(
  borrowShares * (accruedTotalBorrowAssets + 1)
  / (totalBorrowShares + 1_000_000)
)
```

Supply rounds down and borrow rounds up. The per-position borrow result can
legitimately exceed the market's expected total because of upward rounding and
must not be silently clamped. Every multiplication, addition, subtraction,
`uint128` cast, and round-up addition follows Solidity 0.8 checked semantics;
any overflow, underflow, impossible timestamp, malformed integer, or unsupported
branch fails closed.

The core repository defines only the generic `IIrm` interface. It does not
provide the implementation-specific rate math for every permissionlessly
enabled market IRM. Consequently, a generic Blue source pin cannot validate an
arbitrary IRM: each selected market needs separately pinned IRM source/build and
runtime-code identity, and its exact same-block `borrowRateView` result must be
an input to the offline projection. Missing evidence is an error, never a zero
rate or guessed model.

### Completeness and false authority boundaries

Morpho Blue exposes no enumerable market list. A complete direct-position claim
therefore requires a proven, non-truncated `CreateMarket` history from the
authenticated deployment block through the selected block. For every unique
event ID, a reader must decode the parameters, recompute
`keccak256(abi.encode(loanToken, collateralToken, oracle, irm, lltv))`, verify
`idToMarketParams` and created market state, and query
`position(id, connectedWallet)` for the exact wallet. A standard
`eth_getLogs` response is not by itself proof of completeness because provider
range limits or silent truncation can omit markets. Unsupported markets or IRMs
cannot be skipped while still claiming the account is complete.

The pinned event is
`CreateMarket(bytes32,(address,address,address,address,uint256))`, whose topic 0
is
`0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac`.

`isAuthorized(authorizer, operator)` grants delegated management authority; it
does not transfer or merge position ownership. The operator's account view must
never include an authorizer's positions merely because this flag is true. Morpho
Blue also has no built-in subaccount enumeration to bridge that ownership gap.

MetaMorpho/ERC-4626 vault shares are indirect exposure, not direct
`position(id, wallet)` storage. If the product claims to cover those holdings,
it needs a separately exhaustive and reviewed vault-to-market topology. A
direct-Blue-only reader must state that narrower approved scope explicitly.

### One immutable block context

Core and dependency code identities, market parameters and raw market state,
`feeRecipient`, every wallet position, and each IRM `borrowRateView` call must
share one finalized block hash using
`{ blockHash, requireCanonical: true }` wherever EIP-1898 applies. Market-history
evidence must terminate at that same selected canonical block. The existing
height/header/chain closeout then remains required. EIP-1898 prevents internal
block skew; it does not authenticate an RPC, prove finality, or prove event-log
completeness.

## Manifest and parsing constraints

The repository ships no market manifest and no production runtime hashes. The
caller must supply all of them and a separately configured matching SHA-256
manifest fingerprint. Only Ethereum-mainnet launch loan assets from registry v1
are accepted: USDC, USDT, and PYUSD. The token identity and its stablecoin label
must match the active registry entry exactly.

The market ID is recomputed as
`keccak256(abi.encode(loanToken, collateralToken, oracle, irm, lltv))`. Addresses,
bytes32 values, hex quantities, ABI words, and decimal strings must use their
canonical lowercase form. Financial/state values are decoded as bounded
integers; no floating-point arithmetic is used. The parser requires exact tuple
lengths, canonical address padding, `uint128` bounds for all six market-state
words, a positive creation `lastUpdate` no later than the source block, and
canonical ABI booleans.

The raw-state parser also rejects a fee above one WAD (100%), borrow assets
without borrow shares or the reverse, borrow assets above total supplied assets,
and positive supply assets with zero supply shares. It deliberately accepts a
created-but-empty market (all four asset/share totals are zero) because market
creation precedes use, and it accepts zero supply assets with outstanding supply
shares because a complete-loss state must not be misrepresented as a malformed
or nonexistent market. Neither case becomes eligible: the candidate exposes the
raw integers and remains non-persistable. Ratios are not calculated because the
raw values are unaccrued and zero-denominator/loss states need an explicit risk
policy.

Objects and arrays are traversed through property descriptors before parsing.
Accessors, symbol properties, custom prototypes, sparse arrays, cycles,
non-integer JSON numbers, unknown envelope fields, oversized structures, empty
or oversized contract code, and malformed ABI data all fail with one sanitized
error. Upstream payloads and errors are never logged by this boundary.

The caller also supplies a positive maximum finalized-block age of at most 3,600
seconds. A source block in the future, at the exclusive stale boundary, or older
is rejected. This ceiling is a parser safety bound, not a shipped production
freshness policy.

## Direct-deployment binding

The official Morpho repository exposes `Morpho` as the core contract with a
constructor, and the official address table links the Ethereum address to that
source. This boundary consequently accepts only `DIRECT_NON_PROXY`, requires the
manifest's Morpho and implementation addresses to be the same official address,
and requires both configured runtime hashes to be identical to the code observed
there. It does not infer an implementation slot or claim that a proxy exists.

This does not solve proxy/upgradability risk for a market's loan token,
collateral token, or oracle. Their address-level runtime hashes may describe
proxy shells. Any such implementation/admin/beacon identities need separate,
protocol-specific review before use.

## Immutable official source baseline

The dormant account-position rules above are derived from official Morpho Blue
tag `v1.0.0` at commit
[`55d2d99304fb3fb930c688462ae2ccabb1d533ad`](https://github.com/morpho-org/morpho-blue/tree/55d2d99304fb3fb930c688462ae2ccabb1d533ad).
The hashes below are SHA-256 over each exact Git blob payload, not a local
checkout whose line endings could differ. They make the reviewed semantic input
reproducible, but a source tag alone does **not** establish that the code at the
documented Ethereum address was built from these files.

| Official file                                                                                                                                                                            |  Bytes | Git-blob payload SHA-256                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| [`src/Morpho.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/Morpho.sol)                                                               | 22,065 | `7f66c064ad0bdc046382fa65f449bb5a0b9181d5d03b65e3c8438226d437b9ce` |
| [`src/interfaces/IMorpho.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/interfaces/IMorpho.sol)                                       | 19,695 | `24f96c2860c42cd5834c56cdb159c56435acaee0716d34d54ca18bd755edc97c` |
| [`src/interfaces/IIrm.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/interfaces/IIrm.sol)                                             |    899 | `3ba6e6164cd0ed25d2b1d8d3766667ef016712705fe30094a97fe3801d14e915` |
| [`src/libraries/ConstantsLib.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/libraries/ConstantsLib.sol)                               |    777 | `d450cc5f56d70f6460ed81c5e2e7a294f5b7644307a4c742754e0d41a8789567` |
| [`src/libraries/MathLib.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/libraries/MathLib.sol)                                         |  1,633 | `2c6728d1bc8f5db81f2a7946f226c3c4a8cffe4134c55450ca445b05727011bc` |
| [`src/libraries/SharesMathLib.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/libraries/SharesMathLib.sol)                             |  2,360 | `4580deb1b1a3f2ea0b60f2305708428975613d1e94d404d647bcc573a7b2a2f0` |
| [`src/libraries/MarketParamsLib.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/libraries/MarketParamsLib.sol)                         |    823 | `94af290e2a2094b8547b925449484d247bce87cce4fed8902ecf82dd2b49242e` |
| [`src/libraries/UtilsLib.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/libraries/UtilsLib.sol)                                       |  1,196 | `9d0c8a0855b2f9e9f92111cdf32bdbbd1ff97b7584f0f958b695f2c4cb0d1b34` |
| [`src/libraries/EventsLib.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/libraries/EventsLib.sol)                                     |  6,232 | `c267b23c5a3086ed00a712b841ef12b674be508ac8b8cf2e3f289ae09bd1677a` |
| [`src/libraries/periphery/MorphoBalancesLib.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/libraries/periphery/MorphoBalancesLib.sol) |  5,549 | `dc5015f71b5cb2bf52876ed2c2b47ba37f4d7ab5970c42aa5a719ffba4f9e4a8` |
| [`src/libraries/periphery/MorphoLib.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/libraries/periphery/MorphoLib.sol)                 |  2,894 | `76225c63b32442f382744b9726175af03b710872ce122d7eb193b38480bcc353` |
| [`src/libraries/periphery/MorphoStorageLib.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/libraries/periphery/MorphoStorageLib.sol)   |  4,481 | `7a693f85512dde527c9ada9e5cbacf3d4ff5ba58c9c29f104d946cbfc596df36` |

## Official primary sources

- [Morpho contract addresses](https://docs.morpho.org/developers/contracts/addresses/)
  lists the Ethereum Morpho Blue core and Adaptive Curve IRM addresses.
- [Morpho Blue concepts](https://docs.morpho.org/learn/concepts/blue/) defines a
  permissionlessly created market by immutable loan token, collateral token,
  oracle, IRM, and LLTV parameters.
- [Morpho get-data tutorial](https://docs.morpho.org/developers/borrow/tutorials/get-data/)
  shows the five-field ABI encoding and Keccak-256 market-ID derivation, and the
  market-parameter/state reads.
- [Official `IMorpho.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/interfaces/IMorpho.sol)
  defines `market`, `idToMarketParams`, and the raw-state interest-accrual
  warnings.
- [Official `Morpho.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/Morpho.sol)
  is the linked core implementation source and exposes the enabled IRM/LLTV
  mappings.
- [Official `MorphoBalancesLib.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/libraries/periphery/MorphoBalancesLib.sol)
  defines the view-only expected-balance projection and IRM call gate.
- [Official `SharesMathLib.sol`](https://github.com/morpho-org/morpho-blue/blob/55d2d99304fb3fb930c688462ae2ccabb1d533ad/src/libraries/SharesMathLib.sol)
  defines the virtual shares/assets and down/up conversion rules.
- [Morpho oracle concepts](https://docs.morpho.org/learn/concepts/oracle/) explains
  that oracle selection is market-specific and a permanent part of market risk;
  this boundary deliberately does not interpret the oracle.
- [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898) specifies block-hash state
  reads and `requireCanonical` for methods including `eth_getCode` and
  `eth_call`.
- [Ethereum JSON-RPC API](https://ethereum.org/developers/docs/apis/json-rpc/)
  documents the chain, block, code, and call methods used by the transcript.

## Residual production gates

Before Morpho can contribute to a complete account view, recommendation, or
financial action, at least the following remain required:

1. Product/security approval of whether the claim covers direct Blue markets
   only or also MetaMorpho/vault exposure, plus exact market/dependency risk and
   freshness policy. No approved manifest is present in this repository.
2. Reproducible deployed-source/build equivalence for the Morpho core and every
   selected market's IRM and other dependency; where any dependency is a proxy,
   this includes its implementation/admin/beacon identity and upgrade policy.
3. Authenticated deployment-block evidence and an exhaustive, independently
   checked, non-truncated `CreateMarket` history through the selected block.
4. Two genuinely independent approved read sources, demonstrated finalized-tag
   and EIP-1898 capability, durable finalized checkpoints/lineage, divergence
   quarantine, and recovery rules. Repeating a request against one RPC is not
   independence or authenticity.
5. A reviewed runtime reader that binds all code, raw state, fee-recipient,
   wallet-position, IRM, and discovery evidence to one finalized context and
   evaluates every in-scope market without silently dropping failures. The
   current semantics accept only offline caller-supplied values.
6. Oracle implementation/source/freshness/deviation review and collateral-risk,
   market-liquidity, bad-debt, concentration, legal, and operational policy.
7. Approved egress/retry/deadline/circuit-breaker transports and explicit runtime
   composition. This slice contains no endpoint, client construction, secret,
   environment variable, fetch, DI binding, or live read/write.
8. A reviewed conversion into an existing durable domain/read-model contract.
   The current candidate says `mayPersist: false` and has no writer.

Until those gates are closed, provider status and recommendation eligibility
must remain unchanged.
