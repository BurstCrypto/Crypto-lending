FROM node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS npm-toolchain

ENV DO_NOT_TRACK=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    SCARF_ANALYTICS=false

RUN npm install --global --ignore-scripts npm@11.6.4 \
    && test "$(npm --version)" = 11.6.4

WORKDIR /workspace

FROM npm-toolchain AS web-build

ARG SOURCE_REVISION
ENV SOURCE_REVISION=${SOURCE_REVISION}

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/next.config.ts apps/web/next-env.d.ts apps/web/proxy.ts apps/web/tsconfig.json apps/web/

RUN printf '%s' "${SOURCE_REVISION}" | grep -Eq '^[a-f0-9]{40}$' \
    && npm ci --ignore-scripts --workspace @crypto-lending/web --include-workspace-root=false

COPY apps/web/app apps/web/app
COPY apps/web/components apps/web/components
COPY apps/web/lib apps/web/lib

RUN npm run build --workspace @crypto-lending/web \
    && test "$(cat apps/web/.next/BUILD_ID)" = "${SOURCE_REVISION}"

FROM node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS web

ARG SOURCE_REVISION

ENV HOSTNAME=0.0.0.0 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

LABEL org.opencontainers.image.source="https://github.com/Trey-Gleason/Crypto-lending" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.version="${SOURCE_REVISION}" \
      org.opencontainers.image.title="Crypto Lending web"

RUN printf '%s' "${SOURCE_REVISION}" | grep -Eq '^[a-f0-9]{40}$' \
    && groupadd --gid 10001 crypto-lending \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin crypto-lending \
    && install --directory --owner 10001 --group 10001 --mode 0755 /opt/crypto-lending/apps/web

WORKDIR /opt/crypto-lending

COPY --from=web-build --chown=10001:10001 /workspace/apps/web/.next/standalone ./
COPY --from=web-build --chown=10001:10001 /workspace/apps/web/.next/static ./apps/web/.next/static

WORKDIR /opt/crypto-lending/apps/web

RUN test -f server.js \
    && test "$(cat .next/BUILD_ID)" = "${SOURCE_REVISION}"

USER 10001:10001

EXPOSE 3000
CMD ["node", "server.js"]
