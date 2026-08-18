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

No production connection has an implicit fallback. Set these variables before
starting the API:

```dotenv
DATABASE_URL=postgresql://crypto_lending:local_only_password@localhost:5432/crypto_lending
DATABASE_SSL_MODE=disable
DATABASE_POOL_MAX=10
DATABASE_STATEMENT_TIMEOUT_MS=15000

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
SQS_SDK_MAX_ATTEMPTS=3
SQS_MAX_RECEIVE_COUNT=3
SQS_VISIBILITY_TIMEOUT_SECONDS=30
SQS_RETRY_BASE_DELAY_SECONDS=1
SQS_RETRY_MAX_DELAY_SECONDS=60

OUTBOX_BATCH_SIZE=25
OUTBOX_CONCURRENCY=5
OUTBOX_LEASE_MS=30000
OUTBOX_MAX_ATTEMPTS=5
OUTBOX_RETRY_BASE_DELAY_MS=1000
OUTBOX_RETRY_MAX_DELAY_MS=60000
OUTBOX_POLL_INTERVAL_MS=1000
```

Use `DATABASE_SSL_MODE=verify-full` in environments where the database CA is
trusted. `require` encrypts the connection without CA verification and should
only be used as a deliberate compatibility step.

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
$env:TEST_DATABASE_URL=$env:DATABASE_URL
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

## Queue failure behavior

`SqsJobWorker.processOne` deletes a message only after its handler succeeds. A
failure applies bounded exponential visibility delay. At `maxReceiveCount`, the
message is released and the SQS redrive policy moves it to the configured DLQ.
The application health check verifies both queues, the target DLQ ARN, and the
configured receive count rather than only checking that SQS is reachable.

The production-ready queue definition is in `infra/aws/sqs-foundation.yaml`.
It enables SQS-managed KMS encryption, long DLQ retention, and a
`RedriveAllowPolicy` restricted to the predictable source queue ARN. The
LocalStack initializer mirrors the same retry topology.

Production images run the compiled migration entrypoint and do not require
TypeScript tooling or source files. After `npm run build --workspace
@crypto-lending/api`, use `db:migrate:prod`, `db:status:prod`, or
`db:rollback:prod` from the API workspace.

## Migration rules

- Applied migrations are checksummed; modifying one causes migration up/down
  commands to fail.
- An advisory lock prevents concurrent migration runners.
- Each migration up/down operation has its own database transaction.
- Production rollback should be a deliberate operator action. The automated
  rollback acceptance test targets only a dedicated test schema.
