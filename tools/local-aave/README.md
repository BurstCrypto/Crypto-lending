# Local Aave on real Ethereum

Run from the repository root with its Node/npm prerequisites and dependencies installed:

```powershell
npm ci
npm run dev:aave:local
```

Open **http://127.0.0.1:3300**. Stop with Ctrl+C in the launcher terminal.
The fixed port avoids the web application's default port 3000. If 3300 is
already occupied, the launcher reports an error; it never stops another process.

This is a standalone development view of Aave V3's Ethereum USDC/USDT reserves.
It displays supply APR, variable borrow APR, total supplied, variable debt and
available liquidity. An optional public Ethereum address adds its aToken and
variable-debt balances. Blank input fetches markets only. Missing or conflicting
data displays an error; explicit on-chain zero balances display as zero.

No AWS login, RPC API key, Docker container, database, private key or wallet
signature is needed. The tool reads through
[PublicNode's Ethereum endpoint](https://ethereum-rpc.publicnode.com/) and the
[dRPC public Ethereum endpoint](https://drpc.org/docs/ethereum-api).
Internet access is required; public services can throttle or become unavailable.
A wallet lookup sends that public address to both services. The tool keeps no
address history and does not log addresses or upstream response details.

The page reads on load and on an explicit refresh. It does not poll in the
background. One read runs at a time, with a five-second minimum between starts.
The displayed block time and observation time identify the snapshot; refresh
to update it. Rates are APR, before compounding. Token quantities are rounded
for display, while the local JSON response retains exact decimal strings.

## Scope

This public-address lookup does not establish account identity, wallet ownership,
durable chain checkpoints, portfolio completeness, account health, liquidation
risk or eligibility to borrow. Only USDC and USDT positions are included.
The application's ten planned providers remain disabled. No supplying,
borrowing, repayment, withdrawal, approval or transaction signing is exposed.

PublicNode/dRPC agreement is an endpoint comparison. It is not evidence of
approved independent data provenance; dRPC can aggregate upstream providers.
The result always carries `LOCAL_READ_ONLY` and `mayAuthorizeFinancialAction: false`.
It is not passed to production position admission, account APIs or workers.
Production activation still requires the controls in the
[Aave integration record](../../docs/aave-readonly-integration.md).

## Read checks

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
npm run aave:local:check
```

The first three commands are offline and included in the root test, typecheck
and lint commands used by CI. The last command deliberately reads the public
Ethereum endpoints once and prints a market snapshot; it is not run in CI.

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
