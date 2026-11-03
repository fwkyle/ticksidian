// Auth refresh / timeout QA
//
// 역할
//   - real auth fetch wrapper가 timeout을 network failure로 접는지 확인한다.
//   - refresh singleton deduper가 동시 refresh를 한 번으로 합치는지 확인한다.
//   - refresh token은 서버의 명시 거부일 때만 지우고, 네트워크·시간 초과·5xx·비JSON은
//     보존하는지 확인한다 (DEF-SEC-001).
//
// 사용법
//   cd app && node --experimental-strip-types qa-auth-refresh.mjs

const { createFetchAuth, createRefreshDeduper } = await import(
  "./src/lib/auth/auth-fetch.ts"
);
const { createRefreshRunner, isExplicitRefreshRejection } = await import(
  "./src/lib/auth/auth-refresh.ts"
);

let assertions = 0;
let failures = 0;

function check(label, condition, detail) {
  assertions += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

function createJsonResponse(status, payload, headers = {}) {
  return {
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

{
  let capturedUrl = null;
  let capturedInit = null;
  const fetchAuth = createFetchAuth(
    async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return createJsonResponse(200, { ok: true, data: { ok: "yes" } });
    },
    "http://auth.local",
    100,
  );

  const outcome = await fetchAuth("/auth/me", {
    method: "POST",
    body: { hello: "world" },
    accessToken: "access-token",
  });

  check("fetchAuth joins base URL and path", capturedUrl === "http://auth.local/auth/me");
  check("fetchAuth returns parsed JSON payload", outcome.payload?.data?.ok === "yes");
  check("fetchAuth forwards JSON body", capturedInit?.body === '{"hello":"world"}');
  check(
    "fetchAuth forwards bearer token",
    capturedInit?.headers?.Authorization === "Bearer access-token",
  );
  check("fetchAuth passes AbortController signal", capturedInit?.signal instanceof AbortSignal);
}

{
  const fetchAuth = createFetchAuth(
    async () =>
      createJsonResponse(
        429,
        { ok: false, error: { code: "rate_limited", message: "Too many attempts." } },
        { "retry-after": "37" },
      ),
    "http://auth.local",
    100,
  );

  const outcome = await fetchAuth("/auth/login", { method: "POST", body: {} });

  check("fetchAuth preserves Retry-After seconds", outcome.retryAfterSec === 37);
}

{
  let aborted = false;
  const fetchAuth = createFetchAuth(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(init.signal.reason);
          },
          { once: true },
        );
      }),
    "http://auth.local",
    5,
  );

  const outcome = await fetchAuth("/auth/me", { method: "GET" });

  check("fetchAuth aborts hanging request on timeout", aborted);
  check("fetchAuth maps timeout to status 0", outcome.status === 0);
  check("fetchAuth preserves timeout as networkError", outcome.networkError instanceof Error);
}

{
  let calls = 0;
  let release;
  const dedupedRefresh = createRefreshDeduper(() => {
    calls += 1;
    return new Promise((resolve) => {
      release = () => resolve(true);
    });
  });

  const first = dedupedRefresh();
  const second = dedupedRefresh();

  check("deduper returns same in-flight promise", first === second);
  check("deduper starts only one refresh while in flight", calls === 1);

  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  check("deduper shares refresh result with all callers", firstResult && secondResult);

  const thirdPromise = dedupedRefresh();
  release();
  const third = await thirdPromise;
  check("deduper allows new refresh after settle", third === true && calls === 2);
}

{
  let calls = 0;
  const dedupedRefresh = createRefreshDeduper(async () => {
    calls += 1;
    throw new Error("refresh failed");
  });

  await dedupedRefresh().catch(() => false);
  await dedupedRefresh().catch(() => false);

  check("deduper resets after rejected refresh", calls === 2);
}

