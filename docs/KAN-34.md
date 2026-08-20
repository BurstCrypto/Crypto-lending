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

`infra/aws/application-baseline.yaml` is a self-contained environment stack:

- an internet-facing HTTPS load balancer terminates TLS in public subnets;
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
- the job queue and DLQ retain the established bounded-redrive topology;
- customer-managed KMS keys protect durable data, queues, secrets, and logs;
- the existing RDS master secret is reserved for migrations, while a distinct
  runtime secret supplies the API and worker's non-administrative PostgreSQL
  password; Redis credentials remain separate;
- API/worker execution IAM can read the runtime and Redis secrets but not the
  migration/admin secret. The standalone migration task can read only the
  migration/admin secret; and
- bounded CloudWatch log groups and service/queue alarms expose infrastructure
  health without adding an alert destination; the dashboard is optional and
  off by default, and Container Insights is also disabled by default.

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
python infra/aws/lint-cloudformation.py infra/aws/application-baseline.yaml infra/aws/database-migration-task.yaml infra/aws/account-guardrails.yaml infra/aws/sqs-foundation.yaml
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

Managed API and worker tasks receive only `DATABASE_RUNTIME_*`; the one-off
migration task receives only `MIGRATION_DATABASE_*`. Each production loader
rejects the opposite credential scope and all legacy unscoped `DATABASE_*`
credentials. The migration CLI loads PostgreSQL configuration directly and no
longer requires Redis or SQS settings. Both production paths construct escaped
connection URLs in memory and require `verify-full` plus an explicit
`NODE_EXTRA_CA_CERTS` bundle. The process parses that PEM bundle before opening
the pool and fails closed when it is absent, unreadable, or invalid. Production
also enforces the reviewed `crypto_runtime` and `crypto_admin` role names, so a
credential cannot cross the boundary merely by being placed in the other
scope's variable. Production Redis configuration likewise requires client
authentication: managed components require `REDIS_AUTH_TOKEN`, and a direct
`REDIS_URL` must be `rediss://` with a non-empty password.

The local `.env.example` uses both scoped URL names. Both URLs deliberately point
to the same Docker-only account so existing local volumes remain compatible;
the unscoped `DATABASE_URL` fallback is accepted only outside production. This
local convenience is not a production privilege model.

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
- HTTP 200 and `status: ok` from `/api/v1/health/dependencies` after migrations,
  proving PostgreSQL, Redis, SQS, and migration readiness;
- worker container health `HEALTHY`; its internal probe checks PostgreSQL,
  migration checksums, Redis, and the SQS/DLQ redrive relationship;
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

The application stack deliberately cannot create a PostgreSQL-native login.
After an authorized zero-count CREATE, an operator must retrieve the generated
`DatabaseRuntimeSecret`, connect using the existing `DatabaseCredentialsSecret`
master/migration identity, and create or update the least-privilege runtime role.
The following reviewed `psql` body uses `\password` so the cleartext secret is
not placed in SQL text or shell history; values still must come from the approved
stack and must never be copied into Git, logs, or evidence:

```sql
\set ON_ERROR_STOP on
\set migration_user crypto_admin
\set runtime_user crypto_runtime
\prompt 'Database name: ' database_name

SELECT format('CREATE ROLE %I', :'runtime_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_user') \gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'runtime_user'
) \gexec
\password crypto_runtime
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'runtime_user') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_user') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'runtime_user') \gexec
SELECT format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', :'runtime_user') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'migration_user', :'runtime_user') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', :'migration_user', :'runtime_user') \gexec
SELECT format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.schema_migrations FROM %I', :'runtime_user')
WHERE to_regclass('public.schema_migrations') IS NOT NULL \gexec
```

The authorized delivery sequence is: bootstrap/grant the runtime role; register
the separately reviewed migration task using the baseline's migration secret;
run it in the baseline cluster/private subnets/backend security group; wait for
exit code zero; rerun the grant/revoke reconciliation so `schema_migrations`
remains read-only; verify the runtime role cannot create/alter/drop schema
objects or mutate migration history but can read `schema_migrations` and perform
required outbox DML; then increase API/worker desired counts. Record task ARN and
image digest, never secret values.

For that separately authorized registration, map
`DatabaseCredentialsSecretArn` to
`DatabaseMigrationCredentialsSecretArn`; reuse the exact environment, database
endpoint/name, RDS CA path, digest-pinned API image, repository ARN, and
`ApplicationDataKey` ARN from the reviewed application stack. The migration
task intentionally reuses the existing outbox-worker log group. Static
validation cannot resolve these cross-stack values, so an independent reviewer
must verify the complete parameter set before its change set is executed.

## Non-production limitations

- This baseline is mutually exclusive with `sqs-foundation.yaml` for the same
  `EnvironmentName`; both intentionally use the established queue names. Do not
  deploy both stacks or attempt an unreviewed resource import.
- Physical names make this a one-stack-per-`EnvironmentName` baseline. A second
  stack for the same environment will collide rather than create a hidden copy.
- PostgreSQL role creation/grants and secret-to-role password synchronization
  remain explicit operator steps because CloudFormation cannot safely manage
  database-native principals. Rotation must update the runtime role and secret
  in one reviewed maintenance window; automated rotation is not implemented.
- Static validation cannot prove that the migration-task parameters were mapped
  to the intended application-stack outputs or that runtime privilege denial is
  effective. Those checks remain mandatory deployment evidence before raising
  desired counts.
- API and worker share one Redis authentication token. Before production,
  evaluate service-specific ElastiCache ACL users and automated rotation.
- PostgreSQL minor and Redis 7.1 availability, VPC endpoint availability,
  service quotas, the S3 prefix-list ID, image startup behavior, and the ACM/DNS
  relationship require target-account preflight and runtime evidence.
- Tasks have no NAT or general internet egress. Blockchain RPCs, authentication,
  market/oracle data, and other public APIs require a separately reviewed egress
  design; this baseline intentionally cannot reach them. [KAN-231](KAN-231.md)
  preserves that state while KAN-37 and KAN-62 remain undecided and prohibits
  selecting a paid egress path without separate architecture, security, and
  cost approval.
- `ApplicationVersion` is a reviewed runtime label, not cryptographic image
  provenance. Acceptance must verify all three image digests' build attestations
  or OCI source-revision labels against the recorded commit.

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
