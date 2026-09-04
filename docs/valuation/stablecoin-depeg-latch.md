# Durable stablecoin depeg latch

Status: implemented locally but dormant and unavailable to production callers.

Migration `0019` adds an exact-asset, append-only depeg latch store for the KAN-61 version 1
mainnet registry. It accepts only the active Ethereum and Solana USDC, USDT, and PYUSD identities,
including the registry fingerprint, network ID, token identity, and decimals. Base and every other
network are rejected.

## State and evidence contract

- `stablecoin_depeg_latch_events` is append-only. Update, delete, and truncate triggers run as
  `ALWAYS`; rollback refuses to drop the store after either table has data.
- `stablecoin_depeg_latch_projections` is the current sticky state. Its transition trigger permits
  only revision-contiguous `LATCHED -> CLEARED -> LATCHED` transitions backed by an already-written
  matching event. A relatch cannot predate the preceding clear.
- The TypeScript command boundary reruns the pure KAN-66 valuation or recovery classifier. Raw
  observations are not retained; deterministic SHA-256 evidence, command, authorization, and event
  fingerprints are retained with opaque actor references.
- Exact command replay is idempotent. Reusing a correlation ID, latch/clear ID, evidence digest,
  authorization ID, authorization fingerprint, or authorization nonce with conflicting content is
  rejected. Advisory locks plus row locks serialize absent and existing asset state.
- All TypeScript reads fail closed on unexpected columns, types, cross-field state, timestamps,
  revisions, or result/outcome shapes. Persisted timestamps must be finite.

## Recovery boundary

A clear command is valid only when `evaluateStablecoinRecovery` returns
`RECOVERY_CANDIDATE_CLEARED`. Its structural authorization is limited to
`CLEAR_STABLECOIN_DEPEG_LATCH`, explicitly cannot authorize a financial action, expires within 15
minutes, and binds the exact asset, current latch ID and revision, recovery-evidence digest, clear ID,
evidence actor, risk approver with role `RISK_APPROVER`, time window, and one-use nonce. Evidence actor
and approver must differ.

No cryptographic authorization issuer or verifier exists yet. Consequently, no API or worker role has
`EXECUTE` on `clear_stablecoin_depeg_latch`; the migration verifier fails if that privilege is added.
The schema owner can exercise clear only in isolated integration tests. Activating recovery requires a
separately reviewed issuer/verifier and privilege migration.

## Granted capabilities

| Principal      | Read current latch | Record latch | Clear latch | Direct table/type access |
| -------------- | ------------------ | ------------ | ----------- | ------------------------ |
| API runtime    | Yes                | No           | No          | No                       |
| Worker runtime | Yes                | Yes          | No          | No                       |
| Legacy runtime | No                 | No           | No          | No                       |
| Migration role | No                 | No           | No          | No                       |

The repository is exported for focused testing but is not registered in a Nest module, controller,
worker, or endpoint. It performs no feed, wallet, chain, cloud, or mainnet call and provides no
financial authorization.

## Remaining activation dependencies

Production use still requires independently approved live valuation feeds, authenticated evidence
actor identity, a cryptographically verifiable one-use Risk authorization issuer, an operational
runbook, monitoring, and an explicit module/worker activation review. Those are external authority or
integration steps; migration `0019` does not claim that they are complete.
