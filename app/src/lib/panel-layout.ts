/**
 * panel-layout.ts — 좌우 패널 폭의 순수 규칙 (2026-08-16 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/패널-너비-조정.md
 * 기준: docs/design-rules.md "패널 너비 조정"
 * Node QA: app/qa-panel-layout.mjs
 *
 * 여기에는 React state, DOM, localStorage 접근이 없다. 입출력만 다룬다.
 */

/**
 * 폭을 조절할 수 있는 패널.
 * 2026-08-18 사이드바 3열 레이아웃으로 `sidebar` 한 개가 `folder`/`notes` 두 개로 나뉘었고,
 * 같은 날 [kyle] 요청으로 투두 패널(`todos`)도 조절 대상에 들어왔다(TICK-UX-003 완료).
 */
export type ResizablePanel = "folder" | "notes" | "todos" | "backlink";

export interface PanelWidths {
  readonly folder: number;
  readonly notes: number;
  readonly todos: number;
  readonly backlink: number;
}

/**
 * 기본 폭.
 * - `folder` 213px: 레일 56px와 경계선 1px를 합쳐 270px.
 * - `notes` 319px: 경계선 1px를 합쳐 320px.
 * - `todos` 288px: 기존 `w-72` 유지(우선순위 칩과 태그가 함께 들어간다).
 * - `backlink` 256px: 기존 `w-64` 유지.
 */
export const DEFAULT_PANEL_WIDTHS: PanelWidths = {
  folder: 213,
  notes: 319,
  todos: 288,
  backlink: 256,
};

/** 패널 하나가 가질 수 있는 절대 하한/상한. */
export const PANEL_MIN_WIDTH = 160;
export const PANEL_MAX_WIDTH = 560;

/** 본문 에디터가 이보다 좁아지지 않게 막는 안전선(디자인 규칙 목표선 400px보다 낮게 잡은 하한). */
export const MIN_EDITOR_WIDTH = 360;

/** localStorage 키. 볼트가 아니라 화면 설정이라 볼트 폴더에 쓰지 않는다. */
export const PANEL_WIDTHS_STORAGE_KEY = "ticksidian-panel-widths";

export interface ClampContext {
  /** 창 가로 크기(px). 모르면 생략 — 절대 한계만 적용한다. */
  readonly viewportWidth?: number;
  /** 반대편 패널이 현재 차지하는 폭(px). 숨겨져 있으면 0. */
  readonly otherPanelWidth?: number;
}

/**
 * 요청한 폭을 실제로 적용 가능한 폭으로 자른다.
 *
 * 1) 절대 한계 [PANEL_MIN_WIDTH, PANEL_MAX_WIDTH]
 * 2) 창 크기를 알면 `창폭 - 반대편 패널 - MIN_EDITOR_WIDTH`를 상한으로 한 번 더
 * 3) 그래도 하한보다 작아지면 하한을 우선한다(패널이 사라지는 것보다 낫다)
 *
 * 숫자가 아니거나 NaN이면 기본값으로 되돌린다.
 */
export function clampPanelWidth(
  requested: number,
  context: ClampContext = {},
): number {
  const base = Number.isFinite(requested) ? requested : DEFAULT_PANEL_WIDTHS.notes;
  let width = Math.round(Math.min(Math.max(base, PANEL_MIN_WIDTH), PANEL_MAX_WIDTH));

  const { viewportWidth, otherPanelWidth = 0 } = context;
  if (Number.isFinite(viewportWidth) && (viewportWidth as number) > 0) {
    const available = (viewportWidth as number) - otherPanelWidth - MIN_EDITOR_WIDTH;
    if (available < width) {
      width = Math.round(available);
    }
  }

  return Math.max(width, PANEL_MIN_WIDTH);
}

/**
 * 세 패널 폭을 한 번에 자른다. 각 패널의 상한 계산에서 **나머지 보이는 패널의 합**을
 * 반대편 폭으로 넘겨, 셋을 다 펼쳐도 본문이 `MIN_EDITOR_WIDTH` 아래로 내려가지 않게 한다.
 * 숨겨진 패널(반응형으로 사라진 것)은 합에서 뺀다.
 */
