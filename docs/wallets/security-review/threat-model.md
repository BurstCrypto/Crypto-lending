# Wallet validation lab threat model

This is the coordinator-prepared threat model for KAN-223. Severity and final
disposition belong to the independent reviewer.

## Scope and security boundary

The executable candidate is the isolated real-wallet harness under
tools/wallet-lab at commit 871adad4a6671bc1ea58e91893977ead738734ae and lock
SHA-256 D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9.
It is a loopback-only development server with no transaction action. It may use
dedicated test wallets on Sepolia, Base Sepolia, and Solana devnet.

The separate apps/web/internal/wallet-lab route is a mock-adapter demonstration
behind server-side Basic authentication. It does not load the isolated
real-wallet dependency lock and is not evidence that the real-wallet harness is
access-controlled or deployable.

Out of scope and prohibited are public hosting, LAN/tunnel exposure, mainnet,
production accounts, funded wallets, customer data, real assets, transaction
submission, and application-session issuance.

## Assets

| Asset                            | Required property                                    | Handling                                                             |
| -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Wallet seed/private key          | Never enters the dapp, repository, logs, or evidence | Wallet-owned only; dedicated test wallets                            |
| Pairing URI/session topic        | Confidential and short-lived                         | Rendered in memory; never exported or logged                         |
| Raw ownership signature/message  | Not retained as evidence                             | Verified locally, then reduced to outcome metadata                   |
| Selected chain-qualified account | Integrity and isolation                              | Compared with approved connector, chain, and session scope           |
| Connection/session state         | Must not become application authentication           | Explicit restore and fresh proof boundary                            |
| Project ID                       | Public identifier but abuse-sensitive                | Vite client value; origin restrictions and usage monitoring required |
| RPC/relay metadata               | Privacy-sensitive                                    | Allowlisted destinations; sanitized network inventory pending        |
| Evidence record                  | Complete, attributable, and secret-free              | Structured export plus external run metadata and reviewer inspection |
| Review credentials               | Server-only for the mock route                       | Never exposed through VITE-prefixed variables                        |

## Threat actors

- a malicious or compromised injected extension/provider;
- a wallet returning malformed, expanded, stale, or unexpected session scope;
- a compromised or observing RPC, relay, verification, or wallet service;
- a dependency or supply-chain compromise;
- another local process, browser extension, or person on the evaluator machine;
- an evaluator accidentally capturing secrets in logs, screenshots, or evidence;
- a stale browser/vendor session being mistaken for current authorization; and
- a future deployer bypassing the restricted-local boundary.

## Trust and data-flow boundaries

    Dedicated test wallet
      -> injected extension or mobile wallet
      -> EIP-1193 / Wallet Standard / WalletConnect provider
      -> loopback wallet lab
          -> configured HTTPS Sepolia/Base Sepolia RPC
          -> WalletConnect relay and verification service when separately enabled
          -> Coinbase WalletLink relay for the selected SDK path
      -> sanitized evidence export
      -> Jira/GitHub review record after human inspection

The browser, every extension, every wallet, every provider object, and every
network service is outside the application trust boundary. Wallet names, icons,
reverse-DNS identifiers, global browser properties, restored transport state,
and vendor persistence are not authentication signals.

## Data-flow and storage inventory

| Flow/store                  | Data                                                                  | Persistence                        | Existing control                                                      | Required evidence                      |
| --------------------------- | --------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| Injected provider discovery | Self-reported provider metadata                                       | Extension/browser managed          | Explicit connector selection; EIP-6963 enabled                        | D1 multi-extension result              |
| EVM connect/events          | Accounts, chain IDs, error codes                                      | Wagmi/vendor managed               | Approved testnet checks; normalized UI state                          | Ordered D1/D3/P1 events                |
| WalletConnect pairing       | Pairing URI and session scope                                         | Vendor browser storage may persist | Application-owned QR; terms gate; scope inspection                    | WC01-WC11 and storage inspection       |
| Solana discovery/signing    | Wallet account, message, signature                                    | Wallet/browser managed             | Wallet Standard; devnet policy; local signature verification          | PH01-PH08                              |
| Ownership proof             | Exact local message and signature                                     | In memory only by design           | Chain/account/message validation                                      | C10-C13                                |
| RPC                         | Public account/chain queries and transport metadata                   | Provider-specific                  | HTTPS URLs and CSP destination allowlist                              | Sanitized host/request-class inventory |
| Vendor telemetry/relay      | Device, app, transport, project, and operational metadata may be sent | Vendor-specific                    | WalletConnect telemetry disabled; Coinbase has no verified off switch | Network template and privacy review    |
| Evidence export             | Event kind, outcome, connector, chain, time                           | User-downloaded file               | Fixed allowlists; no address/signature/pairing fields                 | Human secret scan and run metadata     |
| Mock-route Basic auth       | Username/password                                                     | Server environment                 | Constant-time comparison; no-store headers                            | Local access-control tests only        |

Browser/vendor storage keys and deletion semantics have not yet been fully
inventoried. Disconnect currently clears live application state but may leave
pairing or extension authorization in vendor-managed storage. Use a dedicated
browser profile and record the storage/permission state before and after logout.

## Preliminary risk and finding register

