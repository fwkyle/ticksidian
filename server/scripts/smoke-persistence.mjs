#!/usr/bin/env node
/**
 * M3-1f persistence smoke test.
 *
 * 같은 DB 파일을 가리키는 server 인스턴스를 두 번 띄워, 가입한 계정/세션이
 * 재시작 후에도 살아남는지 확인한다.
 *
 * 절대 토큰/비밀번호 값을 stdout에 그대로 찍지 않는다 (length만).
 *
 * DEF-SEC-002 권한 검사(2026-10-20)도 여기서 한다: 서버가 새로 만든 폴더는 0700, DB/WAL/SHM은
 * 0600이고, 0644로 미리 만든 파일은 기동 뒤 0600으로 교정되며 이미 있던 폴더 권한은 바뀌지 않는다.
 *
 * 검증 순서:
 *   [server #1]
 *   1. signup → 토큰 발급 (refresh1)
 *   2. me → 200
 *
 *   [SIGTERM, server 재시작 — 같은 DB 파일]
 *
 *   [server #2]
 *   3. login (같은 이메일/비밀번호) → 200 (계정이 디스크에서 살아 있음)
 *   4. refresh (refresh1) → 200 (M3-1e 메모리 시절엔 401이었음)
 *   5. logout → 200
 *   6. refresh (refresh1) → 401 session_expired (revoked가 디스크에 반영됨)
 */

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const PORT = process.env.SMOKE_PERSISTENCE_PORT ?? "8989";
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

// 산출물은 자동 삭제하지 않는다(저장소 안전 규칙: rm/rmSync 금지).
// 위치는 추적 제외된 `server/data/smoke-runs/<timestamp>-<rand>/` 아래로 둔다.
// `server/.gitignore`가 `data/` 전체를 무시하므로 이 경로의 산출물은 절대 커밋되지 않는다.
// 검사/정리는 [kyle]가 직접 결정한다 (이 script는 마지막에 경로만 출력).
const SERVER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const runStamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const runRoot = join(SERVER_ROOT, "data", "smoke-runs", runStamp);
const dbPath = join(runRoot, "auth.db");
mkdirSync(runRoot, { recursive: true });

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

function expect(condition, name, detail = "") {
  if (condition) logPass(name);
  else logFail(name, detail);
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

function startServer(serverDbPath = dbPath) {
  const child = spawn(
    process.execPath,
    ["dist/index.js"],
    {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        TICKSIDIAN_AUTH_HOST: HOST,
        TICKSIDIAN_AUTH_PORT: PORT,
        TICKSIDIAN_AUTH_DB_PATH: serverDbPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return new Promise((resolve, reject) => {
    let resolved = false;
    const onReady = (chunk) => {
      const text = chunk.toString();
      if (text.includes("listening on")) {
        if (!resolved) {
          resolved = true;
          resolve(child);
        }
      }
    };
    child.stdout.on("data", onReady);
    child.stderr.on("data", (chunk) => {
      // 정상 흐름엔 stderr가 거의 없어야 한다. 디버그용 echo만.
      process.stderr.write(`[server stderr] ${chunk}`);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!resolved) reject(new Error(`server exited early code=${code}`));
    });
    setTimeout(() => {
      if (!resolved) reject(new Error("server did not become ready in 5s"));
    }, 5000);
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 3000);
  });
}

function modeOf(path) {
  return (statSync(path).mode & 0o777).toString(8).padStart(3, "0");
}

async function checkPermissions() {
  // A. 서버가 새로 만드는 폴더: 0700, 파일 0600 (서버 실행 중이라 WAL/SHM도 존재).
  const freshDb = join(runRoot, "fresh", "auth.db");
  let server = await startServer(freshDb);
  try {
    const signup = await call("POST", "/auth/signup", {
      body: { email: `perm-${Date.now()}@example.test`, password: "perm-password-1234" },
    });
    expect(signup.status === 201, "perm: signup on fresh db 201", `got ${signup.status}`);
    expect(modeOf(join(runRoot, "fresh")) === "700", "perm: new folder is 0700", modeOf(join(runRoot, "fresh")));
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = `${freshDb}${suffix}`;
      expect(existsSync(file), `perm: auth.db${suffix} exists while running`);
      if (existsSync(file)) {
        expect(modeOf(file) === "600", `perm: auth.db${suffix} is 0600`, modeOf(file));
      }
    }
  } finally {
    await stopServer(server);
  }
  await delay(200);

  // B. 0644로 미리 만든 파일 + 이미 있는 0755 폴더: 파일은 교정, 폴더는 그대로.
  const oldDir = join(runRoot, "old");
  mkdirSync(oldDir, { recursive: true });
  chmodSync(oldDir, 0o755);
  const oldDb = join(oldDir, "auth.db");
  for (const suffix of ["", "-wal", "-shm"]) {
    writeFileSync(`${oldDb}${suffix}`, "");
    chmodSync(`${oldDb}${suffix}`, 0o644);
  }
  server = await startServer(oldDb);
  try {
    // 요청 없이 기동만으로 교정돼야 한다(index.ts가 기동 때 getDb()를 부른다).
    expect(modeOf(oldDb) === "600", "perm: pre-existing 0644 auth.db corrected to 0600", modeOf(oldDb));
    for (const suffix of ["-wal", "-shm"]) {
      const file = `${oldDb}${suffix}`;
      expect(modeOf(file) === "600", `perm: pre-existing 0644 auth.db${suffix} corrected to 0600`, modeOf(file));
    }
    expect(modeOf(oldDir) === "755", "perm: pre-existing custom folder untouched (0755)", modeOf(oldDir));
  } finally {
    await stopServer(server);
  }
  await delay(200);
}

