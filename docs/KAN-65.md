# KAN-65: Local balance-sync orchestration and correctness recovery

Status: `LOCAL_CONTRACT_COMPLETE` / `RUNTIME_INTEGRATION_BLOCKED`

KAN-65 implements the provider-neutral, local-only orchestration contract for
IDX-005. It accepts a deterministic SQS-envelope-shaped job, reads one wallet
and chain through an injected indexer port, validates the candidate against the
closed KAN-61 asset registry and KAN-62 chain-observation policy, and asks an
injected checkpoint port to atomically update the current observation.

This work does not register a Nest module or concrete adapter. It does not open
a queue, database, RPC, provider, timer, cloud, or network connection. No
provider account, plan, trial, endpoint, API key, AWS resource, or billable
service was created or used.

## Local contract

The orchestration boundary has five injected ports:

- `BalanceSyncIndexerPort` reads a current candidate or performs a bounded
  replay from a finalized checkpoint;
- `BalanceSyncCheckpointPort` loads and atomically upserts, replaces, or marks
  a wallet/chain checkpoint stale using an expected revision;
- `BalanceSyncJobPort` records a retry or dead-letter decision using the typed
  job envelope;
- `BalanceSyncClockPort` supplies trusted deterministic evaluation time; and
- `BalanceSyncMetricsPort` receives bounded event and alert labels only.

Concrete adapters are intentionally absent. Deterministic tests provide
in-memory implementations of these ports and perform no I/O.

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

## Confirmation, freshness, and finality gates

The orchestrator consumes the KAN-62 network policy rather than inventing new
thresholds. Locally, only `PROVISIONAL` observations are executable:

| Chain family | Local selector | Current threshold | Unavailable after |
| ------------ | -------------- | ----------------- | ----------------- |
| Ethereum     | `latest`       | 60 seconds        | 15 minutes        |
| Base         | `latest`       | 30 seconds        | 5 minutes         |
| Arbitrum     | `latest`       | 30 seconds        | 5 minutes         |
| Solana       | `processed`    | 15 seconds        | 2 minutes         |

The table preserves the broader local observation-policy contract. Current
production launch orchestration is restricted to Ethereum and Solana. Base and
Arbitrum observations remain deferred and cannot be started, counted, or used
as fallback evidence for this release.

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

- KAN-63 and KAN-64 must supply reviewed provider-neutral EVM and Solana
  indexer adapters with their own deterministic and live acceptance evidence;
- KAN-62/KAN-251 must approve and prove provider capabilities, network
  identity, archive depth, finality semantics, failure behavior, rate limits,
  commercial terms, and cost controls;
- KAN-231 must separately approve exact-host egress and its kill switch;
- a durable database adapter must prove revision conflicts, one-current-row
  uniqueness, finalized immutability, stale preservation, and atomic
  provisional replacement;
- an SQS adapter must prove envelope compatibility, visibility behavior,
  redrive/DLQ configuration, duplicate delivery handling, and bounded delay;
  and
- Operations must approve scheduling, monitoring, alert routing, replay
  ownership, and runbooks.

Until those gates close, this package remains an unregistered local contract
with deterministic fakes. It makes no claim that a live balance has been
indexed or that SQS, RPC, database, or monitoring behavior has been validated.

## Local verification

All commands below are filesystem- and process-local. They make no RPC,
provider, queue, database, cloud, or Jira request.

```powershell
npm test --workspace @crypto-lending/api -- src/blockchain-sync
npm run test --workspace @crypto-lending/api
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm run format:check
npm run security:scan:secrets
git diff --check
```
