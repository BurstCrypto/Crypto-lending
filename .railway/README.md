# Railway production configuration

`.railway/railway.ts` is the sole Railway configuration source. It uses the
current Railway IaC API rather than deprecated `railway.toml` or `railway.json`.

Before a plan or apply, release CI must provide immutable image references:

```text
RAILWAY_GATEWAY_IMAGE=ghcr.io/trey-gleason/crypto-lending-gateway@sha256:<digest>
RAILWAY_WEB_IMAGE=ghcr.io/trey-gleason/crypto-lending-web@sha256:<digest>
RAILWAY_API_IMAGE=ghcr.io/trey-gleason/crypto-lending-api@sha256:<digest>
```

Create the shared `APP_VERSION`, `AUTH_PUBLIC_ORIGIN`, `OIDC_REDIRECT_URI`, and
`PUBLIC_DOMAIN` variables in the target Railway environment. Store all Auth0
and authentication key-ring material as sealed, service-level variables before
an apply. The gateway is the only public domain; `web` and `api` stay private.

Run `railway config plan` before `railway config apply`. A production apply is
still subject to the repository's signed release and public-launch authority
checks; IaC does not grant financial-action authority.
