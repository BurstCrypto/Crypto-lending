FROM node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS npm-toolchain

ENV DO_NOT_TRACK=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    SCARF_ANALYTICS=false

ADD --checksum=sha256:9c07edca12853cddbf4fed4e372485aa60c064f9bf3e4cd157a2db5518a1792b --chmod=0444 https://registry.npmjs.org/npm/-/npm-11.6.4.tgz /tmp/npm-11.6.4.tgz

RUN test "$(wc -c < /tmp/npm-11.6.4.tgz)" -eq 2407857 \
    && printf '%s  %s\n' 9c07edca12853cddbf4fed4e372485aa60c064f9bf3e4cd157a2db5518a1792b /tmp/npm-11.6.4.tgz | sha256sum --check --strict \
    && install --directory --owner 0 --group 0 --mode 0755 /opt/npm \
    && tar --extract --gzip --file /tmp/npm-11.6.4.tgz --directory /opt/npm --strip-components=1 --no-same-owner \
    && chown --recursive 0:0 /opt/npm \
    && chmod --recursive u=rwX,go=rX /opt/npm \
    && ln --symbolic --force /opt/npm/bin/npm-cli.js /usr/local/bin/npm \
    && node --eval "if (require('/opt/npm/package.json').version !== '11.6.4') process.exit(1)" \
    && test "$(npm --version)" = 11.6.4 \
    && rm /tmp/npm-11.6.4.tgz

WORKDIR /workspace

FROM npm-toolchain AS api-build

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/nest-cli.json apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY apps/web/package.json apps/web/package.json

RUN npm ci --ignore-scripts --no-audit --no-fund --workspace @crypto-lending/api --include-workspace-root=false

COPY apps/api/src apps/api/src

RUN --network=none npm run build --workspace @crypto-lending/api \
    && find apps/api/dist -type f \( -name '*.d.ts' -o -name '*.map' \) -delete

FROM npm-toolchain AS api-production-dependencies

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci --ignore-scripts --no-audit --no-fund --omit=dev --workspace @crypto-lending/api --include-workspace-root=false \
    && npm cache clean --force

FROM node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS backend-runtime

ARG SOURCE_REVISION

ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/aws-rds-global-bundle.pem \
    PATH=/opt/crypto-lending/node_modules/.bin:${PATH}

LABEL org.opencontainers.image.source="https://github.com/Trey-Gleason/Crypto-lending" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.version="${SOURCE_REVISION}" \
      org.opencontainers.image.title="Crypto Lending backend"

RUN printf '%s' "${SOURCE_REVISION}" | grep -Eq '^[a-f0-9]{40}$' \
    && groupadd --gid 10001 crypto-lending \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin crypto-lending \
    && install --directory --owner 0 --group 0 --mode 0755 /etc/ssl/certs \
    && install --directory --owner 10001 --group 10001 --mode 0755 /opt/crypto-lending/apps/api

ADD --checksum=sha256:e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3 --chmod=0444 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/aws-rds-global-bundle.pem

RUN test "$(wc -c < /etc/ssl/certs/aws-rds-global-bundle.pem)" -eq 165408 \
    && printf '%s  %s\n' e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3 /etc/ssl/certs/aws-rds-global-bundle.pem | sha256sum --check --strict

WORKDIR /opt/crypto-lending

COPY --from=api-production-dependencies --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=api-production-dependencies --chown=10001:10001 /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=api-build --chown=10001:10001 /workspace/apps/api/dist ./apps/api/dist

WORKDIR /opt/crypto-lending/apps/api

RUN test -f dist/main.js \
    && test -f dist/infrastructure/database/migration.cli.js \
    && test -f dist/infrastructure/outbox/outbox-worker.cli.js \
    && test -f dist/infrastructure/outbox/outbox-worker-health.cli.js

USER 10001:10001

FROM backend-runtime AS api

EXPOSE 3001
USER 10001:10001
CMD ["node", "dist/main.js"]

FROM backend-runtime AS worker

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD ["node", "dist/infrastructure/outbox/outbox-worker-health.cli.js"]
USER 10001:10001
CMD ["node", "dist/infrastructure/outbox/outbox-worker.cli.js"]
