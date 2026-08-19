# Sanitized wallet network observation

Use one copy per frozen candidate and test environment. This is a metadata
inventory, not a packet capture attachment. Do not retain URLs containing
pairing data, query values, request/response bodies, headers, cookies, tokens,
signatures, full addresses, device identifiers, or credentials.

## Run identity

| Field                                        | Value                                                            |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Candidate commit                             | 01f7c63a2662734aaf581fd1c2641b85f459fd8b                         |
| Package-lock SHA-256                         | D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9 |
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
