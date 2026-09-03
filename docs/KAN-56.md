# KAN-56 — Register wallets with ownership proof

KAN-56 now has a local, provider-neutral backend registration boundary for EVM
EOAs and Solana Ed25519 accounts. It does not contact a wallet, RPC endpoint,
indexer, cloud service, or hosted provider, and it does not create a login
session or authorize a transaction.

## Local outcome

- `POST /api/v1/wallets/ownership-challenges` issues a five-minute,
  authenticated-account-bound challenge for an ACTIVE KAN-61 network.
- `POST /api/v1/wallets/ownership-proofs` verifies the exact challenge and
  atomically registers the chain-qualified wallet.
- EVM verification uses exact `viem@2.55.18` offline ERC-191 recovery. No public
  client, transport, fallback URL, or `eth_getCode` request is constructed.
- Solana verification uses Node Ed25519 over the exact canonical SIWS message.
  The public key, signature, and signed message are strict, bounded values and
  are never persisted.
- ERC-1271 contract-wallet proofs and Wallet Standard structured
  `solana:signIn` remain fail-closed. The local Solana route supports the
  canonical `signMessage` fallback.

Every route uses the existing KAN-37 `AccountAuthGuard`. As a result, mutation
requests require a valid local session, the exact configured Origin, the CSRF
cookie/header pair, and the session-bound CSRF digest before wallet body
parsing or application work. Responses use `Cache-Control: private, no-store`
and `Vary: Cookie, Origin`.

For the current mainnet release, the service launch policy accepts only
Ethereum (`eip155:1`) and Solana
(`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`). Base mainnet challenge issuance
and roster reads fail closed. Base Sepolia remains non-production test evidence;
neither it nor broader Base registry support activates Base mainnet or counts
toward launch readiness.

## Challenge and identity binding

The signed message binds:

- a server-generated UUIDv4 challenge ID and 256-bit lowercase-hex nonce;
- the authenticated account through a challenge-specific HMAC reference;
- the configured public origin and URI, never the request Host header;
- the exact KAN-61 CAIP-2 network and canonical address;
- issue, not-before, and expiration timestamps;
- the `REGISTER_WALLET` operation; and
- explicit text that the proof does not authorize login, transactions,
  transfers, or loans.

Only the latest ACTIVE network set for one explicitly configured KAN-61
environment is accepted. Challenges and wallets persist the registry
environment, version, and immutable fingerprint. A mainnet identity cannot be
submitted to a testnet configuration, and a caller cannot select an old
registry version.

EVM addresses are decoded/checksummed as appropriate and stored canonically in
lowercase. Solana addresses must be canonical nonzero 32-byte base58 public
keys. Identity uniqueness is the exact chain plus a versioned,
domain-separated address HMAC; the same EVM key on two chains is therefore two
different wallet identities.

## Persistence and restricted data

Migration `0011` creates:

- `wallet_ownership_challenges`;
- `registered_wallets`; and
- append-only `wallet_registration_audit_events`.

The API runtime receives EXECUTE only on four fixed-search-path
`SECURITY DEFINER` functions. It receives no direct table access. The worker,
legacy runtime, and `PUBLIC` receive neither table access nor function
execution.

Raw addresses are encrypted with AES-256-GCM before registration. The pending
challenge record is also AES-256-GCM sealed with AAD that binds its challenge,
account, network, and address digest. Raw nonce, proof message, public key,
signature, and signed-message bytes are never written to a table or audit row.
Every terminal path crypto-shreds the sealed pending payload while retaining a
bounded replay tombstone and immutable audit event.

Preparation is a non-consuming, account-bound read for a valid PENDING row.
Offline verification occurs before mutation. Registration or rejection then
locks the row, rechecks database-authored status and expiry, permits exactly one
terminal transition, and appends audit evidence in the same transaction.
Expired preparation also locks, terminalizes, audits, and shreds the payload.
Concurrent valid submissions produce one registration and one generic replay
rejection. Another account cannot inspect or consume the challenge.

Terminalization deliberately uses a first-terminal-transition-wins policy. A
concurrent invalid submission from the same authenticated account may reject
that challenge before a concurrent valid submission completes, in which case
the account must request a new challenge. This fail-closed behavior avoids a
crash-stranded pre-verification CLAIMED state; it cannot register a wallet or
consume another account's challenge.

