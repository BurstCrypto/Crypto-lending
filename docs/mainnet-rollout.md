# Base mainnet rollout boundary

## Selected direction

- The first production chain is **Base mainnet** (`eip155:8453`). Ethereum
  mainnet is not an interchangeable configuration value; it would be a
  separate product and protocol integration.
- Account identity uses Amazon Cognito User Pools through the existing managed
  OIDC boundary. Wallet ownership remains a separate, account-bound message
  proof.
- The existing Base Sepolia and Solana Devnet transaction-proof modules remain
  test-only. They must never be relabeled, imported by a mainnet module, or
  enabled by changing an environment name.
- Initial mainnet delivery is authenticated and read-only. It may request one
  explicit, user-approved `personal_sign` ownership message after account
  verification. No mainnet transaction builder, transaction signature request,
  transaction submission, or broadcast is enabled by this decision.

## Required architecture boundary

Any future financial action must use a new mainnet bounded context with its own
routes, response types, intent domain, durable storage, provider registry,
contract manifest, recovery state, audit events, and per-chain kill switch.
Mainnet mode must be an explicit no-default allowlist; it must not be inferred
from `NODE_ENV`, `APP_ENV`, `LOCAL_DEMO_MODE`, or the public-testnet flags.

For Base, the browser wallet remains the only transaction signer and
broadcaster. The API may prepare and verify a bounded intent, but it must not
hold a signing key or relay an EVM transaction.

## Gates before read-only live data

1. Approve two independent Base RPC/indexing providers, their exact hosts,
   plans, regions, quotas, credentials, and spend alarms.
2. Approve controlled outbound access under KAN-231. The current ECS baseline
   has no general internet egress and cannot reach Cognito OAuth/JWKS or Base
   RPC endpoints.
3. Pin a reviewed Aave Base deployment manifest and exact supported-asset
   registry. Validate chain identity, bytecode/proxy implementation, reserve,
   oracle, pause/freeze, supply cap, and deployment drift before accepting data.
4. Add a dedicated Base-only server read/filter contract, then replace the
   unavailable production portfolio readers with provider adapters that fail
   closed on out-of-scope networks and stale, divergent, incomplete, or
   regressing evidence. Define an explicit server-owned `staleAfter` deadline
   and focus/revalidation policy so a long-lived page cannot claim indefinite
   freshness. The browser deliberately rejects the API's broader multi-mainnet
   content until that boundary exists.
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

Solana mainnet is outside this first-chain decision. Its current Devnet Save
integration includes deployment-specific accounts and an API broadcast path;
it requires an independent protocol, asset, custody, provider, and rollout
decision before any mainnet work.

## Current safety statement

No code in this rollout boundary authorizes a mainnet financial action. The
wallet flow can make injected-provider connection and chain checks and can ask
for one user-approved ownership-only message signature; it cannot request a
transaction signature. No public Base RPC/indexing request, transaction
submission, broadcast, provider account, cloud deployment, or paid resource is
created by the local implementation.
