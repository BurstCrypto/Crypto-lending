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
- Yield comparisons use a checked-in, provenance-bearing Morpho Public API
  capture. The API and browser never fetch Morpho at runtime. Base supply APY,
  reward APR, reported provider fee, TVL, utilization, and available-to-borrow
  remain distinct; the latter is only an exit-liquidity proxy. The capture is
  labeled stale after its fixed boundary and cannot authorize an action.

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
9. Review the timestamped Morpho market capture, with base supply APY kept
   separate from reward APR and reported provider fees. Market presence means
   provider-listed only; deposit and withdrawal availability are not verified.
   Choose **More liquid**, **Balanced blend**, or **More yield**. Only this
   explicit preset choice requests an allocation preview or reveals its
   execution-cost treatment. Review the selected markets, evenly divided
   investable cents, full capital included in the projection, exact
   position-level base-yield estimate, and the Day 1 projection assumption when
   at least one whole annual cent is projected. Smaller results are labeled below
   display precision. The non-executing local simulation models $0 cost; public
   network, routing, conversion, and slippage costs are unquoted and excluded.
   Provider values are a point-in-time snapshot, not live or guaranteed returns;
   rewards are disclosed but excluded from projection.
10. Confirm the page states **No user-authorized financial transaction was
    created**. Refresh the browser to exercise wallet and session restoration.
    Disconnect a wallet to remove its contribution.

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
