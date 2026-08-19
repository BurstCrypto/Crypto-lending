# Local wallet compatibility lab

This package is a restricted real-wallet test harness for KAN-55/KAN-224. It is
not a product application and is not approved for deployment.

## Authorized boundary

Use is limited to a maximum of two project-authorized evaluators, on
`127.0.0.1`, with dedicated test wallets and only these networks:

- Ethereum Sepolia (`eip155:11155111`);
- Base Sepolia (`eip155:84532`); and
- Solana devnet.

The harness supports explicit connection, disconnection, approved-testnet
switching, and signing a local ownership message. It has no transaction action.
Do not use a public or external URL, tunnel, LAN bind, hosted preview, mainnet,
production account, customer data, funded wallet, real asset, private key, or
seed phrase. The local page may contact configured HTTPS testnet RPCs and, when
separately enabled, vendor wallet/relay services; localhost-only describes the
application surface, not an offline test.

## Isolation

`tools/wallet-lab` has its own `package.json` and `package-lock.json` and is not
listed in the repository's npm workspaces. A root `npm install`, application
build, or production artifact does not install or bundle these wallet packages.
The Vite configuration permits a development server only on loopback and rejects
production builds.

The lock always downloads and installs
`@walletconnect/ethereum-provider@2.23.10` and its non-optional
`@reown/appkit@1.8.19` dependency. Both locked custom licenses state that
downloading/installing accepts their terms. Anyone who cannot or is not
authorized to accept those exact licenses must not run `npm ci` for this package
or use this real-package lab. The runtime environment flag does not prevent or
undo install-time acceptance; the mock route in `apps/web` remains the
no-wallet-package alternative.

After an authorized terms review and acceptance, install this package explicitly:

```powershell
npm ci --prefix tools/wallet-lab
Copy-Item tools/wallet-lab/.env.example tools/wallet-lab/.env.local
```

Set `VITE_WALLET_LAB_ENABLED=true` in the ignored `.env.local`, then run:

```powershell
npm run dev:wallet-lab
```

Open only `http://127.0.0.1:4173`. Do not pass a host override or place a proxy
or tunnel in front of it.

Before a frozen validation run, also set
`VITE_WALLET_LAB_CANDIDATE_COMMIT` to the exact 40-character commit being
tested. The field is public run metadata, not a credential.

## Connector behavior

- MetaMask desktop uses the injected Wagmi connector with EIP-6963 discovery.
  Select the provider explicitly. `window.ethereum`, wallet names, icons,
  reverse-DNS values, and `isMetaMask` are not proof of wallet identity.
- `@metamask/connect-evm` is not installed. Review of 2.1.1 found that it appends
  Ethereum mainnet (`0x1`) to the connection permission chain IDs. That conflicts
  with the testnet-only authorization, so the native MetaMask Connect path is
  blocked. MetaMask Mobile testing uses the restricted WalletConnect path.
- Coinbase Wallet uses the explicit EOA-only connector. This selected SDK path
  has no verified telemetry-off control. Inspect network traffic and assume SDK,
  extension, transport, operational, and vendor metadata may leave the machine.
  Do not use production or sensitive data.
- Phantom is discovered through Solana Wallet Standard and is restricted to
  Solana devnet. The adapter prefers `solana:signIn` and otherwise signs a local
  ownership message; it never requests a transaction.
- WalletConnect requests no required methods. Its optional methods are
  `personal_sign` and `wallet_switchEthereumChain`; its optional events are
  `accountsChanged` and `chainChanged`. It uses an application-owned QR surface,
  with the provider's default AppKit modal disabled. The harness inspects every
  settled or restored session and every session update. Session deletion or
  expiry immediately revokes signing and disconnects locally. Missing the
  selected testnet/single account or `personal_sign`, or approving any
  unrecognized method/event, blocks and disconnects the session; omission of
  `wallet_switchEthereumChain` leaves signing available but disables switching.
  `@reown/appkit@1.8.19` is nevertheless a hard-installed provider dependency
  with its own custom license; disabling the modal does not remove that package
  or its terms.
