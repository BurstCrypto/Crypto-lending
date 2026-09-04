# Euler V2 Ethereum finalized transcript boundary

Status: dormant, read-only, unregistered, and non-persistable. This note does not approve an Euler vault, an RPC service, a recommendation, or a financial action.

## Implemented boundary

`EulerV2EthereumFinalizedTranscriptAdapter` accepts exactly one caller-supplied Ethereum-mainnet EVault manifest plus a separately supplied SHA-256 fingerprint of that complete manifest. It owns no endpoint, client, environment variable, credentials, retry policy, egress policy, Nest binding, database writer, or transaction path.

The manifest is restricted to one active launch-registry asset (`USDC`, `USDT`, or `PYUSD`) with 6 decimals. No vault is shipped or selected by this repository. A manifest must bind an exact vault, asset, oracle, interest-rate model, probe account, finite positive supply and borrow caps, configuration flags, and the Keccak-256 runtime-code fingerprint for every configured contract identity.

The boundary admits only a deliberately narrow EVault shape:

- Ethereum mainnet (`chainId = 1`) and the `finalized` block selector;
- an immutable, non-upgradeable MetaProxy recognized by the pinned Euler factory;
- the pinned implementation recorded by the factory and by `getProxyConfig(vault)`;
- proxy trailing data equal to the exact asset, oracle, and unit-of-account addresses;
- unit of account equal to the 6-decimal underlying asset;
- governor set to the zero address (a finalized vault);
- hook target and hooked-operation bitmap both zero;
- exact caller-bound config flags and finite positive supply/borrow caps;
- a nonempty vault below both observed caps, with internally consistent cash, borrows, assets, and shares; and
- exact integer conversion and `maxDeposit` results derived from the pinned EVK implementation semantics.

All manifest and JSON-RPC response objects are descriptor-traversed, bounded plain data. Accessors, symbols, custom prototypes, cycles, extra RPC envelope fields, malformed ABI, uppercase/noncanonical identities, unbounded strings/arrays/numerics, zero code, and code-hash drift fail closed with one sanitized error.

## Official source pins

The source/deployment inputs are pinned rather than read from a moving branch:

