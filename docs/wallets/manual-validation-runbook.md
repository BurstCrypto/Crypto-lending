# Wallet SDK manual validation runbook

- Jira: KAN-55
- Purpose: validate real extension, QR, and mobile-deeplink behavior that mocked
  provider tests cannot prove
- Networks only: Ethereum Sepolia, Base Sepolia, and Solana devnet

## Current execution boundary

This runbook contains both cases that can run under the current restricted-local
authorization and cases that remain required before public release. The current
phase is limited to a maximum of two authorized evaluators and a dapp that stays
on loopback. It has no transaction action.

WalletConnect QR may pair a physical phone while the dapp remains on a desktop
loopback page. Android may access the host loopback page through `adb reverse`,
and an iOS Simulator may share host loopback where its environment supports that
mapping. A physical iPhone cannot use the host's loopback address. Coinbase
same-device handoff and Phantom Browse on physical iOS therefore cannot be
validated under the no-LAN/no-tunnel rule; they are deferred to a separately
approved secured HTTPS preview and must not be reported as covered.

## Safety rules

1. Use dedicated test wallets with no mainnet assets and seed phrases that have
   never secured production funds.
2. Never paste a seed phrase, private key, session topic, raw QR payload, access
   token, or unredacted signature into Jira, GitHub, screenshots, or logs.
3. Keep the current dapp on authenticated `https://127.0.0.1:4173` with the
   approved local certificate trust configured. Do not bypass a certificate
   warning, bind to a LAN interface, use a tunnel, or create a hosted preview.
   Any externally reachable HTTPS preview requires separate legal and security
   authorization.
4. Record wallet application/extension version, OS, browser, SDK lockfile
   version, network, UTC timestamp, and result for every run.
5. Redact addresses unless a test-only address has been designated for public
   evidence. Record only the final six characters when full value is unnecessary.
6. Reject any signing prompt whose domain, URI, chain, address, nonce, or action
   does not match the displayed test case.
7. Do not send a transaction or use real assets. This harness validates
   connection, lifecycle, testnet selection, and ownership-message signing only.

## Required environments

| Environment ID | Device/browser                                                   | Current phase                     | Required wallet path                                                                                         |
| -------------- | ---------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| D1             | Current Chrome/Chromium desktop                                  | Required                          | MetaMask, Phantom, and Coinbase/Base extensions installed together                                           |
| D2             | Current Firefox desktop                                          | Required                          | MetaMask and other officially supported extensions; document Phantom's official absence                      |
| D3             | Clean desktop browser profile                                    | Required                          | No wallet extension; application-owned WalletConnect QR                                                      |
| P1             | Physical iOS or Android wallet scanning D3                       | Required for QR                   | At least two WalletConnect-compatible wallets across the two mobile OSes; the dapp stays on desktop loopback |
| A1             | Current Android + Chrome through `adb reverse tcp:4173 tcp:4173` | Optional local coverage           | Same-device deeplink/return cases that continue to use device loopback                                       |
| S1             | iOS Simulator sharing host loopback, where supported             | Optional simulator coverage       | Same-device flow smoke test; never count this as physical-iOS evidence                                       |
| H1             | Physical iOS/Android against an approved HTTPS preview           | **Deferred / not authorized now** | Coinbase same-device, Phantom Browse, and physical-browser return coverage required before public release    |

Use at least two different WalletConnect-compatible wallet applications for P1.
Record exact wallet names and versions rather than assuming one client
represents the protocol. Before enabling WalletConnect, an authorized evaluator
must set `VITE_WALLETCONNECT_TERMS_ACCEPTED=true` and a valid 32-hex
`VITE_WALLETCONNECT_PROJECT_ID`. If either value is absent/invalid, WalletConnect
must remain unavailable while injected, Coinbase, and Phantom tests still run.

### KAN-226 mobile groups

KAN-226's M1/M2/M3 names map to the canonical environments as follows:

- **M1:** D3 + P1 physical cross-device QR on iOS and Android;
- **M2:** A1 Android mapped-loopback and S1 iOS Simulator smoke coverage; and
- **M3:** H1 physical same-device coverage on a separately approved HTTPS
  preview.

See the [mobile execution plan](evidence/mobile-execution-plan.md) for entry
criteria and the exact limitation labels. M2 never substitutes for M3.

## Evidence template

Create a dated results document outside this runbook with one row per case:

