# Smart lending allocation policy

The fee-aware allocation domain recommends where an existing Ethereum or
Solana position could be lent. It defines the production replacement for a
fixed 60/40 demo heuristic: a deterministic comparison of conservative,
holding-period returns after the complete expected route lifecycle. It is
deliberately chain-native-first: a cross-chain candidate must beat the best
eligible same-chain candidate by the configured minimum, not merely advertise
a higher gross APY.

The policy accepts only the active mainnet launch networks:

- Ethereum: `eip155:1`
- Solana: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`

## Calculation

Every USD amount is an integer mantissa at
`FEE_AWARE_ALLOCATION_USD_SCALE`, which is bound to the portfolio's fixed
`PORTFOLIO_USD_SCALE` of 18 (`USD = mantissa / 10^18`). Calculations therefore
use the same lossless production scale as portfolio and buying-power values,
without floating-point arithmetic or conversion to cents. Every candidate must
provide every cost category at that scale. A zero is explicit; omission rejects
the quote.

| Phase            | Required lifecycle costs                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry            | Source-network fee, source swap, entry bridge, destination-network fee, destination swap, provider entry fee, platform routing fee, and risk buffer |
| Anticipated exit | Provider exit fee, destination-network fee, destination swap, exit bridge, and source-network fee                                                   |

For a requested holding horizon, the calculation is:

```text
entry cost mantissa = sum(all entry category mantissas)
anticipated exit cost mantissa = sum(all exit category mantissas)
total lifecycle cost mantissa = entry cost + anticipated exit cost
deployed principal mantissa = source principal mantissa - entry cost mantissa
conservative APY bps = max(0, gross APY bps - recurring fee bps - risk penalty bps)
projected conservative yield mantissa = floor(
  deployed principal mantissa * conservative APY bps * holding days / (10,000 * 365)
)
net benefit mantissa = projected conservative yield mantissa - total lifecycle cost mantissa
```

The recommendation reports the break-even holding period as well as gross and
conservative projected yield. A candidate is rejected when lifecycle costs
consume the principal, its net benefit is not positive, or it misses the
request's `minimumNetBenefitUsdMantissa` floor.

## Evidence and policy gates

Quotes, opportunity evidence, and approved risk assessments have independent
observation and expiry timestamps. They are rejected when future-dated,
expired, or at least as old as the configured maximum age. A runtime boundary
must supply the trusted server time and construct inputs from authenticated,
normalizing adapters; reference IDs alone are not proof of authenticity.

A cross-chain candidate additionally requires all of the following:

- active, unexpired consent scoped to considering cross-chain recommendations;
- entry and anticipated-exit estimates whose independently selected bridge
  providers are both allowlisted;
- total lifecycle cost at or below `maximumLifecycleCostUsdMantissa`;
- an eligible same-chain baseline for the same source position; and
- net improvement over that baseline at or above
  `minimumNetImprovementUsdMantissa`.

Consent permits the policy to _consider_ a route only. It does not approve a
financial action, wallet signature, allowance, bridge transfer, or lending
transaction.

Top-level exposure policy also caps the aggregate principal selected for
cross-chain routes with `maximumCrossChainPrincipalUsdMantissa` and for any
single provider with `maximumProviderPrincipalUsdMantissa`. All fee, benefit,
capacity, and exposure thresholds use the same scale-18 USD mantissa contract.
These caps are applied while selecting complete positions; the policy does not
partially allocate a position to squeeze under a cap.

## Deterministic selection and capacity

Each source position is indivisible in this policy version. Candidates quote
the complete native atomic amount, and a selected route receives the complete
position or nothing. Individual candidates that exceed reported opportunity
`availableCapacityUsdMantissa` are rejected. During selection, remaining
capacity and the aggregate cross-chain and provider exposures are conserved
across all positions.

Positions are considered by their best eligible net benefit, with stable IDs
as deterministic tie-breakers. Within a position, higher net benefit wins;
ties prefer same-chain, then lower lifecycle cost, then candidate ID. A
position that cannot fit its preferred route may use its next eligible route.
The result can therefore be complete, partial, or contain no eligible route,
but never silently split or over-allocate a source position.

## Read-only evidence adapters

`SmartLendingModule` registers three passive server-side adapters. It makes no
request during startup, exposes no raw-feed HTTP route, and defaults to
`SMART_LENDING_EXTERNAL_FEEDS_MODE=disabled`.

- `AaveV3EthereumMarketFeedAdapter` sends one fixed, wallet-free GraphQL query
  for the Ethereum Core market and strictly normalizes the active USDC and USDT
  reserves. It captures base supply APY, provider-reported supply totals and
  caps, available liquidity, reserve factor, pause state, and freeze state. Its
  contract fixes its use to `PROVIDER_NATIVE_CORROBORATION_ONLY`, and fixes both
  `mayEstablishRecommendationEligibility` and `mayAuthorizeFinancialAction` to
  `false`. The response contains no authenticated block number or independently
  verified deployment evidence, so the local retrieval time is not chain
  freshness and this adapter cannot make Aave available to users.
- `DefiLlamaMarketFeedAdapter` normalizes the public yield-pool snapshot for all
  ten planned Ethereum/Solana provider identities. This is aggregate,
  indicative corroboration only. It does not prove an exact approved
  deployment, pause state, deposit/withdrawal cap, exit liquidity, fee policy,
  or risk decision, and its contract fixes
  `mayEstablishRecommendationEligibility` to `false`.
- `LifiRoundTripQuoteAdapter` requests separate Ethereum-to-Solana and
  Solana-to-Ethereum minimum-output quotes for the same six-decimal stablecoin.
  It forbids exchange steps, checks both independently selected bridge tools
  and each quote's actual cross step against the server allowlist, includes
  route-implied transfer loss, every fee marked as not included, and gas in
  scale-18 USD. The selected bridge must agree across the top-level quote,
  estimate, and actual cross step. Ambiguous fee metadata or absent/unvalued gas
  fails closed, and destination contract calls are explicitly disabled. The
  adapter discards LI.FI's transaction request, and its output cannot authorize
  or execute a transaction.

### Aave Ethereum deployment evidence

The Aave Ethereum deployment-evidence boundary is read-only and unavailable by
default. Its reference manifest is `AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST`,
pinned to the official immutable Aave address-book
[v4.66.3 Ethereum module](https://assets.aave.com/address-book/releases/v4.66.3/modules/AaveV3Ethereum.json),
source commit `12963110f29699d214531b9ab4c7cfcec460c298`, and module SHA-256
`371c9a43983d32fad37559d83724695f8458f2888552041ba8a05001b666522d`.
The closed read plan requires any future RPC source implementation to capture
one finalized Ethereum block and bind every state read to its hash with EIP-1898
`requireCanonical: true`. The parser accepts a source bundle only when every
operation attests to that binding and matching pre/post headers. It then checks
runtime-code presence and records unapproved code hashes; checks the Pool proxy,
AddressesProvider/admin, provider Pool/DataProvider, immutable DataProvider
Pool, USDC, and USDT relationships; and observes the active Pool implementation
with the proxy's simulated admin-context `eth_call`. Missing, malformed,
unbound, or mismatched evidence is unavailable. No concrete RPC source exists
yet, so source attestations are explicitly unverified rather than live proof.

This evidence is corroboration only. It cannot establish recommendation
eligibility, authorize a financial action, or send, sign, or broadcast a write;
it does not increase the live-provider count or upgrade the authority of the
Aave GraphQL market feed. Promotion still requires approved primary and
independent RPC sources, approved runtime-code hashes, durable finalized-block
checkpoints with continuity and reorg handling, and revision-bound transcript
proof that every call was canonically block-bound and independent sources
agree. Until those gates and independent review pass, this is not a live Aave
production reader.

The source contracts are documented by Aave's
[GraphQL API overview](https://aave.com/docs/aave-v3/getting-started/graphql)
and [market-data reference](https://aave.com/docs/aave-v3/markets/data), DefiLlama's
[data-update FAQ](https://docs.llama.fi/faqs/frequently-asked-questions) and
LI.FI's [quote endpoint](https://docs.li.fi/api-reference/get-a-quote-for-a-token-transfer)
and [rate-limit reference](https://docs.li.fi/api-reference/rate-limits). Those
documents describe vendor behavior; they are not internal approval artifacts.

The transport fixes its destinations in code to `api.v3.aave.com`,
`yields.llama.fi`, and `li.quest`; callers cannot supply a URL. It permits only
the reviewed GET requests for DefiLlama and LI.FI and one exact POST body for
Aave. The Aave body contains the fixed market address and chain ID and has no
caller-controlled field. The transport also enforces exact query allowlists,
response-size limits, timeouts, JSON content types, redirect rejection, no
credentials/referrer/cache, sanitized failures, and independent destination
kill switches. A LI.FI API key is optional and server-only; no credential is
sent to Aave.

LI.FI's quote contract requires the sending and receiving wallet addresses as
well as token identities and the exact amount. A round-trip request therefore
allows that third party and its network-log processors to link a customer's
Ethereum and Solana addresses with financial metadata. The implemented adapter
contains no public call path, and the non-production lane must use only
synthetic, non-customer addresses. Production remains blocked until Privacy,
Legal, and Security approve the exact purpose, disclosure/consent basis,
processor and retention terms, query-string log treatment, and data-subject
lifecycle. Consent to _consider_ a cross-chain recommendation is not by itself
consent to this third-party disclosure. The canonical security threat register
has been revised and re-fingerprinted for the LI.FI disclosure flow and fixed
Aave destination, but it still requires an independent review bound to the
exact release candidate before activation.

All three destination startup gates default to on, even after the overall mode is
enabled. Turning any one off in non-production requires immutable source
revision, egress-policy digest and approval reference, and provider-policy
digest and approval reference metadata. These strings make drift visible but
are not authorization: they do not verify policy content, status, expiry, or
signer identity.

Production activation is therefore rejected by code even when all metadata is
present. It remains blocked until a reviewed activation-manifest capability can
verify the actual policy artifacts, expiry, destinations, and running source
revision. Enabled mode additionally requires `NODE_ENV=development` or
`NODE_ENV=test`; absent, misspelled, staging, and production values fail closed.
This matches the checked-in deny-all egress decision.

The reviewed non-production acceptance surface is intentionally closed:

```text
NODE_ENV=test
SMART_LENDING_EXTERNAL_FEEDS_MODE=enabled
SMART_LENDING_AAVE_V3_KILL_SWITCH=off
SMART_LENDING_DEFILLAMA_KILL_SWITCH=off
SMART_LENDING_LIFI_KILL_SWITCH=off
SMART_LENDING_EXTERNAL_FEEDS_EGRESS_APPROVAL_REFERENCE_ID=<approved-reference>
SMART_LENDING_EXTERNAL_FEEDS_EGRESS_POLICY_SHA256=<lowercase-sha256>
SMART_LENDING_EXTERNAL_FEEDS_PROVIDER_APPROVAL_REFERENCE_ID=<approved-reference>
SMART_LENDING_EXTERNAL_FEEDS_PROVIDER_POLICY_SHA256=<lowercase-sha256>
SMART_LENDING_EXTERNAL_FEEDS_SOURCE_REVISION=<immutable-git-sha>
# SMART_LENDING_LIFI_API_KEY=<server-secret>  # optional
```

Do not set these values merely to make a deployment start, and never use real
customer wallet addresses or balances in this lane. Production rejects enabled
mode outright, and the checked-in egress decision remains deny-all until its
owners approve and exercise the exact hosts.

Changing these environment values does not stop an already-running process; a
restart or redeploy is required. Any future production design needs a live,
centrally controlled deny switch with measured propagation and rollback time.

## Non-execution boundary and remaining adapters

This domain is a pure, fail-closed recommendation function. It performs no
network reads, persistence, approvals, signatures, swaps, bridges, provider
deposits, or transactions. Its output explicitly cannot authorize or execute a
financial action, and every selected position still requires a separate,
fresh transaction review and approval.

`SmartLendingRecommendationService` is the trusted application seam around the
domain. Its caller supplies only an authenticated account ID and correlation
ID. A server clock supplies the evaluation time. Its composed input reader now
defines separate server-owned ports for account-bound routable capital,
complete approved opportunities, approved policy and consent, and full
lifecycle quotes. It validates account, correlation, evaluation-time,
freshness, complete ten-provider coverage, supported asset identity, risk
approval, quote binding, and deterministic candidate bounds before calling the
domain. Cross-chain wallet-address disclosure requires its own active LI.FI
consent in addition to cross-chain consideration consent. Both consent records
must be bound to the account, enclosing policy approval, both wallet IDs, and
the exact directed Ethereum/Solana network pair. Every full-lifecycle quote
must echo a deterministic request fingerprint covering those bindings plus the
source and destination wallets, opportunity evidence, risk evidence, bridge
allowlist, amount, and deadline. Any malformed, partial, stale, misbound,
over-budget, or unavailable input fails closed.

Those four upstream ports intentionally resolve to unavailable adapters in the
runtime module. This preserves deny-by-default behavior while their real
portfolio/valuation, approved-opportunity, policy/consent, and lifecycle-cost
implementations remain absent. There is still no HTTP recommendation route,
and neither the composer nor the recommendation service can authorize or
execute a transaction.

Before production use, provider-native adapters must still authenticate exact
deployments and normalize APY, capacity, pause state, fees, and withdrawal
availability for each of the ten providers. The new Aave adapter is only the
first unauthenticated corroboration slice, not a completed provider gate.
Server-owned wallet positions,
stablecoin valuation, risk decisions, same-chain costs, provider entry/exit
costs, cross-chain consent, and remaining network costs must then be composed
into an immutable input snapshot. The composition must enforce freshness again
at transaction review, re-quote before submission, and persist the approved
route and actual itemized fees. Until those integrations, the external-egress
approval, and the existing mainnet write gates are complete, this is neither a
live production allocator nor an execution path.

Before any authenticated recommendation route is exposed, the runtime also
needs a bounded per-account and global quote budget, distributed rate control,
circuit breaking, and single-flight/cache behavior for aggregate and native
market snapshots. The composer rejects more than 128 candidate quotes and does
not silently truncate. One 30-second aggregate deadline and abort signal are
shared by the capital, opportunity, policy, and sequential quote readers. Both
the initial combined read and every quote are raced against that deadline, so a
non-cooperative source cannot keep the composition pending or cause later
quotes to start. All snapshots, policy, consents, evidence, risk assessments,
and returned quotes must remain valid through the deadline. These structural
controls are not a production per-account/global rate or spend budget. The
present module deliberately has no HTTP controller, so a caller cannot yet
multiply external quote traffic.

DefiLlama's payload supplies no per-market observation timestamp. The adapter's
`retrievedAt` and short `validUntil` prove only when this server retrieved the
aggregate response, not when each upstream market was observed. That is another
reason the snapshot is corroboration only; it must never satisfy a provider
freshness gate.

The implemented aggregate market and route adapters can be exercised in an
explicitly approved non-production environment without paying for a vendor
plan, subject to public endpoint limits and availability. That does not provide
a production SLA or remove the need for dedicated Ethereum/Solana RPC and
provider-native evidence.
