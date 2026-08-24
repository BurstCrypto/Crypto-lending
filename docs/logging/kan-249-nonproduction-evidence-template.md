# KAN-249 non-production logging evidence record

> Status: `NOT_AUTHORIZED` / `NOT_RUN`
>
> Copy this template to an approved, access-controlled evidence location only
> after KAN-248 is approved and explicit environment and cost authorization is
> recorded. Committing this template is not authorization to deploy or call a
> cloud service.

## Record identity

| Field                | Required value                                                           |
| -------------------- | ------------------------------------------------------------------------ |
| Record ID            | `NOT_RUN`                                                                |
| Evidence owner       | `NOT_ASSIGNED`                                                           |
| Independent verifier | `NOT_ASSIGNED`                                                           |
| Started at (UTC)     | `NOT_RUN`                                                                |
| Completed at (UTC)   | `NOT_RUN`                                                                |
| Decision             | `NOT_RUN` (`ACCEPTED`, `CONDITIONAL`, or `REJECTED` only after evidence) |
| Decision time (UTC)  | `NOT_RUN`                                                                |

## Authorization and dependency binding

| Gate                                  | Approval/evidence reference | Approver       | Approved at / expires at (UTC) | State     |
| ------------------------------------- | --------------------------- | -------------- | ------------------------------ | --------- |
| KAN-248 logging policy                | `NOT_APPROVED`              | `NOT_ASSIGNED` | `NOT_RUN` / `NOT_RUN`          | `BLOCKED` |
| KAN-234 deployment/rollback rehearsal | `NOT_ACCEPTED`              | `NOT_ASSIGNED` | `NOT_RUN` / `NOT_RUN`          | `BLOCKED` |
| Named non-production environment      | `NOT_AUTHORIZED`            | `NOT_ASSIGNED` | `NOT_RUN` / `NOT_RUN`          | `BLOCKED` |
| Cloud/API actions                     | `NOT_AUTHORIZED`            | `NOT_ASSIGNED` | `NOT_RUN` / `NOT_RUN`          | `BLOCKED` |
| Cost ceiling and billing alarms       | `NOT_APPROVED`              | `NOT_ASSIGNED` | `NOT_RUN` / `NOT_RUN`          | `BLOCKED` |
| Synthetic failure/canary exercise     | `NOT_AUTHORIZED`            | `NOT_ASSIGNED` | `NOT_RUN` / `NOT_RUN`          | `BLOCKED` |

Record the approved maximum duration, ingestion/storage/query/export budget,
expected deletion wait, cleanup tail, and who can stop the run. A free tier or
existing resource is not a zero-cost guarantee.

## Exact revision and environment

| Field                                     | Value     |
| ----------------------------------------- | --------- |
| Git commit SHA                            | `NOT_RUN` |
| Source tree SHA-256                       | `NOT_RUN` |
| API image digest                          | `NOT_RUN` |
| Worker image digest                       | `NOT_RUN` |
| Infrastructure template SHA-256           | `NOT_RUN` |
| KAN-248 policy SHA-256                    | `NOT_RUN` |
| Configuration/evidence-plan SHA-256       | `NOT_RUN` |
| Environment alias                         | `NOT_RUN` |
| Cloud account alias or approved pseudonym | `NOT_RUN` |
| Region                                    | `NOT_RUN` |
| API/worker task-definition revisions      | `NOT_RUN` |
| Log-group aliases                         | `NOT_RUN` |
| KMS key alias and key-policy revision     | `NOT_RUN` |
| Effective retention setting               | `NOT_RUN` |

Do not place credentials, account secrets, database/queue URLs, raw resource
policies, customer identifiers, or unredacted account numbers in this record.

## Synthetic trace

Use synthetic records only. Record stable evidence references rather than raw
log exports.

| Hop                    | Expected identifiers                                                                           | UTC observation | Evidence SHA-256 | Result    |
| ---------------------- | ---------------------------------------------------------------------------------------------- | --------------- | ---------------- | --------- |
| API ingress            | Server-generated request/correlation root; approved synthetic actor only if KAN-248 permits it | `NOT_RUN`       | `NOT_RUN`        | `NOT_RUN` |
| Domain/ledger command  | Same root; actual synthetic transaction identifier                                             | `NOT_RUN`       | `NOT_RUN`        | `NOT_RUN` |
| Transactional outbox   | Same root and immutable ledger link                                                            | `NOT_RUN`       | `NOT_RUN`        | `NOT_RUN` |
| Worker publish/consume | Same root and bounded job reference                                                            | `NOT_RUN`       | `NOT_RUN`        | `NOT_RUN` |
| Ledger event           | Same root and actual synthetic ledger-event identifier                                         | `NOT_RUN`       | `NOT_RUN`        | `NOT_RUN` |

Required assertions:

- the root was returned/generated by the server and was not accepted from a
  request header;
- each identifier matches its authoritative application/database record;
- timestamps are canonical UTC and fall inside the approved run window;
- retries retain the same root without duplicating the financial operation;
- searches use the minimum time, environment, service, event, and correlation
  filters approved by KAN-248; and
- evidence contains no broad log export or unrelated trace.

