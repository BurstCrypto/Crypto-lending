# Local mainnet workspace

This launches the same Portfolio, wallet connections, automatic lending
selection and transaction engine used by the production web build. Local mode
skips email/phone account login and adds read-only provider APYs and deposit
destinations. See [production/local parity](../../docs/mainnet-production-parity.md)
for shared code, markets, deployment requirements and verification limits.

## Start

Use Node 22.13+ on the Node 22 line, or Node 24+:

```powershell
npm ci
npm ci --prefix onchain
npm run dev:mainnet
```

Open **http://127.0.0.1:3000/portfolio**. Port 3000 must be free. The launcher
builds the router artifacts and binds the server to loopback. Docker, the Nest
API, hosted accounts and paid RPC credentials are unnecessary here. Internet
access is required. The ordinary development API proxy is disabled, so another
service on port 3001 cannot receive account requests. `/mainnet-test` redirects
to Portfolio.

Production requests to `/api/mainnet` require a real account session. Only the
development launcher, checked local host/origin and launch capability can skip
that login. The old `/api/local-mainnet` alias is unavailable in production.

## Connect and lend

1. Select an Ethereum extension, a Solana extension, or both, then **Connect
   wallet**. A single wallet can check balances, lend and withdraw independently.
   Only bridging requires both. View the saved treasury recipients in Account.
2. Approve Phantom's connection request if prompted. The app connects only after
   you click Connect; Phantom may reuse permission previously given to this
   site. Connection shares your public address and never asks Ledger to sign a
   login message or transaction. Ledger approves spending later, after review.
3. Under **Smart lending**, choose the source wallet, USDC amount and holding
   period. Live APY loads automatically and the estimate updates as you type.
   Smart Lending compares all ten
   providers internally and presents one plan with the estimated return, costs,
   and network. Production hides provider names. Local testing also shows a
   read-only **Lending providers** panel with each provider's APY and your current
   position. Neither environment offers manual provider selection.
   Selection uses rates, capacity, funding, account rent and estimated net return
   after entry/exit fees. Rewards are excluded; future returns are estimates.
   A positive net return is not required to deposit. Small deposits still get
   the best available funded plan; the review explains when estimated costs
   exceed the interest. Missing funds, capacity, or live data are reported
   separately.
   The plan itemizes our routing fee and total source-wallet USDC debit. Under
   the current policy, same-network deposits charge 0.10% and bridge
   deposits charge 0.20%, on top of the principal. Bridge return estimates list
   their separate anticipated routing fee. Atomic-unit rounding matches the
   transaction builder, and each fee is counted once in its lifecycle stage.
   The bridging checkbox can be selected with one wallet; it explains which
   destination wallet must be connected before a bridge can be recommended.
4. **Review deposit** rechecks the automatic selection. Amounts use the connected wallet's balance;
   the former 1 USDC/deposit and 5 USDC/day principal caps are removed in both
   environments. Network-cost budgets still apply.
   Displayed market data is reused for up to 30 seconds; preparation and wallet
   reservation still require fresh checks. Concurrent identical Solana reads
   share one request without reusing completed transaction evidence.
5. Review the amount, network, recipient, wallet and maximum cost. Confirm the
   review checkbox, then approve in the wallet. Ethereum may first need an exact
   allowance or reset. After finality, continue to the same lender's deposit.
   Progress and errors appear beside the confirmation button. Solana lending
   refreshes the unsigned blockhash after the rate checks, re-simulates, and
   reserves it before opening the wallet. Amounts, fees and instructions stay
   bound to the review. Cancel an expired review and prepare a new one.
   A reserved Solana request with no saved signature has a **Check wallet
   request** action. It checks both RPCs for finalized expiry and the exact
   transaction in wallet history, recovering a match or clearing an expired
   request that never landed. It never sends or signs a transaction.
   The browser checks its Solana RPC connection before requesting a signature.
   Browser submission uses the public PublicNode endpoint, allowed by the
   Portfolio security policy. A failed or ambiguous send keeps the saved
   signature for status checks and never automatically resends.
6. Check status until finalized and verified. Signing alone is not completion.
   Locally, **Verified deposit destinations** lists the provider and explorer
   link for each completed deposit. Pending reviews do not count as deposits;
   existing onchain positions also appear in the provider table even without a
   matching local history entry. Deposit cards show the current USDC value,
   including accrued lending interest. Kamino receipt tokens are converted using
   its finalized reserve exchange rate, checked against both RPCs. Raw receipt
   counts and the exchange rate are in the local panel's collapsed **Receipt
   token details**. Withdrawal review checks the final USDC amount again.
   Each lending position's **Withdraw all** prepares a separate review returning
   that position to the same wallet, using its original provider internally.

Navigation includes Home, Portfolio and Account. Old `/platforms` links redirect
to Smart Lending. Manual deposit and bridge creation forms are replaced by the
automatic plan; existing transaction reviews and recovery remain available.

