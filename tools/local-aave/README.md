# Local Ethereum and Solana

Run from the repository root with its Node/npm prerequisites and dependencies installed:

```powershell
npm ci
npm run dev:chains:local
```

Open **http://127.0.0.1:3300**. Stop with Ctrl+C in the launcher terminal.
The fixed port avoids the web application's default port 3000. If 3300 is
already occupied, the launcher reports an error; it never stops another process.

Select **Ethereum** or **Solana**, then paste that chain's public address and
click **Refresh live data**. Blank input reads market data. The browser wallet
button can copy the public address from an injected Ethereum wallet or Phantom
after its connection prompt. It does not request an ownership signature or
transaction. Without an installed extension, use the address field.

| Network  | Live local coverage                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Ethereum | Aave V3 USDC/USDT rates, liquidity, supply and variable-debt balances                                         |
| Solana   | SOL/USDC/USDT wallet balances; Kamino main-market USDC reserve and the default standard/USDC lending accounts |

Addresses stay separate per chain in page memory. Changing the chain or editing
an address cancels the previous read; a late response cannot replace the new
selection. Missing or conflicting evidence displays an error. Explicit on-chain
zero balances display as zero; an absent Kamino account displays **not found**.
This remains a partial protocol view: Kamino coverage excludes other account
IDs, markets, assets, Multiply, fixed-rate products and vaults.

