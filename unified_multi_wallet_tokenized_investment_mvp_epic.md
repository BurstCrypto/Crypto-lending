# Epic: Unified Multi-Wallet Tokenized Investment Platform — MVP

## Epic Summary

Build an international-first financial platform that allows users to connect multiple external crypto wallets, view their supported stablecoin holdings as one unified balance, and use that combined capital to invest in tokenized equities, earn yield, or transfer funds without manually managing blockchains, bridges, stablecoin conversions, or execution venues.

The platform will act as an **orchestration and execution layer**, while regulated third-party providers handle securities issuance/execution, custody, and regulated financial functions.

---

## AI Agent Instructions

Use this document as the source of truth for creating Jira tickets for the MVP.

When generating Jira work:

- Create Jira Epics from the **Suggested Jira Workstreams** section.
- Break each Epic into implementation Stories/Tasks that are small enough to be independently developed and tested.
- Every Story should include:
  - Summary
  - Description
  - User/business value
  - Technical requirements
  - Acceptance criteria
  - Dependencies
  - Priority
  - Relevant backend/frontend/infrastructure ownership
- Create Spike tickets where provider behavior, regulatory requirements, APIs, wallet behavior, or technical feasibility must be investigated before implementation.
- Do not create tickets for anything listed under **Out of Scope for MVP**.
- Prefer tickets that can be completed independently.
- Explicitly document dependencies between wallet aggregation, routing, eligibility, tokenized-equity providers, ledgering, and reconciliation.
- Security, auditability, transaction state management, and reconciliation are required parts of financial workflows and should not be treated as optional cleanup tasks.
- Any real-money feature must have appropriate logging, failure handling, idempotency, monitoring, and reconciliation tickets.
- The U.S. is excluded from the initial launch.
- The target launch architecture uses regulated partners rather than building proprietary broker-dealer, custody, token issuance, or money-transmission infrastructure.
- At least **2 tokenized-equity providers must be production-integrated**, with **3 providers targeted before full public launch**.
- Multi-wallet connectivity and cross-wallet funding are MVP requirements.

---

# Product Problem

Crypto users frequently have capital fragmented across:

- Multiple wallets
- Multiple blockchains
- Multiple stablecoins
- Multiple exchanges and investment platforms
- Multiple tokenized-stock providers
- Multiple yield protocols

To invest or earn yield, users currently need to manually determine:

- Which wallet contains the necessary funds
- Which blockchain funds are on
- Whether assets need to be swapped
- Whether assets need to be bridged
- Which tokenized stock provider offers the best execution
- Which yield opportunity is appropriate
- Whether they are eligible to use a given provider

The MVP should abstract these decisions away from the customer.

The customer should primarily tell the platform:

> **What do I want to do with my money?**

The platform determines how to execute it.

---

# MVP Goal

Allow a verified international user to:

1. Create an account.
2. Complete KYC and jurisdiction eligibility checks.
3. Connect multiple external wallets simultaneously.
4. View supported stablecoins across all connected wallets as one unified balance.
5. See both portfolio value and estimated deployable buying power.
6. Search for a supported stock such as NVIDIA or Apple.
7. Compare eligible tokenized versions of that stock across multiple providers.
8. Receive the best available all-in execution route.
9. Fund the transaction using assets from one or more connected wallets.
10. Automatically route, swap, and bridge stablecoins where required.
11. Authorize required wallet transactions.
12. Purchase the tokenized security.
13. View the resulting investment in the user's portfolio.
14. Allocate supported stablecoins to Smart Yield strategies.
15. Send or withdraw supported assets.

---

# Target Market

## Launch

International-first.

The United States will be excluded from the initial launch.

Availability will be determined by:

- User jurisdiction
- Provider restrictions
- KYC requirements
- Investor eligibility
- Local regulatory requirements
- Product availability

The platform should be described as:

> **Available across supported international markets.**

---

# Core MVP Capabilities

## 1. User Accounts & Authentication

Users must be able to:

- Create an account
- Authenticate securely
- Manage their profile
- Complete KYC
- Establish residency/jurisdiction
- View eligibility status
- Manage connected wallets
- Manage subscription

---

## 2. Eligibility Engine

The platform must determine which financial products and providers each user may access.

The engine should evaluate:

- Country of residence
- KYC status
- Investor classification where required
- Provider-specific restrictions
- Product-specific restrictions
- Jurisdiction-specific restrictions

