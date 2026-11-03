/**
 * note-list-view.ts — 목록 열의 종류 필터와 정렬 순수 규칙 (2026-08-18 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/노트-투두-통합-목록.md
 * Node QA: app/qa-note-list-view.mjs
 *
 * Why: 폴더는 맥락(회사/개인)만 맡고, 그 안에 노트·메모·투두가 섞여 있어도 되게 한다.
 * 좁혀 보는 것은 목록 위 필터가 담당한다([kyle] 결정: "한 화면 + 종류 필터").
 *
 * 정렬에서 가장 중요한 것은 **동률 처리**다. 실사용 볼트는 파일 수정시각이 뭉쳐 있어
 * (2026-08-13에 186개, 2026-03-23에 160개) 시각만으로 정렬하면 사실상 무작위가 되고
 * 기존에는 파일 순서(≈이름순)로 나왔다. 그래서 항상 제목을 2차 기준으로 둔다.
 */

import type { NoteListItem } from "../types/note";
import { groupItemsByPriority } from "./priority.ts";

/** 목록에 무엇을 보여줄지. "전체"는 2026-08-29 [kyle] 결정으로 제거됐다. */
export type NoteKindFilter = "record" | "note" | "todo" | "drawing";

/** 무엇을 기준으로 정렬할지. */
export type NoteSortKey = "updated" | "created" | "title";

export interface NoteListView {
  readonly kind: NoteKindFilter;
  readonly sort: NoteSortKey;
  /**
   * 완료한 투두를 목록에서 숨길지(2026-08-30 TICK-UX-010, [kyle] 승인).
   * 끝난 일이 진짜 할 일을 가리는 문제의 기본 방어. 기본값 true.
   */
  readonly hideDone: boolean;

  /**
   * 즐겨찾기 고정 섹션을 접었는지(2026-09-19 TICK-UX-013).
   *
   * 별표가 많아질 때 목록을 되찾는 수단이다. Apple Notes는 고정 항목을 별도 섹션으로
   * 분리하고, Notion은 섹션을 접을 수 있게 해 같은 문제를 푼다.
   */
  readonly pinnedCollapsed: boolean;
}

/** 기본 보기: 노트만, 최근 수정순, 완료 투두는 숨김. */
export const DEFAULT_NOTE_LIST_VIEW: NoteListView = {
  kind: "record",
  sort: "updated",
  hideDone: true,
  pinnedCollapsed: false,
};

/** 화면 설정이라 볼트가 아니라 localStorage에 둔다. */
export const NOTE_LIST_VIEW_STORAGE_KEY = "ticksidian-note-list-view";

// "전체" 필터 제거 근거(2026-08-29 [kyle] 결정): 볼트 전체 보기에서 투두가 수백 개라
// 목록을 잠식해 노트를 찾을 수 없었다. 범위 좁히기는 폴더 선택이 담당한다.
export const NOTE_KIND_FILTERS: readonly NoteKindFilter[] = ["record", "todo", "drawing"];
export const NOTE_SORT_KEYS: readonly NoteSortKey[] = ["updated", "created", "title"];

/** 화면에 쓰는 한국어 라벨. */
export const NOTE_KIND_LABELS: Readonly<Record<NoteKindFilter, string>> = {
  record: "기록",
  note: "노트",
  todo: "할 일",
  drawing: "그림",
};

export const NOTE_SORT_LABELS: Readonly<Record<NoteSortKey, string>> = {
  updated: "수정일",
  created: "생성일",
  title: "제목",
};

/** 투두인가(파일 frontmatter의 `type: "todo"`). */
export function isTodoItem(note: NoteListItem): boolean {
  return note.type === "todo";
}

/** 그림인가(raw JSON `*.excalidraw`, 2026-08-23 TICK-DRAW-001). */
export function isDrawingItem(note: NoteListItem): boolean {
  return note.drawing === true;
}

/** 이전 가져오기 출처 판정. 목록 종류와 별개로 출처 정보는 보존한다. */
export function isImportedTodo(note: NoteListItem): boolean {
  return isTodoItem(note) && (!!note.externalSource || note.tags?.includes('ticktick-import') === true);
}

/**
 * 즐겨찾기(별표) 항목인가 (2026-09-19 TICK-UX-013).
 *
 * frontmatter `favorite: true`만 참으로 본다(엄격). 없거나 다른 값이면 거짓이다.
 */
export function isFavoriteItem(note: NoteListItem): boolean {
  return note.favorite === true;
}

