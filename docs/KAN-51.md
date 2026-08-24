# KAN-51: Structured correlated logging

KAN-51 is the local SEC-003 control boundary for traceable application events
without credential, personal-data, wallet-proof, or request-content leakage.
This initial work is deliberately local-only. It does not create or query a
CloudWatch log group, start a subscription, publish an image, invoke hosted CI,
call AWS, or activate a paid logging or observability service.

## Evidence and cost boundary

The repository can prove the behavior of its serializers, correlation
propagation, redaction policy, and static CloudFormation contract without a
cloud account. It cannot prove that a log group exists, that a deployed task
writes to it, that KMS encryption is effective, that retention has taken
effect, or that an authorized operator can trace a production event. Those are
live non-production acceptance gates requiring separate authorization.

CloudWatch ingestion, storage, queries, exports, alarms, and third-party
delivery can incur charges. No such action is authorized by this ticket's local
workflow. The checked-in retention design is not a claim that cloud logging is
free.

## Structured event contract

The API, outbox worker, migration CLI, worker-health CLI, OpenAPI generator, and
KAN-245 Next.js Node.js instrumentation emit application-owned operational
output as one bounded JSON object per line. Each logger generates its own
canonical UTC timestamp and accepts a discriminated, event-specific field
allowlist rather than an arbitrary object plus a recursive scrubber. Next.js
framework-owned build/start diagnostics are outside the application event
catalog; application-owned web request and fatal failures use the same fixed
schema metadata and closed-projection rules.

Every event has these fields; domain and request events also carry an
event-specific `outcome` where the catalog permits it:

| Field           | Contract                                                          |
| --------------- | ----------------------------------------------------------------- |
| `schemaVersion` | Fixed schema version                                              |
| `timestamp`     | Logger-generated canonical ISO 8601 UTC timestamp                 |
| `level`         | Closed severity enum                                              |
| `service`       | Fixed application identity                                        |
| `workload`      | Closed executor enum                                              |
| `event`         | Closed event-name enum                                            |
| `correlationId` | Server-generated root correlation when the event has a causal hop |

An event may add only the fields declared for its exact event name:

- a server-generated `requestId`;
- a verified `initiatorActorId`, while `service` and `workload` identify the
  asynchronous executor;
- a stable route identifier, HTTP method, status, and bounded duration;
- validated job ID, kind, message, receive, and retry metadata;
- validated internal intent, quote, transaction, and ledger-event IDs after those
  domain types exist;
- bounded numeric counters; and
- a classified `errorCode` from a closed allowlist.

Free-form messages, stacks, causes, SDK response objects, request or response
objects, configuration objects, environment maps, and job payloads are not log
event fields. Unknown event names or fields fail closed before serialization;
production rejection handling must not echo the rejected key or value and must
not fail the business operation.

## Sensitive-data policy

The field allowlist is the primary control. Pattern-based detection is defense
in depth and must never be the only reason a value is considered safe.

The following values are absent, not partially masked, prefixed, hashed, or
copied into a `redacted` field. Hashing a prohibited value does not make it
safe to log:

- bearer, refresh, ID, session, CSRF, basic-auth, and container-credential
  tokens;
- passwords, database and Redis connection strings, private keys, seed
  phrases, API keys, KMS material, and TLS private-key material;
- `Authorization`, `Cookie`, `Set-Cookie`, proxy, tracing, and other raw
  headers;
- raw URL, URI, path, query-string, request-body, response-body, and SQS
  message-body or message-attribute content;
- contact email, contact phone, declared residency, IP address, user agent, and
  other profile or network-identifying data;
- wallet addresses and public keys, raw signatures, signed messages,
  challenges, nonces, WalletConnect pairing URIs and session topics, RPC URLs,
  provider payloads, and provider error objects;
- raw idempotency keys, chain transaction hashes, unrestricted external
  references, amounts, balances, and ledger postings; and
- exception messages, stacks, causes, SQL text or parameters, receipt handles,
  queue URLs, hostnames, filesystem paths, and process environment values.

The internal account UUID is the one restricted identifier explicitly allowed
as `initiatorActorId` because the ticket requires actor correlation. It must
come from the verified principal, never from a request body, query, wallet
address, or caller-supplied actor header. Stable route IDs and destination
aliases replace raw URLs. Closed error codes replace raw dependency messages.

The only application-generated hashes admitted to logs are domain-separated
diagnostic pseudonyms for internal job and transport-message identifiers. New
producers must treat those identifiers as non-secret operational IDs. The
legacy compatibility path cannot prove the provenance of historical opaque
IDs; its hashes prevent raw output but are not a claim that sensitive or
low-entropy legacy input becomes safe through SHA-256.

## Actor and correlation rules

The API generates a new request ID and root correlation ID at ingress and may
return the request ID in a response header. Caller-provided request, trace, or
actor values do not become authoritative identifiers. Authentication may bind
an account actor only after the principal resolver has verified and normalized
the internal account UUID. Failed authentication remains anonymous and must not
log token claims or credentials.

