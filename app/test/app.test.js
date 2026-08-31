import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp, escapeHtml, parseCookies } from "../app.js";

test("escapeHtml neutralizes values rendered into the inspector", () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
});

test("parseCookies handles encoded values, equals signs, and malformed encoding", () => {
  assert.deepEqual(parseCookies("theme=dark; token=a=b=c; label=hello%20world; bad=%ZZ"), [
    ["bad", "%ZZ"],
    ["label", "hello world"],
    ["theme", "dark"],
    ["token", "a=b=c"],
  ]);
});

test("the request page shows headers and cookies without executing their markup", async (context) => {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/example?value=1`, {
    headers: {
      Cookie: "session=abc123; preference=compact",
      "X-OIDC-Email": "person@example.com",
      "X-OIDC-ID-Token": "header.payload.signature",
      "X-Test": "<img src=x onerror=alert(1)>",
    },
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(body, /X-OIDC-Email/i);
  assert.match(body, /role="tablist"/);
  assert.match(body, /Identity Headers/);
  assert.match(body, /Request Headers/);
  assert.match(body, /id="request-panel"[^>]* hidden/);
  assert.match(body, /https:\/\/jwt\.io\/#debugger-io\?token=header\.payload\.signature/);
  assert.match(body, /target="_blank" rel="noopener noreferrer"/);
  assert.match(body, /<a class="topbar-link" href="\/login">Switch provider<\/a>/);
  assert.match(body, /<a class="topbar-link" href="\/logout">Logout<\/a>/);
  assert.match(body, /person@example\.com/);
  assert.match(body, /preference/);
  assert.match(body, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(body, /<img src=x/);
});

test("the health endpoint returns a small no-store response", async (context) => {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);

  assert.deepEqual(await response.json(), { status: "ok" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("logout expires local OIDC cookies, including session chunks", async (context) => {
  const previousCookieSecure = process.env.OIDC_COOKIE_SECURE;
  process.env.OIDC_COOKIE_SECURE = "false";
  context.after(() => {
    if (previousCookieSecure === undefined) delete process.env.OIDC_COOKIE_SECURE;
    else process.env.OIDC_COOKIE_SECURE = previousCookieSecure;
  });

  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/logout`, {
    headers: {
      Cookie:
        "TraefikOidcAuth.Session.Chunks=2; TraefikOidcAuth.Session.1=first; TraefikOidcAuth.Session.2=second; TraefikOidcAuth.CodeVerifier=verifier; preference=compact",
    },
  });
  const body = await response.text();
  const setCookies = response.headers.getSetCookie();

  assert.equal(response.status, 200);
  assert.match(body, /Signed out locally/);
  assert.match(body, /identity-provider session is unchanged/);
  assert.deepEqual(
    setCookies.map((cookie) => cookie.match(/^([^=]+)/)[1]).sort(),
    [
      "TraefikOidcAuth.Session",
      "TraefikOidcAuth.Session.1",
      "TraefikOidcAuth.Session.2",
      "TraefikOidcAuth.Session.Chunks",
      "TraefikOidcAuth.CodeVerifier",
    ].sort(),
  );
  for (const cookie of setCookies) {
    assert.match(cookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  }
  assert.doesNotMatch(setCookies.join("\n"), /preference/);
});
