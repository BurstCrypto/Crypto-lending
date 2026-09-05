# KAN-50: Secrets, encryption, and least privilege

KAN-50 is the local SEC-002 control gate for credential handling, encrypted
service configuration, and application-role boundaries. It strengthens the
checked-in evidence without creating an AWS resource or representing static
analysis as proof of a deployed environment.

This repository work performs no stack plan or deployment, secret read, IAM simulation,
Access Analyzer call, hosted CI dispatch, image publication, paid scan, or live
rotation. The CloudFormation application template now composes a separate,
content-addressed workload-boundary child so the parent remains below
CloudFormation's 51,200-byte direct-body limit. No checked-in template was
uploaded or deployed.

## Dependency and ticket boundary

KAN-50 depends on:

- KAN-34 / FND-003, whose application baseline is in review; and
- KAN-49 / SEC-001, whose repository-wide threat-model packet is ready for
  review while independent Security approval remains pending under KAN-235.

The KAN-50 subtasks are deliberately separated:

- **KAN-232:** split database administrator, migration, API-runtime, and
  worker-runtime principals and perform authorized rotation/denial exercises;
- **KAN-233:** replace the shared Redis token with service-scoped ACL users and
  perform authorized rotation/revocation exercises;
- **KAN-243:** enforce history-aware committed-secret scanning and repository
  credential hygiene; and
- **KAN-244:** validate encryption, secret injection, trust policies, and IAM
  capability boundaries offline.

All four subtasks are assigned to Trey. KAN-243 and KAN-244 completed their
local static-control batch first; KAN-232 and KAN-233 now also contain local
runtime boundaries and Docker-backed denial/rotation exercises. Their deployed
acceptance still requires a later, explicitly authorized non-production
exercise.

## Checked-in security contract

### Secret creation and injection

The parent delegates the `crypto_admin` master password to RDS-managed Secrets
Manager custody. RDS generates and owns that secret, encrypts it with the
application data customer-managed KMS key, and rotates it every seven days by
default. The workload-boundary child separately generates migration, API A/B,
worker A/B, Redis API A/B, and disabled-by-default Redis operator secret
material with the same application data key. Neither template accepts a
plaintext password as a CloudFormation parameter or output. Generated runtime
database values are not proof that a PostgreSQL LOGIN exists or has that SCRAM
verifier; the reviewed bootstrap deliberately does not synchronize passwords.

The RDS-managed master credential is not a fixed slot and is not selected by a
CloudFormation Secrets Manager VersionId. The parent supplies no
`MasterUserPassword` or custom master secret. It keeps the existing
`DatabaseCredentialsSecretArn` output name for compatibility, but that output
contains only `Database.MasterUserSecret.SecretArn`. It is bootstrap metadata,
not authority to expose the secret to an application task.

The authentication/wallet secret is different: the template does not create or
inspect it. The operator must supply the selector-free ARN and exact 32-64
character `VersionId` of one externally provisioned, separately KMS-encrypted
JSON secret containing only the current
pre-authentication seal key and the six canonical authentication/wallet key-ring
documents. The API execution role alone receives exact secret-read/decrypt
permission. Production task wiring and offline preflight reject all legacy
single-key auth and wallet selectors. All seven JSON-key selectors share the
exact immutable VersionId and empty version stage; omitted versions,
`AWSCURRENT`, `AWSPREVIOUS`, and alternate version references fail closed. The
ARN and VersionId are auditable deployment metadata, while secret payload bytes
remain outside CloudFormation parameters and outputs. Static checks cannot
prove the external secret's contents, custody, policy, or readability.

The required replacement launch-time injection contract is:

| Workload          | Injected secret scope                                                             | Forbidden scope                                              |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| API               | API database login, selected Redis ACL user, and closed auth/wallet secret fields | bootstrap, migration, and worker DB secrets                  |
| outbox worker     | worker database login                                                             | bootstrap, migration, API DB, Redis, and auth/wallet secrets |
| web               | none                                                                              | every database, Redis, and auth/wallet secret                |
| one-off migration | migration-only username and password                                              | bootstrap/master, runtime DB, Redis, and auth/wallet secrets |

