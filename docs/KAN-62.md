# KAN-62: RPC and indexing provider decision packet

Status: `READY_FOR_INDEPENDENT_REVIEW` / `PENDING_EXTERNAL_APPROVAL`

This packet proposes **Alchemy as the primary** and **QuickNode as an
independent fallback** for the provider-neutral indexer defined by KAN-61. The
proposal covers only standard read-only HTTPS JSON-RPC and standard WebSocket
subscriptions on Ethereum, Base, Arbitrum, and Solana mainnets and testnets.

That eight-network packet is preserved as provider research, not current
release scope. The active production decision is limited to Ethereum and
Solana. Base and Arbitrum are deferred; their rows and any future test results
cannot satisfy an active launch provider, network, fallback, or evidence count.

This is not a provider, commercial, security, privacy, finance, runtime, or
egress approval. No provider plan, account, endpoint hostname, API key, secret
reference, Region, SLA, cost, or destination is approved. No account was
created, no trial was started, no provider connection was opened, and no RPC
request was made. The current runtime and KAN-231 egress posture remain
disabled and deny-by-default.

The reviewable machine record is
[`rpc-indexing/kan-62-provider-decision.json`](rpc-indexing/kan-62-provider-decision.json).
Its content hash is recorded in
[`rpc-indexing/kan-62-provider-decision.sha256`](rpc-indexing/kan-62-provider-decision.sha256).

## Proposed decision

| Role                 | Candidate | Local decision | Permitted proposal surface                                                                                                                                                                  |
| -------------------- | --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary              | Alchemy   | `PROPOSED`     | Standard read-only Ethereum or Solana JSON-RPC over HTTPS; standard subscriptions over WSS; standard RPC historical backfill                                                                |
| Independent fallback | QuickNode | `PROPOSED`     | The same provider-neutral protocol contract, subject to independently proven method, history, finality, rate-limit, failure-domain, and cost parity                                         |
| Managed data plane   | None      | Not approved   | Alchemy Data APIs, Notify, Smart WebSockets, Flashblocks, Solana account-archive extensions, Yellowstone gRPC, QuickNode Streams, Webhooks, Functions, and add-ons are out of runtime scope |
| Write path           | None      | Not approved   | Transaction broadcast, private relay behavior, retries, replacement, or automatic resubmission                                                                                              |

Alchemy is the proposed primary because its current official pages document
all eight policy networks, HTTPS and WSS, a general full-archive plan claim,
and a compute-unit model that can be evaluated without adopting a proprietary
indexer. QuickNode is proposed as the fallback because its official chain pages
independently document the same eight policy networks and standard transports, with
explicit archive/pruning disclosures. This is a paper comparison only; neither
candidate has passed the live or commercial gate.

Provider independence is also only proposed. Different vendor names do not
prove independent cloud, DNS, network, or upstream-node failure domains. KAN-251
must obtain and test that evidence.

## Broader KAN-61 research scope

The historical proposal is closed to these eight CAIP-2 identifiers. Only the
Ethereum and Solana mainnet/testnet pairs are active acceptance targets for the
current release. An endpoint response
cannot label its own trusted network: each connector must compare `eth_chainId`
or the full `getGenesisHash` result with the immutable expected value before
accepting data. An EVM hex chain ID is converted to the decimal CAIP reference;
a Solana CAIP reference is the first 32 base58 characters of the full genesis
hash, not the complete RPC return value.

