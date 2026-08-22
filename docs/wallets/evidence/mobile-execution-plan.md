# KAN-226 mobile execution plan

Execution status: **NOT STARTED - NO REAL-DEVICE RESULT EXISTS**

- Execution owner: KAN-226.
- Candidate-freeze owner: KAN-224.
- Consolidated status: [KAN-227](../KAN-227.md).

Every M1, M2, and M3 path remains `NOT_RUN`. No exact mobile wallet version,
device model, mobile OS/browser version, tester, UTC interval, schema-v3
artifact, focused defect, or approved exception is recorded.

## M1/M2/M3 definitions

KAN-226 names M1, M2, and M3 without defining them. For this runbook they mean:

| Group                                   | Canonical environments | Required behavior                                                                                                                                        | Current authorization                                                       |
| --------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| M1 - physical cross-device QR           | D3 + P1                | Physical iOS and Android wallets scan an application-owned desktop QR; pair/reject/sign/restore/delete/expire while the dapp remains on desktop loopback | Required after KAN-222 clearance and authorized WalletConnect configuration |
| M2 - mapped/simulator same-device smoke | A1 + S1                | Android through adb reverse and an iOS Simulator where host loopback mapping works; exercise deeplink/in-app/cold/warm/cancel/back/reload behavior       | Optional local smoke; cannot substitute for physical-iOS evidence           |
| M3 - physical same-device HTTPS         | H1                     | Physical iOS and Android browser, Phantom Browse, Coinbase/Base handoff, and WalletConnect return against an approved HTTPS origin                       | Deferred and prohibited until separate Legal/AppSec preview approval        |

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

| Capability                         | Recorded state                                                                           | Consequence                                           | Owner / decision ticket |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------- |
| Exact executable candidate         | 2026-08-22 packet: replacement `a0fc852...` / tree `58ba5e6...` is prepared but untested | Verify the clean candidate at run start               | KAN-224                 |
| Android platform tools / adb       | 2026-08-19: not installed                                                                | A1/M2 cannot start                                    | KAN-226                 |
| Connected Android test device      | 2026-08-19: not available to the agent                                                   | M1/M2 prompts and return paths require a human        | KAN-226                 |
| iOS Simulator / Xcode              | 2026-08-19: unavailable on this Windows host                                             | S1 requires a separate macOS tester                   | KAN-226                 |
| Physical iOS test device           | 2026-08-19: not available to the agent                                                   | M1 QR and M3 same-device require a human              | KAN-226                 |
| Approved HTTPS preview             | 2026-08-19: not authorized                                                               | Every M3/H1 case stays Deferred/Blocked, never Passed | KAN-226 + Legal/AppSec  |
| WalletConnect terms/project origin | 2026-08-19: not enabled                                                                  | WalletConnect M1 cannot start                         | KAN-226 / KAN-222       |

These are entry blockers or explicit deferrals, not executed failures or
approved exceptions. M3 remains outside the current authorization even after a
replacement local candidate is frozen.

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

| Case    | Group/environment | Device/OS | Wallet/version | Result  | UTC | v3 evidence | Defect/exception | Tester |
| ------- | ----------------- | --------- | -------------- | ------- | --- | ----------- | ---------------- | ------ |
| Pending | Pending           | Pending   | Pending        | Not run | N/A | N/A         | N/A              | N/A    |

Every unsupported path is Fail/Blocked with a focused defect or an approved,
dated exception. Every M3 case remains **Deferred - separate HTTPS preview
approval required** until that approval exists.
