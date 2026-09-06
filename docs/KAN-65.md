# KAN-65: Local balance-sync orchestration and correctness recovery

Status: `DURABLE_READ_MODEL_AND_ADDRESS_BOUNDARY_COMPLETE` / `LIVE_INDEXING_BLOCKED`

KAN-65 implements the provider-neutral orchestration contract for IDX-005 and
migration `0020`, its durable PostgreSQL checkpoint/read model. The
orchestrator accepts a deterministic SQS-envelope-shaped job, reads one wallet
and chain through injected boundaries, validates the candidate against the
closed KAN-61 asset registry and KAN-62 chain-observation policy, and asks the
checkpoint port to atomically update the current observation.

`BlockchainSyncModule` now registers concrete PostgreSQL checkpoint and
portfolio-balance reader adapters. Importing it opens no RPC/provider/queue
connection and starts no consumer or scheduler. The migration and adapters were
tested against the repository's disposable loopback PostgreSQL fixture; no
external provider account, endpoint, API key, AWS resource, or billable service
was created or used.

## Local contract

The orchestration boundary has six injected ports:

- `BalanceSyncIndexerPort` reads a current candidate or performs a bounded
  replay from a finalized checkpoint;
- `BalanceSyncCheckpointPort` loads and atomically upserts, replaces, or marks
  a wallet/chain checkpoint stale using an expected revision;
- `BalanceSyncJobPort` records a retry or dead-letter decision using the typed
  job envelope;
- `BalanceSyncClockPort` supplies trusted deterministic evaluation time;
- `BalanceSyncMetricsPort` receives bounded event and alert labels only; and
- `BalanceSyncWalletAddressResolverPort` is the required scoped decryption
  boundary for a future live indexer.

The durable checkpoint, portfolio-balance, dormant wallet-address resolver, and
dormant Ethereum/Solana transcript indexer adapters are concrete. Three additional
source-only capsules remain deliberately unregistered. The balance-consumer
persistence resource encloses its PostgreSQL pool and repositories behind
checkpoint/address-resolution closures. Those closures synchronously gate new
work, track every accepted operation, and on close abort and drain cancellable
PostgreSQL work before making a best-effort pool close. The balance-consumer receipt
resource encloses a private SQS client behind receive, delete,
change-visibility, and envelope-parsing closures. Both capsules are now
referenced only by the source-only
`application/balance-sync-consumer.resource.ts` aggregate. That aggregate gives
both child factories the same exact frozen infrastructure snapshot, wires their
exact checkpoint, address-resolution, and pinned receipt ports into the inert
application composition, and exposes only a one-shot `run(signal)` plus
memoized `close()`. Close has a fixed 25-second watchdog inside the envelope's
30-second ECS `StopTimeout`; watchdog expiry is a fixed failure, never a false
drain, while the already-started cleanup remains observed and continues. It is
not exported from a barrel or referenced by a Nest
module, runtime, CLI, activation path, or other launch root.

The third capsule is a reviewed provider-neutral Node HTTPS JSON-RPC transport.
It owns cancellable per-exchange A and AAAA resolution, pins the selected public
address and family through TLS, retains hostname verification, propagates the
caller's abort signal through bounded connect/body work, joins accepted request
and response teardown, and parses only bounded strict JSON. It embeds no provider
hostname, path, endpoint, or credential and is absent from barrels, composition,
runtime, configuration loaders, templates, and the release manifest. Therefore
it cannot perform I/O unless a future reviewed composition explicitly constructs
it.

The separate source-only `application/balance-sync-consumer.lifecycle.ts`
shell accepts only that exact aggregate facade, a genuine external abort
signal, and a narrow operator-event sink. Its one-shot `run()` bridges shutdown
to a private signal without forwarding the caller's reason, distinguishes a
clean stop from premature exit or run/close failure, starts memoized aggregate
close as soon as shutdown is handed to the run, and observes late run
settlement. This lets the aggregate watchdog report a non-draining run within
the ECS shutdown window. Fixed one-field events and fixed errors prevent
provider, credential, address, or raw failure details from crossing the
operator boundary. Construction adds no listener or other side effect, and the
shell is not exported, registered, or referenced by a launch root.