| Environment | Network ID                                | Provider network name | Identity proof                    | Archive observation                                                                                    |
| ----------- | ----------------------------------------- | --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Mainnet     | `eip155:1`                                | Ethereum Mainnet      | `eth_chainId == 0x1`              | Alchemy makes a general full-archive plan claim; QuickNode says archive yes/no pruning; live proof due |
| Mainnet     | `eip155:8453`                             | Base Mainnet          | `eth_chainId == 0x2105`           | Alchemy makes a general full-archive plan claim; QuickNode says archive yes/no pruning; live proof due |
| Mainnet     | `eip155:42161`                            | Arbitrum Mainnet      | `eth_chainId == 0xa4b1`           | Alchemy makes a general full-archive plan claim; QuickNode says archive yes/no pruning; live proof due |
| Mainnet     | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | Solana Mainnet-beta   | full hash; CAIP is 32-char prefix | Alchemy makes a general full-archive plan claim; QuickNode says archive yes/no pruning; live proof due |
| Testnet     | `eip155:11155111`                         | Ethereum Sepolia      | `eth_chainId == 0xaa36a7`         | Both advertise archive access; testnet history and availability are not production SLA evidence        |
| Testnet     | `eip155:84532`                            | Base Sepolia          | `eth_chainId == 0x14a34`          | Both advertise archive access; testnet history and availability are not production SLA evidence        |
| Testnet     | `eip155:421614`                           | Arbitrum Sepolia      | `eth_chainId == 0x66eee`          | Both advertise archive access; testnet history and availability are not production SLA evidence        |
| Testnet     | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | Solana Devnet         | full hash; CAIP is 32-char prefix | Alchemy advertises archive generally; QuickNode explicitly says no archive and 6,578,505-slot pruning  |

