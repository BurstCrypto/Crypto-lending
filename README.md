# Crypto Lending

This repository contains the production-shaped application foundation for the
Crypto Lending platform. It is an npm workspace with a Next.js web application,
a versioned NestJS API, and shared PostgreSQL, Redis, and SQS infrastructure.

The [zero-cost repository audit](docs/zero-cost-repository-audit-2026-09-08.md)
records the current local verification checkpoint and remaining external gates.

## Prerequisites

- Node.js 22.13 or newer on the Node 22 line, or Node.js 24+
- npm 11.6.4
- Docker with Docker Compose

## Start locally

Install dependencies and create local application configuration:

```powershell
npm install
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/api/.env.example apps/api/.env
docker compose up --detach --build --wait
npm run db:migrate
```

Run the applications in separate terminals:

```powershell
npm run dev:web
npm run dev:api
npm run worker:outbox
```

The default local endpoints are:

- Web: `http://127.0.0.1:3000`
- API liveness: `http://127.0.0.1:3001/api/v1/health`
- Dependency readiness: `http://127.0.0.1:3001/api/v1/health/dependencies`
- API version: `http://127.0.0.1:3001/api/v1/version`
- Swagger UI: `http://127.0.0.1:3001/api/v1/docs`
- OpenAPI JSON: `http://127.0.0.1:3001/api/v1/docs-json`

## Current production direction

The product path targets Amazon Cognito managed sign-in, Ethereum mainnet
(`eip155:1`), and Solana mainnet
(`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`). Base is outside the active launch
scope. Account identity, wallet ownership proof, portfolio reads, and financial
actions are separate security boundaries. The current mainnet slice is
read-only; existing testnet executors are not promoted or relabeled. See the
[mainnet rollout boundary](docs/mainnet-rollout.md) for the explicit gates
before live reads or any real-value write.
The [smart lending allocation policy](docs/smart-lending-allocation-policy.md)
defines the non-executing, fee-aware recommendation boundary for comparing
same-chain and explicitly opted-in Ethereum/Solana cross-chain routes. Passive,
disabled-by-default adapters now normalize wallet-free Aave Ethereum market
corroboration, aggregate market corroboration, and read-only round-trip bridge
quotes. A fail-closed composition boundary is wired with unavailable defaults;
none of these pieces activates a provider or a mainnet transaction path.

## Isolated regression harness (not product runtime)

KAN-253 adds a guarded, loopback-only composition for exercising the real web,
API, database, session, and worker boundaries without a managed identity
provider, wallet relay, RPC/indexing provider, oracle, cloud resource, vendor
account, trial, or paid service. This harness supplies synthetic identities only
for local regression tests; the ordinary web application and mainnet product do
not start or expose it.

```powershell
npm run demo:local
```

The launcher refuses production mode, non-loopback application origins, remote
Docker transports, ambient cloud/vendor configuration, and missing locally
cached images. The UI is permanently marked as synthetic while enabled. See the
[local demo runbook](tools/local-demo/README.md) for the click-through flow,
limitations, verification, and isolated teardown.

### Local EVM chain

KAN-256 adds a pinned, keyless Hardhat EDR development chain at the fixed LOCAL
identity `eip155:31337`, RPC `http://127.0.0.1:18545`, and authenticated control
endpoint `http://127.0.0.1:18546/control`. The synthetic demo starts it
automatically; it can also be exercised independently:

```powershell
npm run local-evm:start
npm run local-evm:reset
npm run test:local-evm
npm run local-evm:teardown
```

The chain has no configured accounts. A keyless synthetic controller submits
zero-fee mined fixture transactions, so it needs no signing key, faucet, real
gas, provider, or public network. It backs real EVM `eth_call` balance indexing
and local portfolio synchronization, but it is not a decentralized/PoS
validator or public testnet. Each launch uses a new random capability and
HMAC-authenticated loopback control. External commands never signal the
diagnostic PIDs in the ignored ownership record; the supervisor alone restarts
or stops its Hardhat child through its retained process handle. Reset starts a
fresh child without snapshot metadata. Each child gets a random authenticated
instance identity, and every balance change is a mined local transaction that
preserves previously pinned state. The Hardhat child also requires a private
operating-system IPC tether to that supervisor, so an abruptly terminated
supervisor cannot leave the RPC child listening. The browser accepts the LOCAL
chain and mock-USDC tuple only through an isolated local-demo parser and
renderer; shared production network and asset allowlists remain unchanged. See
the [local EVM runbook](tools/local-evm/README.md) and
[KAN-256 evidence](docs/KAN-256.md).

