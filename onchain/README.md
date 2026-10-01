# CCTP USDC execution

This package implements source-chain platform fee collection with Circle CCTP v2
Standard Transfers between Ethereum and Solana. It contains Solidity contracts,
unsigned transaction builders, Circle fee/attestation reads, and local tests.
The development-only [local mainnet test page](../tools/local-mainnet/README.md)
connects these builders to authenticated preparation, browser wallets, a SQLite
journal, and finalized receipt verification. The package itself never broadcasts
funds. Public wallets and treasuries must be configured, and both Ethereum routers
must be deployed through the user's wallet. Production execution stays disabled.

| Direction          | Source transaction                                          | Destination transaction after attestation                         |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Ethereum to Solana | Ethereum USDC platform fee to Ethereum treasury + CCTP burn | CCTP mint to user's USDC ATA + supply to Kamino main USDC reserve |
| Solana to Ethereum | Solana USDC platform fee to Solana treasury ATA + CCTP burn | CCTP mint to user + supply to the configured Aave USDC pool       |

The fee and burn are atomic **on the source chain**. The combined destination
mint and supply are atomic **on the destination chain**. There is no single
atomic transaction across both chains. If destination execution fails, resume
destination work using the original source burn; the completed source fee is
not automatically refunded. Ordinary network transaction fees can still apply
to failed transactions.

## Amounts and ownership

All amounts are integer USDC atomic units (six decimals). Existing application
policy is preserved: FREE 20 bps, INDIVIDUAL 12 bps, PRO 8 bps, added on top of
the principal with half-even rounding. For a 1,000 USDC FREE-tier transfer, the
user pays 1,002 USDC on the source chain: 2 USDC to its treasury and 1,000 USDC
to CCTP. Direct compatible supplies take zero platform fee.

Circle's transfer fee is separate. `getCircleStandardFee` reads the current
2000-finality fee for domains 0 and 5 and rounds the required atomic amount up.
The approved `maxBridgeFee` bounds Circle's deduction; the pool receives
`principal - feeExecuted`. Never assume Circle's fee stays zero. Gas, Solana
account rent, and priority fees are separate from both USDC fees.

CCTP always mints to the user's destination address, or their canonical USDC
associated token account (ATA) on Solana. Ethereum supplies issue Aave aTokens
to the caller. Solana reserve supplies issue Kamino collateral receipt tokens
(cTokens) to the user's ATA. This is a reserve deposit, **not a Kamino borrowing
obligation**; application position indexing must include these cToken holdings
before displaying the resulting lending position. Kamino's deposit instruction
uses the protocol's exchange rate and has no caller-specified minimum cToken
output argument. Confirm the resulting position from finalized chain data.

## Local verification

