# Railway public gateway

This is the service planned to receive the only public Railway domain. Once
authorized, it keeps the browser's existing same-origin contract by forwarding
`/api/v1/*` to the API and every other path to the Next.js web service.

The service requires these private-network origins:

- `API_ORIGIN=http://api.railway.internal:3001`
- `WEB_ORIGIN=http://web.railway.internal:3000`

`/healthz` is intentionally gateway-only liveness. The web and API services
have their own Railway health checks, so a healthy proxy cannot mask an
unhealthy application replica.

## Production interlock

This configuration is deliberately plan-only and currently attaches no public
domain. The repository's current API
image still requires AWS workload identity, SQS, and scoped TLS data-service
credentials, so every application service has a start-command interlock and CI
does not contain an apply job. Do not remove these guards until the Postgres
outbox worker migration is complete, the gateway's exact trusted peer ranges
are recorded, and the repository's signed production preflight verifies the
merge SHA, image digests, Railway destination, evidence bundle, and seven-role
public-launch decision.

The current Caddy defaults replace untrusted incoming forwarding headers with
the immediate peer, which prevents header spoofing but does not yet preserve a
browser's address through Railway's edge. Before activation, record Railway's
reviewed edge-header contract, configure Caddy's trusted proxies and client-IP
headers from that contract, and prove with integration tests that distinct
clients retain distinct rate-limit buckets while forged or list-valued headers
fail closed.
