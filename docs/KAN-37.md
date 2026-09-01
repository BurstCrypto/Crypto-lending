# KAN-37: Managed authentication and secure sessions

KAN-37 now has a provider-neutral OIDC and cookie-session foundation. Amazon
Cognito User Pools with managed login is the selected integration target, but
this repository change remains local and inert: it does not create a user pool,
register a client, open application egress, deploy infrastructure, publish an
image, or activate a trial or paid service.

The ticket remains in progress until the exact Cognito tenant contract is
approved and exercised in a deployed non-production environment. In
particular, KAN-231 still denies identity-provider egress.

## HTTP contract

The API exposes these versioned boundaries:

- `GET /api/v1/auth/login` starts login and redirects to the configured issuer.
- `POST /api/v1/auth/registration` starts registration with a normalized
  contact profile and requires the exact configured browser origin.
- `GET /api/v1/auth/callback` consumes one authorization-code callback.
- `POST /api/v1/auth/session/rotate` rotates the current local credential.
- `POST /api/v1/auth/logout` revokes the local session family. After confirmed
  revocation, Cognito deployments return one bounded provider-logout URL in
  `X-Authentication-Provider-Logout`; after the `204`, the browser treats it as
  an optional navigation target, never as a substitute for local revocation.

KAN-38 adds a backward-compatible browser representation to the two start
routes. Requests that explicitly send `Accept: application/json` receive only
the pinned `authorizationUrl` with the same opaque transaction cookie instead
of an HTTP redirect; ordinary navigations retain the redirect contract. These
responses remain `private, no-store` and vary by `Cookie`, `Origin`, and
`Accept`. HTML callback failures return to one fixed generic local login error
screen without exposing provider, identity, state, or account-existence detail;
non-browser API callers retain the generic `401`/`429`/`503` contract.

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
audience, redirect URI, paired end-session endpoint/logout URI when configured,
and one asymmetric signing algorithm (`ES256`, `PS256`, or `RS256`). ID-token
verification enforces signature and key ownership, exact
issuer/audience, `azp` when required by a multiple-audience token, bounded token
age, expiry, optional `nbf`, nonce, a bounded case-sensitive `sub`, and a
provider-specific token-use claim when configured. Cognito configuration must
set `OIDC_REQUIRED_TOKEN_USE=id`; an access token or a token without that claim
is rejected. Token headers cannot redirect key retrieval through `jku`, `x5u`, embedded keys, or
certificate chains. Mixed provider JWKS documents are permitted, but only
compatible public signing keys enter the pinned local verifier.

Test runtimes may use exact HTTP loopback token/JWKS/authorization endpoints.
The issuer, browser origin, and callback remain HTTPS because those values are
persisted or protected by secure-cookie and CSRF invariants.

### Selected Cognito contract

The intended Cognito client is public (`GenerateSecret: false`) and uses the
authorization-code grant with PKCE S256 and the built-in Cognito identity
provider. Runtime configuration maps to Cognito as follows:

- `OIDC_PROVIDER_KEY=cognito`
- `OIDC_ISSUER_URL=https://cognito-idp.<region>.<aws-url-suffix>/<user-pool-id>`
- `OIDC_AUTHORIZATION_ENDPOINT=https://<managed-login-domain>/oauth2/authorize`
- `OIDC_TOKEN_ENDPOINT=https://<managed-login-domain>/oauth2/token`
- `OIDC_JWKS_URI=<issuer>/.well-known/jwks.json`
- `OIDC_CLIENT_ID` and `OIDC_AUDIENCE` both equal the public app-client ID
- `OIDC_SIGNING_ALGORITHM=RS256`
- `OIDC_TOKEN_AUTH_METHOD=none`
- `OIDC_REQUIRED_TOKEN_USE=id`
- `OIDC_REDIRECT_URI=https://<application-host>/api/v1/auth/callback`
- `OIDC_END_SESSION_ENDPOINT=https://<managed-login-domain>/logout`
- `OIDC_POST_LOGOUT_REDIRECT_URI=https://<application-host>/login`

No client secret is configured for this public-client flow. The issuer, app
client, domain, provider key, and account-mapping rules must remain stable once
real identities exist. The end-session endpoint is pinned to the authorization
endpoint origin and exact `/logout` path; the post-logout URI is pinned to the
application origin and exact `/login` path. Cognito allow-list registration,
MFA/recovery policy, exact callback/logout URLs, branding, and controlled
outbound access remain live deployment gates.

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

Cognito logout remains local-first: no provider request is made by the API.
Only after database revocation succeeds does the API disclose the prevalidated
`/logout?client_id=...&logout_uri=...` navigation URL. Missing or malformed
provider hints fall back to local `/login`, so provider reachability cannot
undo or block the completed local revocation.

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
KAN-34 therefore pins the application ALB's
`routing.http.xff_client_port.enabled` attribute to `false`; enabling it would
emit an `address:port` value that this parser deliberately rejects.

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

- approved Cognito user pool, issuer, audience, endpoints, public app client,
  credential storage, and provider logout/revocation semantics;
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