The coordinator priority is not an AppSec severity. The independent reviewer
must assign severity, validate mitigation evidence, and decide whether each item
is Closed, Accepted Exception, or Open.

| ID      | Scenario                                                          | Existing mitigation                                                                   | Residual risk / missing evidence                                                                                  | Owner               | Coordinator status                   |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------ |
| SEC-001 | Spoofed injected wallet is selected as a trusted brand            | EIP-6963 discovery and explicit user selection; metadata is documented as untrusted   | A malicious extension can self-report convincing metadata; D1 evidence and user-copy review required              | Wallet/frontend     | Open evidence                        |
| SEC-002 | Mainnet, transaction, or unapproved method becomes available      | Testnet allowlists, no transaction UI, WalletConnect post-approval scope rejection    | Real injected/Coinbase behavior and network traffic are not yet captured                                          | Wallet/frontend     | Open evidence                        |
| SEC-003 | Restored provider session becomes application authentication      | No automatic reconnect; explicit restore; proof is separate from connection           | Vendor persistence and reload behavior require real-wallet testing; no server nonce/session exists in this ticket | Identity + wallet   | Open evidence                        |
| SEC-004 | WalletConnect expands or changes account/chain/method/event scope | Settled/restored/update scope inspection fails closed and disconnects                 | Delete, expire, mobile-return, and wallet-specific normalization require real execution                           | Wallet/frontend     | Open evidence                        |
| SEC-005 | Pairing URI, topic, full address, provider, or signature leaks    | No console logging; application-owned QR; sanitized fixed-schema export               | Screenshots, browser tools, wallet UI, or manual notes can still leak data                                        | Test lead           | Open procedural control              |
| SEC-006 | Coinbase or vendor telemetry discloses metadata                   | CSP destination allowlist; WalletConnect telemetry flag off                           | Coinbase has no verified telemetry-off control; no network inventory or privacy decision exists                   | Security/privacy    | Release blocker                      |
| SEC-007 | Logout leaves reusable vendor or extension state                  | Live state disconnect and dedicated-profile instruction                               | Browser storage, extension permissions, and pairing cleanup are not inventoried or verified                       | Wallet/frontend     | Open finding                         |
| SEC-008 | One EVM wallet mutates or replaces another                        | Product adapter has chain-qualified IDs; lab separates Solana and EVM                 | Lab supports only one active EVM connector; concurrent EVM isolation is explicitly unvalidated                    | Wallet architecture | Release blocker / exception required |
| SEC-009 | Deeplink/QR return is hijacked, stale, or mis-bound               | Application-owned WalletConnect URI surface and exact-origin metadata                 | Physical-iOS and approved HTTPS return paths are deferred; mobile evidence absent                                 | Mobile + security   | Deferred release blocker             |
| SEC-010 | Dependency/license/supply-chain change invalidates assumptions    | Isolated exact lock, full SPDX, SHA-256 snapshot, zero-vulnerability audit snapshot   | Independent reconciliation, custom-license clearance, and runtime reachability review are pending                 | OSS/security        | Release blocker                      |
| SEC-011 | Local lab is exposed to another host/user                         | Exact 127.0.0.1 bind, strict port/host guard, development-only gate, no build/preview | Another local process or malicious browser extension remains in the local trust environment                       | Test lead           | Controlled residual                  |
| SEC-012 | Evidence is incomplete, altered, or attributed to the wrong build | Structured sanitized events and frozen source/lock identity                           | Existing event export lacks full run/device/wallet metadata and is not signed; evidence tooling update required   | Test lead           | Open finding                         |
| SEC-013 | Expired/deleted session retains signing ability                   | Connector state and disconnect paths are present                                      | Direct session-expire/delete subscription and real TTL evidence are absent                                        | Wallet/frontend     | Open finding                         |

## Signing and authentication boundary

The harness proves only that a selected test wallet can sign the displayed local
message and that the candidate can perform local/reference verification. It must
not issue an authenticated API session or describe restored transport state as
login. The current lab creates its nonce/message in the browser solely to
exercise the proof shape; that client-generated value is not a production
challenge. KAN-56 must provide a server-issued, single-use nonce,
domain/origin/chain/user binding, expiry, replay prevention, signature
verification, and atomic nonce consumption before any authenticated API session
is created.

## Required rollback and kill switches

- VITE_WALLET_LAB_ENABLED must be literal true or the real lab remains closed.
- VITE_WALLETCONNECT_TERMS_ACCEPTED and a valid project ID are both required to
  load the WalletConnect connector.
- The Vite guard rejects builds, previews, host changes, port changes, and
  non-loopback origins.
- Removing the isolated tools/wallet-lab install does not change root workspace
  builds because the package is not a root npm workspace.
- A reviewer must execute and record the drill in rollback-runbook.md; the
  presence of flags alone is not evidence that rollback was tested.

## Independent-review exit

KAN-223 cannot move to In Review until the independent reviewer has:

- classified every row above and added any missing findings;
- confirmed that no Critical or High finding remains open;
- reviewed real-wallet, network, storage/logout, and rollback evidence;
- recorded Approved, Conditional, or Rejected against the exact commit and lock;
  and
- supplied conditions, decision expiry, and re-review triggers.
