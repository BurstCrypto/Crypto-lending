# Balance-sync physical queue boundary

Status: `SOURCE_BOUNDARY_COMPLETE` / `ACTIVATION_AND_DEPLOYMENT_BLOCKED`

The reviewed logical outbox destination remains `jobs` for database compatibility. At the SQS adapter boundary, only the exact reviewed `blockchain.balance-sync@1` envelope is sent to `SQS_BALANCE_QUEUE_URL`. Reviewed ledger and yield envelopes continue to use `SQS_QUEUE_URL`. An absent balance queue setting fails balance publication closed and never falls back to the jobs queue.

The general publisher/readiness configuration still requires the four configured
URLs (`SQS_QUEUE_URL`, `SQS_DEAD_LETTER_QUEUE_URL`, `SQS_BALANCE_QUEUE_URL`, and
`SQS_BALANCE_DEAD_LETTER_QUEUE_URL`) to be pairwise distinct. The dedicated
balance-consumer loader accepts only the balance source/DLQ pair. In production,
both must be canonical regional HTTPS SQS URLs, must use the exact `APP_ENV`
queue names, and must belong to the same AWS account. Generic queue variables,
unknown or miscased `SQS_*` aliases, and a source/DLQ identity mismatch fail
startup closed.

Mixed outbox batches are grouped by physical source queue. Each physical request has its own abort scope, while results remain aligned to original input order. One queue request failing does not cancel or remap the other physical request.

`SqsJobWorker` receives a pinned queue-receipt port rather than the broad SQS
service. That port exposes only receive, delete, change-visibility, and envelope
parsing; it exposes no publish operation or queue URL, and callers cannot supply
a `QueueUrl`. The registered generic worker is pinned to the jobs queue and
rejects balance jobs before invoking a handler. The dormant balance composition
accepts an already source-pinned balance receipt capability and accepts only
exact `blockchain.balance-sync@1` envelopes, rejecting ledger, yield, unknown,
or wrong-version jobs before handler invocation. The new source-only
`application/balance-sync-consumer.resource.ts` aggregate establishes the
capsule provenance boundary, gives the SQS and persistence child factories the
same exact frozen infrastructure snapshot, derives worker visibility from that
snapshot, and passes the exact pinned receipt and persistence ports into the
composition. It exposes only a one-shot `run(signal)` and memoized `close()`.
When the raw `SqsService` is loaded for the balance-consumer workload,
send/publish, batch-publish, and queue health inspection fail closed.

The source-only balance-consumer receipt capsule is not registered or exported
through a barrel. It snapshots hostile configuration before allocating its
private client, pins the reviewed branded balance source URL, and exposes only
frozen receipt and close closures. Its client can issue only receive, delete,
and change-visibility commands; it does not read or retain the balance DLQ URL,
fetch arbitrary message attributes, or expose send, queue-attribute, health, or
direct-DLQ capabilities. A separate source-only persistence capsule similarly
encloses its PostgreSQL pool and balance repositories. Both capsules are
referenced only by the dormant aggregate; the aggregate itself is unbarreled,
unregistered, and absent from the runtime, CLI, activation path, Nest module,
and every other launch root.

The application infrastructure templates define separate KMS-encrypted
source/DLQ pairs with TLS-only policies and exact redrive relationships. The
outbox worker may publish to both source queues and inspect all four queues, but
has no receive/delete permission. The API may only inspect all four queues. The
application parent and checked-in deployment target still contain no balance
consumer task, service, or IAM identity.

A separate, release-bound standalone CloudFormation envelope now describes the
dormant balance-consumer task boundary. Local validation and offline preflight
inspect its exact source, but neither the application parent nor the deployment
target references or composes it, and nothing has been provisioned. It accepts
only non-production environment names and requires the literal
`I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES` input before a deployment
could create resources. No deployment or other external/cloud action was run
while authoring or validating it, so this checkpoint incurred no cloud cost.

The standalone service has a literal `DesiredCount: 0`, source activation
remains false, its task environment keeps `BALANCE_CONSUMER_MODE=disabled`, and
the runtime remains uncomposed. Its security group has no ingress and only a
loopback `127.0.0.1/32` egress rule. Its task role can receive, delete, and
change visibility only on the exact same-account balance source queue, plus
decrypt the application data key only through regional SQS. It cannot inspect
queue attributes, send to any queue, consume the DLQ or jobs queue, read a
secret, use Redis/auth/provider capabilities, or reach an RPC. Its execution
role is limited to pulling the same-account digest-pinned API image and writing
the dedicated encrypted log stream. The task receives no database secret or
grant, metadata key, RPC/provider input, generic queue URL, or authentication
configuration.