From this directory, with Node 22.13+:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run typecheck
npm test
```

This is an independent npm package, outside the web/API workspaces. Build output
is under ignored `build/`. Compilation uses pinned solc 0.8.30, Cancun EVM, and
200 optimizer runs. CI repeats build, typecheck, and tests without deployment.

Ethereum tests deploy the actual Bonsai contracts into an in-process Hardhat
EVM and execute mined transactions against protocol doubles. They cover fee
math, source rollback, signed intent changes, replay, permit, destination
mint/supply, and destination recovery. The doubles do not implement Circle
attestation cryptography or Aave reserve accounting.

Solana tests check official instruction layouts, account derivation, wallet
signatures, message substitution, lookup-table serialization, and destination
composition. They do **not** execute the Circle or Kamino BPF programs. Circle
HTTP tests use injected responses. Passing these tests is not evidence of a live
CCTP transfer or deployed contract compatibility.

## Contracts and builders

- `contracts/BonsaiCctpSourceRouter.sol`: non-upgradeable Ethereum source router
  with immutable USDC, Circle TokenMessengerV2, treasury, and quote authority.
  `bridge` takes principal plus fee and burns only principal. `bridgeWithPermit`
  supports a USDC-native EIP-2612 permit so an EOA can authorize allowance with
  a signature instead of an extra approval transaction. Without sufficient
  allowance or a supported permit, approval remains a separate transaction.
- `contracts/BonsaiAaveSupplyRouter.sol`: immutable USDC, pool, aToken, and Circle
  MessageTransmitterV2. `mintAndSupply` requires the exact newly minted USDC to
  appear in the caller's wallet before supplying it. `mintAndSupplyWithPermit`
  also accepts an exact USDC permit. `supply` handles direct deposits or recovery
  when another relayer has already minted to the user. None charges a platform
  fee. Failed mint/supply rolls back the entire destination transaction.
- `src/source-plan.ts`: mainnet USDC identities, source treasury selection,
  authenticated-tier fee calculation, bounded amounts, and EIP-712 intent types.
  Quote signatures bind chain, router, user, recipient, principal, fee tier,
  limits, deadline, and intent ID. They authorize a quote; the user still
  authorizes their own transaction. Quotes have a maximum five-minute lifetime.
- `src/ethereum-source.ts`: unsigned Ethereum source and direct supply calldata.
- `src/solana-source.ts`: source USDC fee transfer plus the native Circle
  `deposit_for_burn_with_hook` instruction in one wallet transaction. Source
  preparation requires a fresh blockhash and client-generated event-account
  keypair. The event signature is included before the user signs.
- `src/circle-client.ts`: bounded GET requests to Circle's mainnet Iris API.
  Attestation polling is one request per call; it never repeats a burn.
- `src/cctp-mint.ts`: matches the raw attested message against the original
  intent, including domains, source sender/token, recipient, amounts, finality,
  and `BNS1 || intentId` hook. Builds native destination mint instructions.
  The hook carries correlation data; it does not automatically execute lending.
- `src/destination-lending.ts`: combined destination mint and pool supply.
  Solana targets the same main USDC reserve as the application's Kamino read
  manifest. Transaction lookup tables must be real accounts read from the
  admitted Solana chain; mint plus supply must fit the 1,232-byte limit.
- `src/solana-destination-verification.ts`: checks the complete signed message
  and every required Ed25519 signature against a private preparation snapshot.
- `src/source-submission.ts`: reserve-before-wallet submission guard and
  destination recovery state transitions. The host must supply a durable,
  atomic, authenticated `SourceSubmissionJournal`; there is no database adapter
  or HTTP endpoint in this package.

Solana fee collection is enforced by the complete signed transaction. There is
no custom Bonsai Solana program or on-chain per-intent registry. A wallet owner
can independently use Circle directly. The submission guard prevents duplicate
source requests within the integrated application only when backed by the
required durable journal. Never rebuild a source transaction with a fresh
blockhash or event account as a destination recovery step.

## Application integration and deployment

These TypeScript modules use Node APIs and are server-side preparation and
verification modules. They are not directly importable into a Next.js client
component. The host must expose authenticated preparation/verification and
durable intent endpoints; the browser wallet signs and broadcasts the approved
transaction bytes. `apps/web/lib/local-mainnet` implements this host for a single
local tester. It uses the tester's Ethereum wallet as the source quote authority
and fixes the fee tier to FREE (20 bps); it does not supply a production quote
signing service. Existing production mainnet action providers remain unregistered.

1. After the cold-storage wallets exist, configure their **public** Ethereum and
   Solana receiving addresses. The Solana fee instruction derives the treasury's
   USDC ATA and creates it idempotently if necessary. Supply an Ethereum quote
   authority public address and its signing-service integration. User keys and
   treasury signing keys are not deployment configuration.
2. Select and verify the public Circle v2 Ethereum contract addresses and Aave
   USDC pool/aToken deployment. Deploy both compiled Bonsai contracts with those
   constructor arguments. Check their bytecode and immutable getters before
   constructing execution calldata. The contracts have no admin setters;
   changing their immutable destinations requires a new deployment.
3. Persist the original intent, quote creation time/deadline, authenticated fee
   tier, source/destination wallets, selected destination market, limits, and
   prepared transaction fingerprint. Sign Ethereum quotes with EIP-712 domain
   `BonsaiCctpSourceRouter`, version `1`, chain ID `1`, and the deployed source
   router. Read the actual USDC permit domain and nonce when preparing permits;
   the test token's domain is not mainnet USDC's domain.
4. Before wallet submission, recheck source chain identity, selected account,
   quote expiry, current balances/allowance, configured deployment, and a
   successful RPC simulation. Solana uses `getGenesisHash` for chain admission;
   Circle's Solana program IDs are also deployed on devnet. Validate blockhash
   lifetime, network fees, rent, and actual lookup table contents. Reserve the
   source intent durably before asking the wallet to submit. Solana's quote
   deadline is enforced at preparation/submission; its native program enforces
   transaction blockhash lifetime, not the Bonsai quote deadline.
5. Verify the signed source message, broadcast from the user's browser wallet,
   and record the transaction ID. After finality, verify the original sender,
   treasury fee, burn and emitted CCTP message/event account against the intent.
   An ambiguous wallet result keeps the source reserved pending reconciliation;
   a timeout does not prove a failed burn. API status and message field matching
   alone are not source finality or fee-payment evidence.
6. Poll Circle by the recorded source transaction ID. Bind the raw complete v2
   message to the persisted intent and emitted source message, accounting for
   Circle's attestation-populated nonce/finality/fee fields. The destination
   MessageTransmitter verifies the attestation cryptographically. This package
   accepts Standard finalized messages with no expiration block; it does not
   implement Fast Transfer or re-attestation of expiring messages.
7. Prepare and simulate the destination mint-and-supply transaction. Use the
   Circle fee recipient read from its Solana TokenMessenger state, and real
   lookup tables. The destination wallet signs separately. On Ethereum it needs
   the exact supply allowance or a native permit. Verify signed bytes, submit,
   and wait for finalized mint and lending-position evidence before marking the
   intent `LENT`.
8. If permissionless minting was already completed by another relayer, verify
   the nonce and recipient balance, then prepare only a destination supply. If
   lending fails, the user can choose mint-only recovery and retain USDC in
   their wallet. Do not charge another source fee. Rehydrate the **original**
   stored plan for recovery; do not extend its source deadline or create a new
   source intent.

The local host verifies deployment bytecode/getters, persists reservations, and
checks Aave aUSDC or Kamino cToken receipt evidence. A complete live transfer and
production deployment/position indexing remain unverified. No placeholder
treasury address is supplied by the implementation.

## Protocol references

- [Circle technical guide and message formats](https://developers.circle.com/cctp/references/technical-guide)
- [Circle Solana programs and ATA recipients](https://developers.circle.com/cctp/references/solana-programs)
- [Circle transfer fee API](https://developers.circle.com/cctp/howtos/get-transfer-fee)
- [Circle messages and attestations API](https://developers.circle.com/api-reference/cctp/all/get-messages-v2)
- [Pinned Circle Solana v2 source](https://github.com/circlefin/solana-cctp-contracts/tree/ec16e95d28ee47f7832df4203ae07b5981d146fc)
- [Circle EVM TokenMessengerV2](https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/TokenMessengerV2.sol)
- [Aave pool supply and recipient semantics](https://aave.com/docs/aave-v3/smart-contracts/pool)
- [Pinned Kamino reserve supply interface](https://github.com/Kamino-Finance/klend-sdk/blob/38845294447623f6de3afc9dec29875f959f6f48/src/%40codegen/klend/instructions/depositReserveLiquidity.ts)
- [Solana transaction atomicity](https://solana.com/docs/core/transactions)
