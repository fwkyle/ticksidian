import { randomBytes } from "node:crypto";

/**
 * Opaque token 발급.
 *
 * 왜 JWT 대신 opaque random token인가:
 *  - dev 단계 디버깅이 단순함. JWT는 디코딩 가능해 보이지만 secret 분리/회전이
 *    같이 들어와야 안전.
 *  - 서버 측 메모리 store에서 token → user 매핑을 직접 관리하므로 폐기/회전이
 *    한 군데서 끝난다.
 *  - 후속(M3-1f)에서 DB로 옮겨도 같은 모델을 그대로 쓸 수 있다.
 *
 * 길이: 32 bytes random → 64 hex chars. 추측 불가능 수준이면 충분.
 */
export function newOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

export function newAccountId(): string {
  // user-facing 식별자. UUID 대신 hex 16 bytes로 충분.
  return randomBytes(16).toString("hex");
}

// 토큰 수명 정책 (M3 인증 설계 §4.1).
export const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15분
export const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7일
