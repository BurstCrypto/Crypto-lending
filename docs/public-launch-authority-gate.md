# Public launch authority gate

## Current production status

The public-launch authority gate is intentionally **fail-closed**. The checked-in production
authority registry is empty and deeply frozen. Consequently, no decision artifact can currently
be production-verified and this repository does not claim that public launch is approved.

Populating the registry requires a separately reviewed source change containing public keys and
their approval records. Private keys, example signatures, and pre-approved decision artifacts must
not be committed.

## Required independent roles

A decision set is complete only when it has one current Ed25519 approval for each role, in this
exact order:

1. `LEGAL_PUBLIC_LAUNCH_APPROVER`
2. `REGULATORY_COMPLIANCE_APPROVER`
3. `PRIVACY_APPROVER`
4. `OPERATIONS_ACCEPTANCE_APPROVER`
5. `INDEPENDENT_SECURITY_APPROVER`
6. `DEPENDENCY_RISK_APPROVER`
7. `DEPLOYMENT_OWNER`

Every decision must use a distinct registry key ID. The registry also rejects reuse of the same
Ed25519 public-key material under different key IDs, including across roles. Each registry entry
has exactly one role, the exact `PUBLIC_MAINNET_LAUNCH` scope, an `APPROVED` status, a canonical
validity interval, and an approval reference. Registry entries are strictly ordered by key ID and a
key interval may span at most 400 days.

The registry is the trust anchor. A decision artifact cannot embed, replace, or select public keys.

## Exact release and deployment scope

All seven signatures cover the same three-part target binding:

- the exact lowercase SHA-256 of the release-candidate manifest;
- the exact deployment target ID; and
- the exact lowercase SHA-256 of the deployment-target configuration.

Changing any binding value invalidates every signature. This prevents an approval for one source
candidate, AWS target, region, account configuration, or infrastructure configuration from being
replayed for another.

Each signed decision also covers its role, exact `PUBLIC_MAINNET_LAUNCH` scope, authority key ID,
explicit `APPROVED` decision, canonical approval and expiry timestamps, and approval reference. A
decision must already be in effect, remain unexpired at evaluation time, and have a positive
lifetime of no more than seven days. Its complete lifetime must fall inside its authority key's
validity interval. Production verification obtains evaluation time from the process clock; a
caller cannot supply a historical time to revive an expired approval.

Signing input is produced only by
`publicLaunchAuthorityDecisionSigningBytes(binding, unsignedDecision)`. It consists of the fixed
versioned domain followed by a newline and canonical JSON. Operators should sign those returned
bytes directly rather than reproduce serialization separately.

## Artifact and file boundary

The verifier accepts only the version-1 `PUBLIC_LAUNCH_AUTHORITY_DECISION_SET` shape. Objects have
exact fields, arrays are dense and ordinary, all seven decisions are present in the required order,
and unknown fields are rejected. The input must be byte-for-byte canonical JSON encoded as UTF-8.
Whitespace variants, duplicate JSON keys, byte-order marks, NUL bytes, invalid UTF-8, malformed or
noncanonical Base64, and files larger than 128 KiB fail with the same sanitized error.

The file loader additionally rejects:

- empty files, directories, devices, and other non-regular inputs;
- a symbolic link or reparse/junction traversal in any existing path component;
- a symbolic-link final path;
- a final file with multiple hard links when the filesystem exposes its link count; and
- identity, size, timestamp, link-count, or content changes observed during loading.

It compares path and descriptor identity, opens with `O_NOFOLLOW` where Node exposes it, performs
two exact positioned reads, and rechecks every path component and the final file before accepting
the bytes. These checks are fail-closed; an unsupported or ambiguous filesystem condition is not
treated as approval.

## Verified-value boundary

Only verification against the checked-in production registry creates the module's private
verified-value brand. The exported test-registry seams exercise signature and file behavior but
deliberately return unbranded values, so test trust cannot be passed to a production consumer as a
verified launch authorization. The brand predicate becomes false after the earliest decision
expiry or a detected clock rollback. Consumers must also call the application revalidation entry
point immediately before using the decision; it rechecks the binding, signatures, registry, and
current time.

This gate records that the named authorities approved an exact candidate and target. It does not
replace the legal, regulatory, privacy, operational, security, dependency-risk, or deployment
reviews themselves.

## Activation sequence

1. Each authority independently provisions and controls an Ed25519 signing key through the
   organization's approved key-management process.
2. A reviewed source change adds only canonical public-key records to the production registry,
   with one role per distinct key and bounded validity.
3. Release tooling supplies the final release-candidate manifest hash and the final deployment
   target ID/configuration hash.
4. Each authority signs its own short-lived `APPROVED` decision for that exact binding.
5. The seven decisions are assembled as canonical JSON without adding trust material.
6. Production preflight must load the stable file, verify it, and require the privately branded
   result before public launch can be reported as authorized.

The independent verifier is implemented in `scripts/public-launch-authority-decision.ts` and is a
hard `PUBLIC_LAUNCH_AUTHORITIES` check in both production-preflight readiness paths. The CLI accepts
its file only with the complete technical-evidence trio. It maps the verified bundle's
`releaseCandidateManifestSha256`, `deploymentTargetId`, and `deploymentTargetSha256` to the launch
decision binding; no separate binding assertion is accepted from the caller. Final readiness
revalidates both the branded technical evidence and clean release state before revalidating the
authority decision, closing drift or expiry during authority-file loading.

## Local verification

These commands require no network, credentials, provider approvals, or blockchain writes:

```powershell
npm run lint:production:preflight
npm run typecheck:production:preflight
npm run test:production:preflight
```

Tests generate ephemeral Ed25519 key pairs in memory. They do not contain usable production keys or
approval artifacts.
