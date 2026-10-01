# Bonsai passwordless sign-in

## Live checkpoint: September 15, 2026, SMS restriction diagnosed at 22:14 UTC

U.S. phone-code sign-in is deployed and enabled at [hqbonsai.com/login](https://hqbonsai.com/login).
Both `/login` and `/register` show the phone field and **Send sign-in code** button.
The implementation was merged in [PR #45](https://github.com/BurstCrypto/Crypto-lending/pull/45).
The deployed commit is `13000d0f9acbc2724a92338aeff7203ac1e39a44`.

| Item                         | Verified state                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| API deployment               | `ca5b12be-491c-412a-8e30-244c941d75a9`: SUCCESS                                                        |
| Web deployment               | `245cd29e-6ee2-4c9d-9007-bb8fb1c09611`: SUCCESS                                                        |
| Authentication mode          | `AUTH_MODE=passwordless` on API and web                                                                |
| Public origin                | `AUTH_PUBLIC_ORIGIN=https://hqbonsai.com` on both services                                             |
| Database migrations          | `9002` and `9003` completed successfully at 16:53:15 UTC                                               |
| SMS delivery configuration   | All three Twilio Verify variables are configured on API; Auth Token is sealed                          |
| Email delivery configuration | Resend API key is sealed; `AUTH_EMAIL_FROM` is unset, so email sign-in remains disabled                |
| Twilio service               | Runtime credentials authenticated successfully; matching account/service and six-digit codes confirmed |
| SMS display name             | The current Twilio Verify service name is `Burst`; the optional rename preference is unanswered        |

The live endpoint `GET /api/v1/auth/options` returns:

```json
{ "mode": "passwordless", "email": false, "sms": true }
```

Live checks passed: API health (200), the configured channels above, rejection
of a non-U.S. number, rejection of a foreign-origin request, and rejection of a
code without a browser challenge (401, no cookies issued). Authentication
responses use `Cache-Control: private, no-store`.

The owner expects zero existing accounts. No account migration was performed,
and no account was created by these checks. No database account count was made
or database endpoint added. Later Twilio diagnostics used temporary Railway
SSH keys, each removed after the check; their local private keys were deleted.

## Confirmed blocker: Twilio error 21608 and missing primary compliance profile

The owner tried the registration form. At `2026-09-15T19:23:11.549Z`,
`POST /api/v1/auth/code/request` returned HTTP 503 after 180 ms. Railway DNS
logs show successful resolution of `verify.twilio.com` at 19:23:11.449 UTC,
and network logs show outbound HTTPS activity at the same time. The request
therefore reached the SMS delivery step. No database error was returned in
the queried 19:20-19:25 UTC PostgreSQL log window.

The owner showed empty Verify logs and phone-number inventory. An empty
inventory is expected when using Twilio Verify; no sending number purchase
is required. The API discards provider error bodies, so the original request's
logs did not disclose Twilio's reason.

After the owner explicitly authorized one diagnostic SMS to the same number,
the deployed SMS adapter was invoked once from the API container. Twilio
returned **HTTP 403, error 21608**. No verification was accepted or text sent.
The diagnostic captured only status, numeric error code, and safe booleans;
it did not expose credentials, codes, or the phone number. A single-use marker
in the API container prevents repeating that authorized diagnostic by accident.

Read-only requests from the same running container confirmed:

- Account credentials: HTTP 200; main account, `type=Full`, `status=active`.
- Verify service: HTTP 200; account and service match; six-digit codes;
  custom codes and PSD2 disabled.
- Trust Hub customer/compliance profiles: HTTP 200; **zero profiles**, no next page.
- The owner's attempted recipient: **not preverified** in this Twilio account.

[Twilio error 21608](https://www.twilio.com/docs/api/errors/21608) applies to
upgraded accounts without an approved primary compliance profile as well as
trial accounts. The credentials and Verify service are configured correctly;
Twilio's account onboarding remains incomplete.

Next: the owner must complete **Products & Services > Trust Hub > Profiles >
Primary profile** with the appropriate identity/business information and obtain
Twilio approval. For immediate testing while that remains incomplete, the owner
can add and confirm their own phone number under **Verified caller IDs**.
See [primary compliance profiles](https://www.twilio.com/docs/trust-hub/profiles/primary-compliance-profiles).

## After resolving the error: finish the owner test

The single authorized SMS request was rejected before delivery. Provider receipt
and a complete production sign-in still need the owner's test:

1. Open [the sign-in page](https://hqbonsai.com/login) and enter the owner's U.S.
   number. Until the primary compliance profile is approved, use a number
   preverified in this Twilio account.
2. Request the six-digit code and enter it on the website.
3. Complete the first account's contact email and country of residence.
4. Sign out, then sign in again with the same phone number.

Twilio Verify supplies sending numbers; a purchased phone number is unnecessary.
Its current service name means a text may say **Burst**. Rename the service to
**Bonsai** in the Twilio console if that is the desired branding. Confirm U.S.
Geo Permissions and Fraud Guard in the console; the service API does not expose
those settings. The application already restricts accepted numbers to the U.S.
numbering region. See [Twilio's Verify quickstart](https://www.twilio.com/docs/verify/quickstarts/node-express).

## Enable email later

1. Check that `hqbonsai.com` is **Verified** in [Resend Domains](https://resend.com/domains).
   Existing public DKIM, SPF and MX records do not establish verification in the
   owner's particular Resend account. The owner has been asked for this status.
2. On Railway's **api** service, add
   `AUTH_EMAIL_FROM=Bonsai <login@hqbonsai.com>` and deploy that setting.
3. Confirm `email:true` in `/api/v1/auth/options`, then test real receipt.

A mailbox for `login@hqbonsai.com` is not required to send from a verified domain.
See [Resend's sender guidance](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend).
Keep the Resend key and Twilio Auth Token sealed in Railway; account/service SIDs
are identifiers and can remain unsealed.

## Validation and source checkpoint

Both full Foundation CI runs passed:
[PR run](https://github.com/BurstCrypto/Crypto-lending/actions/runs/34993836026) and
[branch run](https://github.com/BurstCrypto/Crypto-lending/actions/runs/34993829712).
The Railway configuration review also passed.

- All 5,373 API unit tests and 829 web tests passed in CI.
- All 71 API end-to-end tests passed locally and in CI.
- All 17 passwordless integration tests passed on PostgreSQL 18; all 20
  passwordless/Railway database-boundary tests passed on PostgreSQL 16.
- Production builds, hardened container checks, OpenAPI, lint, TypeScript,
  secret scans, dependency audit, release tooling and database integration checks passed.
- Exact source-fingerprint checks and their negative tests remain in place.
  The reviewed API snapshot covers 442 runtime files and 7,538,187 bytes, with
  SHA-256 `e803c868013d4ca7f8e14bc355bdf9537d9e09a056beb8777676dd8aa209357f`.

Implementation work used the isolated worktree
`C:\Users\Admin\Desktop\CryptoLending-passwordless-verify-20260915`, preserving
the original engineering workspace's other pending work. Preflight's byte pins
were checked against canonical LF files in that isolated worktree.

The full configuration and integration-test commands remain in
[the Railway guide](railway-simple-deploy.md#passwordless-email-and-phone-sign-in).
