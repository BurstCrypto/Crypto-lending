# Live public-testnet read-only smoke

This local operator tool proves that the four testnet identities already bound
by the application policy are reachable through credential-free public RPCs:

| Network          | Public endpoint                               | Exact identity probe |
| ---------------- | --------------------------------------------- | -------------------- |
| Ethereum Sepolia | `https://ethereum-sepolia-rpc.publicnode.com` | `0xaa36a7`           |
| Base Sepolia     | `https://sepolia.base.org`                    | `0x14a34`            |
| Arbitrum Sepolia | `https://sepolia-rollup.arbitrum.io/rpc`      | `0x66eee`            |
| Solana devnet    | `https://api.devnet.solana.com`               | full genesis hash    |

Run the offline configuration check first, then explicitly invoke the live
smoke test from a local development shell:

```powershell
npm run testnet:live:preflight
npm run testnet:live:smoke
npm run test:testnet:live
```

The live command makes exactly eight HTTPS JSON-RPC reads: one immutable
identity probe and one provider-reported finalized-head probe per network. It has no endpoint
override, API token, account, private key, seed, wallet address, faucet,
transaction, signing, deployment, subscription, retry, or broadcast path. It
refuses production mode and hosted CI. Public endpoints are rate-limited and
may be temporarily unavailable; rerun manually later instead of adding an
automatic retry loop.

## Scope boundary

Passing this smoke test establishes only live EVM/SVM RPC connectivity and
exact network identity at that moment. It does not wire public observations
into the application, authorize financial use, prove provider independence or
SLA, or satisfy the KAN-251/KAN-231 provider and production-egress gates.

The smoke command itself is not an end-to-end lending transaction and remains
strictly read-only. A separate, locally gated application flow can prepare and
verify one browser-wallet proof position as described below; passing this smoke
test does not enable or validate that flow.

## Separate local application proof

`npm run demo:local` enables a narrowly scoped application path only outside
production and hosted CI. It offers two independent proofs: one fixed Aave V3
native-ETH-to-WETH supply on Base Sepolia and one fixed Save/Solend native-SOL
deposit on Solana Devnet. This application path remains distinct from the
four-network read-only smoke above: the smoke remains exactly eight reads and
cannot enable, prepare, sign, broadcast, or verify either application
transaction.

After both chain reviews and disclosures are ready, one **Submit both testnet
deposits** button starts the EVM and SVM proofs without awaiting either. They
share no transaction or authorization, and the one application action produces
two separate wallet approvals: one transaction confirmation in the explicitly
selected MetaMask or Coinbase Wallet and one confirmation in the explicitly
selected Solana Wallet Standard wallet. There is no atomic cross-chain
transaction, implicit approval from one chain to the other, or server-held
signing key. Because the EVM route supplies native ETH through Aave's WETH
gateway, it needs no ERC-20 allowance approval or second EVM approval
transaction.

### Base Sepolia proof

The EVM proof is fixed to Base Sepolia chain ID `84532` (`0x14a34`), public RPC
`https://sepolia.base.org`, explorer `https://sepolia-explorer.base.org`, and the
following Aave V3 deployment:

| Role                   | Fixed Base Sepolia address                   |
| ---------------------- | -------------------------------------------- |
| Addresses provider     | `0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00` |
| Pool                   | `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27` |
| WETH gateway           | `0x0568130e794429D2eEBC4dafE18f25Ff1a1ed8b6` |
| WETH                   | `0x4200000000000000000000000000000000000006` |
| aWETH                  | `0x73a5bB60b0B0fc35710DDc0ea9c407031E31Bdbb` |
| Protocol data provider | `0xBc9f5b7E248451CdD7cA54e717a2BFe1F32b566b` |

The authenticated, exact-origin, CSRF-protected API binds a short-lived,
single-use EVM intent to the account, selected EVM wallet, portfolio snapshot,
and applied allocation. The prepared transaction targets only the fixed WETH
gateway and calls payable `depositETH` for the fixed Pool, connected account,
and referral code `0`, with exactly **0.00005 ETH**. It appends a
domain-separated opaque intent marker after the ABI arguments as trailing
calldata, so otherwise identical deposits remain bound to different intents.
The complete input and nonce are verified. The proof accepts no caller-selected
chain, RPC, target, calldata, recipient, asset, or value. The selected MetaMask
or Coinbase Wallet account is the sole signer and broadcaster. The Aave
provider, contracts, account, transaction data, and balance are public to the
wallet, RPC provider, explorer, and chain.

Fund this proof manually with Coinbase's official CDP faucet:

1. In a dedicated test-only MetaMask or Coinbase Wallet, enable test networks
   and select **Base Sepolia**. Confirm chain ID `84532` (`0x14a34`).
2. Copy the exact connected `0x` address. Never enter a seed phrase or private
   key into this app, a faucet, or configuration.
3. Visit `https://portal.cdp.coinbase.com/products/faucet`, sign in to CDP,
   select **Base Sepolia** and **ETH**, paste the address, and request test ETH.
   The official quickstart is
   `https://docs.cdp.coinbase.com/faucets/introduction/quickstart`.
4. Confirm the address has at least **0.0001 Base Sepolia ETH** in the wallet or
   official Base Sepolia explorer. The proof supplies 0.00005 ETH and preserves
   the remainder for testnet gas.

Base Sepolia ETH is valueless test currency. Do not purchase it or transfer
Mainnet ETH. Faucet limits and availability are external. The app and API never
call the faucet, collect a key, or sign for the wallet.