The dedicated runtime is an exact empty Nest `@Module({})`, and its start
function always rejects with `BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED`. It imports
and composes neither the dormant lifecycle shell, aggregate, nor either child
capsule. Neither source-only layer composes or replaces that refusing runtime.
Source activation remains false, so the CLI refuses startup before dynamically
importing even that empty runtime. The dedicated loader accepts only the exact
`APP_ENV` balance source/DLQ pair in one AWS account and rejects generic queue
variables and unknown SQS aliases. The receipt capsule snapshots only the
source coordinate and required client settings; it neither reads nor retains
the DLQ URL and exposes no publish, queue-health, queue-attribute, or
caller-supplied `QueueUrl` capability.

A release-bound standalone CloudFormation envelope now records the intended
dormant process boundary and is inspected by local validation and offline
preflight. It is source-only: the application parent and deployment target do
not reference or compose it, no task or role was provisioned, and its
environment selector excludes production. An actual deployment would require
the explicit billable-resource acknowledgement; no cloud or external action
was taken for this checkpoint.

The inert composition now routes balance reads through a byte-pinned closed
mainnet router. It accepts only Ethereum `eip155:1` and Solana
`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`; Base and every other network fail
closed, with no cross-provider fallback. The router requires distinct injected
indexers, captures their read/rescan data methods once, validates account and
wallet UUIDs, and forwards only exact frozen null-prototype copies of read,
rescan, and source-point records. It owns no transport, endpoint, credentials,
retry loop, or runtime registration.

Provider and retry classification is also closed to authentic immutable
failures. A private in-module brand plus frozen descriptor validation replaces
`instanceof` trust, and adapters reconstruct only a reviewed classification.
Resolver and clock failures, hostile proxies, accessors, prototype
counterfeits, and mutable lookalikes are sanitized to fixed failure codes. The
offline preflight pins these sources and mutation-tests the two-chain router,
snapshot, method-capture, brand, freeze, and reviewer constraints. This is
local static assurance only; it does not activate the dormant runtime, contact
a chain or provider, grant egress, deploy resources, or satisfy live evidence.

The dormant balance-sync path now carries one privately branded execution context from
each accepted consumer job through the dispatcher, composition, orchestrator,
closed router, Ethereum or Solana adapter, shared JSON-RPC helper, and injected
transport boundary, as well as through scoped wallet-address resolution and
all four checkpoint operations. The PostgreSQL resolver and repository review
the branded context before work, pass its exact signal into the database
service, and review it again after the query. The same context is required for
current reads, rescans, resolution, and persistence; no production boundary
may use the exported unit-test-only inert
context as a default or fallback. Abort classification is retained out of band:
a deadline becomes `PROVIDER_TIMEOUT`, shutdown becomes
`PROVIDER_UNAVAILABLE`, and the caller's abort reason is neither read nor
forwarded. The helper checks before transport, in its catch path, and again
after a successful response. Its transport contract requires the same signal
and cooperative cancellation; `Promise.race` detachment is prohibited.

`jobTimeoutMs` defaults to three hours and is constrained to two through six
hours. It propagates one deadline across resolution, RPC, and checkpoint
persistence. The database service requires a genuine abort signal, rejects use
inside an active transaction, owns a dedicated client per cancellable query, and has a
16-second local operation timer. Cancellation before SQL prevents a query from
starting; cancellation after client acquisition discards with
`client.release(error)`, awaits the exact matching pool removal and query
settlement, and reports a fixed teardown failure if safe drain cannot be
established. Admission closes synchronously and close is memoized before its
private lifecycle abort. Neither this path nor the RPC path reads an abort
reason or detaches work with `Promise.race`.

