# KAN-256 local EVM development chain

This tool runs a keyless Hardhat 3 EDR simulated L1 entirely on the IPv4
loopback interface. It gives the existing EVM balance indexer, balance-sync
orchestrator, and local-demo portfolio a real JSON-RPC/EVM state boundary
without a provider account, public testnet, hosted endpoint, faucet, gas spend,
or cloud resource.

This is an EVM development chain with automatic local block production. It is
not a decentralized network, proof-of-stake node, or consensus validator, and
it is not evidence that a public testnet or production validator works.

## Fixed identity

| Property     | Value                                        |
| ------------ | -------------------------------------------- |
| Runtime      | `LOCAL_EVM_HARDHAT`                          |
| Engine       | `hardhat-edr-simulated`                      |
| Network      | `eip155:31337`                               |
| RPC          | `http://127.0.0.1:18545`                     |
| Control      | `http://127.0.0.1:18546/control`             |
| Accounts     | none                                         |
| Controller   | `0x000000000000000000000000000000000000c0de` |
| Asset        | mock USDC, 6 decimals                        |
| Contract     | `0x0000000000000000000000000000000000000101` |
| Initial time | `2026-08-25T00:00:00.000Z`                   |

The API and tool read the same exact manifest at
`apps/api/src/blockchain/domain/local-evm-development-manifest.json`. The local
registry is deliberately separate from KAN-61's `MAINNET` and `TESTNET`
registries. Its provisional `latest` observations are display-only; canonical
and financial tiers remain blocked pending live proof. The production
portfolio domain and HTTP schema remain `MAINNET`-only.

## Safety boundary

- Hardhat is pinned to exactly `3.14.0`. Runtime commands never install,
  compile, download, or deploy anything.
- The node binds exactly `127.0.0.1`; aliases, wildcard binds, alternate ports,
  redirects, and alternate chain IDs are rejected.
- A supervisor-owned control endpoint binds exactly
  `http://127.0.0.1:18546/control`. Every launch creates a new random launch ID
  and control capability. Requests and responses use fresh nonces and
  HMAC-SHA-256 proofs; the capability is never printed.
- The child receives only an operating-system environment allowlist. Ambient
  proxy, provider, RPC, oracle, and vendor variables fail closed before spawn.
- Hardhat accounts are configured as an empty list. Fresh initialization
  installs the mock bytecode and unlocks a fixed synthetic controller that has
  no key. Its legacy transactions use gas price zero on a deterministic
  zero-base-fee chain, so no signing key, mnemonic, faucet, or real gas spend is
  needed.
- Hardhat output is discarded because RPC logging can contain request data.
  Lifecycle output contains only the fixed local identity and status.
- JSON-RPC methods, response size, timeout, HTTP status/content type, response
  envelope, chain identity, deployed bytecode, pinned block identity, wallet
  address, contract address, and returned balance word are bounded and checked.
- The launch identity, capability, random per-child instance identity,
  lifecycle state, purpose, and diagnostic PIDs live only in a mode-`0600`
  ownership record under ignored `.local-validation/kan-256`. Stored PIDs are
  never trusted for external signaling or process adoption.
- External start, reset, balance-mutation, and teardown commands authenticate to
  the live supervisor. Only that supervisor stops or replaces Hardhat through
  the `ChildProcess` handle it created.
- Every Hardhat child must inherit a private operating-system IPC descriptor
  from that supervisor and exits when the descriptor disconnects. This leash
  also closes the RPC child if the supervisor is force-terminated before its
  JavaScript cleanup can run.
- Graceful shutdown first closes control admission and waits for every admitted
  request handler. It then stops the final current child and removes the exact
  ownership record, so a concurrent reset cannot create an orphan after cleanup
  selected an earlier child.
- A matching but unauthenticated, unowned, or otherwise ambiguous RPC/control
  endpoint fails closed. Stale local ownership state is cleared only after both
  fixed loopback endpoints are proven absent.

Do not pass a real wallet, seed phrase, private key, credential, customer
record, or production balance to this tool.

## Lifecycle

Install the locked repository dependencies once. Dependency installation can
contact the npm registry; the commands below do not require or authorize any
public RPC, provider, cloud, or vendor connection.

Start the chain in an attached terminal:

```powershell
npm run local-evm:start
```

Startup creates a fresh Hardhat child, installs the mock ERC-20 code, clears
balances, starts the authenticated control server, and prints only the fixed
LOCAL identity. Starting again authenticates the live supervisor, verifies the
launch purpose, and requests the same full reset as the reset command.

Reset code and state without changing the endpoint or identity:

```powershell
npm run local-evm:reset
```

Reset never relies on EVM snapshot metadata. The authenticated supervisor stops
the child through its retained `ChildProcess` handle, waits for it to exit,
starts a fresh child, and reinstalls only the deterministic contract code.

