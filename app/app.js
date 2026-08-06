import express from "express";

const OIDC_COOKIE_PREFIX = "TraefikOidcAuth.";
const OIDC_SESSION_COOKIE = `${OIDC_COOKIE_PREFIX}Session`;
const OIDC_CODE_VERIFIER_COOKIE = `${OIDC_COOKIE_PREFIX}CodeVerifier`;
const OIDC_COOKIE_NAME = /^TraefikOidcAuth\.(?:CodeVerifier|Session(?:\.(?:Chunks|\d+))?)$/;

const HTML_ESCAPE = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPE[character]);
}

function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseCookies(cookieHeader = "") {
  const cookies = [];

  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;

    const name = segment.slice(0, separator).trim();
    if (!name) continue;

    let value = segment.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    cookies.push([name, decodeCookieValue(value)]);
  }

  return cookies.sort(([left], [right]) => left.localeCompare(right));
}

function oidcCookieNames(cookieHeader = "") {
  const names = new Set([
    OIDC_SESSION_COOKIE,
    `${OIDC_SESSION_COOKIE}.Chunks`,
    OIDC_CODE_VERIFIER_COOKIE,
  ]);

  for (const [name] of parseCookies(cookieHeader)) {
    if (OIDC_COOKIE_NAME.test(name)) names.add(name);
  }

  return [...names];
}

function requestHeaders(request) {
  const headers = [];

  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    headers.push([request.rawHeaders[index], request.rawHeaders[index + 1]]);
  }

  return headers.sort(([left], [right]) => left.localeCompare(right));
}