Balance-consumer database settings are capped at 5 seconds for connection
acquisition, 5 seconds for lock waits, and 15 seconds for statements. Active
`pg` pool acquisition is not natively signal-cancellable, so an already-started
acquisition may still settle at its configured 5-second bound before the
facade can finish draining. The exact production dependency is `pg` 8.23.0,
and the package lock resolves `pg-pool` 3.14.0; preflight pins both artifacts
and these semantics. This remains local static/unit assurance: a live
PostgreSQL socket teardown and physical shutdown exercise is still required.
The source-only HTTPS capsule now provides a reviewed implementation of
cooperative DNS, connect, and response-body cancellation, but it is not live
evidence. No provider, hostname/path endpoint, credential source, runtime wiring,
or egress approval has been selected. Its deliberately strict response policy
requires exactly one bounded framing: either one canonical `Content-Length` or
one standalone case-insensitive `Transfer-Encoding: chunked` on HTTP/1.1, never both. It
rejects compression, declared or received trailers, duplicate or compound
transfer encodings, incomplete bodies, excess decoded bytes, and excess decoded
body `data` events. Node validates and removes wire chunk framing before these
application counters run, so chunk extensions and wire-framing overhead are not
observable here. Compatibility with each intended provider remains unproved.
Deployed Node resolver, TLS, socket-teardown, and provider behavior must still be
observed. The dormant two-source coordinator drains both same-signal reads with
`Promise.allSettled` and rechecks cancellation before inspecting fulfilled
values, but it remains unapproved for financial use. Offline preflight byte-pins
and mutation-tests these boundaries without activating the consumer or making
any external or billable call.

The offline integrity closure now includes the exact supported-asset registry,
wallet address parser, and Solana token-account parser used by those adapters.
The adapters select exactly USDC, USDT, and PYUSD on Ethereum mainnet and the
same three assets on Solana mainnet. Base, Arbitrum, and testnet definitions may
remain in the broader reviewed catalogs as future metadata; they are not
activated by this launch composition and cannot pass the two-network router.
EVM addresses must be strict and canonicalized to lowercase. Solana addresses
must decode to exactly 32 nonzero bytes and round-trip through canonical base58.

Solana token accounts accept only the exact legacy or Token-2022 program ID.
Legacy accounts are exactly 165 bytes; Token-2022 accounts are capped at 4,096
bytes and require the account-type discriminator when extended. The parser
copies input bytes, validates COption fields and the expected owner, and returns
only a frozen parsed result. Adapter-side base64 and account-count bounds remain
in force, with PYUSD fixed to Token-2022 and USDC/USDT fixed to the legacy
program. Each account-read batch is bracketed by the same selected block header;
null or any position, block-hash, parent-position, or parent-hash change fails
as provider unavailable. No local test of these rules is live-chain evidence.

The envelope holds the service at literal `DesiredCount: 0` while source
activation stays false, `BALANCE_CONSUMER_MODE=disabled`, and the runtime stays
uncomposed. Its loopback-only security group cannot reach a provider or RPC.
The task role contains only receive/delete/change-visibility for the exact
balance source and KMS decrypt through SQS; it has no jobs/DLQ, send,
`GetQueueAttributes`, Secrets Manager, Redis, auth, provider, or RPC capability.
The execution role can only pull the same-account digest-pinned API image and
write its dedicated logs. No database secret or grants, metadata key, or RPC
input is attached. Public IP and ECS Exec are disabled; Fargate `1.4.0`, a
non-root user, read-only root filesystem, and dropped Linux capabilities harden
the inert task definition.

