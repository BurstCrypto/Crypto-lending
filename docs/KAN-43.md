# KAN-43: Idempotent ledger writes and transactional outbox

KAN-43 is the LED-004 local implementation boundary. The ticket is `In
Review`. It composes the KAN-41 immutable journal and KAN-42 lifecycle event
with one durable idempotency result and one record in the existing PostgreSQL
outbox.

This work is local-only. It does not create cloud resources, contact a provider,
submit an external transaction, or introduce a second delivery system.

## Dependencies and ticket links

- KAN-41 supplies immutable ledger journals and is `In Review`;
- KAN-42 supplies lifecycle composition and is `In Review`;
- both tickets block KAN-43; and
- KAN-43 supplies the real ledger/outbox hop now exercised by KAN-51's guarded
  local API-to-job-to-ledger trace.

KAN-43 has moved to `In Review` after its application and PostgreSQL gates
passed. It must not move to `Done` while ADR 0003 and the retention, provider,
and operations decisions listed below remain unapproved.

## Idempotency contract v1

Every journal post and reversal requires an opaque printable idempotency key of
1 through 128 UTF-8 bytes. The application hashes the exact key under a
ledger-only SHA-256 domain. Only the 32-byte digest is persisted; the raw key is
not copied into the command, result, outbox envelope, or application error.

The durable uniqueness scope is:

- authenticated account;
- operation (`POST_JOURNAL` or `REVERSE_JOURNAL`);
- command contract version; and
- key digest.

Fingerprint version 1 includes the authenticated actor, operation, contract
version, and every normalized value-relevant input. Posting fingerprints include
the book, transaction, leg, economic event, evidence times, reason, and ordered
posting multiplicity. Reversal fingerprints include the original journal,
reason, and evidence times. Correlation metadata is deliberately excluded so a
retry from a new request can return the original result.

The behavior is:

- an unused key and fingerprint claim one durable command;
- the identical scope, key, and fingerprint return the original journal;
- the same scope and key with a different fingerprint return
  `IDEMPOTENCY_CONFLICT`; and
- concurrent identical commands produce one journal, one lifecycle event, one
  idempotency result, and one outbox event.

The service checks for a completed replay before resolving a one-use posting or
reversal capability. The database repeats the claim inside the write transaction
to close the concurrent-call race.

## Atomic database composition

Migration `0009` adds an immutable command header, one-to-one durable result,
and owner-only leg-qualified provider submission identities. It also adds paired
nullable ledger command and journal links to `job_outbox`; generic outbox rows
keep both fields null and retain their current cleanup behavior.

The winner transaction performs these steps in order:

1. claim the scoped command and its database-generated outbox UUID;
2. call the KAN-42 posting or reversal lifecycle wrapper;
3. enqueue one `ledger.journal-committed` version 1 job through the existing
   transactional publisher; and
4. complete the immutable command result.

Any failure rolls back all four steps. A committed result proves that the linked
journal and outbox row committed together. Published or failed outbox rows may
still be removed by the existing retention worker because the durable result
keeps the outbox UUID as audit data without referencing the deletable row.

The event payload contains only `journalId` and `operation`. Its correlation
metadata preserves the active root and actor and adds the journal as
`ledgerEventId`. It never contains the raw idempotency key or posting payload.

## Provider and inbound identities

The migration records an append-only, leg-qualified provider submission
identity structure, but grants no runtime provisioning function and performs no
provider call. Provider-specific normalization and submission behavior require a
separately approved adapter.

Inbound recognized facts continue to use KAN-41's typed external-evidence
identity and uniqueness rules. KAN-43 does not create an alternate inbound event
store.

## Explicitly deferred policy

- financial-record retention and archival duration for idempotency identities;
- provider-specific key normalization, issuance, and unknown-outcome handling;
- finality polling, reconciliation timing, and resubmission policy;
- public HTTP header naming and conflict response mapping until an endpoint is
  approved; and
- cloud deployment, external transport submission, and customer-facing status.

Until retention is approved, the local migration provides no deletion path for
ledger command identities or results.

## Local verification

The review handoff passed repository formatting, API lint/typecheck/build, 43
unit suites with 439 tests, and 3 API end-to-end suites with 25 tests. The local
PostgreSQL checks passed all 18 immutable-ledger, lifecycle, and idempotency
integration tests, all 8 migration-runner tests, and the rollback,
custom-principal, and live-infrastructure suites.

Focused coverage includes identical sequential and concurrent replay,
changed-input conflict, failure rollback across the composition boundary,
exactly one outbox event per committed journal, generic outbox compatibility,
provider identity uniqueness, verifier drift, and clean empty rollback.
