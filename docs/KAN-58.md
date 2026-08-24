# KAN-58: Local WalletConnect connector boundary

Status: `LOCAL_BOUNDARY_COMPLETE` / `EXTERNAL_ACCEPTANCE_BLOCKED`

KAN-58 now has a provider-neutral WalletConnect adapter and deterministic state
machine. The implementation is deliberately limited to injected local fakes. It
does not install or import a WalletConnect/Reown package, accept vendor terms,
hold a project ID, construct a relay client, resolve a vendor hostname, open a
socket, make a network request, or invoke a real wallet.

This is local implementation evidence, not proof that the WalletConnect SDK,
relay, QR handoff, universal links, mobile deep links, or session restoration
work against a real provider.

## Local outcome

[`walletconnect-connector.ts`](../apps/web/lib/wallets/walletconnect-connector.ts)
implements the existing `WalletAdapter` contract with:

- one exact `INJECTED_DETERMINISTIC_LOCAL_ONLY` transport boundary;
- an injected transport factory, pairing presenter, clock, and connection-ID
  generator, so tests require no vendor object or external service;
- exact namespace, chain, method, event, CAIP-10 account, selected-account,
  session-topic, and expiry validation before a connection enters product
  state;
- ephemeral QR and allowlisted deep-link presentation;
- connect, restore, update, disconnect, rejection, abort, pairing-expiry, and
  session-expiry transitions;
- account and chain lifecycle translation into the frozen WAL-001
  `WalletEvent` contract; and
- exact ownership-challenge handoff followed by local validation and defensive
  copying of the normalized signature result.

The adapter supports either one configured `eip155` or one configured `solana`
namespace. It rejects a mixed or unexpected namespace. A session may approve a
subset of the configured chain allowlist, but it may not add another chain or
capability. Methods and events must exactly match the requested closed sets.
The selected account is mandatory and is never inferred from `accounts[0]`.

## Fail-closed configuration

Construction requires every field below and rejects unknown fields, accessors,
duplicates, malformed values, and vendor-specific additions:

```ts
{
  mode: 'deterministic-local',
  runtimeEnvironment: 'local', // or 'test'
  transportBoundary: 'INJECTED_DETERMINISTIC_LOCAL_ONLY',
  connectorId: 'walletconnect',
  namespace: 'eip155',
  approvedChains: ['eip155:11155111'],
  requiredMethods: ['personal_sign'],
  requiredEvents: ['accountsChanged', 'chainChanged'],
  pairingTimeoutMs: 60_000,
  deepLinks: [
    {
      walletId: 'local-fixture',
      baseUrl: 'https://wallet.example/connect',
      pairingUriParameter: 'uri',
    },
  ],
}
```

Only `local` and `test` runtime environments are accepted. Deep-link endpoints
must be HTTPS and use loopback or the reserved `.example`/`.invalid` suffixes.
Production/vendor hosts, custom schemes, credentials, existing query strings,
and fragments are rejected. `projectId`, `relayUrl`, SDK provider instances,
and other unreviewed fields cannot be added to configuration or pairing/session
results.

The boundary marker is runtime-checked on the injected factory. It is not an
authorization flag for a vendor implementation. Introducing a real factory
requires a different, independently reviewed boundary and cannot be achieved by
changing environment values alone.

## Pairing URI handling

A pairing URI is secret-bearing capability material. The adapter applies the
following contract:

1. The normalized local transport returns one bounded WalletConnect v2 `wc:`
   URI and an absolute pairing expiry.
2. The adapter validates the URI structure, 256-bit lowercase-hex `symKey`, and
   `irn` relay-protocol marker without copying the value into an error.
3. The URI is passed directly to one presenter as the QR value and is
   percent-encoded into configured local-only deep links.
4. Adapter state records only the expiry and deep-link wallet IDs. Pairing
   state, connection results, events, and exceptions contain no pairing URI,
   symKey, deep-link URL, or raw provider error.
5. The presenter is cleared after approval, rejection, invalid approval,
   expiry, abort, or presentation failure. Its contract forbids telemetry,
   logs, browser storage, URL history, durable state, clipboard copying, or
   retention after `clear()`.

The module contains no logger, `console`, `fetch`, `WebSocket`, browser-storage,
SDK, or relay integration. It cannot itself display or transmit a real pairing
URI because no product route constructs this connector and no non-fake factory
is accepted.

