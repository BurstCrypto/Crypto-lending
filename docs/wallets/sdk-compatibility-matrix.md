# Wallet SDK compatibility matrix

- Jira: KAN-55
- Status: Proposed; restricted local harness implemented, interactive/public approval pending
- Research snapshot: 2026-08-18
- Target networks: Ethereum Sepolia, Base Sepolia, and Solana devnet

## Evidence legend

- **D**: behavior documented by an official specification, vendor document, or
  official source repository. It is not runtime verification.
- **A**: normalized value validation for chain/address identity, selected
  account, approved scopes, challenge targeting, and signature-result
  correlation. It does not cover SDK lifecycle or vendor events.
- **M**: real-wallet manual validation is required.

No row is approved solely from documentation or mocks. The dated results sheet
from the [manual validation runbook](manual-validation-runbook.md) is the
approval record.

## Decision summary

| Target          | Proposed integration                                                  | Provider/transport                                                         | Desktop                      | Mobile                                                                         | Ownership proof                                               | Current disposition                                              |
| --------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| MetaMask        | Wagmi injected connector with EIP-6963; WalletConnect only for mobile | EIP-1193 injection or separately gated WalletConnect                       | Extension **D/M**            | Desktop-loopback QR **D/M**; physical-iOS same-device deferred                 | Local `personal_sign`; production SIWE/ERC-1271 later **D/M** | Native MetaMask Connect rejected for forced mainnet permission   |
| Phantom         | Direct Solana Wallet Standard packages                                | Wallet Standard injection; Phantom Browse only where loopback is reachable | Extension **D/M**            | Android `adb reverse`/simulator smoke; physical-iOS Browse deferred **D/M**    | `solana:signIn`, with local message fallback **D/M**          | Local extension path implemented; public/mobile approval pending |
| Coinbase Wallet | Wagmi `coinbaseWallet`, EOA-only preference                           | EIP-1193; extension/same-device mobile transport                           | Extension **D/M**            | Android mapped/simulator smoke; physical-iOS same-device deferred **D/M**      | Local `personal_sign`; production SIWE later **D/M**          | Proceed locally, with Base-branding and telemetry caveats        |
| WalletConnect   | Terms-gated Wagmi `walletConnect`                                     | Restricted WalletConnect Sign session exposed as EIP-1193                  | Application-owned QR **D/M** | Physical wallet may scan desktop QR; same-device physical iOS deferred **D/M** | Optional `personal_sign` only **D/M**                         | Local only after explicit terms flag and valid project ID        |

Only the listed normalized value invariants are covered by **A**. Restoration,
event ordering, expiry, listener cleanup, multi-wallet isolation, and vendor
runtime behavior remain **M** until the real-wallet matrix is signed.

## MetaMask

### Reviewed choice

- Wagmi 3 injected connector with EIP-6963 for explicit extension discovery and
  user selection.
- `window.ethereum` only as a legacy fallback.
- No `@metamask/connect-evm` installation or native connector. Review of 2.1.1
  found that its connect permission request appends Ethereum mainnet (`0x1`) to
  supplied testnet IDs, violating the testnet-only authorization; its custom
  license is also unapproved.
- MetaMask Mobile participates only as a WalletConnect-compatible client after
  the WalletConnect terms/project-ID gate is satisfied.

### Expected behavior

