# Synthetic local demo harness

This harness composes the real web, API, database migrations, session flow, and
outbox worker entirely on loopback. It supplies an ephemeral OIDC fixture so a
developer can exercise registration, login, protected-session restoration,
synthetic wallet ownership, unified balances, buying power, and logout without
creating an identity-provider, wallet-relay, RPC, oracle, or cloud account.

The harness is not production, provider, security-review, or external-acceptance
evidence. Every screen displays a synthetic-data banner while the mode is on.

## Safety boundary

- `LOCAL_DEMO_MODE` is disabled by default. The API and web application reject
  it in production, on a non-loopback bind, with alternate origins, or with a
  managed-provider configuration.
- The web proxy can target only `http://127.0.0.1:3001`; it is not a configurable
  forwarding proxy.
- The fixture identity provider listens only on `127.0.0.1:3400`, uses an
  ephemeral ES256 key, stores one-use authorization-code digests in memory, and
  accepts no bearer or client credential.
- Authentication identity lookup, wallet identity lookup, and sealed wallet
  metadata use distinct deterministic fixture keys so registrations remain
  readable across application restarts while the demo-owned database volume
  exists. Transaction, session, CSRF, wallet-challenge, and identity-provider
  signing keys remain ephemeral; restarting requires a fresh browser login.
  The stable fixture keys are publicly derivable from this source and provide
  continuity, not confidentiality evidence. Changing their derivation labels,
  key IDs, or wallet-key versions requires a demo-owned volume teardown unless
  a corresponding multi-key migration is implemented.
- Child processes receive allowlisted operating-system variables instead of the
  caller's cloud, proxy, database, or vendor environment.
- Preflight refuses ignored root, API, or web environment files that could be
  loaded after sanitization. Installed CLIs run directly rather than through
  npm lifecycle configuration, API dotenv loading is bypassed in guarded demo
  mode, and Next telemetry is disabled.
- Docker commands use a checked-in empty client configuration, force the
  built-in `default` context, and accept only reviewed local Docker Desktop,
  system, or rootless socket paths. User registry credentials, client proxy
  injection, TCP, SSH, HTTPS, and arbitrary local forwarding sockets are
  excluded.
- Compose uses an explicit checked-in interpolation file and the fixed
  `crypto-lending-local-demo` project. Every container, volume, and network also
  carries a KAN-253 ownership marker; teardown refuses the operation if any
  project resource lacks that marker.
- Startup inspects all three digest-pinned base images before Compose runs. The
  LocalStack wrapper is built with network disabled and pulling disabled, then
  Compose uses both `--pull never` and `--no-build`. A missing image fails the
  run instead of contacting a registry.
- Startup also proves the locked native Next compiler is installed and loadable;
  its downloadable WebAssembly fallback is disabled.
- AWS metadata discovery is disabled and the SDK is pinned to the loopback
  LocalStack endpoint with non-credential local fixture values.
- The API independently requires the harness's exact loopback PostgreSQL,
  Redis, and SQS endpoints and its fixed non-production fixture identities.
  Alternate infrastructure, AWS credential, metadata, proxy, RPC, relay, and
  provider variables make demo startup fail before it can listen.
- The demo wallet API accepts only the `EVM` and `SOLANA` fixture selectors. It
  creates an ephemeral server-side key, signs only the fresh KAN-56 challenge,
  submits that proof through the real registration service, and never returns a
  private key, challenge, signature, or general-purpose signing capability.
- EVM portfolio reads use the fixed `LOCAL_EVM_HARDHAT` chain at
  `http://127.0.0.1:18545`. The keyless chain executes the real mock-USDC
  `balanceOf` call and produces local blocks; it cannot target a public RPC.
  Solana balances and all price evidence remain deterministic in-memory
  fixtures. The result is not evidence about a public chain or available
  credit.
- The chain supervisor exposes only the authenticated control endpoint
  `http://127.0.0.1:18546/control`. The launcher injects its new per-launch
  identity and capability into the API child as
  `LOCAL_EVM_CONTROL_LAUNCH_ID` and `LOCAL_EVM_CONTROL_CAPABILITY`; neither
  value is logged or stored in checked-in configuration. Signed control
  responses carry a random per-child instance identity so an API cache cannot
  confuse a replacement child with the prior generation by PID or height.
