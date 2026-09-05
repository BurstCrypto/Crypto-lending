# Logging governance decision packet (draft)

Version `0.1.0-draft` is a local review proposal for KAN-248. Its status is
`DRAFT_PENDING_EXTERNAL_APPROVAL` and it is **not effective policy**. KAN-220
is still `TO_DO`; Security, Privacy, and Operations have not approved this
packet. The repository author cannot convert this draft into an approval.

The canonical machine record is
[`logging-governance-decision.json`](logging-governance-decision.json). Its
sidecar binds the exact packet bytes after local validation. Validation requires
strict UTF-8 JSON and rejects byte-order marks and duplicate object keys at any
depth before evaluating approval fields or the sidecar. A future decision
must instead bind the exact merged Git commit, tree, packet SHA-256, and logger
contract SHA-256; a branch commit, Jira transition, local test, or sidecar alone
cannot satisfy that gate.

## Proposed decision boundary

All structured application-log records are `RESTRICTED` because otherwise
innocuous diagnostic identifiers become customer, security, and financial
metadata when joined. `initiatorActorId` is the verified internal account UUID
and is diagnostic only. The fixed `service` and closed `workload` identify the
software executor, not the customer. Caller-provided actor, request, or trace
values never become authoritative.

The packet inventories every currently allowed linkage field:
`correlationId`, `requestId`, `initiatorActorId`, `jobId`, `messageId`,
`intentId`, `quoteId`, `transactionId`, `ledgerEventId`, `traceId`, `spanId`,
and `parentSpanId`. Intent and quote identifiers remain allowlisted but are not
claimed as proven real-domain runtime paths. Job and message identifiers are
domain-separated diagnostic hashes; that treatment does not make arbitrary
sensitive input safe. Every field remains subject to the exact event catalog
and logger projection rules in KAN-51.

The proposed access model is default-deny and separates environment, workload
writer, incident reader, Privacy, configuration administration, Records hold,
audit, and break-glass capabilities. Application tasks can append only to their
own workload group and cannot read, query, export, change retention, or delete.
Production access has no developer inheritance. Every grant, denial, query,
export, lifecycle change, hold, and break-glass action requires a separate
administrative audit record.

## Retention and financial-record separation

Fourteen days remains the proposed standard application-log retention. The
template's other exact allowed values (`1`, `3`, `5`, `7`, `30`, `60`, and
`90`) require an environment-specific, time-bound exception before deployment.
Normal expiry is not a legal hold. A proposed hold exports only the minimized
case result to a separately approved evidence store with integrity and
disposition metadata; no such store or process is implemented or approved.

Operational logs are never the book of record. A `transactionId` or
`ledgerEventId` is only a pointer to a separately authorized authoritative
query. Log access, expiry, deletion, export, hold, and hold release cannot
change append-only account audit, journal, posting, lifecycle, outbox,
reconciliation, or approval records. Financial corrections remain new reversal
or compensation records under the ledger policy.

## Required decisions before effect

- KAN-220 completes and its reviewed output is reconciled into this packet.
- Security approves classification, least privilege, audit, incident-query,
  and break-glass controls.
- Privacy approves purpose limitation, actor lookup, evidence minimization,
  data-subject handling, deletion, and legal-hold interaction.
- Operations confirms deployable environment separation, identity lifecycle,
  audit capture, retention/deletion, query templates, and break-glass
  activation/revocation.
- Legal, Records, and Finance confirm the case-evidence schedule and immutable
  financial-record boundary.
- Independent decisions bind the merged commit/tree plus packet and logger
  contract hashes.
- A separately authorized non-production exercise proves effective controls.

Until every applicable gate is recorded, the only permissible use of this
packet is local review and validation. It authorizes no cloud query, export,
role grant, retention change, deletion, hold, deployment, or paid service.
