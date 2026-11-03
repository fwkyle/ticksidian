import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "../lib/password.js";
import {
  pickStringField,
  readBearerToken,
  readJsonBody,
  sendCreated,
  sendError,
  sendRateLimitError,
  sendSuccess,
} from "../lib/http.js";
import {
  checkLoginAttempt,
  consumeInvalidRefreshAttempt,
  consumeSignupAttempt,
  recordLoginFailure,
  recordLoginSuccess,
} from "../lib/rate-limit.js";
import {
  createUser,
  findUserByAccountId,
  findUserByEmail,
} from "../store/user-store.js";
import {
  issueTokenPair,
  lookupAccessToken,
  lookupRefreshToken,
  revokeAllAccessTokensFor,
  revokeRefreshToken,
  rotateRefreshToken,
} from "../store/session-store.js";
import type {
  AuthApiUser,
  LoginResponseData,
  MeResponseData,
  RefreshResponseData,
  SignupResponseData,
} from "../types/api.js";
import type { RateLimitDecision } from "../lib/rate-limit.js";
import type { StoredUser } from "../store/user-store.js";

/**
 * /auth/* 핸들러.
 *
 * 모든 응답은 `AuthSuccess<T>` envelope를 따른다 (lib/http의 sendSuccess /
 * sendError). 비밀번호 평문이나 hash는 어떤 응답에도 포함하지 않는다.
 *
 * 로깅 정책:
 *  - 정상 흐름은 한 줄도 console에 남기지 않는다 (개인 dev 환경 가정).
 *  - 예상치 못한 throw만 console.error로 기록한다 (server 핸들러에서 처리).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;

function sendRateLimitBlock(res: ServerResponse, decision: RateLimitDecision): boolean {
  switch (decision.kind) {
    case "allowed":
      return false;
    case "blocked":
      sendRateLimitError(res, decision.retryAfterSec);
      return true;
  }
}

function toApiUser(user: StoredUser): AuthApiUser {
  return {
    accountId: user.accountId,
    email: user.email,
    createdAt: user.createdAt,
  };
}

export async function handleSignup(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(req);
  const email = pickStringField(body, "email");
  const password = pickStringField(body, "password");
  if (sendRateLimitBlock(res, consumeSignupAttempt(req))) return;

  if (!email || !EMAIL_RE.test(email)) {
    sendError(res, 400, "invalid_credentials", "이메일 형식이 올바르지 않습니다.");
    return;
  }
  if (!password || password.length < MIN_PASSWORD_LEN) {
    sendError(
      res,
      400,
      "invalid_credentials",
      `비밀번호는 ${MIN_PASSWORD_LEN}자 이상이어야 합니다.`,
    );
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = createUser(email, passwordHash);
  if (!user) {
    sendError(res, 409, "email_already_exists", "이미 가입된 이메일입니다.");
    return;
  }

  const tokens = issueTokenPair(user.accountId);
  const data: SignupResponseData = { user: toApiUser(user), tokens };
  sendCreated(res, data);
}

export async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(req);
  const email = pickStringField(body, "email");
  const password = pickStringField(body, "password");

  if (!email || !password) {
    sendError(res, 400, "invalid_credentials", "이메일/비밀번호를 입력해 주세요.");
    return;
  }
  if (sendRateLimitBlock(res, checkLoginAttempt(req, email))) return;

  const user = findUserByEmail(email);
  // 사용자 미존재든 비밀번호 불일치든 같은 메시지/코드로 통일 (계정 열거 방지).
  const generic = "이메일 또는 비밀번호가 올바르지 않습니다.";

  if (!user) {
    // 계정 없을 때도 동일 latency를 맞추기 위해 실제 scrypt cost를 한 번 돈다.
    // DUMMY_PASSWORD_HASH는 password.ts가 모듈 로드 시 표준 파라미터로 미리 계산한
    // 정상 hash라 verifyPassword가 길이 검사 단계에서 빠져나가지 않고 끝까지 돈다.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    recordLoginFailure(req, email);
    sendError(res, 401, "invalid_credentials", generic);
    return;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    recordLoginFailure(req, email);
    sendError(res, 401, "invalid_credentials", generic);
    return;
  }

  recordLoginSuccess(req, email);
  const tokens = issueTokenPair(user.accountId);
  const data: LoginResponseData = { user: toApiUser(user), tokens };
  sendSuccess(res, data);
}

export async function handleRefresh(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(req);
  const refreshToken = pickStringField(body, "refreshToken");
  if (!refreshToken) {
    if (sendRateLimitBlock(res, consumeInvalidRefreshAttempt(req))) return;
    sendError(res, 400, "session_expired", "리프레시 토큰이 필요합니다.");
    return;
  }

  const lookup = lookupRefreshToken(refreshToken);
  if (!lookup.ok) {
    if (sendRateLimitBlock(res, consumeInvalidRefreshAttempt(req))) return;
    sendError(res, 401, "session_expired", "세션이 만료되었습니다. 다시 로그인해 주세요.");
    return;
  }

  const tokens = rotateRefreshToken(refreshToken);
  if (!tokens) {
    // 직전에 lookupRefreshToken이 ok였는데 rotate가 실패하면 race.
    sendError(res, 401, "session_expired", "세션이 만료되었습니다. 다시 로그인해 주세요.");
    return;
  }

  const data: RefreshResponseData = { tokens };
  sendSuccess(res, data);
}

export async function handleLogout(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(req);
  const refreshToken = pickStringField(body, "refreshToken");
  // logout은 best-effort: refresh token이 알려지면 폐기하고 access도 같이 청소.
  if (refreshToken) {
    const lookup = lookupRefreshToken(refreshToken);
    revokeRefreshToken(refreshToken);
    if (lookup.ok) revokeAllAccessTokensFor(lookup.accountId);
  } else {
    // refresh token이 없어도 Authorization 헤더의 access token으로 식별 시도.
    const access = readBearerToken(req);
    if (access) {
      const accountId = lookupAccessToken(access);
      if (accountId) revokeAllAccessTokensFor(accountId);
    }
  }
  sendSuccess(res, {});
}

export async function handleMe(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const access = readBearerToken(req);
  if (!access) {
    sendError(res, 401, "session_expired", "인증이 필요합니다.");
    return;
  }
  const accountId = lookupAccessToken(access);
  if (!accountId) {
    sendError(res, 401, "session_expired", "세션이 만료되었습니다.");
    return;
  }
  const user = findUserByAccountId(accountId);
  if (!user) {
    // access token은 살아 있는데 유저가 사라짐 (메모리 store 재시작 등). 클라이언트가
    // 다시 로그인하도록 session_expired로 매핑.
    sendError(res, 401, "session_expired", "세션이 만료되었습니다.");
    return;
  }
  const data: MeResponseData = { user: toApiUser(user) };
  sendSuccess(res, data);
}
