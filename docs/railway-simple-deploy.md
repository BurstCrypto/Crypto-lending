# Deploy on Railway — simple profile

This is the fast path to a running deployment on Railway **without** the signed
BurstCrypto release pipeline (GHCR image digests, GitHub approval environments,
the signed launch-authority decision). It builds every service from this
repository and relaxes the strict supply-chain and auth-provisioning gates behind
one opt-in flag.

> **Grade:** demo / staging. Production auth key material is a fixed public
> default and the reproducible-build attestation is skipped. The strict pipeline
> is untouched and still runs whenever `RAILWAY_SIMPLE_PROFILE` is unset. Before
> real users, set real Auth0/OIDC credentials and real `AUTH_*` key material —
> see **Hardening** below.

## What it stands up

`.railway/railway.ts` defines the whole topology: a public **gateway** (Caddy)
forwarding `/api/v1/*` to the **api** and everything else to the **web** service,
plus an outbox **worker**, managed **Postgres**, and managed **Redis**. In simple
profile each app service is built from your connected GitHub repo via its
Dockerfile (`Dockerfile.api`, `Dockerfile.web`,
`deploy/railway/gateway/Dockerfile`; the worker reuses `Dockerfile.api`).

## Steps

1. **Push this repo to your own GitHub** and, in Railway, create a project and
   connect that repository (Railway needs GitHub App access to build from it).

2. **Apply the topology** with the Railway IaC CLI, which reads
   `.railway/railway.ts`:

   ```sh
   railway login
   railway link                       # select or create your project/environment
   export RAILWAY_SIMPLE_PROFILE=1
   export RAILWAY_SOURCE_REPO=<your-github-owner>/<repo>   # e.g. you/crypto-lending
   # optional, but needed for login to work end-to-end:
   export RAILWAY_PUBLIC_DOMAIN=<your-domain>              # e.g. app.example.com
   npx @railway/cli@5.51.0 config plan --out railway.plan
   npx @railway/cli@5.51.0 config apply --yes --plan railway.plan
   ```

   This provisions the four services plus Postgres and Redis and wires their
   environment (private-network DB/Redis URLs, ports, healthchecks, the API
   `preDeploy` that creates the database roles and runs migrations).

   _Dashboard alternative_ (no CLI): create four services from the repo, and on
   each set `RAILWAY_DOCKERFILE_PATH` to the path above; add the Postgres and
   Redis plugins; then set the variables in step 3 by hand.

3. **Set variables.** With the CLI path, only these are needed (everything else,
   including the full Auth0/OIDC contract, is filled inside the container by the
   simple-profile normalizer):

   | Variable                           | Where         | Value                                  |
   | ---------------------------------- | ------------- | -------------------------------------- |
   | `RAILWAY_SIMPLE_PROFILE`           | api, worker   | `1` (set by the IaC)                   |
   | `RAILWAY_PUBLIC_DOMAIN`            | plan-time env | your gateway domain (optional)         |
   | `RAILWAY_API_DATABASE_PASSWORD`    | plan-time env | optional; defaults to `railway-simple` |
   | `RAILWAY_WORKER_DATABASE_PASSWORD` | plan-time env | optional; defaults to `railway-simple` |

4. **Attach your domain** to the **gateway** service (port 8080) in Railway.
   Set `RAILWAY_PUBLIC_DOMAIN` to it (step 2) so cookies, the OIDC redirect, and
   the same-origin contract point at the real host.

## Verify

- All four services build green.
- API `preDeploy` logs show database roles created and migrations applied
  (including `9001-create-railway-job-queue`).
- `GET /api/v1/internal/health/dependencies` (api) → 200, `GET /api/health`
  (web) → 200, `GET /healthz` (gateway) → 200.
- The app loads through the gateway domain.

## Hardening (before real users)

Set these as real Railway variables on the **api** service to override the demo
defaults (any you set wins; the normalizer only fills what's unset):

- A real OIDC provider: `OIDC_ISSUER_URL`, `OIDC_AUTHORIZATION_ENDPOINT`,
  `OIDC_TOKEN_ENDPOINT`, `OIDC_JWKS_URI`, `OIDC_END_SESSION_ENDPOINT`,
  `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUDIENCE`.
- Independent key material: `AUTH_PREAUTH_SEAL_KEY(+_ID)`,
  `AUTH_IDENTITY_HMAC_KEY_RING_JSON`, `AUTH_SESSION_HMAC_KEY_RING_JSON`,
  `AUTH_CSRF_HMAC_KEY_RING_JSON`.
- Real `RAILWAY_API_DATABASE_PASSWORD` / `RAILWAY_WORKER_DATABASE_PASSWORD`.

To return to the fully strict, signed pipeline, simply deploy without
`RAILWAY_SIMPLE_PROFILE`; `.railway/railway.ts` then requires the immutable GHCR
image digests and reviewed domain exactly as before.
