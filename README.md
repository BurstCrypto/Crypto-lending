# Crypto Lending

This repository contains the production-shaped application foundation for the
Crypto Lending platform. It is an npm workspace with a Next.js web application,
a versioned NestJS API, and shared PostgreSQL, Redis, and SQS infrastructure.

## Prerequisites

- Node.js 22.13 or newer on the Node 22 line, or Node.js 24+
- npm 11.6.4
- Docker with Docker Compose

## Start locally

Install dependencies and create local application configuration:

```powershell
npm install
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/api/.env.example apps/api/.env
docker compose up --detach --build --wait
npm run db:migrate
```

Run the applications in separate terminals:

```powershell
npm run dev:web
npm run dev:api
npm run worker:outbox
```

The default local endpoints are:

- Web: `http://localhost:3000`
- API liveness: `http://localhost:3001/api/v1/health`
- Dependency readiness: `http://localhost:3001/api/v1/health/dependencies`
- API version: `http://localhost:3001/api/v1/version`
- Swagger UI: `http://localhost:3001/api/v1/docs`
- OpenAPI JSON: `http://localhost:3001/api/v1/docs-json`

The liveness route reports whether the API process can serve requests. The
readiness route verifies PostgreSQL connectivity and migration state, Redis,
and both SQS queues; it returns 503 when a dependency is unavailable or the
database schema is behind.

## Verification

The standard local quality gates are:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e --workspace @crypto-lending/api
npm run build
npm run openapi:generate
```

To exercise real migrations, Redis health, SQS health, retry behavior, and DLQ
redrive against the local Docker services:

```powershell
$env:TEST_DATABASE_URL="postgresql://crypto_lending:local_only_password@127.0.0.1:5432/crypto_lending"
$env:RUN_INFRASTRUCTURE_INTEGRATION="1"
npm run test:integration
```

The live test refuses non-loopback service URLs, creates isolated queues and a
unique PostgreSQL schema, and removes only those test resources. See
[`docs/KAN-33.md`](docs/KAN-33.md) for transaction, migration, and queue usage.

## Architecture boundaries

- `apps/web` owns the browser-facing Next.js application.
- `apps/api/src/system` owns process liveness, version, and API contract routes.
- `apps/api/src/infrastructure/database` owns pooled queries, transaction
  propagation, and checksum-protected migrations.
- `apps/api/src/infrastructure/redis` owns shared cache and job-state access.
- `apps/api/src/infrastructure/outbox` owns durable job envelopes and
  transactional publication; `infrastructure/sqs` owns transport retries and
  SQS-managed dead-letter redrive.
- `infra` contains local dependency initialization and the deployable SQS queue
  topology.

These boundaries are intended to be extended by later domain modules. They do
not embed lending business rules into infrastructure clients, which keeps future
account, collateral, ledger, and loan work incremental rather than requiring a
foundation rewrite.

## Jira helper scripts

Copy `.jira.env.example` to the ignored `.jira.env` file and supply an Atlassian
API token. The Jira scripts read that file by default; set `JIRA_ENV_PATH` or use
their `-EnvironmentPath` parameter to keep credentials elsewhere. Never commit
the populated credential file.