The database caps each account at five unexpired pending challenges under an
advisory lock and returns a bounded `429 Retry-After` response when exhausted.
Distributed per-source/account request-rate policy remains a deployment abuse
control; it is not represented by this local pending-row ceiling.

## Configuration

Registration defaults to `disabled`. Enabling it requires `AUTH_MODE=oidc` and
the same exact `AUTH_PUBLIC_ORIGIN` used by authentication, plus:

| Variable                                                          | Requirement                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| `WALLET_REGISTRATION_MODE`                                        | Exact `enabled`                                        |
| `WALLET_REGISTRATION_REGISTRY_ENVIRONMENT`                        | `MAINNET` or `TESTNET`                                 |
| `WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS`                       | Integer from 60 through 300                            |
| `WALLET_IDENTITY_HMAC_KEY_VERSION` / `WALLET_IDENTITY_HMAC_KEY`   | Positive version and 32-byte canonical base64url key   |
| `WALLET_CHALLENGE_HMAC_KEY_VERSION` / `WALLET_CHALLENGE_HMAC_KEY` | Separate positive version and separate 32-byte key     |
| `WALLET_METADATA_SEAL_KEY_VERSION` / `WALLET_METADATA_SEAL_KEY`   | Separate positive version and separate 32-byte AES key |

Stray wallet key variables are rejected while disabled. Identity-HMAC material
must not be rotated in place: rotation requires a dual-digest migration so the
global identity invariant cannot be bypassed. The current local slice has one
active encryption key; production decrypt-key rings, secret injection, and
rotation evidence remain KAN-50/KAN-235 gates.

## Acceptance evidence

| Jira acceptance                                  | Local evidence                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Valid EVM proof registers the expected wallet    | Runtime-generated EOA key signs the exact SIWE message; domain, service, HTTP, repository, and loopback PostgreSQL tests verify the canonical registered identity. |
| Valid Solana proof registers the expected wallet | Runtime-generated Ed25519 key signs the exact SIWS bytes; domain and service tests verify address/public-key equality and registration.                            |
| Replay and expiry fail                           | Sequential/concurrent replay tests, database row-lock tests, exact expiry-boundary tests, and terminal payload-shredding assertions fail closed.                   |
| Wrong domain and wrong user fail                 | Domain binding vectors, authenticated HTTP tests, and real-PostgreSQL account-isolation tests reject without consuming another account's challenge.                |
| Connection metadata is encrypted                 | AES-GCM tamper/AAD/key tests and database assertions show no plaintext address/proof values in durable state.                                                      |

Relevant local commands include:

```powershell
npm test --workspace @crypto-lending/api -- --runInBand src/wallets
npm run test:e2e --workspace @crypto-lending/api -- --runInBand test/wallet-registration.e2e-spec.ts
$env:TEST_DATABASE_URL="postgresql://crypto_admin:local_admin_only@127.0.0.1:5432/crypto_lending"
$env:RUN_INFRASTRUCTURE_INTEGRATION="1"
npm run test:integration --workspace @crypto-lending/api -- --runInBand test/infrastructure/wallet-registration.integration-spec.ts test/infrastructure/wallet-ownership-registration.integration-spec.ts
```

Test keys are generated at runtime; no private wallet key or real-looking proof
fixture is committed.

## Honest remaining gates

- KAN-38 supplies the prerequisite authenticated account UI and cookie-session
  lifecycle only. KAN-57, KAN-58, and KAN-59 own the product EVM,
  WalletConnect, and Solana connectors and their translation between the frozen
  WAL-001 adapter and these endpoints, including exact CAIP-2 to Wallet Standard
  Solana alias mapping. There is no product wallet UI today.
- Structured Wallet Standard `solana:signIn`, ERC-1271/6492 contract wallets,
  and any RPC-backed verification need separately approved designs and live
  evidence.
- Promoting `viem` from the isolated lab to API runtime dependencies requires
  the KAN-227 Security/Legal candidate to be refreshed before release.
- Managed identity-provider behavior, deployed CSRF/session behavior, wallet
  key custody/rotation, privacy/retention approval, distributed throttling, and
  independent security review remain external KAN-37/KAN-50/KAN-235 gates.
- Real desktop/mobile wallets and vendor behavior remain KAN-225/KAN-226
  evidence work. No real wallet was invoked for KAN-56.

These gates do not block review of the local backend implementation, but they
do block a production or public-launch completion claim.
