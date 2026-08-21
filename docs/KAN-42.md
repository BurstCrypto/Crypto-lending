# KAN-42: Transaction lifecycle state machine

KAN-42 is the LED-003 implementation boundary for parent and per-leg workflow
history. The ticket is `In Review`. The local implementation follows the
proposed model in ADR 0003 without treating that proposal or a Jira transition
as accounting-policy approval.

This work is local-only. It does not create cloud resources, submit an external
transaction, contact a provider, or incur a provider charge.

## Dependency and delivery order

- KAN-41 supplies the immutable transaction, leg, and journal records and is
  currently `In Review`;
- KAN-42 adds lifecycle and recovery history without changing those facts; and
- KAN-42 still blocks completion of KAN-43, but this reviewed local boundary is
  ready for KAN-43 implementation to begin.

KAN-42 moved to `In Review` after its application and PostgreSQL gates passed.
It must not move to `Done` while ADR 0003 and the product/operations lifecycle
decisions remain unapproved.

## Workflow transitions

The same explicit workflow vocabulary applies independently to a parent
transaction and each leg. Current state is derived from append-only history;
no journal or prior event is updated.

| From            | To              | Allowed reason                                          |
| --------------- | --------------- | ------------------------------------------------------- |
| none            | `CREATED`       | `INTENT_CREATED`                                        |
| `CREATED`       | `QUOTED`        | `QUOTE_CREATED`                                         |
| `CREATED`       | `FAILED`        | `PREFLIGHT_FAILED`                                      |
| `QUOTED`        | `USER_APPROVED` | `USER_APPROVAL_RECORDED`                                |
| `QUOTED`        | `FAILED`        | `PREFLIGHT_FAILED`, `USER_REJECTED`, or `QUOTE_EXPIRED` |
| `USER_APPROVED` | `SUBMITTED`     | `SUBMISSION_RECORDED`                                   |
| `USER_APPROVED` | `FAILED`        | `PREFLIGHT_FAILED` or `USER_REJECTED`                   |
| `SUBMITTED`     | `PENDING`       | `OUTCOME_PENDING`                                       |
| `SUBMITTED`     | `SETTLED`       | `SETTLEMENT_RECORDED`                                   |
| `SUBMITTED`     | `FAILED`        | `PROVIDER_REJECTED`                                     |
| `PENDING`       | `SETTLED`       | `SETTLEMENT_RECORDED`                                   |
| `PENDING`       | `FAILED`        | `TERMINAL_FAILURE_CONFIRMED`                            |
| `SETTLED`       | `REVERSED`      | `FULL_REVERSAL_RECORDED`                                |

Self-transitions and exits from `FAILED` or `REVERSED` are not part of this
local graph. A caller supplies its expected current state. The database locks
the immutable subject, compares the latest event, and either appends exactly one
new event or rejects the command without changing history.

An unknown external outcome uses `PENDING`; it is not converted to `FAILED` by
a timeout alone. Workflow state remains distinct from posted facts. A failure
event does not remove a journal, and a reversal event does not relabel the
original journal.

## Recovery dimension

Recovery is recorded independently so `FAILED` never means "no financial
impact." Its local state graph is:

| From           | To            | Allowed reason      |
| -------------- | ------------- | ------------------- |
| `NOT_REQUIRED` | `REQUIRED`    | `RECOVERY_REQUIRED` |
| `REQUIRED`     | `IN_PROGRESS` | `RECOVERY_STARTED`  |
| `REQUIRED`     | `RESOLVED`    | `RECOVERY_RESOLVED` |
| `IN_PROGRESS`  | `RESOLVED`    | `RECOVERY_RESOLVED` |

The initial recovery state is derived as `NOT_REQUIRED` until the first recovery
event. Multiple recovery episodes, case ownership, service levels, and
customer-facing status remain policy decisions outside this local slice.

## Persistence boundary

Migration `0008` adds immutable parent, leg, and recovery event histories plus
explicit database transition-rule registries. Every event records a generated
identifier, monotonically increasing subject sequence, prior and next state,
bounded reason, resolved actor, correlation identifier, source effective time,
and database-controlled recorded time.

The application calls fixed functions for parent, leg, and recovery transitions.
Journal posting and reversal use the lifecycle-composing wrappers introduced by
`0008`, so the applicable leg event shares the journal transaction. The parent
remains independently derived and can remain `PENDING` while child legs differ.

KAN-43 will later add durable command idempotency and the existing transactional
outbox to the same transaction. KAN-42 does not add another delivery system or
perform external submission inside a database transaction.

## Explicitly deferred policy

The local transition graph is an implementation proposal, not approval of:

- customer-facing meaning for partial settlement or financially impactful
  failure;
- finality thresholds, reorganization policy, or unknown-outcome time limits;
- automatic parent aggregation for mixed terminal leg outcomes;
- compensation-based `REVERSED` status;
- recovery ownership, escalation, reopening, or manual-review operations; or
- backdating and accounting-close policy.

These choices must be approved in ADR 0003 before the ticket can be `Done`.

## Local verification

The KAN-42 handoff passed repository formatting, API lint/typecheck/build, 410
unit tests, 25 API end-to-end tests, and all 106 infrastructure tests. The
marker-verified local PostgreSQL checks cover every allowed edge, rejected and
stale transitions, concurrent duplicate commands, independent parent/leg
state, separate recovery history, and atomic journal/lifecycle commit and
rollback.
