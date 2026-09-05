# KAN-34: AWS application baseline

KAN-34 defines a reproducible non-production AWS application environment in
native CloudFormation. Repository work for this ticket is deliberately
**zero-deploy**: local validation makes zero AWS calls by default, and no KAN-34
cloud resource, subscription, trial, change set, or paid service has been
activated. KAN-229 documents the separately authorized account-identity reads
that precede any KAN-34 Plan.

## Cost and authorization boundary

The template describes services that incur AWS charges when deployed, including
Fargate tasks, an Application Load Balancer, RDS, ElastiCache, interface VPC
endpoints, Secrets Manager, KMS, and CloudWatch. Merely committing or locally
linting the template does not create those resources.

The public-price refresh recorded on 2026-08-19 assumes `us-west-2`, On-Demand
pricing, a 730-hour month, and no credits, commitments, temporary Free Tier,
tax, Support, Marketplace charges, refunds, or shared-account spend. Gross
modeled subtotals are `$53.09/month` parked with tasks and interface endpoints
off, `$126.09/month` for the template-default endpoint configuration with tasks
stopped, and `$154.07/month` for one continuously running web, API, and worker
task under the low-volume assumptions in KAN-229. The parked correction includes
`$7.30/month` for two public IPv4 addresses used by the two-AZ ALB and
`$0.40/month` for the separately scoped runtime database secret. These figures
are planning inputs only—not an approved budget, quote, spending cap, or
deployment authorization. Account-wide existing spend and headroom must be
added by the finance owner before any cloud Plan.

Do not create a change set or deploy until all of the following are true:

1. a non-production AWS account, named CLI profile, expected 12-digit account
   ID, and Region have been approved;
2. an owner has reviewed the proposed resources and accepted their billable
   nature;
3. digest-pinned web, API, and outbox-worker images exist in an approved private
   ECR registry and support the enforced non-root UID/GID `10001:10001`, a
   read-only root filesystem, and dropped Linux capabilities;
4. the image trust store contains the current AWS RDS CA bundle at the path
   supplied to the stack;
5. an ACM certificate and the test DNS/access path are approved;
6. the Region's AWS-managed S3 prefix-list ID has been independently verified
   for the private ECR-layer egress rule; and
7. KAN-229 has an approved, unexpired billing control record, independently
   verified account-level notification controls, and a live guardrail stack
   matching that record; and
8. the operator has an explicit maintenance, migration, rollback, and cleanup
   window.

KAN-230 defines the provider-neutral approval and evidence record for item 5.
Application Plan and Deploy require a current KAN-230 prerequisite record,
validate it before AWS CLI discovery, and match its exact hostname and issued
certificate ARN. See [KAN-230](KAN-230.md). DNS publication and live TLS evidence
still occur only after a separately authorized load-balancer deployment.

The guarded invocation script performs no AWS call by default. Cloud actions
require explicit switches, a non-default named profile, the expected account
and Region, and—when deploying—a generated typed acknowledgement. Those checks
reduce accidental activation risk; they do not make the described services
free.

`Plan` is not a dry local command: after authorization it verifies the named
account and creates CloudFormation change-set metadata (and, for CREATE, may
leave a `REVIEW_IN_PROGRESS` placeholder stack), but it does not execute the
change set. CREATE plans force all service desired counts to zero. UPDATE plans
carry forward existing optional values before applying explicit overrides, so a
partial update cannot silently reset deletion protection, retention, or sizing.
The immutable change-set description binds SHA-256 digests of the template, the
complete canonical parameter set, the complete tag set, and the KAN-229 control
record. `Deploy` recomputes and verifies each binding.

## Architecture

`infra/aws/application-baseline.yaml` composes two content-addressed child
stacks: workload boundaries and operational observability. The reviewed parent
is 49,632 bytes (1,568 bytes below the AWS limit), while a local guard enforces
a 50,500-byte ceiling and leaves an 868-byte repository guard band before that
ceiling. This prevents accidental growth beyond CloudFormation's 51,200-byte
direct-body limit.

