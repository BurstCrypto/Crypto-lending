# Deploy on Railway — simple profile

This is the fast path to a running deployment on Railway **without** the signed
BurstCrypto release pipeline (GHCR image digests, GitHub approval environments,
the signed launch-authority decision). It builds every service from this
repository and relaxes the strict supply-chain and auth-provisioning gates behind
one opt-in flag.

> **Grade:** demo / staging. Production auth key material is a fixed public
> default and the reproducible-build attestation is skipped. The strict pipeline
> is untouched and still runs whenever `RAILWAY_SIMPLE_PROFILE` is unset. Before
> real users, configure the chosen sign-in provider and real `AUTH_*` key material —
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

> **Remove any stray Railpack service.** If Railway auto-created a service pointed at the
> repo root (it builds via Railpack and fails with `No start command detected` — the root is
> a two-package npm workspace with no root start command), **delete it** (or repoint it to a
> Dockerfile). It is not part of this topology and will keep failing alongside the real
> services.

## Verify

- All four services build green.
- API `preDeploy` logs show database roles created and migrations applied
  (including `9001-create-railway-job-queue`).
- `GET /api/v1/internal/health/dependencies` (api) → 200, `GET /api/health`
  (web) → 200, `GET /healthz` (gateway) → 200.
- The app loads through the gateway domain.

The API pre-deploy command must start with `sh -c` around the bootstrap and
migration commands joined with `&&`. Without the shell, the bootstrap can exit
successfully while the migration command is never executed. Confirm that logs
show application migrations, not only the `railway-bootstrap` event. Missing
`schema_migrations` or `job_outbox` tables then cause dependency checks to fail
and leave the gateway returning HTTP 502 for API requests.

Both API and web must have `AUTH_PUBLIC_ORIGIN` set to the actual gateway origin
(for Bonsai, `https://hqbonsai.com`). The simple profile's `app.example.com` and
`tenant.example.com` defaults only let the process boot; they cannot provide
working sign-in.

## Passwordless email and phone sign-in

For the latest checked setup state and the remaining email rollout steps, see
[the September 15 checkpoint](passwordless-setup-status.md).

Bonsai's native flow uses PostgreSQL for expiring code challenges, accounts,
identity mappings and sessions. It does not require Auth0 registration. Both
`/login` and `/register` use the same email-or-phone entry and six-digit code screen.
New users finish their existing required profile fields after verification;
returning users enter only their identifier and code.

Deploy the API and web changes, including Railway migrations `9002` and `9003`, before
switching both services to `AUTH_MODE=passwordless`. Keep
`AUTH_PUBLIC_ORIGIN=https://hqbonsai.com` on both. The API also needs
`DEPLOYMENT_TARGET=railway` and the independent authentication keys listed below.
Existing `OIDC_*` settings are ignored in passwordless mode. The simple profile
continues to default to OIDC unless `AUTH_MODE` is explicitly set.

Configure delivery secrets directly in Railway on the **API service only**:

| Channel | Variables                                                              | Setup                                                                                                                                            |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Email   | `RESEND_API_KEY`, `AUTH_EMAIL_FROM`                                    | Verify a sending domain in Resend; use a sender such as `Bonsai <login@hqbonsai.com>`.                                                           |
| SMS     | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Create a Twilio Verify service with SMS enabled and six-digit codes. Keep Fraud Guard enabled and allow only the U.S. in Verify Geo Permissions. |

Either channel can be enabled independently. The UI offers only configured
channels. If neither is configured, it shows that sign-in is unavailable; it
never displays a code or pretends a message was sent. Provider acceptance is not
proof of inbox/handset delivery; test receipt after setup. Do not put provider
keys in chat, source control or `NEXT_PUBLIC_*` variables.

