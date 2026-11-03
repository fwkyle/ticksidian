#!/usr/bin/env node
/**
 * Dev-only auth rate-limit smoke test.
 *
 * This script starts its own auth server on an isolated loopback port with
 * TICKSIDIAN_AUTH_DB_PATH=:memory:. It does not require a pre-running server
 * and it does not persist DB/log artifacts.
 *
 * It never prints passwords, refresh tokens, or full response bodies.
 */

import {
  checkLoginAttempt,
  createLoginFailureLimiterForTests,
  recordLoginFailure,
  resetAuthRateLimitsForTests,
} from "../src/lib/rate-limit.ts";
import {
  BASE,
  LOGIN_FAILURE_LIMIT,
  LOGIN_IP_FAILURE_LIMIT,
  REFRESH_INVALID_LIMIT,
  SIGNUP_ATTEMPT_LIMIT,
  call,
  expect,
  expectRateLimited,
  hasFailures,
  printSummary,
  requestFromIp,
  withServer,
} from "./rate-limit-smoke-kit.mjs";

function checkPureLoginLockoutOutlivesWindow() {
  let currentMs = 0;
  const limiter = createLoginFailureLimiterForTests({
    failureLimit: 2,
    windowMs: 100,
    lockoutMs: 1000,
    clock: () => currentMs,
  });
  const key = "127.0.0.1:locked@example.test";

  expect(limiter.canAttempt(key).kind === "allowed", "pure lockout first attempt allowed");
  limiter.recordFailure(key);
  currentMs = 50;
  limiter.recordFailure(key);
  currentMs = 200;

  const lockedAfterWindow = limiter.canAttempt(key);
  expect(
    lockedAfterWindow.kind === "blocked",
    "pure lockout survives failure window expiry",
    JSON.stringify(lockedAfterWindow),
  );
  expect(
    lockedAfterWindow.kind === "blocked" && lockedAfterWindow.retryAfterSec === 1,
    "pure lockout reports remaining retry time",
    JSON.stringify(lockedAfterWindow),
  );

  currentMs = 1100;
  expect(limiter.canAttempt(key).kind === "allowed", "pure lockout releases after lockout expiry");
}

function checkPureEmailWideLockoutAcrossIps() {
  resetAuthRateLimitsForTests();
  const email = "shared-email@example.test";
  for (let i = 0; i < LOGIN_FAILURE_LIMIT; i += 1) {
    const req = requestFromIp(`192.0.2.${i + 1}`);
    const before = checkLoginAttempt(req, email);
    expect(before.kind === "allowed", `email-wide attempt ${i + 1} allowed before lockout`);
    recordLoginFailure(req, email);
  }

  const blockedFromNewIp = checkLoginAttempt(requestFromIp("192.0.2.99"), email);
  expect(
    blockedFromNewIp.kind === "blocked",
    "email-wide lockout blocks same email from a new IP",
    JSON.stringify(blockedFromNewIp),
  );
  expect(
    blockedFromNewIp.kind === "blocked" && Number.isInteger(blockedFromNewIp.retryAfterSec),
    "email-wide lockout reports Retry-After seconds",
    JSON.stringify(blockedFromNewIp),
  );
  resetAuthRateLimitsForTests();
}

async function checkLoginFailureLockout() {
  const email = `rate-login-${Date.now()}@example.test`;
  const password = "rate-login-password-1234";
  const signup = await call("POST", "/auth/signup", { body: { email, password } });
  expect(signup.status === 201, "login scenario setup signup 201", `got ${signup.status}`);

  for (let i = 0; i < LOGIN_FAILURE_LIMIT; i += 1) {
    const wrong = await call("POST", "/auth/login", {
      body: { email, password: "wrong-password-9999" },
    });
    expect(wrong.status === 401, `wrong login ${i + 1} still 401`, `got ${wrong.status}`);
    expect(
      wrong.code === "invalid_credentials",
      `wrong login ${i + 1} code=invalid_credentials`,
      `got ${wrong.code}`,
    );
  }

  const limited = await call("POST", "/auth/login", {
    body: { email, password: "wrong-password-9999" },
  });
  expectRateLimited(limited, "login lockout");

  const correctPasswordLimited = await call("POST", "/auth/login", {
    body: { email, password },
  });
  expectRateLimited(correctPasswordLimited, "login lockout with correct password");
}

async function checkLoginIpFailureLockout() {
  const runId = Date.now();
  for (let i = 0; i < LOGIN_IP_FAILURE_LIMIT; i += 1) {
    const wrong = await call("POST", "/auth/login", {
      body: {
        email: `rate-ip-${runId}-${i}@example.test`,
        password: "wrong-password-9999",
      },
    });
    expect(wrong.status === 401, `IP-wide wrong login ${i + 1} still 401`, `got ${wrong.status}`);
    expect(
      wrong.code === "invalid_credentials",
      `IP-wide wrong login ${i + 1} code=invalid_credentials`,
      `got ${wrong.code}`,
    );
  }

  const limited = await call("POST", "/auth/login", {
    body: {
      email: `rate-ip-${runId}-over-limit@example.test`,
      password: "wrong-password-9999",
    },
  });
  expectRateLimited(limited, "IP-wide login lockout");
}

async function checkSignupAttemptLimit() {
  for (let i = 0; i < SIGNUP_ATTEMPT_LIMIT; i += 1) {
    const invalid = await call("POST", "/auth/signup", {
      body: { email: `bad-signup-${i}`, password: "short" },
    });
    expect(invalid.status === 400, `invalid signup ${i + 1} still 400`, `got ${invalid.status}`);
    expect(
      invalid.code === "invalid_credentials",
      `invalid signup ${i + 1} code=invalid_credentials`,
      `got ${invalid.code}`,
    );
  }

  const limited = await call("POST", "/auth/signup", {
    body: { email: "bad-signup-over-limit", password: "short" },
  });
  expectRateLimited(limited, "signup attempt limit");
}

async function checkInvalidRefreshLimit() {
  for (let i = 0; i < REFRESH_INVALID_LIMIT; i += 1) {
    const invalid = await call("POST", "/auth/refresh", {
      body: { refreshToken: `invalid-refresh-token-${i}` },
    });
    expect(invalid.status === 401, `invalid refresh ${i + 1} still 401`, `got ${invalid.status}`);
    expect(
      invalid.code === "session_expired",
      `invalid refresh ${i + 1} code=session_expired`,
      `got ${invalid.code}`,
    );
  }

  const limited = await call("POST", "/auth/refresh", {
    body: { refreshToken: "invalid-refresh-token-over-limit" },
  });
  expectRateLimited(limited, "invalid refresh limit");
}

async function main() {
  console.log(`[smoke-rate-limit] base=${BASE} db=:memory:`);

  checkPureLoginLockoutOutlivesWindow();
  checkPureEmailWideLockoutAcrossIps();
  await withServer("login", checkLoginFailureLockout);
  await withServer("login-ip", checkLoginIpFailureLockout);
  await withServer("signup", checkSignupAttemptLimit);
  await withServer("refresh", checkInvalidRefreshLimit);

  printSummary();

  if (hasFailures()) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-rate-limit] unhandled error:", err.message);
  console.error("[smoke-rate-limit] artifacts: none (in-memory DB, no log files written)");
  process.exit(2);
});
