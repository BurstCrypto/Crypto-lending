# Balance consumer wallet-address boundary

Status: `IMPLEMENTED_DORMANT` / `CONSUMER_AND_PROVIDER_EGRESS_BLOCKED`

Migration `0023` and `PostgresBalanceSyncWalletAddressResolver` close the local
wallet-address handoff needed by a future Ethereum/Solana balance consumer.
They do not start that consumer, connect to SQS, configure an RPC endpoint, or
perform a mainnet read or write.

## Least-privilege database contract

The worker receives `EXECUTE` on exactly one new `SECURITY DEFINER` function:

```text
resolve_active_wallet_address_ciphertext(uuid, uuid, text)
```

The function accepts one account UUID, wallet UUID, and CAIP-2 network. It
returns at most one sealed address record and only the fields needed to rebuild
the original address AES-GCM binding: account, wallet, registration challenge,
network, immutable registration digest/version, and address cipher material.
It does not return wallet metadata, a verification alias, an identity HMAC,
plaintext, or any unrelated wallet.

Resolution returns no row unless all of these conditions hold:

- the exact account, wallet, and network match;
- the wallet is active and has no revocation timestamp;
- the network is Ethereum mainnet (`eip155:1`) or Solana mainnet
  (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`);
- registry environment, version, and fingerprint match the closed launch
  registry;
- the address cipher is the expected bounded AES-256-GCM shape; and
- at least one active wallet identity alias is accepted by migration `0022`'s
  database-owned key policy.

The worker still has no `SELECT` privilege on `registered_wallets`,
`registered_wallet_identity_digests`, or `wallet_identity_key_policy`. The API,
legacy runtime, migration principal, and `PUBLIC` cannot execute the resolver.
The migration verifier binds the exact function signature, owner, body,
volatility, strictness, search path, result contract, ACL, and table denial.

Migration `0023` owns no durable data. Rollback first revokes worker execution
and then drops the function with `RESTRICT`, so PostgreSQL refuses unexpected
dependencies. Operations must quiesce the future consumer before rollback;
active wallet registrations and balance history remain untouched.

## Dedicated key delivery contract

The unregistered consumer config reads only:

- `BALANCE_CONSUMER_MODE=disabled|enabled`; and
- `BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON` when enabled.

The JSON is canonical, bounded to three keys, and uses the existing exact
metadata-seal key format:

```json
{
  "activeWriteVersion": 2,
  "keys": [
    {
      "keyId": "balance-consumer-metadata-v1",
      "purpose": "metadata-seal",
      "version": 1,
      "material": "<32-byte-base64url>"
    },
    {
      "keyId": "balance-consumer-metadata-v2",
      "purpose": "metadata-seal",
      "version": 2,
      "material": "<32-byte-base64url>"
    }
  ]
}
```

`activeWriteVersion` is retained solely for compatibility with the validated
key-ring type; this read-only boundary exposes no sealing method. The resolver
selects the exact stored address key version, allowing a bounded predecessor
during rotation. Key objects expose identifiers and versions but keep decoded
key bytes in private in-memory storage.

This contract deliberately does not read or alias
`WALLET_METADATA_SEAL_KEY(_RING_JSON)`, wallet challenge/identity keys, or any
authentication/session key. The existing bundled API authentication-and-wallet
secret must not be attached to a balance-consumer task. Deployment work must
create a separate secret containing only the consumer metadata ring before the
consumer can be enabled.

## In-memory validation and privacy

The PostgreSQL adapter treats rows as untrusted. It rejects extra fields,
symbols, accessors, custom prototypes, malformed UUIDs/byte arrays, duplicate
rows, wrong scopes, missing key versions, and failed GCM authentication with one
fixed error. It reconstructs the original registration AAD using the immutable
registration digest—not the rotatable verification alias—and then requires the
plaintext to be the exact canonical nonzero Ethereum or Solana address.

The plaintext exists only as the adapter's return value for its immediate
in-process caller. The adapter contains no logger and performs no plaintext
persistence. Future consumer/indexer code must preserve that property and keep
addresses out of errors, metrics, traces, job payloads, checkpoints, and logs.

## Remaining activation gates

This slice remains intentionally dormant. Activation still requires:

- a dedicated business-consumer workload and its metadata-only secret;
- reviewed SQS receive/delete/visibility and durable idempotency behavior;
- approved exact-host Ethereum/Solana RPC providers and egress controls;
- runtime monitoring, redrive, replay, and key-rotation procedures; and
- production authority for the deployment and provider accounts.

Until those gates close, no module binds
`BALANCE_SYNC_WALLET_ADDRESS_RESOLVER_PORT`, no consumer process loads this
config, and no external traffic can result from this implementation.

## Local verification

```powershell
npm test --workspace @crypto-lending/api -- src/blockchain-sync/infrastructure/config/balance-consumer.config.spec.ts src/blockchain-sync/infrastructure/postgres/postgres-balance-sync-wallet-address.resolver.spec.ts src/infrastructure/database/migrations/0023-create-balance-consumer-wallet-address-boundary.migration.spec.ts
$env:RUN_INFRASTRUCTURE_INTEGRATION='1'; npm run test:integration --workspace @crypto-lending/api -- test/infrastructure/balance-consumer-wallet-address-boundary.integration-spec.ts
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
git diff --check
```