Migration `0023` originally gave the generic worker execution of the exact
wallet-address resolver without wallet-table access. Migration `0028` revokes
that resolver and all four balance checkpoint functions from the generic
worker, and the cumulative migration chain through `0029` preserves the
suspension. Migration `0029` separately gives only the exact API role a
chain-bound-wallet-gated read over global Ethereum/Solana provider-position
chain-anchor evidence; it grants no runtime evidence-record or control function
and no balance-consumer capability. The dormant dedicated balance-consumer
identities have no database connection or grants, and the current workload
supplies neither the separate metadata secret nor an active consumer process. A
job therefore still cannot
obtain a plaintext address or cause chain I/O. See
`docs/rpc-indexing/balance-consumer-wallet-address-boundary.md`.

Each job is closed to one account UUID, wallet UUID, KAN-61 CAIP-2 network,
observation tier, attempt, cause, and optional finalized recovery position. Job
creation requires an explicit ID, canonical timestamp, and correlation context;
there is no hidden random or wall-clock dependency. Retry IDs are derived from
the parent ID and next attempt with a domain-separated SHA-256 digest.

## Idempotent current observations

An observation ID is a deterministic digest of the account, wallet, network,
tier, immutable chain source lineage, and sorted exact atomic positions. It is
independent of retrieval time and response ordering.

The checkpoint port receives an expected revision and one of three modes:

| Mode        | Condition                                                        | Durable intent                                     |
| ----------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| `CREATED`   | No current observation exists                                    | Store the validated observation as current         |
| `UPDATED`   | The validated head appends to the prior head                     | Replace the one current observation atomically     |
| `UNCHANGED` | Position, hash, and parent hash match the current source exactly | Keep the same observation ID; do not create a copy |

If the provider reports different balances for identical source lineage, the
candidate is invalid. The prior observation is retained and marked stale; it is
never rewritten and never replaced with zero.

## Durable PostgreSQL checkpoint and read model

Migration `0020` creates four least-privilege relations:

- `balance_sync_observations` and
  `balance_sync_observation_positions` preserve accepted raw facts;
- `balance_sync_checkpoint_events` preserves every accepted transition; and
- `balance_sync_checkpoints` is the deterministic one-row current projection
  for an account/wallet/network scope.

Raw observations, positions, and transition events are append-only, including
against owner-side `TRUNCATE`, `UPDATE`, and `DELETE`. The current projection
can advance only one revision at a time and must exactly reproduce its referenced
event. Composite foreign keys bind every non-null historical/current observation
reference to the same account, wallet, chain namespace/reference, and CAIP-2
network; an observation from another valid wallet cannot be persisted in that
event scope.

Worker writes take an account/wallet/network advisory transaction lock and a
`FOR UPDATE` lock on the exact active registered-wallet row. Deterministic event
IDs make exact retries idempotent. Competing first writes serialize, one wins,
and the losing transaction rolls back its candidate observation rather than
leaving orphaned raw state. Normal updates require the next chain position and
matching parent hash; gaps and divergences can enter only the finalized-anchor
recovery function. Reorg replacement preserves the immutable anchor and all
prior provisional observations while projecting the one validated replacement.

Source positions use `numeric(20,0)` and an explicit unsigned-64-bit ceiling.
That is narrower than the shared domain's generic uint256 parser by design:
Ethereum block numbers and Solana slots are protocol uint64 position domains,
while asset amounts remain canonical uint256 strings. Widening the chain source
domain requires a reviewed migration rather than an implicit coercion.

Every observation contains exactly the three active launch assets for its
network: USDC, USDT, and PYUSD. The schema pins mainnet registry version `1` and
fingerprint `5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d`.
Adding/removing an asset or changing that registry version/fingerprint therefore
requires a new schema migration and replay plan; an application-only registry
change cannot silently reinterpret stored balances.

