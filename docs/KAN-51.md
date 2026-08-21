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

Application-owned operational output must be one bounded JSON object per line.
The logger generates its own canonical UTC timestamp and accepts a
discriminated, event-specific field allowlist rather than an arbitrary object
plus a recursive scrubber.

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
copied into a `redacted` field:

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

## Actor and correlation rules

The API generates a new request ID and root correlation ID at ingress and may
return the request ID in a response header. Caller-provided request, trace, or
actor values do not become authoritative identifiers. Authentication may bind
an account actor only after the principal resolver has verified and normalized
the internal account UUID. Failed authentication remains anonymous and must not
log token claims or credentials.

Durable jobs carry a validated correlation context outside their arbitrary
payload. The context identifies the original account or service initiator, the
causing request or job, and any validated internal financial IDs. A worker logs
itself as the executor and the carried principal as the initiator; it must not
represent the customer as the process that executed background work. Invalid
or legacy envelopes are reported with a safe classification and transport
message ID only, never their body or attributes.

Carried correlation and initiator fields are diagnostic metadata only. A
worker must never use them for authentication, authorization, ownership, or a
financial decision.

The same root correlation must reach the database audit record, outbox record,
published job, worker handler, and eventual ledger event. Retries and
redeliveries retain that root correlation and job ID. A distinct retry
execution identifier is a downstream requirement rather than evidence claimed
by this branch. Concurrent requests and jobs must not leak actor or correlation
context into one another.

## Log-injection and availability rules

- Identifiers are bounded and matched against explicit ASCII grammars.
- The logger constructs base fields itself, so caller data cannot override
  timestamp, level, service, event, or outcome through object spread.
- Serialization occurs exactly once and appends exactly one physical newline;
  carriage returns, line feeds, terminal escapes, NUL, and Unicode line
  separators cannot create a second event.
- Arbitrary objects, prototypes, getters, `toJSON`, circular structures, and
  unsupported scalar types never reach the serializer.
- Each event has a fixed 4,096-byte ceiling. An oversized event falls back to
  its bounded core record, while an invalid catalog event is ignored without
  serializing the rejected data.
- Normal request logging is limited to one completion event plus meaningful
  domain or security transitions. Poll-idle and successful readiness loops do
  not create unbounded volume. Security failures must be rate-aware so an
  unauthenticated caller cannot create an uncontrolled ingestion-cost stream.
- Logging and serialization failures must not change a financial or customer
  operation's result.

These rules also keep the hot path bounded: no request/body cloning, recursive
scrubbing, or serialization of third-party error graphs is required.

## Outbox error-code migration ordering

Migration `0006` replaces historical free-form `job_outbox.last_error` values
with `OUTBOX_TRANSPORT_FAILED` and then enforces the closed
`OUTBOX_TRANSPORT_FAILED` / `OUTBOX_TRANSPORT_TIMEOUT` allowlist. Roll it out
code-first: place the new worker build everywhere, stop and drain every old
outbox worker that can still write raw dependency text, run the migration with
the reviewed migration identity, and only then resume the new workers. This
ordering prevents an in-flight old worker from failing its update when the new
constraint takes effect.

The migration is transactional and installs the constraint as `NOT VALID`
before sanitizing and validating historical rows. Its rollback drops only the
constraint; it deliberately cannot reconstruct prohibited historical error
text after sanitization.

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
tests. Current cases inject run-time canaries through headers, query strings,
bodies, errors, nested causes, transport failures, job payloads, and job
attributes. Captured output remains parseable single-line JSON and contains
none of those canaries. Parallel request/job tests prove context isolation. A
repository-wide source-policy gate and the broader wallet/provider canary
corpus remain required before the ticket can be accepted.

All focused retention validation is local filesystem and child-process work.
It reports zero AWS calls and performs no Docker, network, registry, provider,
or hosted-CI action.

## Remaining acceptance gates

KAN-51 must not be represented as fully accepted from this local retention
evidence. The following remain explicit gates:

- complete application-owned structured logging and adversarial leak evidence
  for every API and worker error path;
- one real request traced through the API, committed outbox job, worker, and
  immutable ledger event with a single root correlation;
- intent, quote, transaction, and journal correlation using their actual
  domain types rather than synthetic stand-ins;
- security review of actor-ID classification, log access, and incident-query
  procedures; and
- an explicitly authorized non-production exercise proving deployed task
  delivery, KMS encryption, effective 14-day retention, access denial, search,
  and deletion behavior without exposing a prohibited value.

The true ledger hop and its trace test are blocked on KAN-41, KAN-42, and KAN-43
implementing the ledger schema, transaction lifecycle, and transactional
outbox composition. A mock logger call, fabricated ledger event, template,
local queue, branch merge, or Jira transition cannot satisfy that criterion.
No live retention proof was attempted in this local batch.