/** 종류 필터 적용. 항상 새 배열을 돌려준다. */
export function filterNotesByKind(
  notes: readonly NoteListItem[],
  kind: NoteKindFilter,
): NoteListItem[] {
  if (kind === "todo") return notes.filter(isTodoItem);
  if (kind === "drawing") return notes.filter(isDrawingItem);
  // "노트"는 투두도 그림도 아닌 것이다(그림이 새로 생기면서 정의를 좁혔다).
  return notes.filter((note) => !isTodoItem(note) && !isDrawingItem(note));
}

function timeOf(value: Date | undefined): number {
  if (!value) return 0;
  const time = value.getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * 정렬. **입력 배열을 건드리지 않고** 새 배열을 돌려준다.
 * (기존 `sortNotesByUpdatedAt`은 제자리 정렬이라 호출부에 부작용이 있었다.)
 *
 * 시각이 같으면 제목으로 한 번 더 정렬한다. 이 2차 기준이 없으면 수정시각이 뭉친
 * 볼트에서 목록 순서가 매 스캔마다 흔들린다.
 */
export function sortNotesBy(
  notes: readonly NoteListItem[],
  key: NoteSortKey,
): NoteListItem[] {
  const byTitle = (a: NoteListItem, b: NoteListItem) =>
    (a.title || "").localeCompare(b.title || "", "ko");

  return [...notes].sort((a, b) => {
    if (key === "title") return byTitle(a, b);
    const left = key === "created" ? timeOf(a.createdAt) : timeOf(a.updatedAt);
    const right = key === "created" ? timeOf(b.createdAt) : timeOf(b.updatedAt);
    if (left !== right) return right - left; // 최신이 위로
    return byTitle(a, b);
  });
}

/** 목록·폴더 개수·편집 대상 안내가 공유하는 종류/완료 필터. 정렬과 IO는 하지 않는다. */
export function filterNotesByView(
  notes: readonly NoteListItem[],
  view: NoteListView,
): NoteListItem[] {
  const filtered = filterNotesByKind(notes, view.kind);
  return view.hideDone
    ? filtered.filter((note) => !(isTodoItem(note) && note.done === true))
    : filtered;
}

/** 필터 + 정렬을 한 번에. 화면이 쓰는 진입점. */
export function applyNoteListView(
  notes: readonly NoteListItem[],
  view: NoteListView,
): NoteListItem[] {
  return sortNotesBy(filterNotesByView(notes, view), view.sort);
}

export interface NoteListSection {
  /** 섹션 식별자: `pinned` / `priority:<값>` / `rest`. */
  readonly key: string;
  /** 헤더 문구. null이면 헤더를 그리지 않는다(일반 목록). */
  readonly label: string | null;
  readonly items: readonly NoteListItem[];
  /** 헤더를 눌러 접을 수 있는 섹션인가(즐겨찾기 고정 섹션). */
  readonly collapsible: boolean;
}

/**
 * 목록을 화면 섹션으로 나눈다 (2026-09-19 TICK-UX-013/014).
 *
 * Why: 즐겨찾기는 우선순위 그룹과 **같은 장치**로 맨 위 고정 섹션에 모으고, 할 일
 * 목록은 우선순위 단계별 그룹 헤더로 나눈다. 정렬(수정일/생성일/제목)은 각 섹션 안에서
 * 그대로 쓴다 — 섹션은 정렬을 대체하지 않는다.
 *
 * 계약
 * - 고정된 항목은 아래 섹션에 **다시 나오지 않는다**(중복 표시 없음). Apple Notes도
 *   "핀은 노트를 옮기거나 복제하지 않고 목록 맨 위에 둔다"고 설명한다.
 * - 빈 섹션은 만들지 않는다. 즐겨찾기가 없으면 고정 섹션 자체가 없다.
 * - 우선순위 그룹은 할 일 필터에서만 만든다. 기록/그림은 하나의 일반 목록이다.
 */
export function buildNoteListSections(
  notes: readonly NoteListItem[],
  view: NoteListView,
): NoteListSection[] {
  const visible = applyNoteListView(notes, view);
  const pinned = visible.filter(isFavoriteItem);
  const rest = visible.filter((note) => !isFavoriteItem(note));

  const sections: NoteListSection[] = [];
  if (pinned.length > 0) {
    sections.push({ key: "pinned", label: "즐겨찾기", items: pinned, collapsible: true });
  }

  if (view.kind !== "todo") {
    if (rest.length > 0) {
      sections.push({ key: "rest", label: null, items: rest, collapsible: false });
    }
    return sections;
  }

  for (const group of groupItemsByPriority(rest, (note) => note.priority)) {
    sections.push({
      key: `priority:${group.key}`,
      label: group.label,
      items: group.items,
      collapsible: false,
    });
  }
  return sections;
}

/**
 * 목록 전체가 똑같이 가진 태그를 찾는다.
 *
 * Why: TickTick 이관본은 전부 `ticktick-import`, `ticktick-inbox`를 달고 있어서
 * 항목마다 태그 줄이 2~3줄씩 늘어난다. 모두가 가진 태그는 정보량이 0이므로 숨긴다.
 * 일부만 가진 태그(`manual-review` 등)는 실제 구분에 쓰이므로 남긴다.
 *
 * 판정 범위는 **태그를 가진 항목들끼리**다. 태그가 아예 없는 노트(옵시디언 원본 다수)가
 * 섞였다고 해서 규칙이 꺼지면, 전체 보기에서는 영영 숨겨지지 않는다 — 실볼트가 정확히
 * 그 상황이라 2026-08-18 실측에서 "전체"일 때 태그가 그대로 보였다.
 *
 * 태그를 가진 항목이 2개 미만이면 숨기지 않는다(비교 대상이 없으면 "공통"이 의미 없다).
 */
export function findCommonTags(notes: readonly NoteListItem[]): Set<string> {
  const withTags = notes.filter((note) => (note.tags?.length ?? 0) > 0);
  if (withTags.length < 2) return new Set();

  let common: Set<string> | null = null;
  for (const note of withTags) {
    const tags = new Set(note.tags ?? []);
    if (common === null) {
      common = tags;
      continue;
    }
    for (const tag of [...common]) {
      if (!tags.has(tag)) common.delete(tag);
    }
    if (common.size === 0) break;
  }
  return common ?? new Set();
}

/** 공통 태그를 뺀 표시용 태그 목록. */
export function visibleTags(
  note: NoteListItem,
  commonTags: ReadonlySet<string>,
): string[] {
  return (note.tags ?? []).filter((tag) => !commonTags.has(tag));
}

function isKindFilter(value: unknown): value is NoteKindFilter {
  return typeof value === "string" && (NOTE_KIND_FILTERS as readonly string[]).includes(value);
}

function isSortKey(value: unknown): value is NoteSortKey {
  return typeof value === "string" && (NOTE_SORT_KEYS as readonly string[]).includes(value);
}

/** 저장값 복원. 손상/모르는 값은 기본값으로 되돌린다(fail-safe). */
export function parseStoredListView(raw: string | null): NoteListView {
  if (!raw) return DEFAULT_NOTE_LIST_VIEW;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_NOTE_LIST_VIEW;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_NOTE_LIST_VIEW;
  const source = parsed as Record<string, unknown>;
  return {
    kind: isKindFilter(source.kind) ? source.kind : DEFAULT_NOTE_LIST_VIEW.kind,
    sort: isSortKey(source.sort) ? source.sort : DEFAULT_NOTE_LIST_VIEW.sort,
    // 옛 저장값에는 hideDone이 없다 — 기본(숨김)로 시작한다.
    hideDone:
      typeof source.hideDone === "boolean" ? source.hideDone : DEFAULT_NOTE_LIST_VIEW.hideDone,
    // 옛 저장값에는 pinnedCollapsed가 없다 — 펼친 상태로 시작한다.
    pinnedCollapsed:
      typeof source.pinnedCollapsed === "boolean"
        ? source.pinnedCollapsed
        : DEFAULT_NOTE_LIST_VIEW.pinnedCollapsed,
  };
}

export function serializeListView(view: NoteListView): string {
  return JSON.stringify({
    kind: view.kind,
    sort: view.sort,
    hideDone: view.hideDone,
    pinnedCollapsed: view.pinnedCollapsed,
  });
}

/**
 * 목록 행 보조 줄용 짧은 날짜("8월 29일"). NoteItem·TodoRow가 같은 포맷을 쓰게
 * 공통 모듈로 둔다(2026-08-29 A+B 하이브리드).
 */
export function formatListDate(date: Date | undefined): string {
  if (!date || isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

/**
 * 투두 행 보조 줄용 마감일 표기(2026-08-30 TICK-UX-010).
 * dueDate가 없으면 null — 호출부는 updatedAt으로 대체 표시한다.
 * state: overdue(지남) / today(오늘) / upcoming(이후).
 */
export function formatDueLabel(
  dueDate: string | undefined,
): { label: string; state: "overdue" | "today" | "upcoming" } | null {
  if (!dueDate) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(dueDate);
  if (!parts) return null;
  const due = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (isNaN(due.getTime())) return null;
  const today = new Date();
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((due.getTime() - today0.getTime()) / 86_400_000);
  const label = `마감 ${due.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}`;
  if (diffDays < 0) return { label, state: "overdue" };
  if (diffDays === 0) return { label, state: "today" };
  return { label, state: "upcoming" };
}
