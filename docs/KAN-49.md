# KAN-49: Platform threat model and data classification

KAN-49 / SEC-001 now has a local, repository-wide threat-model review packet.
It consolidates the previously separate account, authentication, wallet,
ledger, outbox, administrator/control-plane, secret, infrastructure, chain,
and supply-chain boundaries without claiming that a local author can approve
their own security work.

## Acceptance mapping

| Jira requirement                                       | Local evidence                                                                                                                                                                                                                                              | Status                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Trust boundaries                                       | Baseline customer, workload, state, provider, wallet, ledger, operator, administrator, chain, and supply-chain records plus a human system flow                                                                                                             | Ready for review                                                                   |
| Account, wallet, ledger, and administrator abuse cases | Baseline High-risk STRIDE rows cover all four areas plus secrets, supply chain, and availability                                                                                                                                                            | Ready for review                                                                   |
| Key and secret inventory                               | Seventeen metadata-only credential/key classes include application, bootstrap, wallet-lab, three purpose-distinct wallet-registration keys, ledger, Jira, and production authority classes with consumer, injection, storage, rotation, owner, and evidence | Ready for review; KAN-50 custody and rotation remain external gates                |
| Retention considerations                               | Nineteen data assets and a per-store retention/deletion matrix distinguish validity, retention, and unresolved policy                                                                                                                                       | Ready for review; governance decisions remain open                                 |
| Data-classification matrix                             | Exact `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`, and `PROHIBITED` levels with handling rules                                                                                                                                                       | Ready for review                                                                   |
| Every High-risk threat has mitigation and owner        | Validator requires mitigation, accountable repository role, residual risk, evidence, and follow-up on every row                                                                                                                                             | Ready for review; independent reviewer must confirm individual DRI/role assignment |
| Security approves the model and matrix                 | KAN-235 is the independent approval subtask and remains pending                                                                                                                                                                                             | External gate; not locally complete                                                |

The authoritative record is
[`security/threat-model-register.json`](security/threat-model-register.json).
Its reviewed sidecar is
[`security/threat-model-register.sha256`](security/threat-model-register.sha256),
and the narrative review view is
[`security/threat-model.md`](security/threat-model.md).

## Fail-closed validator

The dependency-free validator rejects:

- missing or duplicate trust-boundary, data, secret, or threat identifiers;
- removal of any reviewed baseline identifier or addition of an unknown schema
  field;
- missing major threat-domain coverage;
- unknown classification, CIA, STRIDE, risk, response, or status values;
- dangling threat-to-boundary or threat-to-data references;
- a High/Critical local risk acceptance;
- missing threat mitigation, owner, residual risk, evidence, or follow-up;
- a `PROHIBITED` asset that names storage or any treatment other than
  `NEVER_COLLECT` and `NEVER` logging;
- secret-material-shaped fields in the inventory;
- missing repository evidence paths;
- directory, traversal, or symlink evidence escapes;
- a fabricated local approval or broadened decision/binding vocabulary;
- malformed UTF-8, byte-order marks, or duplicate JSON object keys;
- empty, oversized, linked, replaced, or unstable register/sidecar files;
- a sidecar other than exactly one lowercase SHA-256 plus LF;
- any drift between the canonical JSON bytes and its SHA-256 sidecar; and
- any drift from the compiled reviewed register fingerprint.

The register is capped at 128 KiB and its sidecar at exactly 65 bytes. Both are
loaded through a canonical-path, single-link, descriptor-bound stable double
read. The compiled fingerprint prevents a semantically valid edit from being
self-resealed with a new sidecar without an explicit validator change. It is a
local review-integrity control only; KAN-235 remains the independent approval
gate and must bind the eventual merged commit and tree.

The validator is part of `infra:validate`, and its mutation tests are part of
the local/CI unit gate. This is a document-integrity control, not a security
approval or proof of a deployed environment.

## Local verification

```powershell
npm run security:validate:threat-model
npm run security:test:threat-model
npm run security:scan:secrets
npm run security:test:secrets
npm run infra:validate
npm run format:check
git diff --check
```

These commands use repository files and local child processes only. They do
not deploy, call AWS, activate an identity/wallet/chain provider, dispatch
hosted CI, or invoke a paid scanner.

## Remaining gates

KAN-49 can move to `In Review` after the packet and local checks land. It must
not move to `Done` until KAN-235 records an independent decision against the
exact Git commit SHA, Git tree SHA, and register SHA-256 and confirms each
High/Critical mitigation, residual risk, and accountable owner.

The register deliberately keeps these unresolved controls visible:

- provider selection, MFA/recovery/logout, production auth-key injection and
  key rotation;
- deployed wallet-registration concurrency and key custody, real-wallet/privacy
  evidence, connector chain provenance, and a separately approved design for
  any contract-wallet RPC, wallet login, or transaction authority;
- population and custody of every currently empty production authority and
  destination registry; independently signed post-provision target-identity
  enrollment; separately branded live-state evidence; and a strongly consistent
  atomic destination-epoch/deployment-head reservation, consumption, fencing,
  emergency-kill, and ambiguous-outcome reconciliation boundary. The verifier's
  `CLAIMED_INERT_DEPLOYED` status can authenticate only a signed target-identity
  claim; it is not a live-state or execution-authority grant;
- provider finality/reorganization/reconciliation and price/depeg policy;
- database-owner/break-glass evidence and an administrator authorization,
  masking, and immutable-audit boundary;
- customer/authentication/financial/audit retention, deletion, archival, DSAR,
  and legal-hold policy;
- deployed IAM, secret rotation, log access/retention, full-hop TLS, edge/load,
  and queue/dashboard evidence; KAN-248 now supplies only a versioned
  `NOT_EFFECTIVE` logging-governance draft while KAN-220 and independent
  Security/Privacy/Operations decisions remain pending; and
- independent dependency/image and exact-release provenance review.

No provider, cloud, wallet, hosted workflow, paid review, or other billable
action was used to create this local packet.
