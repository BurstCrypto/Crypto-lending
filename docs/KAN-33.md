# KAN-33: persistence and job-state infrastructure

This implementation supplies a shared PostgreSQL transaction layer, versioned
migrations, Redis access, SQS job processing with bounded retries and dead-letter
redrive, and dependency health checks for the NestJS API.

## Application integration

Import `InfrastructureModule` once in `AppModule`:

```ts
import { InfrastructureModule } from './infrastructure/infrastructure.module';

@Module({
  imports: [InfrastructureModule],
})
export class AppModule {}
```

The module exposes:

- `PostgresService` for transaction-aware queries and `withTransaction`;
- `MigrationRunner` for programmatic migration control;
- `RedisService` with an environment/version key namespace;
- `JOB_PUBLISHER` for transactionally enqueueing immutable job envelopes;
- `OutboxWorker` as the explicit, separately deployed SQS dispatch process;
- `InfrastructureHealthService` and `GET /api/v1/health/dependencies` when the
  API's global `/api/v1` prefix is enabled. Dependency
  readiness returns HTTP 503 when degraded and never returns raw connection
  errors. It also requires every migration known to the running API to be
  applied with the expected checksum; the separate API liveness endpoint
  remains independent.

Required runtime packages are `pg`, `ioredis`, and
`@aws-sdk/client-sqs`. Migration integration tests also need `@types/pg`, and
the migration scripts use `tsx`.

## Environment

No production connection has an implicit fallback. Runtime and migration
credentials use different variable namespaces so an API/worker task cannot be
started with migration/admin credentials by accident. The local example uses
one Docker-only account for compatibility; production must use distinct roles.
Set these variables before starting the API or migration CLI:

```dotenv
DATABASE_RUNTIME_URL=postgresql://crypto_lending:local_only_password@localhost:5432/crypto_lending
DATABASE_RUNTIME_SSL_MODE=disable
DATABASE_LOCK_TIMEOUT_MS=5000
DATABASE_POOL_MAX=10
DATABASE_STATEMENT_TIMEOUT_MS=15000

MIGRATION_DATABASE_URL=postgresql://crypto_lending:local_only_password@localhost:5432/crypto_lending
MIGRATION_DATABASE_SSL_MODE=disable
MIGRATION_DATABASE_LOCK_TIMEOUT_MS=10000
MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS=3600000

REDIS_URL=redis://localhost:6379
REDIS_KEY_PREFIX=crypto-lending:local:v1:
REDIS_CONNECT_TIMEOUT_MS=5000
REDIS_COMMAND_TIMEOUT_MS=2000

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_ENDPOINT=http://localhost:4566
SQS_QUEUE_URL=http://localhost:4566/000000000000/crypto-lending-jobs
SQS_DEAD_LETTER_QUEUE_URL=http://localhost:4566/000000000000/crypto-lending-jobs-dlq
SQS_REQUEST_TIMEOUT_MS=15000
SQS_SDK_MAX_ATTEMPTS=3
SQS_MAX_RECEIVE_COUNT=3
SQS_VISIBILITY_TIMEOUT_SECONDS=30
SQS_RETRY_BASE_DELAY_SECONDS=1
SQS_RETRY_MAX_DELAY_SECONDS=60

OUTBOX_BATCH_SIZE=25
OUTBOX_CLEANUP_BATCH_SIZE=100
OUTBOX_CLEANUP_INTERVAL_MS=60000
OUTBOX_CONCURRENCY=5
OUTBOX_FAILED_RETENTION_MS=2592000000
OUTBOX_LEASE_MS=30000
OUTBOX_MAX_ATTEMPTS=5
OUTBOX_PUBLISH_TIMEOUT_MS=10000
OUTBOX_PUBLISHED_RETENTION_MS=604800000
OUTBOX_RETRY_BASE_DELAY_MS=1000
OUTBOX_RETRY_MAX_DELAY_MS=60000
OUTBOX_POLL_INTERVAL_MS=1000
```

Production runtime tasks require `DATABASE_RUNTIME_*`; production migration
tasks require `MIGRATION_DATABASE_*`. Each scope rejects the other scope and the
legacy unscoped `DATABASE_*` credentials. Both production paths require
`verify-full` plus the reviewed `NODE_EXTRA_CA_CERTS` bundle. Unscoped
`DATABASE_URL` remains only as a non-production compatibility fallback. The
production loaders also enforce `crypto_runtime` for runtime and `crypto_admin`
for migrations to catch a secret wired into the wrong namespace.
Production direct `REDIS_URL` values must use `rediss://` and include a non-empty
password; the managed component path continues to require `REDIS_AUTH_TOKEN`.

