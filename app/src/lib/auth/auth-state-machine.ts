import type { AuthRuntimeState } from "./auth-types";
import type { VaultAuthState } from "../../types/note";

/**
 * 6개 runtime 상태 → vault_binding.auth_state(영구 3개)로 매핑.
 *
 * - 일시 상태(`signing_in`/`refreshing`/`signing_out`)는 DB에 쓰지 않는다.
 *   그래서 매핑이 필요 없다 → null을 돌려준다. 호출 측이 null이면
 *   binding 갱신을 건너뛴다.
 * - 영구 상태만 DB에 1:1 매핑.
 *
 * 설계: M3-인증-설계.md §5 + tauri-볼트-동기화-메타데이터-스키마.md §5.1
 */
export function runtimeToPersistedAuthState(
  runtime: AuthRuntimeState,
): VaultAuthState | null {
  switch (runtime) {
    case "signed_in":
      return "signed_in";
    case "signed_out":
      return "signed_out";
    case "reauth_required":
      return "reauth_required";
    case "signing_in":
    case "refreshing":
    case "signing_out":
      return null;
  }
}

/** 사용자에게 보여줄 짧은 라벨. 일시 상태 포함. */
export function describeAuthRuntimeState(runtime: AuthRuntimeState): string {
  switch (runtime) {
    case "signed_out":
      return "로그아웃됨";
    case "signing_in":
      return "로그인 중…";
    case "signed_in":
      return "로그인됨";
    case "refreshing":
      return "세션 갱신 중…";
    case "reauth_required":
      return "재인증 필요";
    case "signing_out":
      return "로그아웃 중…";
  }
}
