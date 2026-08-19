# KAN-226 mobile execution plan

Execution status: **NOT STARTED — DEVICES, FROZEN LAB, AND CLEARANCE REQUIRED**

## M1/M2/M3 definitions

KAN-226 names M1, M2, and M3 without defining them. For this runbook they mean:

| Group                                   | Canonical environments | Required behavior                                                                                                                                        | Current authorization                                                       |
| --------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| M1 — physical cross-device QR           | D3 + P1                | Physical iOS and Android wallets scan an application-owned desktop QR; pair/reject/sign/restore/delete/expire while the dapp remains on desktop loopback | Required after KAN-222 clearance and authorized WalletConnect configuration |
| M2 — mapped/simulator same-device smoke | A1 + S1                | Android through adb reverse and an iOS Simulator where host loopback mapping works; exercise deeplink/in-app/cold/warm/cancel/back/reload behavior       | Optional local smoke; cannot substitute for physical-iOS evidence           |
| M3 — physical same-device HTTPS         | H1                     | Physical iOS and Android browser, Phantom Browse, Coinbase/Base handoff, and WalletConnect return against an approved HTTPS origin                       | Deferred and prohibited until separate Legal/AppSec preview approval        |

## Entry criteria

- KAN-222 records the required independent evaluation-use disposition.
- KAN-224 is frozen and its server/origin configuration matches the test group.
- M1 has two physical operating systems and at least two distinct
  WalletConnect-compatible wallet applications.
- M2 Android has approved platform tools, an authorized physical device, and a
  verified adb reverse mapping. Simulator results are labeled as such.
- M3 has a separately approved HTTPS preview, exact origin allowlists,
  server-side access control, rollback owner, and written Legal/AppSec approval.

## Current equipment preflight

| Capability                         | State on 2026-08-19              | Consequence                                           |
| ---------------------------------- | -------------------------------- | ----------------------------------------------------- |
| Android platform tools / adb       | Not installed                    | A1/M2 cannot start                                    |
| Connected Android test device      | Not available to the agent       | M1/M2 prompts and return paths require a human        |
| iOS Simulator / Xcode              | Unavailable on this Windows host | S1 requires a separate macOS tester                   |
| Physical iOS test device           | Not available to the agent       | M1 QR and M3 same-device require a human              |
| Approved HTTPS preview             | Not authorized                   | Every M3/H1 case stays Deferred/Blocked, never Passed |
| WalletConnect terms/project origin | Not enabled                      | WalletConnect M1 cannot start                         |

## Required wallet coverage

| Target                 | M1                                                                                       | M2                                               | M3                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------- |
| MetaMask Mobile        | Desktop QR scan on iOS and Android                                                       | Android/simulator deeplink smoke where supported | Physical same-device return         |
| Phantom                | WalletConnect-compatible QR only if the exact app/version supports it                    | Android Phantom Browse; simulator smoke          | Physical-iOS Phantom Browse         |
| Coinbase/Base          | Empirically record whether SDK 4.3.7 presents and completes QR; do not pre-claim support | Android/simulator handoff and in-app browser     | Physical-iOS handoff/in-app browser |
| WalletConnect wallet A | iOS or Android QR                                                                        | Applicable mapped/simulator return               | Approved HTTPS return               |
| WalletConnect wallet B | Other OS and a distinct wallet implementation                                            | Applicable mapped/simulator return               | Approved HTTPS return               |

## Result index

Add one row only after a real-device artifact exists.

| Case    | Group/environment | Device/OS | Wallet/version | Result  | UTC | v2 evidence | Defect/exception | Tester |
| ------- | ----------------- | --------- | -------------- | ------- | --- | ----------- | ---------------- | ------ |
| Pending | Pending           | Pending   | Pending        | Not run | —   | —           | —                | —      |

Every unsupported path is Fail/Blocked with a focused defect or an approved,
dated exception. Every M3 case remains **Deferred — separate HTTPS preview
approval required** until that approval exists.
