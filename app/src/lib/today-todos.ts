/**
 * today-todos.ts — `오늘 할 일` 보기의 날짜 그룹 (2026-10-22).
 *
 * 설계: docs/waterfall/03-상세설계/시작-화면-선택.md "`오늘 할 일` 보기"
 * Node QA: app/qa-start-screen.mjs
 *
 * 대상은 미완료 할 일이다(그림·플러그인 그림 제외). 그룹은 기한 지남 → 오늘 → 날짜 없음이며 앞날 기한은 뺀다.
 * 그룹 안에서는 우선순위 순서, 같은 우선순위에서는 사용자가 고른 정렬을 따른다.
 */

import type { NoteListItem } from "../types/note";
import {
  isTodoItem,
  sortNotesBy,
  type NoteListSection,
  type NoteSortKey,
} from "./note-list-view.ts";
import { classifyDue, type DueState } from "./local-date.ts";
import { priorityRank } from "./priority.ts";

type TodayGroupState = Exclude<DueState, "upcoming">;

const GROUPS: readonly { state: TodayGroupState; label: string }[] = [
  { state: "overdue", label: "기한 지남" },
  { state: "today", label: "오늘" },
  { state: "none", label: "날짜 없음" },
];

export function buildTodaySections(
  notes: readonly NoteListItem[],
  sort: NoteSortKey,
  todayKey: string,
): NoteListSection[] {
  // 그림(`*.excalidraw`)과 플러그인 그림(`*.excalidraw.md`)은 `.md` 할 일이 아니다. 플러그인 그림은
  // 머리말에 type: todo가 있을 수 있어 완료 체크가 원본에 쓰이므로 항상 뺀다(검수 SSR-002).
  const open = notes.filter(
    (note) => isTodoItem(note) && note.done !== true && !note.drawing && !note.excalidrawPlugin,
  );
  const sorted = sortNotesBy(open, sort);
  const sections: NoteListSection[] = [];
  for (const { state, label } of GROUPS) {
    const items = sorted
      .filter((note) => classifyDue(note.dueDate, todayKey) === state)
      // sort는 안정 정렬이라 우선순위가 같으면 위에서 고른 정렬이 유지된다.
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
    if (items.length === 0) continue;
    sections.push({ key: `due:${state}`, label, items, collapsible: false });
  }
  return sections;
}