### Live public-testnet connectivity

A separate, credential-free local operator smoke test verifies exact chain
identity and requests a provider-reported finalized head on Ethereum Sepolia,
Base Sepolia, Arbitrum Sepolia, and Solana devnet through credential-free public
RPCs:

```powershell
npm run testnet:live:preflight
npm run testnet:live:smoke
npm run test:testnet:live
```

This performs reads only and has no wallet, key, faucet, signing, transaction,
or broadcast path. It proves RPC connectivity, not an executable lending flow,
and it does not feed public observations into application financial state. See
the [public-testnet smoke runbook](tools/public-testnet/README.md) for the exact
boundary.

The attached local demo separately offers two independent browser-wallet proofs
after a managed allocation preview. After both reviews and disclosures are
ready, one **Submit both testnet deposits** button starts both flows without
awaiting either. They do not execute the displayed cross-chain blend and are not
one atomic cross-chain transaction. The single application action still requires
two separate user approvals: MetaMask or Coinbase Wallet confirms the Base
Sepolia transaction, and a Wallet Standard wallet such as Phantom confirms the
Solana Devnet transaction.

The EVM proof sends exactly 0.00005 native Base Sepolia ETH through Aave V3's
fixed WETH gateway and Pool, producing a fixed aWETH position for the connected
wallet. It requires at least 0.0001 Base Sepolia ETH before starting so the
remainder is available for testnet gas. Fund a dedicated test-only address from
the official [Coinbase CDP faucet](https://portal.cdp.coinbase.com/products/faucet)
using Base Sepolia and ETH; the
[official quickstart](https://docs.cdp.coinbase.com/faucets/introduction/quickstart)
describes the claim flow. Base Sepolia is chain ID `84532` (`0x14a34`), with
public RPC `https://sepolia.base.org` and explorer
`https://sepolia-explorer.base.org`. The fixed Aave contracts are addresses
provider `0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00`, Pool
`0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27`, WETH gateway
`0x0568130e794429D2eEBC4dafE18f25Ff1a1ed8b6`, WETH
`0x4200000000000000000000000000000000000006`, aWETH
`0x73a5bB60b0B0fc35710DDc0ea9c407031E31Bdbb`, and protocol data
provider `0xBc9f5b7E248451CdD7cA54e717a2BFe1F32b566b`. Because this is a
native-ETH gateway call, it does not need a separate ERC-20 allowance approval.
The exact ABI call has a domain-separated opaque intent marker appended as
trailing calldata so otherwise identical deposits remain bound to separate
intents; the server verifies the complete input and nonce.
The EVM proof reports transaction confirmation only after a successful receipt
and exact transaction and position checks against the latest Base state. Base
finality is a separate milestone and commonly arrives about 20 minutes later;
the UI must not describe a latest-state receipt as finalized.

The SVM proof prepares an exact six-instruction core that deposits 0.01 native
Devnet SOL into one fixed Save/Solend lending position. A public, opaque intent
memo makes every signed message unique even when two requests receive the same
recent blockhash. Phantom may prepend only `SetComputeUnitPrice` followed by
`SetComputeUnitLimit`; the verifier requires a 200,000-compute-unit limit, a
price no higher than 500,000 micro-lamports per compute unit, and a priority fee
no higher than 100,000 lamports (0.0001 SOL). No other addition, reordering, or
core mutation is accepted. The authenticated API revalidates the signed legacy
transaction and makes exactly one Devnet broadcast attempt. It accepts the proof
only after finalized core-message, bounded compute-budget, and position
verification.

Each chain has its own send lock, recovery journal, explorer link, and read-only
lending dashboard. A reload may only poll a known EVM transaction hash or Solana
signature; neither path automatically resends an ambiguous or pending write.
The dashboards reconstruct the fixed aWETH and cSOL positions and show only the
latest on-chain variable base supply APY, with rewards excluded. The app has no
historical rate series, so it does not claim a "usual" or historical APY.

Directly below those dashboards, one **Withdraw testnet positions** action can
return every validated nonzero proof position to its same connected wallet. It
starts the eligible Base Sepolia and Solana Devnet lanes together, but they are
independent and are not an atomic cross-chain transaction. The EVM lane may
require an aWETH approval confirmation followed by an Aave withdrawal
confirmation; Solana uses one redeem-and-unwrap confirmation. A success on one
chain is never rolled back, repeated, or treated as authorization to retry the
other. Only valueless public-testnet assets are supported.
See the [local demo runbook](tools/local-demo/README.md) for exact funding,
confirmation, public-chain disclosure, recovery, and persistence details.

## Restricted wallet validation lab

The shipped `apps/web` application has no wallet-lab route. `tools/wallet-lab`
is the separate real-package compatibility harness. It is a private,
localhost-only Vite development application with its own package lock. It is
not an npm workspace, is not included by the root install/build, and cannot
produce a deployable build.

The real harness is authorized only for a maximum of two project-authorized
evaluators using dedicated test wallets on Ethereum Sepolia, Base Sepolia, and
Solana devnet. It permits explicit connect, disconnect, testnet switching, and
ownership-message signing. It does not expose a transaction action and is not
approved for a public URL, external testers, mainnet, production accounts,
customer data, or real assets.

> **Pre-install acceptance warning:** The install command immediately below
> downloads and installs `@walletconnect/ethereum-provider@2.23.10` and its hard
> dependency `@reown/appkit@1.8.19`. Their locked licenses state that downloading
> or installing constitutes acceptance of their terms. Anyone unable or
> unauthorized to accept both exact licenses must not run the command or use the
> real-package lab. There is no wallet-lab fallback in the shipped application. The
> `VITE_WALLETCONNECT_TERMS_ACCEPTED` flag gates runtime activation only and does
> not prevent or undo install-time acceptance.

Only after an authorized review and acceptance, run:

```powershell
npm ci --prefix tools/wallet-lab
Copy-Item tools/wallet-lab/.env.example tools/wallet-lab/.env.local
# In the ignored .env.local, set VITE_WALLET_LAB_ENABLED=true.
npm run dev:wallet-lab
```

Open only `https://127.0.0.1:4173`. Do not override the host or expose it through
a tunnel, LAN address, hosted preview, or proxy.

MetaMask desktop is discovered through injected EIP-6963 providers. The native
`@metamask/connect-evm` package is intentionally absent because the reviewed
2.1.1 implementation adds Ethereum mainnet to its connection permission request,
which violates this lab's testnet-only authorization. MetaMask Mobile may be
tested only through the restricted WalletConnect path.

After that authorized installation, WalletConnect remains unavailable unless
`.env.local` contains both a valid
32-character hexadecimal `VITE_WALLETCONNECT_PROJECT_ID` and the literal
`VITE_WALLETCONNECT_TERMS_ACCEPTED=true`. The flag is an additional explicit
runtime acknowledgement; it is not a substitute for the acceptance required
before `npm ci` and is not public-launch legal approval. An already authorized
installer may leave it `false` to keep WalletConnect inactive while testing the
other connectors.

The WalletConnect provider hard-installs `@reown/appkit@1.8.19` even though the
lab disables and does not invoke its modal. The provider and AppKit have separate
custom Reown licenses and notice/license-copy obligations; both remain
public-launch gates.

The Coinbase connector requests EOA-only mode. The selected SDK path does not
provide a verified telemetry-off control, so every SDK, extension, transport, or
vendor request must be treated as potentially observable. Do not use sensitive
or production data. See
[`tools/wallet-lab/README.md`](tools/wallet-lab/README.md) for the exact boundary,
dependency override/audit status, and test procedure.

To verify the isolated harness:

```powershell
npm run lint:wallet-lab
npm run typecheck:wallet-lab
npm run test:wallet-lab
```

The KAN-222 [license packet](docs/wallets/license-review/README.md) and
[public-launch gate](docs/wallets/license-review/public-launch-legal-gate.md)
remain open for every public, external-user, mainnet, or production use.

KAN-56's [wallet ownership registration boundary](docs/KAN-56.md) adds local,
authenticated EVM EOA and Solana Ed25519 ownership verification with atomic
replay prevention and encrypted durable wallet identity. It remains disabled by
default and makes no wallet, RPC, provider, or cloud call.

Verified wallets persist on the account across sign-ins, so returning users do
not have to reconnect and prove the same wallet on every login. An authenticated
`DELETE /api/v1/wallets/:walletId` request performs an account-scoped,
idempotent soft revocation: removing an active wallet, repeating the removal, or
submitting an identifier that is not active on that account has the same
no-content outcome. Removal invalidates pending ownership challenges for that
blockchain identity across Crypto Lending accounts, so a challenge issued before
removal cannot reactivate it. Adding the wallet again requires a freshly issued
challenge and a new ownership proof.

Removing a wallet only stops its active association and portfolio monitoring in
Crypto Lending. It does not disconnect a browser extension or mobile wallet,
end an external wallet-provider session, revoke any on-chain approval, submit a
transaction, or move funds. Encrypted registration history and security audit
records are retained; removal is not a privacy erasure or data-subject-request
workflow. A separately reviewed privacy deletion, retention, and DSAR workflow
is still required; this endpoint does not provide one.

### Shipped route boundary

The former mock wallet-lab page and its proxy branch are retired. No
`apps/web/.env.local` setting can enable a wallet-lab route in the shipped Next
application. The lower-level mock policy and evidence code remains available to
offline unit tests only; authorized real-package validation uses the separate
loopback-only `tools/wallet-lab` harness described above.

The liveness route reports whether the API process can serve requests. The
readiness route verifies PostgreSQL connectivity and migration state, Redis,
and both SQS queues; it returns 503 when a dependency is unavailable or the
database schema is behind.

## Verification

The standard local quality gates are:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run security:scan:secrets
npm run security:test:secrets
npm run security:validate:threat-model
npm run security:test:threat-model
npm run security:audit
npm run security:test:jira
npm run test:e2e --workspace @crypto-lending/api
npm run build
npm run openapi:generate
```

To exercise real migrations, Redis health, SQS health, retry behavior, and DLQ
redrive against the local Docker services:

```powershell
$env:APPLICATION_WORKLOAD="api"
$env:DATABASE_RUNTIME_URL="postgresql://crypto_api_login_a:local_api_database_a@127.0.0.1:5432/crypto_lending"
$env:DATABASE_RUNTIME_SSL_MODE="disable"
$env:MIGRATION_DATABASE_URL="postgresql://crypto_migration:local_migration_only@127.0.0.1:5432/crypto_lending"
$env:MIGRATION_DATABASE_SSL_MODE="disable"
$env:TEST_DATABASE_URL="postgresql://crypto_admin:local_admin_only@127.0.0.1:5432/crypto_lending"
$env:RUN_INFRASTRUCTURE_INTEGRATION="1"
npm run test:integration
```

## AWS application baseline, billing guardrails, and egress controls

KAN-34's native CloudFormation baseline is defined in
`infra/aws/application-baseline.yaml`. It models private Fargate application
tasks, RDS, ElastiCache, SQS, KMS, Secrets Manager, CloudWatch, and the required
networking without adding Terraform/CDK state or embedded credentials.
KAN-229's separate `infra/aws/account-guardrails.yaml` defines the account-level
budget and optional anomaly-notification prerequisites that must be approved and
verified before an application change set can be created.
KAN-231's local egress policy package preserves deny-by-default server and
browser behavior while RPC, identity, oracle, and vendor destinations remain
unapproved. It adds no NAT, firewall, proxy, paid endpoint, or provider call.
Its constrained no-direct-service-fee inventory permissions are versioned in
`infra/aws/kan-229-readonly-preflight-policy.json`; the policy contains no Cost
Explorer or write permissions and is never attached by CI or local validation.
Live reads still require separate authorization because pre-existing account
logging can have its own metered ingestion or delivery configuration.
KAN-230's provider-neutral ACM/DNS record, validator, and non-executable plan
renderer prepare a hostname and integrated public-certificate path without
calling AWS or a DNS provider. They prohibit domain registration, new hosted
zones, exportable/private certificates, and paid monitoring under the current
policy.
KAN-50 adds a history-aware committed-secret scanner and exact offline
validation of ECS secret injection, IAM trust/capability matrices, KMS service
constraints, and SQS encryption/redrive/TLS boundaries. Its local evidence and
unresolved live controls are documented in [docs/KAN-50.md](docs/KAN-50.md); no
validator result is represented as proof of a deployed account.

Validate it entirely offline with:

```powershell
npm run infra:validate
npm run infra:test:guardrails
npm run infra:test:acm-dns
npm run infra:test:migrations
npm run infra:test:workload-boundaries
npm run infra:test:sqs
npm run infra:test:egress
python -m pip install --requirement infra/aws/requirements-dev.txt
python infra/aws/lint-cloudformation.py infra/aws/application-baseline.yaml infra/aws/application-workload-boundaries.yaml infra/aws/database-migration-task.yaml infra/aws/account-guardrails.yaml infra/aws/sqs-foundation.yaml
```

These commands do not access AWS. The described services are billable if a
stack is deployed, so the invocation guard defaults to local validation and
blocks cloud actions without explicit profile, account, Region, and billing
acknowledgement inputs. No AWS environment is activated by repository setup or
CI. The account guardrail and application invocation scripts both default to
filesystem-only validation. See [`docs/KAN-34.md`](docs/KAN-34.md) for the
application architecture and [`docs/KAN-229.md`](docs/KAN-229.md) for the cost,
authority, and independent-verification workflow. See
[`docs/KAN-230.md`](docs/KAN-230.md) for the local-only hostname, certificate,
DNS, cutover, and rollback contract. The Proposed egress design,
dependency gates, and live-evidence boundary are in
[`docs/KAN-231.md`](docs/KAN-231.md).

The runtime contract requires separate `DATABASE_RUNTIME_*` login slots for
the API and worker; `APPLICATION_WORKLOAD` selects the matching stable
capability role before the first query. The separate
`infra/aws/database-migration-task.yaml` defines an operator-invoked, one-off
task that receives only the `crypto_migration` `MIGRATION_DATABASE_*`
credential. The RDS master/bootstrap credential is forbidden from all
long-lived and migration task definitions. RDS owns that KMS-encrypted managed
secret and its default seven-day rotation; the preserved compatibility output
name `DatabaseCredentialsSecretArn` exposes only the current database's
managed-secret ARN. Separate IAM and KMS authorization is required for any
bootstrap use. The local Compose database uses distinct, deliberately
local-only fixtures for all three
paths and retains the pre-KAN-232 volume under its old name rather than mutating
it. See KAN-232 and KAN-34 for bootstrap order, rotation, recovery, billing
gates, and residual live work.

The live test refuses non-loopback service URLs, creates isolated queues and a
unique PostgreSQL schema, and removes only those test resources. See
[`docs/KAN-33.md`](docs/KAN-33.md) for transaction, migration, and queue usage.

## Architecture boundaries

KAN-49's repository-wide threat register, data classification, retention
inventory, key inventory, and High-risk owner/mitigation map are documented in
[`docs/security/threat-model.md`](docs/security/threat-model.md) and validated
against a content-bound SHA-256 sidecar. The packet is ready for independent
review, not locally approved; KAN-235 remains the independent Security decision
gate.

- `apps/web` owns the browser-facing Next.js application.
- `apps/api/src/system` owns process liveness, version, and API contract routes.
- `apps/api/src/accounts` owns immutable platform account IDs, self-scoped
  profile application rules, the fail-closed current-principal port, and the
  PII-safe account persistence boundary.
- `apps/api/src/authentication` owns KAN-37's provider-neutral OIDC/PKCE,
  browser-bound callback, secure cookie session, CSRF, rotation, revocation,
  identity mapping, and abuse-control boundaries. The local implementation is
  documented in [`docs/KAN-37.md`](docs/KAN-37.md); managed-provider selection,
  egress, deployment, and live acceptance remain gated.
- `apps/web/app/login`, `register`, and `account` own KAN-38's accessible
  cookie-session UI, strict local return paths, protected loading shell, live
  profile restoration, and CSRF-bound logout. The local contract and remaining
  provider/HTTPS browser gates are documented in
  [`docs/KAN-38.md`](docs/KAN-38.md).
- `apps/api/src/blockchain` owns KAN-61's issuer-verified, environment-qualified
  chain and stablecoin registry. New observations normalize only against the
  latest immutable snapshot, while trusted historical reads retain their exact
  registry version and fingerprint. Connector/RPC provenance remains gated to
  the later IDX provider and indexing work documented in
  [`docs/KAN-61.md`](docs/KAN-61.md).
- KAN-62 proposes Alchemy as primary and QuickNode as a distinct-provider
  fallback candidate for provider-neutral, standard-protocol, read-only RPC
  across all eight KAN-61 networks; failure-domain independence remains pending
  live proof. It approves no provider, plan, account, endpoint, credential,
  Region, SLA, cost, runtime, or egress. See the
  [human decision packet](docs/KAN-62.md),
  [machine record](docs/rpc-indexing/kan-62-provider-decision.json), and
  [SHA-256 sidecar](docs/rpc-indexing/kan-62-provider-decision.sha256). The
  [provider-neutral source ADR](docs/adr/0004-rpc-indexing-source-strategy.md)
  and
  [fail-closed observation policy](apps/api/src/blockchain/domain/chain-observation-policy.ts)
  define the inactive local enforcement contract.
- KAN-66 proposes Pyth Core as the primary USD stablecoin price source and
  Chainlink Data Feeds as a fallback/cross-check for exact KAN-61 mainnet USDC,
  USDT, and PYUSD identities. Its integer-only policy caps upside at one dollar,
  preserves downside, rejects stale/conflicting data, and remains blocked from
  runtime or financial use pending KAN-252 and KAN-231. See the
  [human decision packet](docs/KAN-66.md),
  [machine record](docs/valuation/kan-66-stablecoin-valuation-decision.json),
  and [SHA-256 sidecar](docs/valuation/kan-66-stablecoin-valuation-decision.sha256).
- `apps/api/src/infrastructure/observability` owns KAN-52's provider-neutral,
  low-cardinality metrics and server-authoritative correlation-linked spans.
  The optional environment dashboard remains disabled by default; local
  evidence and the separate deployed/cost gate are documented in
  [`docs/KAN-52.md`](docs/KAN-52.md).
- [`docs/adr/0003-immutable-ledger-accounting-model.md`](docs/adr/0003-immutable-ledger-accounting-model.md)
  defines KAN-40's proposed operational, multi-asset ledger contract. KAN-41
  implements the local append-only schema and application boundary, while
  KAN-42 adds append-only transaction and leg lifecycle history. KAN-43 composes
  idempotent journal commands with the existing transactional outbox; audit-query
  work remains in KAN-44. See
  [`docs/KAN-40.md`](docs/KAN-40.md), [`docs/KAN-41.md`](docs/KAN-41.md), and
  [`docs/KAN-42.md`](docs/KAN-42.md), and [`docs/KAN-43.md`](docs/KAN-43.md).
- `apps/api/src/infrastructure/database` owns pooled queries, transaction
  propagation, and checksum-protected migrations.
- `apps/api/src/infrastructure/redis` owns the API's health-only Redis boundary.
  Redis key commands are not currently granted, and the outbox worker has no
  Redis configuration or client dependency.
- `apps/api/src/infrastructure/outbox` owns durable job envelopes and
  transactional publication; `infrastructure/sqs` owns transport retries and
  SQS-managed dead-letter redrive.
- `infra` contains local dependency initialization, the standalone SQS topology,
  KAN-34's guarded CloudFormation application baseline, and KAN-229's separate
  account billing controls. `infra/egress` contains KAN-231's inert destination
  policy and filesystem-only validator; it contains no deployment action.

These boundaries are intended to be extended by later domain modules. They do
not embed lending business rules into infrastructure clients, which keeps future
account, collateral, ledger, and loan work incremental rather than requiring a
foundation rewrite.

## Jira helper scripts

Copy `.jira.env.example` to the ignored `.jira.env` file and supply an Atlassian
API token. The Jira scripts read that file by default; set `JIRA_ENV_PATH` or use
their `-EnvironmentPath` parameter to keep credentials elsewhere. Never commit
the populated credential file.
