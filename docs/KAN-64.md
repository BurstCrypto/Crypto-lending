# KAN-64: provider-neutral Solana stablecoin deposit indexer

Status: `LOCAL_IMPLEMENTATION_COMPLETE` / `RUNTIME_DISABLED_PENDING_EXTERNAL_GATES`

KAN-64 adds a pure, read-only Solana balance-indexing boundary. It parses raw
SPL token-account bytes supplied through an injected port, aggregates only the
exact active Solana mints in the KAN-61 registry, and records one coherent
source slot on every output balance. It contains no RPC client, URL, API key,
provider SDK, provider selection, persistence adapter, or transaction path.

No provider account or trial was opened, no package was installed, no endpoint
was configured, and no RPC, cloud, hosted-service, or on-chain call was made.
The deterministic tests use only in-memory fakes and byte fixtures.

## Closed indexing contract

An index request is environment-, network-, wallet-, and tier-qualified. The
indexer then:

1. resolves the network against the KAN-62 chain-observation policy and rejects
   an environment crossover;
2. validates the wallet as one canonical, nonzero, 32-byte Solana public key;
3. maps `PROVISIONAL` to `confirmed`; `CANONICAL` also maps to `confirmed` only when
   a network-bound live-capability record is supplied;
4. requires the exact full KAN-62 `getGenesisHash` result before accepting any
   account data;
5. asks the injected source once for legacy SPL Token accounts and once for
   Token-2022 accounts, with the caller's highest validated `minContextSlot`;
6. requires both complete responses to carry the same non-regressing context
   slot and remain within KAN-62's 2,048-read-unit job ceiling;
7. validates every account address, program ID, raw layout, embedded owner,
   mint, exact little-endian `u64` amount, state, and relevant `COption` fields;
8. resolves the mint through the current KAN-61 environment registry and
   aggregates by the registry's network-qualified `qualifiedIdentity`; and
9. returns every active registry asset with exact `bigint` base units, registry
   version/fingerprint, commitment, authority, and source slot.

Legacy Token accounts must use the canonical 165-byte layout. Token-2022
accounts may use that base layout or bounded extension bytes; an extended
account must carry the Token-2022 account discriminator. Only real bounded
`Uint8Array` values are accepted; spoofed array-like objects are rejected before
copying. Parsed source bytes are copied before use so an adapter cannot mutate a
result after validation.

## Closed, frozen, counterfeit, and zero semantics

- Multiple initialized accounts for one allowed mint sum in exact base units.
- A frozen account remains visible in `amountBaseUnits` and
  `frozenAmountBaseUnits`, but contributes nothing to
  `activeAmountBaseUnits`. `active` describes SPL account state; it is not a
  claim that extensions, delegates, or downstream policy permit spending.
- A normalized `data: null` account is counted as closed and excluded; it is
  never interpreted as a zero balance.
- An uninitialized account is counted and excluded.
- A valid token account whose mint is absent from the exact KAN-61 allowlist is
  counted as unsupported and cannot create a balance entry.
- Duplicate account identities, owner mismatch, malformed data, source
  failure, wrong genesis, slot regression, mixed slots, or an incomplete or
  oversized response fail the entire operation. No partial balance or
  replacement zero is returned.
- A zero balance is emitted only after both token-program scans complete at
  the same validated slot and no account for that allowlisted mint contributes
  an amount.

The service does not log provider values. Source exceptions and hostile source
objects are converted to closed error codes without retaining provider error
text or a cause.

## Integration boundary

`SolanaDepositSourcePort` is the only read dependency. A future adapter must
normalize provider wire data to the exported source-result shapes, while the
port deliberately returns `unknown` so the indexer performs runtime validation
instead of trusting adapter types. The port exposes only `getGenesisHash` and
`getTokenAccountsByOwner`; there is no transaction or subscription method.

The service and its types are exported from the blockchain package, but the
service is intentionally not registered in `BlockchainModule`. Registering it
would require selecting and configuring a real source, which is not approved.

## Remaining runtime gates

Local fixture coverage is not live-provider evidence. Before any adapter or
canonical runtime can be enabled, all of the following remain required:

- KAN-251 must validate exact genesis identity, standard-method behavior,
  `minContextSlot`, confirmed/finalized semantics, response bounds, rate
  limits, timeout behavior, and coherent dual-program reads against an approved
  provider and fallback.
- KAN-231 must approve exact destination egress. No hostname or credential is
  present in this implementation.
- The follow-on sync/recovery work must own durable checkpoints, bounded retry
  with full jitter, circuit breaking, continuation beyond 2,048 read units,
  freshness, reorg/finality recovery, and last-good retention. KAN-64 returns a
  complete immutable snapshot; it is not a scheduler or repository.
- Financial use remains unavailable. Independent finalized-source agreement,
  lineage/freshness checks, downstream risk controls, and every KAN-62
  financial approval are outside this indexer's authority.

Until those gates pass, only deterministic local `PROVISIONAL` fixture results
are demonstrated. Canonical evidence is opaque request data and must be accepted
by a trusted composition-root verifier before any confirmed read begins. A
caller-supplied boolean or look-alike JSON object cannot self-authorize the tier;
no live verifier or capability has been issued or wired.

## Local verification

The focused checks are:

```text
npm test -- blockchain/domain/solana-token-account.spec.ts blockchain/application/solana-deposit-indexer.service.spec.ts
npm run lint
npm run typecheck
npm run build
```

They perform no network access and require no provider or database.