ECS obtains runtime values through task-definition `Secrets` entries.
Sensitive values must not be placed in ordinary task-definition `Environment`
entries. The six fixed database/Redis A/B slots require explicit, no-default
Secrets Manager `VersionId` parameters, and every fixed-slot consumer selects
the exact phase-matched version rather than `AWSCURRENT`. The separately
immutable, no-default `RedisOperatorSecretVersionId` pins the generated operator
credential without making it a seventh A/B slot. Its exact stage-free selector
is used by both the ElastiCache operator user and conditional one-off ECS task;
any future authorized `ecs run-task` path must select Fargate Linux platform
`1.4.0` or newer. The checked-in template only registers that task definition.
Changing a secret or its pinned parameter does not update an already running
ECS task; the approved rotation procedure must launch replacement tasks before
revoking the old credential. The checked-in parent/child composition encodes
this contract, but it has not been staged, planned, or deployed.

The auth/wallet VersionId is separate from those six A/B slots and has no
`UNPINNED` sentinel. CREATE requires an exact initial version. On UPDATE, the
invocation guard compares the deployed secret ARN, VersionId, and KMS key ARN as
one tuple. Neither `APPLICATION` nor `CREDENTIAL_TRANSITION` may change it. The
separate `AUTH_WALLET_TRANSITION` intent now accepts a two-role-signed offline
record for no-op adoption or for one exact VersionId advance with one sanitized
inner-purpose operation, while preserving the secret/KMS ARNs, composite
credential chain, and Redis-operator chain. Its production authority registry
is intentionally empty, and external
custody, authorized key population, live drills/captures, independent approval,
and deployment remain open production gates.

The database master is also separate from the fixed-slot and auth/wallet
transition schemas. RDS, rather than an application change set, coordinates its
password and managed secret. A bootstrap operator may bind the observed managed
VersionId in sanitized execution evidence, but that observation is not a stack
parameter, an A/B slot, or permission to pin or roll back the RDS credential.

The closed nested schema-v1 `rdsMasterLifecycleEvidence` record is covered by
the outer two-role-signed schema-v2 production-evidence bundle. It binds the
primary and restored database, managed-secret, VersionId,
compatibility-output, and KMS identities plus exact IAM/KMS,
workload-isolation, session-drain, rotation, authentication-denial,
runtime-continuity, and restore/rebinding results. The primary database ARN,
resource ID, secret ARN, and application-key ARN must equal the schema-v2
deployment target's closed `rds` block; the outer signatures also cover its v2
digest, which includes the CloudFormation stack ID. Primary, rotated, and rebound secret statuses are
literal `active`, rotation uses distinct `AWSPREVIOUS` and `AWSCURRENT`
VersionIds, and the rebound version is `AWSCURRENT`.

The record also carries closed schema-v1 `supportingCapture` metadata for a
separately retained `RDS_MASTER_LIFECYCLE_CAPTURE` in
`SANITIZED_CANONICAL_JSON_V1` format. The outer signatures cover its
`captureSha256` and ordered collection/access/rotation/restore timestamps. The
validator checks the metadata, digest shape, stages, statuses, and time order
but does not open the capture file; both signing roles must independently
calculate and match the canonical capture digest before signing.

Repository/no-bundle, absent, forged, or unbranded input emits
`RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING`. A malformed, already stale, or
counterfeit bundle is instead rejected during load/application as sanitized
`PRODUCTION_PREFLIGHT_EVIDENCE_BUNDLE_INVALID`, before any report. If accepted
evidence later becomes stale, evaluation restores the RDS blocker and can
additionally invalidate a bound launch decision with
`PUBLIC_LAUNCH_AUTHORITY_DECISION_UNVERIFIED`. Neither record nor bundle can
authorize or perform a master-password operation. The record contains
operational identifiers only, never a password, `SecretString`, connection, or
log, and neither the controlled bundle nor separately retained capture may be
checked into Git or Jira. No acceptable live RDS lifecycle record exists today.