| Field                        | Value                 |
| ---------------------------- | --------------------- |
| Case ID                      | —                     |
| UTC timestamp                | —                     |
| Tester                       | —                     |
| Commit                       | —                     |
| Environment ID               | —                     |
| OS/browser version           | —                     |
| Wallet and version           | —                     |
| SDK/resolved package version | —                     |
| Network                      | —                     |
| Result                       | Pass / Fail / Blocked |
| Redacted evidence link       | —                     |
| Observed events in order     | —                     |
| Notes/follow-up Jira         | —                     |

Console logs used as evidence must omit provider objects, request payloads,
session topics, signatures, and full addresses.

## Common cases

Run these cases for each applicable target wallet.

For the restricted harness, C10–C13 use its displayed local ownership message
and local/reference verification only. They do not create an API session or
claim atomic server nonce consumption. Re-run the server-issued variants when
the authentication endpoint is separately implemented and approved.

The concurrency candidate permits one active session per distinct approved EVM
connector. Exercise MetaMask plus the explicit Coinbase connector as the
minimum pair. WalletConnect may be added alongside an injected session only
after its separate terms and project-origin gate is cleared. Two WalletConnect
sessions, duplicate sessions for one connector, and multiple selected accounts
inside one connector are outside this harness's supported cardinality. The
implementation and automated tests are not substitutes for the pending C18 and
CB07 real-wallet results.

| Case                       | Procedure                                                                                                                                                                                                                    | Pass condition                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 Discover               | Open a clean application session and choose the named wallet                                                                                                                                                                 | Only the selected wallet connects; another injected wallet cannot replace it                                                                                                                                                                             |
| C02 Reject connect         | Reject the initial approval                                                                                                                                                                                                  | UI returns to a retryable disconnected state with no account retained                                                                                                                                                                                    |
| C03 Connect                | Approve the intended test account and network through the lab's explicit Connect action                                                                                                                                      | Exact wallet, chain-qualified account, and connector are shown/stored; an unsolicited provider row remains quarantined                                                                                                                                   |
| C04 Explicit restore       | Connect the applicable approved wallets, reload, confirm there is no automatic reconnect, then click **Restore approved sessions** while no session is active                                                                | `reconnectOnMount` remains false; nothing restores before the click; approved stored sessions are restored in one registry rebuild, invalid sessions are isolated, and no application authentication is created                                          |
| C05 New tab                | Open a second tab, then close it                                                                                                                                                                                             | State reconciles safely; closing one tab does not corrupt the surviving session                                                                                                                                                                          |
| C06 Account switch         | Select a different account in the wallet                                                                                                                                                                                     | Only that connection updates; exactly one returned account is revalidated, zero/multiple-account responses are quarantined, and stale work is invalidated                                                                                                |
| C07 Empty accounts         | Revoke site/account permission                                                                                                                                                                                               | Connection becomes unauthorized/disconnected and protected actions stop                                                                                                                                                                                  |
| C08 Chain switch           | Switch between approved test chains                                                                                                                                                                                          | Normalized chain changes once and chain-bound authorization is invalidated                                                                                                                                                                               |
| C09 Unsupported chain      | Select/request an unsupported chain                                                                                                                                                                                          | UI blocks the action and gives a safe supported-network recovery path                                                                                                                                                                                    |
| C10 Reject signature       | Reject the ownership request                                                                                                                                                                                                 | No authenticated session is created; challenge cannot be marked consumed                                                                                                                                                                                 |
| C11 Valid signature        | Sign fresh server-issued SIWE, SIWS sign-in input, or fallback message                                                                                                                                                       | Reference verifier validates returned account/message bytes/signature against expected context                                                                                                                                                           |
| C12 Replay vector          | Submit the same signed challenge twice to the validation harness                                                                                                                                                             | Replay is identified as requiring atomic server-side nonce consumption                                                                                                                                                                                   |
| C13 Wrong context          | Alter domain, chain, address, nonce, or expiry before verification                                                                                                                                                           | Reference verification rejects every altered proof                                                                                                                                                                                                       |
| C14 Disconnect             | Disconnect from dapp and, where supported, revoke in wallet                                                                                                                                                                  | Local authorization clears and signing requires reconnection                                                                                                                                                                                             |
| C15 Expire/delete          | Expire or delete a remote session where supported                                                                                                                                                                            | Lifecycle event clears authorization without affecting another wallet                                                                                                                                                                                    |
| C16 Reconnect loop         | Connect/disconnect ten times, then trigger one event                                                                                                                                                                         | Exactly one state transition occurs; no listener leak or duplicate prompt                                                                                                                                                                                |
| C17 Offline return         | Interrupt network during request/return, then restore it                                                                                                                                                                     | Operation fails or resumes deterministically; no false connected/authenticated state                                                                                                                                                                     |
| C18 Concurrent EVM wallets | Connect MetaMask and the explicit Coinbase connector concurrently on approved testnets; alternately change one account/chain, sign a proof, and disconnect one session; optionally repeat with WalletConnect after clearance | One explicitly authorized session per distinct connector remains independently selectable; every account, chain, proof, lifecycle, and disconnect transition is attributed to and gates only the targeted connector; the other session remains unchanged |

