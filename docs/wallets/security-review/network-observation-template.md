# Sanitized wallet network observation

Use one copy per frozen candidate and test environment. This is a metadata
inventory, not a packet capture attachment. Do not retain URLs containing
pairing data, query values, request/response bodies, headers, cookies, tokens,
signatures, full addresses, device identifiers, or credentials.

## Run identity

| Field                                        | Value                                                            |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Executable candidate commit                  | a0fc8527172cd29743c5d6475cf6264bbd6bde05                         |
| `tools/wallet-lab` Git tree                  | 58ba5e657d4584e60ce2db41aecf6d7a265d4351                         |
| Package-lock SHA-256                         | D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9 |
| Package manifest SHA-256                     | E778E4C862E919FE4BD3081EB61076E9EAB1C7144E6197DDE5A97FC35C554F06 |
| UTC start/end                                | Pending                                                          |
| Tester                                       | Pending                                                          |
| Environment ID                               | Pending                                                          |
| OS/browser/version                           | Pending                                                          |
| Wallets/versions                             | Pending                                                          |
| Capture tool/version                         | Pending                                                          |
| HTTPS trust/access-control preflight         | Not run / Pass / Fail                                            |
| WalletConnect terms/project-origin preflight | Not run / Pass / Fail                                            |

## Observed destinations

Record only scheme, host, port, transport, and a high-level request class.

| Connector | Scheme/host/port | Transport | Request class | Expected by CSP/config | Identifier or payload observed | Retention/telemetry conclusion | Follow-up |
| --------- | ---------------- | --------- | ------------- | ---------------------- | ------------------------------ | ------------------------------ | --------- |
| Pending   | Pending          | Pending   | Pending       | Yes / No               | None / Redacted category       | Pending                        | Pending   |

Expected configured classes include the selected Sepolia/Base Sepolia RPC
origins, WalletLink relay, and—only when separately enabled—the WalletConnect
relay and verification services. Additional destinations are a failed or
blocked result until reviewed.

## Privacy/security decision

| Field                           | Value                                            |
| ------------------------------- | ------------------------------------------------ |
| Unexpected destinations         | Pending                                          |
| Sensitive fields observed       | Pending                                          |
| Telemetry-off behavior verified | Pending                                          |
| Sanitized evidence link         | Pending                                          |
| Reviewer and date               | Pending                                          |
| Result                          | Approved / Conditional / Rejected / Not reviewed |
| Conditions and retention limits | Pending                                          |

Delete the raw capture according to the reviewer-approved retention rule after
the sanitized inventory and necessary defect evidence are accepted.
