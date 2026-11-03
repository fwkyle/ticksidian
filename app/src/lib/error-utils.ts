export function toErrorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  // Tauri invoke의 거부값은 Error가 아니라 Rust가 직렬화한 plain object다
  // (예: RagError → { code, message }). 그래서 instanceof 검사만으로는 걸러지지 않고,
  // String(error)를 쓰면 "[object Object]"가 사용자 화면에 뜬다(2026-08-16 F3).
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

export function parseJsonWithFallback<T>(
  raw: string,
  fallbackFactory: () => T,
  context: string,
): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(
      `[${context}] JSON parse failed: ${toErrorMessage(error)}`,
      error,
    );
    return fallbackFactory();
  }
}

/**
 * 파일 IO 경계에서 "예상 가능한 실패"인지 판정한다(2026-08-18).
 *
 * Why: Tauri `invoke`의 거부값은 `Error`도 문자열도 아니라 Rust가 직렬화한 plain object다
 * (`{ code: "io", message: "io error: No such file or directory (os error 2)" }`).
 * `error instanceof Error || typeof error === "string"`만 보면 이 객체가 걸러지지 않아
 * "아직 파일이 없다"는 정상 상황이 앱 에러로 튀어나온다.
 * 실제로 검토 큐 첫 실행에서 큐 파일이 없을 때 화면에 영어 시스템 오류가 떴다.
 *
 * 브라우저 QA의 fake store는 `Error`를 던지기 때문에 이 차이가 fixture에서는 드러나지 않는다.
 * 실제 Tauri 창에서만 재현된다.
 */
export function isExpectedIoError(error: unknown): boolean {
  if (error instanceof Error || typeof error === "string") return true;
  return typeof error === "object" && error !== null;
}
