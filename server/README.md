# Ticksidian dev-only auth server

> ⚠️ **Production이 아니다.** 이 서버는 프론트의 `realAuthAdapter`가 동작하는지
> 확인하기 위한 dev-only 백엔드다. HTTPS 없음, production-grade rate limiting 없음,
> email verification/password reset 없음. process-local 최소 제한은 있지만 운영 배포는 별도 설계가 필요하다.

## Why

M3-1c에서 mock auth adapter, M3-1d에서 인증 API 계약, M3-1e에서 메모리 store
1차 backend, **M3-1f에서 SQLite persistence**까지 닫았다. 이 서버가 죽거나
응답이 나빠도 **로컬 Markdown 볼트 편집은 절대 막히지 않는다** — 그게 M3
원칙(`docs/waterfall/03-상세설계/M3-인증-설계.md` §10).

## 위치/스코프

- 경로: `server/`
- 언어: Node.js 20.6+ + TypeScript (`module: NodeNext`)
- HTTP: vanilla `node:http` — Express 등 미사용
- 비밀번호 해싱: `node:crypto.scrypt` (native dep 없음)
- 토큰: opaque random hex (JWT 미사용 — dev 디버그 단순화)
- DB: **SQLite (`better-sqlite3`)** — M3-1f부터. 재시작 후에도 user/session 유지.
  - ⚠️ `better-sqlite3`는 native module이라 **설치 시점의 Node 버전에 묶인다.**
    로컬 Node 버전을 바꾼 뒤 `NODE_MODULE_VERSION` 불일치 에러가 나면
    `cd server && npm rebuild better-sqlite3`로 재컴파일한다.
    (2026-06-10 QA에서 Node 26 전환 후 실제 발생 → rebuild로 해결.
    rebuild 후에는 반대로 이전 Node 버전에서 깨지므로, 서버를 띄우는 Node 버전을 통일할 것.
    기준 버전은 저장소 루트 `.nvmrc` — 로컬/CI 모두 이 파일을 따른다.)
- production 마이그레이션 시: HTTPS, persistent/distributed rate limit, MySQL 또는 RDS, email verify, audit log

## 실행

```bash
cd server
npm install            # better-sqlite3 + dev deps
npm run typecheck      # tsc --noEmit
npm run build          # tsc → dist/
npm start              # node dist/index.js  (기본 127.0.0.1:8787)
```

dev 루프 (`tsc --watch`):

```bash
npm run dev            # 별도 터미널에서 npm start
```

