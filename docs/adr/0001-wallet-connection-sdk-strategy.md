# ADR 0001: Wallet connection SDK strategy

- Status: Proposed; restricted local harness implemented, interactive and public approvals pending
- Date: 2026-08-18
- Jira: KAN-55
- Decision owners: Wallet platform and security

## Context

The lending application must connect several externally managed wallets without
silently substituting one wallet for another, coupling loan logic to a vendor
SDK, or treating a restored transport session as proof that the current user
controls an address. The initial target set is MetaMask, Phantom, Coinbase
Wallet, and WalletConnect-compatible wallets.

The product also needs more than one concurrent wallet connection. An EVM
address and a Solana address are not interchangeable identities, and a user may
connect several accounts from the same wallet. Every account therefore has to
remain qualified by chain namespace, chain, wallet, and connector.

This ADR records a proposed implementation direction. It becomes Accepted only
after the real extension and mobile cases in the
[manual validation runbook](../wallets/manual-validation-runbook.md) have been
executed and the resulting evidence has been approved.

The version-bound threat model, preliminary finding register, rollback drill,
network-observation template, and independent decision record are in the
[KAN-223 security review packet](../wallets/security-review/README.md).

## Decision

### Own the normalized connection model

The application will own a small wallet-adapter boundary and a
chain-qualified connection registry. Lending modules will consume that boundary
instead of importing wallet SDKs directly. A connection identity contains:

- a CAIP-2-style chain ID, such as `eip155:11155111` or an approved Solana
  cluster identifier;
- the exact wallet address;
- a stable application connection ID and connector ID; and
- an explicitly selected account, rather than an assumption that `accounts[0]`
  is active.

SDK-specific providers, events, and transport persistence remain inside
adapters. Vendor SDK storage is inventoried and cleared through the connector on
logout; it is never treated as application authorization. The
registry may hold several active connections at once and must not overwrite one
connection when another connector announces itself.

### EVM connection layer

Use Wagmi 3 with Viem 2 as the EVM connection and RPC layer. At the research
snapshot, the reviewed releases were `wagmi@3.7.6` and `viem@2.55.18`. Lock
resolved versions and review release notes before upgrades.

- Enable [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) discovery and show
  the user the discovered providers. Do not select whichever provider happens
  to own `window.ethereum`. Treat announced names, icons, and reverse-DNS values
  as presentation metadata, not proof of authenticity.
- Discover MetaMask desktop through the injected connector's EIP-6963 provider
  list and require explicit user selection. Do not install or initialize
  `@metamask/connect-evm@2.1.1`: review found that its connect permission request
  appends Ethereum mainnet (`0x1`) even when the dapp supplies only testnet chain
  IDs. That violates the current evaluation authorization, and its custom
  license is not approved. MetaMask Mobile is evaluated only through the
  separately gated WalletConnect connector.
