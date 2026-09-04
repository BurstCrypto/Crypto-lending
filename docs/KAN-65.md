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
dormant Ethereum/Solana transcript indexer adapters are concrete. No resolver,
RPC transport, indexer, queue job adapter, clock, or metrics adapter is
registered in a runtime module. Migration `0023` grants the
worker only execution of an exact-scope definer function returning the sealed
address binding; it grants no wallet-table access. The unregistered resolver
can open that record only with a separate consumer-specific metadata key ring.
The current workload supplies neither that secret nor a consumer process, so a
job still cannot obtain a plaintext address or cause chain I/O. See
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

The worker role receives only execute access to checkpoint read/current/stale/
reorg functions. The API role receives only execute access to the roster-bound
portfolio balance read. Neither role can read or mutate the four tables. The
finalized-anchor writer exists for tested recovery semantics but has no runtime
grant until independent live-finality evidence is approved. Every definer and
invoked helper has a fixed safe `search_path`, and rollback refuses once any raw,
event, or projected row exists.

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

Retries are limited to three total attempts. The deterministic delays begin at
5 seconds and are capped at 60 seconds. A valid provider `Retry-After` hint may
raise the delay within that cap; a larger hint dead-letters instead of creating
an unbounded delayed job.

| Failure class                                               | Decision                                    |
| ----------------------------------------------------------- | ------------------------------------------- |
| Rate limit, timeout, unavailable provider, recovery failure | Retry while an attempt remains              |
| Same transient failure on attempt three                     | Dead-letter: attempts exhausted             |
| Invalid data, permanent provider failure, unknown failure   | Dead-letter: non-retryable                  |
| Retry hint greater than 60 seconds                          | Dead-letter: delay exceeds the policy bound |

Every provider/indexer failure first asks the checkpoint port to preserve the
exact last good observation and mark freshness `STALE` (or `UNAVAILABLE` when
no good observation exists). It emits bounded `PROVIDER_FAILURE` and
`DATA_STALE` alerts. Metrics and alerts cannot change the durable outcome if an
observability adapter itself fails.

Metrics contain only event, network, tier, attempt, and position-count labels.
They exclude account IDs, wallet IDs, wallet addresses, asset balances, source
hashes, provider URLs, credentials, and raw adapter errors. Adapter exception
text is mapped to fixed local error or failure codes.

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
  consumer with a separately split metadata-only secret; the current worker
  task has no such secret or resolver binding;
- an SQS adapter must prove envelope compatibility, visibility behavior,
  redrive/DLQ configuration, duplicate delivery handling, and bounded delay;
  and
- Operations must approve scheduling, monitoring, alert routing, replay
  ownership, and runbooks.

Until those gates close, the durable model is ready to receive validated facts
but cannot obtain them itself. It makes no claim that a live balance has been
indexed or that SQS, RPC, address decryption, or monitoring behavior has been
validated.

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