## MetaMask-specific cases

| Case | Environment                | Procedure                                                                                      | Pass condition                                                                                       |
| ---- | -------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| MM01 | D1                         | Discover MetaMask with other EVM extensions installed                                          | EIP-6963 selection connects the MetaMask provider, not `window.ethereum` winner                      |
| MM02 | D3 + P1                    | Use the restricted WalletConnect QR and scan it with MetaMask Mobile                           | Pairing establishes only the approved testnet account/session; dapp stays on desktop loopback        |
| MM03 | A1/S1; H1 for physical iOS | Open a WalletConnect deeplink and return to the loopback dapp; defer physical iOS to H1        | Local mapped/simulator return is recoverable; no claim of physical-iOS coverage                      |
| MM04 | D1/P1                      | Reconnect and choose another account                                                           | Provider exposes exactly the one selected account; zero or several returned accounts are quarantined |
| MM05 | D1                         | Remove extension permission while connected                                                    | Empty account event clears address-bound access                                                      |
| MM06 | D1                         | Trigger already-pending request, rejection, unauthorized method, and disconnected-chain errors | Each error maps to a stable, actionable application state                                            |

Native `@metamask/connect-evm` is not part of these cases. It is excluded because
the reviewed 2.1.1 implementation forces an Ethereum-mainnet permission and its
custom license is not approved. MM02/MM03 exercise MetaMask Mobile as a
WalletConnect-compatible wallet, not MetaMask Connect.

## Phantom-specific cases

| Case | Environment             | Procedure                                                                          | Pass condition                                                                                     |
| ---- | ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| PH01 | D1                      | Discover Phantom through Wallet Standard and connect on Solana devnet              | Solana adapter connects; Phantom cannot replace the selected EVM connector                         |
| PH02 | A1; H1 for physical iOS | User opens a Phantom Browse link for the exact loopback/approved-preview URL       | Android loopback may be tested through `adb reverse`; physical-iOS evidence remains deferred to H1 |
| PH03 | D1                      | Switch selected Solana account                                                     | Adapter invalidates old proof and shows the exact case-sensitive new account                       |
| PH04 | D1/A1                   | Feature-detect `solana:signIn`; test it and canonical `signMessage` fallback       | Exact fields/bytes verify in the local harness; server authentication is not claimed               |
| PH05 | D1                      | Attempt integration in an iframe and insecure non-local origin in an isolated test | Provider is not relied upon; user gets a supported top-level HTTPS path                            |
| PH06 | D1/A1                   | Disconnect, then try signing and a trusted reload                                  | Live auth clears; no signing before reconnection; trusted restore never creates app auth by itself |
| PH07 | D1                      | Simulate `4001`, `4100`, `4900`, and duplicate approval `-32002`                   | Errors map to retryable or blocked states without opening another approval popup                   |
| PH08 | A1; H1 for physical iOS | Start with Phantom cold and warm; approve, cancel, reload, and navigate back       | Android loopback evidence is recorded separately; physical-iOS Browse remains deferred             |

Phantom does not currently maintain a Firefox or desktop Safari extension, so
those are documented exclusions rather than false failures. Chrome is P0;
Brave/Edge are P1 Chromium smoke tests. Use a current iPhone for P1 QR only in
this phase; physical-iOS Browse coverage remains H1. Use a current
Pixel/Samsung-class Android device for P1 and, when configured, A1.