The envelope additionally disables public IP assignment and ECS Exec, pins
Fargate platform `1.4.0`, runs as non-root with a read-only root filesystem,
drops all Linux capabilities, and uses the balance-consumer CLI only. These are
source constraints for an inert non-production envelope, not deployed IAM,
network, runtime, or production-read evidence.

The shared API image contains a `worker:balance:prod` entrypoint for local and
compiled-runtime validation. Its immutable source activation remains false, so
it exits sanitized and nonzero before dynamically importing the dedicated
runtime or constructing either capsule. Even if that import boundary were
reached, the runtime is an exact empty Nest `@Module({})`; its start function
always rejects `BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED` and composes no resource.
The source-only aggregate does not compose or replace that refusing runtime.
The database bootstrap declares the dormant `crypto_balance_consumer_runtime`
capability identity and bounded rotating login slots, but gives them no database
connection, schema, object, function, default-ACL, or ownership authority.
Migration `0028` revokes the generic worker's execution of the wallet-address
resolver and all four balance checkpoint functions. The standalone source does
not change those application-path or database facts.

## Dormant receipt retry boundary

Balance ingress accepts only the original source envelope with payload
`attempt=1`; native SQS receipt delivery, not publication of a replacement job,
owns subsequent tries. The queue policy and worker are pinned to
`maxReceiveCount=3`. At receive counts 1 and 2, a failure retains the source
receipt and changes its visibility using the 5-second exponential base and
60-second cap. A validated provider retry decision may supply a trusted floor
between 5 and 60 seconds, raising that receipt's delay within the same cap. At
receive count 3, the floor is ignored, visibility is set to zero, the worker
reports `awaiting-dead-letter`, and the receipt remains undeleted for native SQS
redrive.

Permanent, exhausted, invalid, and other non-retryable dispositions use the
same retention path: there is no application-side direct-DLQ send. The
balance-only `balance_receipt_dispositions_total` telemetry records the bounded
`receive_count`, `retry_delay_seconds`, and
`trusted_provider_delay_floor_applied` labels without provider errors, payloads,
account/wallet identifiers, queue URLs, or credentials. These are tested dormant
semantics, not evidence of an executing consumer or deployed queue behavior.

LocalStack creates both pairs and Docker health verifies all four queue names. CI and the local demo use four explicit, distinct loopback URLs.

This checkpoint used local source and unit validation only. Aggregate wiring,
one-shot lifecycle, close/drain ordering, and failure cleanup were exercised
with mocked child construction and local in-memory capabilities; they are not
live queue, provider, database, IAM, or deployment evidence. No AWS, SQS, ECS
credential endpoint, RPC, or chain-provider call was made; no task, IAM
identity, dedicated balance-consumer database grant, service, or runtime
activation was deployed. The aggregate does not select or implement RPC
providers, activate source processing, grant database or IAM authority, deploy
resources, create cloud costs, or satisfy any remaining live-evidence gate.

## Remaining activation gates

- Keep the balance consumer desired count at literal zero and keep the
  standalone envelope uncomposed until its runtime/task,
  wallet resolver, exact database grants, mainnet RPC egress, provider
  credentials, and operational ownership are separately approved.
- Perform an authorized deployed IAM simulation proving the outbox worker can send only to the two source queues and cannot receive/delete, and proving the API is read-only.
- Capture live queue attributes for both redrive pairs, KMS use, retention, TLS denial, alarms, DLQ redrive, and cross-queue receipt-handle failure behavior.
- Add independent-source/finality evidence for the dormant Ethereum and Solana indexers before any balance result can become a financial input.
- Apply and verify migration `0028` in the target database, then introduce any
  dedicated balance-consumer execution grants only through a later reviewed
  migration. Runtime activation, task and IAM wiring, database grants, RPC
  approval, and deployed evidence all remain blocked. Offline preflight must
  continue to report `BALANCE_CONSUMER_TASK_NOT_PROVISIONED`,
  `BALANCE_CONSUMER_IAM_NOT_PROVISIONED`, and
  `BALANCE_CONSUMER_DEPLOYED_EVIDENCE_MISSING`; the locally inspected envelope
  cannot clear any of them.