{
  const okTokens = {
    ok: true,
    data: { tokens: { accessToken: "a2", refreshToken: "r2", expiresInSec: 900 } },
  };
  const sessionExpired = { ok: false, error: { code: "session_expired", message: "x" } };
  const cases = [
    { name: "success", status: 200, payload: okTokens, ok: true, cleared: false },
    { name: "401 session_expired", status: 401, payload: sessionExpired, ok: false, cleared: true },
    { name: "401 empty body", status: 401, payload: null, ok: false, cleared: true },
    { name: "403 empty body (generic, not a session rejection)", status: 403, payload: null, ok: false, cleared: false },
    { name: "403 HTML/non-JSON (proxy or WAF page)", status: 403, payload: null, ok: false, cleared: false },
    { name: "403 server error JSON", status: 403, payload: { ok: false, error: { code: "server", message: "x" } }, ok: false, cleared: false },
    { name: "401 session_expired JSON", status: 401, payload: sessionExpired, ok: false, cleared: true },
    { name: "400 session_expired", status: 400, payload: sessionExpired, ok: false, cleared: true },
    { name: "network down (status 0)", status: 0, payload: null, networkError: new Error("down"), ok: false, cleared: false },
    { name: "timeout (status 0)", status: 0, payload: null, networkError: new Error("auth_fetch_timeout"), ok: false, cleared: false },
    { name: "500 non-JSON", status: 500, payload: null, ok: false, cleared: false },
    { name: "502 non-JSON", status: 502, payload: null, ok: false, cleared: false },
    { name: "429 rate_limited", status: 429, payload: { ok: false, error: { code: "rate_limited", message: "x" } }, ok: false, cleared: false },
    { name: "200 malformed body", status: 200, payload: { ok: true, data: {} }, ok: false, cleared: false },
  ];
  for (const c of cases) {
    const calls = { cleared: 0, set: null };
    const store = {
      getRefreshToken: () => "r1",
      setTokens: async (a, r, e) => {
        calls.set = [a, r, e];
      },
      clear: async () => {
        calls.cleared += 1;
      },
    };
    const run = createRefreshRunner(
      async () => ({ status: c.status, payload: c.payload, networkError: c.networkError }),
      store,
      "/auth/refresh",
    );
    const result = await run();
    check(`refresh runner result: ${c.name}`, result === c.ok);
    check(
      `refresh token ${c.cleared ? "cleared" : "preserved"}: ${c.name}`,
      (calls.cleared > 0) === c.cleared,
      `clear calls=${calls.cleared}`,
    );
    if (c.ok) {
      check("refresh runner stores rotated tokens", calls.set?.join(",") === "a2,r2,900");
    }
  }
  // /me 출구(real-auth-adapter)는 같은 판정 함수를 쓴다: 403은 거부가 아니다.
  check("/me: 403 HTML is not an explicit rejection", isExplicitRefreshRejection({ status: 403, payload: null }) === false);
  check("/me: 403 server JSON is not an explicit rejection", isExplicitRefreshRejection({ status: 403, payload: { ok: false, error: { code: "server" } } }) === false);
  check("/me: 401 is an explicit rejection", isExplicitRefreshRejection({ status: 401, payload: null }) === true);
  check("/me: 400 session_expired is an explicit rejection", isExplicitRefreshRejection({ status: 400, payload: sessionExpired }) === true);
  check(
    "isExplicitRefreshRejection ignores networkError even with status 401",
    isExplicitRefreshRejection({ status: 401, payload: null, networkError: new Error("x") }) === false,
  );

  let fetched = 0;
  const emptyStore = {
    getRefreshToken: () => null,
    setTokens: async () => {},
    clear: async () => {},
  };
  const noToken = await createRefreshRunner(
    async () => {
      fetched += 1;
      return { status: 200, payload: null };
    },
    emptyStore,
    "/auth/refresh",
  )();
  check("refresh runner skips fetch without a token", noToken === false && fetched === 0);
}

console.log(`\n${assertions} assertions, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
