# Railway public gateway

This service receives the only public Railway domain. Once the separately
approved pinned plan is applied, it keeps the browser's same-origin contract by forwarding
`/api/v1/*` to the API and every other path to the Next.js web service.

The service requires these private-network origins:

- `API_ORIGIN=http://api.railway.internal:3001`
- `WEB_ORIGIN=http://web.railway.internal:3000`

`/healthz` is intentionally gateway-only liveness. The web and API services
have their own Railway health checks, so a healthy proxy cannot mask an
unhealthy application replica.

## Production gate

Pull requests remain plan-only. The manual deployment workflow binds the exact
merge SHA, image digests, Railway plan bytes, custom hostname, and seven-role
launch-decision digest, then requires approval from the separate
`production-apply` GitHub environment before it can apply that same plan. Since
Railway does not support first-time custom-domain registration in IaC, that
same approved job creates or reconciles the exact bound hostname after apply.

Railway's public edge overwrites `X-Real-IP` with the browser address and
`X-Forwarded-Proto` with the original scheme. Caddy replaces, rather than
appends to, `X-Forwarded-For` using that edge value and strips `X-Real-IP`
before proxying to the API. The gateway smoke test proves a forged/list-valued
`X-Forwarded-For` cannot survive that normalization.
