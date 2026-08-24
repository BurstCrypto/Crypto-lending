# KAN-69: unified balance and buying-power UI

Status: `LOCAL_FIXTURE_PREVIEW_COMPLETE` / `LIVE_API_WIRING_BLOCKED`

KAN-69 adds a local `/portfolio` product preview for BAL-004. It presents total
portfolio value and available buying power as deliberately different concepts,
then reconciles each amount through expandable wallet, chain, and asset
sources. The preview uses a deterministic, in-repository payload and makes that
fact visible above the screen. It does not fetch an API, inspect a wallet, quote
a route, create credit, or contact a provider.

No package was installed, no provider account or trial was opened, and no
network, RPC, database, Docker, cloud, hosted-service, or on-chain call was
made.

## View contract

The strict browser boundary in
`apps/web/lib/portfolio/unified-balance.ts` models the eventual composed
BAL-002/BAL-003 response. It is an explicit frontend integration contract, not
a claim that the independent KAN-67 and KAN-68 branches already expose this
wire shape.

The boundary accepts only:

- schema version 1, one safe snapshot ID, and canonical UTC timestamps;
- exact non-negative USD cents and token atomic amounts serialized as decimal
  strings, with no floating-point conversion;
- the reviewed EVM and Solana networks, canonical addresses, USDC/USDT/PYUSD,
  and six-decimal token quantities;
- fixed freshness, deduction, exclusion, and unavailable reason codes; and
- bounded wallet, chain, asset, deduction, and reason arrays made only of plain
  data properties.

It rejects accessors, extra or missing fields, malformed identifiers, duplicate
wallet/chain/asset sources, future observations, hidden stale state, a
buying-power value above portfolio value, and any wallet, chain, asset, or
deduction total that does not reconcile. An unavailable buying-power response
must use `null` plus at least one fixed reason; it cannot substitute zero.
Accepted data is copied into deeply frozen view objects. Validation failures
produce one generic error and do not retain provider-authored text.

The fixture demonstrates a reconciled $11,000.00 portfolio and $7,500.00 of
available buying power. A stale $2,000.00 holding remains visible in portfolio
value but contributes zero buying power. Additional exact deductions show the
liquidity, conversion, slippage, network, and routing adjustments that account
for the remaining difference.

## Accessible presentation

The UI provides:

- explicit `Total portfolio value` and `Available buying power` labels;
- fixed-US-dollar formatting backed by integer cents and accessible spoken
  labels;
- canonical `<time>` values, visible UTC as-of text, and textual current/stale
  badges that do not rely on color alone;
- native keyboard-focusable `<details>`/`<summary>` disclosure for wallets and
  chains, followed by complete asset attribution;
- masked wallet and asset identities in both visible and accessibility text;
- a deduction explanation and fixed, non-provider-authored reason copy; and
- separate loading, request-error, incomplete/no-supported-data, and
  buying-power-unavailable presentations. None turns missing data into zero.

The layout is responsive and honors reduced-motion preferences inherited from
the application stylesheet.

## Required wiring gate

The `/portfolio` page is intentionally labeled `Sample data` and must not be
presented as an authenticated live account screen. Replacing the fixture
requires a separately reviewed integration change that:

1. merges or maps the final KAN-67 portfolio DTO and KAN-68 buying-power DTO to
   this versioned boundary without weakening reconciliation;
2. binds the request to the authenticated account and the final WAL-006
   multi-wallet lifecycle instead of accepting account or wallet ownership from
   browser input;
3. uses a bounded, same-origin JSON client with abort/supersession behavior and
   generic errors, never logging response bodies, full addresses, or provider
   messages;
4. renders loading before a complete parse and maps transport, invalid-response,
   no-supported-balance, incomplete-snapshot, stale, and buying-power-unavailable
   outcomes to the existing explicit states;
5. verifies the final backend's currency scale, timestamps, freshness rules,
   reason taxonomy, wallet/chain/asset reconciliation, and snapshot limits; and
6. removes or converts the public sample route only after product, privacy,
   security, and authentication review.

Until that integration passes, this branch proves only deterministic local UI
behavior. It does not prove live balance accuracy, price freshness, routing
costs, wallet ownership, buying-power eligibility, or financial availability.

## Local verification

```text
npm test --workspace @crypto-lending/web -- unified-balance-contract.test.ts unified-balance-ui.test.tsx
npm test --workspace @crypto-lending/web
npm run lint --workspace @crypto-lending/web
npm run typecheck --workspace @crypto-lending/web
npm run build --workspace @crypto-lending/web
npm run format:check
npm run security:scan:secrets
```

These checks require no external service or provider.
