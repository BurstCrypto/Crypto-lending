# Wallet registration key rotation

This runbook covers only the local Ethereum and Solana wallet-registration
boundary. It does not authorize a cloud secret change, grant a worker access to
wallet metadata, contact a chain, or retire a key.

## Invariants

- Each purpose has a bounded ring of one through three keys. Every entry has an
  exact purpose, positive version, explicit key ID, and canonical 32-byte
  base64url material.
- Key IDs and key material are unique across all three purpose rings. Reusing
  material under a new version, ID, or purpose fails configuration startup.
- The greatest version in a ring is its explicit active-write version. New
  identity digests, challenge digests, and AES-256-GCM values use only that key.
- Persisted versions select old HMAC and AES keys for verification or decrypt.
  An unknown version or failed authenticated decrypt makes the wallet operation
  unavailable; it never falls back to a different key.
- Raw addresses are never written to an identity-alias table, audit row, or
  rotation log. Alias rows contain only domain-separated HMAC-SHA-256 values.

The three optional ring variables are
`WALLET_IDENTITY_HMAC_KEY_RING_JSON`,
`WALLET_CHALLENGE_HMAC_KEY_RING_JSON`, and
`WALLET_METADATA_SEAL_KEY_RING_JSON`. A document is canonical compact JSON:

```json
{
  "activeWriteVersion": 2,
  "keys": [
    {
      "keyId": "wallet-identity-v1",
      "purpose": "identity-hmac",
      "version": 1,
      "material": "<canonical-32-byte-base64url>"
    },
    {
      "keyId": "wallet-identity-v2",
      "purpose": "identity-hmac",
      "version": 2,
      "material": "<canonical-32-byte-base64url>"
    }
  ]
}
```

Keys must be ordered by increasing version. A ring variable and its legacy
single-key `*_KEY_VERSION` / `*_KEY` pair are mutually exclusive. The legacy
pair remains a one-entry ring for deployment compatibility.

## Challenge-HMAC rotation

1. Obtain Security approval and create distinct managed key material and a
   stable key ID. Do not copy another wallet or authentication key.
2. Deploy the old key plus the new active key as a ring.
3. Confirm new challenge rows use the new digest version. Confirm challenges
   created before the deployment can still be opened and verified with the old
   version.
4. Keep the previous key through at least the maximum five-minute challenge
   lifetime, deployment rollback window, and an observed deployed rotation
   drill. Removing it earlier fails closed for outstanding challenges.

No local code automatically removes the previous key.

## Metadata-seal rotation and retirement gate

Adding a new active metadata key is safe only while every old key remains in the
decrypt ring: new challenge, address, and metadata ciphertext uses the active
version while retained registered addresses continue to select their stored
version.

Migration `0024` adds the database and application primitives for that data
migration, but deliberately does not activate them. There is no HTTP route,
CLI command, schedule, Nest provider, cloud-secret access, or runtime-role
grant. The API, worker, legacy, and migration-login roles cannot execute the
prepare, complete, readiness, or verifier functions and cannot access the
rewrap tables. Explicit schema-owner tooling is therefore the only possible
caller, and creating that separately reviewed operator workflow remains a
production change.

At migration time, `0024` locks the challenge and registered-wallet tables,
backfills an IV/material-hash registry for every retained challenge payload and
both encrypted fields of every wallet, then enables always-on uniqueness and
mutation guards. It retains no superseded ciphertext. A ten-minute, one-wallet
command binds account, wallet, chain, registry, source key versions, target key
version, and an optimistic hash of both current ciphertext values. Completion
updates address and metadata together and records append-only, non-sensitive
PREPARED and COMPLETED evidence. A caller-created session setting alone is not
authority: the trigger also requires the exact locked command in COMPLETING
state with matching old and result fingerprints. Runtime roles have neither
table UPDATE nor function EXECUTE capability.

The dormant coordinator implements the plaintext-sensitive half of the
protocol. It opens each old value with its stored version and exact original
row-bound AAD, checks a canonical Ethereum-mainnet or Solana-mainnet address
against the database-policy-active identity alias, accepts only the exact
canonical schema-v1 metadata document, and reseals both fields under the active
metadata key with independent fresh random IVs. It returns only a generic
result/error and never returns or logs plaintext.

An old metadata key must not be removed until an approved operator has:

1. selected each exact wallet row under a bounded lock;
2. opened it with the stored key version and exact row-bound AAD;
3. validated the canonical Ethereum or Solana address and its identity digest;
4. resealed it with a fresh AES-GCM nonce under the active key;
5. called the count-only retirement-readiness function and proved zero retained
   registered-address, registered-metadata, and challenge ciphertext plus zero
   unexpired pending challenges and live rewrap commands; and
6. passed forward and rollback drills without logging plaintext.

Preparation and completion are idempotent only for the same command ID and
exact scope/material. Same-version or downgrade requests, expired or stale
preparations, revoked/inactive wallets, cross-account substitution, duplicate
IV/material, and conflicting replay fail generically. Rollback of `0024`
refuses after the first preparation or any post-migration material admission.
This prevents a rollback from silently discarding audit or nonce-reuse
evidence.

Until the schema-owner operator workflow is separately reviewed, activated,
and successfully drilled, old-key retirement is blocked. If an operator
removes the key anyway, reads fail generically rather than returning corrupt or
fabricated wallet data.

## Identity-HMAC cutover gate

Migration `0022` creates a schema-owner-controlled policy and exact digest
aliases for each challenge and wallet. The initial production policy is version
`1` only. The API submits every configured identity digest to the guarded begin
function, which rejects a set that differs from the database policy. Completion
locks every versioned alias in order, checks active and revoked aliases, and a
table trigger also protects legacy completion functions. Consequently, the
same chain-qualified wallet cannot register through version `1` and version `2`
as different identities.

Changing the active identity version requires a new audited database/data
migration. A fresh, valid same-account re-proof while both versions are
accepted opportunistically backfills the missing alias atomically. Before
retiring the predecessor, the cutover still must drain pending challenges and
prove that every retained wallet has the successor alias. Any wallet not
covered by re-proof needs a separately reviewed API-trust-boundary backfill
that decrypts and validates the address, calculates the new HMAC without
persisting plaintext, detects collisions, and records non-sensitive evidence.
Only then may the migration switch the database policy to the successor-only
version. Roster reads select that policy-active verification alias while
retaining the registration-time digest solely as immutable AES AAD. Migration
`0022` is immutable to runtime roles and deliberately rejects a
configuration-led cutover without database evidence.

Rollback of `0022` is allowed only while all aliases and the policy remain the
losslessly representable singleton version `1`. It refuses rollback after any
multi-version use. A future cutover migration must define its own reverse
backfill and must retain both keys throughout the rollback window.

## External production work still required

- Secrets Manager/KMS custody, resource policies, key creation, rotation
  authority, and deployed secret-read evidence require approved operators.
- The current infrastructure template selects the pre-authentication key and
  all six canonical ring documents and rejects the legacy single-key selectors.
  It does not provision or populate the external secret or define the isolated
  schema-owner rewrap identity. Those controls must be separately reviewed with
  the exact secret schema, session-drain procedure, and preflight checks. Do not
  grant 0024 functions to the general API or worker role.
- A deployed rotation, rollback, and disaster-recovery drill with redacted
  evidence is required before any old key can be retired.
- Migration `0023` gives only the worker role a scoped current-ciphertext
  resolver; it does not provide the metadata key. Separate metadata-key custody
  and deployed workload evidence are still required. The shared
  authentication/wallet secret must not be granted to that worker.
