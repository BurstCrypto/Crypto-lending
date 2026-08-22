# KAN-61: Supported chain and stablecoin registry

KAN-61 is the first local IDX-001 implementation boundary. It provides an
immutable, environment-qualified and versioned registry for Ethereum, Base,
Arbitrum, and Solana. It does not query an RPC, inspect a wallet, submit a
transaction, deploy infrastructure, or use a paid provider.

## Registry contract

The registry uses canonical CAIP-2 network identifiers and never identifies an
asset from its name or ticker. A lookup requires the exact network identifier
and contract or mint identity. EVM contract identities are normalized to
lowercase bytes; Solana mint identities remain case-sensitive base58 public
keys.

Each immutable snapshot has a positive contiguous version and a canonical
SHA-256 fingerprint over its complete network, asset, issuer, precision,
activation, and provenance descriptors. A later change must append a complete
version rather than edit or reinterpret a prior version. Version 1 asset
manifests pin their financial and provenance descriptors independently from the
reviewed-candidate catalog, while the committed golden fingerprints bind each
complete snapshot. A later catalog metadata change therefore cannot silently
rewrite historical meaning.

Current-ingress normalization is deliberately available only on the versioned
registry and always uses its latest snapshot. Historical reads require an exact
persisted version and use identification-only semantics; a caller-selected old
version cannot reactivate a retired asset for a new observation or route. The
snapshot records network and asset activation independently.

The committed version-1 fingerprints are:

- Mainnet: `5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d`
- Testnet: `89c158de188fcde7d01642aadef226f3c93724bfe5b53a7f3fcce096180d5ca7`

Construction fails closed for:

- a missing or duplicate target network;
- a network ID that does not match its chain and environment;
- a malformed, zero, unverified, wrong-network, or mislabeled contract/mint;
- decimals that do not match the reviewed issuer definition;
- duplicate network-qualified identities or canonical assets;
- invalid activation states, including an active asset on an inactive network;
- mixed-environment, duplicate, skipped, or out-of-order snapshot versions.

## Version 1 configuration

All configured assets use six decimals and are initially `ACTIVE`.
`ACTIVE` means the identity is approved for registry normalization; it does not
authorize a transfer, route, yield product, jurisdiction, or provider.

| Environment | Chain/network                             | Asset | Exact configured identity                      |
| ----------- | ----------------------------------------- | ----- | ---------------------------------------------- |
| Mainnet     | `eip155:1`                                | USDC  | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`   |
| Mainnet     | `eip155:8453`                             | USDC  | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`   |
| Mainnet     | `eip155:42161`                            | USDC  | `0xaf88d065e77c8cc2239327c5edb3a432268e5831`   |
| Mainnet     | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | USDC  | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Mainnet     | `eip155:1`                                | USDT  | `0xdac17f958d2ee523a2206206994597c13d831ec7`   |
| Mainnet     | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | USDT  | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| Mainnet     | `eip155:1`                                | PYUSD | `0x6c3ea9036406852006290770bedfcaba0e23a0e8`   |
| Mainnet     | `eip155:42161`                            | PYUSD | `0x46850ad61c2b7d64d08c9c754f45254596696984`   |
| Mainnet     | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | PYUSD | `2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo` |
| Testnet     | `eip155:11155111`                         | USDC  | `0x1c7d4b196cb0c7b01d743fbc6116a902379c7238`   |
| Testnet     | `eip155:84532`                            | USDC  | `0x036cbd53842c5426634e7929541ec2318f3dcf7e`   |
| Testnet     | `eip155:421614`                           | USDC  | `0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d`   |
| Testnet     | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | USDC  | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Testnet     | `eip155:11155111`                         | PYUSD | `0xcac524bca292aaade2df8a05cc58f0a65b1b3bb9`   |
| Testnet     | `eip155:421614`                           | PYUSD | `0x637a1259c6afd7e3adf63993ca7e58bb438ab1b1`   |
| Testnet     | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | PYUSD | `CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM` |

Version 1 deliberately has no Base PYUSD, Base or Arbitrum USDT, or testnet
USDT entry. A same-symbol bridge alias or third-party token list is not enough
to add one. Until an exact identity is reviewed and added to the issuer-backed
allowlist in a new registry version, lookup returns no normalized asset.

## Verification sources

The version 1 identities were rechecked against primary sources on 2026-08-22:

- [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
  for all mainnet and testnet USDC contracts and mints;
- [Tether supported protocols](https://tether.to/en/supported-protocols/) for
  Ethereum and Solana USDT;
- [Paxos PYUSD mainnet addresses](https://docs.paxos.com/guides/stablecoin/pyusd/mainnet)
  and [testnet addresses](https://docs.paxos.com/guides/stablecoin/pyusd/testnet);
  and
- the [CAIP-2 Solana namespace](https://namespaces.chainagnostic.org/solana/caip2)
  for the mainnet-beta and devnet references.

Source URLs are retained on each normalized registry entry. They are review
provenance, not runtime oracles; application execution never fetches them.

## Integration boundary

`BlockchainModule` exposes one `SupportedAssetNormalizationService` to the API.
`normalizeIngressAsset` accepts an environment-qualified network identity but
no registry version, and returns only the latest active registry match. Its
result retains the selected registry version and snapshot fingerprint.
`identifyHistoricalAsset` requires an exact recorded version, returns
historical metadata without making a current-support decision, and separately
reports whether the same identity remains supported by the latest snapshot.

This slice intentionally does not add a PostgreSQL migration. FND-002 provides
the migration and transaction foundation, but the existing `ledger_assets`
table is an accounting identity store and has no registry activation or source
contract. A later reviewed adapter must decide how registry versions map to
durable indexing observations and ledger asset revisions. Every downstream
holding, quote, route, and journal reference must retain the selected registry
version; callers must not silently reinterpret historical data through the
latest snapshot.

Likewise, selecting `MAINNET` or `TESTNET` is an explicit caller decision. No
default infers a value-bearing network from `NODE_ENV`, `APP_ENV`, a wallet
symbol, or a provider response.

The registry proves that a supplied network ID and identity form an approved
pair; it cannot prove which chain produced an observation. IDX-002/IDX-003 and
IDX-004 must derive the network from immutable connector configuration and
verify EVM `eth_chainId` or the Solana genesis hash at connector startup. A
request, wallet ticker, token metadata response, or arbitrary provider payload
must never be allowed to label its own trusted network.

## Local verification

```powershell
npm test --workspace @crypto-lending/api -- --runInBand src/blockchain/domain/supported-asset-registry.spec.ts
npm test --workspace @crypto-lending/api -- --runInBand src/blockchain/application/supported-asset-normalization.service.spec.ts
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm run format:check
git diff --check
```
