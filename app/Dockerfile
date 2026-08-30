# syntax=docker/dockerfile:1.7

FROM node:24-alpine3.22 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine3.22
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

RUN addgroup -S app && adduser -S -G app app

COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=app:app package.json ./
COPY --chown=app:app app.js server.js ./

USER app
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