- an internet-facing HTTPS load balancer terminates TLS in public subnets;
- the load balancer pins `routing.http.xff_client_port.enabled=false` so
  forwarded client addresses remain bare IPs compatible with KAN-37's
  fail-closed trusted-single-proxy parser;
- only the approved `ApplicationHostname` is forwarded; unmatched TLS hostnames
  and unmatched plaintext hosts receive a fixed 404 response; only the approved
  plaintext host is redirected to HTTPS;
- web and API Fargate services plus the outbox worker run without public IPs in
  two private application subnets;
- RDS PostgreSQL and ElastiCache run in the private subnets and accept traffic
  only from the application security group;
- private service endpoints provide the AWS paths needed for ECR image pulls,
  logs, generated secrets, SQS, and S3-backed ECR layers without a NAT
  gateway;
- the jobs and balance-sync queues each retain an isolated, bounded-redrive
  source/DLQ topology;
- customer-managed KMS keys protect durable data, queues, secrets, and logs;
- the RDS master secret is reserved for bootstrap and emergency ownership
  recovery only. Separate migration-only, API, and worker PostgreSQL
  credentials and exact database capability roles are now wired through the
  reviewed KAN-232/KAN-233 boundary;
- split API/worker execution IAM permits the API to read only its database and
  selected Redis ACL/auth-wallet credentials, the worker only its database
  credential, and the one-off migration task only the migration credential;
- six explicit, no-default Secrets Manager version parameters pin the API
  database, worker database, and API Redis A/B slots. The only unpinned adoption
  state keeps every service stopped, every phase at `A_ONLY`, Redis access off,
  and fixed-slot execution-role reads closed; and
- bounded CloudWatch log groups and eight service/queue/security alarms expose
  infrastructure health through one explicitly supplied external SNS topic;
  the template creates no recipient. The dashboard is optional and off by
  default, and Container Insights is also disabled by default.

The template accepts only digest-pinned application image URIs. Image building
and publication belong to the controlled delivery work following FND-003; the
stack does not silently substitute public or mutable-tag images.
An approved ECR artifact set, ACM certificate, and DNS/access configuration are
external prerequisites, so the template is a reproducible application resource
graph rather than a claim that those organizational prerequisites appear from
nothing.

## Local validation (no AWS calls)

Install the normal repository dependencies and run the policy validator:

```powershell
npm ci
npm run infra:validate
npm run infra:test:migrations
```

For CloudFormation schema validation, install the pinned open-source local
tool and lint the reviewed templates:

```powershell
python -m pip install --requirement infra/aws/requirements-dev.txt
python infra/aws/lint-cloudformation.py infra/aws/application-baseline.yaml infra/aws/application-workload-boundaries.yaml infra/aws/application-observability.yaml infra/aws/database-migration-task.yaml infra/aws/account-guardrails.yaml infra/aws/sqs-foundation.yaml
```

These commands read repository files only. CI runs the same checks without AWS
credentials or a deployment step.

