FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d

RUN addgroup -S caddy \
    && adduser -S -D -H -G caddy caddy \
    && chown -R caddy:caddy /config /data /etc/caddy

COPY Caddyfile /etc/caddy/Caddyfile

USER caddy

EXPOSE 8080
