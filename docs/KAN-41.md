# KAN-41: Append-only ledger schema

KAN-41 is the LED-002 implementation boundary for the proposed operational
memorandum ledger in ADR 0003. The ticket is `In Progress`. This document
records the implemented application contract and the database controls that
must be green before the ticket can move to `In Review`; it is not approval of
the accounting policy and does not move the proposed ADR to `Accepted`.

This work is local-only. It does not create a cloud resource, send an asset,
query a chain or pricing provider, publish an image, invoke hosted CI, or incur
a provider charge.

## Dependency and delivery order

The Jira dependency chain is intentionally serial:

- KAN-40 blocks KAN-41 while the proposed accounting design is reviewed;
- KAN-41 blocks KAN-42 and KAN-43;
- KAN-42 also blocks KAN-43; and
- KAN-43 blocks KAN-51's real API-to-job-to-ledger correlation evidence.

KAN-41 therefore stays `In Progress` until its local database and application
gates pass. KAN-42 and KAN-43 stay `To Do` until their prerequisites are ready.
Local completion may move KAN-41 to `In Review`, but not to `Done`, while the
ADR's finance, risk, custody, lifecycle, and recognition approvals remain open.

## Implemented application boundary

The ledger domain accepts only canonical UUIDv4 identifiers, positive decimal
atomic-unit strings bounded to 256 bits, closed event/reason codes, and two to
64 postings. It requires at least two distinct accounts and balances debit and
credit totals independently for each exact asset revision. Repeated account
lines are allowed so itemized movements and exact reversals preserve line
multiplicity.

Runtime callers do not receive direct ledger-table privileges. The repository
uses fixed, schema-qualified, parameterized `SELECT` calls to exactly two
`SECURITY DEFINER` functions:

```text
post_ledger_journal(
  text, uuid, uuid, uuid, text,
  timestamptz, timestamptz, text, uuid, text
) -> uuid

reverse_ledger_journal(
  text, uuid, text, timestamptz, timestamptz, uuid
) -> uuid
```

The first parameter is a purpose-bound bearer capability. The posting boundary
also receives book, transaction, leg, event, timing, reason, correlation, and
canonical posting assertions. The reversal boundary receives the original
journal, reason, timing, and correlation assertions. The database must derive
the authoritative tenant, actor, plan, approval, and journal identifier from
the locked capability target; caller assertions cannot grant authority.

The service independently resolves the verified current principal and rejects
any mismatch with the diagnostic logging actor. Logging correlation is evidence
only and is never an authorization capability.

## Capability custody

A ledger capability is exactly 32 cryptographically random bytes represented
as 64 lowercase hexadecimal characters. Application code wraps it in a frozen,
null-prototype, zero-own-key object and stores the raw value only in a module
private `WeakMap`. POST and REVERSE capabilities are not interchangeable.

The raw value must never enter a DTO, URL, log, trace, exception, serialized
command, outbox payload, or database row. It may exist only in the trusted
resolver, transient service memory, and a bound PostgreSQL parameter. Production
APM, driver, PostgreSQL error, and audit configuration must not capture bound
parameters; that is a deployment gate, not something a unit test can prove.

The database design must store only a purpose-domain-separated SHA-256 digest,
bind issuance to an immutable sealed target, enforce finite expiry using
`clock_timestamp()`, and retain expired or resolved digests so they cannot be
reused. A single append-only resolution row is the race linearization point for
`CONSUMED` versus `REVOKED`; exactly one outcome may win. Wrong, expired,
revoked, consumed, cross-purpose, or context-mismatched capabilities must fail
with the same generic result.

## Required database invariants

Migration `0007` is not releasable until PostgreSQL itself proves all of these
properties:

- immutable books, asset revisions, accounts, transactions, legs, posting
  plans, journals, lines, valuation snapshots, fee components, typed external
  references, and journal relations;
- a sealed, versioned, database-recomputed digest over the exact plan header,
  ordered posting multiset, recognition evidence, per-asset valuation plan,
  and conditional fee plan;
- atomic plan sealing and child-row exclusion by locking the same plan row;
- one-time plan consumption and a record of the exact capability issuance that
  authorized the journal;
- at least two lines, at least two accounts, same-book/account constraints, and
  independent debit/credit equality for every exact asset revision at commit;
- exact source-credit and destination-debit movement plus an authorized,
  complete posting plan rather than broad access to system/provider accounts;
- atomic recognition evidence and one explicit AVAILABLE or UNAVAILABLE
  valuation snapshot for every posted asset;
- exact payer and recipient lines plus immutable fee metadata for ACTUAL_FEE;
- reversals that copy every original line and the immutable recognition-base
  valuations, fees, and relations exactly once with sides swapped, keep the
  original immutable, use a separately approved capability, and cannot reverse
  a reversal;
- append-only mutation and truncate rejection under direct SQL, trigger
  disabling attempts, rollback, and concurrent transactions; and
- owner-only tables/helpers, no PUBLIC or worker access, and API `EXECUTE` only
  on the exact POST and REVERSE identities.

All definer functions must have a pinned search path, an exact reviewed owner,
and explicit revocation from PUBLIC and every runtime principal before the two
public capabilities are selectively granted. The verifier must pin normalized
catalog definitions for critical constraints, indexes, triggers, function
bodies, owners, default privileges, table and column ACLs, and effective
privileges. Function-name counts or body substring checks are insufficient.

The production `0007` verifier is a cumulative superset of the existing `0005`
principal verifier and may suppress `0005` only after the applied `0007`
checksum is proven. Fresh installations still verify `0005` before applying
`0007`, and rollback revalidates every newly active verifier. The isolated
schema fixture may use identical `upSql`/`downSql` with a ledger-only verifier,
but it must be named and guarded as test-only and never injected into production.

## Explicitly deferred scope

KAN-41 does not implement transaction lifecycle transitions, idempotent command
replay, or transactional outbox publication; those belong to KAN-42 and KAN-43.
It also does not invent asset activation/retirement, account closing, plan
provisioning, valuation-source, recognition, custody, or statutory policy while
ADR 0003 remains proposed. The local database must fail closed without a sealed,
pre-authorized plan and capability. A later reviewed boundary must provision
those artifacts before the module can be enabled in a deployed application.

ADR 0003 permits append-only valuation BACKFILL records after recognition but
does not yet approve how a later backfill changes reversal or reporting policy.
KAN-41 preserves the original recognition snapshot as the reversal base and
records later backfills without silently rewriting that policy decision.

The ledger module therefore has no permissive default actor or capability
provider. Wiring one merely to make dependency injection succeed would erase
the authorization boundary.

## Local verification gates

The final KAN-41 review must run, at minimum:

```powershell
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm test --workspace @crypto-lending/api
npm run test:e2e --workspace @crypto-lending/api
npm run test:integration --workspace @crypto-lending/api
npm run security:scan:secrets --silent
npm run format:check
git diff --check
```

The PostgreSQL integration evidence must use an isolated, marker-verified local
PG16 fixture. It must cover fresh apply/verify, exact cumulative-principal
verification, blank rollback and reapply, balanced and unbalanced journals,
multi-asset separation, metadata completeness, direct and column-level ACL
denial, hostile DDL/trigger/function drift, wrong/expired/revoked/replayed and
cross-purpose capabilities, concurrent consume-versus-revoke, exact reversals,
rollback refusal with retained facts, and deterministic cleanup.

No local test proves production capability issuance, parameter-log redaction,
principal binding, policy approval, operator drain, backup/restore, monitoring,
or reconciliation. Those remain live review gates and must not be inferred from
a branch merge, commit, migration checksum, or Jira transition.
