# Bonsai passwordless sign-in setup

## Checkpoint: September 15, 2026

The workspace implements a six-digit sign-in code sent by email or SMS. New
users complete their profile after verification; returning users go to their
account. Email uses Resend; U.S. phone login now uses Twilio Verify's managed
codes. The Verify integration is implemented and validated locally; it has
not been deployed to Railway.

Validation after the Verify changes:

- 35 Verify adapter and U.S. phone tests passed, alongside 286 existing
  authentication/configuration tests and 18 authentication end-to-end tests.
- All 17 passwordless integration tests passed against an isolated PostgreSQL
  18 instance, including migration upgrade/rollback, email and phone account
  creation, returning-user login, failed codes, expiry, provider outages,
  concurrent verification/completion, cookies, CSRF and session revocation.
- All 8 passwordless UI tests passed, including SMS-only registration and the
  unsupported-phone error. API and web TypeScript checks passed.
- API production build and targeted API lint passed. The earlier web production
  build passed with local development-proxy settings excluded; the later U.S.
  phone copy/input changes were checked through UI tests and TypeScript.

### Production branch preparation

The local branch `feature/bonsai-passwordless-verify` is based on production
commit `f719f6004d03dcffe6e266b1a18d96efd8951011` and contains the passwordless
changes and required migration-command fix. On that branch, 321 API
authentication/configuration tests, 62 web authentication/proxy tests and 8
Railway topology tests passed. API and web production builds, API/web lint,
API TypeScript, and OpenAPI generation also passed.

