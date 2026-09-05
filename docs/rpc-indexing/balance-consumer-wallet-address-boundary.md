# Balance consumer wallet-address boundary

Status: `FAIL_CLOSED_EXECUTABLE` / `CONSUMER_AND_PROVIDER_EGRESS_BLOCKED`

Migration `0023` and `PostgresBalanceSyncWalletAddressResolver` define the local
wallet-address handoff needed by a future Ethereum/Solana balance consumer.
Migration `0028` removes the generic worker's historical authority to use that
handoff. These source boundaries do not start a consumer, connect to SQS,
configure an RPC endpoint, or perform a mainnet read or write.

## Least-privilege database contract

The resolver is an exact-scope `SECURITY DEFINER` function:

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

Migration `0023` originally granted the generic worker only `EXECUTE` on this
resolver and no `SELECT` privilege on `registered_wallets`,
`registered_wallet_identity_digests`, or `wallet_identity_key_policy`.
Migration `0028` revokes that resolver grant and the worker's four balance
checkpoint function grants. No application runtime role currently has balance
resolver or checkpoint execution authority. The migration verifiers bind the
exact function signatures, ownership, bodies, safe search paths, result
contracts, ACLs, and underlying-table denial.

Migration `0023` owns no durable data. Migration `0028` is forward-only: its
down path raises SQLSTATE `55000` and never recreates generic-worker balance
authority. Any later dedicated grant must be delivered by a new reviewed
migration rather than by rolling this revocation back.

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

## Fail-closed executable boundary

The production image now contains `worker:balance:prod`, but every checked-in
invocation exits nonzero before dynamically importing the dormant Nest/SQS/
PostgreSQL runtime module. `APPLICATION_WORKLOAD` must be exactly
`balance-consumer`; its reviewed database login prefix is
`crypto_balance_consumer_login_<rotation-id>`, its session role is
`crypto_balance_consumer_runtime`, and production startup rejects every
`REDIS_*` variable.

The dedicated SQS loader accepts only the exact `APP_ENV` balance source/DLQ
pair and requires both queues to be in the same AWS account. It rejects generic
queue variables and unknown or miscased SQS aliases. The worker receives a
pinned port limited to receive, delete, change-visibility, and envelope parsing;
the caller cannot provide a `QueueUrl`, and the port cannot publish. Raw
balance-consumer `SqsService` send/publish, batch-publish, and health operations
also fail closed.

The release now binds and local/offline preflight inspects a standalone dormant
balance-consumer deployment envelope. It is deliberately restricted to
non-production environment names, requires an explicit acknowledgement that an
actual deployment would create billable AWS resources, and is not referenced
or composed by the application parent template or deployment target. Its
service stays at literal `DesiredCount: 0`; source activation remains false,
`BALANCE_CONSUMER_MODE` remains `disabled`, and the runtime is still uncomposed.
No cloud, provider, or other external action was taken to create or validate
this source.

The envelope supplies neither a database secret/grant nor the metadata key ring
described above. It also supplies no RPC/provider, Redis, authentication,
general-wallet, or generic jobs-queue setting. The task security group has no
ingress and loopback-only egress; public IP assignment and ECS Exec are
disabled. Its task role is limited to receive/delete/change-visibility on the
exact balance source queue and SQS-scoped KMS decrypt. It has no jobs/DLQ,
send/publish, `GetQueueAttributes`, Secrets Manager, Redis, auth, provider, or
RPC authority. Its execution role can only pull the same-account digest-pinned
API image and write the dedicated logs. The Fargate `1.4.0` task runs non-root,
uses a read-only root filesystem, drops all Linux capabilities, and selects
only the balance-consumer CLI. These are inert source constraints, not a
deployed identity or a usable address-decryption path.

Startup also requires the canonical enabled metadata-ring config, exact
Ethereum-and-Solana-mainnet scope, and the separate reviewed source-approval
value. RPC/provider inputs, authentication or general-wallet configuration,
Redis, signing/private-key material, admin or legacy database credentials,
demo/testnet inputs, and Base inputs are rejected before the runtime import.
Environment settings cannot override the immutable checked-in source gate,
which remains `enabled: false`.

## Remaining activation gates

This slice remains intentionally dormant. Activation still requires:

- activation and deployment of the dedicated business-consumer runtime/task
  with its metadata-only secret;
- a later reviewed migration granting only the exact resolver/checkpoint
  capabilities to the existing `crypto_balance_consumer_runtime` identity;
- composition and provisioning of the release-bound standalone ECS/IAM source;
  it is declared only as an unreferenced, hard-zero non-production envelope;
- deployed SQS receive/delete/visibility IAM, redrive, and durable idempotency
  evidence for the exact source/DLQ pair;
- approved exact-host Ethereum/Solana RPC providers and egress controls;
- runtime monitoring, redrive, replay, and key-rotation procedures; and
- production authority for the deployment and provider accounts.

Until those gates close and the source gate receives a reviewed code change,
no module binds `BALANCE_SYNC_WALLET_ADDRESS_RESOLVER_PORT`, no client is
constructed, and no external traffic can result from this implementation. The
database bootstrap declares a dormant `NOLOGIN` balance-consumer capability
role and one or two external rotating login slots with exact `SET`-only
membership. It installs no credentials and grants those identities no database
connection, schema, object, function, default-ACL, or ownership authority.
Runtime activation, task and IAM wiring, database grants, RPC approval, and
deployed evidence all remain blocked. Offline preflight therefore retains
`BALANCE_CONSUMER_TASK_NOT_PROVISIONED`,
`BALANCE_CONSUMER_IAM_NOT_PROVISIONED`, and
`BALANCE_CONSUMER_DEPLOYED_EVIDENCE_MISSING`; locally inspecting the standalone
source cannot satisfy any of those deployment claims.

## Local verification

```powershell
npm test --workspace @crypto-lending/api -- src/blockchain-sync/infrastructure/config/balance-consumer.config.spec.ts src/blockchain-sync/infrastructure/postgres/postgres-balance-sync-wallet-address.resolver.spec.ts src/infrastructure/database/migrations/0023-create-balance-consumer-wallet-address-boundary.migration.spec.ts
npm test --workspace @crypto-lending/api -- src/blockchain-sync/application/balance-sync-consumer.cli-mode.spec.ts
npm run worker:balance:prod
$env:RUN_INFRASTRUCTURE_INTEGRATION='1'; npm run test:integration --workspace @crypto-lending/api -- test/infrastructure/balance-consumer-wallet-address-boundary.integration-spec.ts
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
git diff --check
```