Example:

```text
User requests AAPL
        ↓
Eligibility Engine
        ↓
Dinari        Eligible
Ondo          Eligible
xStocks       Ineligible
        ↓
Only eligible providers
enter execution routing
```

Eligibility must be evaluated before presenting an executable trade.

---

## 3. Multi-Wallet Connectivity

Users must be able to connect multiple wallets simultaneously.

Initial targets:

- Phantom
- MetaMask
- Coinbase Wallet
- WalletConnect-compatible wallets
- Optional embedded wallet

Each connected wallet should remain an independent funding source.

The platform must not require users to consolidate funds into a proprietary wallet before using the application.

---

## 4. Supported Stablecoins

Initial:

- USDC
- USDT
- PYUSD

Architecture must allow additional stablecoins to be added later without redesigning the balance or routing system.

---

## 5. Supported Blockchains

Initial:

- Ethereum
- Base
- Arbitrum
- Solana

The architecture must support future chain integrations.

---

## 6. Unified Portfolio

The platform should aggregate supported holdings across every connected wallet.

Example:

```text
Phantom
USDC / Solana             $4,000
USDT / Ethereum           $1,000

MetaMask
USDC / Base               $3,000
PYUSD / Ethereum          $2,000

Coinbase Wallet
USDC / Base               $1,000

--------------------------------
Stablecoin Value         $11,000
```

Users should see:

### Portfolio Value

Estimated market value of assets.

### Available Buying Power

Estimated amount that can actually be deployed after:

- Stablecoin prices
- Liquidity
- Conversion costs
- Slippage
- Network costs
- Routing requirements

Example:

```text
Portfolio Value           $11,000.00
Available Buying Power    $10,993.74
```

---

## 7. Intent Engine

Financial actions should originate from user intent rather than blockchain mechanics.

Initial intents:

- Send
- Invest
- Earn

Example:

```text
User:

Buy $5,000 NVDA
```

The customer should not need to specify:

- Wallet
- Stablecoin
- Chain
- Bridge
- DEX
- Token issuer
- Execution venue

unless they deliberately use an advanced interface.

---

## 8. Stablecoin Funding Router

The routing engine must determine the best way to fund a requested transaction.

It should consider:

- Wallet balances
- Stablecoins
- Blockchains
- Direct settlement availability
- Swap requirements
- Bridge requirements
- Liquidity
- Slippage
- Network fees
- Routing fees
- Execution time
- Route risk

Routing priority should generally favor:

1. Direct settlement
2. Same-token movement
3. Same-chain conversion
4. Cross-chain conversion
5. More complex routing

The router should avoid unnecessary transactions.

---

## 9. Multi-Wallet Transaction Funding

A single transaction may use funds from multiple connected wallets.

Example:

```text
BUY $4,000 AAPL

Funding:

Phantom
USDC / Solana            $2,000

MetaMask
USDC / Base              $1,500

MetaMask
PYUSD / Ethereum           $500
```

The system must:

- Determine funding allocation
- Request wallet-specific authorization where required
- Track each sub-transaction
- Reconcile the combined transaction
- Prevent execution if any required funding source fails

---

## 10. Tokenized Equity Providers

MVP target:

**Minimum: 2 providers**

**Target: 3 providers**

Current provider ecosystems to investigate/integrate:

- Dinari
- Ondo
- xStocks / Backed ecosystem

Final providers will depend on:

- API availability
- Partnership access
- Supported jurisdictions
- Settlement requirements
- Market-data availability
- Liquidity
- Regulatory requirements

---

## 11. Tokenized Equity Normalization

Different tokenized securities representing the same underlying equity must not automatically be treated as the same fungible asset.

Example:

```text
AAPL exposure

Dinari AAPL
Ondo AAPL
xStocks AAPLx
```

The system should normalize them under a common underlying instrument:

```text
Underlying:
Apple Inc.

Ticker:
AAPL
```

while preserving:

- Issuer
- Token
- Blockchain
- Contract
- Custody structure
- Redemption structure
- Provider
- Execution venue

---

## 12. Equity Execution Marketplace

Users should search for the **underlying company**, not the token issuer.

Example:

```text
Search:
NVIDIA

Result:
NVIDIA Corporation
NVDA
```

The backend then identifies all eligible tokenized NVDA instruments.