## State and lifecycle contract

| From        | Input                                     | Result                                                                  |
| ----------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `idle`      | connect with valid local attempt          | ephemeral `pairing` presentation                                        |
| `pairing`   | valid approval                            | frozen `connected` state                                                |
| `pairing`   | reject, abort, expiry, invalid response   | cancel attempt, clear presenter, return fixed error, then `idle`        |
| `idle`      | valid unexpired restored session          | frozen `connected` state with `restored: true`                          |
| `connected` | approved session/account/chain update     | revalidate everything, retain application connection ID, emit event     |
| `connected` | empty account set                         | emit `accountsChanged` with `connection: null`, then `idle`             |
| `connected` | malformed or expanded session update      | remove local state, request transport cleanup, emit fixed disconnect    |
| `connected` | remote/local disconnect or session expiry | remove local state, clear expiry timer, emit one closed lifecycle event |

Concurrent connect/restore operations fail with a fixed `CONNECTOR_BUSY`
error. Session timers use the approved absolute expiry and accept no session
more than 30 days into the future. Listener exceptions cannot stop cleanup or
other listeners. Transport and presenter errors are converted to closed codes;
raw messages, causes, provider responses, and pairing values are discarded.

## Ownership-proof handoff

`signOwnershipChallenge` first applies the existing WAL-001 target check: the
server-issued challenge must match the explicit selected account and an
approved signing method. Only then does the injected transport receive the
exact challenge and opaque session topic.

The result must be a plain, exact SIWE/SIWS shape with own data properties.
Accessors and additional provider metadata are rejected without being read.
Binary SIWS values are copied before the existing challenge/signature
correlation validator runs. This browser check is not cryptographic proof; the
KAN-56 API remains responsible for server-side verification, replay prevention,
and durable registration.

## Deterministic evidence

The focused suites cover:

- exact and adversarial configuration, including production mode, project/relay
  fields, live deep-link hosts, accessors, duplicates, and unsafe URLs;
- exact request capabilities, explicit non-first account selection, QR/deep
  link encoding, and absence of pairing material from state;
- user rejection, timeout, abort, concurrent attempts, presenter/factory
  failures, and fixed non-secret errors;
- wrong namespace, unapproved chain, missing/expanded capability, wrong selected
  account, expired session, and raw provider-object rejection;
- restore, account/chain/session updates, empty accounts, invalid updates,
  disconnect, automatic expiry, and listener isolation; and
- exact ownership challenge forwarding plus malformed, accessor-backed, and
  metadata-bearing signature rejection.

Run locally with:

```powershell
npm run test --workspace @crypto-lending/web -- --run `
  test/walletconnect-connector-config.test.ts `
  test/walletconnect-connector-lifecycle.test.ts
npm run lint --workspace @crypto-lending/web
npm run typecheck --workspace @crypto-lending/web
npm run build --workspace @crypto-lending/web
npm run format:check
git diff --check
```

These commands perform local filesystem, compilation, and deterministic test
work only. The focused implementation has no package or lockfile change.

## External gates

KAN-58 must not be represented as externally accepted, production-ready, or
complete from this branch. All of the following remain blocked:

- Legal authorization to download/install and accept the exact
  `@walletconnect/ethereum-provider` and hard Reown/AppKit license versions;
- Security approval of the exact dependency graph, browser-visible project ID,
  relay hosts, telemetry behavior, storage behavior, QR/deep-link attack
  surface, origin policy, and rollback plan;
- an approved WalletConnect project, terms, quotas, rate limits, data handling,
  and cost controls;
- a KAN-231 exact-host egress decision and explicit authorization for relay,
  wallet, RPC, and testnet traffic;
- replacement of the local-only transport marker and reserved deep-link-host
  restriction through reviewed code, not configuration drift;
- real desktop/mobile QR, deep-link, rejection, refresh restoration, update,
  expiry, disconnect, wrong-namespace, and outage evidence under KAN-225 and
  KAN-226; and
- independent KAN-227 approval bound to the exact post-change commit and
  dependency inventory.

No package install, project creation, credential request, license acceptance,
relay call, wallet invocation, testnet/mainnet request, cloud change, or paid
resource was performed for this local slice.
