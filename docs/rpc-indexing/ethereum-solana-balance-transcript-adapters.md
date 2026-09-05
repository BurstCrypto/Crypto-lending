# Ethereum and Solana balance transcript adapters

- Status: `IMPLEMENTED_DORMANT_TRANSCRIPT_BOUNDARY` / `LIVE_RPC_UNAVAILABLE`
- Networks: Ethereum mainnet and Solana mainnet-beta only
- Assets: USDC, USDT, and PYUSD only, bound to KAN-61 mainnet registry version 1
- Runtime registration: none

The balance-sync slice now contains provider-neutral JSON-RPC adapters that can
turn a deterministic, injected transcript into a `BalanceIndexerCandidate`.
They create no client, endpoint, hostname, credential, retry loop, DNS lookup,
socket, or external request. Neither adapter nor a transport implementation is
registered in a Nest module or worker process.

The shared transport contract accepts an immutable JSON-RPC request and returns
`unknown`. The adapters bound response size, require a plain data object and an
exact JSON-RPC success/error envelope, bind the response ID, reject unknown
fields at the consumed object boundaries, and map provider/transport outcomes
to fixed `BalanceSyncIndexerFailure` codes. Provider messages, URLs, addresses,
hashes, amounts, and credentials are not copied into exceptions.

Offline production preflight now SHA-256 pins the exact shared JSON-RPC helper
and both adapter sources. Its independent semantic check requires the shared
injected `BalanceJsonRpcTransport` interface, rejects direct HTTP/client, URL,
credential, environment, timer, retry-loop, or Nest registration capability,
and proves the helper and adapter identities remain absent from runtime,
module, activation, and CLI launch roots. Their existing public barrel exports
remain source-level API exposure only; they do not register or construct a
transport. This local check neither chooses an endpoint nor changes any live
RPC, egress, deployment, or provider-evidence blocker.

Before address decryption, each adapter copies only `accountId`, `walletId`,
and its exact mainnet `networkId` into a frozen resolver scope. This matches the
real PostgreSQL resolver's closed three-key contract; `tier` and `selector` are
never forwarded into that persistence boundary.

## Ethereum mainnet

The Ethereum adapter requires `eip155:1`, brackets its read with exact
`eth_chainId = 0x1` checks, and accepts only the policy pairings
`PROVISIONAL/latest`, `CANONICAL/safe`, and `FINANCIAL/finalized`.

It resolves one canonically validated EVM wallet address through the scoped
address port and selects a block with `eth_getBlockByNumber`. Every subsequent
`eth_getCode` and `eth_call` uses the EIP-1898 block parameter
`{ blockHash: <selected hash>, requireCanonical: true }`; it never substitutes
the block number. This binds every state read to the recorded source hash and
forces a compliant provider to fail if that hash becomes noncanonical during
the bundle, rather than mixing state from a replacement block at the same
height. For each exact active registry contract it requires non-empty code and
performs the ABI `balanceOf(address)` call. Results must be one exact 32-byte
uint256 word; all three positions, including zero balances, receive
deterministic domain-separated IDs.

A recovery transcript walks every integer block height after the supplied
finalized checkpoint, requires exact returned height and parent-hash linkage,
and refuses a range larger than the caller's hard bound. It cannot skip a
height, silently return a partial replay, or rewrite its finalized anchor.

## Solana mainnet-beta confirmed display source

The Solana adapter requires the complete mainnet-beta genesis hash, not only
the shortened CAIP-2 reference. It supports `PROVISIONAL/confirmed`,
`CANONICAL/confirmed`, and `FINANCIAL/finalized` transcripts. It explicitly
rejects `PROVISIONAL/processed` before resolving an address or calling a
transport.