function rows(entries, emptyMessage, kind) {
  if (entries.length === 0) {
    return `<tr><td colspan="2" class="empty">${escapeHtml(emptyMessage)}</td></tr>`;
  }

  return entries
    .map(([name, value]) => {
      const isOidc = kind === "header" && name.toLowerCase().startsWith("x-oidc-");
      const isIdToken = kind === "header" && name.toLowerCase() === "x-oidc-id-token";
      const className = isOidc ? ' class="oidc-row"' : "";
      const jwtAction = isIdToken
        ? `<a class="jwt-link" href="${escapeHtml(`https://jwt.io/#debugger-io?token=${encodeURIComponent(value)}`)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(name)} in jwt.io" title="Open in jwt.io">
              <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16"><path d="M14 5h5v5M19 5l-8 8M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
            </a>`
        : "";
      return `<tr${className}><th scope="row">${escapeHtml(name)}</th><td><div class="header-value"><code>${escapeHtml(value)}</code>${jwtAction}</div></td></tr>`;
    })
    .join("");
}

function page(request) {
  const headers = requestHeaders(request);
  const cookies = parseCookies(request.headers.cookie);
  const identityHeaders = headers.filter(([name]) => name.toLowerCase().startsWith("x-oidc-"));
  const otherHeaders = headers.filter(([name]) => !name.toLowerCase().startsWith("x-oidc-"));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Request inspector</title>
    <style>
      :root {
        color-scheme: light dark;
        --background: #0b1020;
        --surface: #131a2d;
        --surface-strong: #19233c;
        --border: #2a3858;
        --text: #f2f6ff;
        --muted: #9eabc5;
        --accent: #6ee7b7;
        --accent-soft: rgba(110, 231, 183, 0.09);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: radial-gradient(circle at top left, #17234a 0, var(--background) 38rem);
        color: var(--text);
      }
      main { width: min(1120px, calc(100% - 2rem)); margin: 0 auto; padding: 3.5rem 0 5rem; }
      header { display: grid; gap: 1rem; margin-bottom: 2rem; }
      .header-top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
      .eyebrow { margin: 0; color: var(--accent); font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      .logout-button { display: inline-flex; align-items: center; justify-content: center; min-height: 2.75rem; padding: .6rem 1rem; border: 1px solid var(--border); border-radius: .7rem; background: var(--surface); color: var(--text); font-size: .85rem; font-weight: 700; text-decoration: none; }
      .logout-button:hover { border-color: var(--accent); background: var(--surface-strong); }
      .logout-button:active { transform: translateY(1px); }
      .logout-button:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
      h1 { margin: 0; font-size: clamp(2rem, 6vw, 4.25rem); line-height: .98; letter-spacing: -.055em; }
      .lede { max-width: 48rem; margin: 0; color: var(--muted); font-size: 1.05rem; line-height: 1.65; }
      .warning { border-left: 3px solid #fbbf24; padding: .35rem 0 .35rem 1rem; color: #fde68a; font-size: .9rem; }
      .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; margin: 2rem 0; }
      .stat { padding: 1rem 1.1rem; border: 1px solid var(--border); border-radius: .8rem; background: rgba(19, 26, 45, .82); }
      .stat span { display: block; color: var(--muted); font-size: .76rem; text-transform: uppercase; letter-spacing: .08em; }
      .stat strong { display: block; margin-top: .35rem; font-size: 1.1rem; overflow-wrap: anywhere; }
      section { margin-top: 1.25rem; overflow: hidden; border: 1px solid var(--border); border-radius: 1rem; background: rgba(19, 26, 45, .92); box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, .18); }
      section h2 { margin: 0; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); font-size: .9rem; letter-spacing: .09em; text-transform: uppercase; }
      .header-inspector { margin-top: 1.25rem; overflow: hidden; border: 1px solid var(--border); border-radius: 1rem; background: rgba(19, 26, 45, .92); box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, .18); }
      .tab-list { display: flex; gap: .25rem; padding: .55rem .55rem 0; border-bottom: 1px solid var(--border); }
      .tab { position: relative; display: inline-flex; align-items: center; gap: .55rem; min-height: 2.8rem; padding: .65rem .8rem .75rem; border: 0; border-radius: .65rem .65rem 0 0; background: transparent; color: var(--muted); font: inherit; font-size: .84rem; font-weight: 750; cursor: pointer; }
      .tab::after { position: absolute; right: .7rem; bottom: -1px; left: .7rem; height: 2px; background: var(--accent); content: ""; opacity: 0; transform: scaleX(.5); transition: opacity 120ms ease, transform 120ms ease; }
      .tab:hover { color: var(--text); background: var(--surface-strong); }
      .tab[aria-selected="true"] { color: var(--text); }
      .tab[aria-selected="true"]::after { opacity: 1; transform: scaleX(1); }
      .tab:focus-visible { z-index: 1; outline: 3px solid var(--accent); outline-offset: -3px; }
      .tab-count { display: inline-grid; min-width: 1.45rem; height: 1.45rem; padding: 0 .35rem; place-items: center; border-radius: 99px; background: var(--surface-strong); color: var(--muted); font-size: .7rem; }
      .tab[aria-selected="true"] .tab-count { background: var(--accent); color: #092218; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { padding: .85rem 1.25rem; border-bottom: 1px solid rgba(42, 56, 88, .72); text-align: left; vertical-align: top; }
      tr:last-child th, tr:last-child td { border-bottom: 0; }
      th { width: min(32%, 18rem); color: var(--muted); font-size: .82rem; font-weight: 650; overflow-wrap: anywhere; }
      td { font-size: .86rem; }
      code { color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
      .header-value { display: flex; align-items: flex-start; gap: .65rem; }
      .header-value code { min-width: 0; flex: 1; }
      .jwt-link { display: inline-grid; width: 2rem; height: 2rem; flex: 0 0 auto; place-items: center; border: 1px solid var(--border); border-radius: .5rem; color: var(--accent); }
      .jwt-link:hover { border-color: var(--accent); background: var(--surface-strong); }
      .jwt-link:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
      .jwt-link svg { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
      .oidc-row { background: var(--accent-soft); }
      .oidc-row th::after { content: "OIDC"; margin-left: .5rem; padding: .15rem .35rem; border-radius: 99px; background: var(--accent); color: #092218; font-size: .58rem; letter-spacing: .06em; }
      .empty { color: var(--muted); font-style: italic; }
      @media (max-width: 680px) {
        main { padding-top: 2rem; }
        .stats { grid-template-columns: 1fr; }
        table { table-layout: auto; }
        th, td { padding: .75rem; }
        th { min-width: 9rem; }
        .tab { flex: 1; justify-content: center; padding-inline: .5rem; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="header-top">
          <p class="eyebrow">Traefik + OpenID Connect</p>
          <a class="logout-button" href="/logout">Logout</a>
        </div>
        <h1>What reached Express?</h1>
        <p class="lede">This page is served by the loopback-only Express app after Traefik authenticates the request. Identity headers injected by the OIDC middleware are highlighted.</p>
        <p class="warning">Debug data can contain credentials and personal information. Do not expose this viewer publicly or share screenshots without redacting them.</p>
      </header>

      <div class="stats" aria-label="Request summary">
        <div class="stat"><span>Request</span><strong>${escapeHtml(request.method)} ${escapeHtml(request.originalUrl)}</strong></div>
        <div class="stat"><span>Received</span><strong>${headers.length} headers · ${cookies.length} cookies</strong></div>
        <div class="stat"><span>OIDC identity</span><strong>${identityHeaders.length} forwarded headers</strong></div>
      </div>

      <div class="header-inspector">
        <div class="tab-list" role="tablist" aria-label="Header groups">
          <button class="tab" id="identity-tab" type="button" role="tab" aria-selected="true" aria-controls="identity-panel">
            Identity Headers <span class="tab-count">${identityHeaders.length}</span>
          </button>
          <button class="tab" id="request-tab" type="button" role="tab" aria-selected="false" aria-controls="request-panel" tabindex="-1">
            Request Headers <span class="tab-count">${otherHeaders.length}</span>
          </button>
        </div>
        <div id="identity-panel" role="tabpanel" aria-labelledby="identity-tab">
          <div class="table-wrap">
            <table><tbody>${rows(identityHeaders, "No OIDC identity headers received.", "header")}</tbody></table>
          </div>
        </div>
        <div id="request-panel" role="tabpanel" aria-labelledby="request-tab" hidden>
          <div class="table-wrap">
            <table><tbody>${rows(otherHeaders, "No other request headers received.", "header")}</tbody></table>
          </div>
        </div>
      </div>

      <section>
        <h2>Cookies</h2>
        <div class="table-wrap">
          <table><tbody>${rows(cookies, "No cookies received.", "cookie")}</tbody></table>
        </div>
      </section>
    </main>
    <script src="/tabs.js"></script>
  </body>
</html>`;
}

const tabsScript = `const tabs = [...document.querySelectorAll('[role="tab"]')];

function activateTab(tab) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  }
  tab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    activateTab(tabs[nextIndex]);
  });
});`;

function loggedOutPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Signed out</title>
    <style>
      :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { display: grid; min-height: 100vh; margin: 0; place-items: center; background: #0b1020; color: #f2f6ff; }
      main { width: min(32rem, calc(100% - 2rem)); padding: 2rem; border: 1px solid #2a3858; border-radius: 1rem; background: #131a2d; text-align: center; }
      h1 { margin: 0 0 .75rem; }
      p { margin: 0 0 1.5rem; color: #9eabc5; line-height: 1.6; }
      a { display: inline-flex; min-height: 2.75rem; align-items: center; padding: .6rem 1rem; border-radius: .7rem; background: #6ee7b7; color: #092218; font-weight: 800; text-decoration: none; }
      a:focus-visible { outline: 3px solid #6ee7b7; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Signed out locally</h1>
      <p>Your local application session has been removed. Your identity-provider session is unchanged.</p>
      <a href="/">Sign in again</a>
    </main>
  </body>
</html>`;
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", (_request, response) => {
    response.set("Cache-Control", "no-store").status(200).json({ status: "ok" });
  });

  app.get("/tabs.js", (_request, response) => {
    response.set("Cache-Control", "public, max-age=86400").type("js").send(tabsScript);
  });

  app.get("/logout", (request, response) => {
    const cookieOptions = {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.OIDC_COOKIE_SECURE !== "false",
    };

    for (const name of oidcCookieNames(request.headers.cookie)) {
      response.clearCookie(name, cookieOptions);
    }

    response
      .set({
        "Cache-Control": "no-store, max-age=0",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      })
      .status(200)
      .type("html")
      .send(loggedOutPage());
  });

  app.get("/{*path}", (request, response) => {
    response
      .set({
        "Cache-Control": "no-store, max-age=0",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      })
      .status(200)
      .type("html")
      .send(page(request));
  });

  return app;
}
