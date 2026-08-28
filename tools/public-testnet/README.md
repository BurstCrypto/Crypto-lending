# Live public-testnet read-only smoke

This local operator tool proves that the four testnet identities already bound
by the application policy are reachable through credential-free public RPCs:

| Network          | Public endpoint                               | Exact identity probe |
| ---------------- | --------------------------------------------- | -------------------- |
| Ethereum Sepolia | `https://ethereum-sepolia-rpc.publicnode.com` | `0xaa36a7`           |
| Base Sepolia     | `https://sepolia.base.org`                    | `0x14a34`            |
| Arbitrum Sepolia | `https://sepolia-rollup.arbitrum.io/rpc`      | `0x66eee`            |
| Solana devnet    | `https://api.devnet.solana.com`               | full genesis hash    |

Run the offline configuration check first, then explicitly invoke the live
smoke test from a local development shell:

```powershell
npm run testnet:live:preflight
npm run testnet:live:smoke
npm run test:testnet:live
```

The live command makes exactly eight HTTPS JSON-RPC reads: one immutable
identity probe and one provider-reported finalized-head probe per network. It has no endpoint
override, API token, account, private key, seed, wallet address, faucet,
transaction, signing, deployment, subscription, retry, or broadcast path. It
refuses production mode and hosted CI. Public endpoints are rate-limited and
may be temporarily unavailable; rerun manually later instead of adding an
automatic retry loop.

## Scope boundary

Passing this smoke test establishes only live EVM/SVM RPC connectivity and
exact network identity at that moment. It does not wire public observations
into the application, authorize financial use, prove provider independence or
SLA, or satisfy the KAN-251/KAN-231 provider and production-egress gates.

The smoke command itself is not an end-to-end lending transaction and remains
strictly read-only. A separate, locally gated application flow can prepare and
verify one browser-wallet proof position as described below; passing this smoke
test does not enable or validate that flow.

## Separate local application proof

`npm run demo:local` enables a narrowly scoped application path only outside
production and hosted CI. It uses Solana Devnet and one fixed Save/Solend route
to prove a single native-SOL lending deposit. This application path is distinct
from the four-network read-only smoke above: the smoke remains exactly eight
reads and cannot enable, prepare, sign, or verify an application transaction.

The authenticated, exact-origin, CSRF-protected API reruns the selected
`BALANCED` allocation preview and binds a short-lived, single-use intent to the
account, Solana wallet, portfolio snapshot, and applied liquidity percentage.
It checks the fixed Devnet identity, lending program, market, reserve, vaults,
and position state at finalized commitment, then prepares one exact Solana
message for a 0.01 native Devnet SOL deposit. It accepts no arbitrary RPC,
program, account list, amount, instruction, or transaction message. It has no
wallet key, server signer, relay, airdrop, retry, or broadcast API.

Every message begins with a domain-separated memo containing only its opaque
intent ID, followed by the five fixed account-setup and lending instructions.
This makes two intents cryptographically distinct even if Devnet returns the
same recent blockhash. The browser validates all six instructions before the
wallet call, and the API verifies the Ed25519 signature against that exact
intent message before reserving the signature.

The connected Wallet Standard wallet presents one confirmation and is the sole
signer and broadcaster. There is no EVM testnet funding step, test token, token
approval, or second transaction. Browser-wallet signing and broadcasting are
separate browser egress and contact the wallet's configured Solana Devnet
provider. Consequently the Save/Solend program and account targets are visible
to the wallet, RPC provider, explorers, and public chain; a non-custodial
on-chain transaction cannot keep its provider secret from the signer.

After submission, the API retrieves the transaction through its fixed read-only
Devnet RPC boundary. It requires finalized evidence for the exact prepared
message, wallet signer, permitted programs and accounts, exact 0.01 SOL amount,
successful lending instruction, and resulting position increase. Pending or
confirmed-but-not-finalized evidence remains pending, the API never resubmits
it, and the intent is consumed only after every invariant succeeds. Intent
records live only in the API process and disappear on restart.

The browser synchronously writes a same-tab recovery journal immediately before
calling the wallet and records any returned signature before server polling. A
reload can resume read-only verification of that same signature and cannot
resend it. An unresolved result without a signature remains locked until the
server-issued evidence deadline; the journal clears only after verified
completion, an explicit pre-commit wallet rejection, or definite expiry.

Funding is manual and free: use the official Solana faucet
(`https://faucet.solana.com/`) for valueless Devnet SOL. Do not buy tokens or
gas, and never paste a private key or seed phrase into application
configuration. The API does not call the faucet or airdrop funds. The 0.01
Devnet SOL remains in the lending position after a successful proof because
this deliberately minimal flow has no withdrawal transaction. It has no real
financial value, but resetting or withdrawing it requires a separate manually
reviewed action.

Server egress remains limited to fixed read-only JSON-RPC calls with bounded
timeouts and response sizes, redirects disabled, and no automatic retry. The
feature is disabled in production and hosted CI.

Public endpoint references:

- https://docs.base.org/base-chain/quickstart/connecting-to-base
- https://docs.arbitrum.io/for-devs/dev-tools-and-resources/chain-info
- https://solana.com/docs/references/clusters
- https://faucet.solana.com/
- https://docs.save.finance/architecture/addresses/devnet
- https://docs.save.finance/developers/introduction
- https://ethereum.org/developers/docs/networks/
