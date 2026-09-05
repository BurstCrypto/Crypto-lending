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

The production CloudFormation contract now takes six explicit A/B-slot
`VersionId` parameters plus one explicit Redis-operator `VersionId`. It binds
every A/B database, Redis-user, and ECS secret consumer to the exact selected
version and never selects `AWSCURRENT` or another mutable stage. The
application invocation guard now compares a submitted transition with the exact
immutable deployed stack and binds the current template, complete parameter and
tag snapshots, transition record, current and target states, reviewed change
set, and explicit execution acknowledgement. This closes the in-repository
deployment-binding gap; it does not authorize or perform any external rotation
step.

The separate shared authentication/wallet secret also has an exact immutable
VersionId, but it is not a seventh fixed slot and has no `UNPINNED` state. The
guard preserves its ARN/VersionId/KMS tuple during ordinary releases and
forbids changing it in a fixed-slot transition. Its future dedicated transition
record must not be folded into this six-slot A/B state machine.

The Redis operator secret is likewise not an A/B slot. Its generated version is
unknown during the inert initial CREATE, so schema-v2 adoption records bind its
one `UNPINNED` source marker to an exact target VersionId alongside the six
slots. Every later record must preserve that exact operator version. Rotating it
requires a future dedicated Redis-operator transition; the A/B state machine
cannot authorize that change.

The RDS `crypto_admin` master credential is outside this record entirely. RDS
generates, stores, and rotates its managed password through Secrets Manager,
encrypted with the application data customer-managed KMS key. It has no
CloudFormation VersionId parameter, `UNPINNED` marker, A/B phase, or state key.
RDS rotates it every seven days by default, and a separately authorized
master-credential operation must prove the live database/secret identity,
master-session drain, new authentication, old-password denial, runtime-login
continuity, and recovery behavior. Those operational identities and exact
results belong only in the nested schema-v1 `rdsMasterLifecycleEvidence` record
covered by the outer two-role-signed schema-v2 bundle. Its primary
database/secret/key identities must exactly match the schema-v2 deployment
target's closed `rds` block; the outer signatures also cover the v2 target
digest, which includes that block's CloudFormation stack identity. Exact `active` statuses,
`AWSPREVIOUS`/`AWSCURRENT` rotation stages, the rebound `AWSCURRENT` stage, and
ordered access/rotation/restore timestamps are closed fields.

The record's schema-v1 `supportingCapture` metadata binds the independently
calculated `captureSha256` of a separately retained canonical sanitized capture.
The outer signatures cover the digest, but the validator does not open that
capture file; each signing role must calculate and match it before signing.
Repository/no-bundle, absent, forged, or unbranded input emits
`RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING`; malformed, already stale, or counterfeit
bundle material is rejected during load/application as sanitized
`PRODUCTION_PREFLIGHT_EVIDENCE_BUNDLE_INVALID`, before any report. Evidence that
later becomes stale restores the RDS blocker during evaluation and can
additionally produce `PUBLIC_LAUNCH_AUTHORITY_DECISION_UNVERIFIED` when a launch
decision is bound. The evidence record cannot perform a rotation and contains
no password, `SecretString`, connection, or log material, and the separately
retained capture is subject to the same prohibition. Adding the master
credential to this six-slot schema would falsely imply an overlap or
stack-controlled rollback that the RDS-managed lifecycle does not provide.

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

## Guarded CloudFormation updates

`invoke-application-baseline.ps1` separates updates into two exact intents:

- `CREDENTIAL_TRANSITION` requires the ignored approved record, its exact
  `adopt` or `transition` mode, a current canonical validation instant, the
  immutable stack ARN, all seven target `VersionId` values, and all four
  phase/operator controls. The guard validates the record twice before AWS
  discovery, verifies the deployed current state, prohibits parent-template and
  unrelated parameter/tag changes, advances the three credential-chain tags,
  and binds those facts into the change-set description and acknowledgement.
- `APPLICATION` rejects transition evidence and permits an ordinary release
  only after adoption. All seven pinned versions and all four controls must be
  explicitly supplied and must exactly equal the deployed values. The existing
  credential-chain tags are carried forward unchanged while reviewed
  application parameters or templates may change.

Both intents additionally require the named auth/wallet secret VersionId and
compare the complete deployed auth/wallet ARN/VersionId/KMS tuple. A mismatch
fails closed and requires the still-unimplemented dedicated auth/wallet
transition workflow.

Every update addresses the immutable stack ARN rather than its mutable name.
Deploy repeats all local and current-state checks, verifies the exact submitted
template, parameters, tags, and versioned child artifacts, then re-reads the
current stack immediately before execution. Any drift requires a new Plan and
review. The script makes no AWS call without `-AllowAwsApiCalls`; Deploy also
requires the exact hash-bound billable-resource acknowledgement it prints.

## State and history contract

One schema-v2 record contains an exact deployment identity and complete current
and target state for all six A/B slots plus the immutable Redis-operator secret
version:

| Scope           | Phase parameter                 | Slot A version parameter       | Slot B version parameter       |
| --------------- | ------------------------------- | ------------------------------ | ------------------------------ |
| API database    | `ApiDatabaseCredentialPhase`    | `ApiDatabaseSlotAVersionId`    | `ApiDatabaseSlotBVersionId`    |
| Worker database | `WorkerDatabaseCredentialPhase` | `WorkerDatabaseSlotAVersionId` | `WorkerDatabaseSlotBVersionId` |
| API Redis       | `RedisCredentialPhase`          | `RedisApiSlotAVersionId`       | `RedisApiSlotBVersionId`       |

The separate `RedisOperatorSecretVersionId` state field and template parameter
identify the one operator credential; they do not add a phase or another slot.

The version parameters intentionally have no defaults. Each must be supplied
as either the exact uppercase `UNPINNED` adoption sentinel or a 32–64 character
Secrets Manager `VersionId` containing only ASCII letters, digits, underscore,
or hyphen. The parent passes all seven values to the content-addressed workload
boundary and passes the operator value to the observability child. The workload
child phase-selects the active database and API Redis versions, while both
operator consumers use the same exact operator version.

The only accepted unpinned state has all seven sentinels, every phase at
`A_ONLY`, API, web, and worker desired counts at zero, and the Redis operator
disabled. In that state both Redis application identities and the operator
identity are `off` with `no-password-required`; the operator task is absent;
and the API/worker execution roles receive no fixed-slot secret permissions.
Mixed pinned/unpinned states fail parent and child validation. This sentinel
exists only so a zero-count initial stack can create retained secrets whose
generated version IDs can then be captured by a separately authorized adoption
procedure; it cannot activate a workload or the operator.

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

The Redis operator field has no generation/history semantics because this
validator cannot rotate it. Adoption captures it once, post-adoption records
require it to remain byte-for-byte unchanged, and a dedicated future lifecycle
must carry its own append-only rotation evidence.

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

1. `ADOPT_AND_PIN` starts from six explicit generation-zero A/B-slot
   placeholders plus the operator's `UNPINNED` marker, captures seven distinct
   exact version IDs (six generation-one slots and the operator binding), and
   keeps every scope at `A_ONLY` while all three workload desired counts remain
   zero. The follow-up template parameters must exactly equal all seven target
   bindings before any workload can be activated.
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
