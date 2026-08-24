# Incident log-query runbook (draft)

This is the version `0.1.0-draft` operating companion to KAN-248. It is a
review packet, not authorization to query any managed backend. KAN-220 remains
`TO_DO`; Security, Privacy, and Operations decisions remain `PENDING`; no log
reader role, evidence store, legal-hold workflow, or break-glass path has been
approved or proven. Use this runbook only for local review until those gates
are satisfied against an exact merged revision.

The controlling machine record is
[`logging-governance-decision.json`](logging-governance-decision.json). If this
runbook and that record disagree, stop. Update and re-review both; do not choose
the more permissive interpretation.

## Non-negotiable boundaries

- Structured application logs and every correlation identifier are
  `RESTRICTED` operational data.
- Logs are diagnostic and non-authoritative. They cannot authenticate a
  principal, grant access, establish tenancy, calculate a balance, prove
  approval or finality, or direct a financial state change.
- `transactionId` and `ledgerEventId` are pivots to a separately authorized
  source-of-record query. Log results are not ledger or accounting evidence.
- Never search for or project credentials, raw headers, bodies, queries, URLs,
  IP addresses, contact or residency data, wallet material, signatures,
  provider payloads, idempotency keys, chain hashes, amounts, balances,
  postings, SQL, exception text, environment values, or other fields prohibited
  by KAN-49/KAN-51.
- Log expiry, deletion, export, hold, or hold release must not modify or weaken
  append-only account audit, journal, posting, lifecycle, outbox,
  reconciliation, approval, reversal, or compensation records.
- Do not paste restricted identifiers or query results into Jira, chat, email,
  source control, shell history, or an ordinary screenshot.

## Authorized use cases

Every query names exactly one use-case ID and a case or approved change
reference.

| Use-case ID                    | Permitted purpose                                                                                 | Initial selector                                                         | Required involvement                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| `INCIDENT_CAUSAL_TRACE`        | Diagnose one reported request, job, message, or application trace                                 | Exact `correlationId`, `requestId`, `jobId`, `messageId`, or `traceId`   | Assigned on-call operator; Security on escalation       |
| `SECURITY_ACCOUNT_ACTIVITY`    | Investigate suspected compromise, authorization failure, or abuse for one verified internal actor | Exact `initiatorActorId`, `correlationId`, or `requestId`                | Security case and documented Privacy purpose            |
| `FINANCIAL_WORKFLOW_DIAGNOSIS` | Locate operational failures around one known immutable financial record                           | Exact `transactionId`, `ledgerEventId`, or `correlationId`               | On-call/Security; Ledger/Finance for authoritative read |
| `BOUNDED_SERVICE_TRIAGE`       | Find a service failure when no safe correlation identifier is known                               | Exact event/error/workload template in a fifteen-minute aggregate window | Assigned on-call operator                               |
| `LEGAL_PRIVACY_CASE`           | Collect a minimized result under documented Legal or Privacy authority                            | Exact approved actor, correlation, transaction, or ledger-event ID       | Privacy plus Legal/Records; Security for access/export  |

Curiosity, marketing, product analytics, customer segmentation, bulk behavior
profiling, employee performance review, credential discovery, and general data
exploration are prohibited. A query may not be repurposed after execution; a
new purpose requires a new case authorization.

## Roles and separation

Use a named workforce identity, phishing-resistant MFA, and a fresh short-lived
session. Shared accounts and long-lived access keys are prohibited.

- An application task may append allowlisted events only to its own
  environment/workload group. It has no query, read, export, retention, delete,
  or hold capability.
- A developer has no inherited production access. Local/development evidence
  does not grant staging or production rights.
- An on-call or Security role names one incident environment and exact log
  groups. Cross-environment queries are denied.
- The Privacy responder authorizes actor purpose and reviews minimized results;
  that is not standing general-query access.
- The log configuration administrator manages an exact group under change
  control but has no routine content-reading role.
- The Records custodian receives only an approved minimized export in the
  approved evidence store and cannot mutate source logs or financial records.
- The access auditor reads administrative access/query metadata, not
  application-log content.

These are required target controls, not claims about currently effective IAM.
Operations must prove the deployed positive and negative permissions in a
separately authorized non-production exercise.

## Query authorization worksheet

The requester and approver record the following without copying raw result
data into the worksheet:

```text
caseOrChangeReference:
authorizedUseCaseId:
requesterWorkforcePrincipal:
requestedRole:
environment:
exactLogGroups:
utcStartInclusive:
utcEndExclusive:
eventAllowlist:
primarySelectorField:
primarySelectorParameterFingerprint:
projectedFieldAllowlist:
queryTemplateIdAndVersion:
expectedPurposeAndStopCondition:
SecurityApprovalReferenceIfRequired:
PrivacyPurposeReferenceIfRequired:
OperationsExpansionReferenceIfRequired:
evidenceExportRequested: false
```