- The current harness validates one EVM connector session at a time. Simultaneous
  independent MetaMask/Coinbase/WalletConnect sessions and their isolation
  behavior remain deferred to a future adapter/conformance implementation.

### WalletConnect terms gate

WalletConnect is omitted unless both conditions are true:

```text
VITE_WALLETCONNECT_TERMS_ACCEPTED=true
VITE_WALLETCONNECT_PROJECT_ID=<32 lowercase-or-uppercase hexadecimal characters>
```

The project ID is a public client identifier, not a secret. Configure its origin
restrictions in Reown Cloud and do not put any secret in a `VITE_` variable.

The literal terms flag is an additional operational acknowledgement by an
already authorized installer before WalletConnect runtime activation. It does
not defer or replace the acceptance triggered by download/install, establish
authority to bind an organization, provide legal advice/vendor classification,
or permit public use. After authorized installation, leaving it `false` keeps
WalletConnect inactive while injected, Coinbase, and Phantom testing remains
available.

The provider is configured with `telemetryEnabled: false`, but relay/RPC traffic
is still required and the setting must be verified against the locked runtime.
Never record a pairing URI, session topic, full address, signature, or provider
object in evidence.

## Mobile scope

Under the current localhost-only authorization, a mobile wallet may scan a QR
shown by the desktop loopback page while the dapp stays on the desktop. Android
can reach the host page through `adb reverse tcp:4173 tcp:4173`; an iOS Simulator
may share host loopback when its environment supports that mapping. Record those
as Android-mapped or simulator evidence, not as general mobile coverage.

A physical iPhone cannot reach the host's loopback page. Physical-iOS Coinbase
same-device handoff and Phantom Browse therefore cannot be tested under the
no-LAN/no-tunnel rule. Those paths, along with any hosted mobile return URL, are
deferred until a secured HTTPS preview receives separate legal and security
authorization. Do not claim that desktop QR, Android `adb reverse`, or an iOS
Simulator covers them.

## Verification and evidence

```powershell
npm run lint:wallet-lab
npm run typecheck:wallet-lab
npm run test:wallet-lab
npm audit --prefix tools/wallet-lab
```

Evidence schema v2 contains the case/run identity, frozen commit and lock hash,
environment/software versions, result, terms state, audit snapshot, and ordered
sanitized events. Those events persist only under one dedicated
`sessionStorage` key for same-tab reload recovery; the UI's **Clear run** action
removes it, and closing the browser session clears it. No address, signature,
pairing URI/topic, provider payload, or wallet secret belongs in that storage
or export. Inspect every export before attaching it to Jira or GitHub. Follow
the [manual validation runbook](../../docs/wallets/manual-validation-runbook.md).

The lock applies a scoped `axios@1.18.0` override to the optional Base/CDP path
under WalletConnect's hard-installed AppKit dependency:

```text
@walletconnect/ethereum-provider
  -> @reown/appkit
  -> @reown/appkit-utils
  -> optional @base-org/account
  -> @coinbase/cdp-sdk
  -> axios@1.18.0
```

As of 2026-08-18, `npm audit --prefix tools/wallet-lab` reports zero known
vulnerabilities for this exact lock. The designed lab does not import AppKit or
Base Account and sets `showQrModal: false`, but AppKit and the optional Base/CDP
path remain in the installed transitive tree. A clean audit is a point-in-time
database result, not a claim of zero risk or proof of runtime unreachability.
Re-run tests, audit, and license review after every lock/override/import/config
change, and remove the override when a reviewed upstream tree no longer needs it.

## Release block

The WalletConnect Community License, current Reown service terms, Coinbase
network/telemetry behavior, exact transitive dependency set, required notices,
privacy/security review, and the wider lending product's legal obligations are
still open public-launch gates. See the
[KAN-222 packet](../../docs/wallets/license-review/README.md) and
[public-launch gate](../../docs/wallets/license-review/public-launch-legal-gate.md).
