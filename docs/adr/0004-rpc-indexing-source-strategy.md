# ADR 0004: Provider-neutral RPC and indexing source strategy

- Status: Proposed; no provider, endpoint, egress, account, plan, trial, or runtime is approved
- Date: 2026-08-22
- Jira: KAN-62
- External approval and live-validation gate: KAN-251
- Exact-host egress gate: KAN-231
- Decision owners: Application architecture, blockchain data, security, privacy, legal, finance,
  and service operations

## Context

The application needs chain observations for balances, transaction confirmation, log indexing,
reconciliation, and ledger evidence. A successful RPC response is not sufficient evidence: it can be
from the wrong network, repeat a stale head, omit history, disagree with another source, or cross a
reorganization boundary.

KAN-61 provides immutable mainnet and testnet asset registries. This decision binds observation policy
version 1 to their exact SHA-256 fingerprints:

- MAINNET: `5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d`
- TESTNET: `89c158de188fcde7d01642aadef226f3c93724bfe5b53a7f3fcce096180d5ca7`

The eight bound CAIP-2 network IDs are `eip155:1`, `eip155:8453`, `eip155:42161`,
`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, `eip155:11155111`, `eip155:84532`,
`eip155:421614`, and `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. A registry-fingerprint or network-set
change requires a new reviewed policy version.

KAN-231 keeps application workloads at `NO_EXTERNAL_EGRESS`. This ADR and the accompanying pure local
policy do not create a provider client, URL, credential, configuration, account, WebSocket, HTTP
request, cloud resource, or paid service.

## Proposed decision

### Keep the runtime provider-neutral and inactive

Use only standard protocol JSON-RPC reads and subscriptions. Alchemy is a **proposed primary candidate**
and QuickNode is a **proposed independent-fallback candidate** in the local research packet. Neither is
selected or approved. No endpoint hostname, plan, credential, SLA, Region, cost, archive boundary, or
failure-domain independence has been accepted. Managed indexing APIs, enhanced vendor namespaces,
webhooks, streams, add-ons, transaction broadcast, and automatic resubmission are out of scope.

The machine-readable research packet is
[`../rpc-indexing/kan-62-provider-decision.json`](../rpc-indexing/kan-62-provider-decision.json). Its
candidate labels are research inputs, not runtime authorization. The executable local invariant is
[`../../apps/api/src/blockchain/domain/chain-observation-policy.ts`](../../apps/api/src/blockchain/domain/chain-observation-policy.ts).

### Require exact network identity before accepting data

Every connection and reconnection must pass its immutable identity probe before any response is
accepted:

| Network                    | Required exact identity                                           |
| -------------------------- | ----------------------------------------------------------------- |
| Ethereum mainnet / Sepolia | `eth_chainId` = `0x1` / `0xaa36a7`                                |
| Base mainnet / Sepolia     | `eth_chainId` = `0x2105` / `0x14a34`                              |
| Arbitrum mainnet / Sepolia | `eth_chainId` = `0xa4b1` / `0x66eee`                              |
| Solana mainnet-beta        | `getGenesisHash` = `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` |
| Solana devnet              | `getGenesisHash` = `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |

For Solana, the CAIP reference is the first 32 base58 characters of the expected full genesis hash.
The connector must compare the full response exactly before deriving that reference; a merely shared
prefix or caller-supplied CAIP value is not identity evidence.

### Allow only the reviewed standard read profile

The EVM HTTP allowlist is `eth_blockNumber`, `eth_call`, `eth_chainId`, `eth_getBalance`,
`eth_getBlockByHash`, `eth_getBlockByNumber`, `eth_getCode`, `eth_getLogs`,
`eth_getTransactionByHash`, and `eth_getTransactionReceipt`. EVM WebSocket use is `eth_subscribe` with
only `logs` and `newHeads`.

The Solana HTTP allowlist is `getAccountInfo`, `getBlock`, `getBlockHeight`, `getGenesisHash`,
`getHealth`, `getLatestBlockhash`, `getMultipleAccounts`, `getSignatureStatuses`,
`getSignaturesForAddress`, `getSlot`, `getTokenAccountBalance`, `getTokenAccountsByOwner`,
`getTransaction`, and `getVersion`. Solana WebSocket use is limited to `accountSubscribe`,
`logsSubscribe`, `programSubscribe`, `rootSubscribe`, `signatureSubscribe`, and `slotSubscribe`.

WebSocket notifications are wake-up and low-latency hints only. They never advance an authoritative
checkpoint by themselves. Disconnect, reconnect, sequence uncertainty, or a detected gap stops
advancement and requires bounded, idempotent HTTP polling/backfill before resuming. HTTP polling,
lineage verification, and finality reconciliation remain authoritative.

EVM multi-read work pins a block number and verifies its hash. Solana reads carry the highest validated
`minContextSlot` where the standard method supports it and reject older contexts. No method in this
profile submits or resubmits a transaction.

### Separate observation tiers and authorization

- `PROVISIONAL` uses EVM `latest` or Solana `processed` and is display-only.
- `CANONICAL` uses EVM `safe` or Solana `confirmed` for indexing only after endpoint-specific live
  capability proof. Ethereum, Base, and Solana are `REQUIRES_LIVE_PROOF`. Arbitrum remains the stronger
  `BLOCKED_PENDING_LIVE_PROOF`; no provider tag semantics are assumed, and accepting its evidence
  requires a reviewed policy revision after KAN-251.
- `FINANCIAL` uses EVM or Solana `finalized` and can affect ledger/reconciliation decisions only after
  all of these are true: provider selection is approved under KAN-251, exact-host egress is approved
  under KAN-231, live capability proof passed, the exact KAN-61 registry binding was validated, and
  independent finalized sources agree. Arbitrum remains blocked until its endpoint-specific canonical
  and finalized semantics pass live proof. The authorization boundary also requires an exact validated
  network identity, `CURRENT` freshness, `HEALTHY` finality progress, validated lineage, and no active
  quarantine.

Provisional and canonical observations never authorize transaction submission or a financial balance.
Testnet success is useful compatibility evidence but is not mainnet availability or SLA evidence.
The continuity helper verifies lineage only: even when asked to compare a `FINANCIAL` checkpoint, it
never authorizes financial use. Every caller must separately pass all five external approval/proof
gates and all five observation-state predicates above.

### Classify freshness from retrieval and head advancement

A response is eligible only after identity validation and basic response validation. Freshness age is
the greater of (a) age since validated retrieval and (b) age since the last non-regressing head
advancement. Retrieving the same head successfully does not refresh the advancement clock. A regressing
head is quarantined. Finality advancement has a separate stall gate so a moving provisional head cannot
hide stalled finality. Finality classification on every chain also requires endpoint-specific live
capability proof; Arbitrum's static tier block remains in addition to that classifier gate.

| Chain family | Current through | Stale through | Unavailable above |                                  Finality stalled above |
| ------------ | --------------: | ------------: | ----------------: | ------------------------------------------------------: |
| Ethereum     |            60 s |        15 min |            15 min |                                                  30 min |
| Base         |            30 s |         5 min |             5 min |                                                  45 min |
| Arbitrum     |            30 s |         5 min |             5 min | 45 min; canonical/final also blocked pending live proof |
| Solana       |            15 s |         2 min |             2 min |                                                    90 s |

Threshold equality stays in the lower-severity state: for example, 60 seconds is current for Ethereum
and a finality clock becomes stalled only after its stated limit. A stale observation may be visibly
labelled for an approved non-financial use; unavailable or quarantined observations fail closed.

### Recover boundedly and never rewrite finalized facts

Persist position/slot, block hash, parent hash or parent slot, observation tier, and source checkpoint.
A direct child with the expected parent is appendable. A height/slot gap triggers bounded continuity
verification from the last finalized checkpoint. A provisional mismatch rolls back only provisional
facts to the last finalized common ancestor and performs idempotent replay. Unknown ancestry, finalized
regression, or equal finalized positions with different hashes is quarantined for human review.
Finalized facts are never mutated by automated recovery. Canonical and financial continuity evaluation
requires validated endpoint capability proof; a false or missing proof fails closed. Finalized source
agreement also binds both checkpoints to the same exact supported CAIP-2 network ID. Equal positions and
hashes from different chains are not agreement.

One recovery job may read at most 2,048 units; reaching the bound records a continuation rather than
skipping history. Solana recovery starts from a validated root. EVM log removal or hash divergence and
Solana non-rooted fork/signature-status divergence invoke the same provisional-only recovery rule.

### Bound outages, retries, and fallback

Reads use a 2-second connect timeout, 5-second request timeout, at most three attempts, exponential
full jitter, and retries only for allowlisted idempotent operations. Five consecutive failures open a
60-second circuit; half-open permits one probe.

The current state has no automatic production fallback. A future fallback is usable only when the
primary circuit is open and the exact alternate is approved, failure-domain independent,
identity-validated, and compatible at the finalized checkpoint. Otherwise retain the last good
observation and fail closed.
Provider status pages are informational, not chain truth. Missing or failed data never becomes a zero
balance, never causes transaction submission, and never causes automatic resubmission.

## Required external work

KAN-251 is the separately owned **external approval and live-validation** subtask. Before naming an
approved primary or fallback it must record:

1. independent architecture, blockchain-data, security, privacy, legal, finance, and operations
   decisions, including provider-contract, processor/subprocessor, payload logging, retention,
   residency, deletion, incident-response, support, and exit terms;
2. an approved account, plan, billing cap, monthly low/expected/stress forecast, taxes/overages/support,
   signed SLA and exclusions, exact Regions, exact endpoint hostnames, and opaque credential references;
3. separately authorized non-production live evidence for all eight networks and both candidates:
   exact identity, complete HTTP/WSS method parity, `safe`/`finalized` or Solana commitment semantics,
   archive start/depth and bounded historical replay, rate limits, latency, response limits, reconnect
   gaps, skipped slots, reorgs, finality stalls, provider outage, primary/fallback skew, circuit/failover,
   and failback without duplicates or missing data; and
4. demonstrated provider/cloud/DNS/network/upstream independence, redacted logs, bounded evidence
   retention, kill switches, cleanup, and measured cost. Any failed or undocumented item stays blocked.

KAN-231 then reviews only the exact approved host/caller/protocol egress paths, TLS/DNS policy,
deny-by-default enforcement, credential path, kill switch, and current KAN-229 cost-control binding. It
cannot substitute for KAN-251's provider, commercial, privacy, or chain-semantics approval.

No account creation, trial, plan, payment method, endpoint, key, DNS/TLS connection, RPC request,
WebSocket, cloud resource, or live failover is authorized by this ADR. Those steps may occur only in the
approved external subtasks and cost-bounded window. Until both gates pass, provider names remain
proposed candidates and every runtime approval input remains false.

## Consequences

The repository gains a deterministic, deeply frozen policy and pure classification functions that can
be tested without network access or cost. The design favors an explicitly stale or unavailable result
over plausible but unverified data. It also creates operational work: connectors must persist lineage,
backfill gaps, reconcile independent finalized checkpoints, surface quarantine, and preserve exact
approval evidence before activation.

The thresholds are conservative local safety defaults, not measured provider SLAs. KAN-251 may propose
changes after live evidence, but any change requires a new reviewed policy version and updated tests.

## Protocol references

- [Ethereum JSON-RPC methods and finality tags](https://ethereum.org/developers/docs/apis/json-rpc/)
- [Ethereum proof-of-stake finality](https://ethereum.org/developers/docs/consensus-mechanisms/pos/)
- [Base RPC overview](https://docs.base.org/base-chain/api-reference/rpc-overview)
- [Base transaction finality](https://docs.base.org/base-chain/network-information/transaction-finality)
- [Arbitrum chain information](https://docs.arbitrum.io/for-devs/dev-tools-and-resources/chain-info)
- [Solana HTTP and WebSocket RPC](https://solana.com/docs/rpc)
- [Solana `getGenesisHash`](https://solana.com/docs/rpc/http/getgenesishash)
