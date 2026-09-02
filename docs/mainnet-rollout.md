# Mainnet rollout boundary

## Selected direction

- The first live-data and financial-integration candidate remains **Base
  mainnet** (`eip155:8453`). Ethereum and Solana are separate product and
  protocol integrations; registering ownership of an account on either chain
  does not approve its data providers, lending protocols, or transactions.
- The production wallet-registration allowlist is chain-qualified and limited
  to Base (`eip155:8453`), Ethereum (`eip155:1`), and Solana
  (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`). A user account may register
  multiple wallets across those chains, but each proof and stored roster entry
  remains bound to one exact chain and address.
- Account identity uses Amazon Cognito User Pools through the existing managed
  OIDC boundary. Wallet ownership remains a separate, account-bound message
  proof.
- The existing Base Sepolia and Solana Devnet transaction-proof modules remain
  test-only. They must never be relabeled, imported by a mainnet module, or
  enabled by changing an environment name.
- Initial mainnet delivery is authenticated and read-only. It may request one
  explicit, user-approved ownership message after account verification:
  `personal_sign` for an allowlisted EVM chain or `signMessage` for Solana. No
  mainnet transaction builder, transaction signature request, transaction
  submission, or broadcast is enabled by this decision.

The dated critical path, ten-provider program target, count definitions, and
go/no-go checks are tracked in the
[production go-live plan](production-go-live-plan.md). A provider appearing in
the checked-in research catalog does not make it live, readable from production,
or transaction-enabled.

## Required architecture boundary

Any future financial action must use a new mainnet bounded context with its own
routes, response types, intent domain, durable storage, provider registry,
contract manifest, recovery state, audit events, and per-chain kill switch.
Mainnet mode must be an explicit no-default allowlist; it must not be inferred
from `NODE_ENV`, `APP_ENV`, `LOCAL_DEMO_MODE`, or the public-testnet flags.

For every chain, the browser wallet remains the only possible transaction
signer and broadcaster. The API may eventually prepare and verify a bounded
intent after separate approval, but it must not hold a signing key or relay a
transaction.

## Gates before read-only live data

1. Approve two independent RPC/indexing providers for every live-read chain,
   including their exact hosts, plans, regions, quotas, credentials, and spend
   alarms.
2. Approve controlled outbound access under KAN-231. The current ECS baseline
   has no general internet egress and cannot reach Cognito OAuth/JWKS or any
   mainnet RPC endpoint.
3. Pin reviewed deployment manifests and the exact supported-asset registry for
   each counted provider and chain. Validate chain identity, bytecode or program
   identity, proxy implementation, market, oracle, pause/freeze, cap, and drift
   before accepting data.
4. Replace the unavailable production portfolio readers with chain-specific
   provider adapters. The server coverage contract must report every active
   `{walletId, networkId}` target as `COMPLETE`, `PARTIAL`, or `UNAVAILABLE` and
   must fail closed on missing, extra, stale, divergent, incomplete, or
   regressing evidence. Define an explicit server-owned `staleAfter` deadline
   and focus/revalidation policy so a long-lived page cannot claim indefinite
   freshness. The browser must reconcile the returned chain and wallet totals
   and must never render unread coverage as zero.
5. Complete non-production Cognito callback, secure-cookie, logout, recovery,
   MFA, JWKS-rotation, and outage evidence.

## Additional gates before any real-value write

- Approve the exact Aave market, supplied asset, and transaction meaning.
- Encode hard per-transaction, per-wallet daily, global daily, and total-value
  ceilings. All limits default to zero.
- Encode absolute and percentage gas caps, a post-transaction gas reserve, one
  unresolved transaction per wallet, and no automatic resend or fee escalation.
- Use exact allowances by default. Any unlimited allowance needs a separate
  security decision and explicit user disclosure.
- Persist idempotent intents and reconciliation state durably; handle ambiguous
  outcomes and reorgs without resubmitting.
- Define provisional, safe, finalized, and accepted financial-finality states.
- Exercise pause, provider divergence, deployment drift, recovery, withdrawal,
  and incident runbooks in a fork or simulation, then obtain independent
  security review.
- Start with allowlisted staff wallets and an organization-approved tiny canary
  ceiling. Raising a limit or expanding the allowlist is a separate reviewed
  release.

Solana wallet ownership registration does not approve a Solana lending
integration. The current Devnet Save module includes deployment-specific
accounts and an API broadcast path; it remains test-only and requires an
independent protocol, asset, custody, provider, and rollout decision before any
mainnet read or write is enabled.

## Current safety statement

No code in this rollout boundary authorizes a mainnet financial action. The
wallet flow can make injected-provider connection and exact chain checks and
can ask for one user-approved ownership-only message signature; it cannot
request a transaction signature. No public Base, Ethereum, or Solana
RPC/indexing request, transaction submission, broadcast, provider account,
cloud deployment, or paid resource is created by the local implementation.
