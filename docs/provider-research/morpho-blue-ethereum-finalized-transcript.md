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

## Official primary sources

- [Morpho contract addresses](https://docs.morpho.org/developers/contracts/addresses/)
  lists the Ethereum Morpho Blue core and Adaptive Curve IRM addresses.
- [Morpho Blue concepts](https://docs.morpho.org/learn/concepts/blue/) defines a
  permissionlessly created market by immutable loan token, collateral token,
  oracle, IRM, and LLTV parameters.
- [Morpho get-data tutorial](https://docs.morpho.org/developers/borrow/tutorials/get-data/)
  shows the five-field ABI encoding and Keccak-256 market-ID derivation, and the
  market-parameter/state reads.
- [Official `IMorpho.sol`](https://github.com/morpho-org/morpho-blue/blob/main/src/interfaces/IMorpho.sol)
  defines `market`, `idToMarketParams`, and the raw-state interest-accrual
  warnings.
- [Official `Morpho.sol`](https://github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol)
  is the linked core implementation source and exposes the enabled IRM/LLTV
  mappings.
- [Morpho oracle concepts](https://docs.morpho.org/learn/concepts/oracle/) explains
  that oracle selection is market-specific and a permanent part of market risk;
  this boundary deliberately does not interpret the oracle.
- [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898) specifies block-hash state
  reads and `requireCanonical` for methods including `eth_getCode` and
  `eth_call`.
- [Ethereum JSON-RPC API](https://ethereum.org/developers/docs/apis/json-rpc/)
  documents the chain, block, code, and call methods used by the transcript.

## Residual production gates

Before Morpho can contribute to a recommendation or financial action, at least
the following remain required:

1. Product/security approval of exact market IDs, market parameters, Morpho code
   hash, dependency code hashes, and the manifest freshness bound. No such
   manifest is present in this repository.
2. Pinned review evidence for the exact deployed source/build and, where any
   dependency is a proxy, its implementation/admin/beacon and upgrade policy.
3. Two genuinely independent approved read sources, demonstrated finalized-tag
   and EIP-1898 capability, durable finalized checkpoints/lineage, divergence
   quarantine, and recovery rules. Repeating a request against one RPC is not
   independence or authenticity.
4. Correct Morpho interest accrual and IRM calculations (or an independently
   verified provider-native observation) before APY, accrued balances,
   utilization, or liquidity can be represented.
5. Oracle implementation/source/freshness/deviation review and collateral-risk,
   market-liquidity, bad-debt, concentration, legal, and operational policy.
6. Approved egress/retry/deadline/circuit-breaker transports and explicit runtime
   composition. This slice contains no endpoint, client construction, secret,
   environment variable, fetch, DI binding, or live read/write.
7. A reviewed conversion into an existing durable domain/read-model contract.
   The current candidate says `mayPersist: false` and has no writer.

Until those gates are closed, provider status and recommendation eligibility
must remain unchanged.
