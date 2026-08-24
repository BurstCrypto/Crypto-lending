# Synthetic local demo harness

This harness composes the real web, API, database migrations, session flow, and
outbox worker entirely on loopback. It supplies an ephemeral OIDC fixture so a
developer can exercise registration, login, protected-session restoration, and
logout without creating an identity-provider account or credential.

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
- Child processes receive allowlisted operating-system variables instead of the
  caller's cloud, proxy, database, or vendor environment.
- Docker startup first proves the active engine uses a local `npipe://` or
  `unix://` transport. TCP, SSH, and HTTPS Docker endpoints are rejected.
- Compose uses the fixed `crypto-lending-local-demo` project. Teardown can remove
  only that project's containers and volumes.
- Startup inspects all three digest-pinned base images before Compose runs. The
  LocalStack wrapper is built with network disabled and pulling disabled, then
  Compose uses both `--pull never` and `--no-build`. A missing image fails the
  run instead of contacting a registry.
- AWS metadata discovery is disabled and the SDK is pinned to the loopback
  LocalStack endpoint with non-credential local fixture values.

Do not enter a real email address, phone number, seed phrase, private key,
signature, wallet address, credential, customer record, or real asset.

## Start

Prerequisites are the repository's locked npm dependencies plus locally cached
Docker images for PostgreSQL, Redis, and the checked-in LocalStack image. The
harness deliberately fails instead of pulling a missing image.

From the repository root:

```powershell
npm run demo:local
```

The command starts the isolated Compose project, applies migrations with the
local migration principal, and launches:

- web: `http://127.0.0.1:3000`
- API health: `http://127.0.0.1:3001/api/v1/health`
- synthetic identity: `http://127.0.0.1:3400/health`
- local outbox worker

Application processes remain attached to the terminal. Press `Ctrl+C` to stop
them. The demo-owned dependency containers remain available for a quick restart.

## Current click-through flow

1. Open `http://127.0.0.1:3000/register`.
2. Enter synthetic values such as `demo@example.invalid`, no phone number, and
   an assigned two-letter country code.
3. Continue to the local identity selector and choose a fixture identity.
4. The callback creates the platform account and secure session through the real
   KAN-37 repository and controller boundaries.
5. Refresh the protected account page and then sign out. Cookie rotation, CSRF,
   account isolation, and logout revocation remain active.

The wallet, balance, portfolio, and buying-power stages are added by KAN-57–69.
They must consume injected synthetic adapters and never reinterpret this harness
as approval to contact a wallet relay, RPC/indexing provider, oracle, or cloud
service.

## Verify without starting services

```powershell
npm run test:local-demo
npm test --workspace @crypto-lending/api -- --runInBand src/authentication/infrastructure/config/authentication.config.spec.ts src/wallets/infrastructure/config/wallet-registration.config.spec.ts
npm test --workspace @crypto-lending/web -- test/local-demo-config.test.tsx test/browser-egress.test.ts
```

These checks use only in-process loopback servers and deterministic fakes.

## Teardown

After stopping the attached application processes, remove the isolated demo
containers and volumes:

```powershell
npm run demo:local:teardown
```

The teardown refuses remote Docker endpoints and addresses only the fixed
`crypto-lending-local-demo` Compose project. It does not remove the repository's
ordinary development volume or any other Docker project.