- API balance initialization uses nonce-bound HMAC control requests. Balance
  reads verify the exact mock-USDC bytecode at the pinned block tag before and
  after `eth_call`, then recheck the same block. Each mutation is a sender-gated,
  zero-fee mined local transaction, and the runtime proves the prior pinned
  block hash, code, and balance remain immutable.
- The ignored ownership record's PIDs are diagnostic only. External lifecycle
  commands never signal them; only the supervisor stops or restarts its Hardhat
  child through the `ChildProcess` handle it created. Reset replaces the entire
  child and does not use EVM snapshot metadata. Matching unowned or ambiguous
  RPC/control endpoints fail closed.
- The Hardhat child requires an operating-system IPC tether to its supervisor,
  so abrupt supervisor death closes the child. Graceful shutdown closes control
  admission, drains admitted commands, then stops the final current child.
- The browser accepts `eip155:31337` and mock USDC only through an isolated
  local-demo response adapter and renderer. Wallet roster projections remain
  Sepolia/Solana devnet, and shared production network/asset allowlists are not
  widened.
- Yield comparisons use provider snapshot v3, a checked-in, immutable set of
  point-in-time developer captures. Its private candidate set contains ten
  distinct providers: seven on EVM and three on Solana. The EVM candidates are
  Morpho, Aave, Compound, Moonwell, Spark, Venus, and Euler; the Solana
  candidates are Kamino, Save, and the internally labeled P0/marginfi candidate.
  A separately researched Drift observation is excluded before ranking because
  its observed market was paused and its observation was stale. The API and
  browser make no live provider request; loading, selecting, and capacity-aware
  rebalancing over the checked-in snapshots performs no external provider,
  public-RPC, validator, bridge, or public-chain I/O, creates no transaction,
  and incurs no provider-request or on-chain execution cost. Browser responses
  expose only a product-owned EVM/Solana managed-rate status and aggregate
  ecosystem results. Provider identity, protocol identity, market identifiers,
  provenance, exact observations, and endpoints remain server-confidential and
  absent from the public DTO and UI. The v3 aggregate capture time is the latest
  component capture (`2026-08-27T01:04:48.000Z`), and its stale boundary is the
  earliest component stale time (`2026-08-27T14:14:54.580Z`), so the complete
  set becomes stale as soon as any source does. The native blend keeps each
  fixture asset assigned to its ecosystem and cannot authorize an action.
  Reward and promotional APR are excluded from ranking and yield projection,
  provider and protocol risk is unassessed, and deposit and withdrawal
  availability is unverified. It does not claim an executable EVM network route.

Do not enter a real email address, phone number, seed phrase, private key,
signature, wallet address, credential, customer record, or real asset.

## Start

Prerequisites are the repository's locked npm dependencies plus locally cached
Docker images for PostgreSQL, Redis, and the checked-in LocalStack image. The
harness deliberately fails instead of pulling a missing image.

Move any ignored `.env`/`.env.local` files reported by preflight aside before
running this harness. Their ordinary local-development values are deliberately
not composed into the synthetic demo.

From the repository root:

```powershell
npm run demo:local
```

The command starts the isolated Compose project, applies migrations with the
local migration principal, and launches:

- web: `http://127.0.0.1:3000`
- API health: `http://127.0.0.1:3001/api/v1/health`
- synthetic identity: `http://127.0.0.1:3400/health`
- local EVM: `http://127.0.0.1:18545` (`eip155:31337`)
- local EVM control: `http://127.0.0.1:18546/control` (authenticated; not a
  browser API)
- local outbox worker

Application processes remain attached to the terminal. Press `Ctrl+C` to stop
them. The demo-owned dependency containers remain available for a quick restart.

The API is compiled once per harness start instead of running in watch mode.
This prevents an API child-process restart from dropping the listener and
clearing authenticated in-memory demo state. Web changes still hot reload;
restart the attached harness to pick up API source changes.

## Current click-through flow

1. Open `http://127.0.0.1:3000/register`.
2. Enter synthetic values such as `demo@example.invalid`, no phone number, and
   an assigned two-letter country code.
3. Continue to the local identity selector and choose a fixture identity.
4. The callback creates the platform account and secure session through the real
   KAN-37 repository and controller boundaries.
5. Refresh the protected account page and then sign out. Cookie rotation, CSRF,
   account isolation, and logout revocation remain active.
6. Open `http://127.0.0.1:3000/portfolio`. The page first restores the same
   authenticated account; an expired or missing session returns to login.
