# KAN-57 — MetaMask and Coinbase injected connectors

KAN-57 now has a local, provider-neutral product connector boundary for
MetaMask and Coinbase Wallet EOA accounts announced through EIP-6963. It uses
the frozen WAL-001 `WalletAdapter` contract and hands the exact server-authored
KAN-56 SIWE challenge to the selected EIP-1193 provider.

This implementation did not install a wallet package, contact an extension,
make an RPC or hosted-provider request, create a wallet, or submit a
transaction. All provider behavior in automated evidence is deterministic and
in-memory.

## Local outcome

- `Eip6963ProviderDiscovery` requests and observes EIP-6963 announcements. It
  recognizes the current MetaMask (`io.metamask`) and Coinbase Wallet
  (`com.coinbase.wallet`) rows, returns application-owned display labels, and
  exposes no provider capability in its display descriptors.
- A caller must return the opaque `selectionId` for the exact observed row.
  There is no first-provider selection and no read of the collision-prone
  `window.ethereum` global.
- `InjectedEvmConnectorRegistry` owns one adapter per explicit selection.
  Repeating a selection or `connect()` returns the existing normalized
  connection rather than creating another permission request or connection ID.
- `InjectedEip1193WalletAdapter` calls only `eth_requestAccounts`,
  `eth_accounts`, `eth_chainId`, and `personal_sign`. It has no RPC transport and
  no transaction method.
- MetaMask and Coinbase capabilities remain separate. Neither announced name,
  icon, extension flag, provider UUID, nor provider object becomes application
  identity.

EIP-6963 reverse-DNS metadata is still self-asserted by an extension. Exact
reverse-DNS matching and an application label prevent accidental connector
substitution; they do not prove that an installed extension is authentic. The
user, browser distribution controls, and the outstanding security review remain
part of that trust decision.

## Network display and validation

The connector exports immutable KAN-61 v1 display catalogs for the three EVM
networks in each environment:

| Environment | Display networks                                 |
| ----------- | ------------------------------------------------ |
| Mainnet     | Ethereum Mainnet, Base Mainnet, Arbitrum One     |
| Testnet     | Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia |

Configuration rejects mixed environments, duplicate identities, noncanonical
hexadecimal provider chain IDs, and decimal/hex mismatches. A connector
descriptor makes the complete selected-environment allowlist available to the
UI. An unsupported or malformed chain never creates a normalized connection;
an unsupported `chainChanged` event invalidates the active connection.

These web catalogs intentionally contain display identity only. The versioned
KAN-61 API registry remains authoritative for registration and asset support.
KAN-56 rechecks the exact chain against its configured active environment, so a
stale or tampered client catalog cannot register an unsupported identity.

## Connection and invalidation controls

Interactive connect validates the current chain before opening an account
permission prompt, validates the permission response, then reads a coherent
`eth_chainId` / `eth_accounts` / `eth_chainId` snapshot. If the account returned
by the permission gesture is silently replaced before the stable snapshot, the
attempt fails. Restore uses only noninteractive `eth_accounts` and
`eth_chainId` reads.

The adapter:

- generates application-owned connection IDs and never reuses any previously issued ID;
- treats the provider's first authorized account as the provider-designated
  active account, while keeping every normalized account explicit and
  chain-qualified;
- invalidates the connection on every `accountsChanged` event;
- publishes a new normalized connection on a supported `chainChanged` event,
  requiring a new chain-bound ownership challenge;
- invalidates on unsupported/malformed chain changes and provider disconnect;
- compares account and chain state immediately before and after signing, so an
  in-flight event or a silently changed provider snapshot cannot return an
  accepted proof and invalidates the stale normalized connection; and
- removes the exact three EIP-1193 listeners on adapter disposal.

Injected providers do not have a standard EIP-1193 disconnect request. Product
disconnect therefore revokes the local normalized connection and future
application use without inventing a vendor method. Browser/provider permission
revocation remains provider UI behavior.

## KAN-56 ownership handoff

`HttpEvmWalletOwnershipClient` uses the authenticated same-origin endpoints:

1. `POST /api/v1/wallets/ownership-challenges` with the selected CAIP-2 chain
   and canonical address.