export function clampPanelWidths(
  widths: PanelWidths,
  viewportWidth?: number,
  visible: { folder?: boolean; notes?: boolean; todos?: boolean; backlink?: boolean } = {},
): PanelWidths {
  const folderVisible = visible.folder ?? true;
  const notesVisible = visible.notes ?? true;
  // 투두 패널은 열려 있을 때만 자리를 차지한다(기본은 닫힘).
  const todosVisible = visible.todos ?? false;
  const backlinkVisible = visible.backlink ?? true;

  const width = (value: number, visibleFlag: boolean) => (visibleFlag ? value : 0);

  const folder = clampPanelWidth(widths.folder, {
    viewportWidth,
    otherPanelWidth:
      width(widths.notes, notesVisible)
      + width(widths.todos, todosVisible)
      + width(widths.backlink, backlinkVisible),
  });
  const notes = clampPanelWidth(widths.notes, {
    viewportWidth,
    otherPanelWidth:
      width(folder, folderVisible)
      + width(widths.todos, todosVisible)
      + width(widths.backlink, backlinkVisible),
  });
  const todos = clampPanelWidth(widths.todos, {
    viewportWidth,
    otherPanelWidth:
      width(folder, folderVisible)
      + width(notes, notesVisible)
      + width(widths.backlink, backlinkVisible),
  });
  const backlink = clampPanelWidth(widths.backlink, {
    viewportWidth,
    otherPanelWidth:
      width(folder, folderVisible)
      + width(notes, notesVisible)
      + width(todos, todosVisible),
  });

  return { folder, notes, todos, backlink };
}

/**
 * 저장 문자열을 폭으로 되돌린다. 손상/누락/범위 밖 값은 전부 기본값으로 대체한다(fail-safe).
 * 저장된 설정이 깨졌다고 앱이 못 뜨면 안 된다.
 */
export function parseStoredPanelWidths(raw: string | null): PanelWidths {
  if (!raw) return DEFAULT_PANEL_WIDTHS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PANEL_WIDTHS;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_PANEL_WIDTHS;

  const source = parsed as Record<string, unknown>;
  const pick = (key: ResizablePanel): number => {
    const value = source[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return DEFAULT_PANEL_WIDTHS[key];
    }
    return clampPanelWidth(value);
  };

  // 2026-08-18 이전에 저장된 `sidebar` 키는 더 이상 쓰지 않는다. 없는 키는 기본값이 된다.
  return {
    folder: pick("folder"),
    notes: pick("notes"),
    todos: pick("todos"),
    backlink: pick("backlink"),
  };
}

/** 저장 문자열로 만든다(저장 전에 절대 한계로 한 번 자른다). */
export function serializePanelWidths(widths: PanelWidths): string {
  return JSON.stringify({
    folder: clampPanelWidth(widths.folder),
    notes: clampPanelWidth(widths.notes),
    todos: clampPanelWidth(widths.todos),
    backlink: clampPanelWidth(widths.backlink),
  });
}

/**
 * 드래그 중 새 폭 계산. 왼쪽 패널은 오른쪽으로 끌면 넓어지고, 오른쪽 패널은 반대다.
 * clamp는 호출부가 창 크기를 알고 있을 때 한 번 더 적용한다.
 */
export function widthFromDrag(
  panel: ResizablePanel,
  startWidth: number,
  deltaX: number,
): number {
  // 왼쪽에 있는 패널(폴더/노트)은 오른쪽으로 끌면 넓어지고, 오른쪽 패널(백링크)은 반대다.
  const direction = panel === "backlink" ? -1 : 1;
  return startWidth + deltaX * direction;
}

/** 키보드 조작 단위(px). Shift를 누르면 큰 단위로 움직인다. */
export const KEYBOARD_STEP = 16;
export const KEYBOARD_STEP_LARGE = 64;