- Euler's official [`EulerChains.json` at `d0e9a428…`](https://github.com/euler-xyz/euler-interfaces/blob/d0e9a428523b3de6cb3e6c7a06ad55b6e59223f3/EulerChains.json), locally captured with SHA-256 `20ca447e2f1236210c63e71b616de7a7ef0b33f26c327c89b70ff1d08547b288`;
- Euler's official [Ethereum deployed-code verification report at the same commit](https://github.com/euler-xyz/euler-interfaces/blob/d0e9a428523b3de6cb3e6c7a06ad55b6e59223f3/verify/1.md); and
- Euler Vault Kit commit [`9e3c760e051f…`](https://github.com/euler-xyz/euler-vault-kit/tree/9e3c760e051f5d769f7c6edb9be30198a55117d4), which that verification report associates with the factory, implementation, protocol config, sequence registry, and EVault modules.

The pinned Ethereum identities are:

| Role                  | Address                                      |
| --------------------- | -------------------------------------------- |
| EVault factory        | `0x29a56a1b8214d9cf7c5561811750d5cbdb45cc8e` |
| EVault implementation | `0x8ff1c814719096b61abf00bb46ead0c9a529dd7d` |
| EVC                   | `0x0c9a3dd6b8f28529d72d7f9ce918d493519ee383` |
| Protocol config       | `0x4cd6bf1d183264c02be7748cb5cd3a47d013351b` |
| Sequence registry     | `0xeaddd21618ad5deb412d3fd23580fd461c106b54` |
| Balance tracker       | `0x0d52d06ceb8dcdeeb40cfd9f17489b350dd7f8a3` |
| Permit2               | `0x000000000022d473030f116ddee9f6b43ac78ba3` |
| Token module          | `0x8a58aecbe677682d0f037c67f37f5a7a2e94973c` |
| Vault module          | `0xb4ad4d9c02c01b01cf586c16f01c58c73c7f0188` |
| Borrowing module      | `0x639156f8feb0cd88205e4861a0224ec169605acf` |
| Governance module     | `0xa61f5016f2cd5cec12d091f871fce1e1df5f0b67` |

Addresses alone are not code evidence. Every address above still requires a caller-approved exact runtime-code Keccak-256 fingerprint in the manifest and an exact match at the selected block.

## Protocol semantics used

The adapter's ABI and invariants come from pinned official source:

- [`GenericFactory.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/GenericFactory/GenericFactory.sol) defines immutable MetaProxy creation, factory proxy registration, `implementation()`, `isProxy(address)`, and `getProxyConfig(address)`.
- [`IEVault.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/IEVault.sol) defines the exact getters and return types used by the transcript.
- [`Vault.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/modules/Vault.sol) defines `totalAssets`, conversion/preview behavior, disabled deposit handling, and the finite-cap/cash/share limits used by `maxDeposit`.
- [`Borrowing.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/modules/Borrowing.sol) defines the accrued `totalBorrows()` and internally tracked `cash()` reads.
- [`Governance.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/modules/Governance.sol) defines governor, IRM, hook, config-flag, cap, integration, oracle, and unit-of-account getters.
- [`Base.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/Base.sol) defines an operation as disabled when its hook bit is set and the hook target is zero.
- [`Cache.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/Cache.sol) defines total assets as internally tracked cash plus accrued total borrows and notes that the sum can exceed the single `uint112` asset bound.
- [`ConversionHelpers.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/lib/ConversionHelpers.sol) defines the `1e6` virtual deposit used in integer share/asset conversions.
- [`AmountCap.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/types/AmountCap.sol) defines the 16-bit cap format: six exponent bits, ten mantissa bits scaled by 100, raw zero as unlimited, and nonzero exponent with zero mantissa as a zero cap.
- [`Constants.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/Constants.sol) defines `uint112` sane amount bounds, operation bits, and the valid config-flag range.
- Euler's pinned [EVK whitepaper](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/docs/whitepaper.md) explains internal cash accounting, accrued borrows, the virtual-deposit exchange-rate model, cap behavior, hooks, and overflow limitations.

The adapter never uses floating point for financial quantities. Cap decoding, accounting checks, conversion checks, and the `maxDeposit` reconstruction use `bigint` integer arithmetic with the pinned rounding-down order.

## Finalized transcript binding

The request order is fixed:

1. Require `eth_chainId = 0x1`.
2. Read `eth_getBlockByNumber("finalized", false)` and strictly parse number, hash, parent hash, state root, and timestamp.
3. Use `{ blockHash, requireCanonical: true }` for every `eth_getCode` and `eth_call`, following [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898).
4. Verify every configured runtime-code fingerprint, factory/proxy relationship, identity getter, configuration value, cap, accounting value, and conversion result at that same block hash.
5. Re-read the selected height with `eth_getBlockByNumber(blockNumber, false)` and require exact number/hash/parent/state-root/timestamp equality. Reading by hash would not prove that the height remained canonical.
6. Recheck `eth_chainId`, then enforce the caller-supplied bounded freshness interval.

The standard Ethereum JSON-RPC method shapes are documented in the official [Ethereum JSON-RPC API reference](https://ethereum.org/developers/docs/apis/json-rpc/). Method shape and EIP-1898 binding do not authenticate an RPC server.

## Output limitations

The candidate says, explicitly:

- `sourceAuthenticity = UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT`;
- `yieldEvidenceStatus = ABSENT_NOT_COMPUTED`;
- `liquidityEvidenceStatus = NOT_ESTABLISHED_BY_CASH_CAP_OR_MAX_DEPOSIT`;
- `mayPersist = false`;
- `mayEstablishRecommendationEligibility = false`; and
- `mayAuthorizeFinancialAction = false`.

No interest-rate read is exposed. In particular, the adapter does not turn an instantaneous or per-second rate into APR, does not relabel APR as APY, and does not invent a yield when the IRM or its dependencies are not independently evidenced. `cash`, a configured cap, and account-scoped `maxDeposit` are raw observations; none proves executable liquidity, wallet balance, allowance, transaction success, slippage, future capacity, or solvency.

## Residual production gates

This slice closes only deterministic parsing and same-block binding. Production remains blocked until all of the following are separately completed and approved:

1. Select exactly one launch vault and approve its complete manifest and independent fingerprint. No vault address or runtime hash is supplied here.
2. Capture and independently reproduce exact runtime code at the approved finalized block. The verification report's abbreviated build fingerprints are not substituted for on-chain runtime Keccak-256 hashes.
3. Add proxy-aware implementation/admin/storage-slot evidence for the stablecoin, oracle, IRM, and any nested dependencies. A proxy shell code hash alone does not bind its implementation or upgrade authority.
4. Enumerate and assess all collateral/LTV/oracle routes, remaining EVault modules, IRM parameters, liquidation behavior, bad-debt behavior, token behavior, caps, and governance dependencies. A finalized EVault does not make external oracle/IRM/token contracts immutable or safe.
5. Add an approved primary RPC and genuinely independent corroborating source, authenticated transport/egress controls, divergence policy, outage handling, observability, and incident response. Two reads from one RPC are neither independent nor cryptographic proof of Ethereum consensus/finality.
6. Validate the chosen clients' EIP-1898 support and rejection behavior in a controlled live test. This adapter performs no live read.
7. Define reviewed yield evidence and liquidity/capacity evidence if the product needs those fields. They are intentionally absent here.
8. Complete provider risk, security, legal/regulatory, finance, operations, and release approvals.
9. Build a separate, explicitly authorized transaction boundary with simulation, wallet/asset/action allowlists, user intent, fee/slippage limits, nonce/replay controls, and reconciliation. This read adapter can never authorize a write.

The adapter is not exported through a shared barrel and is not registered in Nest. Its presence therefore cannot activate Euler, write a database row, recommend a vault, or submit a transaction.
