# SparkLend Ethereum USDC finalized transcript boundary

Status: dormant, read-only, unregistered, and non-persistable. The code owns no endpoint, HTTP client, environment variable, credential, retry policy, writer, or dependency-injection registration.

## Exact scope and sources

This boundary admits only SparkLend's Ethereum-mainnet USDC supply reserve. Contract identities come from Spark's canonical address registry at commit [`ecea29bd2a1546bbbf4999e486b3c04f0e10b748`](https://github.com/sparkdotfi/spark-address-registry/tree/ecea29bd2a1546bbbf4999e486b3c04f0e10b748):

- PoolAddressesProvider `0x02c3ea4e34c0cbd694d2adfa2c690eecbc1793ee`
- Pool proxy `0xc13e21b648a5ee794902342038ff3adab66be987`
- PoolConfigurator proxy `0x542dba469bde58faee189ffb60c6b49ce60e0738`
- Pool implementation `0x5ae329203e00f76891094dcfedd5aca082a50e1b`
- ProtocolDataProvider `0xfc21d6d146e6086b8359705c8b28512a983db0cb`
- USDC spToken proxy `0x377c3bd93f2a2984e1e7be6a5c22c525ed4a4815`
- spToken implementation `0x6175ddec3b9b38c88157c10a01ed4a3fa8639cc6`
- Ethereum USDC `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`

The exact registry declarations are in [SparkLend.sol](https://github.com/sparkdotfi/spark-address-registry/blob/ecea29bd2a1546bbbf4999e486b3c04f0e10b748/src/SparkLend.sol) and [Ethereum.sol](https://github.com/sparkdotfi/spark-address-registry/blob/ecea29bd2a1546bbbf4999e486b3c04f0e10b748/src/Ethereum.sol). Spark's official [deployment repository](https://github.com/sparkdotfi/sparklend-deployments) describes bytecode verification as a required deployment-review step. The reserve tuple layouts and pause/configuration semantics derive from the upstream official [Aave V3 ProtocolDataProvider interface](https://github.com/aave/aave-v3-core/blob/master/contracts/interfaces/IPoolDataProvider.sol), which SparkLend uses as its lending-engine foundation.

The repository intentionally supplies no runtime-code hashes and grants no approval to these identities. A caller must supply SHA-256 hashes for the provider, Pool proxy and implementation, data provider, USDC, spToken proxy and implementation in an exact manifest, a canonical positive maximum block age of at most 3,600 seconds, plus the resulting manifest fingerprint through a separate trust path. The manifest also pins supported-asset registry mainnet v1 and fingerprint `5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d`; parsing fails unless the current in-repository registry still marks that exact Ethereum USDC address active with 6 decimals.

## Verification performed

The transcript selects an Ethereum `finalized` header. Every `eth_getCode` and `eth_call` is bound to the exact selected hash with [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898) `{blockHash, requireCanonical:true}`. It verifies chain ID before and after the read and then requires an exact number/hash/parent/state-root/timestamp header recheck. A block is stale at `block timestamp + maximumBlockAgeSeconds`; that boundary is exclusive, so equality fails closed. Successful candidates expose this instant as `staleAfter`.

The adapter verifies all eight runtime bytecodes and the following live relationships: provider→PoolConfigurator, provider→Pool, Pool→provider, data provider→provider, Pool proxy→implementation using the provider as immutable admin, spToken proxy→implementation using the PoolConfigurator as immutable admin, spToken→Pool, and spToken→USDC. It then checks USDC/spToken decimals, exact reserve configuration and pause words, reserve data, spToken total-supply agreement, and supply-cap capacity. Inactive, frozen, paused, at-cap, inconsistent, future-dated, malformed, or locally excessive observations fail closed.

All calculations use integers. `liquidityRateRay * 10,000 / 1e27` is exposed explicitly as annualized supply APR basis points; it is not relabeled as provider-reported APY. The output is always marked `SINGLE_UNTRUSTED_RPC`, `NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE`, no-recommendation, and no-financial-action.

## Production gates remaining

1. Independently approve and separately pin the exact manifest, all runtime-code hashes, and its fingerprint; repeat approval after any proxy upgrade.
2. Corroborate the finalized header, contract identities, reserve values, and proxy relationships through an operationally independent source. One RPC cannot prove authenticity or independent finality.
3. Perform live mainnet conformance against the pinned source revision, including EIP-1898 support and admin-context `implementation()` access for both proxies.
4. Approve a provider-native rate policy that represents Spark's liquidity-rate semantics without falsely claiming a provider-reported APY.
5. Supply external endpoint/TLS/authentication/retry/rate-limit/quorum/monitoring/incident-response ownership and explicit market risk approval.

No borrowing, rewards, wallet position, transaction construction, or other Spark reserve is represented.
