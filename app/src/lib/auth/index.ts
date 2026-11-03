/**
 * 인증 모듈의 공개 진입점.
 *
 * `selectAuthAdapter()`가 `VITE_TICKSIDIAN_AUTH_MODE`를 보고 mock/real을
 * 고른다. 기본은 mock — real adapter는 dev에서 `VITE_TICKSIDIAN_AUTH_MODE=real`
 * 로 opt-in해야 활성화된다.
 *
 * 이 분기는 module load 시점에 한 번만 평가된다 (HMR 중에도 일관성 유지).
 */

import type { AuthAdapter } from "./auth-adapter";
import { mockAuthAdapter } from "./mock-auth-adapter";
import { realAuthAdapter } from "./real-auth-adapter";
import { AUTH_BASE_URL, AUTH_MODE } from "./auth-config";

export function selectAuthAdapter(): AuthAdapter {
  return AUTH_MODE === "real" ? realAuthAdapter : mockAuthAdapter;
}

/** 호출 측에서 표시 용도로 쓸 수 있는 현재 모드/URL. */
export const activeAuthMode = AUTH_MODE;
export const activeAuthBaseUrl = AUTH_BASE_URL;
