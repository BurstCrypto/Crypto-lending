ARG OCI_SOURCE=
ARG OCI_REVISION=0000000000000000000000000000000000000000
ARG OCI_CREATED=1970-01-01T00:00:00Z

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d

ARG OCI_SOURCE
ARG OCI_REVISION
ARG OCI_CREATED
LABEL org.opencontainers.image.base.digest="sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d" \
      org.opencontainers.image.base.name="docker.io/library/caddy:2.10.2-alpine" \
      org.opencontainers.image.created="${OCI_CREATED}" \
      org.opencontainers.image.description="Crypto Lending same-origin Railway gateway" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.source="${OCI_SOURCE}" \
      org.opencontainers.image.title="crypto-lending-gateway"

RUN addgroup -S caddy \
    && adduser -S -D -H -G caddy caddy \
    && chown -R caddy:caddy /config /data /etc/caddy

COPY Caddyfile /etc/caddy/Caddyfile

USER caddy

EXPOSE 8080