- Use Wagmi's explicit
  [Coinbase Wallet connector](https://wagmi.sh/react/api/connectors/coinbaseWallet)
  with `{ preference: { options: 'eoaOnly' } }` for this
  external-wallet flow. A Base smart account is a different account type and
  requires a separate product and risk decision. The selected Coinbase SDK path
  has no verified telemetry-off control, so network behavior requires testing
  and privacy/security review.
- Use Wagmi's explicit
  [WalletConnect connector](https://wagmi.sh/react/api/connectors/walletConnect)
  with a project ID, application metadata, the Wagmi-configured chain allowlist,
  `showQrModal: false`, and `telemetryEnabled: false`. Handle its `display_uri`
  through an application-owned QR/deeplink surface, inspect the scopes actually
  approved by the wallet, and explicitly handle stale chains and session events.
  Request no required methods/events; request only optional `personal_sign` and
  `wallet_switchEthereumChain` methods plus `accountsChanged` and `chainChanged`
  events.
  Supply an application RPC transport for every supported chain and origin-lock
  the public project ID in Reown Cloud. In the restricted harness, omit this
  connector unless both `VITE_WALLETCONNECT_TERMS_ACCEPTED=true` and a valid
  32-hex project ID are supplied. The literal flag acknowledges the current
  package/service terms for local evaluation; it is not approval for public use.
- Normalize restored Wagmi and vendor state through an application-owned
  persistence boundary. Multiple active EVM connections are supported by Wagmi's
  [`useConnections`](https://wagmi.sh/react/api/hooks/useConnections); lending
  code must still reference the application's normalized connection ID.

`window.ethereum` is a legacy fallback only when EIP-6963 discovery is
unavailable. Provider access follows [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193),
including exact listener cleanup and handling for account changes, chain
changes, disconnects, user rejection, unauthorized methods, pending requests,
and disconnected chains.

### Phantom connection layer

Use Solana Wallet Standard directly for the restricted Solana adapter. The
locked harness uses `@wallet-standard/app@1.1.1`,
`@wallet-standard/base@1.1.1`, `@wallet-standard/features@1.1.1`, and
`@solana/wallet-standard-features@1.4.0`. The heavier Solana Kit/React/plugin
candidates are not installed because this harness needs discovery, connection,
events, and signing rather than RPC or transaction construction. The official
[frontend guide](https://solana.com/docs/frontend),
[React wallet hooks](https://solana.com/docs/frontend/react-hooks), and
[Next.js recipe](https://solana.com/docs/frontend/nextjs-solana) define the
chosen integration path.

- Discover Phantom through Wallet Standard and normalize its account-change,
  disconnect, reconnect, and signing features into the application adapter.
  Direct `window.phantom.solana` access is diagnostic fallback only; never use
  the legacy, collision-prone `window.solana` global as wallet identity.
- Feature-detect Wallet Standard `solana:signIn`. Fall back to signing the exact
  canonical SIWS message only when that feature is unavailable.
- Keep Phantom EVM support and EVM wallet selection outside this adapter so a
  Phantom announcement cannot shadow the explicit EVM connectors.
- Treat injected Phantom as unavailable in insecure origins and iframes. Use
  HTTPS in deployed test environments and localhost for local development.
- Mobile Safari and Chrome do not receive the injected provider directly. A
  user-initiated Phantom Browse universal link reopens the exact HTTPS dapp URL
  inside Phantom's in-app browser, where Wallet Standard can connect.
- Treat Solana cluster as server-owned environment policy. The injected
  provider does not expose a dependable chain-switch/change contract, so SIWS,
  RPC, program, and mint allowlists must all enforce the configured cluster.

Do not install `@phantom/react-sdk` as the platform connector. It creates a
second vendor-specific state model, and its deeplink provider redirects the
current page to Phantom's browser rather than providing a direct external mobile
provider. It remains an option only if embedded/social Phantom wallets become a
separately approved requirement.

### Ownership challenges are server-issued

A connected session is not authentication. The API will issue a one-time,
short-lived challenge bound to the expected domain, URI, chain, address, and
operation. For SIWE and legacy SIWS, the adapter signs the exact server-issued
message. For Wallet Standard `solana:signIn`, it passes structured server-issued
input and returns the wallet-constructed signed-message bytes, account, public
key, signature bytes, and signature type. The API verifies the complete result
against the stored input and consumes it before creating an authenticated
session.

Binary Solana results remain `Uint8Array` inside the adapter and use explicit,
bounded, unpadded base64url fields at the JSON boundary. Neither browser JSON
coercion nor unbounded vendor payloads are accepted as a wire format.

- EVM uses [Sign-In with Ethereum (ERC-4361)](https://eips.ethereum.org/EIPS/eip-4361).
  EOA signatures are verified under ERC-191 and contract wallets under ERC-1271.
- Solana prefers Wallet Standard `solana:signIn` and otherwise uses the
  [Sign-In with Solana](https://github.com/phantom/sign-in-with-solana) canonical
  message with server-side Ed25519 verification. The returned account may differ
  from optional input under the standard; this product rejects that mismatch.
- The client never invents or reuses a nonce. A signature proves control of a
  key for the signed message; it does not prove legal identity or asset
  ownership beyond that key.

### Session lifecycle

Adapters must make restoration explicit. UI state starts as `restoring`, not
`disconnected`, until each SDK has completed its asynchronous restore attempt.
The application responds to account, chain, session-update, session-expiry, and
disconnect events by invalidating any address- or chain-bound authorization and
requiring a fresh server challenge when appropriate.

Every adapter operation that signs or disconnects targets an explicit
application connection ID. Approved chain/method/event scopes are part of the
normalized session. WalletConnect session updates are append-only under the
current protocol, but every update still reconciles the stored approved scopes.
Session deletion/disconnect clears them and blocks the affected action
immediately.

WalletConnect sessions are persisted by the client and have protocol-defined
lifecycle events including `session_update`, `session_delete`, and
`session_expire`. The Ethereum provider can normalize an expired session into
delete/disconnect before a raw expiry event reaches the application, so the
adapter accepts that lifecycle sequence rather than depending on one raw event.
It must not infer authentication from a restored session. See the official
[session-event specification](https://specs.walletconnect.com/2.0/specs/clients/sign/session-events)
and [dapp usage guide](https://docs.reown.com/advanced/api/sign/dapp-usage).

### Presentation and vendor boundaries

Reown AppKit remains unused as a presentation layer and is not the source of
truth for connection state. It is nevertheless a hard-installed, custom-licensed
dependency of `@walletconnect/ethereum-provider@2.23.10`. Its documented
[multiwallet-linking feature](https://docs.reown.com/appkit/features/multiwallet-linking)
requires a paid plan, while the normalized registry is a core product
capability. Avoiding reliance on that presentation layer keeps headless tests
and future UI changes independent of commercial modal features.

The WalletConnect provider's default QR-modal path uses Reown AppKit. Keeping
`showQrModal: false` prevents the lab from invoking that modal and lets a small
application-owned surface render `display_uri`; it does not remove AppKit from
the installed tree or avoid its terms/notice obligations. If the team later
adopts the branded modal, record the changed runtime surface without moving
connection identity into AppKit.

Coinbase currently describes the Base Account SDK as the successor to Coinbase
Wallet SDK and recommends a transition period in which both experiences may be
shown. For KAN-55, "Coinbase Wallet" means an existing external EOA selected
through the Coinbase connector. Base Account onboarding is deferred to a
separate decision. See Coinbase's official
[migration guide](https://docs.base.org/base-account/guides/migration-guide).
Current Base-app help guidance about mobile connection changes may not describe
the WalletLink QR behavior implemented by the exact locked Coinbase Wallet SDK
4.3.7. Do not pre-classify desktop-to-mobile QR as supported or unsupported.
Validate the locked SDK against the exact Coinbase/Base mobile client version and
account/app mode, then record whether QR is presented, pairing/approval/return
behavior, and any sanitized failure or recovery result. Also validate
same-device handoff and the Base in-app explorer when the test environment
permits them. Compare the observation with the current
[connection guidance](https://help.coinbase.com/en/wallet/other-topics/mobile-app-sign-in-discontinued)
and the locked SDK implementation; the observed exact-version result controls
this compatibility record. Physical-iOS same-device coverage remains deferred to
the separately approved HTTPS preview described below.

Set WalletConnect `telemetryEnabled` to `false` unless privacy and security
approve the exact metadata, retention, disclosures, and vendor terms. Coinbase
has no verified telemetry-off control in the selected EOA path. No configuration
option guarantees that every SDK, extension, transport, relay, RPC, or
operational request is disabled; verify the locked runtime on the network and
treat vendor metadata exposure as possible.

### Restricted implementation boundary

The real-package harness lives in `tools/wallet-lab` with a separate lock and is
not a root npm workspace. Root installs and product builds do not include it, and
the harness rejects a production build. Its current authorization is limited to
two evaluators, a loopback-only development server, approved testnets, dedicated
test wallets, and ownership-message signing. It has no transaction action.

WalletConnect QR can pair a physical phone while the dapp remains on desktop
loopback. Android may exercise same-device loopback through `adb reverse`, and
an iOS Simulator may share host loopback when its environment supports that
mapping. Physical-iOS Coinbase same-device handoff and Phantom Browse require an
externally reachable HTTPS origin; they are not covered by this local phase and
remain deferred to a separately approved secured preview. LAN binding and
tunnels are not substitutes for that approval.

## Consequences

### Benefits

- Loan and account modules depend on one stable, testable boundary instead of
  four vendor APIs.
- Multiple connections remain distinct across wallets and chains.
- MetaMask and Coinbase cannot silently replace one another through the global
  injected-provider race.
- Mobile transport, session restoration, and authentication are modeled as
  separate concerns.
- A wallet modal or SDK can be replaced without rewriting lending workflows.

### Costs and limitations

- We maintain thin adapters and a cross-wallet conformance suite.
- Real extension and mobile testing cannot be replaced by mocked provider tests.
- WalletConnect requires project configuration and relay availability.
- Native MetaMask Connect is excluded because it forces an Ethereum-mainnet
  permission and has a package-specific license. WalletConnect Ethereum Provider
  2.23.10 remains installed only in the isolated, explicitly terms-gated lab and uses the
  [WalletConnect Community License](https://github.com/WalletConnect/walletconnect-monorepo/blob/2d064b8/providers/ethereum-provider/LICENSE.md).
  Its hard-installed `@reown/appkit@1.8.19` dependency separately uses the Reown
  Community License. Legal/security must approve both exact licenses, notices,
  terms, and provenance before production
  release. The WalletConnect terms include authenticated-user and built-in-RPC
  commercial thresholds. Because this lending product performs SIWE, planning
  should assume authenticated-user terms may apply until counsel confirms
  otherwise; a plain unauthenticated self-custodial connection is not enough to
  make that determination.
- The lock scopes `axios` to 1.18.0 for the optional AppKit/Base Account/CDP path,
  and the 2026-08-18 npm-audit snapshot reports zero known vulnerabilities. This
  is a point-in-time database result, not a zero-risk finding; re-run audit and
  tests after any override, lock, import, or connector-config change.
- Coinbase/Base branding and SDK succession are active changes and need a
  release-by-release check.
- Vendor transport state can persist in browser storage. Logout and revocation
  must clear normalized authorization even when an SDK later restores transport.

## Rejected alternatives

### Native MetaMask Connect in the restricted testnet lab

Rejected for the current scope because reviewed 2.1.1 code appends Ethereum
mainnet to its permission request even when only testnet chain IDs are supplied.
Its custom package license also remains unapproved. Extension support stays on
explicit EIP-6963 discovery, and mobile MetaMask uses the separately gated
WalletConnect path.

### A single `window.ethereum` integration

Rejected because multiple extensions race to populate the same global and
wallet identity becomes ambiguous. It also does not solve QR or mobile sessions.

### Reown AppKit as the authoritative multiwallet store

Rejected as the core boundary because the required multiwallet feature is tied
to a paid plan and would place durable application identity behind a UI vendor.
AppKit can still be evaluated later as a replaceable modal.

### Four SDKs imported directly into product components

Rejected because event semantics, restoration, and address selection would
spread into lending workflows and make future SDK replacement expensive.

### Embedded wallets as an automatic fallback

Rejected for this scope. Creating a new embedded or smart wallet when the user
intended to connect an external wallet changes custody, recovery, disclosure,
and identity assumptions.

## Acceptance gates

Before changing this ADR to Accepted:

1. Execute every required case in the manual validation runbook on real test
   wallets and retain redacted evidence.
2. Confirm that all four compatibility-matrix rows pass extension/mobile,
   event, restoration, disconnect, and signing cases relevant to that wallet.
3. Complete security and license review of exact locked SDK versions.
4. Approve WalletConnect project configuration, allowed origins, and telemetry
   disclosures.
5. Execute physical-iOS same-device/Phantom Browse cases only after a secured
   HTTPS preview receives separate approval; do not count desktop QR, Android
   `adb reverse`, or simulator loopback as coverage for those paths.
6. Record any exception in a follow-up ADR rather than weakening the adapter
   contract inside a product component.

## Research freshness

The linked official specifications, vendor documentation, and package releases
were reviewed on 2026-08-18. Version and commercial-plan details are a snapshot,
not a floating production guarantee.