Set a local test wallet's USDC atomic balance. The command authenticates to the
supervisor and submits one sender-gated, zero-fee local transaction per wallet
and asset. Hardhat mines those transactions sequentially into coherent blocks;
the tool validates each exact successful receipt and proves the previously
observed block hash, code, and balance remain immutable:

```powershell
npm run local-evm:set-balance -- --wallet 0x1111111111111111111111111111111111111111 --usdc-atomic 1234500000
```

Request an authenticated stop and removal of the owned local state:

```powershell
npm run local-evm:teardown
```

External commands never signal a stored PID. Teardown sends `STOP`; the
supervisor returns the authenticated acknowledgement, closes further control
admission, drains admitted handlers, stops its then-current Hardhat child
through the retained handle, and removes the exact ownership record. The
Windows lifecycle tests exercise the actual wrappers and adversarial stale,
reused-PID, missing-owner, occupied-endpoint, concurrent-reset/shutdown, and
forced-supervisor-death cases. Forced-death coverage proves the IPC-tethered
child exits, both ports close, the exact stale record is safely recovered, and
a later authenticated start succeeds.

## Product data path

The local-demo launcher reads the per-launch identity and capability from the
ignored ownership record and injects them dynamically as
`LOCAL_EVM_CONTROL_LAUNCH_ID` and `LOCAL_EVM_CONTROL_CAPABILITY` into the API
child. They are not static configuration and are not logged.

On the first portfolio read in an application lifetime, the isolated
`LocalDemoChainPipeline` sends an authenticated `SET_BALANCES` command for each
connected EVM fixture wallet. Later reads do not reseed that wallet, so an
intentional balance mutation survives and is observed by the next
synchronization. Authenticated `STATUS` and `SET_BALANCES` responses carry the
random current child-instance identity. The pipeline checks that identity
before and after seeding and synchronization, commits its initialized-wallet
cache only after same-instance validation, and invalidates it on any change.
This detects a full child reset even when the new height equals or exceeds the
old height.

Each read then follows the real local product path:

1. verify `eth_chainId == 0x7a69`;
2. obtain and retain the latest block number, hash, and parent hash;
3. re-read that exact block and verify the exact mock-USDC bytecode at its
   pinned tag;
4. pin `eth_call balanceOf(address)` to that exact tag;
5. recheck the bytecode and pinned block after the call;
6. normalize only against the LOCAL mock-USDC registry;
7. index through `EvmStablecoinBalanceIndexer`;
8. synchronize through `BalanceSyncOrchestrator`; and
9. aggregate and return the authenticated local-demo portfolio with
   `mayAuthorizeFinancialAction: false`.

The web client accepts `eip155:31337` and the mock-USDC contract only in its
isolated local-demo response adapter and renderer. That adapter validates the
remaining shape, accounting, freshness, and registered identities through the
unchanged shared parser. Wallet registration/list projections remain exact
Sepolia and Solana devnet identities; the shared production browser network and
asset allowlists are not widened.

The local-demo launcher starts this owned chain before the API. Its teardown
also stops the chain before inspecting/removing demo-owned Docker resources.

## Verification

```powershell
npm run test:local-evm
npm test --workspace @crypto-lending/api -- src/local-demo/local-evm-chain.runtime.spec.ts src/local-demo/local-demo-portfolio.service.spec.ts src/blockchain/application/local-evm-stablecoin-balance-indexer.spec.ts src/blockchain/domain/local-evm-development.spec.ts src/blockchain/domain/chain-observation-policy.spec.ts
npm run test:e2e --workspace @crypto-lending/api -- local-demo-authentication.e2e-spec.ts
npm run typecheck --workspace @crypto-lending/api
npm run lint --workspace @crypto-lending/api
npm run security:scan:secrets
```

`test:local-evm` performs a real chain-backed product probe. It reads the
initial 7,000,000,000 atomic units, mutates the same wallet to 1,234,500,000 in
a mined local transaction, resynchronizes through the same portfolio service
instance, and verifies the new 123,450-cent portfolio and distinct
snapshot. The chain regression also re-reads the earlier explicit block tag and
proves its hash and balance are unchanged after the later mutation. The e2e test
independently proves the authenticated HTTP response changes after its injected
chain runtime advances.

## Deliberate limitations

- There is no peer-to-peer network, consensus, staking, validator duty,
  production finality, reorg/fork simulation, or public-testnet connectivity.
- The mock contract exposes `balanceOf(address)`, `decimals()`, and a fixture
  `setBalance(address,uint256)` gated to the keyless synthetic controller. It
  has no transfer, approval, mint, signed-user transaction, or event surface.
- Solana balance state and price evidence in the broader local demo remain
  deterministic in-memory fixtures. Only the EVM stablecoin balance crosses a
  real local chain boundary.
- Local valuation still uses fixed approved demo price evidence. It proves
  composition, not market price, liquidity, credit, or financial availability.
- State is intentionally ephemeral and resettable. It is not durable indexer
  or production persistence evidence.