Markets: Aave, Morpho, Compound, Spark, Euler and Gearbox on Ethereum; Kamino,
Save, Project 0 and Jupiter on Solana. Each has one configured USDC market.
Provider website accounts are unnecessary. Project 0 may create a wallet-owned
onchain position account and charge its rent.

Same-network lending charges a 0.10% routing fee atomically with the deposit.
Ethereum first prepares a wallet-approved `BonsaiLendingRouter` deployment if
`ethereumLendingRouter` is not configured, then an exact principal-plus-fee
allowance. The verified router credits the position to the wallet and pays the
configured treasury. Solana includes the treasury transfer in the deposit message and
requires the actual message fee and new account rent, not a blanket 0.03 SOL
minimum. Protocol rounding can make an actual deposit slightly lower than the
reviewed maximum; the finalized result shows the actual amount. Debt checks
apply to the relevant protocol position. Withdrawals have no additional routing
fee. Deposits funded by a verified bridge are exempt from the same-network fee,
because the 0.20% bridge fee was already collected at the source.

## Optional bridging

Cross-chain comparisons are opt-in. Both wallets, gas on both chains and verified
router deployments are required before burning. A cross-chain route must beat
the best eligible same-chain route by at least $0.01 net over the holding period.
Comparison includes entry/return network costs, Circle fees and routing fees.
Existing positions are not automatically rebalanced.

Prepare each Ethereum router deployment separately and approve in the wallet.
Finalized receipts, compiled bytecode and immutable addresses are checked before
saving it. The source router fixes USDC, Circle's messenger, treasury and wallet
quote authority. The Aave router fixes USDC, pool, receipt token and transmitter.
These per-wallet deployments are shared across both environments; changing
immutable values requires deployment again. Ethereum source intents also need
an EIP-712 signature.

1. Fund source native USDC plus the reviewed fee and gas on both chains. Bridge
   readiness retains a 0.003 ETH and 0.03 SOL reserve.
2. Review principal, treasury/fee, Circle fee ceiling, minimum received and lender.
   Each source allowance and burn needs approval.
3. Check source finality, then Circle attestation. Standard transfers may take
   several minutes. An API response alone does not establish source completion.
4. Review destination receipt and lending. Aave/Kamino support combined receipt
   and supply, with reviewed Solana address-table setup if needed. For the eight
   other providers, receive USDC first and then review the chosen lender deposit.
   Approval continuation and recovery preserve the choice. Destination supply
   does not add a second platform fee.
5. Check finality and the lending position. Source fee plus burn is atomic; the
   whole cross-chain transfer is not.

Maximum reviewed network costs: 0.01 ETH per deployment, 0.002 ETH per other
Ethereum action, and 0.02 SOL per Solana action including rent. Ethereum also has
a 20 gwei fee ceiling. Daily reserved network costs remain 0.03 ETH and 0.1 SOL.
Reservations count after a failed attempt or rejected prompt. These are shared
cost budgets, not the removed USDC principal caps.

## Recovery

Keep **`.local-mainnet/`**, including configuration, journal and SQLite sidecars.
It stores reviews, reservations, transaction identities and recovery state.
Signed Solana bytes may be saved; private keys are never stored. Back it up
with the app stopped.

- Reconnect after reload. Restoring the journal does not resend transactions.
- **Check Solana transaction status** also clears a signed request after both
  independent RPCs confirm finalized blockhash expiry and no transaction in
  signature history. The saved signature and bytes remain in the journal.
- Use **Recover transaction status** for an interrupted Ethereum hash callback.
  Both RPCs must corroborate the saved transaction.
- A timeout does not prove failure. Ambiguous reservations need chain
  investigation. Do not clear the journal or repeat the source burn to recover.
- **Recover USDC to wallet** receives without lending. Supply can continue using
  the original wallet and lender.
- **Pause new source transactions** blocks new bridges and deposits/approvals;
  withdrawals and destination recovery remain available.

## Verification

```powershell
npm run typecheck --workspace @crypto-lending/web
npm test --workspace @crypto-lending/web -- lib/local-mainnet/ lib/mainnet/ test/local-mainnet-ui.test.tsx test/smart-lending-ui.test.tsx test/production-import-graph.test.ts
npm run build --workspace @crypto-lending/web
npm run infra:test:containers
npm run test:railway
```

Disable a development API proxy in `.env.local` for production builds; the build
rejects development proxy settings in production. The local launcher configures
its runtime automatically.

Mainnet rates were read for all ten providers. Unsigned simulation and automated
tests do not establish funded execution. No live deposit, withdrawal, bridge or
router deployment was signed or broadcast by these implementation checks.
Actual Phantom/Ledger approval and deployed-site parity require checking the
funded wallet and deployed revision.
