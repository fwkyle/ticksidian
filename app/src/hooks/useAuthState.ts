import { useCallback, useEffect, useRef, useState } from "react";
import { mockAuthAdapter } from "../lib/auth/mock-auth-adapter";
import type { AuthAdapter } from "../lib/auth/auth-adapter";
import type {
  AuthError,
  AuthRuntimeState,
  AuthSession,
} from "../lib/auth/auth-types";
import { toErrorMessage } from "../lib/error-utils";

interface UseAuthStateResult {
  runtime: AuthRuntimeState;
  session: AuthSession | null;
  /**
   * 마지막 인증 액션의 사용자 표시용 오류. throw 없이 이 값으로만 노출한다.
   * 다음 액션 시작 시점에 자동으로 비운다.
   */
  error: AuthError | null;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * 새 계정 생성 + 즉시 로그인 상태 진입. signIn과 같은 상태 전이를 따른다
   * (signing_in → signed_in 또는 signed_out + error). 가입 실패 코드에는
   * `email_already_exists`가 추가될 수 있다.
   */
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * 외부(에디터/sync 트리거 등)에서 access token이 만료됐다고 판단하면 호출.
   * 성공하면 signed_in 유지, 실패하면 reauth_required로 전환.
   */
  triggerRefresh: () => Promise<void>;
}

/**
 * 인증 상태 hook.
 *
 * 핵심 약속:
 *  1. 어떤 인증 실패도 throw하지 않는다. `error` 상태로만 노출한다.
 *  2. 인증 실패가 노트 편집/저장/검색을 막지 않는다 (이 hook은 노트 흐름과
 *     완전히 분리되어 있다).
 *  3. 일시 상태(signing_in/refreshing/signing_out)는 React state에서만 다룬다.
 *     SQLite vault_binding.auth_state에는 영구 상태(signed_in/signed_out/
 *     reauth_required)만 별도 effect에서 반영한다.
 *
 * 어댑터 주입:
 *  - 기본값은 `mockAuthAdapter` — 실제 서버 호출 없음.
 *  - `realAuthAdapter`는 `VITE_TICKSIDIAN_AUTH_MODE=real`일 때만 App에서
 *    명시적으로 주입한다. 자세한 경계는 M3-인증-설계 §14 참고.
 *
 * 설계: docs/waterfall/03-상세설계/M3-인증-설계.md §5, §11~§16
 */
export function useAuthState(
  adapter: AuthAdapter = mockAuthAdapter,
): UseAuthStateResult {
  const [runtime, setRuntime] = useState<AuthRuntimeState>("signed_out");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<AuthError | null>(null);

  // unmount 후 setState를 막기 위한 ref. cancellation 토큰 패턴 대신 단순 가드.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 앱 시작 시 1회 세션 복구 시도.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const restored = await adapter.getCurrentSession();
        if (cancelled || !mountedRef.current) return;
        if (restored) {
          setSession(restored);
          setRuntime("signed_in");
        } else {
          setSession(null);
          setRuntime("signed_out");
        }
      } catch (e) {
        // 복구 실패 = signed_out 유지. 에디터 흐름은 절대 막지 않는다.
        console.error("[useAuthState] restore failed:", e);
        if (cancelled || !mountedRef.current) return;
        setSession(null);
        setRuntime("signed_out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  // signIn / signUp 공통 진입 흐름. 어댑터 호출만 다르고 상태 전이는 같다.
  const runEntry = useCallback(
    async (
      call: () => ReturnType<AuthAdapter["signIn"]>,
      fallbackMsg: string,
    ) => {
      setError(null);
      setRuntime("signing_in");
      try {
        const result = await call();
        if (!mountedRef.current) return;
        if (result.ok) {
          setSession(result.session);
          setRuntime("signed_in");
        } else {
          setSession(null);
          setRuntime("signed_out");
          setError({
            code: result.code,
            message: result.message,
            ...(result.retryAfterSec === undefined ? {} : { retryAfterSec: result.retryAfterSec }),
          });
        }
      } catch (e) {
        if (!mountedRef.current) return;
        // 어댑터가 throw하면 안 되지만 방어적으로 처리.
        setSession(null);
        setRuntime("signed_out");
        setError({
          code: "unknown",
          message: toErrorMessage(e, fallbackMsg),
        });
      }
    },
    [],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      await runEntry(
        () => adapter.signIn(email, password),
        "로그인 중 알 수 없는 오류가 발생했습니다.",
      );
    },
    [adapter, runEntry],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      await runEntry(
        () => adapter.signUp(email, password),
        "가입 중 알 수 없는 오류가 발생했습니다.",
      );
    },
    [adapter, runEntry],
  );

  const signOut = useCallback(async () => {
    setError(null);
    setRuntime("signing_out");
    try {
      await adapter.signOut();
      if (!mountedRef.current) return;
      setSession(null);
      setRuntime("signed_out");
    } catch (e) {
      if (!mountedRef.current) return;
      // 로그아웃 실패해도 사용자 입장에서는 "로컬 편집은 그대로 가능"해야 한다.
      // 따라서 signed_out으로 강제 전환하고 오류만 표시한다.
      setSession(null);
      setRuntime("signed_out");
      setError({
        code: "unknown",
        message: toErrorMessage(e, "로그아웃 중 오류가 발생했습니다."),
      });
    }
  }, [adapter]);

  const triggerRefresh = useCallback(async () => {
    setError(null);
    setRuntime("refreshing");
    try {
      const refreshed = await adapter.refreshSession();
      if (!mountedRef.current) return;
      if (refreshed) {
        setSession(refreshed);
        setRuntime("signed_in");
      } else {
        // 세션 만료 → 재인증 필요. 로컬 편집은 계속 가능하다.
        setSession(null);
        setRuntime("reauth_required");
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setSession(null);
      setRuntime("reauth_required");
      setError({
        code: "unknown",
        message: toErrorMessage(e, "세션을 갱신하지 못했습니다."),
      });
    }
  }, [adapter]);

  return { runtime, session, error, signIn, signUp, signOut, triggerRefresh };
}
