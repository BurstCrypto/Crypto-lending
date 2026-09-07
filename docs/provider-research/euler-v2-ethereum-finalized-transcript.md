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

## Dormant account and EVC semantics packet

`euler-v2-account-position.semantics.ts` is an offline, content-hashed semantics capture. It is not a JSON-RPC source, is not registered in Nest, and cannot persist a position, establish completeness, recommend a vault, or authorize a transaction. Its semantic body has SHA-256 `b934a77b395439af669496617b63349d61d34ac86108cc3f2a76259e3c801c6f` under the domain `crypto-lending:euler-v2-account-position-semantics:v1`.

The capture was derived from the exact Git blob payloads at EVK commit `9e3c760e051f5d769f7c6edb9be30198a55117d4`. That commit pins the official EVC submodule to `084b32284ba643921f8d21bff3ddaf0c4e08d754`. SHA-256 is over the repository blob payload (LF bytes), not a checkout that may rewrite line endings:

| Immutable official source                                                                                                                                                           |  Bytes | SHA-256                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| [`GenericFactory.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/GenericFactory/GenericFactory.sol)                            |  8,348 | `fb2f048598dcec7053fae385c2a5deebc50a167d2d51cbdd48a9a9da0ba2f349` |
| [`IEVault.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/IEVault.sol)                                                  | 29,286 | `ea502ec1a275780537ca593e1e930a8d5feac0d5fd64e5c7de3793c77f640b67` |
| [`EVault.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/EVault.sol)                                                    | 13,572 | `dac010ff9fcec8f18b62cf230079916eb1d5a17c3815e76da49492e6c691832d` |
| [`Dispatch.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/Dispatch.sol)                                                |  8,481 | `22757d54986a71249607bbac0642e2dcf9303ac62200a95c417388ae401cc4eb` |
| [`DToken.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/DToken.sol)                                                    |  3,180 | `0ab1e50214d9bc35d070492720df0d9d23b35ed6a5613ac57241a70da37fd52c` |
| [`Token.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/modules/Token.sol)                                              |  3,828 | `8d509687f1c562e26a7abf9907220e736ec1704d8d5a6587dc08f9a06f152cb6` |
| [`Vault.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/modules/Vault.sol)                                              | 10,666 | `a42eb3070b0012f2e7562607c7d0924314ac090b811f6f2d5ed7e39bfae41728` |
| [`Borrowing.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/modules/Borrowing.sol)                                      |  6,016 | `bafcbdbf224eaf0c0c9aad14a1d4e99acc31881d06dfddfdf95a48aa536cf326` |
| [`BorrowUtils.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/BorrowUtils.sol)                                   |  8,517 | `60d38739c1722a8a596cc8d1928eca6a9b7e7ea2433d0e5f33152b5370a8568b` |
| [`Cache.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/Cache.sol)                                               |  6,486 | `1b22f19d27c470c2d9631b0a56c9e3668f3c17b445f86e291e0712e2c81b42b0` |
| [`Constants.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/Constants.sol)                                       |  2,873 | `624814ccf0c09fe04d3c937f4e4b28118c57786b52e2d1df1feadd15ab1caf00` |
| [`EVCClient.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/EVCClient.sol)                                       |  5,264 | `59d5f27f1b3a1403b7f1f6aef80ddc52ead1898ba4cfc702b2d754dfd0790846` |
| [`ConversionHelpers.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/lib/ConversionHelpers.sol)                   |    980 | `038a88d2bd192140b261cf080b9dbc63ec3ee591af5905d1f65f6b04a3f0aec1` |
| [`Types.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/types/Types.sol)                                         |  2,301 | `8167584586695cbd6197ffc957b94b459ad85b725f9eff73993c5dc6d3456cea` |
| [`Assets.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/types/Assets.sol)                                       |  3,096 | `78d86ff8682b400533abfaa465a041223109e60522f119ccb76a9d21b9955d76` |
| [`Shares.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/types/Shares.sol)                                       |  2,531 | `68ca6aef9922c1a22a6cf0bae4f28a6edf3d530de776063cf0071cb633798b78` |
| [`Owed.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/types/Owed.sol)                                           |  2,781 | `b5aec966c148f558aca616af7ac4463c4aeffae11f0891fa7779a6fcf2b5f8d4` |
| [`UserStorage.sol`](https://github.com/euler-xyz/euler-vault-kit/blob/9e3c760e051f5d769f7c6edb9be30198a55117d4/src/EVault/shared/types/UserStorage.sol)                             |  3,154 | `b87ac89f0dda13639e3f0762c647215f3ac9ac84a9b3edced47e854f3e67377b` |
| EVC [`EthereumVaultConnector.sol`](https://github.com/euler-xyz/ethereum-vault-connector/blob/084b32284ba643921f8d21bff3ddaf0c4e08d754/src/EthereumVaultConnector.sol)              | 54,419 | `636d4567dcf9b9d6ce1090ac187386d2b5c2723039c1cff0fc56c7d9651dd6f2` |
| EVC [`IEthereumVaultConnector.sol`](https://github.com/euler-xyz/ethereum-vault-connector/blob/084b32284ba643921f8d21bff3ddaf0c4e08d754/src/interfaces/IEthereumVaultConnector.sol) | 30,446 | `0ca652e50c648b62dc71e10c66f4afac04b63d4961770231f404866aed1d3dae` |

The pinned ABI has an important target-dependent distinction: `balanceOf(address)` at an EVault proxy returns `uint112` supply shares widened to ABI `uint256`; the same selector at the vault's dToken calls `EVault.debtOf(address)` and therefore returns current debt in underlying atomic units. A position reader must call the EVault for supply shares, then call `convertToAssets(shares)` on that same EVault. `convertToAssets` loads accrued vault state and floors

`shares * (cash + ceil(totalBorrowsExact / 2^31) + 1e6) / (totalShares + 1e6)`.

The public input is rejected above `uint112`, and the result is rejected above `uint112`. Under the pinned type bounds the unchecked conversion-total additions and multiplication cannot overflow `uint256`; the explicit result cast can still reject an extreme exchange rate. The focused spec includes zero, one-internal-unit, fractional, `uint112` boundary, multiplication-overflow, cast-overflow, and noncanonical-input vectors.

Both `debtOf(address)` and `debtOfExact(address)` are current getters: each loads the vault cache, accrues the interest accumulator to the selected block timestamp, and computes `floor(storedOwedExact * currentAccumulator / accountAccumulator)`. The multiplication is Solidity-checked, a nonzero debt with a zero account accumulator reverts, and the result must remain at or below `MAX_SANE_DEBT`. `debtOfExact` returns the 31-fraction-bit internal value. `debtOf` is the conservative/current asset-unit getter because it additionally ceilings that exact value by `2^31`. A same-block reader must require `debtOf == ceil(debtOfExact / 2^31)`; it must not treat the exact value as token atomic units. The dToken `balanceOf` is only an alias of `debtOf` and is unnecessary for the canonical direct-EVault read.

`balanceOf`, `convertToAssets`, and `debtOf` execute embedded code in the pinned EVault implementation. `debtOfExact` view-delegates through `MODULE_BORROWING`, while `EVC()` view-delegates through `MODULE_GOVERNANCE`. A production observation therefore needs the factory, vault proxy, implementation, borrowing module, governance module, EVC, and underlying asset identities, with exact runtime-code fingerprints and relations at the same block. No address by itself is code evidence.

For a connected wallet to own an EVC family, `getAccountOwner(wallet)` must equal that same wallet at the bound block. A zero owner is only “not registered”; it is not evidence that 256 addresses belong to the wallet, so complete-family attribution fails closed. Once registered, the exhaustive family is exactly 256 addresses, `wallet XOR accountId` for IDs 0 through 255. Every account must be checked against every in-scope vault. Operator bitfields describe delegated action authority for a known owner prefix. They do not transfer asset ownership, and EVC has no reverse operator index from operator to every owner prefix; positions must never be attributed to a wallet merely because it is an operator.

Complete vault discovery also remains mandatory. At one EIP-1898 block hash, a reader must capture `getProxyListLength()`, cover `[0,length)` with gapless `getProxyListSlice(start,end)` calls, and inspect every returned proxy without silently skipping unsupported implementations. The current one-vault manifest boundary cannot establish this. An approved immutable inventory must also establish that the pinned factory is the complete in-scope Euler V2 factory universe.

All factory enumeration, code, proxy configuration, implementation/module/EVC/asset relations, owner checks, and every account getter must use the identical `{ blockHash, requireCanonical: true }` parameter. The existing height/header and chain-ID closeout checks remain required. This same-context rule prevents internal snapshot skew but still does not authenticate an RPC or prove independent finality.

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
