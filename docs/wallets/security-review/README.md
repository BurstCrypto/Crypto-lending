# KAN-223 wallet security review packet

Status: **CONSOLIDATED HANDOFF PREPARED; INDEPENDENT APPSEC DECISION PENDING**

Packet audit date: **2026-08-22**

This packet is the handoff for the independent review required by KAN-223. It
does not contain or imply a security approval. The implementer may prepare the
scope, evidence, and preliminary risk register, but an AppSec reviewer who did
not implement the adapters must classify the findings and record the final
decision.

No independent AppSec signer, review date, decision expiry, permitted
environment, or accepted finding disposition is recorded. The human
[KAN-227 consolidation packet](../KAN-227.md) and its
[machine-readable register](../review/kan-227-consolidated-review.json) preserve
those fields as pending.

## Frozen candidate

| Item                                      | Value                                                            |
| ----------------------------------------- | ---------------------------------------------------------------- |
| Packet-preparation base commit            | d0408a2d9727b434734a4add52598a5886832e61                         |
| Frozen wallet executable commit           | a0fc8527172cd29743c5d6475cf6264bbd6bde05                         |
| `tools/wallet-lab` Git tree               | 58ba5e657d4584e60ce2db41aecf6d7a265d4351                         |
| Isolated package lock                     | tools/wallet-lab/package-lock.json                               |
| Lock SHA-256                              | D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9 |
| Package manifest SHA-256                  | E778E4C862E919FE4BD3081EB61076E9EAB1C7144E6197DDE5A97FC35C554F06 |
| Lock-derived SPDX                         | ../license-review/wallet-lab-lock.spdx.json                      |
| SPDX snapshot                             | ../license-review/lock-review-snapshot.json                      |
| KAN-227 consolidated disposition register | ../review/kan-227-consolidated-review.json                       |
| Final review-packet commit and tree       | Pending after the consolidated packet lands                      |
| Final register SHA-256                    | Pending after the consolidated packet lands                      |
| Allowed application origin                | authenticated https://127.0.0.1:4173 only                        |
| Allowed networks                          | Ethereum Sepolia, Base Sepolia, Solana devnet                    |
| Public or hosted deployment               | Not authorized                                                   |

The frozen wallet executable commit is the last commit that changed
`tools/wallet-lab`. The later packet-preparation base contains the identical
wallet-lab Git tree but does not contain the eventual KAN-227 packet and is not
an approval binding. Documentation-only review commits do not change the
executable candidate. Any executable, dependency, lock, environment-boundary,
connector, RPC, relay, CSP, or evidence-schema change invalidates the executable
commit/tree or artifact hashes and requires the KAN-227 register and every
dependent decision to be regenerated.

An independent decision must bind the frozen executable commit/tree and artifact
hashes plus the eventual Git commit, Git tree, and KAN-227 register SHA-256 that
contain the complete review packet. Those final packet values do not exist yet
and remain `Pending`; never substitute the preparation-base commit for them.

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
- The [KAN-227 consolidated register](../review/kan-227-consolidated-review.json)
  binds the Security, Legal/OSS, Privacy, Engineering, Product, and Release
  decisions/sign-offs plus live-evidence outcomes without converting any pending
  row into an approval.

The manual desktop/mobile execution evidence remains separate because it
requires real wallets and devices. Link those dated results from the decision
record; never paste raw signatures, full addresses, session topics, pairing
URIs, provider objects, credentials, or wallet secrets into this packet.

## Review sequence

1. Confirm the frozen executable commit/tree and manifest/lock hashes exactly
   match the table above.
2. Review the code, dependency packet, threat model, and preliminary findings.
3. Execute the desktop/mobile cases against that exact candidate.
4. Capture the sanitized network inventory and rollback drill.
5. Classify every preliminary finding and add any reviewer findings.
6. Verify that no Critical or High finding remains open.
7. Record an independent decision with reviewer identity, date, conditions,
   expiry, and re-review triggers in a signed review record. A future
   evidence-ingestion schema for the KAN-227 register must bind that record
   before any terminal decision or readiness claim; the current schema-v1
   register remains pending-only.

Until step 7 is complete, KAN-223 acceptance remains incomplete and KAN-55 must
not be represented as security-approved.
