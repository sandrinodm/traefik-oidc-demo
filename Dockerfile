# syntax=docker/dockerfile:1.7

FROM alpine:3.22 AS oidc-plugin
ARG OIDC_PLUGIN_VERSION=v0.21.0
SHELL ["/bin/ash", "-eo", "pipefail", "-c"]
RUN apk add --no-cache ca-certificates wget \
    && mkdir -p /plugins-local/src/github.com/sevensolutions/traefik-oidc-auth \
    && wget -qO- "https://github.com/sevensolutions/traefik-oidc-auth/archive/refs/tags/${OIDC_PLUGIN_VERSION}.tar.gz" \
      | tar -xz --strip-components=1 -C /plugins-local/src/github.com/sevensolutions/traefik-oidc-auth

FROM node:24-alpine3.22 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM traefik:v3.7.10 AS traefik

FROM alpine:3.22
ENV NODE_ENV=production \
    APP_INTERNAL_PORT=3000
WORKDIR /app

RUN apk add --no-cache ca-certificates nodejs \
    && addgroup -S app \
    && adduser -S -G app app

COPY --from=traefik /usr/local/bin/traefik /usr/local/bin/traefik
COPY --from=oidc-plugin /plugins-local ./plugins-local
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=app:app package.json ./
COPY --chown=app:app app ./app
COPY --chown=app:app traefik/traefik.yml /etc/traefik/traefik.yml
COPY --chown=app:app traefik/dynamic.yml /etc/traefik/dynamic.yml

USER app
EXPOSE 80
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:80/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

ENTRYPOINT ["node", "/app/app/start.js"]
