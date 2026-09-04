# Stablecoin price transcript adapters

Status: `IMPLEMENTED_DORMANT_CANDIDATES` / `SOURCE_AUTHENTICITY_AND_ACTIVATION_BLOCKED`

This slice adds strict, transport-injected transcript adapters for the three
launch stablecoins, USDC, USDT, and PYUSD. Each observation remains bound to
one exact KAN-61 Ethereum or Solana asset identity even though the USD oracle
source is shared by stablecoin. Base, Arbitrum, testnets, unknown assets,
changed registry bindings, and changed feed references fail closed.

The adapters produce the existing `StablecoinPriceObservation` shape used by
migration `0021`, including an exact source reference, positive monotonic
source cursor, source update ID, canonical timestamps, scale-8 rate, and the
source-specific confidence shape. Their wrapper deliberately omits the writer
command fields and always returns:

- `persistenceEligibility = BLOCKED_PENDING_INDEPENDENT_SOURCE_VERIFICATION`;
- `mayRecordAsVerifiedEvidence = false`; and
- an explicit source-proof limitation.

Neither adapter is registered in Nest, worker dependency injection, an outbox
consumer, or the `0021` writer. Neither contains a URL, hostname, API key,
fetch/client construction, retry policy, DNS/TLS policy, or egress setting.

## Chainlink on Ethereum

The repository intentionally contains no production Chainlink proxy,
aggregator, heartbeat, or lifecycle manifest. Construction requires all three
feed entries and a separately supplied matching manifest fingerprint. Every
entry binds the KAN-66 ENS-style source reference to exact lowercase proxy and
aggregator addresses, SHA-256 digests of both runtime bytecodes, response
decimals, and description. Supplying a structurally valid manifest is not
approval; the exact manifest still needs the KAN-252 evidence and approvals.

The injected transport receives one serial Ethereum mainnet transcript:

1. verify `eth_chainId = 0x1`;
2. acquire an `eth_getBlockByNumber(finalized, false)` header;
3. bind both `eth_getCode` calls and all four `eth_call` operations to that
   exact block hash with EIP-1898 `requireCanonical = true`;
4. verify the proxy runtime code and `aggregator()` result, aggregator runtime
   code, `decimals()`, `description()`, and `latestRoundData()`;
5. require positive `roundId` and answer, equal `answeredInRound`, complete and
   ordered timestamps, and an update no later than the captured block;
6. re-read the same block by hash, compare number/hash/parent/state root/time,
   and verify chain ID again before returning a candidate.

The source sequence and update ID are both the decimal Chainlink round ID. The
answer is normalized with integer-only round-half-even. No confidence interval
is invented. The adapter labels the result
`FINALIZED_ETHEREUM_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED`: strict RPC parsing
and block binding do not independently authenticate a caller-supplied
transport or establish provider independence.

Chainlink documents that callers should use the proxy interface, that
`decimals()` defines response precision, and that `latestRoundData()` returns
the round, answer, and timestamps in its
[Data Feeds API reference](https://docs.chain.link/data-feeds/api-reference).
It also tells integrators to assess feed quality and risk in
[Selecting Quality Data Feeds](https://docs.chain.link/data-feeds/selecting-data-feeds).
Ethereum documents chain ID, state calls, block tags, and block reads in its
[JSON-RPC API](https://ethereum.org/developers/docs/apis/json-rpc/), while
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898) defines hash-bound state
queries and `requireCanonical`.

## Pyth via Hermes

The Pyth adapter requests exactly one built-in KAN-66 feed ID with parsed data
and one lower-hex binary update. It requires exactly one matching parsed row,
the price and EMA fixed-point structures, positive publication time, bounded
nonpositive exponent, positive Pyth metadata slot, ordered previous/proof
times, and a current source price. Prices use integer-only round-half-even;
confidence uses integer-only ceiling when scale reduction is necessary so
precision loss cannot understate uncertainty.

`sourceSequence` is the decimal Hermes metadata slot. `sourceUpdateId` is
SHA-256 over the bytes decoded from the sole `binary.data[0]` lower-hex value;
it is not a hash of JSON or the hex characters. This creates a deterministic
`0021` update identity, but this adapter does **not** verify a Pyth/Wormhole
signature, prove that parsed JSON was derived from those bytes, prove the
metadata slot, or establish Solana finality. Its status is therefore
`PYTH_BINARY_UPDATE_SIGNATURE_UNVERIFIED`, and persistence remains blocked.

Pyth documents the Hermes binary and parsed response, including `price`,
`conf`, `expo`, `publish_time`, and metadata, in
[Fetch Price Updates](https://docs.pyth.network/price-feeds/core/fetch-price-updates).
Its [best practices](https://docs.pyth.network/price-feeds/core/best-practices)
explain fixed-point representation, confidence intervals, staleness, and
availability risks. Hermes is described as a service that listens to Pythnet
and Wormhole and serves updates in the
[Hermes overview](https://docs.pyth.network/price-feeds/core/how-pyth-works/hermes).

## Bounds and remaining activation gates

Both parsers accept only plain or null-prototype enumerable data properties;
symbols, accessors, custom prototypes, sparse arrays, unknown fields, cyclic
values, excessive nesting, oversized strings/arrays, malformed numeric forms,
zero/negative prices, future data, and data older than the existing 60-second
current-price policy are rejected with one sanitized error. Rate conversion
does not use JavaScript floating point.

Production activation still requires an approved exact Chainlink manifest,
Pyth binary signature and parsed-payload verification, approved authenticated
transports/endpoints and egress, durable sequence-semantics review, live
freshness/heartbeat/provider-independence evidence, deployed monitoring and
exercises, and all KAN-252/KAN-231/public-launch approvals. This implementation
performed no provider request, RPC read, credential operation, or mainnet
write.

In particular, Ethereum finalized-head lag plus a stablecoin feed's actual
heartbeat may mean a Chainlink result rarely or never passes the existing
60-second current-price gate. Only measured live evidence and an approved risk
decision can resolve that; this adapter does not weaken freshness or finality.
