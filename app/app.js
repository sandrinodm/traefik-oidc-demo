import express from "express";

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
      const className = isOidc ? ' class="oidc-row"' : "";
      return `<tr${className}><th scope="row">${escapeHtml(name)}</th><td><code>${escapeHtml(value)}</code></td></tr>`;
    })
    .join("");
}

function page(request) {
  const headers = requestHeaders(request);
  const cookies = parseCookies(request.headers.cookie);
  const oidcHeaders = headers.filter(([name]) => name.toLowerCase().startsWith("x-oidc-")).length;

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
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      th, td { padding: .85rem 1.25rem; border-bottom: 1px solid rgba(42, 56, 88, .72); text-align: left; vertical-align: top; }
      tr:last-child th, tr:last-child td { border-bottom: 0; }
      th { width: min(32%, 18rem); color: var(--muted); font-size: .82rem; font-weight: 650; overflow-wrap: anywhere; }
      td { font-size: .86rem; }
      code { color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
      .oidc-row { background: var(--accent-soft); }
      .oidc-row th::after { content: "OIDC"; margin-left: .5rem; padding: .15rem .35rem; border-radius: 99px; background: var(--accent); color: #092218; font-size: .58rem; letter-spacing: .06em; }
      .empty { color: var(--muted); font-style: italic; }
      @media (max-width: 680px) {
        main { padding-top: 2rem; }
        .stats { grid-template-columns: 1fr; }
        table { table-layout: auto; }
        th, td { padding: .75rem; }
        th { min-width: 9rem; }
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
        <div class="stat"><span>OIDC identity</span><strong>${oidcHeaders} forwarded headers</strong></div>
      </div>

      <section>
        <h2>Request headers</h2>
        <div class="table-wrap">
          <table><tbody>${rows(headers, "No request headers received.", "header")}</tbody></table>
        </div>
      </section>

      <section>
        <h2>Cookies</h2>
        <div class="table-wrap">
          <table><tbody>${rows(cookies, "No cookies received.", "cookie")}</tbody></table>
        </div>
      </section>
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

  app.get("/{*path}", (request, response) => {
    response
      .set({
        "Cache-Control": "no-store, max-age=0",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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
