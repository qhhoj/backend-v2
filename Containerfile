# Backend image: api, bridge, worker and migrator; APP picks one (deploy/container/entrypoint.sh).
# Build stage has python3/make/g++ (native modules); runtime is bookworm-slim, same glibc.
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npx nest build bridge && npx nest build worker && npx nest build migrator \
 && npm prune --omit=dev

FROM node:22-bookworm-slim
ARG QHHOJ_UID=987
LABEL org.opencontainers.image.source=https://github.com/qhhoj/backend-v2
ARG PANDOC_VERSION=3.1.3
ARG PANDOC_SHA256=74bc434908e4d858b3edbfd6271d2e9e499477837e5df1d630df4e62f113803d
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright HOME=/tmp
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tini util-linux \
 && curl -fsSL -o /tmp/pandoc.tgz "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-amd64.tar.gz" \
 && echo "${PANDOC_SHA256}  /tmp/pandoc.tgz" | sha256sum -c - \
 && tar -xzf /tmp/pandoc.tgz -C /opt && ln -s "/opt/pandoc-${PANDOC_VERSION}/bin/pandoc" /usr/local/bin/pandoc \
 && rm /tmp/pandoc.tgz \
 && groupadd -g "${QHHOJ_UID}" qhhoj \
 && useradd -u "${QHHOJ_UID}" -g "${QHHOJ_UID}" --system --no-create-home --shell /usr/sbin/nologin qhhoj
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN npx playwright install --with-deps chromium \
 && chmod -R a+rX /opt/ms-playwright \
 && rm -rf /var/lib/apt/lists/*
COPY deploy/container/entrypoint.sh /usr/local/bin/qhhoj-entrypoint
USER qhhoj
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/qhhoj-entrypoint"]
