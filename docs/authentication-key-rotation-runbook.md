# Authentication HMAC key rotation runbook

## Status and authority

Migration `0025` is a dormant local rotation boundary. It installs immutable
version-one policies and candidate-aware database functions, but it does not
provision, read, rotate, retire, or destroy any external key. There is no public
HTTP or CLI activation surface. A schema-owner migration, an approved secret
custody change, a controlled API deployment, and independent evidence are all
required before changing a production version.

The identity, session, and CSRF rings are independent. Each production value is
canonical one-line JSON with exactly these fields and ordering:

```text
{"activeWriteVersion":1,"keys":[{"keyId":"identity_v1","purpose":"identity-hmac","version":1,"material":"<base64url-32-byte-key>"}]}
```

Use `identity-hmac`, `session-hmac`, or `csrf-hmac` only in the corresponding
environment variable. A ring has one to three keys, versions are positive and
strictly increasing, and the active write version names one listed key. Never
reuse an ID or raw key value across these rings, the pre-authentication seal
keys, or any other authentication purpose. Production rejects legacy
`AUTH_*_HMAC_KEY_ID`/`AUTH_*_HMAC_KEY` pairs; those pairs exist only for explicit
development and test compatibility.

The numeric `version` inside a ring is not a Secrets Manager `VersionId`. The
production task uses a selector-free shared-secret ARN plus one required exact
`AuthWalletKeysSecretVersionId`; all seven authentication/wallet field selectors
use that outer version with an empty stage. Moving `AWSCURRENT` alone does not
change pinned tasks. Every content change, cutover, or retirement must create a
complete new shared-secret version carrying forward all unchanged fields, then
replace tasks through a guarded current-to-target VersionId transition.

The reviewed production task definition sets `NODE_ENV=production`, omits
`LOCAL_DEMO_MODE`, and selects `AUTH_PREAUTH_SEAL_KEY` plus the three
`AUTH_*_HMAC_KEY_RING_JSON` documents from an operator-supplied external secret
ARN. It does not provision or read that secret, and the service remains at zero
desired tasks. Template wiring therefore proves only the fail-closed field
boundary, not custody, usable key material, deployment, or rotation. CREATE can
bind an initial exact outer VersionId. The current `APPLICATION` and
`CREDENTIAL_TRANSITION` update intents both preserve it; a dedicated
auth/wallet-secret transition record and guard must be implemented and approved
before this runbook can rotate the deployed outer version.

Never put a real ring document, digest, cookie, token, OIDC subject, or key in a
ticket, shell history, migration, log, screenshot, or evidence bundle. Secret
manager version identifiers and sanitized policy/version counts are sufficient
evidence.

## Required staged sequence

1. Apply migration `0025` while the database policy remains active version `1`
   with accepted versions `[1]`. Verify the cumulative migration and database
   principal checks.
2. Under separately approved custody, stage each external secret field in the
   one-key version-one JSON ring format and deploy the candidate-aware
   application. Drain old tasks and prove all live tasks call the `*_keyring`
   entry points. The repository template has the exact selectors but remains
   disabled by default and supplies no secret value.
3. Revoke the API role's superseded migration-`0010` single-digest login,
   session, and rate-limit function grants in the same reviewed release gate
   that certifies the whole fleet uses migration-`0025` functions. Do not expand
   overlap while a bypass-capable old entry point remains reachable.
4. In a separately reviewed schema-owner migration, expand each applicable
   accepted-read policy to `[1,2]` while keeping active write version `1`.
   Existing version-one readers remain valid because candidate sets may be a
   policy subset, but every set must contain the database-active version.
5. Add freshly generated version-two material to the applicable application
   ring with `activeWriteVersion` still `1`; deploy and drain the fleet. Verify
   all candidates are presented. At this stage, writes remain version one and
   rate limiting charges both candidate digests.
6. Coordinate a blue/green or bounded maintenance cutover that changes the
   database active-write version and each application ring's
   `activeWriteVersion` to `2`. A stale instance missing version two fails
   closed. Do not hide or retry this mismatch indefinitely.
7. Allow verified OIDC logins to append aliases and move active identity rows to
   version two. Rotate live sessions normally; predecessor replay semantics
   remain intact. Wait for predecessor rate-limit windows and live/rotated
   credential tombstones to expire or become terminal.
8. From schema-owner tooling, read only the aggregate result from
   `auth_hmac_key_retirement_readiness(purpose, version)`. Do not remove version
   one unless the result repeats requested version `1`, reports expected
   `active_write_version = 2`, `candidate_is_accepted = true`, every returned
   blocker count is zero, `ready = true`, and the cumulative verifier remains
   true. `ready` alone is insufficient because an arbitrary version outside the
   accepted set can otherwise have no blockers. Identity readiness requires
   every active identity to have its exact active-version alias. Session
   readiness includes live `ACTIVE` and `ROTATED` credential rows and unexpired
   rate-limit buckets. CSRF readiness includes live credential rows.
9. Deploy rings containing only version two after readiness is zero, then use a
   reviewed schema-owner migration to remove version one from the accepted
   policy. Re-run concurrency, replay, rate-limit, principal, rollback, and
   recovery tests before separately authorizing external predecessor
   destruction.

The same sequence applies to later versions and may never retain more than
three versions. Do not skip directly from installation to an active-write flip.

## Failure and rollback

A ring/policy mismatch returns a generic authentication failure. Configuration
errors identify only the invalid environment field with code
`CONFIGURATION_ERROR`; they do not serialize key material. Treat a mismatch as
a deployment incident and roll traffic back to a known compatible task set
without changing or deleting database evidence.

Migration `0025` rollback is intentionally refused after an alias exists, a
policy differs from its initial version-one state, or retained identity,
credential, CSRF, or rate-limit state uses another version. After use, recovery
must be a forward migration. Append-only aliases remain as non-reversible
continuity evidence; they are HMAC digests, not key material, and do not require
retaining a retired key.

## Evidence still required

Local tests cover concurrent first login, provider substitution, candidate and
CSRF mismatch, replay ordering, successor versions, multi-candidate rate-limit
denial, aggregate readiness, immutable policies/aliases, least-privilege roles,
and rollback refusal. Production still requires approved external secret/KMS
custody, authorized population of the selected fields, a deployed blue/green
exercise, old-function denial evidence, recovery timing, sanitized alerting,
an approved dedicated outer-VersionId transition guard, and independent
security review. None of those external gates is satisfied by the template,
this runbook, or the migration.