The restricted harness uses the small Wallet Standard packages directly; it
does not install Solana Kit/React/plugin packages. Physical-iOS Phantom Browse
cannot be counted until H1 receives separate approval.

## Coinbase Wallet-specific cases

| Case | Environment                | Procedure                                                                                                                                                                                               | Pass condition                                                                                                                                                                                                                   |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CB01 | D1                         | Select Coinbase/Base-branded extension with other EVM wallets present                                                                                                                                   | Explicit connector is used and selects an existing external recovery-phrase account                                                                                                                                              |
| CB02 | A1/S1; H1 for physical iOS | From the same-device browser, select Base mobile app, approve, and return                                                                                                                               | Android mapped/simulator result is labeled accurately; physical-iOS evidence is deferred                                                                                                                                         |
| CB03 | A1/S1; H1 for physical iOS | Open the dapp in the Base in-app explorer                                                                                                                                                               | Local mapped/simulator behavior is recorded; physical-iOS navigation requires H1                                                                                                                                                 |
| CB04 | D3 + P1                    | With locked SDK 4.3.7, record whether WalletLink QR is presented; scan using the exact Coinbase/Base mobile client version and account/app mode, then approve/cancel and observe return/reload behavior | Record the empirical result without pre-claiming support: exact versions/mode, QR presence, pairing/approval/return outcome, and sanitized failure/recovery; if connected, verify the intended external EOA and approved testnet |
| CB05 | D1/A1                      | Record legacy/Base/upgraded mode and sign SIWE                                                                                                                                                          | Selected address matches challenge; no `eth_getCode`-only EOA assumption                                                                                                                                                         |
| CB06 | D1/A1                      | Capture current branding/install prompts                                                                                                                                                                | Product copy accurately distinguishes Coinbase Wallet/Base app transition                                                                                                                                                        |
| CB07 | D1 — evidence pending      | Connect the explicit Coinbase connector and MetaMask concurrently; change each wallet's account and approved testnet in turn, sign with the selected connector, then disconnect each in turn            | Each connector retains its own sole selected account, chain, proof gate, and lifecycle; changing or disconnecting one never mutates, replaces, signs through, or revokes the other; record Passed only after a real D1 run       |
| CB08 | D1/A1; H1 physical iOS     | Logout, reload, and observe vendor-restored state                                                                                                                                                       | Restored transport never restores application authentication without a fresh proof                                                                                                                                               |

If the connector creates a new Base Account in any supported external-wallet
path, mark the case Failed and open a separate decision ticket. Do not silently
accept the different onboarding/custody model. An EIP-7702-upgraded
recovery-phrase address is recorded explicitly and is not classified by code
presence alone.

The connector requests EOA-only mode, but the selected SDK path has no verified
telemetry-off control. Capture a sanitized network trace and record request
classes without retaining identifiers or payloads. Physical-iOS same-device
Coinbase coverage remains H1 and is not covered by P1 QR.

## WalletConnect-specific cases