| Capability                | Expected result                                                                                      | Evidence                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account access            | `eth_requestAccounts`; empty `accountsChanged` means no exposed account                              | [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) **D/M**                                                                                              |
| Chain changes             | Hex chain ID through `chainChanged`; unsupported/mainnet state is rejected                           | [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) **D/M**                                                                                              |
| Multiple extensions       | Announcements collected through EIP-6963; user selects MetaMask explicitly                           | [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) **D/M**                                                                                              |
| Session restore           | No automatic application authentication; restored provider state is reconciled explicitly            | [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) **D/M**                                                                                              |
| Desktop without extension | No native MetaMask path; use separately gated application-owned WalletConnect QR                     | [WalletConnect section](#walletconnect) **D/M**                                                                                                          |
| Mobile                    | MetaMask Mobile scans desktop-loopback WalletConnect QR; same-device physical-iOS return is deferred | [WalletConnect section](#walletconnect) **D/M**                                                                                                          |
| Disconnect/errors         | Handle 4001, 4100, 4200, 4900, 4901, and already-pending request behavior                            | [provider API](https://docs.metamask.io/metamask-connect/evm/reference/provider-api/) **D/M**                                                            |
| Signing                   | Sign exact server-issued SIWE message; validate domain, nonce, chain, expiry, and signature on API   | [MetaMask SIWE guide](https://docs.metamask.io/metamask-connect/evm/guides/sign-data/siwe/), [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) **D/M** |

### Known limitations

- A reconnect can expose several previously authorized accounts. Never infer
  the user's selected account from the first array element.
- Provider names, icons, reverse-DNS values, and `isMetaMask` are self-reported
  and are not authentication signals.
- Remote-session time-to-live is an SDK implementation detail. Listen for
  lifecycle events instead of encoding an assumed duration.
- A physical phone can scan a WalletConnect QR while the dapp remains on desktop
  loopback. That does not validate native MetaMask Connect or same-device
  physical-iOS return behavior.

## Phantom

### Reviewed choice

- Solana Wallet Standard directly through `@wallet-standard/app@1.1.1`,
  `@wallet-standard/base@1.1.1`, `@wallet-standard/features@1.1.1`, and
  `@solana/wallet-standard-features@1.4.0`.
- Solana Kit, React, and plugin candidates are not installed. The restricted
  harness needs discovery, account events, connection, and ownership-message
  signing, not RPC or transaction construction.
- Feature-detected Wallet Standard capabilities instead of a Phantom-specific
  application state store.
- Direct `window.phantom.solana` only as a diagnostic fallback. Never identify
  the wallet through legacy `window.solana`.

### Expected behavior

| Capability      | Expected result                                                                                           | Evidence                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Injection       | Provider is available only in supported secure top-level contexts                                         | [provider detection](https://docs.phantom.com/solana/detecting-the-provider) **D/M**                                                                                                                    |
| Connection      | Wallet Standard discovers a user-approved Solana account and normalizes its state                         | [Solana React hooks](https://solana.com/docs/frontend/react-hooks), [Phantom connection](https://docs.phantom.com/solana/establishing-a-connection) **D/M**                                             |
| Account changes | Changed Wallet Standard accounts invalidate stale ownership proof; direct provider emits `accountChanged` | [Phantom connection/events](https://docs.phantom.com/solana/establishing-a-connection) **D/M**                                                                                                          |
| Session restore | Trusted reconnect is non-interactive; UI remains pending/reconnecting until resolved                      | [Solana React hooks](https://solana.com/docs/frontend/react-hooks), [Phantom connection](https://docs.phantom.com/solana/establishing-a-connection) **D/M**                                             |
| Mobile          | User-initiated Browse link opens the HTTPS page inside Phantom's browser, where injection can proceed     | [Browse method](https://docs.phantom.com/phantom-deeplinks/other-methods/browse), [mobile support](https://help.phantom.com/hc/en-us/articles/29995498642195-Connect-Phantom-to-an-app-or-site) **D/M** |
| Disconnect      | Live state is cleared; dapp disconnect does not itself revoke Phantom Trusted Apps permission             | [Phantom connection](https://docs.phantom.com/solana/establishing-a-connection) **D/M**                                                                                                                 |
| Signing         | Prefer `solana:signIn`; otherwise sign the exact canonical SIWS message with `signMessage`                | [SIWS reference](https://github.com/phantom/sign-in-with-solana), [message signing](https://docs.phantom.com/solana/signing-a-message) **D/M**                                                          |

### Known limitations

- Injected Phantom is not available on HTTP production origins or inside an
  iframe. Tests must use HTTPS or localhost in a top-level tab.
- Mobile Safari/Chrome cannot connect directly. The supported web flow reopens
  the page inside Phantom, so return/navigation state needs explicit testing.
  Android may use `adb reverse` for loopback testing; physical-iOS Phantom Browse
  remains deferred to a separately approved HTTPS preview and is not covered by
  simulator or QR evidence.
- Do not implement the raw `/ul/v1/connect` encrypted deeplink protocol for the
  web MVP; Wallet Standard inside Phantom Browse is the simpler supported path.
- Phantom does not expose a dependable injected cluster-switch event. Enforce
  `solana:mainnet`, `solana:devnet`, or `solana:testnet` as server-owned policy
  through the challenge and infrastructure allowlists.
- Solana addresses are case-sensitive. Parse and re-encode their 32-byte public
  keys; never lowercase them for comparison.
- Phantom's EVM roadmap must not be used to merge the Solana adapter with EVM
  connector selection in this decision.

## Coinbase Wallet

### Reviewed choice

- Wagmi 3 Coinbase connector backed by `@coinbase/wallet-sdk` 4.3.x; reviewed
  package release was 4.3.7.
- EOA-only preference for an existing external Coinbase/Base Wallet address,
  configured with `{ preference: { options: 'eoaOnly' } }`.

### Expected behavior

| Capability           | Expected result                                                                                                                                                          | Evidence                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider             | EIP-1193 request/event interface through the explicit Coinbase connector                                                                                                 | [official SDK repository](https://github.com/coinbase/coinbase-wallet-sdk), [Wagmi connector](https://wagmi.sh/react/api/connectors/coinbaseWallet) **D/M**                                         |
| Account/chain events | Normalize `accountsChanged`, `chainChanged`, and disconnect without replacing another EVM connection                                                                     | [official SDK repository](https://github.com/coinbase/coinbase-wallet-sdk), [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) **D/M**                                                             |
| Desktop              | Browser extension path selects an EOA                                                                                                                                    | [official SDK repository](https://github.com/coinbase/coinbase-wallet-sdk) **D/M**                                                                                                                  |
| Mobile               | WalletLink QR/cross-device, same-device handoff, and Base in-app behavior are measured against SDK 4.3.7 plus the exact client/version/mode without pre-claiming support | [official SDK repository](https://github.com/coinbase/coinbase-wallet-sdk), [current connection guidance](https://help.coinbase.com/en/wallet/other-topics/mobile-app-sign-in-discontinued) **D/M** |
| Restore/expiry       | Reconcile vendor-persisted transport state; no published Coinbase-specific expiry event or stable TTL                                                                    | [official SDK repository](https://github.com/coinbase/coinbase-wallet-sdk) **D/M**                                                                                                                  |
| Signing              | Sign and server-verify the exact SIWE challenge                                                                                                                          | [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) **D/M**                                                                                                                                         |

### Known limitations

- Coinbase Wallet SDK is now described as legacy in favor of Base Account SDK.
  Coinbase recommends a transition rather than an invisible replacement. The
  user-facing name and installed-app behavior must be checked at every release.
  See the [official migration guide](https://docs.base.org/base-account/guides/migration-guide).
- Smart-account creation is intentionally excluded. It would change signature,
  recovery, disclosure, and ERC-1271 verification requirements.
- Current Base-app help guidance may differ from the WalletLink QR docs and
  implementation in locked Coinbase Wallet SDK 4.3.7. Treat desktop-to-mobile
  QR as an empirical compatibility case: record the exact SDK, mobile client
  version, branding/account/app mode, whether QR is presented, pairing/return
  behavior, and any sanitized error. Do not label the path supported or
  unsupported until that exact-version run is complete.
- Physical-iOS same-device/Base in-app behavior cannot be covered while the dapp
  is restricted to desktop loopback. Android `adb reverse` and an iOS Simulator
  can provide separate smoke evidence, but the physical-iOS path remains
  deferred to a separately approved HTTPS preview.
- Do not classify an EOA by checking only `eth_getCode === 0x`; Base can apply
  EIP-7702 delegation to a recovery-phrase address. Record legacy/Base/upgraded
  mode and verify that the flow did not create a new Base Account.
- The SDK persists transport/provider state in browser storage. Connector logout
  must clear live application authorization even if transport later rehydrates.
- Validate both extension and mobile EOA behavior; passing one is not evidence
  for the other transport.
- The selected SDK path has no verified telemetry-off control. Network-test the
  locked runtime, assume SDK/extension/transport/vendor metadata exposure is
  possible, and require privacy/security approval before public use.

## WalletConnect

### Reviewed choice

- Wagmi 3 WalletConnect connector backed by the WalletConnect Ethereum
  provider; reviewed current provider release was 2.23.10.
- A project ID, application metadata, configured Wagmi chain allowlist,
  `showQrModal: false`, and `telemetryEnabled: false`.
- No required methods/events; optional methods `personal_sign` and
  `wallet_switchEthereumChain`, plus optional events `accountsChanged` and
  `chainChanged`. The wallet's approved scopes still control availability.
- Runtime omission unless `VITE_WALLETCONNECT_TERMS_ACCEPTED=true` and the
  project ID is exactly 32 hexadecimal characters. The literal flag is a local
  current-terms acknowledgement, not public legal approval.
- Application-owned `display_uri` QR/deeplink presentation and post-approval
  inspection of the session's actual chains, accounts, methods, and events.
- Explicit application RPC transport for every supported chain and Reown Cloud
  origin allowlisting for the public project ID.

### Expected behavior

| Capability      | Expected result                                                                                            | Evidence                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Pairing         | QR or deeplink creates a pairing, then the wallet approves a scoped session                                | [Sign overview](https://docs.reown.com/advanced/api/sign/overview) **D/M**                                                  |
| Session updates | Merge append-only namespace updates, then reconcile normalized approved scopes                             | [session events](https://specs.walletconnect.com/2.0/specs/clients/sign/session-events) **D/M**                             |
| Expiry/delete   | Protocol expiry/delete, or provider-normalized disconnect, clears authorization and requires a fresh proof | [session events](https://specs.walletconnect.com/2.0/specs/clients/sign/session-events) **D/M**                             |
| Persistence     | Restore persisted client/session state, then reconcile approved namespaces                                 | [dapp usage](https://docs.reown.com/advanced/api/sign/dapp-usage) **D/M**                                                   |
| Mobile          | Resolve a compatible-wallet deeplink and return to the browser; provide QR/full-browser fallback           | [Sign overview](https://docs.reown.com/advanced/api/sign/overview), [AppKit FAQ](https://docs.reown.com/appkit/faq) **D/M** |
| Signing         | Forward the exact SIWE request only when the session approved the method and chain                         | [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) **D/M**                                                                 |

### Known limitations

- Pairing, session, account authorization, and authenticated application session
  are separate states.
- WalletConnect v2 requires chain/method/event scopes to be approved. Adding a
  chain after session creation can make a stored session stale; the connector's
  behavior must be configured deliberately and tested.
- Current Wagmi passes configured chains as optional chains, and current Sign
  Client deprecates required namespaces. Do not assume the request was approved;
  inspect the resulting CAIP-10 accounts, target chain, and `personal_sign`
  capability before enabling an action.
- Wallets may approve some or none of optional permissions and may return
  additional valid methods/events/accounts. Require the application's minimum
  target account, chain, and signing method; safely ignore unsupported extras.
- Session updates are append-only and controller-authorized. Removed permission
  is represented by session deletion/disconnect rather than an in-place
  revocation assumption.
- Client persistence is not an authorization cache. Expiry, deletion, changed
  accounts, or changed namespaces invalidates address-bound application access.
- Deeplinks are wallet/OS/browser dependent. Android in-app browsers can fail to
  launch external applications; provide an explicit full-browser/QR recovery
  path.
- A physical wallet may scan QR while the dapp stays on desktop loopback.
  Android may use `adb reverse`, and an iOS Simulator may share host loopback.
  Physical-iOS same-device return still requires a separately approved HTTPS
  preview and is not covered by those alternatives.
- Default provider telemetry is disabled for this product pending privacy
  approval, then network-tested against the exact locked build. Never log a
  session topic or raw pairing URI. The reviewed
  [EventClient source](https://github.com/WalletConnect/walletconnect-monorepo/blob/2d064b8/packages/core/src/controllers/events.ts)
  documents the current telemetry path.
- Provider 2.23.10 is governed by the
  [WalletConnect Community License](https://github.com/WalletConnect/walletconnect-monorepo/blob/2d064b8/providers/ethereum-provider/LICENSE.md),
  including network/use and commercial conditions. The official
  [commercial FAQ](https://docs.reown.com/appkit/faq) distinguishes plain wallet
  connections, authenticated users, and built-in RPC usage. Legal must approve
  the locked version and current terms before local activation, and must provide
  a public-use disposition before release.
- Provider 2.23.10 hard-installs `@reown/appkit@1.8.19`, governed by a separate
  Reown Community License. `showQrModal: false` prevents modal use but does not
  remove AppKit or its terms/notice/license-copy obligations.
- The lock scopes the optional AppKit/Base Account/CDP path to `axios@1.18.0`.
  The 2026-08-18 npm-audit snapshot reports zero known vulnerabilities for the
  exact lock. This point-in-time result is not a zero-risk finding; re-run audit,
  tests, and license review after every override/lock/import/config change.
- At the reviewed version, pairing URI/session-proposal lifetime defaults to
  five minutes and a settled session to seven days. Treat these as separately
  testable lifecycle states, not application-authentication lifetimes. See the
  official [session guidance](https://docs.reown.com/advanced/api/sign/dapp-usage).
- The project ID is a public client identifier, not a secret. Restrict allowed
  origins and monitor usage under Reown's
  [origin allowlist guidance](https://docs.reown.com/appkit/next/cloud/relay).

## Cross-wallet release criteria

- No provider is selected merely because it owns a global browser property.
- Every connection is stored under a unique application connection ID and a
  chain-qualified account identity.
- Switching one wallet does not mutate another wallet's selected account.
- Restored sessions remain unauthenticated until a fresh valid ownership proof
  exists for the selected address and chain.
- Every event handler has exact unsubscription behavior; reconnecting does not
  multiply listeners.
- Rejected, expired, disconnected, wrong-chain, and wrong-account flows are
  visible and recoverable.
- No test uses a production seed phrase or funded mainnet wallet.
- The restricted harness exposes no transaction action and never requests a
  mainnet permission.
- Desktop QR, Android `adb reverse`, and iOS Simulator results are labeled as
  such and never counted as physical-iOS same-device/Phantom Browse coverage.

## Approval record

| Role        | Name    | Date | Result  | Evidence location |
| ----------- | ------- | ---- | ------- | ----------------- |
| Engineering | Pending | —    | Pending | —                 |
| Security    | Pending | —    | Pending | —                 |
| Product     | Pending | —    | Pending | —                 |

This matrix remains Proposed until those approvals are recorded after live
execution.