`primarySelectorParameterFingerprint` is a one-way audit fingerprint of the
restricted parameter. It is not permission to replace the exact parameter in
the protected query interface with a hash; the backend query must match the
field's actual validated representation. The raw selector stays only in the
approved interface/session and must not enter the general access audit event.

## Minimum query shape

Every query must include all of the following:

1. one case/change reference and one authorized use-case ID;
2. one environment and exact log groups for the involved workloads;
3. inclusive UTC start and exclusive UTC end;
4. an event-name allowlist;
5. an explicit projected-field allowlist; and
6. one exact approved primary selector, or the reviewed aggregate discovery
   template.

Start with at most 120 minutes around a known event. `BOUNDED_SERVICE_TRIAGE`
starts with at most fifteen minutes and returns aggregate counts by approved
event, outcome, error code, service, and workload only. Any query beyond 24
hours requires Security, Privacy, and Operations scope approval. A narrower
legal, incident, or cost limit takes precedence.

The default projection is:

```text
timestamp, event, level, service, workload, environment,
correlationId, requestId, outcome, errorCode
```

Do not use `select *`. `initiatorActorId` is excluded by default and may be
searched or projected only for `SECURITY_ACCOUNT_ACTIVITY` or
`LEGAL_PRIVACY_CASE` with a recorded Privacy purpose. `transactionId` and
`ledgerEventId` may be selected only for `FINANCIAL_WORKFLOW_DIAGNOSIS` or
`LEGAL_PRIVACY_CASE`, and only to pivot to an authoritative query.

## Procedure

### 1. Establish the case and safe starting point

Record impact, reporter, incident environment, suspected time, and authorized
purpose. Prefer the server-returned request ID or another already-valid internal
identifier. Do not ask a reporter to paste an authorization header, cookie,
wallet proof, request body, provider payload, or other prohibited value.

If the starting identifier is untrusted or fails its canonical format, stop.
Resolve it through the owning application boundary; do not broaden the query or
hash arbitrary input and assume it became safe.

### 2. Activate the narrow role

Use the normal role for the exact environment and groups. Confirm that the
administrative audit sink is available before querying. The audit pre-event
records principal, assumed role, case, purpose, groups, UTC window, event and
projection allowlists, query-template version, parameter fingerprint, and
approvals without raw values.

If the audit pre-event cannot be recorded, do not query. A declared severity-one
incident may use break-glass under the separate section below; tool failure by
itself is not enough.

### 3. Run the first bounded query

Use the shortest useful time window, one selector, exact events, and the default
projection. Set a result and scanned-volume ceiling in the approved query
backend. Stop when the target causal root is found or the documented stop
condition is met.

Record safe result metadata in the administrative audit trail: start/end time,
outcome, result count, scanned bytes, returned bytes, and duration. Do not put
raw result rows or selector values in that audit event.

### 4. Validate linkage before pivoting

Check that formats and meanings agree with the logger contract:

- `requestId` equals its root `correlationId`;
- `jobId` and `messageId` use their respective domain-separated diagnostic
  forms;
- `traceId`, `spanId`, and `parentSpanId` appear only on
  `trace.span.completed` under the current event allowlist;
- actor and domain identifiers are absent from trace records;
- anonymous or failed authentication has no `initiatorActorId`; and
- carried worker actor/correlation context is diagnostic and is not the worker's
  authorization input.

Do not infer that a missing event proves an operation did not occur. Delivery,
sampling, suppression, retention, logger failure isolation, or an unimplemented
producer can explain absence.

### 5. Expand one dimension at a time

First expand the UTC window within 24 hours, then add one causally linked
workload/group, then add one explicitly needed projected field. Record the
reason and the changed bound before each rerun. Never expand environments in
the same query.

Actor lookup, unlinked cross-service expansion, a window beyond 24 hours, or
materially greater scan/cost requires the approvals named in the policy. If the
selector cannot be resolved after bounded expansion, escalate to the owning
service and stop querying.

### 6. Handle a financial pivot

For a known `transactionId` or `ledgerEventId`, record only the diagnostic
event sequence needed to identify the failure seam. An authorized Ledger,
Finance, or Records operator performs the source-of-record query through its
separate tenant-, role-, and cursor-bounded path.

Never calculate or copy an amount, balance, posting, finality state, ownership
decision, or approval from logs. Never update a ledger row to match a log.
Corrections remain append-only reversals or compensations under the immutable
ledger policy.

### 7. Collect evidence only when approved

Prefer in-interface inspection. If evidence export is necessary, a second
authorized role approves exact rows, fields, destination, retention, and
custodian before export. Use a restricted case ID rather than customer data in
the filename. Encrypt transfer and storage, record byte count and SHA-256, and
store the original only in the approved evidence location.

