# Third-party notices for the restricted wallet lab

This file records the direct runtime packages and the material hard-installed
custom-licensed dependency locked for the localhost-only evaluation. It is not a
complete transitive SBOM, a legal conclusion, or a final distribution notice.
The exact installed package license files control and must be preserved and
reviewed with the final transitive lock before distribution.

## Reown / WalletConnect notice

Portions © 2025 Reown, Inc. All Rights Reserved.

`@walletconnect/ethereum-provider@2.23.10` declares `SEE LICENSE IN LICENSE.md`
and is governed by the WalletConnect Community License Agreement released
2025-08-20. The exact installed copy is at
`node_modules/@walletconnect/ethereum-provider/LICENSE.md` after `npm ci` in this
directory. The source snapshot is also available from the
[WalletConnect monorepo](https://github.com/WalletConnect/walletconnect-monorepo/blob/2d064b82a9e0b3f52b4e5cd778663b129440fade/providers/ethereum-provider/LICENSE.md).

That agreement imposes more than a copyright notice, including network, terms,
commercial-threshold, branding, and license-copy conditions. Local activation
means using the package under the current terms. Any distributed application or
public service must include the exact required license copy and notice only after
the KAN-222 legal gate is closed.

### Hard-installed Reown AppKit dependency

`@walletconnect/ethereum-provider@2.23.10` has a non-optional dependency on
`@reown/appkit@1.8.19`. AppKit is therefore installed even though the lab does
not import its modal and configures `showQrModal: false`.

AppKit declares `SEE LICENSE IN LICENSE.md` and its installed file is the Reown
Community License Agreement released 2025-08-25. The exact copy is at
`node_modules/@reown/appkit/LICENSE.md` after `npm ci` in this directory. It
separately states that downloading, installing, integrating, or using the
AppKit items accepts its terms and requires, for distribution or a service, the
Reown copyright notice above, a copy of that AppKit license, and applicable logo
and branding handling. The WalletConnect provider license and AppKit license are
two distinct custom-license artifacts; both must be preserved and approved.

## Direct runtime packages

| Package                            | Locked version | Declared license in installed package                         |
| ---------------------------------- | -------------: | ------------------------------------------------------------- |
| `@coinbase/wallet-sdk`             |          4.3.7 | Apache-2.0                                                    |
| `@solana/wallet-standard-features` |          1.4.0 | Apache-2.0                                                    |
| `@tanstack/react-query`            |        5.101.4 | MIT                                                           |
| `@wagmi/connectors`                |          8.1.0 | MIT                                                           |
| `@wallet-standard/app`             |          1.1.1 | Apache-2.0                                                    |
| `@wallet-standard/base`            |          1.1.1 | Apache-2.0                                                    |
| `@wallet-standard/features`        |          1.1.1 | Apache-2.0                                                    |
| `@walletconnect/ethereum-provider` |        2.23.10 | WalletConnect Community License (`SEE LICENSE IN LICENSE.md`) |
| `qrcode.react`                     |          4.2.0 | ISC                                                           |
| `react`                            |         19.2.8 | MIT                                                           |
| `react-dom`                        |         19.2.8 | MIT                                                           |
| `viem`                             |        2.55.18 | MIT                                                           |
| `wagmi`                            |          3.7.6 | MIT                                                           |

## Material hard-installed transitive package

| Package         | Locked version | Relationship                                                  | Declared license in installed package                 |
| --------------- | -------------: | ------------------------------------------------------------- | ----------------------------------------------------- |
| `@reown/appkit` |         1.8.19 | Non-optional dependency of `@walletconnect/ethereum-provider` | Reown Community License (`SEE LICENSE IN LICENSE.md`) |

The lock also scopes `axios` to 1.18.0 for the optional AppKit Utils -> Base
Account -> Coinbase CDP SDK path. The 2026-08-18 npm-audit snapshot reports zero
known vulnerabilities for the exact lock. That point-in-time result is not a
claim of zero supply-chain or runtime risk.

The exact `@coinbase/wallet-sdk@4.3.7` tarball installed by the lock contains an
Apache-2.0 `LICENSE` file. This resolves the license-file question for the locked
artifact; counsel must still approve its notices, transitive dependencies,
service behavior, and public use.

`@metamask/connect-evm` is not a direct dependency and is not installed. It is
excluded because its reviewed 2.1.1 connection flow forces an Ethereum-mainnet
permission and its package uses a custom license. MetaMask extension support in
this lab comes from EIP-6963/injected provider discovery; MetaMask Mobile uses
the separately gated WalletConnect connector.