Durable jobs carry a validated correlation context outside their arbitrary
payload. The context identifies the original account or service initiator, the
root/original request when present, and any validated internal financial IDs.
A child job retains that root but does not relabel its parent's diagnostic
`jobId` as its own. A worker logs itself as the executor and the carried
principal as the initiator; it must not represent the customer as the process
that executed background work. Invalid or legacy envelopes use safe
classifications and domain-separated hashed job/message references, never raw
IDs, bodies, or attributes.

Carried correlation and initiator fields are diagnostic metadata only. A
worker must never use them for authentication, authorization, ownership, or a
financial decision.

The same root correlation must reach the database audit record, outbox record,
published job, worker handler, and eventual ledger event. Retries and
redeliveries retain that root correlation and job ID. A distinct retry
execution identifier is a downstream requirement rather than evidence claimed
by this branch. Concurrent requests and jobs must not leak actor or correlation
context into one another.

The KAN-43 journal path now carries its validated ledger transaction ID while
the repository atomically creates `ledger.journal-committed` and adds the
committed journal ID as `ledgerEventId`. That reviewed job kind is in the closed
logging catalog, so dispatch and worker records retain the request root, verified
actor, transaction, and journal identifiers without opening the logger to
arbitrary job names.

## Log-injection and availability rules

- Identifiers are bounded and matched against explicit ASCII grammars.
- The logger constructs base fields itself, so caller data cannot override
  timestamp, level, service, event, or outcome through object spread.
- Each accepted record emits at most one physical JSON line. An oversized
  record may require one bounded second serialization of its application-owned
  core fields, but carriage returns, line feeds, terminal escapes, NUL, and
  Unicode line separators cannot create a second emitted event.
- Arbitrary objects, prototypes, getters, `toJSON`, circular structures, and
  unsupported scalar types never reach the serializer.
- Each event has a fixed 4,096-byte ceiling. An oversized event falls back to
  its bounded core record, while an invalid catalog event is ignored without
  serializing the rejected data.
- Normal request logging is limited to one completion event plus meaningful
  domain or security transitions. Poll-idle and successful readiness loops do
  not create unbounded volume. Each API process admits at most 60 anonymous
  rejected or aborted request records per 60-second window and emits one
  bounded suppression record when that budget is exhausted. Verified-actor
  failures are not sampled. An attacker can consume the shared anonymous
  budget, so edge-level controls and deployed alert evidence remain live gates.
- Logging and serialization failures must not change a financial or customer
  operation's result.

These rules also keep the hot path bounded: no request/body cloning, recursive
scrubbing, or serialization of third-party error graphs is required.

## Outbox error-code migration ordering

Migration `0006` replaces historical free-form `job_outbox.last_error` values
with `OUTBOX_TRANSPORT_FAILED` and then enforces the closed
`OUTBOX_TRANSPORT_FAILED` / `OUTBOX_TRANSPORT_TIMEOUT` allowlist. This is a
drain-first compatibility migration, not an ordinary rolling migration: make
the new worker image available, scale old outbox workers to zero, wait for
in-flight work and leases to drain, run the migration with the reviewed
migration identity, and only then deploy/start the new workers. Old API tasks
may remain because they do not write `last_error`. This ordering prevents an
in-flight old worker from failing its update when the new constraint takes
effect; an old worker must not be restarted after `0006` commits.

The migration is transactional and installs the constraint as `NOT VALID`
before sanitizing and validating historical rows. Its rollback drops only the
constraint; it deliberately cannot reconstruct prohibited historical error
text after sanitization.

The migration CLI now emits structured JSON records instead of the prior
human-readable `Applied migrations`, `Rolled back migrations`, and status
lines. No repository script parses that legacy text, but external/operator
scripts must migrate to the versioned JSON event contract before adopting this
build.

Other exported compatibility changes require coordinated consumers:
`JobEnvelope.correlation` is required for new TypeScript producers (the wire
parser still normalizes correlation-less legacy envelopes), failure variants
of `JobProcessingResult` expose `errorCode` instead of `error`, and one SQS
attribute is now reserved for correlation so the custom-attribute maximum is
six rather than seven. No in-repository caller relies on the superseded forms;
external or independently deployed callers must be inventoried before rollout.
Producer payload generics are not yet constrained to a `JsonValue` type, but
runtime projection now rejects `Date`, class instances, custom `toJSON`, and
accessor-backed values instead of allowing JSON conversion. Independently
deployed producers must validate that boundary as part of the same rollout
preflight; cycles, sparse arrays, non-finite values, and unsupported scalars
were already rejected by the prior serializer.

## Retention contract

The application baseline already declares separate API, web, and outbox-worker
CloudWatch log groups encrypted with `ApplicationLogsKey`. The local validator
now freezes the exact retention semantics:

- `LogRetentionDays` is `Type: Number`;
- its default is 14 days;
- its complete allowed set is `[1, 3, 5, 7, 14, 30, 60, 90]`; and
- `ApiLogGroup`, `WebLogGroup`, and `WorkerLogGroup` each bind
  `RetentionInDays` exactly to `!Ref LogRetentionDays`.