The system should compare:

- Buy price
- Sell price
- Spread
- Liquidity
- Depth
- Slippage
- Token premium/discount
- Provider fees
- Settlement costs
- Required stablecoin
- Required blockchain
- Funding conversion costs
- Redemption options
- User eligibility
- Platform routing fee

The system should calculate the:

> **Best all-in executable route.**

---

## 13. Order Books

Two concepts must remain separate.

### Aggregated Order Book

May only combine liquidity when multiple venues trade the **same fungible token/security**.

### Execution Marketplace

Used when different tokenized instruments represent the same underlying equity.

The platform must never display different securities as if they were one combined order book.

---

## 14. Tokenized Stock Market Data

Tokenized-market data is the primary trading dataset.

The stock page should support:

### Free

- Token price
- Historical chart
- Candlesticks
- Volume
- Bid
- Ask
- Market status

### Individual

Additionally:

- Underlying-stock comparison
- Premium/discount
- Basic technical indicators
- Limit orders

### Pro

Additionally:

- Advanced candlesticks
- SMA
- EMA
- VWAP
- RSI
- MACD
- Level II/order-book data where available
- Market depth
- Time & sales
- Provider comparison
- Execution analytics

---

## 15. Underlying Equity Data

Traditional stock-market data will be used as a reference rather than the primary execution price.

The system should show:

```text
Tokenized NVDA          $182.42
Underlying NVDA         $182.20
Premium                  +0.12%
```

Underlying data may be used for:

- Fair-value comparison
- Premium/discount calculation
- Market-status information
- Execution analysis
- Routing intelligence

The user's actual transaction quote must be based on executable tokenized-market liquidity.

---

## 16. Estimated Liquidation Value

Where adequate liquidity information exists, the portfolio should calculate both:

```text
Market Value
```

and:

```text
Estimated Sell Value
```

Example:

```text
NVDA Token

Market Value             $18,000
Estimated Sell Value     $17,962
Expected Slippage            $31
Expected Costs                 $7
```

This should use executable liquidity rather than last-trade price alone.

---

## 17. Smart Yield

Initial supported assets:

- USDC
- USDT

Potential additional support:

- PYUSD

Initial strategies:

### Conservative

Prioritize liquidity and lower-risk opportunities.

### Balanced

Allow moderately higher risk in exchange for additional expected return.

The engine should consider:

- APY
- Historical APY
- Liquidity
- TVL
- Utilization
- Stablecoin risk
- Protocol risk
- Oracle risk
- Exit liquidity
- Network costs
- Conversion costs
- Reallocation costs

---

## 18. Smart Yield Rebalancing

### Free

Manual yield allocation.

### Individual

Smart allocation and automated/recommended rebalancing.

### Pro

Advanced optimization and analytics.

Initial beta may require user confirmation before rebalancing.

Architecture must support automatic rebalancing later.

---

## 19. Subscription Model

### Free

**$0/month**

Routing fee:

**0.20%**

Includes:

- Multiple wallets
- Unified balance
- Send
- Invest
- Basic tokenized-stock charts
- Manual Earn
- Basic portfolio

### Individual

**$9.99/month**

Routing fee:

**0.12%**

Includes Free plus:

- Smart Yield
- Automated/recommended rebalancing
- Token vs underlying comparison
- Premium/discount
- Basic technical indicators
- Limit orders
- Improved analytics

### Pro

**$29.99/month**

Routing fee:

**0.08%**

Includes Individual plus:

- Advanced technical analysis
- Advanced stock charts
- Market depth
- Order books where available
- Time & sales
- Provider comparisons
- Advanced execution analytics
- Advanced Smart Yield analytics
- Advanced portfolio analytics

### Enterprise

**Custom pricing**

Includes:

- API access
- White-label capabilities
- Unified balance API
- Routing API
- Market-data API
- Execution API
- Yield API
- Custom limits
- SLA
- Volume pricing

Routing fee:

**Negotiated**

---

## 20. Routing Fee Rules

Platform routing fees apply when the platform performs material orchestration.

Example:

```text
USDC / Base
        ↓
Provider accepts USDC / Base

Routing fee:
$0
```

Versus:

```text
USDT / Ethereum
        ↓
Swap
        ↓
USDC
        ↓
Bridge
        ↓
Base
```

Routing fee applies.

Actual:

- Gas
- DEX fees
- Bridge fees
- Provider fees

must be shown separately.

The platform should avoid hidden spreads.

---

## 21. Transaction Preview

Before approving any transaction, the customer should see:

```text
BUY NVIDIA

Investment                  $5,000.00

Funding
Phantom                     $3,000.00
MetaMask                    $2,000.00

Tokenized Provider             Ondo

Routing Fee                    $6.00
Estimated Network Cost         $0.84
Estimated Provider Cost        $X.XX

Estimated Total             $5,006.84

[ Confirm ]
```

Final amounts may be subject to defined slippage tolerances.

---

## 22. Internal Ledger

Every movement of value must be recorded in an internal immutable ledger.

Transactions must track:

- User
- Wallet
- Asset
- Blockchain
- Source
- Destination
- Amount
- USD value
- Platform fee
- Network fee
- Provider fee
- Quote
- Transaction hashes
- Provider identifiers
- Created timestamp
- Settlement timestamp

Required transaction states:

```text
CREATED
QUOTED
USER_APPROVED
SUBMITTED
PENDING
SETTLED
FAILED
REVERSED
```

---

## 23. Reconciliation Engine

The platform must continuously reconcile:

```text
Internal Ledger
        ↕
Connected Wallets
        ↕
Blockchain Transactions
        ↕
Tokenized Stock Providers
        ↕
Yield Providers
```

Any discrepancy must generate an operational alert.

---

## 24. Admin Console

Internal staff must be able to monitor:

- Users
- KYC status
- Eligibility
- Connected wallets
- Wallet balances
- Stablecoin positions
- Stock positions
- Yield positions
- Open orders
- Settled orders
- Failed orders
- Routing quotes
- Pending routes
- Failed routes
- Rebalancing
- Fees
- Revenue
- Provider status
- Blockchain status
- Reconciliation issues
- Manual-review queues

---

## 25. Regulated Partner Architecture

The company will remain primarily a **technology and orchestration platform**.

We will not initially operate our own:

- Broker-dealer
- Securities issuer
- Securities custody system
- Stablecoin
- Blockchain
- Bridge
- Lending protocol
- Money-transmission infrastructure where licensed partner infrastructure can be used

Regulated partners will handle regulated activities where applicable.

---

# Proposed Technical Stack

## Web

- Next.js
- React
- TypeScript

## Mobile

- React Native

## Core Backend

- TypeScript
- NestJS

## Routing / Analytics / Smart Yield

- Python
- FastAPI

## Database

- PostgreSQL

## Caching / Job State

- Redis

## Infrastructure

- AWS

Initial AWS services may include:

- ECS/Fargate
- RDS
- ElastiCache
- S3
- SQS
- KMS
- Secrets Manager
- CloudWatch
- WAF
- CloudFront

---

# MVP User Journey

A successful MVP user should be able to complete the following:

```text
Create Account
      ↓
Complete KYC
      ↓
Eligibility Determined
      ↓
Connect Phantom
      ↓
Connect MetaMask
      ↓
Unified Balance Appears
      ↓
Search NVIDIA
      ↓
Enter $5,000
      ↓
Eligibility Engine
      ↓
Funding Router
      ↓
Equity Execution Router
      ↓
Best Route Presented
      ↓
Customer Confirms
      ↓
Required Wallets Authorize
      ↓
Stablecoins Routed
      ↓
Tokenized Stock Purchased
      ↓
Position Added to Portfolio
      ↓
Remaining Capital Eligible
for Smart Yield
```

---

# MVP Success Criteria

The Epic is considered successfully delivered when:

- A user can connect at least two external wallets simultaneously.
- Supported balances across those wallets are accurately aggregated.
- USDC, USDT, and PYUSD can be identified across supported chains.
- Ethereum, Base, Arbitrum, and Solana are supported.
- The system calculates portfolio value and deployable buying power.
- Transactions can source capital from multiple wallet connections.
- At least two tokenized-equity providers are production-integrated.
- Three tokenized-equity providers are the target before full public launch.
- Provider eligibility is evaluated per customer.
- The same underlying stock can be compared across multiple eligible tokenized instruments.
- The platform can calculate the best all-in execution route.
- Users can purchase and sell tokenized securities through a regulated partner.
- Tokenized market data is displayed correctly.
- The platform distinguishes tokenized-market data from underlying-equity reference data.
- Smart Yield supports at least one production strategy.
- Every financial action is captured in the internal ledger.
- Transaction reconciliation operates automatically.
- Users receive transparent fee estimates before execution.
- Subscription and routing-fee logic works for Free, Individual, and Pro.
- Internal staff can monitor the system through an admin console.
- U.S.-based customers are prevented from accessing the initial international product.
- No customer funds or regulated financial activity are handled directly where the approved partner architecture requires a regulated third party.

