# KAN-52: Metrics, correlation-linked traces, and service dashboards

KAN-52 is the local SEC-004 observability boundary. It adds bounded application
metrics, server-authoritative span records, queue/job failure evidence, ledger
lifecycle counters, and a statically validated environment-dashboard contract.
This work is local-only: it does not deploy a stack, enable a dashboard, send
telemetry to a managed backend, invoke AWS, or start a paid service.

## Cost and acceptance boundary

The repository can prove the metric and span contracts, local instrumentation,
synthetic request visibility, failed-job counters, dashboard wiring, and
cardinality/redaction rules without a cloud account. It cannot prove ingestion,
retention, access control, a rendered environment dashboard, actual SQS redrive,
or backend availability without an explicitly authorized non-production run.

`EnableOperationalDashboard` therefore remains disabled by default, and the
existing infrastructure template still requires its explicit billing
acknowledgement before any deployment. Jira subtask KAN-250 owns backend/cost
approval and deployed acceptance. An `awaiting_dead_letter` application event
means that a receive attempt exhausted its local retry policy; only the managed
DLQ depth/redrive evidence in KAN-250 can prove that SQS moved the message.

## Metric contract

The in-process provider-neutral recorder exposes only typed operations. It has
no public arbitrary metric-name or label-map API. Invalid diagnostic input is
dropped and must never change a customer or financial operation.

| Series                                         | Kind                   | Bounded dimensions                    |
| ---------------------------------------------- | ---------------------- | ------------------------------------- |
| `http_requests_total`                          | counter                | operation, method, outcome, synthetic |
| `http_request_errors_total`                    | counter                | operation, outcome, synthetic         |
| `http_request_duration_ms`                     | fixed-bucket histogram | operation, method, synthetic          |
| `http_active_requests`                         | gauge                  | operation, synthetic                  |
| `worker_in_flight` / `worker_saturation_ratio` | gauge                  | worker role                           |
| `queue_events_total`                           | counter                | queue role, closed transition         |
| `job_errors_total`                             | counter                | queue role, closed error class        |
| `quote_state_total`                            | counter                | closed quote state                    |
| `execution_state_total`                        | counter                | closed ledger lifecycle state         |

`worker_saturation_ratio` is emitted only when the caller has an authoritative
configured capacity. The deployed outbox dispatcher uses its reviewed
concurrency setting; the not-yet-deployed business-job consumer reports only
its truthful in-flight count. ECS CPU/memory remain the environment-level
worker saturation signals.

Route templates are mapped to a small operation vocabulary before recording.
Unknown or unmatched routes collapse to `unknown`; raw paths and query strings
are never labels. Queue depth, oldest-message age, and actual DLQ visibility
remain authoritative native SQS metrics in the environment dashboard rather
than being inferred from an application attempt.

The following must never become metric dimensions: request, correlation,
trace, span, actor, account, wallet, job, message, intent, quote, transaction,
or ledger identifiers; IP addresses; user agents; URLs; payload values; raw
errors; provider values; credentials; signatures; or arbitrary environment
data. The `synthetic` dimension is a trusted construction-time boolean used by
local acceptance, never an inbound request header.

## Trace contract

The HTTP boundary ignores caller-provided `traceparent`, `tracestate`, baggage,
request-ID, and synthetic headers. It starts from the same canonical,
server-generated UUID root used by KAN-51. A domain-separated SHA-256 projection
creates a 32-hex trace ID and a separate stable nonzero root span ID. New spans
use random nonzero 16-hex span IDs. Nested spans inherit their active parent;
top-level asynchronous spans attach to the stable root, so the existing durable
correlation context links API, outbox/SQS, and ledger work without adding an
untrusted transport header or another SQS message attribute.

