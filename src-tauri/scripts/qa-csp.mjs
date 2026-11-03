import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const configPath = join(scriptDir, "..", "tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const security = config.app?.security;

const REQUIRED_PROD_DIRECTIVES = new Map([
  ["default-src", ["'self'"]],
  ["script-src", ["'self'"]],
  ["style-src", ["'self'", "'unsafe-inline'"]],
  ["img-src", ["'self'", "data:", "blob:", "https:"]],
  ["font-src", ["'self'", "data:"]],
  [
    "connect-src",
    [
      "'self'",
      "ipc:",
      "http://ipc.localhost",
      "http://127.0.0.1:*",
      "http://localhost:*",
      "ws://127.0.0.1:*",
      "ws://localhost:*",
    ],
  ],
]);

const REQUIRED_DEV_DIRECTIVES = new Map([
  ...REQUIRED_PROD_DIRECTIVES,
  [
    "connect-src",
    [
      ...REQUIRED_PROD_DIRECTIVES.get("connect-src"),
      "http://localhost:5173",
      "ws://localhost:5173",
    ],
  ],
]);

const FORBIDDEN_CONNECT_SRC_TOKENS = ["https:", "wss:"];

function normalizeDirectiveValue(value) {
  if (Array.isArray(value)) {
    return value.join(" ");
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function normalizeCsp(policy) {
  if (!policy) {
    return new Map();
  }

  if (typeof policy === "string") {
    const directives = new Map();
    for (const rawDirective of policy.split(";")) {
      const trimmed = rawDirective.trim();
      if (!trimmed) continue;
      const [name, ...tokens] = trimmed.split(/\s+/);
      if (name) {
        directives.set(name, tokens.join(" "));
      }
    }
    return directives;
  }

  if (typeof policy === "object" && !Array.isArray(policy)) {
    return new Map(
      Object.entries(policy).map(([name, value]) => [
        name,
        normalizeDirectiveValue(value),
      ]),
    );
  }

  return new Map();
}

function collectPolicyErrors(label, policy, requiredDirectives) {
  const directives = normalizeCsp(policy);
  const errors = [];

  if (directives.size === 0) {
    errors.push(`${label} is missing or empty`);
    return errors;
  }

  for (const [directive, requiredTokens] of requiredDirectives.entries()) {
    const value = directives.get(directive);
    if (!value) {
      errors.push(`${label} missing ${directive}`);
      continue;
    }

    for (const token of requiredTokens) {
      if (!value.split(/\s+/).includes(token)) {
        errors.push(`${label} ${directive} missing ${token}`);
      }
    }
  }

  if (directives.get("script-src")?.split(/\s+/).includes("'unsafe-eval'")) {
    errors.push(`${label} script-src must not include 'unsafe-eval' without captured dev evidence`);
  }

  const connectSrcTokens = directives.get("connect-src")?.split(/\s+/) ?? [];
  for (const token of FORBIDDEN_CONNECT_SRC_TOKENS) {
    if (connectSrcTokens.includes(token)) {
      errors.push(`${label} connect-src must not include broad remote ${token}`);
    }
  }

  return errors;
}

const errors = [
  ...collectPolicyErrors("app.security.csp", security?.csp, REQUIRED_PROD_DIRECTIVES),
  ...collectPolicyErrors("app.security.devCsp", security?.devCsp, REQUIRED_DEV_DIRECTIVES),
];

if (errors.length > 0) {
  console.error("[qa-csp] FAIL");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("[qa-csp] PASS");
console.log("- app.security.csp has required production directives");
console.log("- app.security.devCsp has required development directives");
console.log("- connect-src does not allow broad remote https: or wss:");
