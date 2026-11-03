/**
 * editor-clipboard.ts — 복사·잘라내기 클립보드 평문 규칙 (2026-09-18 TICK-BUG-007).
 *
 * 설계: docs/waterfall/03-상세설계/복사-평문-클립보드.md
 * Node QA: app/qa-editor-clipboard.mjs
 *
 * Why: BlockNote는 복사할 때 클립보드의 `text/plain` 자리에 마크다운을 넣는다. 그
 * 직렬화기는 링크 글자와 주소가 같으면 `<주소>` 오토링크로 쓰기 때문에, 노트의 주소를
 * 복사해 크롬 주소창·검색창에 붙이면 `<https://character.ai/>`가 그대로 보인다.
 * 그래서 평문 자리에는 **화면에 보이는 글자**를 넣는다. 리치 형식(text/html,
 * blocknote/html)은 건드리지 않는다 — 그쪽이 링크와 서식을 담당한다.
 */

/** ProseMirror 문서 중 이 모듈이 쓰는 부분만 좁혀 받는다(Node QA용). */
export interface PlainTextDocument {
  textBetween(from: number, to: number, blockSeparator?: string): string;
}

/** ProseMirror 선택 범위 중 이 모듈이 쓰는 부분만 좁혀 받는다. */
export interface PlainTextSelection {
  readonly from: number;
  readonly to: number;
  readonly empty: boolean;
}

/**
 * 여러 블록을 붙일 때 넣는 구분자.
 *
 * 문단 사이를 빈 줄로 벌리지 않는다. 붙여넣는 쪽이 대개 일반 입력칸이고, 빈 줄은
 * 거기서 지워야 할 군더더기가 된다.
 */
export const PLAIN_TEXT_BLOCK_SEPARATOR = "\n";

/**
 * 선택 범위의 평문. 클립보드를 건드릴 값이 없으면 null이다.
 *
 * null을 돌려주는 경우: 선택이 접혀 있음, 범위가 비어 있음, 글자가 하나도 없음.
 * 호출부는 null일 때 `setData`를 호출하지 않는다 — 기본 동작(마크다운 포함)을 보존한다.
 */
export function selectionPlainText(
  doc: PlainTextDocument,
  selection: PlainTextSelection,
): string | null {
  if (selection.empty || selection.to <= selection.from) return null;

  const text = doc.textBetween(selection.from, selection.to, PLAIN_TEXT_BLOCK_SEPARATOR);
  return text.length > 0 ? text : null;
}
