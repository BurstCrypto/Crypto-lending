# KAN-36: Account and profile domain

KAN-36 introduces the platform-owned account/profile boundary. The work in this
branch is deliberately local-only: it creates no cloud resources, calls no
identity provider, publishes no image, and dispatches no hosted workflow.

## Identity boundary

The public API is self-scoped:

- `GET /api/v1/accounts/me`
- `PATCH /api/v1/accounts/me`

Neither operation accepts an account identifier in the path, query, or request
body. The account ID comes only from the `CurrentPrincipalResolver` port. Its
runtime adapter denies every request until KAN-37 supplies verified managed-OIDC
token validation and issuer/subject-to-platform-account mapping. There is no
development identity header or unsigned-token fallback in production code.

The trusted provisioning application use case generates the platform account ID
with the operating system's cryptographic UUIDv4 generator. It is opaque,
immutable, and never an email, phone number, wallet address, or identity-provider
subject. Provisioning is not a public HTTP endpoint, and a duplicate generated ID
fails closed rather than being interpreted as an idempotent identity match.

## Profile contract

The mutable profile fields are:

- `contactEmail`: required printable ASCII, at most 254 characters; surrounding
  whitespace is rejected and only the domain is lowercased.
- `contactPhone`: optional generic E.164 syntax (`+` followed by 2–15 digits,
  with a non-zero first digit); `null`
  explicitly clears it.
- `declaredResidencyCountryCode`: an uppercase, real ISO-3166-1 alpha-2 code.

Declared residency is unverified user input. It is not legal eligibility,
location proof, KYC evidence, or authorization. Eligibility is server-owned,
defaults to `UNKNOWN`, and remains `UNKNOWN` throughout this story—including for
`US` declarations.

Unknown fields, account IDs, eligibility, versions, timestamps, nested values,
arrays, controls, bidi/zero-width characters, ambiguous Unicode, and empty
updates are rejected. Contact values are syntax-validated only; they are not
marked verified and are not authentication identifiers.

## Concurrency, privacy, and audit

Successful reads emit an account-bound strong `ETag`. Updates require exactly
one matching strong `If-Match` value:

- missing header: `428 Precondition Required`
- weak, wildcard, multiple, malformed, cross-account, or stale value:
  `412 Precondition Failed`
- valid update: `200 OK` with the new `ETag`

The repository performs a single version-qualified update and writes its audit
record in the same PostgreSQL transaction. Audit rows contain only actor and
target account IDs, action/result, correlation ID, changed field names,
server-authored occurrence time, and old/new versions. Raw email, phone,
residency, bearer tokens, request bodies, and database diagnostics are excluded.
Audit rows are append-only at the database boundary.

Account responses and errors use `Cache-Control: private, no-store` and vary on
`Authorization`. Responses explicitly project permitted fields and never expose
provider subjects or internal credentials.

## Persistence boundary

Migration `0004` owns immutable accounts, mutable account profiles, the
ISO-3166 reference set, and append-only profile audit history. PostgreSQL is the
last line of defense for UUID shape, country membership, canonical contacts,
`UNKNOWN` eligibility, immutable identity/creation timestamps, and monotonic
profile versions. The reviewed `crypto_runtime` role has read-only access to the
account/profile tables, no profile-audit access, and no direct table-write
permission. Provisioning and updates can run only through fixed-search-path,
owner-bound `SECURITY DEFINER` functions that require actor/target agreement and
atomically create exactly one redacted audit transition or roll back the entire
mutation.

## Local verification

Run the ordinary local gates:

```powershell
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
npm test --workspace @crypto-lending/api
npm run test:e2e --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm run openapi:generate --workspace @crypto-lending/api
```

With the repository's loopback-only Docker services available, run the real
PostgreSQL migration and repository suites:

```powershell
$env:TEST_DATABASE_URL=$env:MIGRATION_DATABASE_URL
$env:RUN_INFRASTRUCTURE_INTEGRATION="1"
npm run test:integration --workspace @crypto-lending/api
```

These commands use only local processes and Docker resources. Do not dispatch a
hosted workflow, deploy the CloudFormation templates, publish an image, or call
a managed identity service for KAN-36 under the zero-spend authorization.

## Remaining handoff

The domain, database, HTTP authorization seam, and adversarial tests can be
completed locally. Real authenticated success remains a KAN-37 handoff: a
reviewed adapter must verify token signature, issuer, audience, lifetime, and
session policy before mapping the verified subject to an existing platform UUID.
Until that adapter is installed, runtime profile requests intentionally return a
generic `401`.