## 환경 변수 (모두 선택)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `TICKSIDIAN_AUTH_HOST` | `127.0.0.1` | 바인딩 주소 (loopback only 권장) |
| `TICKSIDIAN_AUTH_PORT` | `8787` | 포트 |
| `TICKSIDIAN_AUTH_CORS_ORIGINS` | (비어 있음) | CORS 허용 origin (콤마 구분). **TICK-P0-004**: 기본값에서 자동 허용 origin을 모두 제거했다. cross-origin 호출이 필요하면 사용자가 직접 명시한다 (아래 [CORS 허용 origin](#cors-허용-origin) 참고). |
| `TICKSIDIAN_AUTH_DB_PATH` | `./data/auth.db` | SQLite 파일 경로. `:memory:`도 허용(휘발 store) |

## CORS 허용 origin

**기본값(빈 값)** 에서는 어떤 origin에도 CORS 응답 헤더를 돌려주지 않는다. dev
서버라도 명시 origin이 없으면 모든 cross-origin 요청을 거부하는 쪽이 보수적이다
(TICK-P0-004 보안 표면 좁히기).

브라우저나 Tauri webview에서 호출이 필요하면 사용자가 직접 의도적으로
`TICKSIDIAN_AUTH_CORS_ORIGINS` 를 채운다. 콤마로 여러 개 지정 가능.

```bash
# 예: Vite dev + Tauri webview 동시 허용
export TICKSIDIAN_AUTH_CORS_ORIGINS=http://localhost:5173,tauri://localhost
npm start
```

`.env.example`도 같은 안내를 포함하지만 `.env`/`.env.local` 둘 다 `.gitignore`로
잡혀 있으니 직접 한 번 활성화한다.

스모크 테스트(`npm run smoke`, `npm run smoke:persistence`)는 same-origin
loopback이고 Origin 헤더 없이 호출하므로 이 변경의 영향을 받지 않는다.

## env 로딩 정책 (M3-1f 결정)

서버 코드는 `dotenv` 같은 자동 로더를 추가하지 않는다. 대신 두 가지 방법
중 하나를 선택한다:

### 1) Node built-in `--env-file=.env` (권장, Node 20.6+)

```bash
cp .env.example .env       # 한 번만
# .env를 자기 환경에 맞게 수정
npm run start:env          # node --env-file=.env dist/index.js
```

이 방식은 dependency 0개로 동일한 효과를 낸다. Node가 직접 파싱하므로
`.env` 형식만 맞춰 적으면 된다.

### 2) shell env로 직접 전달 (간단, 임시)

```bash
TICKSIDIAN_AUTH_PORT=8788 npm start
# 또는 미리 export
export TICKSIDIAN_AUTH_HOST=127.0.0.1
export TICKSIDIAN_AUTH_CORS_ORIGINS=http://localhost:5173,tauri://localhost
export TICKSIDIAN_AUTH_DB_PATH=:memory:
npm start
```

### 왜 dotenv를 안 쓰는가

- Node 20.6+ built-in `--env-file`이 같은 일을 한다 (dep 0).
- 자동 로드(`require("dotenv/config")`)는 마법 같은 동작이라 후속 디버깅이 어려움.
- 환경 분리(`.env.development` 등)는 이 dev 서버 범위에서 과함.

`.env`/`.env.local` 둘 다 `.gitignore`로 잡힘. `.env.example`은 사용 가능한
변수 목록을 보여 주는 **참고용 문서**일 뿐이다.

## 영속화 (M3-1f)

- 기본 위치: `server/data/auth.db` (server 디렉토리 안. `.gitignore`로 잡힘)
- WAL journal 모드 + foreign keys ON.
- 테이블: `users`, `access_tokens`, `refresh_tokens`.
- 재시작 후에도 가입 계정으로 로그인 가능하고, 발급된 refresh token은
  여전히 유효하다(만료/폐기되지 않은 한).

### 리셋이 필요한 경우 — 두 가지 안전 경로

저장소 안전 규칙(`~/.claude/rules/kyle-destructive-ops-safety.md`)에 따라
이 README는 dev DB 파일을 삭제(`rm`/`find -delete`)하라고 안내하지 않는다.
다음 두 방법 중 상황에 맞는 쪽을 쓴다.

**(A) 휘발 store로 그 회만 깨끗하게 시작**

```bash
TICKSIDIAN_AUTH_DB_PATH=:memory: npm start
```

프로세스가 살아 있는 동안만 store가 유지되고, 종료하면 모두 사라진다. 파일을
건드리지 않으니 가장 안전한 기본값이다.

**(B) 파일 DB를 정말 비워야 할 때 — staging/backup 위치로 이동**

이름에 timestamp를 붙여 staging 디렉토리(추적 제외, `data/` 아래)로 옮긴다.
지우는 게 아니라 보존하므로 실수해도 복구 가능하다. 실제 정리는 [kyle]가
직접 결정한다. 명령은 한 줄짜리 복합 셸로 묶지 않는다.

```bash
# 절대경로로 mv 한 번에 한 파일씩. 위치는 server/data/staging/(추적 제외).
mkdir -p /절대/경로/server/data/staging
mv /절대/경로/server/data/auth.db     /절대/경로/server/data/staging/auth-2026-05-10T12-34-56.db
mv /절대/경로/server/data/auth.db-wal /절대/경로/server/data/staging/auth-2026-05-10T12-34-56.db-wal
mv /절대/경로/server/data/auth.db-shm /절대/경로/server/data/staging/auth-2026-05-10T12-34-56.db-shm
```

> **금지**: 삭제 계열 명령(파일/디렉토리 영구 제거), 복합 셸 한 줄
> (`&&` / `;` / 중첩 `sh -c`)로 묶은 파괴 명령은 사용하지 않는다.
> 정리/삭제가 정말 필요하면 [kyle] 승인 후 절대경로로 한 줄씩 처리한다.

## API

`docs/waterfall/03-상세설계/M3-인증-설계.md` §12 계약을 그대로 구현한다.

| 메서드 | 경로 | 성공 응답 |
|--------|-----|-----------|
| POST | `/auth/signup` | `201 { ok: true, data: { user, tokens } }` |
| POST | `/auth/login` | `200 { ok: true, data: { user, tokens } }` |
| POST | `/auth/refresh` | `200 { ok: true, data: { tokens } }` |
| POST | `/auth/logout` | `200 { ok: true, data: {} }` |
| GET | `/auth/me` | `200 { ok: true, data: { user } }` (Authorization: Bearer access) |

오류 응답은 `{ ok: false, error: { code, message } }`. `code`는
`AuthErrorCode` 7개 union(`invalid_credentials` / `email_already_exists` /
`session_expired` / `rate_limited` / `network` / `server` / `unknown`).

## 스모크 테스트

### 기본 흐름 (`smoke`) — 두 터미널 필요

`npm run smoke`는 **이미 떠 있는 server에 대한 fetch만** 한다. 자체적으로
서버를 띄우지 않으니, server를 먼저 따로 기동해야 한다. 이 절차를 안 지키면
`fetch failed`로 즉시 실패한다.

```bash
# 터미널 1 — server 기동 (in-memory DB로 격리)
cd server
TICKSIDIAN_AUTH_DB_PATH=:memory: npm start
```

```bash
# 터미널 2 — smoke 실행
cd server
npm run smoke          # node scripts/smoke-test.mjs (27 assertion)
```

종료할 때는 터미널 1에서 server 프로세스에 SIGINT(Ctrl+C) 또는 SIGTERM을
보낸다. in-memory store라 종료와 함께 데이터가 사라진다.

### 영속성 검증 (`smoke:persistence`) — 단일 터미널

`smoke:persistence`는 self-contained다. 자체적으로 server를 두 번 spawn해
재시작 시나리오를 검증하므로 미리 server를 띄울 필요가 없다(이미 떠 있는
8989 포트와 충돌만 안 하면 된다).

```bash
cd server
npm run smoke:persistence
```

생성된 DB 파일은 **자동으로 삭제하지 않는다** (저장소 안전 규칙). 위치는
`server/data/smoke-runs/<timestamp>-<pid>/auth.db`이며 마지막 줄에 절대경로가
출력된다. `data/`는 `.gitignore`로 잡혀 있어 커밋되지 않는다. 정리는
[kyle]가 직접 결정한다 (위 "리셋이 필요한 경우" 절차 참고).

### 인증 제한 검증 (`smoke:rate-limit`) — 단일 터미널

`smoke:rate-limit`는 self-contained다. 자체적으로 server를 spawn하고
`:memory:` DB를 사용해 로그인 실패 잠금, IP 단위 로그인 실패 제한,
가입 시도 제한, 잘못된 refresh token 제한을 검증한다.

```bash
cd server
npm run smoke:rate-limit
```

## 보안 요약

- 비밀번호: scrypt(N=16384, r=8, p=1, key=64B) + 16B salt. 평문/해시 응답 금지.
- access token: opaque hex 32B, TTL 15분. 클라이언트 메모리 only.
- refresh token: opaque hex 32B, TTL 7일. 회전 시 옛 token revoked.
- Authorization header: `Bearer {accessToken}` 만 받음.
- 정상 흐름 console 로깅 없음. 예외만 stderr.
- DB 파일 권한: OS 기본. 운영 배포 전 별도 보호 필요.
- production 전 반드시 추가할 것: HTTPS, rate limiting, email verification,
  password reset, audit log, 적절한 CORS, secret rotation.

## 후속

- M3-2: syncMode 토글 UI + 계정-볼트 명시 연결 + 노트 sync open
- M4 운영: bcrypt/argon2 검토, JWT 또는 동일 opaque 모델 유지, RDS 이관
