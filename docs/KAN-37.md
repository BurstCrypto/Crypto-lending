# KAN-37: Managed authentication and secure sessions

KAN-37 now has a local, provider-neutral OIDC and cookie-session foundation.
The work is deliberately local-only: it does not create an identity-provider
tenant, register a client, open application egress, deploy infrastructure,
publish an image, or activate a trial or paid service.

The ticket remains in progress until a managed provider and exact production
contract are approved and exercised in a deployed non-production environment.
In particular, KAN-231 still denies identity-provider egress.

## HTTP contract

The API exposes these versioned boundaries:

- `GET /api/v1/auth/login` starts login and redirects to the configured issuer.
- `POST /api/v1/auth/registration` starts registration with a normalized
  contact profile and requires the exact configured browser origin.
- `GET /api/v1/auth/callback` consumes one authorization-code callback.
- `POST /api/v1/auth/session/rotate` rotates the current local credential.
- `POST /api/v1/auth/logout` revokes the local session family.

Login never creates an unknown identity. Registration is the only creation
flow. Its successful callback atomically creates exactly one opaque platform
account, account profile, profile audit record, exact issuer/subject mapping,
session family, and initial credential. Concurrent registration callbacks for
the same identity converge through a database lock and unique constraint.
Email is profile data only and is never an identity-linking key.

## OIDC boundary

The implementation uses Authorization Code with PKCE S256 for every flow. A
server-generated 256-bit state, nonce, verifier, and independent browser
binding are sealed into a short-lived `Secure`, `HttpOnly`, `SameSite=Lax`,
`__Host-` transaction cookie. Only their domain-separated digests are stored in
PostgreSQL. State plus browser binding is consumed once before token exchange;
replay and wrong-browser callbacks fail closed.

Provider discovery is intentionally absent. Configuration pins the exact HTTPS
issuer, authorization endpoint, token endpoint, JWKS endpoint, client ID,
audience, redirect URI, and one asymmetric signing algorithm (`ES256`, `PS256`,
or `RS256`). ID-token verification enforces signature and key ownership, exact
issuer/audience, `azp` when required by a multiple-audience token, bounded token
age, expiry, optional `nbf`, nonce, and a bounded case-sensitive `sub`. Token
headers cannot redirect key retrieval through `jku`, `x5u`, embedded keys, or
certificate chains. Mixed provider JWKS documents are permitted, but only
compatible public signing keys enter the pinned local verifier.

Test runtimes may use exact HTTP loopback token/JWKS/authorization endpoints.
The issuer, browser origin, and callback remain HTTPS because those values are
persisted or protected by secure-cookie and CSRF invariants.

## Session and CSRF boundary

The authenticated browser receives an opaque 256-bit secret with a UUIDv4
selector in a `Secure`, `HttpOnly`, `SameSite=Lax`, `__Host-cl_session` cookie.
PostgreSQL stores only a keyed digest. A separate readable 256-bit
`__Host-cl_csrf` cookie is bound to that credential by a keyed database digest.
Unsafe cookie-authenticated requests require all of:

- the exact configured `Origin`;
- one matching CSRF cookie and `X-CSRF-Token` header; and
- successful database verification of the stored session and CSRF digests.

Session rotation occurs only at the dedicated POST boundary, avoiding false
replay from parallel ordinary browser requests. A used predecessor compromises
and revokes the whole family. Expired, revoked, malformed, ambiguous
cookie-plus-Authorization, and replayed credentials return only generic
authentication errors. Logout revokes locally before clearing cookies; an
invalid/already-absent session is cleared idempotently, while a database outage
returns `503` without pretending revocation succeeded.

Protected account routes now derive `CurrentPrincipal` from the verified
cookie session and advertise the cookie security scheme in OpenAPI. They use
`Cache-Control: private, no-store` and `Vary: Cookie, Origin`.

## Persistence, audit, and abuse controls

Migration `0010` adds one-use login attempts, exact OIDC identity mappings,
session families and credential generations, append-only authentication audit
events, and fixed-window rate-limit buckets. The API runtime receives execute
permission only on fixed-search-path `SECURITY DEFINER` functions; it has no
direct access to the authentication tables. The worker, legacy runtime, and
`PUBLIC` receive no capability.

The database records sanitized start, claim, registration/identity, session,
rotation, revocation, expiry, replay, rejection, and rate-limit transitions.
Provider errors, token failures, and verified-identity mismatches after claim
are terminally rejected rather than left in a misleading claimed state. Audit
rows contain internal UUIDs, enumerated outcome/reason values, and the
server-generated correlation UUID—not raw subjects, profile fields, IPs,
codes, tokens, state, nonce, cookies, signatures, or provider errors.

Login start, callback, and rotation have PostgreSQL-backed fixed-window limits.
Client-address selection defaults to the direct socket and ignores forwarded
headers. A deployed single-proxy topology must explicitly select
`AUTH_CLIENT_ADDRESS_MODE=trusted-single-proxy` and provide the exact trusted
proxy IP/CIDR allowlist in `AUTH_TRUSTED_PROXY_CIDRS`; only one canonical
`X-Forwarded-For` address from an allowlisted immediate peer is accepted.
Duplicate, list-valued, malformed, or spoofed forwarding data fails closed.

## Configuration and rotation rules

`AUTH_MODE` defaults to `disabled`. Disabled mode keeps the principal resolver
deny-all and rejects stray OIDC configuration. Enabling `oidc` requires the
complete `OIDC_*`/`AUTH_*` contract validated in
`authentication.config.ts`; secrets are never assigned usable defaults.

The current digest schema version is `1`. The identity HMAC material is
therefore operationally immutable until a reviewed dual-read/rehash migration
exists; replacing it in place could reinterpret one issuer/subject as a new
identity. Pre-auth seal, session, and CSRF key rotation likewise requires an
explicit overlap/revocation design. Key IDs in configuration label current
material but do not by themselves provide a key ring. Production enablement
must treat these as release gates rather than rotating secret values blindly.

## Remaining live gates

Local tests cannot select or prove a managed identity service. Before changing
`AUTH_MODE` from `disabled` in a deployed environment, the project still needs:

- approved provider, issuer, audience, endpoints, client type, signing
  algorithm, credential storage, and provider logout/revocation semantics;
- KAN-231 approval for the exact identity destinations and failure policy;
- registered HTTPS callback/origin and real secure-cookie behavior through the
  ALB/browser topology;
- approved trusted-proxy ranges and distributed rate-limit thresholds;
- an owned reconciliation policy for stale `CLAIMED` login attempts left by a
  process stop or ambiguous database outcome after the one-use claim;
- provider-side session, MFA/step-up, mobile/deep-link, outage, key-rotation,
  JWKS-rotation, and account-recovery decisions; and
- deployed non-production evidence for invalid, expired, revoked, replayed,
  concurrent, provider-outage, logout, and monitoring cases.

No production or security acceptance is claimed until those gates are reviewed
and their evidence is bound to the deployed revision.

## Local verification

```powershell
npm run lint --workspace @crypto-lending/api
npm run typecheck --workspace @crypto-lending/api
npm run build --workspace @crypto-lending/api
npm test --workspace @crypto-lending/api
npm run test:e2e --workspace @crypto-lending/api
npm run openapi:generate --workspace @crypto-lending/api
npm run test:integration --workspace @crypto-lending/api
git diff --check
```
