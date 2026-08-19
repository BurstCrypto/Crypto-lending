# KAN-223 wallet security review packet

Status: **COORDINATOR PACKET PREPARED; INDEPENDENT APPSEC DECISION PENDING**

This packet is the handoff for the independent review required by KAN-223. It
does not contain or imply a security approval. The implementer may prepare the
scope, evidence, and preliminary risk register, but an AppSec reviewer who did
not implement the adapters must classify the findings and record the final
decision.

## Frozen candidate

| Item                        | Value                                                            |
| --------------------------- | ---------------------------------------------------------------- |
| Validation implementation   | commit 01f7c63a2662734aaf581fd1c2641b85f459fd8b                  |
| Isolated package lock       | tools/wallet-lab/package-lock.json                               |
| Lock SHA-256                | D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9 |
| Lock-derived SPDX           | ../license-review/wallet-lab-lock.spdx.json                      |
| SPDX snapshot               | ../license-review/lock-review-snapshot.json                      |
| Allowed application origin  | authenticated https://127.0.0.1:4173 only                        |
| Allowed networks            | Ethereum Sepolia, Base Sepolia, Solana devnet                    |
| Public or hosted deployment | Not authorized                                                   |

The source commit above freezes the executable candidate. Documentation-only
review commits do not change that candidate. Any executable, dependency, lock,
environment-boundary, connector, RPC, relay, CSP, or evidence-schema change
invalidates the decision and requires a new candidate identity.

The candidate requires a locally trusted certificate and server-only access
credentials before it will listen. Those operator-supplied values are outside
the repository and must be inspected without copying the private key, password,
Basic authorization value, or derived session cookie into review evidence.

## Packet contents

- [threat-model.md](threat-model.md) records assets, actors, trust boundaries,
  data flows, storage, mitigations, owners, residual risks, and the preliminary
  finding register.
- [network-observation-template.md](network-observation-template.md) captures a
  sanitized inventory of RPC, relay, wallet, and telemetry traffic.
- [rollback-runbook.md](rollback-runbook.md) defines the kill switches and the
  drill evidence an independent reviewer must verify.
- [review-decision-template.md](review-decision-template.md) is the independent
  Approved, Conditional, or Rejected decision record.

The manual desktop/mobile execution evidence remains separate because it
requires real wallets and devices. Link those dated results from the decision
record; never paste raw signatures, full addresses, session topics, pairing
URIs, provider objects, credentials, or wallet secrets into this packet.

## Review sequence

1. Confirm the candidate commit and lock hash exactly match the table above.
2. Review the code, dependency packet, threat model, and preliminary findings.
3. Execute the desktop/mobile cases against that exact candidate.
4. Capture the sanitized network inventory and rollback drill.
5. Classify every preliminary finding and add any reviewer findings.
6. Verify that no Critical or High finding remains open.
7. Record an independent decision with reviewer identity, date, conditions,
   expiry, and re-review triggers.

Until step 7 is complete, KAN-223 remains In Progress and KAN-55 must not be
represented as security-approved.
