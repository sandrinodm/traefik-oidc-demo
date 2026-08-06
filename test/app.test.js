import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp, escapeHtml, parseCookies } from "../app/app.js";

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
      "X-Test": "<img src=x onerror=alert(1)>",
    },
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(body, /X-OIDC-Email/i);
  assert.match(body, /<a class="logout-button" href="\/logout">Logout<\/a>/);
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