No AWS login, RPC API key, Docker container, database, private key or wallet
signature is needed. Ethereum reads use
[PublicNode's Ethereum endpoint](https://ethereum-rpc.publicnode.com/) and the
[dRPC public Ethereum endpoint](https://drpc.org/docs/ethereum-api).
Solana reads use [PublicNode](https://solana.publicnode.com/) and the
[Solana mainnet public RPC](https://solana.com/docs/references/clusters).
Internet access is required; public services can throttle or become unavailable.
A wallet lookup sends that public address to both services. The tool keeps no
address history and does not log addresses or upstream response details.

The page reads on load and on an explicit refresh. It does not poll in the
background. One read runs at a time per chain, with a five-second minimum between
starts on that chain. A pending Ethereum read does not block a Solana read.
The displayed block time and observation time identify the snapshot; refresh
to update it. Aave rates are APR, before compounding. Token quantities are rounded
for display, while the local JSON response retains exact decimal strings.

## Scope

This public-address lookup does not establish account identity, wallet ownership,
durable chain checkpoints, portfolio completeness, account health, liquidation
risk or eligibility to borrow. Position coverage is limited to the table above.
The application's ten planned providers remain disabled. No supplying,
borrowing, repayment, withdrawal, approval or transaction signing is exposed.

PublicNode/dRPC agreement is an endpoint comparison. It is not evidence of
approved independent data provenance; dRPC can aggregate upstream providers.
Both chains compare endpoint responses; this is not production source approval.
The result always carries `LOCAL_READ_ONLY` and `mayAuthorizeFinancialAction: false`.
It is not passed to production position admission, account APIs or workers.
Production activation still requires the controls in the
[Aave integration record](../../docs/aave-readonly-integration.md).

## Ethereum read checks

Both endpoints must report Ethereum chain ID 1. If their finalized heights
differ, the reader selects the lower height and verifies its block hash on the
other endpoint. Blocks more than thirty minutes old or dated in the future
are rejected. Calls use the same block hash with `requireCanonical: true`, per
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898).

The reader verifies both pool bindings and both reserve token mappings against
the repository's Aave deployment manifest. It parses the exact twelve-word
[`getReserveData` interface](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/helpers/AaveProtocolDataProvider.sol),
including ray-scaled liquidity/borrow rates, and queries token balances at that
same finalized block. Both sources must agree on every displayed raw value.
Each source rechecks the anchor block and chain ID at the end.

Market-only reads require twelve requests per endpoint; including a wallet
requires sixteen. A differing finalized height adds one request to the newer
endpoint. Each read has a thirty-second limit and each endpoint has a one-MiB
aggregate HTTP body budget. The shared transport retains its two-second DNS/TLS
connection limit, five-second request limit, public-address validation, TLS
identity checks, strict response framing and bounded cancellation.

The local DNS compatibility fix sequences A then AAAA queries on the existing
resolver. It still validates both complete answer families before opening TLS.
It does not change system DNS settings or relax private-address rejection.

The HTTP launcher binds only to `127.0.0.1:3300` and refuses production mode.
It checks Host and Origin, restricts request bodies and simultaneous reads,
applies a restrictive Content Security Policy, and provides no generic RPC
proxy, endpoint override, CORS access or transaction method. The tool's files
are outside both production application build roots.

## Verification

```powershell
npm run test:local-aave
npm run typecheck:local-aave
npm run lint:local-aave
npm run chains:local:check
```

The first three commands are offline and included in the root test, typecheck
and lint commands used by CI. The last command deliberately reads both chains
and prints their market snapshots; it is not run in CI. For one chain, use
`npm run aave:local:check` or `npm run solana:local:check`. The earlier
`npm run dev:aave:local` command remains an alias for the combined local server.

## Solana read checks

Both RPCs must report Solana's full mainnet genesis hash. Token discovery uses
the Solana public RPC, because PublicNode's indexed queries require a personal
token. Discovered USDC/USDT accounts, the wallet's SOL account, fixed mint and
Kamino reserve accounts, and two derived default Kamino obligation addresses
are read together through `getMultipleAccounts` on both endpoints. SPL accounts
must have the expected mint, wallet owner, token program and binary layout.
The reader sums every discovered account for each supported mint, including
accounts other than the associated token account. It rejects duplicate lists
or an account list that changes during the read.

Account requests use `finalized` commitment. Their actual response context slots
are retained and must be within 128 slots of the requested floor and each other.
[`minContextSlot`](https://solana.com/docs/rpc/http/getmultipleaccounts) is a
lower bound; the page never labels it as an exact requested snapshot slot.
Both endpoints must return matching account bytes and metadata. One bounded
retry handles an account refresh between responses; persistent disagreement
fails the read. A matching JSON-RPC `-32016` response gets at most two 500-ms
waits for a lagging node to reach the requested minimum slot. Those requests
share the original deadline and byte budget; other failures are not retried.
Both endpoints also verify the same block at the lower account
context slot, with matching hash, parent and recent timestamp. Genesis is
checked again at the end. Agreement at different slots means matching observed
state, not a cryptographic proof that both responses came from one slot.

Kamino decoding follows the repository's pinned
[`klend-sdk` revision](https://github.com/Kamino-Finance/klend-sdk/tree/38845294447623f6de3afc9dec29875f959f6f48).
It checks account sizes, discriminators, program owners, market/mint bindings,
and obligation owner/tag. Supplied USDC is estimated from collateral shares and
the reserve's recorded net liquidity, excluding protocol and referral fees.
Borrowed USDC uses the recorded cumulative borrow index and rounds upward to
atomic units. Interest since the reserve's last refresh is excluded. The page
shows refresh slots; these amounts are not payoff quotes or health assessments.

The Solana reader has a thirty-second deadline, a one-MiB HTTP body budget per
endpoint, and at most 100 accounts in the combined request. Each mint's discovery
list is capped at 64 accounts; exceeding any limit fails rather than truncates.
Both accepted RPC operations are cancelled and drained on failure or browser
disconnect. No production transport method or activation rule was expanded.

## Solana integration verification, September 9

All 62 local reader, server and browser tests passed, as did local lint and type
checks. The tests include positive supplied/debt calculations, multiple token
accounts, single-lamport formatting, mixed-chain address rejection, chain-switch
races, account mismatch, byte limits, cancellation and connection without signing.

A live lookup of the public example address in
[Kamino's developer guide](https://kamino.com/docs/build/developers/borrow)
returned 0.050443138 SOL in the browser at finalized slot 445,669,971, observed
at 17:39:56 UTC.
Its standard obligation existed with zero USDC exposure; its default USDC lending
account was absent. This was a documentation example, not the user's wallet.
Live market reads also succeeded on both chains. No wallet secret, signature,
transaction, cloud deployment or paid RPC credential was used. Logs are under
`.local-validation/solana-local-20260909/`. User-specific wallet testing still
requires that user's public address; browser extension prompts were tested with
mock providers, not an installed Phantom extension.

Production-preflight tests passed 136 tests with one Windows filesystem skip.
The combined live CLI check, provider inventory validation, formatting and the
repository secret scan passed. The production API source snapshot is unchanged
from the earlier Ethereum checkpoint below.

## Earlier Ethereum verification checkpoint

On September 9, 2026, the live market read and browser rendering succeeded on
this Windows workstation. The browser displayed matching USDC/USDT data at
finalized block 25,940,790, observed at 16:02:23 UTC. A subsequent live
lookup of a newly generated public address returned explicit zero supply and
variable-debt balances for both assets at block 25,940,822, observed at 16:04:39
UTC; no private key was generated or used. The 26 local reader/server
tests and all 126 shared transport tests passed, including both-family DNS
validation, source disagreement, stale/future blocks, reserve mapping checks,
wire-byte limits, cancellation, cross-origin rejection and request throttling.
All 300 existing Aave API tests also passed. Production-preflight tests passed
136 tests with one Windows filesystem skip. API build, API/local/preflight
type checks and lint, formatting, provider inventory validation, and the
repository secret scan passed.
The reviewed API source snapshot remains 426 runtime files, now 7,485,313 bytes,
SHA-256 `ddbce511af4eca3706b2e21fa95c1c66640c1a711a10af35f355ed63f189b094`.
The production preflight's local infrastructure checks pass; its launch status
remains `BLOCKED` because the production activation evidence is still missing.
These are developer verification results, not an independent security audit
or a production launch attestation. Local logs are under
`.local-validation/aave-local-20260909/` and are not committed.
