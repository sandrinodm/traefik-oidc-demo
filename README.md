# Traefik multi-provider OIDC header viewer

This branch runs two containers with three logical components:

1. **Traefik Proxy** runs two local Go middleware plugins in its own process: [`sevensolutions/traefik-oidc-auth`](https://github.com/sevensolutions/traefik-oidc-auth) enforces OIDC, while the repository's `oidc-provider-selector` plugin renders the provider page and owns provider selection and local logout.
2. **Express app** is the repository's original request inspector: the same UI, identity/request tabs, header and cookie tables, ID-token link, logout link, health endpoint, and tests. Only its process entrypoint changed so it can run independently from Traefik.

There is no identity broker. Each enabled provider has an independent OIDC client, callback path, encrypted session, cookie prefix, and plugin middleware instance. The example uses Google and Auth0, but either slot can use another standards-compliant OpenID Connect provider.

The images pin Traefik `v3.7.12`, Node `24`, and `traefik-oidc-auth` `v0.21.0`. The Traefik image vendors both Go plugins at build time and does not download plugin code while running. Traefik executes local Go plugins through its embedded Yaegi runtime; there is no selector process or internal selector port.

## Request flow

The plugin accepts one `Provider` block per middleware instance, rather than a provider array. Traefik therefore creates `oidc-provider-1` and `oidc-provider-2` independently.

```text
No selector cookie
Browser ──> Traefik selector middleware
                    │
                    └── sets oidc_provider=provider-1|provider-2

Selected provider
Browser ──> Traefik ──> selected OIDC middleware ──> Express header viewer
```

1. Without a valid selector cookie, a low-priority Traefik router invokes the local selector middleware. The middleware answers the request directly and never forwards it to Express.
2. With multiple enabled providers, the middleware renders the choice page. With one provider, it selects that provider and redirects without showing the page.
3. The `HttpOnly`, `SameSite=Lax` selector cookie contains only a configured enum. It chooses a middleware and is never accepted as proof of identity.
4. A higher-priority `HeaderRegexp` router invokes exactly one OIDC middleware. The plugin still performs discovery, Authorization Code + PKCE, signature, expiry, issuer, and audience validation.
5. After authentication, Traefik forwards the original inspector data to Express: individual `X-OIDC-*` identity headers, the complete claims map, the raw ID token, and the browser cookies. It also adds `X-OIDC-Provider` so the selected provider is visible.

Callbacks are isolated by provider:

```text
/oauth2/callback/provider-1  →  oidc-provider-1
/oauth2/callback/provider-2  →  oidc-provider-2
```

## Configure Google and Auth0

Requirements: Docker with Docker Compose, one Google OAuth/OIDC web client, and one Auth0 Regular Web Application.

1. Create the local environment and generate two different 32-character session encryption secrets:

   ```bash
   cp .env.example .env
   openssl rand -hex 16
   openssl rand -hex 16
   ```

   Put the values in `OIDC_PROVIDER_1_SESSION_SECRET` and `OIDC_PROVIDER_2_SESSION_SECRET`.

2. Create a Google OAuth client of type **Web application** and register:

   ```text
   https://<your-app-host>/oauth2/callback/provider-1
   ```

   Configure:

   ```dotenv
   OIDC_PROVIDER_1_ISSUER=https://accounts.google.com
   OIDC_PROVIDER_1_CLIENT_ID=...
   OIDC_PROVIDER_1_CLIENT_SECRET=...
   ```

3. Create an Auth0 **Regular Web Application** and add this Allowed Callback URL:

   ```text
   https://<your-app-host>/oauth2/callback/provider-2
   ```

   Configure:

   ```dotenv
   OIDC_PROVIDER_2_ISSUER=https://your-tenant.eu.auth0.com/
   OIDC_PROVIDER_2_CLIENT_ID=...
   OIDC_PROVIDER_2_CLIENT_SECRET=...
   ```

4. Start the stack:

   ```bash
   docker compose up --build
   ```

5. Open the public URL, choose a provider, authenticate, and inspect the headers received by Express.

Stop the project with `docker compose down`.

### Plain local HTTP

The defaults preserve the original repository's HTTPS-behind-a-proxy behavior. For local HTTP instead, register these callbacks:

```text
http://localhost/oauth2/callback/provider-1
http://localhost/oauth2/callback/provider-2
```

Then set:

```dotenv
OIDC_COOKIE_SECURE=false
OIDC_FORCE_HTTPS=false
```

Change the callback port if `APP_PORT` is not `80`.

## One provider or different providers

To keep only provider 1:

```dotenv
OIDC_PROVIDER_1_ENABLED=true
OIDC_PROVIDER_2_ENABLED=false
```

The selector middleware bypasses its HTML page when exactly one provider is enabled. Provider names and enabled flags are the only provider settings in its middleware configuration. Client credentials, issuers, encryption secrets, claim mappings, and validation remain confined to the independent OIDC middleware instances.

The first provider slot retains compatibility with the original `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `OIDC_SESSION_SECRET` environment names. The new `OIDC_PROVIDER_1_*` names take precedence. The original single `/oauth2/callback` value is intentionally not reused because every provider requires a unique callback.

To replace Auth0 with another OIDC provider:

```dotenv
OIDC_PROVIDER_2_NAME=Company SSO
OIDC_PROVIDER_2_ISSUER=https://login.example.com/
OIDC_PROVIDER_2_CLIENT_ID=...
OIDC_PROVIDER_2_CLIENT_SECRET=...
```

The issuer must expose a valid `/.well-known/openid-configuration` document and issue ID tokens for this client. GitHub.com's user login is OAuth 2.0 rather than OpenID Connect and is not a direct substitute for this plugin.

## Configuration

| Variable | Required | Default | Used by | Purpose |
| --- | --- | --- | --- | --- |
| `APP_PORT` | no | `80` | Compose | Public host port |
| `OIDC_PROVIDER_1_ENABLED` | no | `true` | Traefik | Enable provider slot 1 |
| `OIDC_PROVIDER_1_NAME` | no | `Google` | Traefik | Button label and trusted provider header |
| `OIDC_PROVIDER_1_ISSUER` | when enabled | Google | Traefik | Discovery issuer |
| `OIDC_PROVIDER_1_CLIENT_ID` | when enabled | — | Traefik | Client ID |
| `OIDC_PROVIDER_1_CLIENT_SECRET` | when enabled | — | Traefik | Client secret |
| `OIDC_PROVIDER_1_SESSION_SECRET` | when enabled | — | Traefik | Unique 32-character session encryption key |
| `OIDC_PROVIDER_2_ENABLED` | no | `true` | Traefik | Enable provider slot 2 |
| `OIDC_PROVIDER_2_NAME` | no | `Auth0` | Traefik | Button label and trusted provider header |
| `OIDC_PROVIDER_2_ISSUER` | when enabled | — | Traefik | Discovery issuer |
| `OIDC_PROVIDER_2_CLIENT_ID` | when enabled | — | Traefik | Client ID |
| `OIDC_PROVIDER_2_CLIENT_SECRET` | when enabled | — | Traefik | Client secret |
| `OIDC_PROVIDER_2_SESSION_SECRET` | when enabled | — | Traefik | A second unique 32-character key |
| `OIDC_COOKIE_SECURE` | no | `true` | Traefik | Mark OIDC and selector cookies HTTPS-only |
| `OIDC_FORCE_HTTPS` | no | `true` | Traefik | Generate HTTPS callbacks behind a TLS terminator |
| `OIDC_LOG_LEVEL` | no | `WARN` | Traefik | Plugin log level |

The Express container receives none of these variables. Provider selection and OIDC configuration remain separate from the existing inspector application.

## Security notes

- Only Traefik publishes a port. Express is available only inside the Compose network; the selector has no listener because it runs in the Traefik process.
- Provider credentials and session encryption secrets are available only to Traefik.
- The selector middleware accepts configured provider enums, rejects cross-origin form posts, and allows only same-origin relative return paths. Its router uses an unreachable sink service so unexpected fallthrough fails closed instead of reaching Express.
- Traefik strips client-supplied identity headers before authentication, then creates trusted `X-OIDC-*` values from validated claims. Traefik 3.7 also rejects alternate spellings of managed header names via `aliasHeadersStrategy`.
- This remains an intentional request debugger: Express displays authentication cookies, the complete claims map, the raw ID token, and all other request headers. Keep the demo private and do not use real production credentials.
- `/logout` is handled by the selector middleware. It clears the provider choice and visible chunks of both local OIDC sessions, but does not end the provider's SSO session.
- Environment variables are convenient for the demo. For production, use the plugin's `${file:/path}` support with Docker or platform secrets.
- This is an experimental community plugin. Review and update the pinned version deliberately before sensitive production use.
- Avoid simultaneous login flows for the same provider in v0.21.0 because that version uses one prefix-scoped PKCE verifier cookie per provider.

## Development checks

```bash
cd app && npm ci && npm test
cd traefik/provider-selector && go test ./...
docker compose --env-file .env.example config
docker compose --env-file .env.example build
```

The public health endpoint is served directly by the selector middleware and exposes only status and enabled-provider count:

```bash
curl http://localhost/healthz
```
