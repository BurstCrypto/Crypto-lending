# KAN-38: Authentication UI and protected routes

KAN-38 connects the browser application to KAN-37's managed-authentication and
cookie-session boundary. The local implementation does not select or contact an
identity provider. It adds the product UI and verifies its behavior with local
fixtures only.

## Browser routes

- `/login` starts an explicit, user-initiated managed login.
- `/register` collects email, optional E.164 phone, and a two-letter declared
  residency country before starting managed registration.
- `/account` is the protected landing page. It renders no profile data until
  `GET /api/v1/accounts/me` has verified the live cookie session.

The home page links to the login and registration routes. All three routes have
one main landmark, a visible keyboard focus treatment, labeled fields, status
and alert semantics, responsive reflow, and reduced-motion behavior.

## Start and callback contract

The original API navigation contracts remain compatible:

- `GET /api/v1/auth/login` returns the managed-provider redirect.
- `POST /api/v1/auth/registration` accepts JSON and URL-encoded form fields and
  returns the managed-provider redirect.

An explicit `Accept: application/json` adds a browser-UI mode to both start
routes. It returns only `{ "authorizationUrl": "..." }` while setting the same
opaque `HttpOnly` transaction cookie. The UI validates the URL, then performs a
top-level navigation. This avoids trying to consume a cross-origin OIDC redirect
through `fetch`, preserves the same-origin CSP, and lets start failures remain a
generic accessible in-page error. Responses are private and non-cacheable and
vary on cookie, origin, and response representation.

The OIDC callback remains `/api/v1/auth/callback`. A successful browser callback
sets the KAN-37 session and CSRF cookies and redirects only to the sealed local
return path. A failed HTML callback clears a definitively failed transaction as
before and redirects to the fixed `/login?error=authentication` page. The UI
does not display provider errors, identity hints, callback state, codes, or
account-existence information. Non-browser API callers retain the generic HTTP
error contract.

## Route and session guards

The Next.js proxy uses the raw Cookie header to make one fast, syntactic decision
for `/account`: no unique, well-shaped `__Host-cl_session` cookie redirects to
`/login`; a present cookie permits only the protected loading shell. Cookie
presence is never treated as authentication. The absolute redirect is built
only from the exact server-side `AUTH_PUBLIC_ORIGIN`; it never trusts the
request Host, and missing or malformed configuration fails closed with a
private `503`.

The account client then performs the authoritative, same-origin, non-cached
`GET /api/v1/accounts/me` request. It keeps protected fields and actions out of
the DOM until a strictly parsed response succeeds. A `401` clears client-held
profile state and replaces the route with the login page. Dependency failures
retain an unknown/unavailable state with an explicit retry action rather than
mislabeling the user as signed out.

Return paths are limited to the `/account` route family. Absolute URLs,
scheme-relative paths, fragments, controls, backslashes, encoded or
double-encoded separators, API/authentication routes, and oversized values fail
to the fixed `/account` fallback. Redirect targets are never taken directly from
provider or request metadata.

## Cookie-only session behavior

The browser stores no bearer token, session credential, CSRF token, profile, or
wallet proof in `localStorage`, `sessionStorage`, IndexedDB, URLs, or application
persistence. The `HttpOnly` session cookie is inaccessible to JavaScript. For
logout, the client reads exactly one canonical `__Host-cl_csrf` cookie just in
time, copies it to `X-CSRF-Token`, and makes a same-origin credentialed POST.

Only a `204` confirms logout. The page clears protected state before replacing
the route with `/login`. A `503` retains the authenticated/unknown presentation
and offers a retry because the server deliberately does not claim revocation
when persistence is unavailable. Session rotation is not automatic, avoiding
cross-tab predecessor-replay races.

Protected page shells are dynamic, private, non-cacheable, and excluded from
indexing. Cookie-dependent proxy redirects and fail-closed responses vary on
`Cookie` and `Origin`. Next.js owns the final rendered App Router `Vary` tokens;
that rendered shell contains no profile data and still performs the live
session check before protected output. Protected API responses are private and
non-cacheable. Application code does not log or render raw backend/provider
errors.

## Wallet boundary

KAN-38 is the authentication UI ticket. Wallet connection and ownership proof do
not create a login session and are not silently activated here. KAN-57, KAN-58,
and KAN-59 own the product EVM, WalletConnect, and Solana connectors that will
consume KAN-56's backend ownership-proof endpoints after their named review and
live-wallet gates. The restricted KAN-227 wallet lab remains unchanged.

## Local and external evidence

Local tests cover strict return paths and cookies, response parsing, start
errors, session restoration, protected redirects, stale-session handling,
logout success/unavailability, accessible forms and announcements, proxy
isolation from the restricted wallet lab, URL-encoded registration, JSON start
responses, and generic callback failure routing. Type checking, linting, the web
build, and the API authentication end-to-end suite run without provider, wallet,
RPC, cloud, or paid calls.

The following remain external acceptance gates and are not claimed by KAN-38:

- an approved managed identity provider and exact KAN-231 egress;
- an HTTPS deployment with registered callback/origin and real secure-cookie
  behavior;
- real browser/provider registration, login, refresh, and logout evidence; and
- real wallet connector and ownership-proof evidence under KAN-57 through
  KAN-59 and the pending KAN-227 review.

No account, provider, credential, cloud resource, payment method, or billable
service was created or contacted for this local implementation.
