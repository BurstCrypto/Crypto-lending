# Zero-cost repository audit — 2026-09-08

This record covers the current repository implementation and its local
verification checkpoint. Final production-image and database evidence is being
collected before this checkpoint is marked complete.

## Scope

The audited scope includes the dormant Ethereum/Solana signed-command verifier
and proof binder, wallet revocation and key-rotation recovery, the PostgreSQL
two-queue scheduler and authenticated completion, repository security and
deployment guards, application builds and tests, and the local regression
harnesses. No cloud resources, provider accounts, funded wallets, or live
mainnet transactions are needed for these checks.

Migrations `0033` through `0038` are registered. Migrations `0039` through `0042`
remain direct-import-only, unregistered, and owner-only. The source and
deployment authority tables and production write-manifest registry remain
empty. The audit does not grant signing, broadcast, resend, settlement, worker
registration, or provider-write authority.

## Changes reviewed

- Completed the durable scheduler adapter and authenticated completion path;
  real PostgreSQL tests cover exclusive concurrent claims, fencing, queue
  separation, expiry, attempt limits, durable completion, duplicate rejection,
  and manual review.
- Removed the production Solana SDK dependency. The bounded canonical wire
  verifier uses built-in cryptography and is checked against SDK-generated
  legacy and v0 fixtures, malformed encodings, and every truncated wire prefix.
- Extended the dormant-boundary audit to the proof, recovery, and scheduler
  artifacts, including a static inventory of 42 additional source and test
  files. Updated reviewed fingerprints and mutation tests without enabling
  runtime authority.
- Corrected obsolete migration fixtures, the cancellable readiness composition
  in the infrastructure smoke test, the bounded deployment-script input limit,
  Linux link-test fixtures, and local-demo balance-queue configuration.
- Rebound the threat model and independent-test preparation packet to the
  current reviewed contents. Independent approval remains pending.

## Evidence

Command logs and local artifacts are retained in the ignored directory
`.local-validation/repository-audit-20260908/`. The final evidence table will
record the reviewed source revision and completed checks.

## Remaining external gates

Production readiness still requires independently controlled provider and
chain evidence, approved exact write manifests and limits, key custody and
authority enrollment, independent security/legal/finance decisions, and
deployed recovery and operational exercises. See
[the rollout boundary](mainnet-rollout.md) and
[the production go-live plan](production-go-live-plan.md).

This is a local source and automated-test audit. It is not an independent
penetration test, a live-provider audit, or production approval.