| Case  | Environment            | Procedure                                                                                                             | Pass condition                                                                                                                                                                                                              |
| ----- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WC01  | D3 + P1                | After the explicit terms/project-ID preflight, pair by QR with compatible wallet A                                    | CAIP response includes an approved testnet account, `personal_sign`, and when used `wallet_switchEthereumChain`; dapp stays on desktop loopback                                                                             |
| WC02  | A1/S1; H1 physical iOS | Pair by deeplink with compatible wallet B                                                                             | Mapped/simulator return is recoverable; physical-iOS result is not claimed until H1                                                                                                                                         |
| WC03a | P1/A1                  | Change account/chain in the wallet                                                                                    | Application reconciles `accountsChanged`/`chainChanged` session events and preserves other connections                                                                                                                      |
| WC03b | Test client            | Controller publishes an append-only namespace update                                                                  | Application re-reads and validates the resulting namespaces; it never merges expansion into trusted scope, and disconnects/clears authorization if chains, accounts, methods, or events expand beyond the approved baseline |
| WC04  | P1/A1                  | Delete the session from the wallet                                                                                    | `session_delete` clears only that connection and its authorization                                                                                                                                                          |
| WC05  | Test configuration     | Exercise session expiry                                                                                               | Raw expiry or provider-normalized delete/disconnect clears authorization and reconnect creates a new session                                                                                                                |
| WC06  | D3/P1                  | Add a chain after session approval                                                                                    | Configured stale-chain behavior is predictable and explains reapproval                                                                                                                                                      |
| WC07  | A1                     | Launch from Android in-app browser through loopback mapping, then use recovery instruction                            | Failure is explained and QR/full-browser loopback recovery succeeds                                                                                                                                                         |
| WC08a | D3                     | Reject the full session proposal                                                                                      | Application returns to a retryable disconnected state                                                                                                                                                                       |
| WC08b | D3                     | Approve scopes missing the target chain/account or `personal_sign`; separately omit only `wallet_switchEthereumChain` | Missing identity/signing minimums block and disconnect fail-closed; missing only switch permission keeps the session degraded with programmatic switching unavailable                                                       |
| WC09  | D3/P1                  | Render application-owned QR/deeplink from `display_uri`                                                               | Default AppKit QR modal is not loaded; URI/topic never appears in logs or evidence                                                                                                                                          |
| WC10  | D3/P1                  | Inspect network requests with telemetry disabled                                                                      | Observed traffic is classified; no claim is made that a setting alone proves all metadata traffic absent                                                                                                                    |
| WC11  | Test clock             | Let a pairing URI and pending proposal pass their current five-minute TTL                                             | Pairing/proposal expires cleanly and is not misreported as settled-session expiry                                                                                                                                           |
| WC12  | H1 — deferred          | Use allowed and unlisted approved HTTPS origins with explicit chain RPC transports                                    | Required before public launch; cannot be passed with a LAN bind or ad hoc tunnel under the current authorization                                                                                                            |

Before WC01–WC11, record that the exact current terms were reviewed, the
evaluator was authorized to make the local acknowledgement, the terms flag was
literal `true`, the project ID format was valid, and Reown origin restrictions
were configured. Never attach the project configuration screen if it exposes
administrative credentials. A project ID itself is public, but it must not be
treated as permission to expose the dapp.

## Event-order checks

For account changes, chain changes, reconnects, and mobile returns, capture the
ordered normalized events. A pass requires:

1. no protected action while state is `restoring`, `expired`, or
   `disconnected`;
2. no authenticated session copied from a different chain-qualified account;
3. one state transition for one provider event;
4. exact listener cleanup after disconnect/unmount; and
5. another connected wallet remaining unchanged.

Vendor SDKs can emit additional transport events. Record them for adapter
diagnostics but expose only the normalized contract to product modules.

WalletConnect's reviewed defaults are a five-minute pairing/proposal lifetime
and seven-day settled-session lifetime. Use a controlled clock/test client to
exercise those boundaries; do not conflate pairing/proposal expiry with
`session_expire`.

KAN-55 validates that a wallet can produce and locally/reference-verify the
expected proof shape. Atomic nonce consumption and authenticated API sessions
belong to KAN-56, **Register wallets with ownership proof**; mark C12's
production path Blocked on KAN-56 until that endpoint exists rather than
claiming it was exercised here.

## Exit and approval

Security evidence must also complete the
[KAN-223 security review packet](security-review/README.md), including the
sanitized network inventory, storage/logout checks, rollback drill, finding
classification, and independent decision.

The [desktop](evidence/desktop-execution-plan.md) and
[mobile](evidence/mobile-execution-plan.md) result indexes must link every
required evidence-schema-v3 run or its focused defect/approved exception.

The restricted-local implementation can move to review when:

- D1, D2, D3, and applicable P1 QR cases have a Pass or a documented follow-up;
- A1/S1 results are labeled as mapped-device/simulator evidence and are not used
  to claim physical-iOS coverage;
- every H1 case is explicitly marked **Deferred — separate HTTPS preview
  approval required**, rather than Passed or silently omitted;
- failures have linked Jira follow-ups with owner and severity;
- the lock digest, terms acknowledgement (when WalletConnect is used), audit
  result, and sanitized evidence are recorded; and
- no mainnet permission, transaction action, secret, raw pairing URI, session
  topic, signature, or production/customer data appears in the run.

That local milestone does not make this ADR Accepted and does not close KAN-222
or the public-launch gate. Full acceptance still requires H1 physical-device
coverage on a separately approved HTTPS preview, approval of both hard-installed
Reown custom licenses/notices, continued review of the scoped Axios override,
privacy/security review of network and telemetry behavior, and
Engineering/Security/Product sign-off. Until those
conditions are met, the ADR and compatibility matrix remain Proposed.