Mutation tests reject a type change, default change, expanded allowed set, and
an independent literal-retention escape by each log group. Existing static
checks also require every group to use the dedicated application-logs KMS key.

The 14-day log default is an operational diagnostic boundary, not financial
record retention. Durable account audit and future immutable ledger records
remain their authoritative stores; increasing CloudWatch retention must not be
used as a substitute.

## Local verification

The focused retention checks are:

```powershell
node infra/aws/validate-application-baseline.mjs
node --test infra/aws/validate-application-baseline.test.mjs
npm run format:check
git diff --check
```

The local application checks are:

```powershell
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm test --workspace @crypto-lending/api
npm run test:e2e --workspace @crypto-lending/api
npm run test:integration --workspace @crypto-lending/api
```

Application logging changes additionally require the API unit and end-to-end
tests. Current captured-output cases cover HTTP headers, queries and bodies,
logger error/accessor/prototype failures, correlation isolation, and bounded
anonymous rejection volume. Job tests separately prove that raw transport and
handler errors are absent from durable state and processing results, while
correlation survives outbox/SQS serialization and concurrent handlers.
Captured worker-output cases also prove that payload, attribute, transport,
and handler canaries are absent from the emitted JSON. KAN-245 extends this
corpus through unhandled API/provider failures, mapped wallet/domain failures,
outbox transport failures, SQS handler retries/dead-letter handling, and
Next.js request/fatal boundaries. Source-policy gates reject direct
application-owned console/stdout/stderr and Nest logger sinks across API and
web runtime sources and prevent an unreviewed Edge-runtime escape.

The KAN-51 trace case in `ledger-idempotency.integration-spec.ts` adds the
literal local evidence that was previously blocked on KAN-43. It sends a real
Nest HTTP request through `AccountAuthGuard`, using a test-only exact-token
principal resolver; the controller exists only in the test module and is not a
production ledger endpoint. The case posts through `LedgerService` and
`PostgresLedgerRepository`, verifies the immutable journal and atomic outbox row
in an isolated UUID-named local database, publishes the durable envelope through
an isolated LocalStack SQS queue, and lets `SqsJobWorker` handle it. The API log,
database journal, outbox envelope, dispatch log, handler context, and worker log
must all contain one server-generated root; the latter hops also contain the
verified actor plus actual ledger transaction and journal IDs. Private-key,
bearer-token, full-credential, raw-signature, idempotency-key, and ledger
capability canaries must be absent from every captured JSON line.

The focused literal trace command is loopback-only and requires the repository's
local principal fixture plus LocalStack:

```powershell
$env:TEST_DATABASE_URL = '<loopback local-principal fixture URL>'
$env:RUN_INFRASTRUCTURE_INTEGRATION = '1'
$env:SQS_ENDPOINT = 'http://127.0.0.1:4566'
npx jest --config apps/api/test/infrastructure/jest.config.json --runInBand --runTestsByPath apps/api/test/infrastructure/ledger-idempotency.integration-spec.ts -t "traces one API request"
```

Before mutation, the test rejects a non-loopback database or SQS endpoint and
requires the Compose-installed database marker. It creates and deletes only its
exact generated schema, database, and SQS queues. It does not call AWS.

All focused retention validation is local filesystem and child-process work.
It reports zero AWS calls and performs no Docker, network, registry, provider,
or hosted-CI action.

## Remaining acceptance gates

KAN-51 must not be represented as fully accepted from this local retention
evidence. The following remain explicit gates:

- deployed/runtime-version validation that framework-owned diagnostics and any
  future executable or Edge route remain outside application-owned sinks or
  receive an equivalent reviewed structured boundary;
- intent and quote correlation using their actual future domain types rather
  than synthetic stand-ins; transaction and `ledgerEventId` now use KAN-43's
  real ledger types in the local trace;
- a rollout preflight for legacy job identifiers and the custom-attribute
  reservation change (`MAX_CUSTOM_JOB_ATTRIBUTES` is now six), including
  pending rows with seven attributes, a custom `correlationId` collision, or
  insufficient size headroom for normalized body/attribute correlation, plus
  payloads deeper than 64 levels or larger than 100,000 JSON nodes; and
  evidence that no old producer emits those superseded shapes;
- a decision on enriching normalized `legacy:*` jobs with newly resolved
  actor/domain identifiers; the current fail-closed context deliberately
  forbids that future chaining path;
- effective security/privacy/operations review of actor-ID classification, log
  access, and incident-query procedures. KAN-248 now supplies a fingerprinted
  local draft and runbook, but it remains `NOT_EFFECTIVE` because KAN-220 and
  every required independent decision are pending; and
- an explicitly authorized non-production exercise proving deployed task
  delivery, KMS encryption, effective 14-day retention, access denial, search,
  and deletion behavior without exposing a prohibited value.

KAN-41, KAN-42, and KAN-43 now supply the real local ledger, lifecycle, and
transactional-outbox hop used by the guarded trace test. That evidence does not
substitute for the separately authorized deployed delivery, access-control,
retention, and incident-query gates above. No live retention proof was attempted
in this local batch.
