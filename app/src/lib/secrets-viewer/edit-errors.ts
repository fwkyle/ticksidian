/**
 * 편집 저장 거부(외부 변경 감지) 판정(TICK-SEC-002).
 * 실창(Tauri)은 Rust CommandError 직렬화값 { code, message }로, 브라우저 fixture는
 * Error 객체/문자열로 반납한다 — 두 형태를 같은 의미로 판정한다.
 */
const EXTERNAL_CHANGE_CODE = "secretModifiedExternally";
const EXTERNAL_CHANGE_MESSAGE_HINT = "외부에서 바뀌었습니다";

export function isSecretExternalChangeError(error: unknown): boolean {
  if (typeof error === "string") {
    return error.includes(EXTERNAL_CHANGE_MESSAGE_HINT);
  }
  if (error instanceof Error) {
    return error.message.includes(EXTERNAL_CHANGE_MESSAGE_HINT);
  }
  if (typeof error === "object" && error !== null) {
    const record = error as { code?: unknown; message?: unknown };
    if (record.code === EXTERNAL_CHANGE_CODE) return true;
    return (
      typeof record.message === "string" &&
      record.message.includes(EXTERNAL_CHANGE_MESSAGE_HINT)
    );
  }
  return false;
}
