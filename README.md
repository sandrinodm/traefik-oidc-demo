# Traefik OIDC header viewer

This demo builds **one Docker image** and runs **one Compose service**. Inside that container:

1. Traefik listens on unprivileged container port `8080` and runs an OpenID Connect middleware. Compose maps host port `80` to it by default.
2. The middleware completes the OIDC authorization-code flow, validates the issuer and audience, and adds selected identity claims as `X-OIDC-*` headers.
3. Traefik proxies authenticated requests to an Express app bound only to `127.0.0.1:3000`.
4. Express renders every incoming request header and cookie in tables.

The image pins Traefik `v3.7.10` and packages the `sevensolutions/traefik-oidc-auth` plugin at `v0.21.0`, so the running container does not download plugin code.

## Run it

Requirements: Docker with Docker Compose and an OIDC client from your identity provider.

1. Register this redirect URI with the OIDC client:

   ```text
   https://<your-app-host>/oauth2/callback
   ```

   The middleware forces the generated callback scheme to HTTPS while retaining the hostname from the incoming request.

2. Create your local configuration:

   ```bash
   cp .env.example .env
   openssl rand -hex 16
   ```

   Put the generated 32-character value in `OIDC_SESSION_SECRET`, then set:

   - `OIDC_ISSUER`: the issuer/base URL used for OIDC discovery, such as `https://id.example.com/realms/demo`
   - `OIDC_CLIENT_ID`: the registered client ID
   - `OIDC_CLIENT_SECRET`: the registered client secret

3. Build and start the single service:

   ```bash
   docker compose up --build
   ```

4. Open the app through its HTTPS URL. After login, the page shows the exact headers and cookies received by Express. Use the **Logout** button to remove the app's local OIDC session. This does not end the identity-provider session, so signing in again may not require credentials.

To stop it:

```bash
docker compose down
```

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OIDC_ISSUER` | yes | — | OIDC provider URL/issuer |
| `OIDC_CLIENT_ID` | yes | — | OAuth/OIDC client ID |
| `OIDC_CLIENT_SECRET` | yes | — | OAuth/OIDC client secret |
| `OIDC_SESSION_SECRET` | yes | — | Exactly 32 characters used to encrypt plugin session data |
| `OIDC_CALLBACK_URI` | no | `/oauth2/callback` | Relative or absolute registered callback URI; relative callbacks are generated with an HTTPS scheme |
| `OIDC_COOKIE_SECURE` | no | `true` | Marks the OIDC session cookie as HTTPS-only |
| `OIDC_LOG_LEVEL` | no | `WARN` | Plugin log level |
| `APP_PORT` | no | `80` | Host port mapped to Traefik |

When deploying with Aiven Apps, expose port `8080`. The image deliberately runs as a non-root user, which cannot bind privileged port `80` without additional runtime capabilities.

The requested scopes are `openid`, `profile`, and `email`. The middleware forwards `sub`, `email`, `name`, and `preferred_username` as individual `X-OIDC-*` headers when the provider supplies those claims. It also forwards the complete claims map as `X-OIDC-Claims` and the raw ID token as `X-OIDC-ID-Token`. In plugin version `v0.21.0`, the claims-map header uses Go's map representation rather than JSON; applications that need a machine-readable complete claim set should decode and validate `X-OIDC-ID-Token` instead.

## Production cautions

This is intentionally a request debugger: it displays authentication cookies, the complete OIDC claims map, and the raw ID token. Keep it private, use temporary credentials, and never treat it as a production application.

For a production-like deployment, terminate TLS at Traefik or a trusted upstream proxy, use an `https://` callback, set `OIDC_COOKIE_SECURE=true`, and store client/session secrets using your platform's secret manager. Environment variables are convenient for a demo but can be visible through container-inspection tooling.

Traefik Proxy does not include the documented native OIDC middleware; that middleware is a Traefik Hub feature. This project therefore uses a pinned community plugin from the Traefik Plugin Catalog. Traefik classifies plugins as experimental, so review and test the pinned plugin before using it for sensitive systems.

## Development checks

```bash
npm install
npm test
docker compose config
docker compose build
```

The container health check calls `http://127.0.0.1:8080/healthz` through Traefik. That one route is deliberately exempt from OIDC and returns only `{"status":"ok"}`; every request-inspector page remains protected.
