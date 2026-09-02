# Offline production preflight

Run the bounded production blocker audit from the repository root:

```powershell
npm run production:preflight
```

The command defaults to the authenticated read-only target. To inspect the
stricter mainnet-write target or consume deterministic JSON, run:

```powershell
npx tsx scripts/production-go-live-preflight.ts --target mainnet-write
npm run --silent production:preflight:json
```

This is currently a `BOOTSTRAP_BLOCKER_AUDIT`, not a launch-certification
command. Its repository loader deliberately does not ingest controlled
production evidence, so both targets remain blocked today. A separate,
sanitized external evidence-index ingestion and validation boundary must be
implemented before this CLI can ever report local gates clear.

Exit code `1` means at least one named blocker remains. Exit code `2` means the
arguments were rejected. The evaluator can return exit code `0` only for
strict synthetic or future independently supplied, revision-bound evidence;
even then, `LOCAL_VALIDATION_IS_NOT_PRODUCTION_APPROVAL` remains in the report.

The audit reads only local repository, non-secret artifacts: ECS environment and
secret-reference names, the inert KAN-231 egress example, the KAN-62 provider
decision record and digest, and the mainnet platform capability directory. It
does not scan implementation source for status phrases,
read process-environment values, read secret material or `.env` files, contact
provider endpoints, or accept catalog status strings as adapter evidence. It
performs no DNS, network, cloud, provider, subprocess, or write operation.

`localValidation: PASS` means only that static inspection or an artifact's
structural contract passed. `launchReadiness: BLOCKED` takes precedence when
approval, runtime evidence, production wiring, or the provider target remains
incomplete. Provider counts can advance only from a closed-shape evidence index
that is independently bound to the exact source revision and platform-directory
SHA-256. Read evidence also requires explicit adapter-binding and composition
evidence; write evidence additionally requires action binding, simulation,
reconciliation, and independent security-review evidence.

Bootstrap mode deliberately sets `sourceRevision` to `null`: reading Git `HEAD`
alone cannot prove that the index and worktree are clean. Future evidence
ingestion must obtain the revision from a trusted immutable build/source
manifest and verify that the evidence is bound to that exact artifact. Write
evidence provider IDs must also be a subset of the accepted live-read evidence
provider IDs; otherwise the write provider count remains zero.

The read-only target has a separate isolation gate. It is blocked if the
directory exposes any financial-authorization flag, transaction-enabled status,
or supported action, including when the surrounding directory is malformed.

The current machine-readable launch blockers include:

- `AUTH_DEPLOYED_EVIDENCE_MISSING`
- `EGRESS_POLICY_NOT_ACCEPTED`
- `EXTERNAL_EGRESS_DISABLED`
- `RPC_PROVIDER_EXTERNAL_APPROVAL_PENDING`
- `RPC_PROVIDER_RUNTIME_NOT_APPROVED`
- `LIVE_READ_EVIDENCE_INDEX_MISSING`
- `LIVE_PROVIDER_TARGET_NOT_MET`
- `MAINNET_WRITE_EVIDENCE_INDEX_MISSING`
- `MAINNET_TRANSACTION_PROVIDER_TARGET_NOT_MET`

Run the focused checks with:

```powershell
npm run lint:production:preflight
npm run typecheck:production:preflight
npm run test:production:preflight
```

These checks are also part of the root `lint`, `typecheck`, and `test` scripts
used by CI.
