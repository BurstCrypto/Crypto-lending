# KAN-40: Immutable ledger accounting model

KAN-40 is the LED-001 accounting-design gate for the internal-ledger epic. Its
local deliverable is the
[Proposed accounting ADR](adr/0003-immutable-ledger-accounting-model.md), not a
database migration, posting API, custody determination, or statutory financial
statement policy.

This work is local-only. It creates no cloud resource, sends no transaction,
contacts no pricing or chain provider, publishes no image, and dispatches no
hosted workflow.

## Jira decomposition

- KAN-240 defines the accounting invariants, exact-unit rules, valuation
  snapshots, fees, external references, and reversal policy.
- KAN-241 records balanced direct, swap, bridge, failed, partial, fee, reversal,
  and compensation examples in atomic units.
- KAN-242 reviews security, reconciliation, scalability, and the downstream
  implementation handoff.

All three subtasks are children of KAN-40 and deliberately stop before the
implementation owned by KAN-41 through KAN-44.

## Scope boundary

The initial design is an operational, multi-asset memorandum subledger. It
records product-observed value movements and clearing exposures. It is not, by
itself:

- a statutory GAAP or IFRS general ledger;
- evidence that the platform legally controls or custodies an external-wallet
  asset;
- a tax, regulatory-reporting, capital, safeguarding, or revenue-recognition
  policy; or
- authorization to move assets or recognize a customer balance.

Those conclusions require Finance, Legal, Risk, and custody review. The ADR
therefore remains `Proposed` until a designated ledger/finance-control owner
approves the unresolved decisions.

## Normative contract

The ADR fixes the design choices needed by downstream implementation:

- Each immutable ledger account belongs to one book and one exact,
  chain-qualified asset. A ticker is presentation metadata and never a balancing
  key.
- Posted quantities are positive integer atomic units. Floating point,
  JavaScript `number`, exponent notation, implicit rounding, zero-value lines,
  and cross-asset netting are forbidden.
- Every journal contains at least two lines and balances debits and credits
  independently for each asset identifier.
- Transaction lifecycle, immutable posted facts, and rebuildable read
  projections are separate models.
- Operational-memo account sums are signed net flows, not authoritative
  external-wallet holdings or spendable balances. Chain, custody, or provider
  data remains authoritative for those holdings.
- USD valuations are immutable metadata snapshots. They never balance different
  assets, authorize spending, or silently assume that a stablecoin equals one
  dollar. Rate and result digit counts, scales, asset decimals, and arithmetic
  intermediates are explicitly bounded and overflow is rejected.
- Estimated and actual fees remain distinct. Actual platform, network, DEX,
  bridge, and provider fees identify their payer, recipient, and exact asset;
  they are never hidden in a net amount.
- External references are typed and environment scoped. A chain transaction is
  identified by chain plus transaction hash/signature and event, log, or
  instruction index when applicable.
- Corrections append new journals. An accounting reversal exactly swaps every
  side of one original journal; a real refund or on-chain return is a new
  compensation with its own external evidence.
- A failed operation that moved nothing and incurred no fee creates no journal.
  Actual gas or other consumed value is still posted, and partial settlement
  remains visible as a clearing exposure requiring recovery.

## Downstream handoff

- **KAN-41 / LED-002:** implement append-only tables, commit-time per-asset
  balancing, canonical digit-string input, integral and bounded PostgreSQL
  amounts, fixed-search-path write functions, runtime `EXECUTE`-only mutation,
  and reversal uniqueness. A rebuildable balance projection is optional, but
  must share the journal transaction if implemented. PostgreSQL `numeric(78,0)`
  alone is insufficient because assignment can round fractional input. KAN-41
  does not have to implement KAN-42 lifecycle events or KAN-43 idempotency and
  outbox composition.
- **KAN-42 / LED-003:** keep mutable transaction state and append-only state
  history outside posted journals. Define partial-settlement and manual-review
  recovery semantics before treating an operation as `FAILED` or `REVERSED`.
- **KAN-43 / LED-004:** scope idempotency to the authenticated actor and
  operation, bind a versioned canonical request fingerprint, and atomically
  commit the journal and the existing transactional outbox.
- **KAN-44 / LED-005:** expose permissioned, cursor-based audit views and verify
  that all projections reconcile exactly to immutable postings.

KAN-41 must reuse the least-privilege migration pattern established by migration
`0004`; it must not grant direct ledger-table writes to the runtime role. KAN-43
must reuse the existing outbox rather than introduce a second publication path.

## Local review

The documentation-only KAN-40 gates are:

```powershell
npm run format:check
git diff --check
```

No Docker service, provider connection, chain transaction, price lookup, cloud
plan, hosted CI run, or paid service is required to review this design.

## Approval boundary

Local authorship and automated formatting do not approve an accounting policy.
Before the ADR can change from `Proposed` to `Accepted`, the designated
ledger/finance-control reviewer must resolve and record at least:

- operational memo versus statutory/custodial book classification;
- platform-fee recognition and principal-versus-agent treatment;
- USD valuation source, scale, freshness, depeg, unavailable, and backfill
  policy;
- chain-finality and reorganization recognition thresholds;
- partial fill, recovery, refund, fee-variance, and loss-ownership policy; and
- period close, retention, correction, and regulatory-reporting requirements.

Moving Jira or merging a branch is not a substitute for that approval.