7. Select **EVM test wallet**, **Solana test wallet**, or both. The local API
   completes a real one-use KAN-56 ownership proof with an ephemeral synthetic
   signer, then the existing multi-wallet lifecycle marks only that accepted
   connection as eligible for indexing.
8. Review the account-scoped portfolio value and available buying power. With
   both fixture wallets connected, each is `$11,000.00`; no hypothetical route
   fee is deducted before an action is chosen. Inspect the source wallet, chain,
   asset, freshness, and masked-address details.
9. Review the timestamped managed-rate status, then choose **Managed blend**.
   The API retains the other closed preset IDs for compatibility, but the web
   does not offer them until they gain real server-owned strategy differences.
   Only this explicit choice requests the first allocation preview or reveals
   its cost treatment.
   Every first preview starts at a 0% liquid reserve and 100% managed yield. In
   the selected preview, move the liquidity slider from 0% to 95% in 5% steps,
   then choose **Update preview**. The page keeps the currently applied
   percentage visible until the recalculation succeeds; changing the draft or
   updating the preview never moves funds. The reserve percentage applies to
   capital remaining after deducted modeled costs and any
   disclosed retained rounding residual.

   The browser receives aggregate liquid-reserve and managed-yield buckets only;
   confidential provider, protocol, market, provenance, and endpoint details
   stay on the server. The request is bound to the displayed portfolio snapshot.
   The confidential distinct-provider-first selector admits at most one
   opportunity per provider and caps the result at two opportunities per
   ecosystem, while the browser receives provider-neutral EVM/Solana source and
   managed totals without a selected-position count. Internally, the ten private
   candidates therefore produce at most four selected positions when both
   ecosystems participate. The selected positions start from the deterministic
   split, are capped by captured TVL and available-liquidity
   proxies, and reassign residual capital only within the same ecosystem and
   selected set. This capacity-aware rebalancing is a local calculation, not a
   transaction. This heuristic is not a risk assessment. Selection and
   projection use only captured base supply APY; reward or promotional APR
   remains separate private metadata and is not included. Provider listing does
   not verify deposit or withdrawal availability. The result covers each
   ecosystem's modeled fees from that ecosystem, keeps capital assigned to its
   wallet ecosystem, and models no EVM-to-Solana transfer. It does not claim a
   bridge-free EVM network route. The preview creates no executable route, so
   the actual local operation costs $0.00 and public execution remains unquoted.
   A separate non-quote scenario itemizes network, conversion, cross-chain,
   market-impact, and platform-routing costs. Until subscription entitlements
   are integrated, the server explicitly uses the canonical Free tier: material
   orchestration costs 20 basis points of managed capital, and only one exact
   same-network, same-contract-or-mint direct settlement costs zero. No legacy
   local-demo routing calculation is stacked with the canonical fee. Network,
   conversion, and market-impact components round up to a cent and are deducted
   before allocation. The platform fee uses canonical half-even atomic-unit
   rounding and is reported as added on top. A fixed-route cent discontinuity
   can retain up to three cents of user capital outside the projection as a
   disclosed rounding residual; it is not a fee and is excluded from break-even.
   Larger route-activation gaps fail closed. Exact observations,
   including base supply APY decimals and capacity inputs, stay private for
   ranking, selection, and capacity checks. The public effective APY is
   conservatively floored to a product-owned 25-basis-point bucket, and public
   annual yield, after-fee yield, and first-positive-day status are derived from
   that bucketed rate. Review the aggregate effective APY, annual yield before
   and after modeled fees, and first-positive-day status. A numbered day is the
   first whole day when straight-line projected yield exceeds modeled fees by at
   least one cent within the 365-day horizon; it is not a live rate or execution
   promise.

10. Confirm the page states **No user-authorized financial transaction was
    created**. Refresh the browser to exercise wallet and session restoration.
    Disconnect a wallet to remove its contribution.

## Optional live public-testnet proof

The attached local harness also enables a separate Solana Devnet proof flow
outside production and hosted CI. After applying **Managed blend**, connect a
Solana Devnet browser wallet through Wallet Standard and use the transaction-
proof submit control. The modeled portfolio and fee preview remain local
estimates. The live action is only one fixed 0.01 native Devnet SOL deposit into
one Save/Solend lending position; it does not execute the full EVM/Solana blend
or move the displayed synthetic portfolio.