This is a bounded application trace graph, not a claim of W3C propagation or
delivery to a tracing vendor. Completed spans are held in a fixed in-memory ring
for deterministic local evidence. The default structured-log projection emits
every failed, aborted, or trusted-synthetic trace and deterministically samples one
percent of ordinary successful traces by trace ID, so every span in a sampled
trace receives the same decision. It uses the strict KAN-51 event allowlist as
`trace.span.completed`. Its explicit payload is limited to trace/span linkage,
a closed span name, duration, outcome, and a fixed error code. KAN-51 may attach
its already-reviewed correlation context to the surrounding structured record;
the dashboard projects only correlation/trace linkage and never actor or domain
identifiers. No payload, header, raw error, or customer value is admitted.

## HTTP, job, and lifecycle seams

- Request middleware records latency, outcome, errors, and active-request
  saturation exactly once on response finish or abort. Successful health probes
  remain quiet in both logs and traces without suppressing their metrics; failed
  probes remain traced.
- The outbox dispatcher records configured-concurrency saturation, one producer
  span per claimed job, transport publication, and transition-aware retry,
  terminal-failure, or ownership-loss counters.
- `SqsJobWorker` records source-queue receipt, completion, retry scheduling,
  redrive-pending, ownership loss, bounded error class, consumer span, and
  in-flight work. Retry/redelivery keeps the existing durable root.
- A successful `LedgerService.transitionLifecycle` records the closed execution
  state. `INTENT_CREATED`, `QUOTE_CREATED`, approval, expiry, rejection, and
  preflight failure additionally map to the closed quote-state counter. Metrics
  and the `ledger.lifecycle.transitioned` event occur only after persistence
  succeeds.

The ledger seam is the honest local quote/execution proxy currently available.
There is no registered production quote application module or deployed
business-job consumer yet, so local lifecycle and failed-handler tests do not
claim live quote traffic or a production consumer.

## Dashboard contract

The optional environment dashboard includes:

- ALB request volume, target latency, and target 4xx/5xx counts;
- ECS CPU and memory saturation for API, web, and worker services;
- source-queue visible depth and oldest-message age;
- DLQ visible depth;
- allowlisted structured-log queries for recent trace graphs, job failures, and
  lifecycle-state counters.

The local baseline validator pins the widget metrics, dimensions, query event
names, and safe projected fields. Mutation tests reject missing panels, wrong
queue targets, raw-message queries, and weakened disabled-by-default/cost gates.

## Local acceptance evidence

A synthetic local GET to `/api/v1/version` uses a test-injected recorder and
must appear in both the completed-span snapshot and the metric-backed dashboard
snapshot. A fake/local SQS worker failure must atomically increment
`job_errors_total` and the matching `queue_events_total` transition while
leaving the message undeleted for retry/redrive.

The synthetic marker is a trusted bootstrap/test input, not a public request
header. An authorized deployed check must capture the server-returned
`X-Request-Id` and use that correlation ID to locate the request in the trace
panel; defining the monitor identity and source is part of KAN-250.

Run the bounded local checks with:

```powershell
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm test --workspace @crypto-lending/api
npm run test:e2e --workspace @crypto-lending/api
npm run test:integration --workspace @crypto-lending/api
node infra/aws/validate-application-baseline.mjs
node --test infra/aws/validate-application-baseline.test.mjs
npm run format:check
git diff --check
```

The integration suite remains loopback/local-emulator guarded. None of these
commands deploys infrastructure or invokes a managed telemetry service.

## Remaining gates

KAN-250 must remain open until an authorized reviewer binds an exact commit and
template revision to an approved backend/cost ceiling, deployed synthetic trace
lookup, actual queue-to-DLQ redrive, rendered environment panels, telemetry
access/retention/redaction/cardinality evidence, teardown, and final cost
record. KAN-248's logging-access and incident-query packet is also only a
`NOT_EFFECTIVE` draft while KAN-220 and Security/Privacy/Operations decisions
remain pending; it does not authorize trace queries or evidence export. KAN-52
may enter review on the local evidence above; it must not be represented as
deployed or fully accepted while KAN-250 remains open.
