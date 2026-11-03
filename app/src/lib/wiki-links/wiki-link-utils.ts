/**
 * Wiki Link Utilities
 *
 * 링크 해석에 필요한 정규화, 판별 함수.
 */

/** 작은 인덱스 문자열이 slice의 큰 원문 저장 공간을 붙잡지 않게 분리한다. */
export function detachLinkText(value: string): string {
  // UTF-16 원문(짝 없는 surrogate 포함)을 보존하며 인덱스에 남길 글자만 복제한다.
  return JSON.parse(JSON.stringify(value));
}

/**
 * title/alias 검색용 key 정규화.
 * 1. trim
 * 2. 연속 공백 1칸으로 축소
 * 3. 소문자 변환
 */
export function normalizeLinkKey(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * ref 값이 id: 모드인지 판별.
 * "id:note-123" → true
 * "프로젝트 회의록" → false
 */
export function isIdModeRef(ref: string): boolean {
  return ref.startsWith("id:");
}

/**
 * id: 모드 ref에서 실제 noteId를 추출.
 * "id:note-123" → "note-123"
 */
export function extractNoteIdFromRef(ref: string): string {
  return ref.slice(3);
}

/**
 * 링크 주변 문맥 스니펫을 추출.
 * 링크 위치 앞뒤로 최대 contextLength 글자를 잘라낸다.
 */
export function extractContext(
  markdown: string,
  start: number,
  end: number,
  contextLength = 40,
): string {
  const before = markdown.slice(Math.max(0, start - contextLength), start);
  const linkText = markdown.slice(start, end);
  const after = markdown.slice(end, end + contextLength);

  const prefix = start - contextLength > 0 ? "…" : "";
  const suffix = end + contextLength < markdown.length ? "…" : "";

  return `${prefix}${before}${linkText}${after}${suffix}`.replace(/\n/g, " ").trim();
}
