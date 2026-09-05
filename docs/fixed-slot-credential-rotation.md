# Fixed-slot credential rotation control plane

## Status and authority

This repository contains a local-only state-transition validator for the API
PostgreSQL, worker PostgreSQL, and API Redis A/B credential slots. It records
only exact secret version identifiers, state and evidence SHA-256 bindings,
deployment identity, and approval references. It never accepts a credential,
credential hash, connection string, or secret value.

The checked-in record is deliberately `NOT_AUTHORIZED` and `NOT_RUN`. Running
the validator does not grant authority to regenerate a secret, install a
PostgreSQL verifier or Redis password, change a CloudFormation parameter,
replace a task, terminate a session, or revoke an identity. Those actions need
separate approval and tooling. The validator has no AWS, database, Redis,
network, DNS, subprocess, or file-write capability, and every report fixes the
corresponding call and mutation counters at zero.

This is the inert control-plane portion of the fixed-slot rotation gap. The
current CloudFormation consumers still use mutable secret-stage selection and
the deployment command does not yet compare a submitted transition with
deployed state. Exact `VersionId` consumer pinning and a deployment-time
current-state guard remain required before this procedure can authorize a
production rotation.

## Records and local verification

The default command validates only
`infra/aws/fixed-slot-credential-transition.example.json` in `example` mode:

```powershell
npm run infra:validate:credential-transition
npm run infra:test:credential-transition
```

An operational record must be created only under the already ignored
`.local-validation/` directory, must end in
`.credential-transition.local.json`, and must never be committed. Adoption and
transition modes require an explicit canonical validation instant plus
independently supplied expected account, Region, stack name, stack ID,
environment, parent-template hash, and workload-template hash. The validator
compares every binding with the record instead of trusting its self-asserted
identity. Validate locally with the following shape, replacing every bracketed
value with the separately reviewed non-secret binding:

```powershell
$bindings = @(
  '--at', '<YYYY-MM-DDTHH:MM:SSZ>',
  '--expected-account', '<12-digit-account-id>',
  '--expected-region', '<region>',
  '--expected-stack', '<stack-name>',
  '--expected-stack-id', '<full-stack-arn>',
  '--expected-environment', '<non-production-environment>',
  '--expected-parent-template-sha256', '<lowercase-sha256>',
  '--expected-workload-template-sha256', '<lowercase-sha256>'
)
node infra/aws/validate-fixed-slot-credential-transition.mjs --mode adopt --record .local-validation/<reviewed>.credential-transition.local.json @bindings --json
node infra/aws/validate-fixed-slot-credential-transition.mjs --mode transition --record .local-validation/<reviewed>.credential-transition.local.json @bindings --json
```

There is intentionally no apply or execute mode. The loader accepts only a
bounded, non-empty, canonical path to a stable regular file with one hard link.
It rejects symbolic links, linked ancestors, directories, unstable reads,
oversized input, a UTF-8 BOM, invalid UTF-8, and duplicate JSON keys. CLI input
failures use fixed messages that do not disclose supplied paths or arguments.
Example mode rejects every operational binding argument and remains tied to
the inert checked-in example.

## State and history contract

One record contains an exact deployment identity and complete current and
target state for all six slots:

| Scope           | Phase parameter                 | Slot A backend identity      | Slot B backend identity      |
| --------------- | ------------------------------- | ---------------------------- | ---------------------------- |
| API database    | `ApiDatabaseCredentialPhase`    | `crypto_api_login_a`         | `crypto_api_login_b`         |
| Worker database | `WorkerDatabaseCredentialPhase` | `crypto_worker_login_a`      | `crypto_worker_login_b`      |
| API Redis       | `RedisCredentialPhase`          | `crypto_api_<environment>_a` | `crypto_api_<environment>_b` |

Each slot stores a bounded generation number, its current exact secret
`VersionId`, and the complete ordered history of version IDs used by that
slot. Histories are append-only, version IDs are unique across every workload
and slot, and the last history entry must equal the current version. A burned
or retired version ID is never removed or reused. The local record retains at
most 64 generations per slot and fails closed at that bound; long-term history
must be moved into a separately reviewed durable control before the bound is
reached.

Every post-adoption record binds the canonical SHA-256 of its complete current
state and the canonical SHA-256 of the preceding transition. The validator
also returns hashes of the current state, target state, and complete canonical
record so the next reviewed record can extend the chain. These hashes are
metadata integrity bindings, not proof that an external action occurred.

`operatorMode` must remain `DISABLED` through every transition. The Redis
revocation operator is outside this validator and cannot be activated by a
record or plan.

## Reviewed state machine

Each record after adoption may change exactly one scope by exactly one step.
The phase graph is:

```text
A_ONLY <-> BOTH_USE_A <-> BOTH_USE_B <-> B_ONLY
```

The full operation sequence is:

1. `ADOPT_AND_PIN` starts from six explicit generation-zero `UNPINNED`
   placeholders, captures six distinct generation-one version IDs, and keeps
   every scope at `A_ONLY` while workload desired counts remain zero.
2. `PREPARE_INACTIVE` leaves the phase unchanged, advances only the inactive
   slot by one generation, appends one fresh version ID, and binds independent
   secret-regeneration and backend-installation evidence.
3. `ABORT_PREPARATION` may clear an unexpired preparation without removing or
   reusing its burned version. A later attempt requires another fresh
   generation.
4. `ENTER_OVERLAP` moves only from a single-slot endpoint to its adjacent
   overlap state. It consumes the exact prepared-slot evidence and preserves
   the preparation's bounded window.
5. `MOVE_ACTIVE_SLOT` switches only between the two overlap phases. Slot
   versions and the active overlap window remain immutable.
6. `EXIT_OVERLAP` moves only to the adjacent single-slot endpoint after binding
   replacement readiness, old-slot drain, backend revocation, old-session
   denial, and rollback evidence.

Preparation, approval, and overlap windows use canonical UTC timestamps, last
no more than 24 hours, and must be active when checked. Direct endpoint jumps,
multiple-scope changes, stale predecessor state, active-slot regeneration,
history truncation, replayed IDs, expired windows, evidence drift, and schema
extensions fail closed. Secret regeneration, backend installation, phase
change, and rollback approval groups must be mutually disjoint, and the
independent verifier cannot appear in any approval group.

## Separately authorized inactive-slot work

A successful operational validation emits only symbolic, non-executable steps.
The future executor must remain a separate reviewed component and must bind
each action to the exact account, Region, stack, environment, template hashes,
scope, inactive slot, and candidate `VersionId` recorded here.

For an API or worker database slot, separate operators must generate a fresh
secret version, install only that value as the SCRAM verifier for the exact
fixed login, preserve its existing least-privilege capability membership, and
prove candidate authentication plus current active-slot continuity without
recording credential material.

For a Redis slot, separate operators must generate a fresh secret version,
install only that password on the exact fixed ElastiCache user while preserving
the reviewed ACL, and prove candidate authentication plus current active-slot
continuity. The application revocation task is not a password installer and
must not be broadened into one.

After replacement readiness, retirement separately requires draining the old
slot, revoking the exact backend identity, terminating only its sessions, and
proving old reconnect denial while the replacement remains healthy. AWS API
calls, secret generation, PostgreSQL or Redis connections, deployments, and
resource changes are all outside this local validator and remain
`NOT_AUTHORIZED` until explicitly approved.