For initial adoption, the six A/B parameters and separate operator parameter
must all be the `UNPINNED` sentinel while API, web, and worker desired counts are
zero, all phases are `A_ONLY`, and the Redis operator is disabled. In that state
all Redis identities are off, the operator uses `no-password-required`, and
fixed-slot database/Redis execution-role reads remain closed. Version parameters
intentionally have no defaults, so creation requires all seven sentinels to be
supplied explicitly and cannot activate a workload. The schema-v3
`ADOPT_AND_PIN` record changes all seven to exact generated VersionIds,
initializes the operator's singleton append-only history, and applies them in
one zero-count follow-up update. The operator user then receives its exact
password reference while its ACL remains off.

The application invocation guard now has separate `CREDENTIAL_TRANSITION`,
`AUTH_WALLET_TRANSITION`, `REDIS_OPERATOR_TRANSITION`, and `APPLICATION` update
intents. Fixed-slot credential transitions require a locally approved schema-v3
record whose exact current/target state, including the operator VersionId and
history, is compared with the immutable deployed stack and bound into the
reviewed change set and acknowledgement; unrelated template, parameter, and tag
changes are rejected. After adoption, each fixed-slot transition and ordinary
application update preserves the operator VersionId and history.

The dedicated Redis-operator intent accepts only a canonical, two-role-signed
no-op `ADOPT_EXISTING_BINDING` or one exact
`ROTATE_DISABLED_OPERATOR_CREDENTIAL` VersionId append. It binds the immutable
parent and child stacks/templates, secret/KMS/user identities, the current
Redis, composite credential, and auth/wallet chain heads, plus sanitized
evidence and approval references. Adoption only adds the separate Redis chain;
a transition keeps the operator disabled and its task absent, preserves every
A/B slot and auth/wallet binding, permits only the exact non-replacing operator-
user authentication update, and advances the Redis and composite credential
chains together. The production Redis-operator authority registry is
intentionally empty. Ordinary application updates reject all transition
evidence, require every credential-state binding to equal deployed state, and
preserve all three chains. Deploy rechecks the current stack immediately before
execution. These are offline-tested controls, not evidence that any transition
was authorized, staged, or run in AWS.

### Encryption and transport

The checked-in baseline requires:

- RDS storage encryption with the application data KMS key, private placement,
  `rds.force_ssl=1`, and application-side `verify-full` with an explicit CA
  bundle;
- Redis at-rest encryption, required transit encryption, authentication, and
  private placement;
- SQS customer-managed KMS encryption and a resource policy denying all SQS
  actions when `aws:SecureTransport` is false;
- KMS-encrypted CloudWatch log groups with bounded retention; and
- an HTTPS ALB listener using the reviewed TLS policy.

The ALB-to-ECS target connection is currently security-group-restricted HTTP,
not full-hop TLS. KAN-50 must not be represented as end-to-end transport
encryption until a reviewed backend TLS design is implemented and exercised.

### IAM capability matrix

Static validation treats each role as a capability allowlist:

| Role                       | Reviewed capability                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API task execution         | pull only the API image, write API logs, and read only phase-authorized API database, Redis, and auth/wallet secrets                                                              |
| worker task execution      | pull only the worker image, write worker logs, and read only phase-authorized worker database secrets through Secrets Manager                                                     |
| web task execution         | pull only the web image and write web logs; no secret read                                                                                                                        |
| conditional Redis operator | pull the digest-pinned API image, write API-scoped logs, and read only its exact-version operator secret for the reviewed one-off revocation task; no application data capability |
| API task                   | inspect only the jobs and balance-sync source/DLQ attributes                                                                                                                      |
| worker task                | publish only to the jobs and balance-sync source queues, inspect all four queues, and use the data key only through SQS                                                           |
| web task                   | no application AWS API permission                                                                                                                                                 |
| migration task execution   | pull only the supplied API image, write migration logs, and read/decrypt only the supplied migration secret at its exact required VersionId                                       |

