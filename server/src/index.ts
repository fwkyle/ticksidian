import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  handleLogin,
  handleLogout,
  handleMe,
  handleRefresh,
  handleSignup,
} from "./routes/auth.js";
import { sendError } from "./lib/http.js";
import { getDb } from "./db/index.js";

/**
 * Dev-only auth server (M3-1f 갱신).
 *
 * 절대 production이 아니다:
 *  - HTTPS 없음 (loopback에만 바인딩).
 *  - rate limiting은 process-local 메모리 기반 최소 방어만 있음.
 *  - email verification / password reset 없음.
 *
 * M3-1f 변화:
 *  - user/session store는 SQLite로 영속(better-sqlite3). 재시작 후에도 살아남음.
 *  - 토큰/비밀번호 hash는 DB에 저장되지만 로깅/응답으로 노출되지 않는다.
 *
 * 환경변수:
 *  - TICKSIDIAN_AUTH_HOST       (default: 127.0.0.1)
 *  - TICKSIDIAN_AUTH_PORT       (default: 8787)
 *  - TICKSIDIAN_AUTH_CORS_ORIGINS (default: 비어 있음 → 모든 origin 거부)
 *  - TICKSIDIAN_AUTH_DB_PATH    (default: ./data/auth.db; ":memory:"도 허용)
 *
 * CORS 정책 (TICK-P0-004):
 *  - dev 서버라도 기본값으로 어떤 origin도 자동 허용하지 않는다.
 *  - 사용자가 의도적으로 `TICKSIDIAN_AUTH_CORS_ORIGINS=http://localhost:5173,tauri://localhost`
 *    를 명시했을 때만 그 origin들에 CORS 헤더를 돌려준다.
 *  - smoke-test/persistence는 같은 origin(loopback) + Origin 헤더 없이 호출하므로 영향 없음.
 *
 * env 로딩:
 *  - 코드에 dotenv 같은 자동 로더는 두지 않는다.
 *  - 필요하면 `npm run start:env`(Node 20.6+ built-in `--env-file=.env`) 사용.
 *  - 또는 shell env로 직접 export 후 `npm start`.
 */

const HOST = process.env["TICKSIDIAN_AUTH_HOST"] ?? "127.0.0.1";
const PORT = Number(process.env["TICKSIDIAN_AUTH_PORT"] ?? "8787");
const CORS_ORIGINS = (process.env["TICKSIDIAN_AUTH_CORS_ORIGINS"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

const routes: Route[] = [
  { method: "POST", path: "/auth/signup", handler: handleSignup },
  { method: "POST", path: "/auth/login", handler: handleLogin },
  { method: "POST", path: "/auth/refresh", handler: handleRefresh },
  { method: "POST", path: "/auth/logout", handler: handleLogout },
  { method: "GET", path: "/auth/me", handler: handleMe },
];

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers["origin"];
  if (typeof origin === "string" && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

const server = createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const route = routes.find((r) => r.method === req.method && r.path === url.pathname);

  if (!route) {
    sendError(res, 404, "unknown", "엔드포인트를 찾을 수 없습니다.");
    return;
  }

  try {
    await route.handler(req, res);
  } catch (err) {
    // 의도치 못한 throw만 stderr로 남긴다. 비밀번호/토큰은 위 핸들러에서
    // 절대 예외 메시지에 싣지 않으므로 이 경로도 안전하다.
    console.error(`[auth-server] ${req.method} ${url.pathname} threw:`, err);
    if (!res.writableEnded) {
      sendError(res, 500, "server", "서버 오류가 발생했습니다.");
    }
  }
});

// 기동 때 DB를 열어 파일 권한을 바로 교정한다(DEF-SEC-002). 첫 요청까지 미루지 않는다.
getDb();

server.listen(PORT, HOST, () => {
  console.log(`[auth-server] listening on http://${HOST}:${PORT}`);
  if (CORS_ORIGINS.length === 0) {
    console.log(
      "[auth-server] CORS allow-list: (none) — TICKSIDIAN_AUTH_CORS_ORIGINS가 비어 있다. " +
        "브라우저에서 cross-origin으로 호출하려면 명시적으로 origin을 추가하라.",
    );
  } else {
    console.log(`[auth-server] CORS allow-list: ${CORS_ORIGINS.join(", ")}`);
  }
});