---

# Out of Scope for MVP

Do **not** include:

- U.S. launch
- Proprietary blockchain
- Proprietary stablecoin
- Proprietary bridge
- Proprietary tokenized-stock issuance
- Proprietary securities custody
- Broker-dealer infrastructure
- Proprietary lending protocol
- Debit card
- Credit products
- Margin
- Leverage
- Options
- Futures
- Perpetuals
- Copy trading
- Social trading
- Fiat checking accounts
- Large numbers of chains/stablecoins
- Advanced institutional trading tools beyond the defined Pro functionality

---

# Suggested Jira Workstreams

Create child Jira Epics for the following workstreams:

1. Platform Foundation & Authentication
2. KYC & Eligibility Engine
3. Wallet Connection Framework
4. Multi-Wallet Asset Indexing
5. Unified Balance & Buying Power
6. Stablecoin Routing Engine
7. Cross-Wallet Transaction Execution
8. Internal Ledger
9. Reconciliation Engine
10. Tokenized Equity Instrument Model
11. Tokenized Stock Provider — Provider 1
12. Tokenized Stock Provider — Provider 2
13. Tokenized Stock Provider — Provider 3
14. Equity Execution Router
15. Tokenized Equity Market Data
16. Stock Charts & Technicals
17. Execution Marketplace / Order Books
18. Portfolio & Estimated Liquidation Value
19. Smart Yield Discovery
20. Smart Yield Risk Engine
21. Smart Yield Allocation/Rebalancing
22. Subscription & Billing
23. Routing Fee Engine
24. Transaction Preview & Confirmation
25. Admin & Operations Console
26. Monitoring, Security & Incident Handling
27. International Launch & Jurisdiction Controls
28. Enterprise/API Foundation

---

# Recommended Jira Build Order

Use this ordering when assigning dependencies and priorities:

## Phase 1 — Platform Foundation

1. Platform Foundation & Authentication
2. Internal Ledger foundations
3. Admin/operations foundations
4. Monitoring/security foundations

## Phase 2 — Wallet Aggregation

5. Wallet Connection Framework
6. Multi-Wallet Asset Indexing
7. Unified Balance & Buying Power

## Phase 3 — Stablecoin Execution

8. Stablecoin Routing Engine
9. Routing Fee Engine
10. Transaction Preview & Confirmation
11. Cross-Wallet Transaction Execution
12. Reconciliation Engine

## Phase 4 — Eligibility & International Controls

13. KYC & Eligibility Engine
14. International Launch & Jurisdiction Controls

## Phase 5 — Tokenized Equities

15. Tokenized Equity Instrument Model
16. Tokenized Stock Provider — Provider 1
17. Tokenized Stock Provider — Provider 2
18. Tokenized Stock Provider — Provider 3
19. Equity Execution Router
20. Tokenized Equity Market Data
21. Execution Marketplace / Order Books
22. Stock Charts & Technicals
23. Portfolio & Estimated Liquidation Value

## Phase 6 — Smart Yield

24. Smart Yield Discovery
25. Smart Yield Risk Engine
26. Smart Yield Allocation/Rebalancing

## Phase 7 — Commercial Features

27. Subscription & Billing
28. Enterprise/API Foundation

---

# Core Product Principle

The customer chooses the financial outcome.

The platform determines:

- Which wallet funds the transaction
- Which stablecoin is used
- Which blockchain is used
- Whether a swap is required
- Whether a bridge is required
- Which tokenized-stock provider is eligible
- Which tokenized instrument offers the best all-in execution
- Which yield opportunity meets the selected strategy
- How all resulting transactions are tracked and reconciled

The customer should not need to understand the underlying blockchain infrastructure unless they deliberately choose to inspect it.

---

# Product Positioning

> **Connect all your crypto wallets and use your combined stablecoin balance to invest or earn anywhere—we automatically find the best route across wallets, chains, currencies, and tokenized markets.**