The full expected Solana identities are
`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` for mainnet-beta and
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` for Devnet. Solana's official
[`getGenesisHash` reference](https://solana.com/docs/rpc/http/getgenesishash)
defines the full base58 RPC result; the known full values are pinned in the
official archived
[`genesis_config.rs`](https://github.com/solana-labs/solana/blob/master/sdk/src/genesis_config.rs).
The [Solana CAIP-2 namespace](https://namespaces.chainagnostic.org/solana/caip2)
defines the first-32-character derivation and publishes both KAN-61 references.
KAN-251 must prove both providers return the exact full value before activation.

QuickNode's Devnet limit means full historical parity is not documented. A
fallback must fail closed when a requested slot predates its retained window;
it must not silently turn an incomplete backfill into a complete result.

## Provider-neutral RPC contract

Both transports are required candidates, but they have different authority:

- WSS is a low-latency hint only. A subscription event never advances
  financial state by itself.
- Bounded HTTPS polling and replay are authoritative for gap recovery,
  lineage, identity, and finality reconciliation.
- After every WSS disconnect or provider switch, indexing stops advancing,
  reconnects with bounded exponential backoff and jitter, performs an
  idempotent HTTPS backfill from the durable checkpoint, and only then resumes.
- Unsupported, proprietary, inconsistent, or unknown capability results fail
  closed. The connector never substitutes an enhanced vendor method.
- This read-only decision includes no transaction submission and no automatic
  retry or resubmission of transactions.

The EVM standard-read profile requires HTTPS methods `eth_blockNumber`,
`eth_call`, `eth_chainId`, `eth_getBalance`, `eth_getBlockByHash`,
`eth_getBlockByNumber`, `eth_getCode`, `eth_getLogs`,
`eth_getTransactionByHash`, and `eth_getTransactionReceipt`; WSS must support
the standard `newHeads` and `logs` subscriptions.

The Solana standard-read profile requires HTTPS methods `getAccountInfo`,
`getBlock`, `getBlockHeight`, `getGenesisHash`, `getHealth`,
`getLatestBlockhash`, `getMultipleAccounts`, `getSignatureStatuses`,
`getSignaturesForAddress`, `getSlot`, `getTokenAccountBalance`,
`getTokenAccountsByOwner`, `getTransaction`, and `getVersion`; WSS must support
`accountSubscribe`, `logsSubscribe`, `programSubscribe`, `rootSubscribe`,
`signatureSubscribe`, and `slotSubscribe`.

Namespaces beginning with `alchemy_`, `qn_`, `trace_`, `debug_`, `arbtrace_`,
or `metis_` are excluded. A later method change requires a new reviewed packet,
not an adapter-side exception.

## Freshness, finality, and reorg policy

The thresholds are conservative local review inputs, not provider guarantees.
They classify an observation as current, stale, or unavailable and detect a
stalled finality signal. KAN-251 must exercise them against both candidates.

| Chain    | Current head age | Stale through | Unavailable after | Finality stall | Proposed tier mapping                                                                                                             |
| -------- | ---------------- | ------------- | ----------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Ethereum | at most 60 s     | 15 min        | 15 min            | 30 min         | `latest` provisional/display; `safe` canonical pending live proof; `finalized` financial pending approval/agreement               |
| Base     | at most 30 s     | 5 min         | 5 min             | 45 min         | sequencer/latest provisional; `safe` canonical pending proof; `finalized` plus L1 settlement financial pending approval/agreement |
| Arbitrum | at most 30 s     | 5 min         | 5 min             | 45 min         | sequencer/latest provisional; canonical and financial both `BLOCKED_PENDING_LIVE_PROOF`                                           |
| Solana   | at most 15 s     | 2 min         | 2 min             | 90 s           | `processed` provisional/display; `confirmed` canonical pending live proof; `finalized` financial pending approval/agreement       |

The three tiers are deliberately distinct:

- `PROVISIONAL` may drive diagnostics or a display explicitly labeled as
  provisional. It cannot post to the ledger or make a value decision.
- `CANONICAL` requires the chain-specific safe/confirmed signal plus matching
  hash/parent or slot lineage. Provider behavior is not yet proven.
- `FINANCIAL` requires the finalized signal, an independently agreeing
  provider result, and every downstream business approval. KAN-62 does not
  grant that approval.

For EVM chains, each observation retains height, block hash, and parent hash;
for Base and Arbitrum it also retains the L1 origin when a standard response
exposes it. `removed: true` logs or a hash divergence trigger rollback to the
common ancestor followed by idempotent replay. For Solana, each observation
retains slot, parent slot, commitment, and root checkpoint; non-rooted forks or
signature-status divergence drop provisional slots and replay from the root.
If a common ancestor/checkpoint cannot be established within the locally
retained window, the indexer fails closed and requests operator review.

Arbitrum stays more restrictive because this paper review does not establish
how each candidate maps Nitro sequencer state, L1 batch finality, and standard
`safe`/`finalized` tags. Base also requires live tag and L1-settlement proof,
despite its official documentation describing four increasing finality stages.

## Outage and fallback policy

The provider status pages are operational hints, not canonical-chain oracles.
An HTTP timeout, 429, 5xx, WSS disconnect, stale head, stalled finality signal,
chain-identity mismatch, history gap, or divergent lineage opens a circuit for
that provider/network. Only idempotent reads receive bounded retry with jitter.

QuickNode failover is not automatically active. KAN-251 must demonstrate the
same standard methods, commitment/tag semantics, archive window, ordering,
rate-limit handling, and cross-provider head skew. KAN-231 must then approve the
exact fallback hostname and network control separately. Any switch must verify
network identity before data is accepted, replay the gap over HTTPS, deduplicate
by immutable chain identity, and keep financial advancement blocked until the
independent finality result agrees. Failback follows the same process.

No provider is allowed to resubmit, route, replace, or retry a transaction for
this indexer. Official pages that describe MEV protection, private relays,
multi-region broadcast, or transaction landing are irrelevant to this read
contract and confer no approval.

## Official provider evidence as of 2026-08-22

These links are review provenance, not runtime dependencies. No page was used
as an endpoint and no provider API was called.

| Topic                   | Alchemy current official evidence                                                                                                                                                                                                                                                                                                                                                                                       | QuickNode current official evidence                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eight-network support   | [Chain API supported chains](https://www.alchemy.com/docs/reference/node-supported-chains) lists the required mainnets/testnets; the [feature matrix](https://www.alchemy.com/docs/reference/feature-support-by-chain) warns that features vary by chain                                                                                                                                                                | Chain pages document [Ethereum](https://www.quicknode.com/docs/ethereum), [Base](https://www.quicknode.com/docs/base), [Arbitrum](https://www.quicknode.com/docs/arbitrum), and [Solana](https://www.quicknode.com/docs/solana) main/test networks                                                                                                                      |
| HTTPS/WSS               | Chain pages publish private HTTPS/WSS for [Ethereum](https://www.alchemy.com/rpc/ethereum), [Base](https://www.alchemy.com/rpc/base), [Arbitrum](https://www.alchemy.com/rpc/arbitrum), and [Solana](https://www.alchemy.com/rpc/solana); subscription docs cover [EVM](https://www.alchemy.com/docs/reference/subscription-api) and [Solana](https://www.alchemy.com/docs/reference/solana-subscription-api-endpoints) | The four chain pages above say HTTP and WSS are available on every required network                                                                                                                                                                                                                                                                                     |
| Archive/indexing        | [Pricing-plan docs](https://www.alchemy.com/docs/reference/pricing-plans) mark full archive on all plans; chain pages advertise archive data. Network/method depth is not specified enough for approval. [Managed Data APIs](https://www.alchemy.com/docs/data) and the [Solana account archive extension](https://www.alchemy.com/docs/solana/account-archive) are excluded                                            | The [archive/pruning matrix](https://www.quicknode.com/docs/platform/supported-chains-node-types) says archive/no pruning for the required EVM networks and Solana mainnet, but no archive and 6,578,505-slot pruning for Devnet. Streams, Functions, Webhooks, and add-ons are excluded                                                                                |
| Metering/rate limit     | [Pricing](https://www.alchemy.com/pricing) advertises Free 30M CU/month, 500 CU/s (about 25 RPS), five apps; PAYG 10,000 CU/s (about 300 RPS), $0.45/M CU through 300M then $0.40/M. [Method/WS CU costs](https://www.alchemy.com/docs/reference/compute-unit-costs) and [rolling throughput](https://www.alchemy.com/docs/reference/throughput) apply                                                                  | [Pricing](https://www.quicknode.com/pricing) advertises a one-month $0 Free trial with 10M credits, 15 RPS, no overage/no card. Build advertises $34/month billed annually or $49 monthly, 80M credits, 50 RPS, an effective included rate of $0.43/M, and $0.62/M additional credits. [Credit multipliers](https://www.quicknode.com/api-credits) vary by chain/method |
| SLA/support             | [Pricing-plan docs](https://www.alchemy.com/docs/reference/pricing-plans) put custom SLAs in Enterprise only. [Legal terms](https://legal.alchemy.com/) publish a 99.9% service-commitment form only when service levels are bought in an Order Form; test/staging, underlying-chain, internet/third-party, and maintenance exclusions apply                                                                            | Standard paid plans list support response targets, not uptime. [Enterprise](https://www.quicknode.com/enterprise) advertises order-specific 99.99% uptime and service credits. [Terms](https://www.quicknode.com/terms) otherwise disclaim uninterrupted availability and allow rate limits                                                                             |
| Geography/failover      | The [Cortex Router article](https://www.alchemy.com/blog/cortex-router-fastest-healthy-node) describes nearest healthy edge/node and whole-region rerouting for shared traffic; this is a product claim, not a selected Region or SLA. Exact residency is not documented publicly enough for approval                                                                                                                   | The [server-location article](https://support.quicknode.com/articles/5948433326-where-are-quicknode-servers-located) says source-IP geolocation and dynamic DNS select a nearest edge on a changing multi-provider global network; exact node locations are not disclosed                                                                                               |
| Outage visibility       | [Status page](https://status.alchemy.com/) publishes chain/regional components and email, SMS, Slack, webhook, RSS, and Atom subscriptions                                                                                                                                                                                                                                                                              | [Status page](https://status.quicknode.com/) publishes component incidents and email/SMS subscriptions                                                                                                                                                                                                                                                                  |
| Security/logs/retention | [Security](https://www.alchemy.com/security) states TLS, DDoS controls, and third-party testing; detailed Trust Center evidence is gated. [Request Logs](https://www.alchemy.com/docs/alchemy-request-logs) expose request payload/response details for up to 10 days                                                                                                                                                   | [Security](https://www.quicknode.com/security) claims SOC 1 Type 2, SOC 2 Type 2, ISO 27001, AES-256 at rest, TLS in transit, DDoS controls, testing, redundancy, and BCP/DR. [Privacy](https://www.quicknode.com/privacy) generally retains personal information seven years; exact RPC payload terms remain unknown                                                   |

Official protocol semantics used to keep the adapter provider-neutral are the
[Ethereum JSON-RPC tags and methods](https://ethereum.org/developers/docs/apis/json-rpc/),
[Base finality stages](https://docs.base.org/base-chain/network-information/transaction-finality),
[Arbitrum finality and indexer reorg guidance](https://docs.arbitrum.io/how-arbitrum-works/reference/finality-and-reorgs),
and [Solana RPC commitments and transports](https://solana.com/docs/rpc).

## Commercial and legal ambiguities

Published figures are volatile research inputs. They expire after 30 days for
this decision process and must be rechecked before any approval.

- Alchemy's pricing documentation lists both 500 and 1,000 Free CUPS in
  different sections. Its throughput page describes an account-level rolling
  bucket while the pricing guide describes reserved throughput per app.
- Neither Alchemy estimate includes our measured method mix, WSS response
  bytes, archive depth, retry volume, or backfill burst behavior.
- QuickNode's $0 trial lasts one month; it is not a permanent production tier.
  The discounted Build headline, monthly checkout price, additional-credit
  rate, and overage controls require an approved account/quote to confirm.
- No signed uptime SLA, service-credit formula, support escalation, outage
  exclusion, renewal, termination, tax, egress/bandwidth, add-on, or currency
  term has been approved for either candidate.
- Provider marketing does not prove geographic residency, subprocessor scope,
  deletion, RPC-payload classification, sanctions eligibility, or independent
  failure domains. Security, Privacy, and Legal must review the live terms and
  gated evidence.

The packet deliberately has `null` approved plan, Region, SLA, and cost fields.
Published prices must never be copied into runtime or billing controls as if
they were an authorization.

## External gates

KAN-251 is the provider approval and live-validation gate. It must obtain
independent Architecture, Security, Privacy, Legal, Finance, and Operations
decisions; approve an account/plan and billing caps; record exact endpoint
hostnames and secret references; and exercise every active Ethereum and Solana
network/method/transport,
identity check, historical range, finality tier, reorg, WSS gap, outage,
fallback, failback, rate limit, measured cost, log-redaction, retention, and
incident path. KAN-251 does **not** authorize network egress.

KAN-231 is the separate exact-host egress gate. It may consume only exact
hostnames approved and evidenced by KAN-251, then bind callers/protocols, DNS,
TLS, deny-by-default controls, the kill switch, and current KAN-229 cost
controls. KAN-231 cannot approve provider semantics or commercial terms, and
KAN-251 cannot approve egress. Both must pass before any connection or runtime
failover can be enabled.

The unresolved live questions include method/commitment/tag parity, WSS limits,
archive start points, Solana Devnet history, provider head skew, log ordering,
Base/Arbitrum L1 semantics, residence/subprocessors/deletion, signed SLA terms,
measured monthly cost, and real failure-domain independence. Until those are
resolved, the correct operational state is `NO_EXTERNAL_EGRESS` and
`NOT_APPROVED`.

## Zero-call/no-cost evidence

This work consisted of official-document review and local file authoring only:

| Action                              | Count/value                     |
| ----------------------------------- | ------------------------------- |
| Provider accounts created           | 0                               |
| Trials or paid services started     | 0                               |
| Payment methods added               | 0                               |
| Provider endpoints/API keys created | 0                               |
| RPC requests sent                   | 0                               |
| WebSocket connections opened        | 0                               |
| Cloud resources created             | 0                               |
| Cost incurred                       | USD `0.00`                      |
| Live evidence                       | `NOT_RUN_PENDING_AUTHORIZATION` |

No local test in this slice performs DNS resolution, HTTP, WSS, cloud, billing,
or provider calls. The SHA-256 sidecar proves only the reviewed local JSON
bytes; it does not approve their contents or prove an external claim.

## Review checks

```powershell
npm run infra:validate:providers
npm run infra:test:providers
npm --workspace apps/api test -- --runInBand src/blockchain/domain/chain-observation-policy.spec.ts
npm --workspace apps/api run typecheck
npm run format:check
git diff --check
```
