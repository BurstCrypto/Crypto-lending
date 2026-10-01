# Zero-cost repository audit — 2026-09-08

**Status: the zero-cost repository scope at the implementation commit below was
completed and locally audited.** All identified repository check failures at
that checkpoint were corrected and verified.

Subsequent engineering work and dependency findings are covered by the
[Aave connection and security follow-up](aave-readonly-integration.md). This
historical record's images, SBOMs, and test counts do not attest that later tree
or establish live provider readiness.

Audited implementation commit:
`69b581f73270b8619cb4a0d65f5ad1b3dddcfbc5`.
Git tree: `39513c7d6526bbbbf807632b9a8124b8f23b3343`.
This completion record is a subsequent documentation-only change. The retained
builds, image inventories, and release manifest bind the implementation commit.

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
- Added missing challenge-identity records and preserved exact PostgreSQL
  timestamp precision in wallet test fixtures. Revocation mutation tests now use the
  current cumulative verifier; historical upgrade/rollback suites explicitly
  select the migration boundary they exercise.
- Updated the runtime scanner's per-file limit to accommodate the inspected
  18 MiB libvips libraries in the Next.js trace. The aggregate limit remains
  64 MiB, and bounded traversal and forbidden-dependency checks remain enforced.
- Rebound the threat model and independent-test preparation packet to the
  current reviewed contents. Independent approval remains pending.

## Evidence

Command logs and local artifacts are retained in the ignored directory
`.local-validation/repository-audit-20260908/`.
The `audit-results.json` record contains artifact sizes and SHA-256 hashes,
including the full integration run and the focused reruns that resolved its
failures.

| Check                                            | Verified result                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| API unit tests                                   | 298 suites, 5,304 passed                                                                 |
| Web unit tests                                   | 75 files, 820 passed                                                                     |
| API end-to-end tests                             | 9 suites, 71 passed                                                                      |
| PostgreSQL, Redis, and local SQS integration     | 40 suites, 279 passed across the full run and focused reruns after repairs               |
| Infrastructure/security/provider validator tests | 762 passed in Linux, no skips; changed security bindings and runtime bounds also rerun   |
| Production preflight tests                       | 137 passed in Linux, no skips                                                            |
| Release and image-SBOM tests                     | 47 and 28 passed, no skips                                                               |
| Wallet lab                                       | Lint/typecheck passed; 23 files, 182 tests passed                                        |
| Local demo, local EVM, offline testnet tools     | 12, 10, and 8 tests passed; clean-copy demo configuration preflight passed               |
| PowerShell invocation guards                     | 121 tests passed; fake/local service calls only                                          |
| Jira HTTP security                               | 5 tests passed, zero network requests                                                    |
| Formatting, lint, typecheck, whitespace          | Passed                                                                                   |
| Infrastructure validation and secret scan        | Passed, including tracked history and index                                              |
| CloudFormation lint                              | All eight checked templates passed                                                       |
| Production application builds                    | API and Next.js passed in a clean Linux copy                                             |
| OpenAPI                                          | Regenerated with no tracked contract drift                                               |
| Hardened production images                       | Both built; nonroot UID/GID, read-only runtime, no-network module-load checks passed     |
| Image inventories                                | Syft 1.51.1 SPDX/native records validated against exact archive/config/manifest bindings |
| Release-candidate manifest                       | Created and verified against the audited implementation commit                           |

The initial broad run exposed stale fixtures and host-specific assumptions;
the table reports the final verified outcomes. The dedicated PostgreSQL fixture
exercised compiled migrate/status/rollback/remigrate commands. Linux validation
covered link tests unavailable on the Windows host. The clean copy excluded the
working directory's development `.env.local`. Temporary audit services were
isolated from existing projects and removed after verification.

The retained image IDs are:

- API: `sha256:67a4d06e871c9870fe856162b8578832845fbe2993ba654e1e12ebeb42c95b5a`
- Web: `sha256:6c0b5c73b7373c78941ba65c076b9a17ec222e4e60508db63000a2e353b82abc`

The validated API and web inventories contain 294 and 166 packages,
respectively. Release-manifest SHA-256:
`a6ebe69d5dc70f3bce43ad92195214c4de69d70df15e2c39dd1028e0f0e7c328`.

## Dependency disposition

The production npm audit reports **zero vulnerabilities**. The full development
dependency graph reports four moderate findings, with zero high or critical
findings, in `@solana/web3.js`, `jayson`, `stream-json`, and `uuid`.
These are confined to the development dependency chain. The production runtime
and SBOM guards verify exclusion of the Solana SDK and its affected transport
dependencies. The SDK remains available for test fixtures and isolated
development/testnet tooling.

The underlying advisories concern
[nested JSON filtering](https://github.com/advisories/GHSA-528h-pc64-c93x) and
[UUID buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
The audit tool offered a breaking downgrade to SDK `0.0.3`; that was not applied.
The retained development findings require a compatible upstream remedy or a
separately reviewed tooling migration. They do not enter the production images.

## Remaining external gates

Production readiness still requires independently controlled provider and
chain evidence, approved exact write manifests and limits, key custody and
authority enrollment, independent security/legal/finance decisions, and
deployed recovery and operational exercises. See
[the rollout boundary](mainnet-rollout.md) and
[the production go-live plan](production-go-live-plan.md).

The production go-live preflight intentionally remains blocked: live-read and
mainnet-write evidence is absent and financial actions remain disabled. This
checkpoint closes the current repository work; those external decisions and
live operational gates remain pending.

This is a local source and automated-test audit. It is not an independent
penetration test, a live-provider audit, or production approval.
