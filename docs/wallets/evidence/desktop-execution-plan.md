# KAN-225 desktop execution plan

Execution status: **NOT STARTED — FROZEN LAB AND CLEARANCE REQUIRED**

## Entry criteria

- KAN-222 records the required independent evaluation-use disposition.
- KAN-224 has a frozen executable commit and matching package-lock SHA-256.
- The candidate passes lint, typecheck, unit tests, audit, access-boundary
  checks, and the rollback preflight.
- Dedicated test wallets and disposable browser profiles are available.
- The tester has reviewed the redaction rules and current vendor terms.

Do not record a result against the historical implementation commit after any
executable, dependency, lock, connector, RPC, CSP, or evidence-schema change.

## Environment preflight

The following was detected on the Windows workstation on 2026-08-19. Detection
is not execution evidence; re-record exact versions when each case runs.

| Environment                 | Current readiness | Detected software                                                            | Required action                                                                                                   |
| --------------------------- | ----------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| D1 Chromium multi-extension | Partial           | Chrome 151.0.7922.138; MetaMask 13.43.0.0; Phantom 26.25.0; Coinbase 3.143.0 | Create a dedicated profile, verify exact enabled extension IDs/versions, and use disposable test wallets          |
| D2 Firefox                  | Blocked           | Firefox not installed                                                        | Install a supported current Firefox and applicable extensions; document Phantom's official absence                |
| D3 clean browser / QR       | Blocked           | Edge 151.0.4129.93 is available                                              | Create a no-extension profile; obtain KAN-222 clearance and authorized WalletConnect project/origin configuration |

## Required coverage

| Group                       | Required cases                                      | Exit                                                                                        |
| --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Common connection lifecycle | C01-C17 where applicable                            | Each case has one v3 result per target/environment                                          |
| Concurrent independent EVM  | C18 and CB07                                        | Pass, or a focused owned defect/explicitly approved exception; deferral alone is not a Pass |
| MetaMask extension          | MM01, MM04-MM06                                     | D1 result for discovery, account selection, permission removal, and errors                  |
| Phantom extension           | PH01, PH03-PH07 where desktop-applicable            | D1 result; D2 absence recorded accurately                                                   |
| Coinbase/Base extension     | CB01, CB05, CB06, CB08                              | D1 result plus sanitized network inventory                                                  |
| WalletConnect clean browser | WC01, WC03-WC06, WC08-WC11 where desktop-applicable | D3 result; phone-scanned QR cases cross-link their M1 result                                |

The candidate now implements one concurrent session per distinct approved EVM
connector. C18 and CB07 must exercise MetaMask plus the explicit Coinbase
connector in D1; a WalletConnect-plus-injected variant is additional coverage
only after the separate WalletConnect clearance. Do not test or claim duplicate
sessions for one connector, two WalletConnect sessions, or multiple selected
accounts within one connector. No real concurrency result has been recorded.

## Reset between cases

1. Export and inspect the current sanitized v3 run.
2. Disconnect/delete the test session in the wallet.
3. Revoke the dapp's extension permission where the case requires a clean grant.
4. Clear the dedicated profile's site/vendor storage when the case requires a
   clean pairing; record what was cleared without copying values.
5. Confirm the lab is disconnected and signing-disabled.
6. Record the next case's exact commit, lock, browser, extension, and UTC start.

## Result index

Add one row only after a result artifact exists.

| Case    | Environment | Wallet/version | Result  | UTC | v3 evidence | Defect/exception | Tester |
| ------- | ----------- | -------------- | ------- | --- | ----------- | ---------------- | ------ |
| Pending | Pending     | Pending        | Not run | —   | —           | —                | —      |

KAN-225 remains In Progress until all required rows are Pass, Fail/Blocked with
a focused defect, or covered by an explicitly approved documented exception.
