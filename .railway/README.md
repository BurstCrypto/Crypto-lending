# Railway production configuration draft

`.railway/railway.ts` is the sole Railway configuration source. It uses the
current Railway IaC API rather than deprecated `railway.toml` or `railway.json`.

Before a plan, release CI must provide immutable image references:

```text
RAILWAY_GATEWAY_IMAGE=ghcr.io/trey-gleason/crypto-lending-gateway@sha256:<digest>
RAILWAY_WEB_IMAGE=ghcr.io/trey-gleason/crypto-lending-web@sha256:<digest>
RAILWAY_API_IMAGE=ghcr.io/trey-gleason/crypto-lending-api@sha256:<digest>
```

Create the shared `APP_VERSION`, `AUTH_PUBLIC_ORIGIN`, and `OIDC_REDIRECT_URI`
variables in the target Railway environment. Pass `RAILWAY_PUBLIC_DOMAIN` to
the IaC workflow as the lowercase custom hostname. Store all Auth0 and
authentication key-ring material as sealed, service-level variables. The
gateway records the reviewed hostname as `PLANNED_PUBLIC_DOMAIN`, but the IaC
does not attach it; all three application services remain private.

The pull-request plan job uses the protected `production-plan` GitHub
environment. Put its least-privilege, read-only `RAILWAY_TOKEN` secret and
`RAILWAY_PUBLIC_DOMAIN` variable there and require trusted reviewer approval.
The Railway action and CLI are commit/version pinned.

There is intentionally no apply job. The current API image still requires its
AWS/SQS production contract and cannot boot from Railway's default PostgreSQL
and Redis credentials, so the IaC installs a start-command interlock on the
API, web, and gateway and attaches no public networking. An
apply workflow may be added only after the Railway outbox/worker migration,
scoped TLS data-service identities, gateway proxy trust review, and a
Railway-specific signed preflight bind the exact merge SHA, image digests,
deployment destination, technical evidence, and seven-role public-launch
decision. IaC never grants provider or financial-action authority.
