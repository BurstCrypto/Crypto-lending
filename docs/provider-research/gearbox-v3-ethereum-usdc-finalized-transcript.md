# Gearbox V3 Ethereum USDC finalized transcript boundary

Status: dormant, read-only, unregistered, single-source, and non-persistable. The implementation owns no endpoint, network client, environment variable, credential, retry policy, writer, or dependency-injection registration.

## Exact scope and official evidence

The only admitted market is the direct-deployed Gearbox V3.0 Ethereum USDC pool `0xda00000035fef4082f78def6a8903bee419fbf8e`, with AddressProviderV3 `0x9ea7b04da02a5373317d745c1571c84aad03321d`, ContractsRegister `0xa50d4e7d8946a7c90652339cdbd262c375d54d99`, and USDC `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`.

The deployment identities and V3 source revision are pinned to Gearbox's official [Ethereum V3 security scope at commit `684522eae18dea73a8aecda25d8743bfa724446a`](https://github.com/Gearbox-protocol/security/blob/684522eae18dea73a8aecda25d8743bfa724446a/bug-bounty/v3-scope.md). Contract behavior is pinned to Gearbox core-v3 commit [`e16559ae82f0f24c3dc29693c444f40d676ebff9`](https://github.com/Gearbox-protocol/core-v3/tree/e16559ae82f0f24c3dc29693c444f40d676ebff9), specifically [PoolV3](https://github.com/Gearbox-protocol/core-v3/blob/e16559ae82f0f24c3dc29693c444f40d676ebff9/contracts/pool/PoolV3.sol), [IPoolV3](https://github.com/Gearbox-protocol/core-v3/blob/e16559ae82f0f24c3dc29693c444f40d676ebff9/contracts/interfaces/IPoolV3.sol), and [IAddressProviderV3](https://github.com/Gearbox-protocol/core-v3/blob/e16559ae82f0f24c3dc29693c444f40d676ebff9/contracts/interfaces/IAddressProviderV3.sol). Gearbox's current [pool documentation](https://docs.gearbox.finance/developers/pools) explains the pool/underlying role; it does not replace the pinned identity evidence.

This V3.0 PoolV3 is a direct deployment with immutable `addressProvider` and `underlyingToken`, not a proxy. The manifest therefore declares `DIRECT_IMMUTABLE_POOL_V3_00`; no implementation or proxy-admin address is invented. A caller must independently approve and supply SHA-256 runtime-code hashes for all four contracts and separately pin the resulting exact manifest fingerprint. The manifest additionally pins supported-asset registry mainnet v1/fingerprint `5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d`, and parsing fails if the current in-repository registry no longer marks that exact Ethereum USDC identity active with 6 decimals.

## Transcript guarantees and intentionally raw output

The reader selects an Ethereum `finalized` header and binds every `eth_getCode` and `eth_call` to [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898) `{blockHash, requireCanonical:true}`. It rechecks chain ID plus the exact height/hash/parent/state-root/timestamp after all state reads. A caller-bound positive maximum block age is capped at 3,600 seconds; future blocks and the exclusive stale boundary fail closed.

At that one source point it verifies runtime code, AddressProvider-to-ContractsRegister resolution, `isPool(pool)`, the Pool's immutable AddressProvider and underlying token, ERC-4626 `asset()`, V3 version `300`, and pool/token decimals `6`. It exposes only the official interface's raw `availableLiquidity`, `expectedLiquidity`, ERC-20 share `totalSupply`, `supplyRate` ray, `paused`, and `totalDebtLimit` values. `totalDebtLimit` is a borrowing/debt cap, not a deposit cap. The adapter does not label the raw rate APR or APY, infer deposit availability, or treat an unpaused observation as an authorization.

All JSON and ABI values are bounded, accessor-free, exact-shape plain data. Amounts remain integers. Output is always `SINGLE_UNTRUSTED_RPC`, `NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE`, no-recommendation, and no-financial-action.

## Remaining live production gates

1. Independently collect and approve the four exact finalized-block runtime hashes and manifest fingerprint; repeat after any deployment or registry change.
2. Confirm through a second operationally independent source that the pool remains an active, supported launch market. One RPC cannot establish authenticity or independent finality.
3. Run live conformance for finalized-header and EIP-1898 support, AddressProvider resolution, ContractsRegister membership, and every ABI selector.
4. Establish product/risk approval for this exact market and a reviewed interpretation of Gearbox's raw supply-rate semantics. No APR/APY normalization is approved here.
5. Add external endpoint, TLS/authentication, retry/rate-limit, quorum, monitoring, and incident-response ownership before any runtime registration.

No wallet position, borrowing, rewards, transaction construction, other Gearbox pool/version, or persistence path is represented.
