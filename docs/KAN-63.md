# KAN-63: Provider-neutral EVM stablecoin balance indexer

Status: `LOCAL_CONTRACT_COMPLETE` / `LIVE_PROVIDER_EVIDENCE_NOT_RUN_PENDING_AUTHORIZATION`

KAN-63 now has a local, provider-neutral indexer contract for allowlisted ERC-20
stablecoin balances on the KAN-61 Ethereum, Base, and Arbitrum mainnets and
testnets. The implementation uses only injected reader, retry-scheduler, and
position-store ports. It does not create or configure a provider client,
endpoint, account, API key, WebSocket, database table, cloud resource, or
network path.

The implementation is intentionally not registered in `BlockchainModule`.
There is no approved concrete RPC or persistence adapter to inject. KAN-251
must approve and prove a provider, and KAN-231 must separately approve exact
host egress, before runtime wiring or live-chain acceptance can begin.

## Local indexing contract

One index operation follows this closed sequence:

1. Validate the explicit `MAINNET` or `TESTNET` environment and exact CAIP-2
   network against the active KAN-61 registry and KAN-62 observation policy.
2. Normalize a non-zero EVM wallet address and resolve either all active
   stablecoin contracts for that network or an explicit allowlisted subset.
3. Ask the injected connector for the standard `eth_chainId` identity and
   compare it to the immutable expected result. A provider response cannot
   label its own trusted network.
4. Resolve one `latest` source block with exact integer height, block hash, and
   parent hash. This local slice produces only `PROVISIONAL` / `DISPLAY_ONLY`
   observations.
5. Read contracts in sequential bounded batches. Every injected balance call
   receives the same wallet, source height, and source hash; every normalized
   response must echo that source identity and return exactly one result for
   each requested contract.
6. Preserve each ERC-20 balance as a canonical unsigned decimal string bounded
   to `uint256`. Floating point, exponent notation, signs, leading zeroes, and
   numeric JavaScript values are rejected.
7. Build deterministic position, observation, and snapshot IDs, then call the
   atomic snapshot upsert port once, after every batch has validated.

The concrete reader boundary is limited to normalized equivalents of standard
`eth_chainId`, `eth_getBlockByNumber`, and batched `eth_call` reads. No provider
SDK or proprietary enhanced method is imported. Batch size is configurable
from 1 through 100 and defaults to 50.

## Allowlist and zero-balance behavior

Contract selection is derived only from the latest active KAN-61 registry
snapshot. Mixed-case inputs are normalized before lookup. A malformed,
wrong-network, inactive, unknown, or duplicate contract rejects the entire job
before the connector or store is called.

An explicit on-chain zero is retained as `balanceAtomic: "0"`. That is distinct
from a missing, partial, failed, or malformed read: those cases reject the
snapshot and do not call the position store. This preserves the KAN-62 rule
that an unavailable balance must never replace the last good observation with
zero.

The position-store port requires an atomic upsert by deterministic IDs. A
same-block replay is `UNCHANGED`; a later source block replaces the wallet's
current snapshot; neither path appends duplicate current positions. A concrete
database schema and adapter remain outside this local-only slice and require a
separate reviewed persistence decision.

## Retry and rate-limit behavior

Only typed `RATE_LIMITED`, `TIMEOUT`, and `TEMPORARY_UNAVAILABLE` read failures
are retryable. Permanent and unknown failures are not retried. The maximum is
three attempts, inherited from `CHAIN_OBSERVATION_RESILIENCE_POLICY` and not
configurable above that bound.

Retries use bounded exponential full-jitter inputs through an injected
scheduler, so tests use neither wall-clock sleeps nor randomness. A normalized
`Retry-After` value is honored when it is greater than the jitter delay. A hint
above the configured maximum (5 seconds by default, never more than 60
seconds) fails closed instead of sleeping indefinitely or retrying early.
Malformed jitter, timer failure, exhaustion, and store failure all become
fixed local error codes. Writes are never automatically retried by this
indexer.

## Deterministic fixture evidence

[`evm-stablecoin-balances.fixture.ts`](../apps/api/test/fixtures/evm-stablecoin-balances.fixture.ts)
is explicitly marked `DETERMINISTIC_NORMALIZED_ADAPTER_FIXTURE` and
`NOT_RUN_PENDING_AUTHORIZATION`. Its injected Ethereum reader records block
`20765432`, a block hash and parent hash, and these exact atomic values:

| Stablecoin | Allowlisted contract                         | Atomic balance     |
| ---------- | -------------------------------------------- | ------------------ |
| PYUSD      | `0x6c3ea9036406852006290770bedfcaba0e23a0e8` | `987654321`        |
| USDC       | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | `1234567890123456` |
| USDT       | `0xdac17f958d2ee523a2206206994597c13d831ec7` | `0`                |

The focused test proves that the normalized reads and indexed positions match
these fixture values exactly at the recorded fixture block. It also proves
batching, an allowlisted subset, explicit zero handling, same-block replay,
later-block replacement, bounded rate-limit retry, and one store call only
after a complete snapshot.

Adversarial cases cover all six configured EVM networks, cross-environment and
Solana rejection, wrong chain identity, invalid source lineage, missing,
duplicate, unexpected, wrong-block, and non-integer balance results, exhausted
or unbounded retries, scheduler failures, and failed or invalid store results.

This evidence validates deterministic core behavior only. It does **not**
claim that block `20765432` or any fixture balance was observed from a live
chain or agrees with a provider at that height.

## External acceptance gates

Live-provider acceptance remains blocked by both independent controls:

- **KAN-251** must approve an exact account, plan, billing cap, secret
  reference, methods, archive depth, identity response, block/tag semantics,
  rate limits, batching behavior, logs, retention, and measured cost for every
  required EVM network.
- **KAN-231** must separately approve exact provider hostnames and bind the
  caller, DNS, TLS, kill switch, and deny-by-default egress policy.

After both approvals, a reviewed adapter must use standard read-only RPC to
compare deterministic fixture expectations with actual chain results at a
retained block. Base and Arbitrum also require the live finality and L1-origin
proofs described by KAN-62. Until then, no KAN-63 result may authorize a ledger
post, transfer, route, collateral decision, or other financial action.

## Zero-call/no-cost evidence

| Action                              | Count/value                     |
| ----------------------------------- | ------------------------------- |
| New runtime dependencies installed  | 0                               |
| Package or lock files changed       | 0                               |
| Provider accounts/trials created    | 0                               |
| Provider endpoints/API keys created | 0                               |
| RPC/HTTP/WSS requests sent          | 0                               |
| Database migrations executed        | 0                               |
| Cloud resources created             | 0                               |
| Cost incurred                       | USD `0.00`                      |
| Live chain evidence                 | `NOT_RUN_PENDING_AUTHORIZATION` |

## Local review commands

```powershell
npm test --workspace @crypto-lending/api -- --runInBand src/blockchain/domain/evm-stablecoin-position.spec.ts src/blockchain/application/evm-stablecoin-balance-indexer.spec.ts
npm test --workspace @crypto-lending/api -- --runInBand
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm run format:check
npm run security:scan:secrets
git diff --check
```