The EVM proof reports confirmed only after a successful receipt and exact checks
of chain, sender, gateway, value, calldata, Aave supply evidence, and resulting
aWETH position against Base's latest state. That L2 receipt normally appears in
seconds, but it is not Base finality. Finality is tracked separately and
commonly arrives about 20 minutes later. A current dashboard can show the
confirmed position while finality is pending; neither documentation nor UI
should relabel latest-state confirmation as finalized.

Before `eth_sendTransaction`, the browser must durably write and read back a
same-tab EVM recovery lock. If the wallet returns a transaction hash, the
browser binds that exact hash to the lock. A reload can query only its receipt,
logs, position, and finality and cannot invoke the wallet write again. A known
pending hash keeps the EVM send path locked without blocking Solana. EVM has no
Solana-style last-valid-block-height expiry. An explicit wallet rejection or
verified failed receipt can permit a fresh, separately confirmed attempt; an
ambiguous result, including one without a returned hash, remains locked and
never triggers an automatic resend. Inspect the selected wallet's activity and
the Base Sepolia explorer before taking another action.

### Solana Devnet proof

The Solana path retains its independent authenticated intent, Wallet Standard
approval, fixed Save/Solend route, and one-shot API submission. The intent is
bound to the account, Solana wallet, portfolio snapshot, and applied liquidity
percentage. After refreshed finalized deployment checks, the API prepares one
exact six-instruction core for a **0.01 native Devnet SOL** deposit. It accepts
no arbitrary RPC, program, account list, amount, instruction, or transaction
message and has no wallet key, server signer, arbitrary relay, airdrop, or retry
API.

Every message begins with a domain-separated memo containing only its opaque
intent ID, followed by the five fixed account-setup and lending instructions.
Phantom may prepend only `SetComputeUnitPrice` followed by
`SetComputeUnitLimit`; the verifier requires exactly 200,000 compute units, at
most 500,000 micro-lamports per unit, and at most 100,000 lamports (0.0001 SOL)
of priority fee. It rejects every other addition or reordering and every change
to the reviewed core. The user must inspect Phantom's total fee before
approving.

The Wallet Standard wallet is the sole signer. The browser gives the signed
legacy bytes to the authenticated same-origin API, which revalidates the fee
payer, sole Ed25519 signature, exact reviewed message or bounded compute-budget
prefix, and 1,232-byte wire limit before making one fixed Devnet
`sendTransaction` request. The Save/Solend program and accounts are public to
the wallet, RPC provider, explorer, and chain.

The API verifies finalized evidence for the exact core, optional bounded
compute-budget prefix, signer, programs and accounts, 0.01 SOL amount, successful
lending instruction, and resulting cSOL position increase. It checks the exact
last-valid block height immediately before the only allowed send. Definite RPC
rejection and ambiguous transport outcomes are distinct, and neither causes an
automatic resend. The browser records the known signature before submission;
later recovery calls contain only that signature and are read-only. Pending or
confirmed-but-not-finalized evidence remains pending. Missing public-RPC data is
not evidence that a signed transaction failed to land.

Funding is manual and free through the official Solana faucet at
`https://faucet.solana.com/`. Use only valueless Devnet SOL; do not buy it and
never provide a private key or seed phrase. The API does not request an airdrop.

### Independent dashboards and persistence

Each proof has its own intent, send lock, recovery state, explorer link, and
read-only dashboard. The Base dashboard derives the fixed aWETH position and
reads the Aave reserve; the Solana dashboard derives the fixed cSOL account and
reads finalized Save/Solend reserve state. Both show an estimated supplied
balance and only the latest on-chain variable base supply APY, exclude rewards
and risk assessment, and disclose stale or finality state. There is no
historical rate series, so neither current sample is labeled a "usual," average,
expected, or historical APY.

Restarting the API clears ephemeral intent records but cannot undo either
public-chain transaction. The dashboard withdrawal surface prepares separately
reviewed full-position exits for the same fixed deployments and same connected
wallets. One app action launches every eligible lane, but the Base Sepolia and
Solana Devnet writes remain independent and non-atomic. Base may require an
aWETH approval transaction before its Aave withdrawal; Solana redeems cSOL and
unwraps the returned WSOL atomically in one transaction. Partial success is
reported explicitly, and neither lane automatically retries or compensates for
the other. Server egress remains fixed and bounded, redirects and automatic
retries remain disabled, and the features are disabled in production and hosted
CI.

Public endpoint references:

- https://docs.base.org/base-chain/quickstart/connecting-to-base
- https://docs.base.org/base-chain/network-information/troubleshooting-transactions
- https://docs.cdp.coinbase.com/faucets/introduction/quickstart
- https://portal.cdp.coinbase.com/products/faucet
- https://github.com/aave-dao/aave-address-book/blob/12963110f29699d214531b9ab4c7cfcec460c298/src/ts/AaveV3BaseSepolia.ts
- https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/helpers/WrappedTokenGatewayV3.sol
- https://docs.arbitrum.io/for-devs/dev-tools-and-resources/chain-info
- https://solana.com/docs/references/clusters
- https://faucet.solana.com/
- https://docs.save.finance/architecture/addresses/devnet
- https://docs.save.finance/developers/introduction
- https://github.com/solendprotocol/solana-program-library/blob/mainnet/token-lending/sdk/src/instruction.rs
- https://github.com/solendprotocol/solana-program-library/blob/mainnet/token-lending/program/src/processor.rs
- https://github.com/solendprotocol/public/blob/master/solend-sdk/src/core/actions.ts
- https://ethereum.org/developers/docs/networks/
