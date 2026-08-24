# KAN-60 — Multi-wallet management and lifecycle handling

KAN-60 adds a local, provider-neutral application boundary for managing several
wallet connections at once. It is built on the normalized WAL-001 adapter and
does not import a vendor SDK, discover a browser provider, contact a wallet,
restore a vendor session automatically, or start RPC/indexing work.

The implementation lives in:

- `apps/web/lib/wallets/multi-wallet-manager.ts` — simultaneous connection,
  proof, event, and disconnect lifecycle;
- `apps/web/lib/wallets/wallet-roster-storage.ts` — strict versioned roster DTO
  and an explicitly injected browser-storage adapter; and
- `apps/web/test/multi-wallet-manager.test.ts` and
  `apps/web/test/wallet-roster-storage.test.ts` — local fake-adapter evidence.

## Application contract

`MultiWalletManager` receives a fixed list of normalized `WalletAdapter`
instances and a `WalletRosterStore`. Construction only validates the adapters,
loads the redacted roster, and subscribes exactly once to each adapter. It never
calls `connect()` or `restore()`.

Solana lifecycle state accepts only KAN-61's canonical CAIP-2 references:
`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` for mainnet and
`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` for devnet. Friendly Wallet Standard
aliases such as `solana:mainnet`, `solana:devnet`, and `solana:testnet` are
rejected before a connection or roster row becomes application state.

This branch remains directly based on main, whose WAL-001 validator predates
those KAN-61 references. The isolated compatibility boundary validates a
private translated view only when that older validator is present; it never
returns or persists an alias. With KAN-59's canonical validator present, it
uses that shared boundary directly. Final branch integration should consolidate
the duplicate checked-in Solana catalog and rerun the combined wallet suites.

The intended UI/controller operations are:

| Operation                                              | Behavior                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `connect(connectorId, { label })`                      | Performs one explicit interactive add, validates and clones normalized output, and creates or reactivates the stable application connection ID.                                |
| `restore(connectorId)`                                 | Performs one explicit non-interactive restoration attempt. A restored wallet still requires fresh ownership proof. A null result marks the retained roster entry disconnected. |
| `renameWallet(connectionId, label)`                    | Changes one bounded display label without changing connection identity or authorization revision.                                                                              |
| `disconnect(connectionId)`                             | Stops indexing in memory before awaiting the provider, retains the historical roster row, and reports only a generic provider failure if cleanup fails.                        |
| `getState()` / `subscribe()`                           | Exposes independent, redacted rows suitable for a wallet list. Provider objects, raw addresses, signatures, and transport identifiers are not present.                         |
| `getVerificationTarget()` / `signOwnershipChallenge()` | Exposes the current raw account only through the narrow proof path and binds the result to the current lifecycle revision. Nothing from this path is persisted.                |
| `acceptOwnershipVerification()`                        | Enables indexing only after the caller confirms that KAN-56 accepted the exact server-issued proof for the returned revision.                                                  |

One connector may have one live application connection at a time. Stable
connection IDs are globally unique, and two live connectors cannot select the
same chain-qualified account. Historical disconnected rows are retained; they
are never silently deleted to make room for another wallet. The roster is
bounded at 32 entries.

## Fail-closed state model

| Input or event                                      | Resulting status                                    |        Revision | Indexing                                                             |
| --------------------------------------------------- | --------------------------------------------------- | --------------: | -------------------------------------------------------------------- |
| Interactive connect                                 | `reverification-required`                           | New/incremented | Off                                                                  |
| Explicit successful restore                         | `reverification-required`                           |     Incremented | Off                                                                  |
| Page reload of a live-looking row                   | `restore-required`                                  |     Incremented | Off                                                                  |
| KAN-56 accepts proof for the exact current revision | `verified`                                          |       Unchanged | On while the connection remains live and persistence remains healthy |
| Account, chain, or session update                   | `reverification-required`                           |     Incremented | Off immediately                                                      |
| User/provider disconnect or empty account event     | `disconnected`                                      |     Incremented | Off; row retained                                                    |
| Session expiry                                      | `session-expired`                                   |     Incremented | Off; row retained                                                    |
| Invalid normalized provider state                   | `disconnected` / `provider-state-invalid`           |     Incremented | Off; unrelated wallets remain isolated                               |
| Roster write failure                                | Safe current status plus global persistence failure |   As applicable | Off for every wallet                                                 |

