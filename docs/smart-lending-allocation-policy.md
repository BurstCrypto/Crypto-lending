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
- entry and anticipated-exit estimates from an allowlisted bridge provider;
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
and route quotes. Malformed or unavailable input fails closed; there is no HTTP
route or production reader implementation yet.

Before production use, server-owned live adapters must authenticate and
normalize wallet positions, provider capacity/APY evidence, risk assessments,
asset valuation, same-chain route quotes, and Ethereum/Solana bridge quotes
including entry and anticipated-exit minimum outputs and every cost category.
The production composition must bind recommendations to an immutable input
snapshot, enforce quote freshness again at transaction review, re-quote before
submission, and persist the approved route and actual itemized fees. Until those
integrations and the existing mainnet write gates are complete, this is not a
live allocator or execution path.