2. `personal_sign` with exactly `[serverMessage, serverAddress]`.
3. `POST /api/v1/wallets/ownership-proofs` with the KAN-56
   `EVM_EIP191_EOA` DTO.

Both mutations use `credentials: same-origin`, `cache: no-store`, redirect
errors, the session CSRF cookie/header binding, and bounded JSON responses. The
challenge parser requires the expected account, environment, origin/URI,
version, decimal chain reference, nonce, expiration, request ID, registry
version, and registry fingerprint before signing. The client does not create or
rewrite a nonce or SIWE message.

The adapter accepts only a canonical 65-byte hexadecimal EOA signature and
lowercases it for KAN-56's strict HTTP body. It records a successfully returned
challenge ID locally so the same challenge is not prompted twice. The API
remains responsible for signature verification, expiry, replay prevention,
account binding, encrypted metadata, and atomic registration.

## Redaction boundary

No connector file invokes `console`, accepts a logger, stringifies a provider
error, or attaches the raw error as `cause`. Known EIP-1193 codes map to fixed
application codes/messages; all other provider failures map to one generic
message. Lifecycle events contain normalized connection state or a fixed public
error only. Consumer callback failures are contained without logging provider
data.

EIP-6963 announced names and icons are validated only as bounded required
metadata and discarded. Display labels and supported-network names are
application-owned.

## Local acceptance evidence

| Jira acceptance / requirement                  | Automated local evidence                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| MetaMask and Coinbase connect independently    | Separate announced provider capabilities and adapter instances produce distinct connector IDs, accounts, and calls.           |
| Selecting one never silently uses the other    | Opaque exact selection, no automatic selection, no `window.ethereum`, provider/UUID deduplication, and permission-race tests. |
| Unsupported networks are not supported funding | Canonical network-policy tests plus connect and `chainChanged` fail-closed cases.                                             |
| Ownership challenge handoff                    | Exact KAN-56 response parsing, SIWE `personal_sign` parameters, CSRF request DTOs, and registration-result correlation.       |
| Duplicate connection prevention                | Repeated selection/connect and concurrent permission-request tests.                                                           |
| Account, chain, and disconnect invalidation    | Event, in-flight signing race, local disconnect, provider disconnect, and exact-listener-cleanup tests.                       |
| Strict provider-error redaction                | Secret-bearing rejection/disconnect fixtures never appear in public errors or events.                                         |

Focused local commands:

```powershell
npm test --workspace @crypto-lending/web -- test/eip1193-adapter.test.ts test/eip6963-discovery.test.ts test/eip1193-networks.test.ts test/eip1193-ownership.test.ts
npm run typecheck --workspace @crypto-lending/web
npm run lint --workspace @crypto-lending/web
```

## Honest remaining gates

- No real MetaMask or Coinbase extension was installed or invoked. KAN-225
  desktop cases and the KAN-227 security/legal decision remain `NOT_RUN` or
  pending until authorized evaluators execute them with dedicated test wallets.
- Real evidence must confirm EIP-6963 announcement identity, permission UX,
  account/chain/disconnect ordering, signature parameter behavior, extension
  lock/unlock, reload, revocation, and exact listener behavior for approved
  browser and extension versions.
- Coinbase branding, Base-account succession, EOA-only behavior, extension
  telemetry/network observations, privacy disclosures, and terms still require
  the named review. This connector does not initialize the Coinbase SDK or a
  Base smart account.
- MetaMask Mobile is not an injected-browser case and remains assigned to the
  separately gated WalletConnect path. Older extensions that do not announce
  through EIP-6963 are intentionally unavailable; a legacy fallback needs a
  separate ambiguity/security decision.
- KAN-37 live identity/session behavior, KAN-56 enabled configuration and key
  custody, deployed HTTPS/origin behavior, distributed throttling, and real
  backend registration remain external gates.
- KAN-60 still owns the product wallet-management UI, durable multi-wallet
  registry, refresh presentation, disconnect history, and indexing lifecycle.
- KAN-56 currently verifies EVM EOAs only. ERC-1271/6492 contract-wallet support
  remains fail-closed and needs a separately approved RPC-backed design.

These gates block a production/public-launch completion claim. They do not
block review of this offline connector and KAN-56 handoff implementation.
