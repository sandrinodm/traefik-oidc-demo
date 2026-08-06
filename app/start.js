import { spawn } from "node:child_process";
import { createApp } from "./app.js";

const requiredEnvironment = [
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_SESSION_SECRET",
];

const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]?.trim());
if (missingEnvironment.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvironment.join(", ")}`);
  process.exit(1);
}

if (process.env.OIDC_SESSION_SECRET.length !== 32) {
  console.error("OIDC_SESSION_SECRET must contain exactly 32 characters.");
  process.exit(1);
}

try {
  const issuer = new URL(process.env.OIDC_ISSUER);
  if (!["http:", "https:"].includes(issuer.protocol)) throw new Error("unsupported protocol");
} catch {
  console.error("OIDC_ISSUER must be a valid HTTP or HTTPS URL.");
  process.exit(1);
}

if (!/^(true|false)$/i.test(process.env.OIDC_COOKIE_SECURE ?? "false")) {
  console.error("OIDC_COOKIE_SECURE must be true or false.");
  process.exit(1);
}

const app = createApp();
const port = Number.parseInt(process.env.APP_INTERNAL_PORT ?? "3000", 10);
let traefik;
let stopping = false;

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Express request inspector listening on 127.0.0.1:${port}`);

  traefik = spawn(
    "/usr/local/bin/traefik",
    ["--configFile=/etc/traefik/traefik.yml"],
    { stdio: "inherit", env: process.env },
  );

  traefik.once("error", (error) => {
    console.error("Unable to start Traefik:", error);
    shutdown(1);
  });

  traefik.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(`Traefik exited unexpectedly (${signal ?? `code ${code}`}).`);
    shutdown(code || 1);
  });
});

server.once("error", (error) => {
  console.error("Unable to start Express:", error);
  shutdown(1);
});

function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;

  if (traefik && traefik.exitCode === null && traefik.signalCode === null) {
    traefik.kill("SIGTERM");
  }

  const forceExit = setTimeout(() => {
    if (traefik && traefik.exitCode === null && traefik.signalCode === null) {
      traefik.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 10_000);

  server.close(() => {
    clearTimeout(forceExit);
    process.exit(exitCode);
  });
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));