That restriction is intentional. Solana's official `getBlock` contract returns
a confirmed-block structure with `blockhash`, `previousBlockhash`, and
`parentSlot`; it does not provide sound processed-bank lineage for this use.
Because migrations `0020` through `0023` have not been deployed, the local
policy and durable selector constraint were coherently corrected to make the
display-only provisional tier use confirmed lineage. This does not weaken the
canonical tier's separate live-capability-proof requirement or the financial
tier's independent-source and approval requirements.

For confirmed/finalized transcripts, `getSlot` selects the source slot. Three
mint-filtered `getTokenAccountsByOwner` reads use `minContextSlot` and must each
return exactly that same context slot; a later context is rejected instead of
combining different banks. The exact mint/program manifest binds USDC and USDT
to the legacy Token Program and PYUSD to Token-2022. Each response uses
canonical base64 rather than trusting provider-derived `jsonParsed` extension
objects. The adapter requires the account's program owner to match that
manifest, its declared space to match the decoded byte length, and the embedded
mint and wallet owner to match the request. It reuses the raw account parser's
canonical public-key, COption, state, and exact little-endian `u64` checks.
Legacy accounts must be exactly 165 bytes; Token-2022 accounts may include an
account discriminator and extension bytes but are capped at 4,096 bytes. All
accounts for a mint are summed with an explicit uint256 overflow check. The
adapter then requires `getBlock` evidence for that exact slot.

A recovery transcript queries every slot in the bounded interval. A null slot
may be treated as skipped only because the next returned block must name the
last present slot and hash as its parent. This preserves Solana's real
`parentSlot`, which need not equal `slot - 1`, without fabricating a parent for
the skipped slot.

## Evidence and remaining gates

The deterministic tests cover wrong-network identity, malformed/extra response
shape, mismatched response IDs, missing Ethereum contract code, malformed ABI
words, Solana owner/mint/decimal/context mismatches, duplicate token accounts,
uint256 overflow, transport failure mapping, bounded recovery, broken parents,
and Solana skipped slots. They are compatibility and fail-closed evidence only.
Preflight mutation tests separately prove that source-byte drift, a direct
network/client/environment/timer/retry capability, or launch-root registration
invalidates the dormant balance-consumer contract.

Production remains blocked on all of the following:

- two independently approved mainnet RPC sources and exact hostnames;
- endpoint-specific proof for Ethereum `safe`/`finalized` and Solana
  `confirmed`/`finalized`, Ethereum EIP-1898 support for both `eth_getCode` and
  `eth_call` with `requireCanonical: true`, historical retention, skipped-slot
  behavior, and bounded recovery;
- approved egress, TLS/DNS controls, credentials, commercial/privacy terms,
  rate limits, measured cost, and kill switches;
- a dedicated consumer, scoped address-secret delivery, queue receipt and
  idempotency behavior, monitoring, and operations approval; and
- independent finalized-source agreement before any financial use.

Protocol references:

- [EIP-1898 exact block-hash state-query parameters](https://eips.ethereum.org/EIPS/eip-1898)
- [Ethereum JSON-RPC methods](https://ethereum.org/developers/docs/apis/json-rpc/)
- [Solana `getGenesisHash`](https://solana.com/docs/rpc/http/getgenesishash)
- [Solana `getSlot`](https://solana.com/docs/rpc/http/getslot)
- [Solana `getTokenAccountsByOwner`](https://solana.com/docs/rpc/http/gettokenaccountsbyowner)
- [Solana `getBlock` confirmed-block structure](https://solana.com/docs/rpc/http/getblock)
- [Solana token programs and mainnet stablecoin bindings](https://solana.com/docs/payments/how-payments-work)
- [Solana Token-2022 PYUSD account example](https://solana.com/developers/cookbook/tokens/get-token-account)
- [Paxos PYUSD mainnet mint](https://docs.paxos.com/guides/stablecoin/pyusd/mainnet)

## Local verification

```powershell
npm test --workspace @crypto-lending/api -- src/blockchain-sync/infrastructure/rpc
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
```