Migration `0020` historically gave the generic worker execute access to the
checkpoint read/current/stale/reorg functions. The cumulative migration chain
through `0029` revokes all four grants plus the wallet-address resolver grant;
no application runtime currently has balance-consumer function authority. The
API role retains only execute access to the separate roster-bound portfolio
balance read and migration `0029`'s active-chain-bound-wallet-gated
provider-position anchor-evidence read. That new global evidence/control schema
has no account or wallet PII columns; its record and invalidation/quarantine
functions remain owner-controlled with no runtime grant. No application
anchor-evidence reader/adapter or writer/producer exists, no populated rows or
runtime activation, deployment, or live evidence are claimed, and neither API
nor worker can read or mutate the
four balance tables. The finalized-anchor writer exists for tested recovery
semantics but has no runtime grant until independent live-finality evidence is
approved.
Every definer and invoked helper has a fixed safe `search_path`, and rollback
refuses once any raw, event, or projected row exists.

## Confirmation, freshness, and finality gates

The orchestrator consumes the KAN-62 network policy rather than inventing new
thresholds. Locally, only `PROVISIONAL` observations are executable:

| Chain family | Local selector | Current threshold | Unavailable after |
| ------------ | -------------- | ----------------- | ----------------- |
| Ethereum     | `latest`       | 60 seconds        | 15 minutes        |
| Solana       | `confirmed`    | 15 seconds        | 2 minutes         |

The broader domain policy still describes deferred networks, but migration
`0020`, both durable PostgreSQL adapters, and current production launch coverage are
restricted to Ethereum and Solana. Base and Arbitrum observations cannot be
persisted, counted, or used as fallback evidence for this release.

The dormant Ethereum transcript adapter can validate `latest`, `safe`, or
`finalized` reads. Every contract-code and balance call is bound to the exact
selected canonical block hash with the EIP-1898
`{ blockHash, requireCanonical: true }` parameter; a block number is never used
for those state reads. This prevents a same-height reorg from producing a
mixed-state candidate, but does not satisfy the live proof and approval gates.
The dormant Solana transcript adapter supports `PROVISIONAL/confirmed`,
`CANONICAL/confirmed`, and `FINANCIAL/finalized`. The display tier deliberately
uses `confirmed` because official `getBlock` evidence is a confirmed-block
structure; the adapter never invents processed parent lineage. Sharing a
selector does not share authority: provisional remains display-only, while
canonical and financial uses retain every live-proof, independent-agreement,
and approval gate. Its exact mint/program manifest binds USDC and USDT to the
legacy Token Program and PYUSD to Token-2022. Bounded canonical-base64 account
bytes are checked with the shared raw SPL parser, so Token-2022 extension space
is supported without trusting arbitrary programs, provider-parsed extension
objects, or unbounded account allocation. See
`docs/rpc-indexing/ethereum-solana-balance-transcript-adapters.md`.

Offline production preflight SHA-256 pins the exact shared JSON-RPC helper,
provider-neutral Node HTTPS transport, and both Ethereum/Solana adapter sources.
A separate semantic contract preserves
their injected transcript-only boundary, rejects direct HTTP/client, URL,
credential, environment, timer, retry-loop, and Nest/runtime capabilities, and
requires their identities to remain absent from module, activation, runtime,
and CLI launch roots. The HTTPS capsule is separately constrained to its exact
DNS, TLS, cancellation, bounded-response, and sanitized-failure markers, and its
identity must remain absent from barrels, composition, runtime, configuration,
templates, and release inputs. Existing adapter barrel exports are intentionally
allowed and do not compose a transport. Passing this local source check leaves
every RPC, egress, task, IAM, database, deployment, and live-evidence blocker
unchanged.
Each adapter narrows its five-field read request to the resolver's exact frozen
`accountId`/`walletId`/`networkId` scope, matching the real PostgreSQL resolver
instead of forwarding surplus tier and selector fields.

`CANONICAL` (`safe` or `confirmed`) and `FINANCIAL` (`finalized`) jobs fail
closed locally. They require live capability, independent agreement, and
downstream approval evidence that this ticket does not have. A provisional
balance is display/read-model data only and cannot authorize a ledger entry,
credit decision, or transaction.