The adapters use [Resend's email API](https://resend.com/docs/api-reference/emails/send-email)
and Twilio Verify's [send](https://www.twilio.com/docs/verify/api/verification)
and [check](https://www.twilio.com/docs/verify/api/verification-check) APIs.
The Verify service SID starts with `VA`. A Messaging Service SID (`MG`) cannot
enable this integration. Twilio Verify supplies pooled sending numbers; a
dedicated number and separate A2P 10DLC campaign are unnecessary for those
senders. See [Twilio's migration guide](https://www.twilio.com/en-us/blog/migrate-programmable-messaging-to-verify).
No provider signup, sender verification, paid subscription or live message is
performed by the local implementation or its automated tests.

Phone login initially accepts U.S. numbers only (the `US` numbering region;
Canada, U.S. territories with separate numbering regions, and other `+1`
destinations are excluded). The API normalizes valid U.S. numbers entered as
10 digits or with `+1`; extensions and non-geographic toll-free numbers are
rejected before any provider request. Keep the matching U.S. restriction in
[Verify Geo Permissions](https://www.twilio.com/docs/verify/preventing-toll-fraud/verify-geo-permissions).

Challenges expire after 10 minutes and five incorrect guesses. PostgreSQL
stores a keyed digest for email codes. Twilio generates and checks SMS codes;
PostgreSQL stores the provider verification ID instead of a code or digest.
The check must approve that exact ID, phone number, account and service.
Both channels use separate browser binding in an HttpOnly Secure cookie. A
verified challenge is consumed atomically with session creation. Code requests
are limited per recipient (3 per 10 minutes), IP (10 per 10 minutes), and channel
(300 emails or 30 texts per hour). These conservative initial channel limits
should be reviewed before expanding beyond testing. The browser offers resend
after 60 seconds. Twilio may resend the same code within its validity window;
resending does not extend the provider's expiry. Expired challenge rows are removed in bounded batches when
new codes are requested; add scheduled cleanup if retention must be bounded
while the app is idle.

Migration `9003` replaces any pending SMS challenges when changing providers;
those users must request another code. Applying or rolling back that migration
preserves email challenges, accounts and existing sessions. A successful Verify
check consumes the remote code, so it is never retried automatically. If the
provider approves but the database commit fails, request a new code.

Native email and phone identities are separate. Use the same verified identifier
on subsequent visits. Existing Auth0 accounts and profile contact details are
not automatically linked: changing a contact email/phone must not grant access
to another account. Adding a second login method or migrating an existing
Auth0 account requires a separate flow that verifies control of both identities.

For local verification, use an isolated loopback PostgreSQL 18 instance:

```powershell
$env:RUN_INFRASTRUCTURE_INTEGRATION = '1'
$env:RAILWAY_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:YOUR_PORT/postgres'
node node_modules/jest/bin/jest.js --config apps/api/test/infrastructure/jest.config.json --runInBand passwordless.integration-spec
```

The test creates and drops its own database, runs the Railway migrations using
the deployed simple profile, explicitly verifies migrations `9002` and `9003`,
checks the Verify migration's upgrade and rollback, and exercises
the real API role and Postgres session functions with an in-memory delivery
adapter. It sends no email/SMS. Interactive testing with the real providers
needs HTTPS for the Secure cookies and a matching `AUTH_PUBLIC_ORIGIN`.

## Hardening (before real users)

Set these as real Railway variables on the **api** service to override the demo
defaults (any you set wins; the normalizer only fills what's unset):

- A configured delivery provider for passwordless mode, as described above.
  OIDC settings are needed only when deliberately retaining `AUTH_MODE=oidc`.
- Independent key material: `AUTH_PREAUTH_SEAL_KEY(+_ID)`,
  `AUTH_IDENTITY_HMAC_KEY_RING_JSON`, `AUTH_SESSION_HMAC_KEY_RING_JSON`,
  `AUTH_CSRF_HMAC_KEY_RING_JSON`.
- Real `RAILWAY_API_DATABASE_PASSWORD` / `RAILWAY_WORKER_DATABASE_PASSWORD`.

To return to the fully strict, signed pipeline, simply deploy without
`RAILWAY_SIMPLE_PROFILE`; `.railway/railway.ts` then requires the immutable GHCR
image digests and reviewed domain exactly as before.
