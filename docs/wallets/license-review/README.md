# KAN-222 wallet SDK license packet

Status: **TWO-PERSON LOCAL/TESTNET EVALUATION AUTHORIZED; PUBLIC USE BLOCKED**

Snapshot date: 2026-08-19

Coordinator: Trey
Independent decision owner: qualified software/OSS licensing counsel

This packet records the isolated `tools/wallet-lab` lock and deliberately
excluded candidates. The project owner authorized at most two project-authorized
people to evaluate it on a loopback-only application using dedicated test wallets
and Ethereum Sepolia, Base Sepolia, or Solana devnet under current package and
service terms. Expected vendor cost is $0.

That is an internal operational authorization and forecast, not legal advice,
vendor classification, or permission for public, external-user, LAN/tunnel,
mainnet, production, paid-tier, customer-data, or real-asset use. The harness has
no transaction action and is excluded from root installs and product builds.

## WalletConnect/Reown activation

WalletConnect remains unavailable unless an authorized evaluator supplies both:

```text
VITE_WALLETCONNECT_TERMS_ACCEPTED=true
VITE_WALLETCONNECT_PROJECT_ID=<valid 32-character hexadecimal project ID>
```

The locked provider and AppKit licenses state that downloading/installing accepts
their terms. Anyone unable or unauthorized to accept them must not run
`npm ci --prefix tools/wallet-lab`; setting the flag to `false` does not prevent
or undo install-time acceptance. For an already authorized installation, the
literal flag is an additional runtime-activation acknowledgement. It does not
prove authority to bind an entity, replace counsel, determine a commercial tier,
or authorize public use. Leaving it `false` then keeps WalletConnect inactive
while the other connectors remain available.

The direct/material review highlights two custom-licensed packages:

- `@walletconnect/ethereum-provider@2.23.10` uses the WalletConnect Community
  License released 2025-08-20; and
- its non-optional `@reown/appkit@1.8.19` dependency uses the Reown Community
  License released 2025-08-25.

The lock-derived
[`reconciliation/see-license-in-license-md.json`](reconciliation/see-license-in-license-md.json)
expands that material view: 20 SPDX package records marked
`SEE LICENSE IN LICENSE.md` resolve to 30 installed package directories and two
distinct installed `LICENSE.md` hashes. This is a mechanical inventory, not a
license classification or approval. Independent counsel/vendor disposition and
full shipped-artifact reconciliation remain pending.

The lab sets `showQrModal: false`, so it does not import/invoke the AppKit modal,
but AppKit is still installed. That setting does not remove AppKit's acceptance,
notice, license-copy, branding, network, or commercial conditions. Both exact
licenses and current service terms require approval and preservation.

## Restricted boundary

- maximum two authorized human evaluators;
- loopback-only dapp with a separate non-workspace package lock;
- dedicated test wallets and approved testnets only;
- connection, disconnect, testnet switching, and ownership-message signing only;
- no transaction, mainnet permission, public URL, tunnel, LAN bind, production
  credential, funded wallet, secret, customer data, or real asset; and
- stop if terms change, usage leaves the forecast $0 tier, another agreement is
  requested, or any boundary above fails.

Testnet RPC and wallet/relay traffic is still third-party data processing.
Coinbase's selected EOA path has no verified telemetry-off control; assume SDK,
extension, transport, operational, and vendor metadata may leave the machine.

## Packet contents and lock identity

- [`candidate-dependencies.json`](candidate-dependencies.json) records direct
  runtime dependencies, material custom-licensed transitives, excluded
  candidates, the lock identity, and audit/override status.
- [`candidate.spdx.json`](candidate.spdx.json) is an SPDX 2.3 inventory of direct
  runtime packages plus material hard-installed AppKit. It is not a complete
  transitive SBOM despite its historical filename.
- [`wallet-lab-lock.spdx.json`](wallet-lab-lock.spdx.json) is the complete
  npm-generated SPDX 2.3 graph for the isolated lock: 475 packages and 1,243
  dependency relationships. Generation is complete; independent license and
  shipped-artifact reconciliation remains pending.
- [`reconciliation/README.md`](reconciliation/README.md) describes the targeted
  custom-license inventory. Its 20 selected SPDX records map to 30 installed
  package directories and two exact license-file hashes; independent legal and
  vendor disposition remains pending.
- [`lock-review-snapshot.json`](lock-review-snapshot.json) binds the source
  commit, lock digest, SPDX digest, generator versions, package counts, and
  point-in-time audit result into one review handoff.
- [`vendor-inquiries.md`](vendor-inquiries.md) contains Reown and Coinbase drafts;
  its MetaMask Connect request is archived because that package is excluded.
- [`public-launch-legal-gate.md`](public-launch-legal-gate.md) blocks any public
  beta, unrestricted preview, or production launch.
- [`../../../tools/wallet-lab/THIRD_PARTY_NOTICES.md`](../../../tools/wallet-lab/THIRD_PARTY_NOTICES.md)
  records the restricted harness notices; it is not a final distribution notice.

