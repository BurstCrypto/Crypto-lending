# Wallet SDK vendor classification requests

These drafts must be reviewed and sent by a person authorized to describe and
bind the company. Preserve the sent message, attachments, complete vendor reply,
sender/recipient identities, and date in the KAN-222 evidence record.

Before sending, replace every bracketed field. Do not send projections marked
TBD and do not characterize the product as legally non-custodial until product
counsel confirms that description.

The project owner has authorized only a maximum two-person evaluation on a
loopback-only application using approved testnets and the exact isolated lock.
The expected evaluation tier is $0. This internal boundary is a forecast and
operational authorization, not a vendor classification or legal approval. No
public, external-user, mainnet, production, or paid-tier use is authorized.

## MetaMask Connect archive — do not send for the current design

`@metamask/connect-evm@2.1.1` was removed and is not installed. Review found
that its connection permission request appends Ethereum mainnet (`0x1`) even
when the application supplies only testnet chain IDs. This violates the current
authorization, and the package's custom license remains unapproved.

The lab now uses injected EIP-6963 discovery for the MetaMask extension and the
separately terms-gated WalletConnect connector for MetaMask Mobile. Do not send
the prior package-classification request as though the package were in use. If a
future proposal reintroduces native MetaMask Connect, first open a new technical
decision covering the forced-mainnet behavior; then obtain written license,
commercial, notice, telemetry, and permitted-environment classification before
installing or using it.

## WalletConnect / Reown

Use Reown's current commercial/contact channel and retain the submitted form.
Subject: Written tier/Enterprise classification request — crypto lending and
`@walletconnect/ethereum-provider@2.23.10`

> We are evaluating `@walletconnect/ethereum-provider@2.23.10`, its hard-installed
> non-optional `@reown/appkit@1.8.19` dependency, and the Reown network for
> [LEGAL ENTITY]. We set `showQrModal: false` and do not invoke the AppKit modal,
> but understand that this does not remove the installed package or its separate
> Reown Community License. Users connect externally managed wallets and
> approve ownership-message signatures in their wallet. The current harness has
> no transaction action. We do not plan an embedded wallet or key custody in
> this scope. Wallet ownership authentication is [SIWE/DESCRIPTION]. A future
> product may facilitate [PRECISE LENDING AND VALUE-MOVEMENT FLOW].
>
> The current evaluation is limited to two authorized people, a loopback-only
> application, and testnet accounts/assets. We expect this phase to remain in a
> $0 tier and will stop before accepting a paid tier or different agreement.
> WalletConnect remains disabled unless an authorized evaluator deliberately
> acknowledges the current package/service terms and supplies an
> origin-restricted project ID. This local acknowledgement is not our requested
> public-use classification.
>
> Future environments under consideration are a public beta and production in
> [JURISDICTIONS]. Public-use forecasts are [SELF-CUSTODIAL CONNECTIONS],
> [AUTHENTICATED ACCOUNTS], [BUILT-IN REOWN RPC CALLS], and [OWN RPC CALLS] per
> month. We configure `telemetryEnabled: false`, application-owned RPC endpoints,
> an origin allowlist, optional `personal_sign`/`wallet_switchEthereumChain` and
> account/chain event scopes, and an
> application-owned `display_uri` surface.
>
> Please confirm in writing: (1) whether this lending/value-movement use requires
> an Enterprise agreement under current eligibility terms regardless of volume;
> (2) which connections count as authenticated MAU; (3) which calls count toward
> RPC thresholds; (4) permitted internal-evaluation and public-beta use; (5)
> required attribution and exact license copies for both custom-licensed
> packages, branding, gateway, reporting, privacy, and
> audit terms; (6) applicable tier/pricing; and (7) decision expiry and re-review
> triggers.

## Coinbase public-use and telemetry clarification

Use Coinbase's official Wallet SDK support channel.
Subject: Public-use, telemetry, and notice clarification for
`@coinbase/wallet-sdk@4.3.7`

> The exact locked `@coinbase/wallet-sdk@4.3.7` tarball declares Apache-2.0 and
> contains an Apache-2.0 `LICENSE` file. Please confirm the notices required for
> that artifact and whether additional service, telemetry, branding, privacy, or
> commercial terms apply to an external-EOA-only web integration.
>
> The selected EOA integration has no verified telemetry-off control. Please
> identify every SDK, extension, transport, operational, or vendor network data
> class that can be sent, its purpose,
> retention, and subprocessors, and the controls or agreements required for
> public use. We will retain the response with the exact tarball integrity, lock,
> and network-test evidence for counsel review.

## Required disposition record

Counsel must record the exact package/version and license snapshot reviewed,
permitted environments, accepted business description and forecasts, required
notices and controls, commercial tier/agreement, approver, approval date,
expiration/review date, source response, and re-review triggers. Silence or a
sales conversation is not approval.
