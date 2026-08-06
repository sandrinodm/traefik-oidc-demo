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
        color-scheme: light;
        --canvas: #f6f7f3;
        --surface: #fbfcf9;
        --surface-strong: #eef0eb;
        --border: #dfe2da;
        --border-strong: #cdd1c8;
        --text: #20231f;
        --muted: #6f746c;
        --quiet: #969b93;
        --accent: #2c8c63;
        --accent-strong: #1d6f4c;
        --accent-soft: #e4f2ea;
        --warning: #a25e18;
        --warning-soft: #f8eee1;
        font-family: "Avenir Next", Avenir, "Helvetica Neue", Helvetica, sans-serif;
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--canvas);
        color: var(--text);
        -webkit-font-smoothing: antialiased;
      }
      a, button { -webkit-tap-highlight-color: transparent; }
      .topbar {
        position: sticky;
        z-index: 10;
        top: 0;
        display: flex;
        height: 4.25rem;
        align-items: center;
        justify-content: space-between;
        padding: 0 1.25rem;
        border-bottom: 1px solid var(--border);
        background: color-mix(in srgb, var(--canvas) 92%, transparent);
        backdrop-filter: blur(12px);
      }
      .brand { display: flex; align-items: center; gap: .8rem; color: var(--text); text-decoration: none; }
      .brand-mark { display: grid; width: 1.9rem; height: 1.9rem; place-items: center; border: 1px solid var(--text); color: var(--accent-strong); }
      .brand-mark svg { width: 1.15rem; height: 1.15rem; }
      .brand-copy { display: flex; align-items: baseline; gap: .5rem; }
      .brand-copy strong { font-size: .88rem; letter-spacing: -.01em; }
      .brand-copy span { color: var(--quiet); font-size: .72rem; }
      .topbar-actions { display: flex; align-items: center; gap: .7rem; }
      .environment { display: inline-flex; align-items: center; gap: .45rem; color: var(--muted); font-size: .76rem; }
      .environment::before { width: .42rem; height: .42rem; border-radius: 50%; background: var(--accent); content: ""; box-shadow: 0 0 0 3px var(--accent-soft); }
      .logout-button { display: inline-flex; min-height: 2.25rem; align-items: center; justify-content: center; padding: .45rem .75rem; border: 1px solid var(--border-strong); border-radius: .4rem; background: var(--surface); color: var(--text); font-size: .76rem; font-weight: 650; text-decoration: none; transition: border-color 160ms ease, background 160ms ease, transform 160ms ease; }
      .logout-button:hover { border-color: var(--text); background: var(--surface-strong); }
      .logout-button:active { transform: translateY(1px); }
      .logout-button:focus-visible, .tab:focus-visible, .jwt-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
      main { width: min(74rem, calc(100% - 3rem)); margin: 0 auto; padding: clamp(2.8rem, 6vw, 5.6rem) 0 6rem; }
      .page-header { display: grid; max-width: 48rem; gap: .75rem; margin-bottom: 2.7rem; }
      .eyebrow { display: flex; align-items: center; gap: .55rem; margin: 0; color: var(--accent-strong); font-size: .68rem; font-weight: 750; letter-spacing: .13em; text-transform: uppercase; }
      .eyebrow::before { width: 1.5rem; height: 1px; background: currentColor; content: ""; }
      h1 { margin: 0; font-size: clamp(2.35rem, 5vw, 4.1rem); font-weight: 520; line-height: 1.02; letter-spacing: -.055em; }
      .lede { max-width: 42rem; margin: .3rem 0 0; color: var(--muted); font-size: .98rem; line-height: 1.65; }
      .overview { overflow: hidden; border: 1px solid var(--border-strong); border-radius: .55rem; background: var(--surface); }
      .stats { display: grid; grid-template-columns: 1.05fr 1fr 1fr; }
      .stat { min-width: 0; padding: 1.35rem 1.5rem 1.45rem; border-right: 1px solid var(--border); }
      .stat:last-child { border-right: 0; }
      .stat span { display: block; color: var(--quiet); font-size: .67rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .stat strong { display: block; margin-top: .55rem; font-size: .98rem; font-weight: 620; overflow-wrap: anywhere; }
      .warning { display: flex; align-items: flex-start; gap: .65rem; margin: 0; padding: .85rem 1.5rem; border-top: 1px solid var(--border); background: var(--warning-soft); color: var(--warning); font-size: .76rem; line-height: 1.55; }
      .warning svg { width: .95rem; height: .95rem; flex: 0 0 auto; margin-top: .08rem; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
      .content-heading { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin: 3.4rem 0 1rem; }
      .content-heading h2 { margin: 0; font-size: 1.15rem; font-weight: 620; letter-spacing: -.025em; }
      .content-heading p { margin: 0; color: var(--quiet); font-size: .75rem; }
      section, .header-inspector { overflow: hidden; border: 1px solid var(--border-strong); border-radius: .55rem; background: var(--surface); }
      section { margin-top: 1rem; }
      section h2 { margin: 0; padding: 1.05rem 1.25rem; border-bottom: 1px solid var(--border); font-size: .76rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .tab-list { display: flex; gap: 1.6rem; padding: 0 1.25rem; border-bottom: 1px solid var(--border); }
      .tab { position: relative; display: inline-flex; min-height: 3.35rem; align-items: center; gap: .55rem; padding: .75rem 0; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: .78rem; font-weight: 600; cursor: pointer; }
      .tab::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; background: var(--accent); content: ""; opacity: 0; transform: scaleX(.65); transition: opacity 160ms ease, transform 160ms ease; }
      .tab:hover { color: var(--text); }
      .tab[aria-selected="true"] { color: var(--text); }
      .tab[aria-selected="true"]::after { opacity: 1; transform: scaleX(1); }
      .tab-count { display: inline-grid; min-width: 1.3rem; height: 1.3rem; padding: 0 .3rem; place-items: center; border-radius: 99px; background: var(--surface-strong); color: var(--quiet); font-size: .64rem; }
      .tab[aria-selected="true"] .tab-count { background: var(--accent-soft); color: var(--accent-strong); }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { padding: .9rem 1.25rem; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
      tr:last-child th, tr:last-child td { border-bottom: 0; }
      tr { transition: background 140ms ease; }
      tr:hover { background: #f3f5f0; }
      th { width: min(30%, 17rem); color: var(--muted); font-size: .74rem; font-weight: 650; overflow-wrap: anywhere; }
      td { font-size: .76rem; }
      code { color: #343933; white-space: pre-wrap; overflow-wrap: anywhere; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: .72rem; line-height: 1.55; }
      .header-value { display: flex; align-items: flex-start; gap: .65rem; }
      .header-value code { min-width: 0; flex: 1; }
      .jwt-link { display: inline-grid; width: 1.8rem; height: 1.8rem; flex: 0 0 auto; place-items: center; border: 1px solid var(--border); border-radius: .35rem; color: var(--accent-strong); }
      .jwt-link:hover { border-color: var(--accent); background: var(--accent-soft); }
      .jwt-link svg { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
      .oidc-row { background: var(--accent-soft); }
      .oidc-row:hover { background: #dceddf; }
      .oidc-row th::after { content: "verified"; margin-left: .5rem; padding: .13rem .35rem; border-radius: 99px; background: var(--accent); color: #f4fbf7; font-size: .53rem; letter-spacing: .04em; text-transform: uppercase; }
      .empty { color: var(--muted); font-style: italic; }
      @media (max-width: 620px) {
        .topbar { height: 3.8rem; padding-inline: .9rem; }
        .brand-copy span, .environment { display: none; }
        main { width: min(100% - 1.5rem, 74rem); padding: 2.5rem 0 4rem; }
        .page-header { margin-bottom: 2rem; }
        .stats { grid-template-columns: 1fr; }
        .stat { border-right: 0; border-bottom: 1px solid var(--border); }
        .stat:last-child { border-bottom: 0; }
        .warning { padding-inline: 1rem; }
        .content-heading { align-items: flex-start; flex-direction: column; margin-top: 2.6rem; }
        table { table-layout: auto; }
        th, td { padding: .75rem; }
        th { min-width: 9rem; }
        .tab { flex: 1; justify-content: center; padding-inline: .5rem; }
        .tab-list { gap: .4rem; }
      }
      @media (prefers-reduced-motion: reduce) {
        html { scroll-behavior: auto; }
        *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
      }
    </style>
  </head>
  <body>
    <div class="topbar">
      <a class="brand" href="#overview" aria-label="Traefik OIDC inspector home">
        <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 5h16v4H4zm0 5h7v9H4zm9 0h7v9h-7z"/></svg></span>
        <span class="brand-copy"><strong>Traefik OIDC</strong><span>/ request inspector</span></span>
      </a>
      <div class="topbar-actions">
        <span class="environment">Authenticated</span>
        <a class="logout-button" href="/logout">Logout</a>
      </div>
    </div>
    <main id="overview">
        <header class="page-header">
          <p class="eyebrow">Authenticated request</p>
          <h1>What reached Express?</h1>
          <p class="lede">Traefik authenticated this request before forwarding it here. Identity headers from the OIDC middleware are separated for quick inspection.</p>
        </header>

        <div class="overview">
          <div class="stats" aria-label="Request summary">
            <div class="stat"><span>Request</span><strong>${escapeHtml(request.method)} ${escapeHtml(request.originalUrl)}</strong></div>
            <div class="stat"><span>Received</span><strong>${headers.length} headers · ${cookies.length} cookies</strong></div>
            <div class="stat"><span>OIDC identity</span><strong>${identityHeaders.length} forwarded headers</strong></div>
          </div>
          <p class="warning"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19zM12 9v4M12 17h.01"/></svg><span>Debug data can contain credentials and personal information. Keep this viewer private and redact screenshots before sharing.</span></p>
        </div>

        <div class="content-heading">
          <h2>Forwarded data</h2>
          <p>Select a group to inspect the raw values.</p>
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

        <section id="cookies">
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
      :root { color-scheme: light; font-family: "Avenir Next", Avenir, "Helvetica Neue", Helvetica, sans-serif; }
      * { box-sizing: border-box; }
      body { display: grid; min-height: 100vh; margin: 0; place-items: center; background: #f6f7f3; color: #20231f; -webkit-font-smoothing: antialiased; }
      main { width: min(31rem, calc(100% - 2rem)); padding: clamp(2rem, 6vw, 3.5rem); border: 1px solid #cdd1c8; border-radius: .55rem; background: #fbfcf9; }
      .mark { display: grid; width: 2rem; height: 2rem; margin-bottom: 3rem; place-items: center; border: 1px solid #20231f; color: #1d6f4c; }
      .mark svg { width: 1.2rem; }
      .eyebrow { margin: 0 0 .65rem; color: #1d6f4c; font-size: .66rem; font-weight: 750; letter-spacing: .13em; text-transform: uppercase; }
      h1 { margin: 0 0 .8rem; font-size: clamp(2rem, 8vw, 3rem); font-weight: 520; letter-spacing: -.05em; line-height: 1.04; }
      p { margin: 0 0 1.8rem; color: #6f746c; font-size: .92rem; line-height: 1.65; }
      a { display: inline-flex; min-height: 2.55rem; align-items: center; padding: .55rem .85rem; border-radius: .4rem; background: #20231f; color: #f6f7f3; font-size: .78rem; font-weight: 700; text-decoration: none; }
      a:hover { background: #1d6f4c; }
      a:focus-visible { outline: 2px solid #2c8c63; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <main>
      <span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 5h16v4H4zm0 5h7v9H4zm9 0h7v9h-7z"/></svg></span>
      <p class="eyebrow">Session ended</p>
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