An ownership signature that finishes after any revision-changing event is
rejected as stale, even if the wallet produced a structurally valid signature.
The manager cannot cryptographically decide that a wallet is registered; only
the authenticated KAN-56 API boundary can do that. Calling
`acceptOwnershipVerification()` before that server result would violate this
contract.

`indexingEnabled` is only a local authorization/readiness signal. It does not
start an indexer, select an RPC service, or prove that any backend indexing
process has stopped. Downstream indexing must consume this signal and continue
to enforce its own registered-wallet and account authorization checks.

## Refresh persistence and restricted data

The v1 roster snapshot is an exact-key, size-bounded DTO. It contains only:

- stable connection and configured connector IDs;
- a bounded user label;
- namespace and supported CAIP-2 chain ID;
- a masked address hint (`0xabcd…1234` or `AbCd…1234`);
- lifecycle status, revision, fixed transition reason, and timestamps.

It has no fields for a raw address, provider, transport session/topic, pairing
URI, challenge, nonce, message, public key, signature, or provider error. The
serializer reparses the complete snapshot and rejects unknown fields before
writing, so adding one of those values accidentally fails closed instead of
persisting it.

`StorageBackedWalletRosterStore` requires a storage object to be supplied by a
client composition root. It never reaches for `window`, `localStorage`, or
`sessionStorage` itself. For a same-tab refresh, the intended initial
composition is an explicitly supplied `sessionStorage` instance. Browser
storage is display continuity only: every previously active row is downgraded
to `restore-required`, and neither storage status nor a vendor-restored session
is wallet ownership or application authentication.

## Local acceptance evidence

The fake-only tests demonstrate:

- two independently labeled EVM wallets remain in the roster after manager
  disposal/recreation, with no automatic connector call;
- explicit restoration retains both stable IDs and labels while requiring new
  proof;
- the same lifecycle boundary connects, persists, and explicitly restores a
  normalized Solana devnet connection under its canonical KAN-61 identity;
- account, chain, session, disconnect, expiry, and malformed-event paths stop
  indexing without mutating an unrelated wallet;
- same-connector, same-account, and stable-ID duplicates fail closed;
- disconnect stops indexing before an awaited provider failure and retains the
  historical row;
- an in-flight proof becomes stale after a lifecycle event; and
- a connector that resolves after abort or manager disposal is cleaned up and
  cannot reactivate or persist a late wallet session; and
- persistence failure disables indexing globally while raw provider errors,
  addresses, transport IDs, challenges, and signatures remain absent from the
  roster.

Focused verification:

```powershell
npm test --workspace @crypto-lending/web -- multi-wallet-manager.test.ts wallet-roster-storage.test.ts
npm run typecheck --workspace @crypto-lending/web
npm run lint --workspace @crypto-lending/web
```

## Honest remaining gates

- KAN-57, KAN-58, and KAN-59 own the MetaMask/Coinbase, WalletConnect, and
  Phantom adapter implementations. Those branches were intentionally not used
  as a base for KAN-60, so no vendor connector is registered and no product
  route is wired on this branch.
- The add/restore/disconnect/read-model contract is ready for a UI composition
  root after those connectors merge. Until then, automated fakes are not a
  live-wallet demonstration.
- Real extension, mobile, injected-provider, WalletConnect relay, event-order,
  account-switch, session-expiry, and cleanup behavior still require the
  documented KAN-225/KAN-226 manual matrix. No provider or wallet was invoked
  for this ticket.
- The caller must obtain and submit an authenticated, server-issued KAN-56
  challenge. Local manager tests do not claim deployed identity, CSRF, nonce,
  verification, database, privacy, or key-custody evidence.
- Same-connector concurrent sessions and multiple simultaneous selected
  accounts inside one connector remain outside the approved cardinality. The
  supported local shape is one live session per distinct configured connector.
- Downstream RPC/indexing integration, provider approval, and proof that a live
  indexer halts on disconnect remain separate gated work. This branch makes no
  network, provider, cloud, trial, or paid-service call.