Concurrent retention-index migrations use a one-hour statement timeout rather
than the API's 15-second request-query limit, while a 10-second lock timeout
keeps lock acquisition bounded. Operators may raise the DDL window up to 12
hours for a measured table size. Non-transactional migrations are replay-safe,
include their transaction policy in the checksum, and verify the resulting
schema object; readiness fails if an applied index is missing or invalid.

## Local services and verification

Start the isolated development dependencies:

```powershell
docker compose up --detach --build --wait
docker compose ps
```

After exporting the variables above, run:

```powershell
npm run db:migrate --workspace @crypto-lending/api
npm run db:status --workspace @crypto-lending/api
$env:TEST_DATABASE_URL=$env:MIGRATION_DATABASE_URL
$env:RUN_INFRASTRUCTURE_INTEGRATION="1"
npm run test:integration --workspace @crypto-lending/api
npm run db:rollback --workspace @crypto-lending/api
```

Run `npm run worker:outbox` as a process separate from the HTTP API. Production
images use `npm run worker:outbox:prod --workspace @crypto-lending/api`, which
runs the compiled worker and shuts down cleanly on `SIGINT` or `SIGTERM`.

The PostgreSQL integration test creates a uniquely named schema, performs the
up/down cycle, and removes only that schema. It is skipped when
`TEST_DATABASE_URL` is absent. The combined Postgres/Redis/SQS acceptance test is
skipped unless `RUN_INFRASTRUCTURE_INTEGRATION=1`. Deterministic tests still exercise the migration
state machine, transaction commit/rollback/retry paths, dependency health, and
a sample job's full failed-delivery path into the DLQ.

## Transaction usage

`PostgresService.query` automatically uses the active async transaction. Domain
modules inject `JOB_PUBLISHER` and enqueue the job in the same transaction as
their business write:

```ts
await postgres.withTransaction(
  async () => {
    await accountRepository.applyChange();
    await jobPublisher.enqueue({
      id: jobId,
      kind: 'account.updated',
      payload,
    });
  },
  { isolationLevel: 'serializable', maxRetries: 2 },
);
```

Nested `withTransaction` calls join the outer transaction. Serialization
failures (`40001`) and deadlocks (`40P01`) are retried only when the caller opts
in with `maxRetries`; the callback must therefore be safe to rerun.

The outbox worker claims rows with `FOR UPDATE SKIP LOCKED` and expiring leases,
then publishes them with bounded concurrency. Delivery is intentionally
at-least-once: a crash after SQS accepts a message but before PostgreSQL records
success can publish the same immutable envelope again. Consumers must persist
and deduplicate the envelope `id` as part of their own transaction.

The SQS transport packs at most 10 messages and 1 MiB into each batch request,
then records success or failure independently for every entry. Terminal outbox
rows are deleted in small lock-skipping batches after the configured retention
window. Separate partial indexes keep the normal no-expired-rows cleanup pass
range-bounded as the table grows.

## Queue failure behavior

`SqsJobWorker.processOne` deletes a message only after its handler succeeds. A
long-running handler renews visibility before the current lease midpoint and
stops at SQS's maximum receipt lifetime. A failed or late heartbeat leaves the
message undeleted so another consumer can safely retry it. Handler failure
applies bounded exponential visibility delay. At `maxReceiveCount`, the message
is released and the SQS redrive policy moves it to the configured DLQ.
The application health check verifies both queues, the target DLQ ARN, and the
configured receive count rather than only checking that SQS is reachable.

The production-ready queue definition is in `infra/aws/sqs-foundation.yaml`.
It enables SQS-managed KMS encryption, long DLQ retention, and a
`RedriveAllowPolicy` restricted to the predictable source queue ARN. The
LocalStack initializer mirrors the same retry topology.

Production images run the compiled migration entrypoint and do not require
TypeScript tooling or source files. After `npm run build --workspace
@crypto-lending/api`, use `db:migrate:prod`, `db:status:prod`, or
`db:rollback:prod` from the API workspace. The migration entrypoint loads only
its PostgreSQL configuration; Redis and SQS settings are neither required nor
accepted as substitutes for an explicit migration connection. Those `:prod`
commands force `NODE_ENV=production` and reject a conflicting preconfigured
mode. Local compiled-image acceptance uses the separate `:compiled` commands.

## Migration rules

- Applied migrations are checksummed; modifying one causes migration up/down
  commands to fail.
- An advisory lock prevents concurrent migration runners.
- Migrations are transactional by default. Explicit concurrent-index
  migrations run outside a transaction, use replay-safe statements, and verify
  the resulting catalog state before their metadata is recorded.
- Production rollback should be a deliberate operator action. The automated
  rollback acceptance test targets only a dedicated test schema.
