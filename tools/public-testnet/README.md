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
The browser refreshes that intent on the final Submit click so time spent reading
the disclosure does not age the transaction before Phantom opens.
It checks the fixed Devnet identity, lending program, market, reserve, vaults,
and position state at finalized commitment, then prepares one exact
six-instruction Solana core for a 0.01 native Devnet SOL deposit. It accepts no
arbitrary RPC, program, account list, amount, instruction, or transaction
message. It has no wallet key, server signer, arbitrary relay, airdrop, or retry
API. Its submission route permits only the intent-bound, one-shot fixed Devnet
broadcast described below.

Every message begins with a domain-separated memo containing only its opaque
intent ID, followed by the five fixed account-setup and lending instructions.
This makes two intents cryptographically distinct even if Devnet returns the
same recent blockhash. The browser validates all six instructions before the
wallet call. Phantom may prepend only `SetComputeUnitPrice` followed by
`SetComputeUnitLimit`; the verifier requires exactly 200,000 compute units, at
most 500,000 micro-lamports per unit, and at most 100,000 lamports (0.0001 SOL)
of priority fee. It rejects every other addition or reordering and every change
to the six reviewed instructions. The user must inspect Phantom's total fee
before approving.

The connected Wallet Standard wallet presents one confirmation and is the sole
signer. There is no EVM testnet funding step, test token, token approval, or
second transaction. The browser submits the signed legacy bytes through the
authenticated same-origin API. The server revalidates the fee payer, sole
Ed25519 signature, exact reviewed message or bounded compute-budget prefix, and
1,232-byte wire limit before it binds the signature and bytes and makes one
fixed Devnet `sendTransaction` request. Consequently the Save/Solend program and
account targets are visible
to the wallet, RPC provider, explorers, and public chain; a non-custodial
on-chain transaction cannot keep its provider secret from the signer.

After that one send attempt, the API retrieves the transaction through its fixed
Devnet RPC boundary. It requires finalized evidence for the exact prepared core,
optional bounded compute-budget prefix, wallet signer, permitted programs and
accounts, exact 0.01 SOL amount, successful lending instruction, and resulting
position increase. A wallet-modified signature is not reserved until that
relationship is proven on signature-only recovery; a first request carrying
valid signed bytes is instead bound immediately before broadcast so it cannot
be sent twice. Immediately before that send, the API compares confirmed block
height with the intent's exact last-valid block height and refuses an expired
transaction without calling `sendTransaction`. An explicit RPC rejection and an
ambiguous transport outcome are reported separately. Neither causes an automatic
resend. Later recovery calls
contain only the bound signature and are read-only. Pending or
confirmed-but-not-finalized evidence remains pending, and the intent is consumed
only after every invariant succeeds. Intent records live only in the API process
and disappear on restart.

The lending dashboard is separate from those intent records. After a wallet has
entered the proof recovery boundary, it can call the authenticated, exact-origin,
CSRF-protected `POST /api/v1/public-testnet/positions/query` route. That route is
read-only: it derives the wallet's fixed cSOL account, reads finalized reserve
state, and returns the current receipt balance, an estimated underlying SOL
value, and an indicated base supply APY. It does not create an intent, call the
wallet, sign, broadcast, or retry a transaction.

The estimate follows the fixed reserve's cToken exchange rate and variable
borrow-rate curve. It excludes rewards and risk assessment. A reserve stale flag
is shown instead of hidden. The app has no historical rate series, so it reports
the latest on-chain estimate and explicitly leaves “usual APY” unavailable; one
sample is not presented as an average or expected Mainnet return.

After the wallet returns signed bytes and before the first server submission,
the browser atomically writes a same-tab recovery journal containing that
transaction's signature. It does not create a new unsigned lock merely for
opening the wallet prompt. A reload can resume read-only verification of the
same signature and cannot resubmit signed bytes or trigger another broadcast.
An unsigned journal can age out once its server-issued evidence deadline passes.
A journal containing a known signature clears only after positively verified
completion or a definite pre-broadcast rejection. Missing status or transaction
data from a public RPC replica is never treated as proof that a signed transaction
did not land. The verifier also checks bounded finalized history for the wallet and
its cSOL account as positive recovery evidence; otherwise the signature remains
pending and locked against a duplicate send.

Funding is manual and free: use the official Solana faucet
(`https://faucet.solana.com/`) for valueless Devnet SOL. Do not buy tokens or
gas, and never paste a private key or seed phrase into application
configuration. The API does not call the faucet or airdrop funds. The 0.01
Devnet SOL remains in the lending position after a successful proof because
this deliberately minimal flow has no withdrawal transaction. It has no real
financial value, but resetting or withdrawing it requires a separate manually
reviewed action.

Server egress remains limited to fixed JSON-RPC calls with bounded timeouts and
response sizes, redirects disabled, and no automatic retry. Its only write is
the one intent-bound `sendTransaction` attempt described above. The feature is
disabled in production and hosted CI.

Public endpoint references:

- https://docs.base.org/base-chain/quickstart/connecting-to-base
- https://docs.arbitrum.io/for-devs/dev-tools-and-resources/chain-info
- https://solana.com/docs/references/clusters
- https://faucet.solana.com/
- https://docs.save.finance/architecture/addresses/devnet
- https://docs.save.finance/developers/introduction
- https://ethereum.org/developers/docs/networks/