Reports contain minimized/redacted facts and references, not unrestricted
screenshots or raw dumps. Record every view, transfer, hold, release, and
disposition. No approved evidence store exists yet, so this step is blocked
until that gate is completed.

### 8. Close and revoke

Record the query outcome, safe findings, result metadata, evidence reference if
one exists, escalations, and follow-up owners. End the role session, revoke any
temporary membership, confirm scheduled expiry, and verify the administrative
audit trail. The case owner records why further query access is no longer
needed.

## Prohibited-material response

If a result exposes a credential, raw token/header/body/query, wallet proof,
personal/network data, amount/posting, raw exception, environment value, or
other prohibited field:

1. stop the query and do not rerun, broaden, paste, screenshot, or hash the
   value;
2. preserve only safe metadata: case, environment, group, event name, UTC
   range, query-template ID, result row number, and access audit reference;
3. notify Security and Privacy through the approved incident channel;
4. contain or disable the offending producer/export path without altering the
   customer or financial outcome;
5. let the credential, privacy, or financial incident process determine
   rotation, notification, deletion, preservation, and recovery; and
6. add a logger contract re-review before the producer can resume.

Discovery in a log does not authorize copying the value into an incident
ticket. If the value is a credential, rotate or revoke it at its authoritative
system before relying on log deletion.

## Break-glass procedure

Break glass is only for a declared severity-one incident where delay creates
material customer, security, or financial harm and the normal role is
unavailable or insufficient.

1. The incident commander and Security approver authorize one named workforce
   principal, one environment, exact groups, and a maximum of 60 minutes. If a
   second approver is genuinely unavailable, the commander records why and
   triggers retrospective Security and Privacy review.
2. The responder uses fresh phishing-resistant MFA and read/bounded-query
   capability only. Export, deletion, retention, hold, wildcard group, and
   cross-environment access remain denied.
3. Notify Security and Operations at activation. Record every query and safe
   result metadata. If the central audit sink is unavailable, spool signed or
   otherwise tamper-evident minimal audit metadata through the pre-approved
   recovery path; no such path is currently approved.
4. Revoke automatically at 60 minutes or incident handoff, whichever is first.
   Re-authentication is a new activation, not an extension.
5. Within one business day, Security, Privacy, and Operations review access,
   queries, evidence, scope, and revocation and track every exception to
   closure.

Break glass never authorizes a prohibited search, financial action, log or
ledger mutation, deletion, retention change, legal hold, or silent export.

## Retention, deletion, and legal hold

Fourteen days is the proposed managed-log standard. Other values already
allowed by the infrastructure template require an environment-specific,
time-bound exception before deployment. Backend expiry is normal deletion.
Manual deletion requires an independently approved contamination, legal, or
platform-response procedure and a separate audit trail.

Do not silently lengthen a whole log group or disable expiry for a legal hold.
The proposed procedure exports the minimum approved case result to a restricted
evidence store, records source groups and UTC bounds, computes an integrity
digest, applies a case schedule, and leaves source expiry unchanged. A whole-
group exception requires Legal, Privacy, Security, Records, and Operations.

The Records custodian releases a hold only under documented Legal authority and
records disposition. Application-log disposition never changes the retention,
hold, or append-only behavior of authoritative financial and audit records.

## Review and exception cadence

- Operations reviews access membership quarterly; Security and Privacy attest
  or remediate.
- Security samples access, denial, query, export, and break-glass audits monthly;
  Privacy joins when actor or customer evidence was involved.
- Operations verifies environment separation, audit delivery, retention, and
  deletion quarterly in an explicitly authorized environment.
- Security, Privacy, Operations, Records, and Finance review policy annually and
  after every material incident or exception.

An exception names exact control, purpose, fields, groups, environment,
principals, start, expiry, compensating controls, cost bound, evidence
destination, and owner. It requires Security, Privacy, and Operations, plus
Legal/Records/Finance when retention, hold, or financial evidence is affected.
It expires within 30 days and cannot weaken prohibited-data or immutable-record
boundaries.

Re-review is mandatory for a logging event/field/schema change; identifier or
actor-source change; legacy enrichment; new sink, backend, exporter, dashboard,
subprocessor, Region, key, or cross-account path; lifecycle/evidence change;
authentication, tenancy, ledger, or outbox change; control failure or incident;
or material change to KAN-220, KAN-49, KAN-50, KAN-51, or KAN-52.

## Local-only validation

These checks inspect repository files and run local Node tests only:

```powershell
npm run security:validate:logging-governance
npm run security:test:logging-governance
npm run format:check
npm run security:scan:secrets
git diff --check
```

They do not query logs, assume a role, call AWS, export evidence, mutate Jira,
deploy infrastructure, start hosted CI, or activate a paid service.
