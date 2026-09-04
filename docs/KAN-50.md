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

The parent and workload-boundary child generate separate database bootstrap,
migration, API A/B, worker A/B, Redis API A/B, and disabled-by-default Redis
operator secret material in Secrets Manager using the application data KMS key.
They do not accept plaintext passwords as CloudFormation parameters or outputs.
Generated database values are not proof that a PostgreSQL LOGIN exists or has
that SCRAM verifier; the reviewed bootstrap deliberately does not synchronize
passwords.

The authentication/wallet secret is different: the template does not create or
inspect it. The operator must supply the ARN of one externally provisioned,
separately KMS-encrypted JSON secret containing only the current
pre-authentication seal key and the six canonical authentication/wallet key-ring
documents. The API execution role alone receives exact secret-read/decrypt
permission. Production task wiring and offline preflight reject all legacy
single-key auth and wallet selectors, but cannot prove the external secret's
contents, custody, policy, or readability.

The required replacement launch-time injection contract is:

| Workload          | Injected secret scope                                                             | Forbidden scope                                              |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| API               | API database login, selected Redis ACL user, and closed auth/wallet secret fields | bootstrap, migration, and worker DB secrets                  |
| outbox worker     | worker database login                                                             | bootstrap, migration, API DB, Redis, and auth/wallet secrets |
| web               | none                                                                              | every database, Redis, and auth/wallet secret                |
| one-off migration | migration-only username and password                                              | bootstrap/master, runtime DB, Redis, and auth/wallet secrets |

ECS obtains runtime values through task-definition `Secrets` entries.
Sensitive values must not be placed in ordinary task-definition `Environment`
entries. Updating a Secrets Manager value does not update an already running
ECS task; the approved rotation procedure must launch replacement tasks before
revoking the old credential. The checked-in parent/child composition encodes
this contract, but it has not been staged, planned, or deployed.

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

| Role                       | Reviewed capability                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| API task execution         | pull only the API image, write API logs, and read only phase-authorized API database, Redis, and auth/wallet secrets          |
| worker task execution      | pull only the worker image, write worker logs, and read only phase-authorized worker database secrets through Secrets Manager |
| web task execution         | pull only the web image and write web logs; no secret read                                                                    |
| conditional Redis operator | prerequisite-only image/log/secret path for a future reviewed one-off revocation task; no application data capability         |
| API task                   | inspect only the jobs and balance-sync source/DLQ attributes                                                                  |
| worker task                | publish only to the jobs and balance-sync source queues, inspect all four queues, and use the data key only through SQS       |
| web task                   | no application AWS API permission                                                                                             |
| migration task execution   | pull only the supplied API image, write migration logs, and read/decrypt only the supplied migration secret                   |

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
- database secret-to-LOGIN SCRAM installation/authentication and repeatable
  inactive-slot regeneration;
- a reviewed executable Redis revocation task/CLI (the managed authentication
  and ACL-denial alarm is locally defined, but deployed delivery and drill
  evidence remain external);
- repeatable inactive-slot Redis credential regeneration rather than reuse of a
  retained old slot;
- a trusted binding proving the separate migration task's supplied secret/key
  ARNs are the exact application-stack migration outputs;
- actual API, worker, web, and migration startup with injected secrets;
- successful API-only reads and startup validation of the current
  pre-authentication key plus all six production key-ring documents, including
  negative proof that legacy selectors and other workloads cannot read them;
- application readiness against the immutable migration chain through `0025`;
- live positive and negative IAM decisions against exact deployed role/resource
  ARNs;
- full-hop TLS from the load balancer to application targets;
- deployed secret rotation followed by forced task replacement and old-secret
  denial; and
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