## Prohibited-data canaries

Use unique synthetic canary labels and store the actual canary values only in
the restricted execution record. Never use a real credential or customer value.

| Canary class                        | Injection boundary                           | Expected result                     | Evidence SHA-256 | Result    |
| ----------------------------------- | -------------------------------------------- | ----------------------------------- | ---------------- | --------- |
| Private-key-shaped value            | Synthetic request/job/provider error fixture | Absent from every log and export    | `NOT_RUN`        | `NOT_RUN` |
| Bearer/capability/idempotency token | Synthetic header/command fixture             | Absent; not hashed or masked        | `NOT_RUN`        | `NOT_RUN` |
| Credential/connection string        | Synthetic configuration/error fixture        | Absent; no raw error object         | `NOT_RUN`        | `NOT_RUN` |
| Raw signature/signed message        | Synthetic wallet fixture                     | Absent; no derived searchable value | `NOT_RUN`        | `NOT_RUN` |
| Provider payload/error body         | Synthetic adapter failure                    | Closed error code only              | `NOT_RUN`        | `NOT_RUN` |

Record the search scope, query hash, result count, and independent verifier for
each canary. Do not paste a canary value into this document to prove absence.

## Encryption, retention, deletion, and access

| Control                | Required observation                                                                            | Evidence SHA-256 | Result    |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ---------------- | --------- |
| Delivery               | API and worker records arrive in only the intended environment log groups                       | `NOT_RUN`        | `NOT_RUN` |
| Encryption             | Each group uses the approved KMS key; key policy matches the reviewed revision                  | `NOT_RUN`        | `NOT_RUN` |
| Retention              | Effective service setting equals the approved KAN-248 period                                    | `NOT_RUN`        | `NOT_RUN` |
| Eventual deletion      | A dedicated synthetic record is absent after the complete approved retention/deletion interval  | `NOT_RUN`        | `NOT_RUN` |
| Authorized read        | Approved incident-reader role can run only the minimum query                                    | `NOT_RUN`        | `NOT_RUN` |
| Unauthorized read      | Unapproved principal receives an explicit denial                                                | `NOT_RUN`        | `NOT_RUN` |
| Mutation/delete denial | Reader and application roles cannot change retention, resource policy, KMS binding, or records  | `NOT_RUN`        | `NOT_RUN` |
| Break glass            | Approved activation, time limit, ticket binding, audit, revocation, and post-review all succeed | `NOT_RUN`        | `NOT_RUN` |
| Environment separation | A role for one environment cannot query another                                                 | `NOT_RUN`        | `NOT_RUN` |
| Access audit           | Read, denial, break-glass, and administrative actions are attributable and reviewable           | `NOT_RUN`        | `NOT_RUN` |

Access-denial evidence must identify the tested role and action through approved
aliases and result codes. It must not contain tokens, raw policies, or session
credentials.

## Findings and retest

Every observation other than `PASS` requires a finding before the run can be
accepted.

| Finding ID | Severity  | Control   | Safe description | Owner          | Due at (UTC) | Disposition | Retest evidence SHA-256 | Retest result |
| ---------- | --------- | --------- | ---------------- | -------------- | ------------ | ----------- | ----------------------- | ------------- |
| `NOT_RUN`  | `NOT_RUN` | `NOT_RUN` | `NOT_RUN`        | `NOT_ASSIGNED` | `NOT_RUN`    | `NOT_RUN`   | `NOT_RUN`               | `NOT_RUN`     |

An exception requires a named risk owner, exact scope, compensating controls,
expiry, review trigger, and explicit Security/Privacy/Operations disposition.

## Cleanup and final cost

| Item                                                             | Owner          | Completed at (UTC) | Evidence SHA-256 | Result    |
| ---------------------------------------------------------------- | -------------- | ------------------ | ---------------- | --------- |
| Synthetic traffic stopped                                        | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN`        | `NOT_RUN` |
| Temporary access revoked                                         | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN`        | `NOT_RUN` |
| Break-glass session revoked/reviewed                             | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN`        | `NOT_RUN` |
| Temporary queries/exports deleted or retained by approved policy | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN`        | `NOT_RUN` |
| Resources restored to the approved baseline                      | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN`        | `NOT_RUN` |
| Retained resources and deletion wait recorded                    | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN`        | `NOT_RUN` |
| Final observed cost and delayed-charge window recorded           | `NOT_ASSIGNED` | `NOT_RUN`          | `NOT_RUN`        | `NOT_RUN` |

Record approved ceiling, observed cost, unbilled estimate, retained-resource
cost, and the person responsible for the final billing recheck. Stack deletion
alone is not proof of cleanup or zero remaining cost.

## Acceptance

The evidence owner proposes `ACCEPTED`, `CONDITIONAL`, or `REJECTED` only after
all sections are complete. A verifier independent of implementation, evidence
collection, access administration, and finding ownership records the final
decision. `ACCEPTED` requires every required result to be `PASS`, zero expired
approvals, zero unresolved high/critical findings, completed cleanup, and a
recorded remaining-cost decision.

Until then, this record remains `NOT_AUTHORIZED` / `NOT_RUN` and KAN-249 remains
open.