The final snapshot lock is lockfile version 3 with 515 package entries. SHA-256:
`D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9`.
Recalculate and re-review after any package operation.

## Approval register

| Decision                               | Status                                         | Evidence still required                                                                                                      |
| -------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Two-person loopback/testnet evaluation | **AUTHORIZED — RESTRICTED**                    | Continuous compliance with this packet                                                                                       |
| Native `@metamask/connect-evm`         | **BLOCKED / NOT INSTALLED**                    | 2.1.1 forces Ethereum-mainnet permission and uses a custom license; any return needs a new technical/security/legal decision |
| MetaMask injected EIP-6963             | **LOCAL EVALUATION ONLY**                      | Public extension/platform, branding, privacy, security, and product review                                                   |
| WalletConnect/Reown local activation   | **CONDITIONALLY AUTHORIZED**                   | Literal terms flag, valid project ID, current terms, two-person/testnet/loopback boundary, expected $0 tier                  |
| WalletConnect provider public use      | **PENDING**                                    | Written commercial classification, usage treatment, exact license/notices, branding/network terms, fees, and expiry          |
| Hard-installed AppKit 1.8.19           | **LOCAL TERMS-GATED / PUBLIC PENDING**         | Separate exact Reown license/notice copy, branding/network terms, classification, and transitive review                      |
| Coinbase 4.3.7 license                 | **OBSERVED / PUBLIC PENDING**                  | Exact tarball contains Apache-2.0; counsel still reviews notices, transitives, service behavior, and distribution            |
| Coinbase telemetry/privacy             | **PENDING**                                    | No verified off control; network inventory and privacy/security approval required                                            |
| Direct/material package inventory      | **RECORDED**                                   | Candidate JSON, direct/material SPDX, lock digest, third-party notice                                                        |
| Targeted custom-license inventory      | **MECHANICALLY RECONCILED / APPROVAL PENDING** | Independently classify both custom agreements, confirm vendor terms, and reconcile shipped artifacts                         |
| Complete lock-derived SBOM             | **GENERATED / RECONCILIATION PENDING**         | Independently reconcile all runtime/build transitives, license conclusions, and shipped artifacts                            |
| Scoped Axios 1.18.0 override           | **CLEAN AUDIT SNAPSHOT / RE-REVIEW REQUIRED**  | Revalidate every lock/config change and remove when upstream permits                                                         |
| Public lending-product legal review    | **PENDING**                                    | Separate product-counsel disposition in the public-launch gate                                                               |

## Material findings

### MetaMask

`@metamask/connect-evm@2.1.1` is absent from `package.json`, has no resolved
installed node, and `npm ls @metamask/connect-evm --all` is empty. Its optional
peer name can still appear in `@wagmi/connectors` metadata; that is not an
installation. It was excluded because reviewed code appends Ethereum mainnet
(`0x1`) to supplied testnet IDs. MetaMask extension uses injected EIP-6963;
MetaMask Mobile uses only the separately gated WalletConnect path.

### WalletConnect/Reown

The configured connector requests no required methods/events. Optional methods
are `personal_sign` and `wallet_switchEthereumChain`; optional events are
`accountsChanged` and `chainChanged`. It uses application RPCs, an
application-owned QR, `showQrModal: false`, and `telemetryEnabled: false`.
Approved wallet scopes still govern every action, and relay/network metadata is
not assumed absent.

Both the provider and hard-installed AppKit licenses state that downloading,
installing, integrating, or using the items accepts their agreements and impose
distribution/service conditions. Low local usage is not a public-tier decision.
Ownership authentication can affect MAU treatment, and fintech/value movement
may receive separate classification. Written classification remains required.

### Coinbase

The exact installed `@coinbase/wallet-sdk@4.3.7` tarball declares Apache-2.0 and
contains an Apache-2.0 license. The connector requests EOA-only mode. It has no
verified telemetry-off control in this selected path, so network-test the exact
build and treat metadata exposure as possible.

### Axios override and audit

The lock scopes Axios to 1.18.0 for the optional AppKit Utils -> Base Account ->
Coinbase CDP SDK path. On 2026-08-19,
`npm audit --prefix tools/wallet-lab` reported zero known vulnerabilities for the
exact lock. AppKit is hard-installed; the lab does not import AppKit/Base Account
and sets `showQrModal: false`.

A clean audit is point-in-time database evidence, not a claim of zero risk or a
complete reachability/security assessment. Re-run tests, audit, and license
review after every override/lock/import/config change and remove the override
when a reviewed upstream tree no longer needs it.

## Business inputs still required

Public connected-wallet and authenticated-account forecasts, vendor RPC volume,
launch/excluded jurisdictions, accepting legal entity, launch dates, and any
embedded-wallet, smart-account, custody, brokerage, exchange, pay-in/pay-out, or
fiat flow remain **TBD**.

Re-open every disposition after any direct/transitive version, license, terms,
advisory, reachability, connector, chain, jurisdiction, or product-flow change.