async function main() {
  console.log(`[smoke-persistence] base=${BASE} db=${dbPath}`);

  const email = `persist-${Date.now()}@example.test`;
  const password = "persist-password-1234";

  // ── server #1 ──
  let server = await startServer();
  try {
    const signup = await call("POST", "/auth/signup", { body: { email, password } });
    expect(signup.status === 201, "signup status 201", `got ${signup.status}`);
    const tokens1 = signup.payload?.data?.tokens;
    expect(!!tokens1?.accessToken, "signup access present", preview(tokens1?.accessToken));
    expect(!!tokens1?.refreshToken, "signup refresh present");

    const me1 = await call("GET", "/auth/me", { accessToken: tokens1?.accessToken });
    expect(me1.status === 200, "me before restart 200", `got ${me1.status}`);

    var preservedRefresh = tokens1?.refreshToken;
    var preservedAccess = tokens1?.accessToken;
  } finally {
    await stopServer(server);
  }

  // 짧은 휴식 — TIME_WAIT 보다 짧은 SO_REUSEADDR 동작 보장.
  await delay(200);

  // ── server #2 ──
  server = await startServer();
  try {
    // 3. 같은 자격증명으로 로그인. 디스크에서 user row가 살아 있어야 OK.
    const login = await call("POST", "/auth/login", { body: { email, password } });
    expect(login.status === 200, "login after restart 200", `got ${login.status}`);
    const tokens2 = login.payload?.data?.tokens;
    expect(!!tokens2?.accessToken, "login access present");

    // 4. server 재시작 후에도 옛 refresh token으로 refresh 가능.
    //    (메모리 시절에는 절대 안 됐던 동작.)
    const refresh = await call("POST", "/auth/refresh", {
      body: { refreshToken: preservedRefresh },
    });
    expect(refresh.status === 200, "refresh with preserved token 200", `got ${refresh.status}`);
    const rotated = refresh.payload?.data?.tokens;
    expect(!!rotated?.refreshToken, "refresh rotated token present");

    // 5. 로그아웃 + 옛 refresh token으로 다시 시도하면 session_expired.
    const logout = await call("POST", "/auth/logout", {
      body: { refreshToken: rotated?.refreshToken },
      accessToken: rotated?.accessToken,
    });
    expect(logout.status === 200, "logout 200", `got ${logout.status}`);

    const replay = await call("POST", "/auth/refresh", {
      body: { refreshToken: preservedRefresh },
    });
    expect(replay.status === 401, "old refresh 401 after rotation", `got ${replay.status}`);
    expect(
      replay.payload?.error?.code === "session_expired",
      "old refresh code=session_expired",
    );

    // 6. 옛 access token도 logout 후 무효 (서버가 access token revoke를 영속화).
    const meAfter = await call("GET", "/auth/me", { accessToken: preservedAccess });
    expect(meAfter.status === 401, "old access 401 after logout", `got ${meAfter.status}`);
  } finally {
    await stopServer(server);
  }

  await checkPermissions();

  console.log("");
  console.log(`[smoke-persistence] result: ${pass} passed, ${fail} failed`);
  console.log(`[smoke-persistence] artifacts kept at: ${runRoot}`);
  console.log(
    "[smoke-persistence] DB 파일은 자동 삭제하지 않는다. 검사/정리는 직접 결정한다 (저장소 안전 규칙).",
  );
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[smoke-persistence] unhandled error:", err.message);
  // 실패 경로에서도 산출물은 보존한다 (디버그용 + 저장소 안전 규칙).
  console.error(`[smoke-persistence] artifacts kept at: ${runRoot}`);
  process.exit(2);
});
