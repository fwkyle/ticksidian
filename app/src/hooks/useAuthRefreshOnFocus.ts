import { useEffect, useRef } from "react";

interface Options {
  /** real 모드에서 signed_in일 때만 호출되도록 상위에서 조건부로 활성화. */
  enabled: boolean;
  triggerRefresh: () => Promise<void>;
  /**
   * 같은 focus 이벤트가 짧게 연속해서 발생할 때 중복 호출을 막는 최소 간격(ms).
   * 너무 작으면 noisy, 너무 크면 만료된 세션이 오래 남는다. 30초 기본.
   */
  minIntervalMs?: number;
}

/**
 * M3-1e 최소 자동 refresh.
 *
 * 정책:
 *  - visibility/focus 복귀 시 한 번 refresh 시도 (사용자가 다시 앱으로 돌아왔을 때만).
 *  - 노트 저장/읽기/위키링크 흐름에는 절대 끼어들지 않는다.
 *  - 실패해도 throw 없음. `useAuthState.triggerRefresh`가 내부적으로 reauth_required로 전환만 한다.
 *  - 무한 loop 방지: minIntervalMs 안에는 한 번만.
 *  - mock 모드에서는 호출 안 함 (어차피 메모리 토큰 유지가 목적이라 무의미).
 */
export function useAuthRefreshOnFocus({
  enabled,
  triggerRefresh,
  minIntervalMs = 30_000,
}: Options): void {
  const lastFiredAtRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const fire = () => {
      const now = Date.now();
      if (now - lastFiredAtRef.current < minIntervalMs) return;
      lastFiredAtRef.current = now;
      // throw 없는 hook이지만 micro-task 단위에서 catch 한 번 더 둔다.
      triggerRefresh().catch((err) => {
        console.error("[useAuthRefreshOnFocus] triggerRefresh failed:", err);
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") fire();
    };
    const onFocus = () => fire();

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, triggerRefresh, minIntervalMs]);
}