The existing main-branch secret scan fails on dummy connection strings in the
Railway configuration/bootstrap tests, including historical blobs:
[run 34562706613](https://github.com/BurstCrypto/Crypto-lending/actions/runs/34562706613).
The rollout branch records these synthetic fixtures in the existing exact-match
exception ledger, bound to source path, line, Git blob, rule, scope and redacted
fingerprint. Its hash pin and regression tests cover the additional entries.

The owner confirmed that there should be zero existing accounts, so no existing
login migration is planned. Native phone identities remain separate from OIDC
identities. A read-only database count was unavailable because no public
Postgres connection or local Railway SSH key was configured; no endpoint or key
was added. The SMS display-name preference remains optional and unanswered.

Tests use fake provider responses and delivery adapters. A real SMS still needs
the owner's completed Twilio/Railway setup and chosen test number.

Read-only checks of the live Railway project confirmed:

| Item                    | Current state                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live API and web        | Successful deployments of commit `7c266ef5074b8afc5a96a80061445b320845580e`; `/login` uses the older OIDC flow and `/api/v1/auth/options` returns 404.                           |
| Public origin           | Both services use `https://hqbonsai.com`.                                                                                                                                        |
| API authentication keys | Configured, valid for passwordless mode, and different from the public demo keys.                                                                                                |
| API migration command   | Includes the shell wrapper that runs both bootstrap and migrations. The new deployment must include migrations `9002` and `9003`.                                                |
| Authentication mode     | API: `oidc`; web: unset. Both must become `passwordless` for the code flow.                                                                                                      |
| Email delivery          | The API service now lists `RESEND_API_KEY` with its value hidden. `AUTH_EMAIL_FROM` remains unset. Key validity and live delivery still need verification.                       |
| SMS delivery            | All three Twilio variables are present on the API service. A read-only Twilio request authenticated successfully and confirmed the matching account/service and six-digit codes. |
| Resend account          | Created by the owner; sending-domain verification still needs confirmation in the dashboard.                                                                                     |

## Domain verification

`hqbonsai.com` uses Name.com nameservers. These public records already resolve:

| Type | Host                             | Observation                                                                           |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------- |
| TXT  | `resend._domainkey.hqbonsai.com` | A DKIM public key is published. Compare it with the key shown in this Resend account. |
| MX   | `send.hqbonsai.com`              | Priority 10, `feedback-smtp.us-east-1.amazonses.com`.                                 |
| TXT  | `send.hqbonsai.com`              | `v=spf1 include:amazonses.com ~all`.                                                  |

Open [Resend Domains](https://resend.com/domains) and check the status of
`hqbonsai.com`. If it is absent, add it. If verification is pending or failed,
compare the account's required records with the existing records and correct
any mismatch in Name.com. Published DNS records alone do not confirm that this
Resend account has verified the domain. Follow
[Resend's domain guide](https://resend.com/docs/dashboard/domains/introduction)
and [Name.com's DNS instructions](https://www.name.com/support/articles/206127137-adding-dns-records-and-templates).

The sender address does not require a mailbox. Once `hqbonsai.com` is verified
in Resend, `Bonsai <login@hqbonsai.com>` can be used as `AUTH_EMAIL_FROM` without
creating that address with an email-hosting provider. Receiving replies would
require a mailbox or forwarding setup. See
[Resend's sender-address guidance](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend).

## Remaining email rollout

1. Confirm the domain is **Verified** in Resend. Create an API key for email
   sending, restricted to this domain where available. See
   [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction).
2. Store the key as `RESEND_API_KEY` on Railway's **API service**. Set
   `AUTH_EMAIL_FROM=Bonsai <login@hqbonsai.com>` on the same service. Keep the
   secret in Railway; the sender must belong to the verified domain.
3. Deploy the reviewed passwordless API and web changes, including the generated
   OpenAPI specification and migrations `9002` and `9003`. Confirm the migrations succeed.
4. Set `AUTH_MODE=passwordless` on **both API and web** and deploy those settings.
   Keep `AUTH_PUBLIC_ORIGIN=https://hqbonsai.com` on both.
5. Check that `GET https://hqbonsai.com/api/v1/auth/options` returns
   `{"mode":"passwordless","email":true,"sms":false}` for an email-only setup
   (`sms` becomes `true` with valid-looking Twilio configuration) and `/login`
   offers codes. This confirms configuration; actual receipt still needs a test.
6. With the owner's chosen test address, verify email receipt, first account
   creation, logout, and returning-user sign-in. The automated tests use an
   in-memory delivery adapter; no live email has been sent during these checks.

The full configuration, limits, and local integration-test command are in
[the Railway deployment guide](railway-simple-deploy.md#passwordless-email-and-phone-sign-in).

## Phone login

The owner created a Twilio Verify service and added its credentials to Railway.
A read-only API request confirmed that the credentials work, the service belongs
to the configured account, and code length is six. Its current friendly name is
`Burst`; this name appears in verification texts. Use `Bonsai` if the texts should
match the website branding. Custom codes and PSD2 mode are disabled, as expected
for this integration. Fraud Guard and geographic permissions are not exposed by
the service endpoint and still need confirmation in the console. No SMS was sent.

Seal `TWILIO_AUTH_TOKEN` using its Railway variable menu, as with the Resend key.
The Account SID and Verify Service SID are identifiers and can remain unsealed.
Sealing hides the secret from dashboard/API reads while still providing it to
builds and deployments. See [Railway's sealed-variable documentation](https://docs.railway.com/variables#sealed-variables).

The local implementation and tests support sending a six-digit code to the
user's phone. Text delivery now uses Twilio Verify to generate and check the
code. Add these variables on Railway's **api** service only:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`

Copy the Account SID (`AC`) and Auth Token from the same Twilio account that
owns the Verify service (`VA`). Seal the Auth Token in Railway. Do not paste
credentials into chat. An older Messaging Service SID (`MG`) cannot be used.

Twilio's category policy specifically permits 2FA and transactional messages
for businesses operating in cryptocurrency, stocks, or investing. Other
business-model restrictions, including third-party and affiliate lending,
still apply. Describe Bonsai's actual business and user-requested login-code
flow accurately during onboarding; this research does not establish account
approval. See
[Twilio's category policy](https://help.twilio.com/articles/360045004974-Forbidden-Message-Categories-for-SMS-and-MMS-in-the-US-and-Canada)
and [cryptocurrency verification guidance](https://www.twilio.com/docs/api/errors/30464).

### Account setup: Twilio Verify

For the initial U.S. login-code rollout, Twilio Verify supplies managed sending
numbers and generates and checks codes. Its pooled senders remove the need to
purchase a dedicated number or register a separate A2P 10DLC campaign. See
[Twilio's Verify quickstart](https://www.twilio.com/docs/verify/quickstarts/node-express)
and [migration guide](https://www.twilio.com/en-us/blog/migrate-programmable-messaging-to-verify).

1. Complete the owner's email and phone verification in the Twilio account.
2. In [Verify Services](https://console.twilio.com/us1/develop/verify/services),
   open or create the service named `Bonsai`, enable SMS, and set six-digit codes.
   Use the owner's verified U.S. number for trial testing.
3. Configure Verify Geo Permissions to allow the United States for this initial
   rollout and keep Fraud Guard enabled.
4. Store the Account SID and Auth Token directly on Railway's API service. The
   Verify service identifier begins with `VA`; its application variable is
   `TWILIO_VERIFY_SERVICE_SID`.
5. Deploy the tested API/web changes and migrations, then enable passwordless
   mode on both services. With only SMS configured, `/api/v1/auth/options`
   should return `{"mode":"passwordless","email":false,"sms":true}`.
6. Test receipt and account creation on the owner's chosen U.S. number, then
   logout and returning-user sign-in. This still requires a real provider test.

The adapter retains the browser-bound challenge and native session protections.
Only U.S. numbering-region destinations are accepted, including formatted
10-digit input; a `+1` prefix alone does not establish a U.S. number. SMS
challenges store the Verify ID, and approval must match that ID and recipient.
No local SMS-code fallback is used. Migration `9003` clears pending SMS
challenges when applying or rolling back, preserving accounts and sessions.

No Railway deployment or live email/SMS has been performed during this setup.
