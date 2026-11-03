import type { IncomingMessage } from "node:http";

/**
 * Dev-only in-memory auth rate limiting.
 *
 * This is a reversible minimum guard for the local M3 auth server:
 * counters reset on process restart, are not shared across processes, and are
 * not a production abuse-prevention system.
 */

const WINDOW_MS = 10 * 60 * 1000;
const LOGIN_EMAIL_FAILURE_LIMIT = 5;
const LOGIN_IP_FAILURE_LIMIT = 20;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;
const SIGNUP_ATTEMPT_LIMIT = 5;
const REFRESH_INVALID_LIMIT = 10;

export type RateLimitDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "blocked"; readonly retryAfterSec: number };

const ALLOWED: RateLimitDecision = { kind: "allowed" };

type WindowCounter = {
  count: number;
  windowStartedAtMs: number;
};

type LoginFailureCounter = {
  failureCount: number;
  windowStartedAtMs: number;
  lockedUntilMs: number | null;
};

type Clock = () => number;

export interface LoginFailureLimiterForTests {
  canAttempt(key: string): RateLimitDecision;
  recordFailure(key: string): void;
  recordSuccess(key: string): void;
  reset(): void;
}

export interface LoginFailureLimiterOptions {
  readonly failureLimit: number;
  readonly windowMs: number;
  readonly lockoutMs: number;
  readonly clock?: Clock;
}

function nowMs(): number {
  return Date.now();
}

function retryAfterSec(targetMs: number, currentMs: number): number {
  return Math.max(1, Math.ceil((targetMs - currentMs) / 1000));
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

class FixedWindowLimiter {
  private readonly counters = new Map<string, WindowCounter>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  consume(key: string): RateLimitDecision {
    const currentMs = nowMs();
    const existing = this.counters.get(key);
    if (!existing || currentMs - existing.windowStartedAtMs >= this.windowMs) {
      this.counters.set(key, { count: 1, windowStartedAtMs: currentMs });
      return ALLOWED;
    }

    if (existing.count >= this.limit) {
      return {
        kind: "blocked",
        retryAfterSec: retryAfterSec(existing.windowStartedAtMs + this.windowMs, currentMs),
      };
    }

    existing.count += 1;
    return ALLOWED;
  }

  reset(): void {
    this.counters.clear();
  }
}

class LoginFailureLimiter implements LoginFailureLimiterForTests {
  private readonly counters = new Map<string, LoginFailureCounter>();
  private readonly options: LoginFailureLimiterOptions;

  constructor(options: LoginFailureLimiterOptions) {
    this.options = options;
  }

  private currentMs(): number {
    return this.options.clock?.() ?? nowMs();
  }

  canAttempt(key: string): RateLimitDecision {
    const currentMs = this.currentMs();
    const existing = this.counters.get(key);
    if (!existing) return ALLOWED;
    if (existing.lockedUntilMs !== null && existing.lockedUntilMs > currentMs) {
      return {
        kind: "blocked",
        retryAfterSec: retryAfterSec(existing.lockedUntilMs, currentMs),
      };
    }
    if (existing.lockedUntilMs !== null) {
      this.counters.delete(key);
      return ALLOWED;
    }
    if (currentMs - existing.windowStartedAtMs >= this.options.windowMs) {
      this.counters.delete(key);
      return ALLOWED;
    }
    return ALLOWED;
  }

  recordFailure(key: string): void {
    const currentMs = this.currentMs();
    const existing = this.counters.get(key);
    if (existing && existing.lockedUntilMs !== null) {
      if (existing.lockedUntilMs > currentMs) return;
      this.counters.delete(key);
    }
    const active = this.counters.get(key);
    if (!active || currentMs - active.windowStartedAtMs >= this.options.windowMs) {
      this.counters.set(key, {
        failureCount: 1,
        windowStartedAtMs: currentMs,
        lockedUntilMs: null,
      });
      return;
    }

    active.failureCount += 1;
    if (active.failureCount >= this.options.failureLimit) {
      active.lockedUntilMs = currentMs + this.options.lockoutMs;
    }
  }

  recordSuccess(key: string): void {
    this.counters.delete(key);
  }

  reset(): void {
    this.counters.clear();
  }
}

const signupAttempts = new FixedWindowLimiter(SIGNUP_ATTEMPT_LIMIT, WINDOW_MS);
const invalidRefreshAttempts = new FixedWindowLimiter(REFRESH_INVALID_LIMIT, WINDOW_MS);
const loginEmailFailures = new LoginFailureLimiter({
  failureLimit: LOGIN_EMAIL_FAILURE_LIMIT,
  windowMs: WINDOW_MS,
  lockoutMs: LOGIN_LOCKOUT_MS,
});
const loginIpFailures = new LoginFailureLimiter({
  failureLimit: LOGIN_IP_FAILURE_LIMIT,
  windowMs: WINDOW_MS,
  lockoutMs: LOGIN_LOCKOUT_MS,
});

function loginEmailKey(email: string): string {
  return normalizeEmail(email);
}

function loginIpKey(req: IncomingMessage): string {
  return clientIp(req);
}

export function consumeSignupAttempt(req: IncomingMessage): RateLimitDecision {
  return signupAttempts.consume(clientIp(req));
}

export function checkLoginAttempt(
  req: IncomingMessage,
  email: string,
): RateLimitDecision {
  const emailDecision = loginEmailFailures.canAttempt(loginEmailKey(email));
  if (emailDecision.kind === "blocked") return emailDecision;
  const ipDecision = loginIpFailures.canAttempt(loginIpKey(req));
  if (ipDecision.kind === "blocked") return ipDecision;
  return ALLOWED;
}

export function recordLoginFailure(req: IncomingMessage, email: string): void {
  loginEmailFailures.recordFailure(loginEmailKey(email));
  loginIpFailures.recordFailure(loginIpKey(req));
}

export function recordLoginSuccess(_req: IncomingMessage, email: string): void {
  loginEmailFailures.recordSuccess(loginEmailKey(email));
}

export function consumeInvalidRefreshAttempt(req: IncomingMessage): RateLimitDecision {
  return invalidRefreshAttempts.consume(clientIp(req));
}

export function resetAuthRateLimitsForTests(): void {
  signupAttempts.reset();
  invalidRefreshAttempts.reset();
  loginEmailFailures.reset();
  loginIpFailures.reset();
}

export function createLoginFailureLimiterForTests(
  options: LoginFailureLimiterOptions,
): LoginFailureLimiterForTests {
  return new LoginFailureLimiter(options);
}