Candidates must have the exact requested wallet, network, tier, selector,
validated chain identity, canonical non-future timestamp, network-valid source
hashes, supported KAN-61 asset identities, exact unsigned atomic amounts, and
unique position and asset identities. EVM source hashes are normalized to
lowercase before lineage comparison. Unknown fields and non-data prototypes are
rejected.

## Reorg and gap recovery

A same-height hash divergence, parent mismatch, head regression, or skipped
height triggers bounded recovery. Manual recovery carries the exact persisted
finalized position. A failed manual recovery keeps that anchor in its retry
job.

Recovery follows this closed sequence:

1. Load the last finalized source from the wallet/chain checkpoint.
2. Request an authoritative replay from that exact source with a hard limit of
   2,048 read units.
3. Require the replay to begin at the anchor, end at the replacement source,
   declare completion, stay within the limit, and pass identity, registry,
   lineage, and freshness checks.
4. Ask the checkpoint port to replace only the affected provisional current
   observation using the expected revision.

Finalized facts are never mutated. An incomplete, oversized, divergent, or
unanchored replay fails closed, preserves the last good observation, marks it
stale, emits a recovery alert, and receives the bounded retry/DLQ decision.

## Retry, dead-letter, and stale-data policy

The dormant physical boundary uses the original source message for every
delivery. Balance ingress accepts only a source envelope whose payload has
`attempt=1`; it does not publish a derived retry envelope or mutate that payload
between deliveries. The source queue's native redrive policy is the sole retry
and DLQ authority, with `maxReceiveCount=3`. The worker instead uses the
transport-supplied `ApproximateReceiveCount`: failures at receive counts 1 and 2
retain the receipt and set visibility to the bounded retry delay, while a
failure at receive count 3 sets visibility to zero, reports
`awaiting-dead-letter`, and still does not delete the receipt. SQS can then move
the message through its configured native redrive relationship.

Native receipt delays begin at 5 seconds and remain capped at 60 seconds. A
validated provider retry decision can carry a trusted in-memory minimum from 5
through 60 seconds; the worker may raise the current receipt delay to that floor
but never above the cap. The marker cannot be forged by an arbitrary error, and
it is ignored once the receipt is exhausted. Permanent, non-retryable, invalid,
or over-bound provider dispositions also fail through the no-I/O disposition
port: they retain the same source receipt for native redelivery/DLQ rather than
sending directly to a DLQ.

| Receipt condition                        | Physical result                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Transient failure, receive count 1 or 2  | Retain receipt; apply native delay, raised by a trusted provider floor |
| Trusted provider floor from 5–60 seconds | Raise only that receipt's visibility delay, capped at 60 seconds       |
| Permanent or non-retryable disposition   | Retain receipt; no direct DLQ send or deletion                         |
| Any failure at receive count 3           | Visibility zero; retain receipt for native SQS redrive                 |

Every provider/indexer failure first asks the checkpoint port to preserve the
exact last good observation and mark freshness `STALE` (or `UNAVAILABLE` when
no good observation exists). It emits bounded `PROVIDER_FAILURE` and
`DATA_STALE` alerts. Metrics and alerts cannot change the durable outcome if an
observability adapter itself fails.

Metrics contain only event, network, tier, attempt, and position-count labels.
They exclude account IDs, wallet IDs, wallet addresses, asset balances, source
hashes, provider URLs, credentials, and raw adapter errors. Adapter exception
text is mapped to fixed local error or failure codes. The balance receipt path
additionally defines `balance_receipt_dispositions_total` with only
`receive_count`, `retry_delay_seconds`, and
`trusted_provider_delay_floor_applied`; telemetry remains observational and is
not emitted by an active process while the runtime is uncomposed.

## External gates

Runtime integration remains blocked until all relevant work is merged and
approved:

- KAN-63 and KAN-64 now have dormant provider-neutral EVM and Solana transcript
  adapters and deterministic adversarial evidence, but still require independent
  review and live acceptance evidence;
