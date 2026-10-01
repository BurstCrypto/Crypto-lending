# Production and local mainnet parity

The web application uses one mainnet workspace in both environments. Local
testing skips email/phone account login and adds read-only provider details; it
does not substitute a different recommendation or execution engine. Wallet
connection, automatic APY, transaction review, fees, deposits and withdrawals use
the same components and API operations in both modes.

| Concern | Shared implementation |
| --- | --- |
| Portfolio and wallet connection | `apps/web/components/mainnet/` |
| Internal provider catalog and exact USDC markets | `apps/web/lib/lending/markets.ts` |
| Automatic lending plan presentation | `apps/web/components/lending/smart-lending-panel.tsx` |
| Rates, fees, best fundable route | `apps/web/lib/mainnet/smart-lending.server.ts` |
| Transaction preparation, review, reservation and recovery | `apps/web/lib/mainnet/`, `onchain/src/` |
| Treasury receiving addresses | `apps/web/lib/mainnet/public-config.ts` |
| API for both environments | `/api/mainnet` |
| Authentication boundary | `apps/web/lib/mainnet/access.server.ts` |

Production validates the real backend account session and CSRF token for writes.
Its configuration and transaction journal are isolated by verified account ID.
Local mode requires the development launcher, loopback host/origin and per-launch
capability; its journal remains in `.local-mainnet/`. A local capability cannot
authenticate a production request. Local `/login` and `/register` requests go
straight to Portfolio, and local navigation makes no account-session request.
Production retains login, contact details and logout.

The local Portfolio adds a read-only **Lending providers** panel with all ten
live APYs, positions at the saved wallet addresses, and finalized deposit
destinations with explorer links. The destination history includes same-chain
and bridge-funded deposits, excludes approvals, withdrawals and unfinished or
cancelled reviews, and shows actual USDC amounts only when verified outcomes
are recorded. Current positions can predate the local journal; receipt tokens
are converted to their current USDC value before display. Kamino valuation uses
the finalized reserve's available liquidity, borrowed balance, protocol/referral
fees and receipt supply, with integer arithmetic and two RPC sources. The
display includes accrued reserve interest; unavailable or inconsistent exchange
rates never fall back to the receipt-token quantity. Raw Kamino receipt counts
and the exchange rate appear only in collapsed local testing details.
Provider names also appear beside local
position cards. These additions do not change provider selection or add any
transaction controls. The server enables them only for a validated local
launch; production renders the same workspace without them.

## Connected markets

All ten providers have a concrete USDC market, live rate reader and unsigned
deposit/full-withdrawal builder. They are not placeholders for every market the
provider offers. The catalog records exact contract/program addresses and rate
sources, and changes must also update independent browser transaction checks.

| Chain | Provider | Configured market |
| --- | --- | --- |
| Ethereum | Aave | V3 Core USDC |
| Ethereum | Morpho | Blue cbBTC/USDC, 86% LLTV |
| Ethereum | Compound | V3 USDC Comet |
| Ethereum | Spark | SparkLend USDC |
| Ethereum | Euler | K3 Capital Prime USDC vault |
| Ethereum | Gearbox | V3 USDC pool |
| Solana | Kamino | Main Market USDC reserve |
| Solana | Save | Main Pool USDC reserve |
| Solana | Project 0 | USDC bank in the configured group |
| Solana | Jupiter | Lend Earn main USDC |

The engine compares every provider internally and selects an eligible, fundable
route by estimated net return after entry/exit costs over the chosen holding
period. The interface presents one Smart Lending plan with its amount, network,
rate, costs and estimated return. Production does not expose provider names;
local testing shows the read-only details described above. Neither mode offers
manual provider selection. Platforms is removed from navigation and its old URL
redirects to Smart Lending. Existing positions retain their original provider
internally for withdrawals and transaction recovery. The engine excludes
incentive rewards and does not automatically rebalance existing positions.
A zero supply rate is displayed as zero.

Estimated profitability ranks eligible plans; it does not determine whether a
deposit is allowed. A funded deposit can be selected even when its expected
interest is lower than entry/exit costs or those costs exceed its principal.
The review displays the negative estimate. Wallet funding, available capacity,
data freshness, network-cost budgets and transaction validation still apply.
When no plan is available, the quote reports a provider-neutral explanation of
the funding, capacity or live-check failure.

Either wallet can connect without the other. The app requests connection only
after the user clicks Connect, using Wallet Standard `connect({ silent: false })`
on Solana and `eth_requestAccounts` on Ethereum. Connection never requests SIWS,
message signing or a transaction signature; Ledger accounts can connect even
when they cannot sign arbitrary messages. Phantom controls its permission UI
and may reuse a previously approved site connection. A page reload still leaves
the app disconnected until the user clicks Connect. Production account login
and all spending approvals remain separate from connecting a public wallet.
APY loads automatically; changing the deposit inputs refreshes the selected plan
without a comparison button. Spending requires transaction review and wallet
approval. Deposits use wallet balances and current protocol capacity; the former
1 USDC per-deposit and 5 USDC daily principal limits are removed in both modes.
Actual network fees, account rent, per-transaction cost budgets and daily network
cost reservations remain shared. Project 0 creates an onchain position account
when necessary; this is wallet-paid rent, not a provider website login.

