# Reviewed outbox job contracts

Status: **locally enforced; production evidence pending**

New transactional-outbox rows pass two independent admission checks. The
versioned application policy in
`apps/api/src/infrastructure/outbox/reviewed-job-contract-policy.ts` checks the
exact safe JSON/SQS representation after serialization. Migration `0018` then
removes direct `job_outbox` insert privileges from the API, worker, retired
legacy runtime, and `PUBLIC`; the API can enqueue only through the
`enqueue_reviewed_job_v1` database function. A valid JSON envelope alone is
therefore not enough to introduce a job kind, and a stateful source object
cannot present different data to serialization and database admission.

The closed version-1 catalog contains:

| Kind                       | Destination | Payload data class                                     | Message attributes | Additional binding                                                                     |
| -------------------------- | ----------- | ------------------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------- |
| `ledger.journal-committed` | `jobs`      | Internal financial-event identifiers                   | None               | Command/journal link required; correlation journal must match                          |
| `yield.operation.submit`   | `jobs`      | Internal financial-operation identifiers               | `operationType`    | Exact persisted submission, operation, transition, actor, and correlation relationship |
| `blockchain.balance-sync`  | `jobs`      | Restricted pseudonymous account and wallet identifiers | None               | Exact active account/wallet and Ethereum or Solana mainnet relationship                |

Every job root and payload is an exact data-only record. Unknown, missing,
extra, accessor-backed, inherited, malformed, unsupported, or cyclic fields
fail before an insert. Repository validation and database failures cross the
boundary only as fixed, non-sensitive errors. Raw wallet addresses, balances,
provider responses, credentials, signatures, tokens, transaction bytes, and
arbitrary diagnostic metadata are not admitted by any current contract. The
ledger and yield operation values are imported from their canonical producer
domains so this policy cannot silently drift from those producers.

Published rows retain the reviewed seven-day default and failed rows the
reviewed thirty-day default. Pending rows remain until they settle because
deleting an unpublished financial workflow message would lose work; their age
is an operational alarm condition rather than an automatic deletion trigger.
Changing those durations still requires the existing configuration and policy
review.

Claim parsing deliberately remains structural. Rows created before this gate,
including an unreviewed or poison legacy row, can still be claimed, rejected by
the transport boundary, retried under the bounded policy, and terminalized.
The policy must not turn one old row into permanent head-of-line blocking.

The database function is a narrowly granted `SECURITY DEFINER` capability with
an exact signature, owner, immutable body check, and fixed search path ordered
as `pg_catalog`, the owner-controlled application schema, then `pg_temp`.
`PUBLIC`, the worker, legacy runtime, and migration login cannot execute it.
The function independently enforces the `jobs` destination, exact envelope,
correlation, payload, and message-attribute shapes for the three version-1
contracts and their critical cross-field bindings before one owner-side insert.
Ledger jobs must resolve to the exact command/journal relationship. Yield
submission jobs must resolve through the persisted submission, command result,
operation, and latest `SUBMITTED` transition while the operation is still in
`SUBMITTED`: the outbox/submission ID, operation type, ledger transaction, plan,
quote, correlation, initiating actor, and the
millisecond projection of the transition's recorded time must all match. The
submission request time must equal that transition's full-precision recorded
time. A delayed first enqueue after the operation advances is rejected instead
of reviving a historical provider action. Balance-sync jobs must resolve to an
`ACTIVE`, non-revoked registered
wallet owned by the supplied account and whose mainnet chain tuple exactly
matches Ethereum `eip155:1` or Solana mainnet. Share locks preserve each checked
producer relationship through the surrounding enqueue transaction, including
against a concurrent wallet revocation. Syntactically valid fabricated IDs are
therefore insufficient.

Rejections use one fixed message and SQLSTATE and run inside the function's
exception subtransaction, so rejected or duplicate requests cannot leave a
partial row or expose rejected content. The existing row-level policies remain
defense in depth; their dormant API insert policy grants no capability without
an INSERT privilege.

Worker SELECT, claim/update, terminalization, and retention DELETE privileges
are unchanged. Existing rows are neither rewritten nor deleted by migration
`0018`, and a rollback drops the function before restoring only the six API
column INSERT grants that existed after migration `0017`. Rolling back is
therefore an explicit security downgrade and must use the same reviewed change
control as deploying the gate.

Adding a job requires an explicit catalog/version change, exact payload and
attribute validator, data-class and retention review, correlation/linkage
rules, adversarial leak tests, consumer idempotency evidence, and independent
review. This local control does not provision SQS, approve deployment, or
authorize any blockchain action. Production migration evidence remains
external. The bootstrap/database owner and the schema-owner role necessarily
retain authority to replace the function or alter grants; those credentials
must remain isolated from runtime workloads, and production DBA review must
confirm the expected owner, body, ACL, search path, and direct-insert denial
after deployment.