- KAN-62/KAN-251 must approve and prove provider capabilities, network
  identity, archive depth, finality semantics, Ethereum EIP-1898 behavior for
  both `eth_getCode` and `eth_call` (including noncanonical-hash rejection),
  Solana Token-2022/PYUSD base64 response behavior, failure behavior, rate
  limits, commercial terms, and cost controls;
- KAN-231 must separately approve exact-host egress and its kill switch;
- the dormant scoped address resolver must be deployed only in a dedicated
  consumer with a separately split metadata-only secret and a later reviewed
  exact-function database grant; the current worker task has no such secret,
  grant, or resolver binding;
- the reviewed source-only JSON-RPC transport still needs an approved provider,
  exact hostname/path endpoint and credential source, runtime composition,
  exact-host egress, deployed Node DNS/TLS/socket evidence, and live proof that
  each provider returns one of the required strict bounded response shapes;
  separately, a deployed PostgreSQL exercise must prove the reviewed
  acquisition, discard, exact removal, and shutdown behavior against the
  production-compatible server and driver;
- the source-only pinned SQS boundary must receive deployed task/IAM proof,
  source/DLQ and redrive evidence, duplicate-delivery and liveness exercises,
  and bounded-delay validation; and
- Operations must approve scheduling, monitoring, alert routing, replay
  ownership, and runbooks.

Until those gates close, the durable model is ready to receive validated facts
but cannot obtain them itself. It makes no claim that a live balance has been
indexed or that runtime/task activation, IAM, dedicated database grants, SQS,
RPC, address decryption, monitoring, or any deployed behavior has been
validated.

The receipt, cancellable persistence, bounded aggregate shutdown, and dormant
HTTPS transport work was implemented and verified with local source/unit checks
only. Adversarial aggregate tests use mocked child
construction and in-memory capabilities, and repository/resolver tests prove
that the exact execution context reaches the cancellable database boundary. A separate compatibility test uses
the actual aggregate, child factories, application composition, and lifecycle
shell while replacing only the low-level PostgreSQL pool and SQS client edges;
it proves private cancellation reaches the pending receipt request and ordinary
shutdown drains before SQS-then-PostgreSQL close. Separate adversarial tests
cover the 25-second watchdog and late observed cleanup. Transport tests use
mocked DNS and HTTPS edges; they are not deployed Node, DNS, TLS, provider,
database, queue, credential, or deployment evidence. No AWS, SQS, ECS
credential endpoint, RPC, or chain-provider call was made, and no task, IAM
identity, dedicated balance-consumer database grant, or runtime activation was
deployed for this checkpoint. Adding these dormant source-only layers does not
select or implement RPC providers, activate the source, grant database or IAM
authority, deploy anything, create cloud costs, or satisfy any live-acceptance
gate.

The authored standalone envelope does not change that conclusion. Preflight
must retain `BALANCE_CONSUMER_TASK_NOT_PROVISIONED`,
`BALANCE_CONSUMER_IAM_NOT_PROVISIONED`, and
`BALANCE_CONSUMER_DEPLOYED_EVIDENCE_MISSING` until independently controlled,
target-bound deployment evidence exists. The database, external-egress,
Ethereum/Solana RPC, provider, and all other production blockers also remain
open.

## Local verification

The first commands are filesystem/process local. The integration command uses
only the guarded disposable loopback PostgreSQL fixture; none makes an RPC,
provider, queue, cloud, or Jira request.

```powershell
npm test --workspace @crypto-lending/api -- src/blockchain-sync
npm test --workspace @crypto-lending/api -- src/blockchain-sync/infrastructure/postgres src/infrastructure/database/migrations/0020-create-balance-sync-read-model.migration.spec.ts
$env:RUN_INFRASTRUCTURE_INTEGRATION='1'; npm run test:integration --workspace @crypto-lending/api -- test/infrastructure/balance-sync-read-model.integration-spec.ts
npm run test --workspace @crypto-lending/api
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm run format:check
npm run security:scan:secrets
git diff --check
```
