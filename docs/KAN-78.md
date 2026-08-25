# KAN-78: immutable fee snapshot ledger evidence

KAN-78 has a bounded local PostgreSQL proof over the immutable ledger delivered
by migration `0007` plus the focused forward repair in migration `0013`. This
proof does not add a second fee schema and does not claim that the product can
persist quotes through an application/runtime boundary yet.

## Proven locally

The focused integration fixture
`apps/api/test/infrastructure/fee-snapshot-ledger.integration-spec.ts` proves
that the existing schema can:

- retain quote v1's fee amount, rule revision, route revision, provider
  revision, configuration revision, evidence, and quote valuation after a
  distinct quote v2 is recorded under a new rule and configuration;
- reject an attempted update to the older estimate through the append-only
  trigger;
- post an actual fee through the authorized
  `post_ledger_journal_with_lifecycle` runtime boundary and preserve its link
  to the quote v1 estimate;
- represent a later fee difference as a new `ADJUSTMENT` journal and fee
  component linked to the original actual component, without changing the
  estimate or actual row;
- reverse that adjustment through
  `reverse_ledger_journal_with_lifecycle` with exact opposite journal lines
  and an explicit `reverses_fee_component_id`; and
- keep every journal balanced while account totals move from 80, to 100 after
  the adjustment, and back to 80 after its exact reversal.

The live fixture exposed an ADJUSTMENT-stage defect in `0007`'s deferred journal-integrity
function: it compared every non-reversal fee plan only with an `ACTUAL`
component even though `post_ledger_journal` correctly emits an `ADJUSTMENT`
component for an adjustment event. Migration `0013` changes only that comparison
to select `ADJUSTMENT` for an adjustment event and `ACTUAL` otherwise. It
patches the existing function in place, fails closed if the expected original
predicate has drifted, preserves the cumulative catalog verifier, and blocks
rollback after an immutable adjustment fact exists. Checksum-pinned migration
`0007` remains unchanged.

The fixture applies the complete registered isolated migration chain through
`0013`. A separate upgrade assertion first applies and verifies through `0012`,
then proves that the unchanged migration runner can reverify that installed
state and apply only `0013`. The production-principal integration follows the
same `0012` to `0013` sequence. Its production `0012` checksum remains pinned;
only the isolated-schema `0012` verifier expectation was corrected to include
the three yield-to-ledger foreign keys already present in its DDL.

The fixture is loopback-only and uses the repository's guarded local PostgreSQL
principal setup. It creates and drops a random schema, makes no external network
call (it uses a loopback PostgreSQL socket), and incurs no hosted-service
expense.

## Remaining completion gate

Migration `0007` intentionally grants runtime workloads no direct table DML.
There is currently no application command or narrow `SECURITY DEFINER`
database function that atomically accepts a validated quote and appends its
quote valuation plus fee-estimate rows. The test uses the migration-owner
fixture only to provision those pre-runtime facts, then exercises the existing
POST and REVERSE lifecycle boundaries. Its concrete fee example is the
`PROVIDER` category; broader category coverage remains part of the eventual
quote-boundary contract.

KAN-78 therefore remains **In Progress**. Moving it to **In Review** would be
premature until the canonical quote producer and contract are available and a
production-quality append boundary is implemented, authorized, and tested
without granting direct runtime writes. That boundary should reuse
`ledger_valuation_snapshots` and `ledger_fee_estimate_snapshots` rather than add
parallel tables.

## Local verification

```powershell
$env:RUN_INFRASTRUCTURE_INTEGRATION = '1'
$env:TEST_DATABASE_URL = '<guarded loopback PostgreSQL fixture URL>'
npm run test:integration --workspace @crypto-lending/api -- fee-snapshot-ledger.integration-spec.ts
npm run test:integration --workspace @crypto-lending/api -- database-principals.integration-spec.ts
npm test --workspace @crypto-lending/api -- --runInBand 0012-create-yield-operation-controls.migration.spec.ts 0013-repair-ledger-fee-adjustment-integrity.migration.spec.ts
npm run typecheck --workspace @crypto-lending/api
npm run lint --workspace @crypto-lending/api
npx --no-install prettier --check apps/api/src/infrastructure/database/migrations/0013-repair-ledger-fee-adjustment-integrity.migration.ts apps/api/test/infrastructure/fee-snapshot-ledger.integration-spec.ts docs/KAN-78.md
git diff --check
```
