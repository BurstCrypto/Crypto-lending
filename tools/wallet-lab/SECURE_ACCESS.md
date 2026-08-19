# Wallet lab secure local access

The real-package wallet lab will not start until authenticated HTTPS is fully
configured. This is a fail-closed local control for KAN-224; it does not approve
the lab for public hosting, LAN access, tunneling, or use by an unauthorized
evaluator.

Complete the license/authorization gate in the package README before installing
or starting this package.

## Prerequisites

Obtain a locally trusted development certificate and its matching unencrypted
PEM private key through an organization-approved certificate tool. The leaf
certificate must:

- contain an IP subject alternative name for `127.0.0.1`;
- be within its validity period; and
- match the configured private key.

Do not use a production certificate. Keep the key outside the repository when
possible. If an approved local workflow must place it under
`tools/wallet-lab/.certs`, that directory is ignored by Git, but the operator is
still responsible for filesystem permissions and cleanup. Do not bypass the
browser's certificate warning: install/trust the issuing local CA according to
the approved workstation procedure.

## Configure

Copy `.env.example` to the ignored `.env.local`. Set these server-only values:

```dotenv
WALLET_LAB_HTTPS_CERT_PATH=C:/absolute/path/to/127.0.0.1-cert.pem
WALLET_LAB_HTTPS_KEY_PATH=C:/absolute/path/to/127.0.0.1-key.pem
WALLET_LAB_ACCESS_USERNAME=<3-64 restricted ASCII characters>
WALLET_LAB_ACCESS_PASSWORD=<24-128 non-whitespace printable ASCII characters>
```

Use a unique high-entropy password supplied through the project's approved
secret-management process. Never prefix either credential with `VITE_`; Vite
variables are sent to the browser. Do not commit the populated environment
file, certificate, private key, password, session cookie, or Basic
`Authorization` value.

Set `VITE_WALLET_LAB_ENABLED=true` only for an authorized run, and set
`VITE_WALLET_LAB_CANDIDATE_COMMIT` to the exact 40-character commit under test.
The bootstrap remains closed without both values. The remaining public testnet
and WalletConnect settings retain their separate gates.

## Start and authenticate

Run the repository command without host, port, HTTPS, or mode overrides:

```powershell
npm run dev:wallet-lab
```

Open only `https://127.0.0.1:4173`. The browser prompts for HTTP Basic
credentials on the first request. A successful request receives a Secure,
HttpOnly, SameSite=Strict, host-only session cookie so the same-origin Vite WSS
connection can authenticate without putting credentials in its URL. CORS is
disabled, the request `Host` must be exactly `127.0.0.1:4173`, and WebSocket
upgrades must also carry the exact HTTPS origin.

Close the browser session after testing. Rotate the shared password and restart
the lab if access may have been exposed; changing either the password or
certificate invalidates the derived session cookie.

## Fail-closed checks

Startup rejects missing or relative TLS paths, unreadable or oversized files,
malformed/expired/not-yet-valid certificates, a missing `127.0.0.1` IP SAN,
mismatched keys, weak credential shapes, HTTP/HMR boundary overrides, builds,
and previews. It never falls back to plaintext HTTP.

The certificate trust decision remains external to Node and must be verified in
the actual browser profile. This shared local Basic-auth control is not an
identity provider, per-user authorization system, production session service,
or substitute for independent security review. Because the server remains
bound only to host loopback, it still does not enable a physical phone to open
the page for same-device mobile validation.
