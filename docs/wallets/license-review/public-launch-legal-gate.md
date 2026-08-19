# Public-launch legal and assurance gate

Gate status: **OPEN — PUBLIC ACCESS IS NOT APPROVED**

For this gate, public access includes an open test environment, public beta,
unrestricted preview, production launch, or any environment where a person who
is not an authorized tester can connect a wallet. Calling an environment
“staging” does not exempt it.

This checklist is a coordination record, not legal advice or a legal conclusion.
Qualified counsel must make and document each legal determination for the actual
entities, jurisdictions, contracts, product flows, and launch date.

## Restricted evaluation carve-out

The project owner has authorized a maximum of two project-authorized people to
evaluate the exact isolated wallet-lab lock on a loopback-only application
connected only to approved testnets under the current package and service terms.
The harness has no transaction action and is excluded from root installs and
product builds. The expected vendor tier is $0. This is an internal operational
authorization and forecast, not a vendor classification or legal approval.

WalletConnect is unavailable in that carve-out unless the evaluator explicitly
sets `VITE_WALLETCONNECT_TERMS_ACCEPTED=true` and supplies a valid project ID.
The literal flag acknowledges current terms for the restricted local use; it
does not close this public-launch gate or prove authority to bind an entity.

The carve-out ends immediately if the application is exposed through a public
or external URL, another tester receives access, a mainnet or production account
or asset is used, customer data enters the environment, a paid tier or new
agreement is required, usage leaves the expected $0 tier, or package/service
terms change. Required testnet RPC and relay traffic does not make the
application public, but it must remain limited to the approved evaluation.

There is no carve-out for public, external-user, mainnet, or production use.
Those uses remain hard-blocked until every applicable item below has documented
approval.

## Wallet and software conditions

- [ ] Qualified software/OSS counsel approves the exact final direct and
      transitive lock, licenses, integrity/provenance evidence, allowed environments,
      notices, commercial conditions, decision expiry, and re-review triggers.
- [ ] Keep `@metamask/connect-evm` absent. The reviewed 2.1.1 implementation
      forces an Ethereum-mainnet permission and uses a custom license. Any future
      reintroduction requires a new technical, security, license, and vendor
      classification decision before installation or use.
- [ ] Counsel and security approve the public injected EIP-6963 MetaMask path,
      extension/platform behavior, branding, privacy, and required disclosures.
- [ ] Reown provides the requested self-service/paid/Enterprise classification;
      the required subscription or Enterprise agreement is executed before its
      connector is public.
- [ ] Counsel approves both hard-installed Reown custom licenses and their exact
      required copies/notices: WalletConnect Ethereum Provider 2.23.10 and its
      non-optional `@reown/appkit@1.8.19` dependency. `showQrModal: false` does
      not remove AppKit from the dependency tree or its obligations.
- [x] A complete SPDX SBOM is generated from the isolated wallet-lab lock and
      bound to the lock/source digest in `lock-review-snapshot.json`.
- [ ] Qualified counsel or an independent OSS reviewer reconciles that SBOM's
      licenses, notices, integrity data, and relationships against the exact
      shipped client and server artifacts. Generation alone is not approval.
- [ ] The scoped `axios@1.18.0` override is revalidated against the final tree and
      removed when upstream resolution permits. The current clean npm-audit
      snapshot is point-in-time evidence, not a zero-risk production disposition.
- [ ] Required copyright notices, license copies, attribution, branding, and
      third-party notices are displayed and included in distributions as directed.
- [ ] Vendor telemetry, local storage, relay/network metadata, RPC providers,
      retention, privacy disclosures, consent, deletion, subprocessors, and any
      data-processing terms receive privacy/security/legal approval. In
      particular, Coinbase's selected EOA path has no verified telemetry-off
      control, so every SDK, extension, transport, and vendor request class must
      be inventoried and approved.
- [ ] Approved usage counters and alerting cover authenticated MAU and any
      vendor-provided RPC thresholds, with review before 70% of a limit.

## Product legal conditions outside KAN-222

Wallet SDK clearance does **not** authorize the lending product. Product and
regulatory counsel must separately document at least:

- [ ] the permitted legal entities and launch jurisdictions, plus enforceable
      geo-restrictions for excluded locations;
- [ ] classification of every lending, borrowing, collateral, interest, yield,
      liquidation, token, and transaction flow under applicable lending,
      securities, commodities/derivatives, payments, money-transmission, virtual
      asset, banking, and consumer-finance laws;
- [ ] required registrations, licenses, exemptions, partner responsibilities,
      custody/control analysis, and regulator or contractual approvals;
- [ ] KYC/customer-identification, AML transaction monitoring, sanctions
      screening, blocked-property handling, fraud controls, recordkeeping, and
      suspicious-activity escalation appropriate to the approved model;
- [ ] user agreement, wallet-signature disclosures, risk disclosures, privacy
      notice, cookie/telemetry choices, electronic consent, marketing claims, fee and
      APR presentation, complaint handling, and data retention/deletion;
- [ ] partner contracts and a signed regulatory/custody RACI covering incidents,
      reversals, liquidations, forks/reorgs, downtime, customer support, and records.

The exact obligations depend on the finished product and jurisdictions; this
list deliberately avoids asserting that any specific registration or exemption
applies.

## Security and operational conditions

- [ ] Real extension and mobile-wallet validation is complete on the approved
      exact versions, with sanitized evidence and no production seed phrase or key.
- [ ] Physical-iOS Coinbase same-device and Phantom Browse behavior is validated
      on a separately approved HTTPS preview. Desktop-loopback QR, Android
      `adb reverse`, and iOS Simulator evidence must not be represented as
      coverage for those physical-iOS paths.
- [ ] An independent threat-model review and human-led web/API/wallet-flow
      assessment is complete; material findings are remediated and retested.
- [ ] Production origin allowlists, CSP, telemetry settings, RPC allowlists,
      incident response, dependency monitoring, rollback/kill switches, and vendor
      outage behavior are verified.
- [ ] A release owner confirms that the KAN-222 disposition, complete SBOM,
      product-counsel memo, security attestation, privacy approval, and vendor
      agreements are current and linked from the release record.

## Mandatory re-review

Stop public rollout and re-open the affected decision after a wallet SDK or
license change, vendor-terms change, new connector/chain/jurisdiction, embedded
wallet or custody change, material product-flow change, threshold approach,
security incident, or expiration of an approval. Emergency connector disablement
must not disable account access, withdrawal support, or required customer records.
