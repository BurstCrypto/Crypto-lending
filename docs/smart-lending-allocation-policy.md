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

`SmartLendingModule` registers two passive server-side adapters. It makes no
request during startup, exposes no raw-feed HTTP route, and defaults to
`SMART_LENDING_EXTERNAL_FEEDS_MODE=disabled`.

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

The source contracts are documented by DefiLlama's
[data-update FAQ](https://docs.llama.fi/faqs/frequently-asked-questions) and
LI.FI's [quote endpoint](https://docs.li.fi/api-reference/get-a-quote-for-a-token-transfer)
and [rate-limit reference](https://docs.li.fi/api-reference/rate-limits). Those
documents describe vendor behavior; they are not internal approval artifacts.

The transport fixes its destinations in code to `yields.llama.fi` and
`li.quest`; callers cannot supply a URL. It enforces GET-only requests, exact
query allowlists, response-size limits, timeouts, JSON content types, redirect
rejection, no credentials/referrer/cache, sanitized failures, and independent
destination kill switches. A LI.FI API key is optional and server-only.

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
must also be revised, re-fingerprinted, and independently reviewed for this new
trust flow before activation.

Both destination startup gates default to on, even after the overall mode is
enabled. Turning either one off in non-production requires immutable source
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
ID. A server clock supplies the evaluation time, while the injected input
reader owns portfolio values, policies, consent, opportunities, risk evidence,
and route quotes. Malformed or unavailable input fails closed. The new feed
ports are registered for that future composition, but there is still no HTTP
route or complete production allocation-input reader.

Before production use, provider-native adapters must still authenticate exact
deployments and normalize APY, capacity, pause state, fees, and withdrawal
availability for each of the ten providers. Server-owned wallet positions,
stablecoin valuation, risk decisions, same-chain costs, provider entry/exit
costs, cross-chain consent, and remaining network costs must then be composed
into an immutable input snapshot. The composition must enforce freshness again
at transaction review, re-quote before submission, and persist the approved
route and actual itemized fees. Until those integrations, the external-egress
approval, and the existing mainnet write gates are complete, this is neither a
live production allocator nor an execution path.

Before any authenticated recommendation route is exposed, the runtime also
needs a bounded per-account and global quote budget, distributed rate control,
circuit breaking, and single-flight/cache behavior for the hourly aggregate
snapshot. The present module deliberately has no HTTP controller, so its two
sequential bridge reads cannot yet be multiplied across domain candidates by a
caller.

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
