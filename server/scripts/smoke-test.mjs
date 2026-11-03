#!/usr/bin/env node
/**
 * M3-1e dev-only auth server smoke test.
 *
 * 사용:
 *   터미널 A: cd server && npm start
 *   터미널 B: cd server && npm run smoke
 *
 * 절대 토큰/비밀번호 값을 stdout에 그대로 찍지 않는다. 길이 또는 prefix만
 * 노출. 결과 데이터를 파일로 저장하지 않는다.
 *
 * 검증 순서:
 *   1. signup       → 201 + tokens 발급
 *   2. login        → 200 + 새 tokens 발급
 *   3. me (access)  → 200 + 같은 user
 *   4. refresh      → 200 + 새 tokens, 옛 refresh는 무효화
 *   5. logout       → 200
 *   6. refresh after logout → 401 + session_expired
 *   7. me with old access   → 401 + session_expired
 *   8. login wrong password → 401 + invalid_credentials
 *   9. signup duplicate     → 409 + email_already_exists
 */

const BASE = process.env.TICKSIDIAN_AUTH_BASE_URL ?? "http://127.0.0.1:8787";

let pass = 0;
let fail = 0;

function preview(token) {
  if (typeof token !== "string") return "<no-token>";
  return `${token.slice(0, 6)}…(len=${token.length})`;
}

function logPass(name) {
  pass += 1;
  console.log(`  ✅ ${name}`);
}

function logFail(name, detail) {
  fail += 1;
  console.log(`  ❌ ${name} — ${detail}`);
}

async function call(method, path, { body, accessToken } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { status: res.status, payload };
}

function expect(condition, name, detail = "") {
  if (condition) logPass(name);
  else logFail(name, detail);
}

async function main() {
  console.log(`[smoke] base=${BASE}`);

  // 같은 인증 서버 인스턴스에서 충돌하지 않게 매번 다른 이메일 사용.
  const email = `smoke-${Date.now()}@example.test`;
  const password = "smoke-password-1234";

  // 1. signup
  const signup = await call("POST", "/auth/signup", {
    body: { email, password },
  });
  expect(signup.status === 201, "signup status 201", `got ${signup.status}`);
  expect(signup.payload?.ok === true, "signup ok=true");
  const signupTokens = signup.payload?.data?.tokens;
  expect(!!signupTokens?.accessToken, "signup access token present", preview(signupTokens?.accessToken));
  expect(!!signupTokens?.refreshToken, "signup refresh token present");

  // 2. login
  const login = await call("POST", "/auth/login", {
    body: { email, password },
  });
  expect(login.status === 200, "login status 200", `got ${login.status}`);
  expect(login.payload?.ok === true, "login ok=true");
  const loginTokens = login.payload?.data?.tokens;
  expect(!!loginTokens?.accessToken, "login access token present", preview(loginTokens?.accessToken));
  expect(loginTokens?.accessToken !== signupTokens?.accessToken, "login token differs from signup");

  // 3. me with login access token
  const me1 = await call("GET", "/auth/me", { accessToken: loginTokens?.accessToken });
  expect(me1.status === 200, "me status 200", `got ${me1.status}`);
  expect(me1.payload?.data?.user?.email === email.toLowerCase(), "me returns same user");

  // 4. refresh
  const refresh = await call("POST", "/auth/refresh", {
    body: { refreshToken: loginTokens?.refreshToken },
  });
  expect(refresh.status === 200, "refresh status 200", `got ${refresh.status}`);
  const refreshedTokens = refresh.payload?.data?.tokens;
  expect(!!refreshedTokens?.accessToken, "refresh new access present");
  expect(refreshedTokens?.refreshToken !== loginTokens?.refreshToken, "refresh rotates refresh token");

  // 4b. old refresh token cannot be reused (rotation/replay protection)
  const replay = await call("POST", "/auth/refresh", {
    body: { refreshToken: loginTokens?.refreshToken },
  });
  expect(replay.status === 401, "old refresh rejected 401", `got ${replay.status}`);
  expect(replay.payload?.error?.code === "session_expired", "old refresh code=session_expired");

  // 4c. H-1: 회전 전에 발급된 옛 access token은 회전 직후 무효화돼야 한다.
  const meOldAccess = await call("GET", "/auth/me", {
    accessToken: loginTokens?.accessToken,
  });
  expect(meOldAccess.status === 401, "old access after rotation 401", `got ${meOldAccess.status}`);

  // 4d. 회전으로 새로 발급된 access token은 살아 있어야 한다.
  // (계정 단위 옛 access DELETE가 새 토큰까지 지우지 않는지 — DELETE→INSERT 순서 회귀 가드)
  const meNewAccess = await call("GET", "/auth/me", {
    accessToken: refreshedTokens?.accessToken,
  });
  expect(meNewAccess.status === 200, "new access after rotation 200", `got ${meNewAccess.status}`);
  expect(meNewAccess.payload?.data?.user?.email === email.toLowerCase(), "new access returns same user");

  // 5. logout (with new refresh)
  const logout = await call("POST", "/auth/logout", {
    body: { refreshToken: refreshedTokens?.refreshToken },
    accessToken: refreshedTokens?.accessToken,
  });
  expect(logout.status === 200, "logout status 200", `got ${logout.status}`);

  // 6. refresh after logout → 401 session_expired
  const afterLogout = await call("POST", "/auth/refresh", {
    body: { refreshToken: refreshedTokens?.refreshToken },
  });
  expect(afterLogout.status === 401, "refresh-after-logout 401", `got ${afterLogout.status}`);
  expect(
    afterLogout.payload?.error?.code === "session_expired",
    "refresh-after-logout code=session_expired",
  );

  // 7. me with old access after logout → 401 session_expired
  const meAfterLogout = await call("GET", "/auth/me", {
    accessToken: refreshedTokens?.accessToken,
  });
  expect(meAfterLogout.status === 401, "me-after-logout 401", `got ${meAfterLogout.status}`);
  expect(
    meAfterLogout.payload?.error?.code === "session_expired",
    "me-after-logout code=session_expired",
  );

  // 8. login with wrong password
  const wrong = await call("POST", "/auth/login", {
    body: { email, password: "wrong-password-9999" },
  });
  expect(wrong.status === 401, "wrong-password 401", `got ${wrong.status}`);
  expect(
    wrong.payload?.error?.code === "invalid_credentials",
    "wrong-password code=invalid_credentials",
  );

  // 9. signup duplicate
  const dup = await call("POST", "/auth/signup", { body: { email, password } });
  expect(dup.status === 409, "duplicate signup 409", `got ${dup.status}`);
  expect(
    dup.payload?.error?.code === "email_already_exists",
    "duplicate signup code=email_already_exists",
  );

  console.log("");
  console.log(`[smoke] result: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke] unhandled error:", err.message);
  process.exit(2);
});
