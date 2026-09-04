# KAN-59: Phantom Solana connector

KAN-59 adds a local, provider-neutral Phantom/Solana adapter behind the frozen
WAL-001 `WalletAdapter` boundary. The implementation uses browser primitives
and local fakes only. It installs no package and makes no wallet, RPC, indexer,
cloud, hosted-CI, or other network call.

## Local outcome

- `createPhantomSolanaAdapter` translates one explicitly selected Phantom
  provider source into immutable application-owned connections, accounts,
  scopes, events, and ownership signatures.
- `discoverInjectedPhantomSolanaProvider` is the guarded direct-injection
  fallback. It requires a secure top-level context, reads only
  `window.phantom.solana`, requires the Phantom marker and complete bounded
  provider surface, and never reads collision-prone `window.solana`.
- The provider source is injected into the adapter rather than discovered at
  module load. A future reviewed Wallet Standard registry bridge can therefore
  supply the same private provider surface without exposing its wallet object
  to product modules.
- The adapter supports interactive connect, explicitly requested trusted
  restore, exact-connection disconnect, account changes, provider disconnect,
  listener cleanup, and application listener isolation.
- One adapter instance owns at most one active Phantom connection. Duplicate
  calls return the same immutable identity and concurrent calls share one
  provider prompt. Ambiguous multi-account provider results fail closed.

The authenticated production portfolio now activates this adapter only for the
ownership-message flow in `MainnetWalletOwnership`, alongside the separate
Ethereum connector. The page uses the account-scoped server roster for durable
registration and removal; it never treats an injected session as login or
transaction authority. No automated test invokes a real Phantom extension, so
deployed browser and vendor acceptance remain blocking evidence.

## Cluster and identity boundary

The previous web contract accepted the friendly alias `solana:devnet` as an
application chain ID. That alias does not match the canonical KAN-61/KAN-56
identity. The shared boundary now accepts only these checked-in KAN-61 IDs:

| Environment | Canonical application/KAN-56 CAIP ID      | Wallet Standard alias |
| ----------- | ----------------------------------------- | --------------------- |
| Mainnet     | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `solana:mainnet`      |
| Devnet      | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `solana:devnet`       |

`solanaWalletStandardChainForCaip` is the only translation. Unknown CAIP
references, the raw aliases at the application boundary, and a provider account
that explicitly claims only another cluster are rejected. Solana addresses are
case-sensitive, must encode one nonzero 32-byte public key, and are never
lowercased.

Injected Phantom does not expose a dependable RPC-cluster or chain-change
contract. Absence of a provider cluster claim is therefore not represented as
wallet-side cluster proof. The server-issued challenge, KAN-61 registry, RPC,
program, and mint allowlists remain the authoritative environment controls. If
a provider or Wallet Standard account does expose a chain claim, the adapter
requires the configured alias or canonical CAIP ID.

## Ownership proof translation

The connector never authors a nonce, message, domain, URI, address, cluster, or
expiration:

- For `siws-message`, it verifies that the server challenge targets the active
  selected account and approved chain, UTF-8 encodes the exact message, and
  invokes `signMessage` once. It requires a 64-byte Ed25519 signature and a
  returned signing key equal to the active account.
- `toSolanaEd25519OwnershipProofWire` binds that exact result to the challenge
  and emits KAN-56's strict `SOLANA_ED25519` body with canonical unpadded
  base64url public-key, message, and signature bytes.
- For `siws-sign-in`, the adapter advertises and invokes the feature only when
  the selected provider source exposes it. It passes a frozen copy of the exact
  structured input and validates the wallet-constructed account, public key,
  message, signature, and Ed25519 type.
- KAN-56 currently verifies only its canonical `signMessage` SIWS challenge.
  Structured `solana:signIn` output is deliberately not translated into a
  KAN-56 proof until the server issues and verifies that structured contract.
  The connector never silently changes one challenge format into the other.

An account change, disconnect, or local disconnect invalidates the active
connection. An in-flight signature is discarded if the connection revision
changes before the provider result returns.

## Fail-closed and redaction controls

- Provider objects remain private to the adapter and never enter application
  state or events.
- Provider error messages, stacks, causes, responses, payloads, addresses, and
  arbitrary codes are not retained. A small closed code catalog produces fixed
  messages and recoverability decisions.
- Only known rejection, pending-request, and disconnect codes receive a
  specific classification. Everything else becomes `PROVIDER_FAILURE` or the
  operation's fixed fallback.
- Invalid keys, cluster claims, account arrays, listener APIs, signing outputs,
  connection IDs, and byte views fail closed.
- A provider session that resolves after abort or after event-binding failure
  is disconnected best effort and never becomes local authorization.
- Exact provider listener functions are removed once. A throwing product
  listener cannot block cleanup or another listener.

## Local verification

```powershell
npm run test --workspace @crypto-lending/web -- --run `
  test/phantom-solana-adapter.test.ts test/wallet-adapter.test.ts
npm run typecheck --workspace @crypto-lending/web
npm run lint --workspace @crypto-lending/web
npm run build --workspace @crypto-lending/web
npm run format:check
git diff --check
```

The focused suite uses hostile local fakes for secure/top-level discovery,
legacy-global exclusion, duplicate/concurrent connection, trusted restoration,
canonical and wrong-cluster claims, ambiguous accounts, account/disconnect
events, exact cleanup, canonical-message and structured SIWS, KAN-56 wire
translation, malformed signing results, connection races, abort cleanup,
listener isolation, and raw-error canaries.

## Honest live-wallet gates

- No real Phantom extension, mobile app, in-app browser, wallet account, RPC,
  cluster, signature, or network was used. PH01 and PH03-PH08 in the existing
  wallet validation runbook remain device evidence, not unit-test claims.
- The approved product discovery path remains Solana Wallet Standard. This
  no-new-package branch supplies the provider-neutral adapter and guarded direct
  fallback; wiring the reviewed Wallet Standard registry packages into the web
  runtime still requires the KAN-227 dependency/security snapshot to be current.
- A real extension must be tested in a top-level secure context. Localhost is a
  browser secure context; non-local deployed testing requires separately
  approved HTTPS. Phantom Browse on physical iOS remains separately gated.
- Live evidence must confirm the current Phantom response/event shapes, exact
  listener cleanup, trusted restoration, rejection, account switching,
  disconnect behavior, and availability of structured `solana:signIn`.
- Because injected Phantom cannot attest its active RPC cluster, an authorized
  integration must bind the exact KAN-61 environment to KAN-56, RPC, program,
  and mint allowlists and demonstrate wrong-environment rejection end to end.
- KAN-56 structured sign-in verification, KAN-60 persistent lifecycle/UI,
  privacy/security approval, and independent desktop/mobile evidence remain
  open. Local fakes do not satisfy those gates.