The migration task's two JSON-key selectors share one required immutable
VersionId. IAM can scope `GetSecretValue` to the migration secret ARN but not to
one version within that secret, so the exact-version guarantee is enforced by
the task selector, the property-complete local validator, and independent
operator verification. Any future authorized `ecs run-task` guard must require
Fargate Linux platform `1.4.0` or newer; the checked-in template registers only
the task definition and never launches it.

The worker has no Redis environment, secret-read permission, or port-6379
security-group path. The API and worker use distinct execution roles and task
security groups.

No current role has `ReceiveMessage` or `DeleteMessage` on the balance-sync
queue, and no dedicated balance consumer task/service exists. The separate
queue is an inert routing boundary; it does not enable Ethereum/Solana RPC
egress or live balance ingestion.

Trust policies admit only `ecs-tasks.amazonaws.com` from the same account and
the reviewed regional ECS source-ARN shape. Wildcard task actions/resources,
cross-scope secrets, weakened KMS service conditions, and extra injected secret
bindings must fail local mutation tests.

These checks prove the meaning of the checked-in documents; they do not prove
the effective policies of a live account. A later authorized exercise must
record exact role, resource, denied action, request time, and redacted result.

### Runtime credential-chain boundary

Production configuration rejects ambient AWS access keys, session tokens,
profiles, shared credential/config files, web-identity overrides, caller-set
full credential endpoints, and container authorization-token overrides. Only
the required, canonical ECS-managed relative credential URI remains allowed.
The SQS client uses an explicit bounded container-credential provider pinned to
that relative path at the link-local ECS agent endpoint; it does not use the
SDK's ambient default provider chain. It also ignores SDK/shared-profile
endpoint overrides, so task-role-signed SQS requests cannot be redirected by
`AWS_ENDPOINT_URL*` or `endpoint_url` configuration.

When a non-production local SQS emulator endpoint is configured, it must be the
canonical loopback or Compose `localstack` endpoint on port 4566. The client
uses fixed dummy emulator credentials and never forwards credentials inherited
from a developer shell.

## Repository secret scan

The dependency-free scanner examines the Git index and every blob reachable
from `HEAD`, including files deleted by later commits. It rejects sensitive
filenames, known provider credential formats, private/encrypted key material,
credentialed URLs, and bounded high-entropy secret assignments. Oversized text
that cannot be safely inspected fails closed.

Findings report only the rule, scope, blob identity, safe or redacted path,
line, and a short one-way fingerprint. The candidate value must never appear
in standard output, standard error, CI artifacts, logs, documentation, or
Jira.

Reviewed local fixture values such as `test`, `local-emulator`, and
`local_only_password` are non-production sentinels, not credential exceptions.
Allowlisting a whole file or directory is prohibited. Cryptographic object and
artifact digests are not secrets and remain valid.

The deliberate scan boundary excludes untracked working-tree content,
unreachable objects and non-`HEAD` refs, commit/tag messages, external Git LFS
payloads, recognized binary/compressed payload contents, split literals, and
unknown provider-specific formats. Gitlinks/submodules, shallow history,
missing objects, oversized blobs, and non-binary undecodable content fail
closed rather than silently weakening the claim. The complete tree walk favors
simple fail-closed coverage; it should be replaced with a proven object-linear
implementation before repository history becomes large enough for CI latency
to be material.

A passing signature/entropy scan is strong local evidence, not a mathematical
proof that arbitrary secret formats are absent. If a finding is real:

1. stop publication and deployment;
2. revoke or rotate the credential at its authoritative system before relying
   on history cleanup;
3. determine exposure scope without copying the value into a ticket or log;
4. remove the value from the active tree and, with explicit coordination,
   rewrite affected history; and
5. invalidate clones/artifacts and rerun the full scan before review.

## Local verification

The KAN-50 local gates are:

```powershell
npm run security:scan:secrets
npm run security:test:secrets
npm run infra:validate
npm run infra:test:migrations
npm run infra:test:sqs
npm run infra:test:egress
npm test --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
npm run lint --workspace @crypto-lending/api
npm run format:check
git diff --check
```

These commands must make zero AWS, provider, chain, registry, or hosted-CI
calls. IAM Access Analyzer is intentionally not invoked: it is an AWS API, and
custom policy checks can be billable.

## Remaining acceptance gates

KAN-50 stays `In Progress` after this local batch. The following work is not
complete:

- KAN-49's independent KAN-235 threat-model/data-classification approval;
- independently authorized staging and retrieval of the exact versioned nested
  template artifact;
- database secret-to-LOGIN SCRAM installation/authentication and authorized
  inactive-slot regeneration, with the resulting exact version bound into the
  reviewed transition record and deployment parameters;
- deployed proof that RDS created the master secret with the application data
  KMS key, the compatibility output identifies that exact secret, and no API,
  worker, web, or migration task can read or receive it;
- an authorized RDS-managed master-credential rotation and recovery exercise
  recording the default seven-day rotation posture, database/secret identity,
  master-session drain, new authentication, old-password denial, runtime-login
  continuity, KMS access, and snapshot restore/rebinding behavior without
  recording secret bytes, followed by a separately controlled canonical capture
  and a current nested schema-v1 `rdsMasterLifecycleEvidence` record, covered by
  the outer two-role-signed schema-v2 bundle, whose independently matched
  `captureSha256`, exact target identity, statuses, stages, ordered timestamps,
  and `PASS` results bind the exercise to the release and deployment target;
- deployed verification that schema-v3 adoption bound the six A/B versions and
  separate operator version plus singleton history to the exact generated
  Secrets Manager versions, followed by independently signed no-op adoption of
  the Redis-specific chain;
- an authorized run of the locally reviewed Redis revocation task/CLI using the
  exact adopted operator VersionId, including workload drain, old-slot session
  and reconnect denial, immediate operator disablement, managed alarm delivery,
  and sanitized drill evidence;
- authorized inactive-slot Redis credential regeneration and password
  installation, with its exact version bound into the reviewed transition
  record and deployment parameters;
- production trust anchors, an independently signed current-to-target operator-
  version record, external secret staging/custody, candidate and old-credential
  authentication evidence, and a replacement-task/recovery drill before the
  adopted operator password is ever rotated;
- a trusted binding proving the separate migration task's supplied secret/key
  ARNs are the exact application-stack migration outputs;
- actual API, worker, web, and migration startup with injected secrets;
- successful API-only reads and startup validation of the current
  pre-authentication key plus all six production key-ring documents from the
  exact pinned Secrets Manager VersionId, including negative proof that legacy
  selectors and other workloads cannot read them;
- a guarded, current-to-target auth/wallet VersionId transition and deployed
  replacement/rollback drill before rotating that shared external secret;
- application readiness against the immutable migration chain through `0025`;
- live positive and negative IAM decisions against exact deployed role/resource
  ARNs;
- full-hop TLS from the load balancer to application targets;
- an authorized run through the checked-in transition guard proving that its
  recorded current state still matches the live immutable stack at execution
  time;
- deployed runtime-secret rotation followed by forced task replacement and
  old-secret denial; and
- independently reviewed security logs and redaction evidence coordinated with
  KAN-51. KAN-248's local classification/access/query packet remains
  `NOT_EFFECTIVE` while KAN-220 and Security/Privacy/Operations decisions are
  pending; it grants no deployed log access.

None of these gates may be marked `PASS` from a template, local emulator,
mocked response, Jira transition, or branch merge.

## Primary AWS references

- [Passing sensitive data to Amazon ECS containers](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html)
- [ECS injected-secret rotation behavior](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-ssm-paramstore.html)
- [AWS KMS condition keys, including `kms:ViaService`](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-kms.html)
- [IAM Access Analyzer policy validation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-validation.html)
- [ElastiCache user groups](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticache-usergroup.html)
- [RDS password management with Secrets Manager](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html)
