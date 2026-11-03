/**
 * excalidraw-document.ts — Excalidraw raw JSON 그림 문서의 순수 규칙 (2026-08-23 TICK-DRAW-001).
 *
 * 설계: docs/waterfall/03-상세설계/엑스칼리드로우-그림-편집.md §2
 * Node QA: app/qa-excalidraw-document.mjs
 *
 * Why: `@excalidraw/excalidraw`의 `serializeAsJSON`은 `source`를 현재 origin으로 바꾸고
 * appState를 자기 기준으로 다시 쓴다. 그러면 excalidraw.com이 만든 [kyle]의 원본이
 * 우리 앱 색으로 물든다. 직렬화를 우리가 해서 **원본 최상위 키를 전부 보존**하고
 * `elements`와 화이트리스트 appState만 바꾼다. 잠긴 계약 1(로컬 파일이 원본)의 적용이다.
 *
 * IO는 하지 않는다.
 */

/** raw JSON 그림 파일 확장자. 플러그인 형식(`*.excalidraw.md`)은 여기 해당하지 않는다. */
export const EXCALIDRAW_EXTENSION = "excalidraw";

/**
 * 파일에 저장하는 appState 키. excalidraw 자신이 `.excalidraw` 파일에 남기는 범위와 같다.
 * 선택 상태·줌·커서 같은 편집 중 임시 상태는 파일에 넣지 않는다 — 넣으면 그림을 열기만
 * 해도 파일이 바뀐다.
 */
export const EXCALIDRAW_PERSISTED_APP_STATE_KEYS = [
  "gridSize",
  "viewBackgroundColor",
] as const;

export type ExcalidrawPersistedAppStateKey =
  typeof EXCALIDRAW_PERSISTED_APP_STATE_KEYS[number];

/** 파싱한 그림 문서. `original`은 저장 때 키 보존에 쓴다. */
export interface ExcalidrawDocument {
  readonly original: Record<string, unknown>;
  readonly elements: readonly unknown[];
  readonly appState: Record<string, unknown>;
  readonly files: Record<string, unknown> | undefined;
}

export type ParseExcalidrawResult =
  | ({ ok: true } & ExcalidrawDocument)
  | { ok: false; reason: string };

/**
 * raw JSON 그림 파일 경로인가.
 *
 * `*.excalidraw.md`는 옵시디언 플러그인 형식이라 **거짓**이다. 그 파일은 압축된 그림
 * 데이터를 담고 있어 2026-08-20 편집 보호(`excalidraw-note.ts`) 대상으로 남는다.
 */
export function isRawExcalidrawPath(path: string): boolean {
  return path.toLowerCase().endsWith(`.${EXCALIDRAW_EXTENSION}`);
}

/** 목록에 보여줄 제목(확장자 제거). */
export function drawingTitleFromFileName(fileName: string): string {
  const suffix = `.${EXCALIDRAW_EXTENSION}`;
  return fileName.toLowerCase().endsWith(suffix)
    ? fileName.slice(0, -suffix.length)
    : fileName;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 그림 문서를 읽는다. 조금이라도 못 미더우면 실패를 돌려준다(fail-closed) —
 * 화면은 실패한 파일의 저장 경로를 아예 열지 않는다.
 */
export function parseExcalidrawDocument(text: string): ParseExcalidrawResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "JSON 형식이 아닙니다." };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: "그림 파일의 최상위가 객체가 아닙니다." };
  }
  if (parsed.type !== "excalidraw") {
    return { ok: false, reason: "Excalidraw 그림 파일이 아닙니다(type 불일치)." };
  }
  if (!Array.isArray(parsed.elements)) {
    return { ok: false, reason: "그림 요소 목록(elements)이 없습니다." };
  }
  return {
    ok: true,
    original: parsed,
    elements: parsed.elements,
    appState: isPlainObject(parsed.appState) ? parsed.appState : {},
    files: isPlainObject(parsed.files) ? parsed.files : undefined,
  };
}

/**
 * 열기만 해도 값이 바뀌는 요소 필드 (2026-08-23 실측).
 *
 * excalidraw는 파일을 캔버스에 올리는 것만으로 `version`을 올리고 `versionNonce`·`updated`를
 * 새로 찍으며, 0.18의 분수 인덱싱 때문에 `index`도 새로 붙는다. 사용자가 아무것도 안 했는데
 * 파일이 바뀌면 안 되므로(잠긴 계약 1), **바뀐 것이 있는지 따질 때는 이 필드를 무시한다.**
 */