Before a Solana lending wallet request, reservation refreshes only the unsigned
transaction's blockhash and lifetime. Both the journal and browser compare the
full message with the reviewed message after normalizing the blockhash; accounts,
instructions and fees cannot change. Current balance and simulation checks still
run. Reservation atomically saves the refreshed fingerprint, and signed or
reserved transactions cannot be refreshed or submitted a second time. Progress
and failures appear beside the wallet confirmation button.

Both modes use PublicNode for browser Solana submission and check its mainnet
connection before asking the wallet to sign. Portfolio's browser security policy
allows only that additional RPC origin. A failed send preserves the signature;
it does not trigger automatic retries. Status recovery cancels an expired signed
request only after both independent server RPCs prove finalized blockhash expiry
and absence from signature history, retaining its signature and saved bytes.

Displayed rates and automatic comparisons reuse market reads for up to 30 seconds
per wallet configuration. Transaction preparation and reservation still recheck
fresh market data. Independent providers load concurrently, and simultaneous
identical Solana RPC reads share one request per endpoint. Completed RPC evidence
is not cached by that transport, and independent sources remain independent.

The optional bridging checkbox accepts the user's preference with one wallet and
explains which destination wallet is missing. The engine still excludes bridge
recommendations until both wallets and the required bridge setup are ready.

Same-network deposits charge a 0.10% routing fee on top of principal. Ethereum
uses a verified `BonsaiLendingRouter`; Solana includes the treasury transfer in
the deposit transaction. Fee collection and lending succeed or fail together.
Optional cross-chain routing charges 0.20% at the source and uses
the same fee and Circle bridge flow in both modes, requires both wallets and
verified router deployments, and must beat the best eligible same-chain route by
at least $0.01 net. For the eight additional lenders, destination USDC is received
first and then deposited into the selected lender after a separate review. The
chosen provider is persisted through recovery and approval continuation.

The plan shows the routing fee in exact USDC units and the total USDC debit.
Quotes use the source transaction builder's half-even rounding. Deposit costs
include the source routing fee; the anticipated return routing fee belongs to
withdrawal/return costs and is displayed separately. Both are already included
in estimated net earnings. Withdrawals have no additional routing fee, and
bridge-funded deposits are not charged a second same-network fee. Simulations,
browser instruction validation, wallet funding checks, and finalized treasury
credits must agree with the reviewed fee. Legacy saved transactions remain
recoverable; unsubmitted legacy zero-fee reviews must be refreshed.

## Run locally

```powershell
npm ci
npm ci --prefix onchain
npm run dev:mainnet
```

Open `http://127.0.0.1:3000/portfolio`. Keep the entire `.local-mainnet/` directory,
including SQLite sidecars. Reloading restores reviews and status; it does not
resend transactions. Treasury receiving addresses are fixed to the saved project
recipients. RPC reads require internet access but no provider account or API key.

## Deploy the same source

These changes do not deploy or modify the live website. Visual and behavioral
parity with that website requires deploying this same revision and configuration.
On September 23, 2026, the live `/api/version` endpoint reported
`7c266ef5074b8afc5a96a80061445b320845580e`, and `/portfolio` correctly redirected
an unauthenticated request to login. The local changes have not been deployed;
this source-level parity is not evidence that the live site already runs them.

`Dockerfile.web` builds the shared transaction code, compiled router artifacts and
pinned protocol SDKs. The `web-mainnet` runtime validation profile checks the
standalone artifact and those dependencies; the API retains its previous SDK
boundary. Container assembly replaces Turbopack's external SDK aliases with
their traced runtime files, so the image has no dependency on the build machine.
The web container runs as UID/GID 10001.

Production requires:

- `AUTH_PUBLIC_ORIGIN` set to the canonical HTTPS application origin, with the
  existing backend account-session endpoint reachable through the gateway.
- `MAINNET_DATA_DIR` set to an absolute persistent directory writable by UID/GID
  10001. There is no temporary-directory fallback for account journals.
- A single web replica for the current SQLite journal implementation. The checked
  in Railway topology mounts `/data/mainnet` from the mainnet journal volume and
  sets the replica count to one. Provisioning and volume permissions must be
  confirmed when deploying; the topology has not been applied by this change.

## Verification and remaining live evidence

Local checks cover shared imports/UI, session and CSRF enforcement, independent
wallet selection, all ten rates in comparisons, fee-aware selection, exact
Ethereum/Solana instruction review, preserved destination provider, account
journal isolation, durable reservations and transaction recovery. Mainnet
read-only probes returned rates for all ten configured markets.
The same Ethereum and Solana wallet-review tests run with provider details both
hidden and visible. Local-only rendering and login bypass are separately tested
against production, ordinary development and deployed environment settings.

Unsigned simulations and instruction construction are not funded execution.
Solana lending reviews include both a compute-unit limit and an explicit zero
compute-unit price. A limit alone allows Phantom's fee enhancement to insert a
price during signing, changing the message after review. The explicit price
keeps the existing fee policy and exact signed-message validation intact; it
does not change the 0.10% same-chain or 0.20% bridge routing fee. Regression tests
model Phantom's enhancement and retain rejection of altered amounts, treasury
recipients, routing fees and network fees.
The development browser cannot verify the user's real Phantom/Ledger extension.
No real lender deposit, withdrawal, router deployment or funded bridge has been
signed or broadcast during this implementation. A funded end-to-end run with
wallet review, and a comparison against the deployed revision, remain live
verification tasks.
