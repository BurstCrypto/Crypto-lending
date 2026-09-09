# Railway production configuration

`.railway/railway.ts` is the sole Railway configuration source. It uses the
current Railway IaC API rather than deprecated `railway.toml` or `railway.json`.

Before a plan or apply, release CI must provide immutable image references:

```text
RAILWAY_GATEWAY_IMAGE=ghcr.io/trey-gleason/crypto-lending-gateway@sha256:<digest>
RAILWAY_WEB_IMAGE=ghcr.io/trey-gleason/crypto-lending-web@sha256:<digest>
RAILWAY_API_IMAGE=ghcr.io/trey-gleason/crypto-lending-api@sha256:<digest>
```

Create the shared `APP_VERSION`, `AUTH_PUBLIC_ORIGIN`, and `OIDC_REDIRECT_URI`
variables in the target Railway environment. Pass `RAILWAY_PUBLIC_DOMAIN` to
the IaC workflow as the lowercase custom hostname. Store all Auth0 and
authentication key-ring material as sealed, service-level variables before an
apply. The gateway is the only public domain; `web` and `api` stay private.

The pull-request plan job uses the protected `production-plan` GitHub
environment. Put its least-privilege `RAILWAY_TOKEN` secret and
`RAILWAY_PUBLIC_DOMAIN` variable there, require trusted reviewer approval, and
put the production token and matching domain variable in the protected
`production` environment. The Railway action and CLI are commit/version pinned;
the apply job downloads the reviewed plan artifact and refuses tree or live
environment drift.

Run `railway config plan` before `railway config apply`. A production apply is
still subject to the repository's signed release and public-launch authority
checks; IaC does not grant financial-action authority.