export const EXCALIDRAW_VOLATILE_ELEMENT_KEYS = [
  "version",
  "versionNonce",
  "updated",
  "index",
] as const;

/**
 * 비교용 정규화. 세 가지를 같은 것으로 본다:
 *   1) 휘발성 필드(위 목록)는 없는 셈 친다.
 *   2) 빈 배열과 null과 **키 없음**을 모두 같은 것으로 본다 — excalidraw는 열 때
 *      `boundElements: null`을 `[]`로 바꾸고 없던 키를 채워 넣는다(실측).
 *   3) 키 순서는 무시한다(정렬해서 비교).
 */
function normalizeElementForCompare(element: unknown): unknown {
  if (!isPlainObject(element)) return element;
  const isLinearElement =
    (element.type === "arrow" || element.type === "line") && Array.isArray(element.points);
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(element)) {
    if ((EXCALIDRAW_VOLATILE_ELEMENT_KEYS as readonly string[]).includes(key)) continue;
    // Excalidraw 0.18.1은 autoResize 키가 없던 text에도 열기만 하면 true를 붙인다.
    // 원본 false는 아래 일반 항목으로 남겨 false→true 실제 변경을 계속 잡는다.
    if (key === "autoResize" && value === true) continue;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    // 선의 실제 모양은 points가 정한다. Excalidraw는 열 때 바깥 크기의 부호만 양수로 만든다.
    if (isLinearElement && (key === "width" || key === "height") && typeof value === "number") {
      entries.push([key, Math.abs(value)]);
      continue;
    }
    entries.push([key, value]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries;
}

function compareKey(elements: readonly unknown[]): string {
  return JSON.stringify(elements.map(normalizeElementForCompare));
}

export interface MeaningfulChangeInput {
  readonly original: Record<string, unknown>;
  readonly elements: readonly unknown[];
  readonly appState: Record<string, unknown>;
}

/**
 * 사람이 실제로 바꾼 것이 있는가 (2026-08-23 TICK-DRAW-001).
 *
 * 요소는 위 휘발성 필드를 뺀 값으로 비교하고, appState는 `viewBackgroundColor`만 본다.
 * `gridSize`는 excalidraw가 열 때 `null → 20`으로 정규화해 버려서(실측) 변경 판정에
 * 넣으면 열기만 해도 저장이 돈다. 저장이 실제로 일어날 때는 화이트리스트대로 같이 기록된다.
 */
export function hasMeaningfulExcalidrawChange(input: MeaningfulChangeInput): boolean {
  const { original, elements, appState } = input;
  const originalElements = Array.isArray(original.elements) ? original.elements : [];
  if (compareKey(originalElements) !== compareKey(elements)) return true;

  const originalAppState = isPlainObject(original.appState) ? original.appState : {};
  if (!("viewBackgroundColor" in appState)) return false;
  return originalAppState.viewBackgroundColor !== appState.viewBackgroundColor;
}

export interface BuildExcalidrawSaveDocumentInput {
  /** 로드 시점 원본 객체. 최상위 키 보존의 기준이다. */
  readonly original: Record<string, unknown>;
  readonly elements: readonly unknown[];
  /** 캔버스의 현재 appState. 화이트리스트 키만 파일로 넘어간다. */
  readonly appState: Record<string, unknown>;
  /** 넘기지 않으면 원본 files를 그대로 둔다. */
  readonly files?: Record<string, unknown>;
}

/**
 * 저장할 파일 내용을 만든다.
 *
 * 키 순서는 원본을 따른다 — JS 객체는 이미 있는 키를 덮어써도 위치가 안 바뀌므로,
 * 바뀐 내용이 없으면 결과가 원본 문자열과 **글자까지 같다**(QA로 잠겨 있다).
 */
export function buildExcalidrawSaveDocument(
  input: BuildExcalidrawSaveDocumentInput,
): string {
  const { original, elements, appState, files } = input;
  const next: Record<string, unknown> = { ...original };

  next.elements = elements;

  const originalAppState = isPlainObject(original.appState) ? original.appState : {};
  const nextAppState: Record<string, unknown> = { ...originalAppState };
  for (const key of EXCALIDRAW_PERSISTED_APP_STATE_KEYS) {
    if (key in appState) nextAppState[key] = appState[key];
  }
  next.appState = nextAppState;

  if (files !== undefined) next.files = files;

  return `${JSON.stringify(next, null, 2)}\n`;
}
