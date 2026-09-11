# Railway production deployment

`.railway/railway.ts` is the sole Railway configuration source. It uses the
current Railway IaC API rather than deprecated `railway.toml` or `railway.json`.

Before a plan, release CI must provide immutable image references:

```text
RAILWAY_GATEWAY_IMAGE=ghcr.io/burstcrypto/crypto-lending-gateway@sha256:<digest>
RAILWAY_WEB_IMAGE=ghcr.io/burstcrypto/crypto-lending-web@sha256:<digest>
RAILWAY_API_IMAGE=ghcr.io/burstcrypto/crypto-lending-api@sha256:<digest>
```

Before planning, create these shared Railway variables. Mark every credential
or key value as sealed; IaC links them only to the API service, so the values do
not enter source control or the plan artifact:

```text
APP_VERSION                           (exact 40-character release commit SHA)
AUTH_TRUSTED_PROXY_CIDRS
OIDC_AUDIENCE
OIDC_AUTHORIZATION_ENDPOINT
OIDC_CLIENT_ID
OIDC_CLIENT_SECRET                  (sealed)
OIDC_END_SESSION_ENDPOINT
OIDC_ISSUER_URL
OIDC_JWKS_URI
OIDC_TOKEN_ENDPOINT
AUTH_PREAUTH_SEAL_KEY_ID
AUTH_PREAUTH_SEAL_KEY               (sealed)
AUTH_IDENTITY_HMAC_KEY_RING_JSON    (sealed)
AUTH_SESSION_HMAC_KEY_RING_JSON     (sealed)
AUTH_CSRF_HMAC_KEY_RING_JSON        (sealed)
RAILWAY_API_DATABASE_PASSWORD       (sealed, unique random value)
RAILWAY_WORKER_DATABASE_PASSWORD    (sealed, different unique random value)
```

Use Auth0 tenant endpoints for every provider `OIDC_*` URL, including the exact
`https://<tenant>/v2/logout` endpoint. IaC derives `AUTH_PUBLIC_ORIGIN`, the
callback URL, and the post-logout URL from the reviewed gateway domain so they
cannot drift apart. The gateway receives the only public custom domain; web,
API, worker, PostgreSQL, and Redis remain on Railway private networking.

The pull-request plan job uses the protected `production-plan` GitHub
environment. Put its least-privilege, read-only `RAILWAY_TOKEN` secret and
`RAILWAY_PUBLIC_DOMAIN` variable there and require trusted reviewer approval.
The Railway action and CLI are commit/version pinned.

Run `Railway reviewed deployment` from a commit already on `main`, with the
three released image digests, custom domain, and successful Foundation CI run
ID for that exact commit. Store the base64-encoded signed decision as
`PUBLIC_LAUNCH_AUTHORITY_DECISION_BASE64` and its reviewed Railway technical
evidence as `RAILWAY_PRODUCTION_EVIDENCE_BASE64` in `production-plan`. The job
verifies image repository and OCI revision labels, downloads the immutable
release manifest, creates the live Railway plan, and cryptographically verifies
all seven signatures against those exact hashes. The separately protected
`production-apply` environment may apply only that byte-identical plan; give it
an independent write-scoped `RAILWAY_TOKEN`.

The checked-in production authority registry is deliberately empty until the
seven public-launch keys are enrolled by a separately reviewed source change.
The deploy workflow therefore remains fail-closed until key enrollment and
valid, current signed evidence are complete; no digest-shaped placeholder can
clear the gate.

Railway currently refuses first-time custom-domain registration from an IaC
plan. After applying the pinned topology, the same protected apply job creates
or reconciles the exact input-bound gateway hostname on port 8080. DNS still
must point at the record Railway returns before cutover.

The API predeploy runs the owner-compatible migration chain once; each API or
worker predeploy uses Railway's owner URL only to create or rotate its own fixed
LOGIN. Runtime commands remove the owner URL before Node starts; the API and
worker authenticate with separate sealed passwords and can assume only their
own NOLOGIN capability. The API uses private Redis, while the dedicated worker
moves transactional outbox rows into the idempotent `railway_job_queue` table.
Until a provider handler is separately approved, the same worker validates and
terminalizes those hand-offs through bounded fail-closed retries instead of
executing them. `DEPLOYMENT_TARGET=railway` rejects public
database/cache URLs and every AWS/SQS variable. IaC never grants provider or
financial-action authority: all providers remain `Coming soon`, and deployment
does not create an executable supply or withdrawal route. Auth0 login requires
a provider-verified email; a separately reviewed fresh email-code step-up must
be implemented before any future real-value handler or route can be activated.
