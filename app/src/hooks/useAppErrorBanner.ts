import { useState, useEffect } from "react";
import { pendingSaveFailures } from "../lib/pending-save-failures";

interface UseAppErrorBannerResult {
  appError: string | null;
  setAppError: (error: string | null) => void;
}

/**
 * 앱 상단 에러 배너 상태를 관리한다.
 *
 * - appError state + setAppError를 제공한다.
 * - 마운트 시 pendingSaveFailures에 이미 쌓인 실패를 한 번 drain한다.
 * - 이후에도 pendingSaveFailures.subscribe로 구독해, 언마운트 flush 실패가
 *   비동기로 도착하면 즉시 배너에 띄운다.
 *
 * 설계: TICK-P0-003 무음 저장 실패 surface
 */
export function useAppErrorBanner(): UseAppErrorBannerResult {
  const [appError, setAppError] = useState<string | null>(null);

  // 무음 저장 실패 surface (TICK-P0-003).
  // 언마운트(노트/볼트 전환) 후 자동 저장 flush가 실패하면 useNoteEditor가
  // pendingSaveFailures에 적재한다. 그 실패는 비동기로 도착하므로 구독으로 받아
  // 즉시 에러 배너에 띄운다. 마운트 시 이미 쌓인 실패도 한 번 drain한다.
  useEffect(() => {
    const surface = () => {
      if (!pendingSaveFailures.has()) return;
      const failures = pendingSaveFailures.drain();
      if (failures.length === 0) return;
      setAppError(failures[failures.length - 1].message);
    };
    surface();
    return pendingSaveFailures.subscribe(surface);
  }, []);

  return { appError, setAppError };
}