Obtain valueless Devnet SOL for free from the official Solana faucet at
`https://faucet.solana.com/`; do not purchase anything and never enter a seed
phrase or private key into the application. This flow requires no EVM testnet
gas, EVM test token, ERC-20 approval, or second wallet confirmation. The API
prepares one fixed Solana message and the connected Wallet Standard wallet asks
the user for one confirmation, then signs and broadcasts through the wallet's
configured Devnet provider. The API never stores a wallet key, signs,
broadcasts, requests an airdrop, or accepts a caller-supplied RPC, program,
account list, or transaction message.

The message starts with a fixed-domain, opaque intent memo followed by the five
reviewed account-setup and lending instructions. The memo makes concurrently
prepared transactions distinct without adding another confirmation or asset
movement. Immediately before the wallet call, the browser writes a same-tab
recovery marker; it adds a returned signature before contacting the API. A
reload may therefore resume read-only verification of that exact signature, but
it cannot automatically send or resend a wallet transaction. The marker clears
only after verified completion, an explicit pre-commit rejection, or the
server-issued evidence deadline.

The intent remains bound to the authenticated account, Solana wallet, portfolio
snapshot, and exact applied liquidity selection. Verification retrieves the
submitted transaction from the fixed Devnet RPC and requires finalized evidence
for the exact prepared message, signer, program and accounts, 0.01 SOL amount,
successful lending instruction, and resulting position increase. Pending or
merely confirmed evidence is not called complete. The Save/Solend program and
account targets are visible to the wallet, its RPC provider, explorers, and the
public chain; a non-custodial on-chain transaction cannot conceal them from its
signer.

The deposited Devnet position remains deposited because this minimal proof
deliberately has no withdrawal transaction. Restarting the API clears its
in-memory intent records but does not undo a public Devnet transaction. The
older `testnet:live:*` commands remain separate four-chain, read-only
connectivity checks. See `tools/public-testnet/README.md` for the application-
proof boundary and the independently runnable smoke-test boundary.

The portfolio is not embedded in the page. Its EVM balance is read from the
real loopback development chain; Solana balance and valuation inputs remain
fixtures. The authenticated same-origin API composes them through the real
EVM/Solana indexers, balance-sync orchestrator, valuation policy, unified
portfolio aggregation, and buying-power calculator. Production adapters remain
fail closed until separately reviewed and configured; this harness is not
approval to contact a wallet relay, public RPC/indexing provider, oracle, or
cloud service.

To reset only the current account's demo wallets, disconnect both entries in the
portfolio page. Restarting the attached API process clears every ephemeral
signer and deterministic connection projection. The normal teardown command
still removes only KAN-253-owned dependency resources.

Disconnect removes the wallet from the active synthetic portfolio; the real
KAN-56 registration record remains in the local demo database until the owned
database volume is removed by teardown.

Browser roster hints are scoped by authenticated account and cleared on logout
or session loss; they contain no key, signature, challenge, or full address.

## Verify without starting Docker or application services

```powershell
npm run test:local-demo
npm run test:local-evm
npm test --workspace @crypto-lending/api -- --runInBand src/local-demo
npm run test:e2e --workspace @crypto-lending/api
npm test --workspace @crypto-lending/web -- test/local-demo-config.test.tsx test/local-demo-client.test.ts test/local-demo-allocation-planner.test.tsx test/local-demo-wallet-adapter.test.ts test/local-demo-portfolio-journey.test.tsx test/browser-egress.test.ts
npm run security:scan:secrets
```

The identity tests use an ephemeral in-process loopback HTTP server, most
application checks use deterministic fakes, and `test:local-evm` starts the real
loopback Hardhat runtime. None contacts an external endpoint.

## Teardown

After stopping the attached application processes, remove the isolated demo
containers and volumes:

```powershell
npm run demo:local:teardown
```

The teardown first sends an authenticated `STOP` command for a chain whose
ownership record is marked `LOCAL_DEMO`; the supervisor alone stops its Hardhat
child through the retained process handle. It then refuses unreviewed Docker
endpoints, inventories the fixed `crypto-lending-local-demo` project, and
verifies the KAN-253 ownership marker before issuing Compose down. It does not
remove the repository's ordinary development volume or another Docker project.
An older or colliding project without the marker, or an ambiguous local EVM
endpoint, fails closed and must be reviewed manually.
