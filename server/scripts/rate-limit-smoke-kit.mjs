import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export const HOST = "127.0.0.1";
export const PORT = process.env.SMOKE_RATE_LIMIT_PORT ?? "8990";
export const BASE = `http://${HOST}:${PORT}`;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_IP_FAILURE_LIMIT = 20;
export const SIGNUP_ATTEMPT_LIMIT = 5;
export const REFRESH_INVALID_LIMIT = 10;

const SERVER_ROOT = new URL("..", import.meta.url);

let pass = 0;
let fail = 0;

function logPass(name) {
  pass += 1;
  console.log(`  ✅ ${name}`);
}

function logFail(name, detail) {
  fail += 1;
  console.log(`  ❌ ${name} — ${detail}`);
}

export function expect(condition, name, detail = "") {
  if (condition) logPass(name);
  else logFail(name, detail);
}

export async function call(method, path, { body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  return {
    status: res.status,
    retryAfter: res.headers.get("retry-after"),
    code: payload?.error?.code,
  };
}

function uniqueCandidates(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function nodeCanLoadBetterSqlite(nodePath) {
  if (!existsSync(nodePath)) return false;
  const result = spawnSync(nodePath, ["-e", "require('better-sqlite3')"], {
    cwd: SERVER_ROOT,
    encoding: "utf8",
    timeout: 5000,
  });
  return result.status === 0;
}

function resolveServerNode() {
  const candidates = uniqueCandidates([
    process.env.TICKSIDIAN_AUTH_SMOKE_NODE,
    process.execPath,
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
  ]);

  for (const candidate of candidates) {
    if (nodeCanLoadBetterSqlite(candidate)) return candidate;
  }

  throw new Error(
    "No candidate Node runtime can load better-sqlite3. " +
      "Rebuild server/node_modules for the active Node or set TICKSIDIAN_AUTH_SMOKE_NODE.",
  );
}

function startServer(label) {
  const serverNode = resolveServerNode();
  const child = spawn(serverNode, ["dist/index.js"], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      TICKSIDIAN_AUTH_HOST: HOST,
      TICKSIDIAN_AUTH_PORT: PORT,
      TICKSIDIAN_AUTH_DB_PATH: ":memory:",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let resolved = false;
    const readyTimeout = setTimeout(() => {
      if (!resolved) reject(new Error(`${label}: server did not become ready in 5s`));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.includes("listening on") && !resolved) {
        resolved = true;
        clearTimeout(readyTimeout);
        resolve(child);
      }
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[server stderr] ${chunk}`);
    });

    child.once("error", (err) => {
      clearTimeout(readyTimeout);
      reject(err);
    });

    child.once("exit", (code) => {
      if (!resolved) {
        clearTimeout(readyTimeout);
        reject(new Error(`${label}: server exited early code=${code}`));
      }
    });
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    let exited = false;
    child.once("exit", () => {
      exited = true;
      resolve();
    });
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!exited) child.kill("SIGKILL");
    }, 3000);
  });
}

export async function withServer(label, scenario) {
  const server = await startServer(label);
  try {
    await scenario();
  } finally {
    await stopServer(server);
    await delay(200);
  }
}

export function expectRateLimited(result, name) {
  expect(result.status === 429, `${name} status 429`, `got ${result.status}`);
  expect(result.code === "rate_limited", `${name} code=rate_limited`, `got ${result.code}`);
  const retryAfterSec = Number(result.retryAfter);
  expect(
    Number.isInteger(retryAfterSec) && retryAfterSec > 0,
    `${name} Retry-After positive integer`,
    `got ${result.retryAfter}`,
  );
}

export function requestFromIp(ip) {
  return { socket: { remoteAddress: ip } };
}

export function printSummary() {
  console.log("");
  console.log(`[smoke-rate-limit] result: ${pass} passed, ${fail} failed`);
  console.log("[smoke-rate-limit] artifacts: none (in-memory DB, no log files written)");
}

export function hasFailures() {
  return fail > 0;
}
