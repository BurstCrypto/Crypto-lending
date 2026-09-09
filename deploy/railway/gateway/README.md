# Railway public gateway

This is the only service which receives a public Railway domain. It keeps the
browser's existing same-origin contract by forwarding `/api/v1/*` to the API
and every other path to the Next.js web service.

The service requires these private-network origins:

- `API_ORIGIN=http://api.railway.internal:3001`
- `WEB_ORIGIN=http://web.railway.internal:3000`

`/healthz` is intentionally gateway-only liveness. The web and API services
have their own Railway health checks, so a healthy proxy cannot mask an
unhealthy application replica.
