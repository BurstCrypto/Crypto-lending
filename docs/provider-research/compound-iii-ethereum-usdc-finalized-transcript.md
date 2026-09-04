# Compound III Ethereum USDC finalized transcript boundary

Status: dormant, unregistered, and non-persistable. This boundary performs no network I/O by itself. A caller must inject both a transcript transport and a clock; no endpoint, client, credential, retry policy, environment variable, writer, or dependency-injection registration ships here.

## Exact researched scope

The only market admitted is Compound III's Ethereum-mainnet USDC market:

- Network: `eip155:1` / JSON-RPC chain ID `0x1`.
- Comet proxy: `0xc3d688b66703497daa19211eedff47f25384cdc3`.
- Base asset: USDC `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`, 6 decimals, scale `1000000`.
- Compound source revision: `f766f51583c23acc33b2a7824654ef2029a96804`.

Primary evidence: Compound's pinned [mainnet USDC deployment root](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/deployments/mainnet/usdc/roots.json), [market configuration](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/deployments/mainnet/usdc/configuration.json), [Comet interface](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/contracts/CometMainInterface.sol), and [rate constants](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/contracts/CometCore.sol).

The repository does not claim an approved proxy admin, implementation address, or any runtime bytecode hash. Those values must arrive in an exact caller-owned manifest, together with a canonical positive maximum block age no greater than 3,600 seconds, and its SHA-256 fingerprint must arrive through a separately pinned trust path. The manifest also pins supported-asset registry mainnet v1 and fingerprint `5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d`; parsing fails unless the current in-repository registry still marks that exact Ethereum USDC address active with 6 decimals. The adapter checks the proxy's admin-context `implementation()` result and the SHA-256 of all three runtime bytecodes at the selected block.

## Transcript contract

The adapter requires `finalized`, selects one header, and binds every `eth_getCode` and `eth_call` to `{ blockHash, requireCanonical: true }` under [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898). It checks chain ID before and after the bundle, then re-reads the selected height and requires exact number, hash, parent hash, state root, and timestamp equality. Future blocks fail closed. A block becomes stale at `block timestamp + maximumBlockAgeSeconds`; equality is rejected, and successful candidates expose that exclusive instant as `staleAfter`. Responses must be bounded, accessor-free plain data with exact JSON-RPC envelopes and exact ABI words.

It validates proxy, implementation and USDC code identities; proxy implementation; `baseToken()`; `baseScale()`; Comet and token `decimals()`; `totalSupply()`; `getUtilization()`; `getSupplyRate(utilization)`; and `isSupplyPaused()`. All numeric work is `bigint`. Annualized supply APR basis points are floored as:

`ratePerSecond * 31,536,000 * 10,000 / 1e18`

This follows Compound's official [interest-rate documentation](https://docs.compound.finance/interest-rates/). Compound exposes a per-second supply rate and documents APR conversion; it does not supply the provider-reported APY required by the current provider-native market persistence port. Therefore the result is explicitly `NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE`, never APY, and cannot establish recommendations or authorize financial actions.

## Gates remaining before production use

1. An independent approval process must pin the proxy admin, current implementation, three runtime code hashes, and the resulting manifest fingerprint. Proxy upgrades require a newly approved manifest.
2. At least one independent source must corroborate chain identity, finalized block identity, contract identities, and market values. A single RPC's internally consistent response is not authenticity or independent finality proof.
3. Product/risk owners must approve the USDC market and explicit APR-to-APY policy. Until the provider-native boundary can represent Compound's semantics without relabeling, persistence remains blocked.
4. Production endpoint, authentication, TLS, retry, rate-limit, quorum, monitoring, and incident-response ownership must be implemented outside this dormant parser.
5. Live fork/conformance tests must verify the approved manifest against mainnet and prove the chosen RPC supports EIP-1898 canonical block-hash state reads, including the proxy-admin accessor call.

No other Compound market, chain, collateral asset, reward rate, borrow rate, or wallet position is represented by this boundary.
