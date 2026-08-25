# KAN-77: Exact and itemized routing-fee calculation

KAN-77 implements the local calculation boundary for `FEE-002`. It is a pure
domain operation: no provider, chain, testnet, cloud resource, database, or
billing system is contacted.

## Calculation

The calculator resolves the rule effective at the quote timestamp, classifies
the normalized route, and calculates the platform fee in the fee-base asset:

```text
raw numerator = amountAtomic * rate.mantissa
denominator  = 10 ^ rate.scale
platform fee = round(raw numerator / denominator)
```

All money arithmetic uses `bigint`. Version 1 uses half-even rounding at the
atomic-unit boundary; the versioned rule contract also validates explicit
`DOWN` and `UP` modes for future approved versions. Inputs and per-asset totals
are capped at `2^256 - 1` and use canonical unsigned integer strings at the
JSON boundary.

A direct-compatible route retains a zero `PLATFORM` estimate. This records the
rule decision without creating a zero journal posting. Material routes use the
Free, Individual, or Pro rate selected by KAN-76.

## Itemization and snapshot binding

The result always has one platform line followed by the supplied pass-through
lines. A caller may supply only `NETWORK`, `DEX`, `BRIDGE`, or `PROVIDER`
pass-through categories; supplying `PLATFORM` is rejected so a provider cannot
inject or hide a second platform charge. Every component retains its exact:

- category and sequential line number;
- asset revision and atomic amount;
- added-on-top, deducted-from-input, or deducted-from-output mode; and
- platform-rule or quote-source reference.

Totals are calculated separately for each exact asset revision. Amounts in
different assets are never added together merely because a UI may later show a
common USD estimate. The complete normalized rule, route, classification,
fee base, components, per-asset totals, quote identity, route identity, tier,
and quote time are bound into a domain-separated SHA-256 fingerprint.

The result and every nested value are copied and frozen. Recalculating the same
input is deterministic. A later catalog mutation or effective rule version
cannot rewrite an already produced snapshot object.

## Validation and limits

The domain accepts at most 31 pass-through lines plus the platform line, which
matches the immutable ledger's 32-line fee bound. It rejects noncanonical or
overflowing amounts, invalid UUID references, stale rule gaps, unsupported
tiers or categories, malformed deduction modes, extra properties, accessors,
sparse/decorated arrays, foreign prototypes, and throwing proxy traps.

KAN-77 does not persist this snapshot or claim that a quoted cost settled.
KAN-78 owns the capability-bound persistence and actual/adjustment/reversal
fixtures. Existing checksum-pinned ledger migration `0007` remains unchanged.

## Local verification

```powershell
npm test --workspace @crypto-lending/api -- routing-fees/domain/routing-fee.spec.ts
npm run typecheck --workspace @crypto-lending/api
npm run lint --workspace @crypto-lending/api
```