Running the invocation script with no cloud action is also local-only:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File infra/aws/invoke-application-baseline.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File infra/aws/invoke-account-guardrails.ps1
```

On hosts with PowerShell 7, use `pwsh -NoProfile -File` with the same script
path. Both entry points default to offline validation.

The script prints the blocked cloud boundary and local validation result. See
its built-in help before considering any explicitly authorized cloud mode:

```powershell
powershell.exe -NoProfile -Command "Get-Help ./infra/aws/invoke-application-baseline.ps1 -Detailed"
```

Do not copy a cloud command from this document as a deployment approval. The
script intentionally requires the operator to provide the account-specific
values and acknowledgement as explicit execution-time arguments.

KAN-229's final record and live controls gate application `Plan` and `Deploy`.
An explicitly authorized application `CloudValidate` remains syntax-only and
does not create application resources, but it is still an AWS API call and is
never run by the local default or CI. See [KAN-229](KAN-229.md) for the separate
bootstrap, notification-delivery, independent-review, and retention evidence.

## Runtime configuration and secrets

The zero-desired-count production task definitions now statically wire the
reviewed Cognito public-client contract and mainnet wallet-registration mode.
The parent accepts explicit `CognitoPoolId`, `CognitoLoginHostname`, and
`CognitoClientId` identifiers, derives the issuer/callback/logout URLs, and
passes the exact HTTPS `AUTH_PUBLIC_ORIGIN` to both API and web. It does not
create a Cognito user pool or app client.

Authentication and wallet key material comes from one externally provisioned
JSON secret identified only by `AuthWalletKeysSecretArn`. Its closed field set
is the current `AUTH_PREAUTH_SEAL_KEY` plus six canonical ring documents:
`AUTH_IDENTITY_HMAC_KEY_RING_JSON`, `AUTH_SESSION_HMAC_KEY_RING_JSON`,
`AUTH_CSRF_HMAC_KEY_RING_JSON`, `WALLET_IDENTITY_HMAC_KEY_RING_JSON`,
`WALLET_CHALLENGE_HMAC_KEY_RING_JSON`, and
`WALLET_METADATA_SEAL_KEY_RING_JSON`. Legacy single-key auth and wallet
selectors are forbidden by the production template and preflight contract;
values never enter CloudFormation parameters or outputs. The nested workload
boundary grants `GetSecretValue` and decrypt on the exact
`AuthWalletKeysSecretArn` / `AuthWalletKeysKmsKeyArn` pair only to the API
execution role. Web, worker, task roles, and the Redis operator receive no
access. The secret, customer-managed key, key/resource policies, distinct
canonical key material, custody, and rotation are external gates; static
wiring is not deployed-readability evidence.

The production runtime contract has four database authorities: the RDS
master/bootstrap identity, a one-off `crypto_migration` login, an API A/B login,
and a worker A/B login. API and worker receive only their own
`DATABASE_RUNTIME_*` values and select the matching stable capability through
`APPLICATION_WORKLOAD`; the migration task receives only
`MIGRATION_DATABASE_*`. Every production loader rejects the opposite credential
prefixes and all legacy unscoped `DATABASE_*` credentials. The bootstrap/master
credential is never an application or migration-task input.

All production PostgreSQL paths require `verify-full` plus an explicit
`NODE_EXTRA_CA_CERTS` bundle. The process parses that PEM bundle before opening
the pool and fails closed when it is absent, unreadable, or invalid. The
connection startup packet selects the reviewed capability role before the first
application query.

Only the API consumes Redis, and its current inventory is health-only `PING`.
It authenticates as an environment-bound `crypto_api_<APP_ENV>_a` or
`crypto_api_<APP_ENV>_b` ACL slot over verified TLS. The worker and migration
task reject every `REDIS_*` variable.
The legacy `REDIS_AUTH_TOKEN`, anonymous/default access, key commands, and a
worker Redis network path are not part of the replacement contract.

The local `.env.example` and Compose service use distinct, deliberate local
fixtures for the bootstrap owner, migration, API, worker, and Redis identities.
The previous PostgreSQL volume is preserved under its old name rather than
being reconciled in place. The unscoped `DATABASE_URL` fallback remains a
non-production compatibility path only.

CloudFormation state remains in the AWS CloudFormation service if an authorized
deployment eventually occurs; there is no local state file. Generated secrets
remain in Secrets Manager. The scoped infrastructure ignore rules exclude
operator parameter files, change-set payloads, outputs, and other generated
artifacts while retaining reviewed examples and source templates.

## Health and acceptance evidence

Static checks can verify resource relationships, policies, encryption intent,
private-network placement, secret injection, health-check configuration, and
the absence of literal credentials. They cannot prove that a fresh AWS
environment was created, that a specific image starts, that service dependencies
are reachable, or that actual spend is zero.

After a separately approved deployment, acceptance evidence must record:

- stack ID, source commit, guard-reported template and parameter SHA-256 values,
  account alias/ID, Region, and UTC deployment window;
- healthy ECS deployment state and load-balancer target health for web and API;
- HTTP 200 from the web `/api/health` and API `/api/v1/health` endpoints;
- HTTP 200 and `status: ok` from `/api/v1/health/dependencies` after the exact
  immutable migration chain through `0025`, proving PostgreSQL, Redis, SQS, and
  migration readiness;
- worker container health `HEALTHY`; its internal probe checks PostgreSQL,
  migration checksums, and the SQS/DLQ redrive relationship without constructing
  a Redis client;
- a controlled outbox publish smoke proving the worker can send through the
  encrypted queue path (a healthy empty poll does not prove `SendMessage`);
- confirmation that database/cache endpoints and application tasks have no
  public IP path; and
- the reviewed cost estimate plus the cleanup or retention decision.

Until that evidence exists, KAN-34 has implementation and static-validation
readiness only. Its fresh-environment and deployed-health acceptance criteria
must remain recorded as **Not Run**, not Pass.

Neither template runs a database migration as a CloudFormation side effect.
`database-migration-task.yaml` registers a hardened task definition and a
secret-scoped execution role, but contains no ECS service, desired count, or task
role. Registering that separate template and running the resulting Fargate task
are cloud actions with their own billing acknowledgement and require separate
authorization.

The offline migration-task validator reads its optional `--template` input
through a 51,200-byte, canonical single-link regular-file boundary. It compares
two stable descriptor snapshots, requires strict UTF-8 without a byte-order
mark, and derives the reviewed SHA-256 only from the accepted in-memory bytes.
Invalid inputs produce one fixed path-free error; validation never invokes AWS
or starts a migration.

CloudFormation cannot safely create or synchronize PostgreSQL-native logins.
`infra/postgres/bootstrap-principals.sql` is therefore the only reviewed role,
ownership, membership, and grant reconciliation body. It accepts identifiers,
not passwords. An authorized secret workflow must provision and successfully
authenticate the exact restricted migration/API/worker LOGIN slots first; the
RDS master then runs the bootstrap artifact while all application and legacy
sessions are drained. See [KAN-232](KAN-232.md) for its preflight,
migration-safe compatibility capability, A/B rotation, rollback, and denial
contract. The former broad single-runtime procedure is intentionally removed.

The authorized delivery sequence is: verify and retrieve the exact
content-addressed workload-boundary and observability children from existing
versioned same-account/Region S3
bucket (no guard path creates or uploads it); create the stack with all six
version parameters explicitly set to `UNPINNED`, every credential phase at
`A_ONLY`, the Redis operator disabled, and all workload desired counts at zero;
capture the six generated Secrets Manager `VersionId` values without recording
secret material; validate an `ADOPT_AND_PIN` record whose target state contains
those exact six IDs; provision the restricted PostgreSQL LOGIN slots from those
exact scoped secret versions while workloads remain stopped; then apply the
all-pinned follow-up stack update at zero desired count using exactly the six
target IDs from the validated record. That follow-up installs the pinned Redis
passwords while retaining the `A_ONLY` access boundary. Independently verify the
deployed pins and backend-installation evidence against the adoption record
before continuing. Then drain old sessions; run the exact bootstrap artifact as
the bootstrap owner; register and run the separately reviewed migration task
with only the `crypto_migration` secret; wait for exit code zero; run
`npm run db:status:prod --workspace @crypto-lending/api`; exercise positive and
negative capability probes for both API and worker; then raise desired counts.
Every future migration must preserve the exact role boundary and may not add
broad table, sequence, function, type, schema, or default grants. Evidence
records identifiers and redacted outcomes, never secret values.

The migration task's `DatabaseMigrationCredentialsSecretArn` must resolve to
the exact `crypto_migration` secret. Binding the RDS master/bootstrap
`DatabaseCredentialsSecretArn` is forbidden. Reuse the reviewed environment,
database endpoint/name, RDS CA path, digest-pinned API image, repository ARN,
and `ApplicationDataKey` ARN. Static validation cannot authenticate those
cross-stack identities, so an independent reviewer must verify the complete
parameter set before a change set is executed.

## Non-production limitations

- This baseline is mutually exclusive with `sqs-foundation.yaml` for the same
  `EnvironmentName`; both intentionally use the established queue names. Do not
  deploy both stacks or attempt an unreviewed resource import.
- Physical names make this a one-stack-per-`EnvironmentName` baseline. A second
  stack for the same environment will collide rather than create a hidden copy.
- PostgreSQL LOGIN provisioning and secret-to-role password synchronization
  remain explicit operator steps because CloudFormation cannot safely manage
  database-native credentials. Capability roles and grants are reconciled by
  the reviewed bootstrap artifact; live A/B cutover remains an authorized
  maintenance procedure.
- Static validation cannot prove that the migration-task parameters were mapped
  to the intended application-stack outputs or that runtime privilege denial is
  effective. Those checks remain mandatory deployment evidence before raising
  desired counts.
- The parent now replaces the obsolete shared Redis token, backend execution
  role, and backend security group with the content-addressed workload-boundary
  child. The operational alarm/dashboard graph is likewise isolated in its
  content-addressed child. Staging both exact versioned child objects and
  invoking the guarded nested-stack plan/deploy remain separately authorized
  actions with possible storage/request/resource cost.
- The fixed database/Redis A/B secret resources and exact version pins support
  a controlled overlap and cutover but do not regenerate or install an inactive
  slot. Repeatable rotation still requires the separately authorized
  regeneration and verifier/password installation artifact, plus a deployment
  guard that binds the reviewed transition record to current deployed state.
- The conditional Redis operator now has a production-only, exact-inactive-slot
  CLI and a no-service one-off task definition. Both remain disabled by default
  and have not been deployed or run. Workload drain, post-command session and
  reconnect denial, immediate operator disablement, managed alarm delivery, and
  sanitized live evidence remain separately authorized gates.
- PostgreSQL minor and Redis 7.1 availability, VPC endpoint availability,
  service quotas, the S3 prefix-list ID, image startup behavior, and the ACM/DNS
  relationship require target-account preflight and runtime evidence.
- The external auth/wallet JSON secret must contain exactly the reviewed
  pre-authentication key and six ring-document fields and use the exact
  supplied customer-managed KMS key. Its resource/key policies, ring contents,
  and an API task's successful field-selecting reads remain live evidence; this
  template deliberately provisions neither resource.
- The isolated balance-sync source/DLQ resources and publisher wiring are
  present, but no task role can receive or delete balance messages and no
  dedicated balance consumer service is defined. The queue therefore cannot
  activate the dormant Ethereum/Solana RPC adapters or create live-read
  authority.
- Tasks have no NAT or general internet egress. Blockchain RPCs, authentication,
  market/oracle data, and other public APIs require a separately reviewed egress
  design; this baseline intentionally cannot reach them. [KAN-231](KAN-231.md)
  preserves that state while KAN-37 and KAN-62 remain undecided and prohibits
  selecting a paid egress path without separate architecture, security, and
  cost approval.
- `ApplicationVersion` is a reviewed runtime label, not cryptographic image
  provenance. Acceptance must verify the immutable API and web image digests'
  build attestations or OCI source-revision labels against the recorded commit.
  The API digest is reused by the distinct API, outbox-worker, and migration
  task definitions.

These limitations are explicit non-production review gates, not implied
production authorization.

## Cleanup and rollback

CloudFormation rollback is enabled for an authorized deployment. Database and
cache replacement/deletion may retain snapshots; the Secrets Manager values and
customer-managed KMS keys are retained indefinitely by the current template.
Those retained artifacts remain billable, and encrypted snapshots depend on
the retained keys. Database deletion protection must be deliberately disabled
before a protected database can be removed. Log groups have bounded retention,
but their retained data can also incur charges. An operator must inventory and
approve each deletion separately rather than using an unreviewed recursive
cleanup.

Never place credentials, secret values, generated parameter files, stack
outputs, or copied CloudFormation state in Git or Jira evidence.
