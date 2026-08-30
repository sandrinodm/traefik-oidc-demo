# syntax=docker/dockerfile:1.7

FROM alpine:3.22 AS oidc-plugin
ARG OIDC_PLUGIN_VERSION=v0.21.0
SHELL ["/bin/ash", "-eo", "pipefail", "-c"]
RUN apk add --no-cache ca-certificates wget \
    && mkdir -p /plugins-local/src/github.com/sevensolutions/traefik-oidc-auth \
    && wget -qO- "https://github.com/sevensolutions/traefik-oidc-auth/archive/refs/tags/${OIDC_PLUGIN_VERSION}.tar.gz" \
      | tar -xz --strip-components=1 -C /plugins-local/src/github.com/sevensolutions/traefik-oidc-auth

FROM node:24-alpine AS selector-styles
WORKDIR /build
COPY provider-selector/package.json provider-selector/package-lock.json ./
RUN npm ci
COPY provider-selector/input.css provider-selector/page.html ./
RUN npm run build:css

FROM traefik:v3.7.12 AS traefik

FROM alpine:3.22
WORKDIR /

RUN apk add --no-cache ca-certificates \
    && addgroup -S traefik \
    && adduser -S -G traefik traefik

COPY --from=traefik /usr/local/bin/traefik /usr/local/bin/traefik
COPY --from=oidc-plugin /plugins-local /plugins-local
COPY --chown=traefik:traefik \
    provider-selector/.traefik.yml \
    provider-selector/go.mod \
    provider-selector/page.html \
    provider-selector/selector.go \
    /plugins-local/src/github.com/sandrinodm/traefik-oidc-provider-selector/
COPY --from=selector-styles --chown=traefik:traefik \
    /build/styles.css \
    /plugins-local/src/github.com/sandrinodm/traefik-oidc-provider-selector/styles.css
COPY --chown=traefik:traefik traefik.yml /etc/traefik/traefik.yml
COPY --chown=traefik:traefik dynamic.yml /etc/traefik/dynamic.yml

USER traefik
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/healthz"]

ENTRYPOINT ["traefik"]
CMD ["--configFile=/etc/traefik/traefik.yml"]
