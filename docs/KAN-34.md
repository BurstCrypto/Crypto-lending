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
modeled subtotals are `$52.69/month` parked with tasks and interface endpoints
off, `$125.69/month` for the template-default endpoint configuration with tasks
stopped, and `$153.67/month` for one continuously running web, API, and worker
task under the low-volume assumptions in KAN-229. The parked correction includes
`$7.30/month` for two public IPv4 addresses used by the two-AZ ALB. These figures
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
- RDS and Redis credentials are generated in Secrets Manager and injected into
  tasks as individual secret fields—never template parameters or outputs;
- separate execution and task roles scope image/log/secret access and runtime
  queue permissions; and
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
```

For CloudFormation schema validation, install the pinned open-source local
tool and lint both templates:

```powershell
python -m pip install --requirement infra/aws/requirements-dev.txt
python infra/aws/lint-cloudformation.py infra/aws/application-baseline.yaml infra/aws/account-guardrails.yaml infra/aws/sqs-foundation.yaml
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

Local development continues to use `DATABASE_URL` and `REDIS_URL`. Managed ECS
tasks instead receive non-secret host/port/name values and separately injected
`DATABASE_USERNAME`, `DATABASE_PASSWORD`, and `REDIS_AUTH_TOKEN` values. The API
rejects mixed URL/component configuration, constructs escaped connection URLs
in memory, requires `DATABASE_SSL_MODE=verify-full` plus an explicit
`NODE_EXTRA_CA_CERTS` bundle path, and uses `rediss://` for the managed cache
path. The process reads and parses the PEM bundle before opening the pool and
fails closed when it is absent, unreadable, or invalid. The digest-pinned image
is responsible for containing the reviewed RDS CA bundle at that path.

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

The template does not run database migrations as a CloudFormation side effect.
After the zero-count CREATE and before increasing API or worker desired count,
an authorized delivery workflow must use the `ApiTaskDefinitionArn`,
`EcsClusterArn`, `PrivateSubnetIds`, and `BackendTaskSecurityGroupId` outputs to
run one task with the exact container command override
`["node","dist/infrastructure/database/migration.cli.js","up"]`. It must wait
for exit code zero and record the task ARN and image digest. This argv assumes
the reviewed API image contains the compiled file at that path; that image
contract remains unproven until an artifact inspection and runtime smoke pass.

## Non-production limitations

- This baseline is mutually exclusive with `sqs-foundation.yaml` for the same
  `EnvironmentName`; both intentionally use the established queue names. Do not
  deploy both stacks or attempt an unreviewed resource import.
- Physical names make this a one-stack-per-`EnvironmentName` baseline. A second
  stack for the same environment will collide rather than create a hidden copy.
- The current API and worker receive the RDS administrative credential because
  the repository does not yet contain a separately reviewed database-principal
  bootstrap. Before production, split migration/admin and runtime users, grant
  only schema-specific permissions, and test revocation and rotation. Until
  then, this environment is limited to synthetic non-production data.
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
