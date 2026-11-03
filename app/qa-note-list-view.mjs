/**
 * qa-note-list-view.mjs — 목록 종류 필터/정렬 순수 규칙 검증 (2026-08-18 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/노트-투두-통합-목록.md
 *
 * 핵심 계약
 * - 정렬은 입력 배열을 건드리지 않는다.
 * - **시각이 같으면 제목으로 2차 정렬한다.** 실사용 볼트는 수정시각이 뭉쳐 있어
 *   (2026-08-13에 186개) 2차 기준이 없으면 목록 순서가 흔들린다.
 * - 목록 전체가 가진 공통 태그는 숨긴다(정보량 0).
 *
 * 실행: node --experimental-strip-types qa-note-list-view.mjs
 */

import {
  DEFAULT_NOTE_LIST_VIEW,
  NOTE_LIST_VIEW_STORAGE_KEY,
  applyNoteListView,
  buildNoteListSections,
  filterNotesByKind,
  findCommonTags,
  isDrawingItem,
  isFavoriteItem,
  isTodoItem,
  isImportedTodo,
  parseStoredListView,
  serializeListView,
  sortNotesBy,
  visibleTags,
} from "./src/lib/note-list-view.ts";

let failures = 0;
let assertions = 0;
function check(label, condition) {
  assertions += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  if (!condition) failures += 1;
}

const item = (title, { type, updated = 0, created = 0, tags, favorite, priority, done } = {}) => ({
  id: title,
  fileBasename: title,
  title,
  folder: "",
  filePath: `${title}.md`,
  createdAt: new Date(created),
  updatedAt: new Date(updated),
  ...(type ? { type } : {}),
  ...(tags ? { tags } : {}),
  ...(favorite !== undefined ? { favorite } : {}),
  ...(priority !== undefined ? { priority } : {}),
  ...(done !== undefined ? { done } : {}),
});

// ── 1. 종류 판정/필터 ────────────────────────────────────────────────────
{
  const notes = [
    item("회의록"),
    item("세금계산서", { type: "todo" }),
    item("메모"),
    item("멘토 연락", { type: "todo" }),
  ];
  check("type: todo만 투두로 본다", isTodoItem(notes[1]) && !isTodoItem(notes[0]));
  // "전체" 필터는 2026-08-30 제거됐다. 노트 필터만 전체를 대신하는지 확인한다.
  check("노트 필터는 투두를 뺀다", filterNotesByKind(notes, "note").length === 2);
  check("투두 필터는 투두만 준다", filterNotesByKind(notes, "todo").length === 2);
  check("필터는 새 배열을 준다(원본 공유 없음)", filterNotesByKind(notes, "note") !== notes);
}

// ── 2. 정렬 — 동률 2차 기준이 이번 수정의 핵심 ───────────────────────────
{
  // 실볼트 재현: 수정시각이 전부 같은 묶음
  const sameTime = [
    item("다항목", { updated: 1000 }),
    item("가항목", { updated: 1000 }),
    item("나항목", { updated: 1000 }),
  ];
  const sorted = sortNotesBy(sameTime, "updated");
  check("수정시각이 같으면 제목순으로 안정 정렬된다",
    sorted.map((n) => n.title).join(",") === "가항목,나항목,다항목");

  // 두 번 정렬해도 같은 결과(순서가 흔들리지 않는다)
  const again = sortNotesBy(sortNotesBy(sameTime, "updated"), "updated");
  check("여러 번 정렬해도 순서가 그대로다",
    again.map((n) => n.title).join(",") === sorted.map((n) => n.title).join(","));
}
{
  const notes = [
    item("오래된", { updated: 100, created: 900 }),
    item("최신", { updated: 900, created: 100 }),
    item("중간", { updated: 500, created: 500 }),
  ];
  check("수정일 정렬은 최신이 위",
    sortNotesBy(notes, "updated").map((n) => n.title).join(",") === "최신,중간,오래된");
  check("생성일 정렬은 기준이 다르다",
    sortNotesBy(notes, "created").map((n) => n.title).join(",") === "오래된,중간,최신");
  check("제목 정렬은 가나다순",
    sortNotesBy(notes, "title").map((n) => n.title).join(",") === "오래된,중간,최신"
    || sortNotesBy(notes, "title").map((n) => n.title)[0] === "오래된");
}
{
  const notes = [item("나", { updated: 200 }), item("가", { updated: 100 })];
  const before = notes.map((n) => n.title).join(",");
  sortNotesBy(notes, "updated");
  check("정렬이 원본 배열을 건드리지 않는다", notes.map((n) => n.title).join(",") === before);
}
{
  // 날짜가 없는 노트(스캔 실패 fallback)도 죽지 않아야 한다
  const broken = [{ id: "x", fileBasename: "x", title: "깨진", folder: "", filePath: "x.md" }];
  check("날짜가 없어도 정렬이 터지지 않는다", sortNotesBy(broken, "updated").length === 1);
}

// ── 3. 필터+정렬 결합 ────────────────────────────────────────────────────
{
  const notes = [
    item("노트B", { updated: 100 }),
    item("투두A", { type: "todo", updated: 300 }),
    item("노트A", { updated: 200 }),
  ];
  const result = applyNoteListView(notes, { kind: "note", sort: "updated", hideDone: true });
  check("필터와 정렬이 함께 적용된다",
    result.map((n) => n.title).join(",") === "노트A,노트B");
}

// ── 4. 공통 태그 숨김 (투두 태그 과다 해결) ──────────────────────────────
{
  // 실볼트 재현: 모든 TickTick 이관 투두가 같은 태그 2개를 갖는다
  const todos = [
    item("A", { type: "todo", tags: ["ticktick-import", "ticktick-inbox"] }),
    item("B", { type: "todo", tags: ["ticktick-import", "ticktick-inbox"] }),
    item("C", { type: "todo", tags: ["ticktick-import", "ticktick-inbox", "manual-review"] }),
  ];
  const common = findCommonTags(todos);
  check("모두가 가진 태그 2개를 공통으로 찾는다",
    common.has("ticktick-import") && common.has("ticktick-inbox") && common.size === 2);
  check("일부만 가진 태그는 공통이 아니다", !common.has("manual-review"));
  check("공통 태그를 뺀 표시 태그는 비어 있다", visibleTags(todos[0], common).length === 0);
  check("구분되는 태그는 남는다",
    JSON.stringify(visibleTags(todos[2], common)) === JSON.stringify(["manual-review"]));
}
{
  const mixed = [
    item("A", { tags: ["업무"] }),
    item("B", { tags: ["개인"] }),
  ];
  check("공통이 없으면 아무것도 숨기지 않는다", findCommonTags(mixed).size === 0);
}
{
  const single = [item("A", { tags: ["업무"] })];
  check("항목이 1개면 숨기지 않는다(비교 대상 없음)", findCommonTags(single).size === 0);
}
{
  // 실볼트 재현: 태그 없는 옵시디언 노트 + 공통 태그를 가진 TickTick 투두가 섞인 목록.
  // 태그 없는 항목 때문에 규칙이 꺼지면 "전체" 보기에서 영영 숨겨지지 않는다.
  const mixedVault = [
    item("옵시디언 노트1"),
    item("옵시디언 노트2"),
    item("투두A", { type: "todo", tags: ["ticktick-import", "ticktick-inbox"] }),
    item("투두B", { type: "todo", tags: ["ticktick-import", "ticktick-inbox"] }),
  ];
  const common = findCommonTags(mixedVault);
  check("태그 없는 노트가 섞여도 태그끼리의 공통은 찾는다",
    common.has("ticktick-import") && common.has("ticktick-inbox"));
  check("태그 없는 노트는 표시 태그가 비어 있다",
    visibleTags(mixedVault[0], common).length === 0);
}
{
  const onlyOneTagged = [item("A", { tags: ["업무"] }), item("B"), item("C")];
  check("태그를 가진 항목이 하나뿐이면 숨기지 않는다", findCommonTags(onlyOneTagged).size === 0);
}

// ── 5. 저장값 fail-safe ──────────────────────────────────────────────────
check("저장 키는 화면 설정 키다", NOTE_LIST_VIEW_STORAGE_KEY === "ticksidian-note-list-view");
check("기본 보기는 기록 + 수정일 + 완료 숨김(2026-09-08 승인)",
  DEFAULT_NOTE_LIST_VIEW.kind === "record" && DEFAULT_NOTE_LIST_VIEW.sort === "updated" && DEFAULT_NOTE_LIST_VIEW.hideDone === true);
check("저장값 없으면 기본값", parseStoredListView(null).kind === "record" && parseStoredListView(null).hideDone === true);
check("깨진 JSON은 기본값", parseStoredListView("{kind:").sort === "updated");
check("객체가 아니면 기본값", parseStoredListView('"todo"').kind === "record");
check("옛 노트 보기만 기록 보기로 바꾸며 정렬은 보존", parseStoredListView('{"kind":"note","sort":"title"}').kind === "record" && parseStoredListView('{"kind":"note","sort":"title"}').sort === "title");
{
  const parsed = parseStoredListView('{"kind":"todo","sort":"title"}');
  check("정상 저장값 복원", parsed.kind === "todo" && parsed.sort === "title");
  // 옛 저장값에는 hideDone이 없다 — 기본(true)으로 복원된다.
  check("옛 저장값( hideDone 없음)은 완료 숨김 기본값", parsed.hideDone === true);
}
{
  const parsed = parseStoredListView('{"kind":"이상한값","sort":"없는키"}');
  check("모르는 값은 항목별로 기본값", parsed.kind === "record" && parsed.sort === "updated");
}
{
  const restored = parseStoredListView(serializeListView({ kind: "todo", sort: "created", hideDone: false }));
  check("직렬화 round-trip", restored.kind === "todo" && restored.sort === "created" && restored.hideDone === false);
}

// ── 그림 필터 (2026-08-23 TICK-DRAW-001) ─────────────────────────────────────
{
  const eqIds = (list, ids) => JSON.stringify(list.map((n) => n.id)) === JSON.stringify(ids);
  const items = [
    { id: "n1", title: "노트", fileBasename: "n1", folder: "", createdAt: new Date(1), updatedAt: new Date(1) },
    { id: "t1", title: "투두", fileBasename: "t1", folder: "", type: "todo", createdAt: new Date(2), updatedAt: new Date(2) },
    { id: "d1.excalidraw", title: "그림", fileBasename: "d1.excalidraw", folder: "", drawing: true, createdAt: new Date(3), updatedAt: new Date(3) },
  ];
  check("isDrawingItem: drawing 플래그로 판정", isDrawingItem(items[2]) && !isDrawingItem(items[0]));
  check("필터 drawing: 그림만", eqIds(filterNotesByKind(items, "drawing"), ["d1.excalidraw"]));
  check("필터 note: 투두도 그림도 아닌 것만", eqIds(filterNotesByKind(items, "note"), ["n1"]));
  check("필터 todo: 투두만", eqIds(filterNotesByKind(items, "todo"), ["t1"]));
  // "all" 제거 후: note+todo+drawing을 각각 세면 3종 전부다.
  check("종류 필터 3개가 전부를 커버한다",
    filterNotesByKind(items, "note").length
      + filterNotesByKind(items, "todo").length
      + filterNotesByKind(items, "drawing").length === 3);
}

{
  const direct = item('직접 할 일', { type: 'todo' });
  const imported = { ...item('가져온 할 일', { type: 'todo' }), externalSource: 'ticktick' };
  check('출처가 있는 할 일만 접는 대상으로 분류', isImportedTodo(imported) && !isImportedTodo(direct));
  const visible = applyNoteListView([item('메모'), direct, imported, { ...direct, id: '완료', done: true }, { ...item('그림'), drawing: true }], DEFAULT_NOTE_LIST_VIEW);
  check('기록 보기는 메모만 포함하고 직접/가져온 할 일과 그림은 제외', visible.length === 1 && visible[0].title === '메모');
}
// ── 6. 즐겨찾기 고정 섹션 + 우선순위 그룹 (2026-09-19 TICK-UX-013/014) ────
// 설계: docs/waterfall/03-상세설계/즐겨찾기와-우선순위-시각화.md
// Apple Notes처럼 즐겨찾기는 맨 위 고정 섹션이고, 고정된 항목은 아래에 다시 나오지 않는다.
{
  const notes = [
    item("보통 기록", { updated: 300 }),
    item("별표 기록", { updated: 100, favorite: true }),
  ];
  const sections = buildNoteListSections(notes, DEFAULT_NOTE_LIST_VIEW);
  check("즐겨찾기는 맨 위 고정 섹션", sections[0].key === "pinned" && sections[0].label === "즐겨찾기");
  check("고정 섹션은 접을 수 있다", sections[0].collapsible === true);
  check("고정 항목은 아래 목록에 다시 나오지 않는다",
    sections[1].items.map((n) => n.title).join(",") === "보통 기록");
  check("섹션 합계가 화면 개수와 같다",
    sections.reduce((sum, section) => sum + section.items.length, 0) === 2);
  check("고정 섹션 안에서도 기존 정렬을 쓴다", sections[0].items.length === 1);
}
{
  const sections = buildNoteListSections([item("별표만", { favorite: true })], DEFAULT_NOTE_LIST_VIEW);
  check("남는 항목이 없으면 일반 섹션을 만들지 않는다",
    sections.length === 1 && sections[0].key === "pinned");
}
{
  const sections = buildNoteListSections([item("메모만")], DEFAULT_NOTE_LIST_VIEW);
  check("즐겨찾기가 없으면 고정 섹션이 없다",
    sections.length === 1 && sections[0].key === "rest" && sections[0].label === null);
  check("기록 목록에는 우선순위 그룹을 만들지 않는다", sections[0].key === "rest");
}
{
  const notes = [
    item("긴급 할일", { type: "todo", priority: "긴급" }),
    item("없음 할일", { type: "todo" }),
    item("중간 할일", { type: "todo", priority: "중간" }),
    item("중간2 할일", { type: "todo", priority: "중간" }),
  ];
  const sections = buildNoteListSections(notes, { ...DEFAULT_NOTE_LIST_VIEW, kind: "todo" });
  check("할 일은 우선순위 그룹 헤더로 나뉜다",
    sections.map((s) => s.label).join("|") === "긴급|중간|우선순위 없음");
  check("그룹 key는 priority: 접두", sections[0].key === "priority:긴급");
  check("같은 단계는 한 그룹", sections[1].items.length === 2);
  check("빈 그룹은 그리지 않는다", sections.length === 3);
}
{
  const notes = [
    item("별표 할일", { type: "todo", priority: "긴급", favorite: true }),
    item("일반 할일", { type: "todo", priority: "긴급" }),
  ];
  const sections = buildNoteListSections(notes, { ...DEFAULT_NOTE_LIST_VIEW, kind: "todo" });
  check("할 일에서도 고정 섹션이 먼저다", sections[0].key === "pinned");
  check("고정된 할 일은 우선순위 그룹에서 빠진다",
    sections[1].items.length === 1 && sections[1].items[0].title === "일반 할일");
}
{
  check("favorite는 true만 참으로 본다",
    isFavoriteItem(item("a", { favorite: true }))
    && !isFavoriteItem(item("b", { favorite: false }))
    && !isFavoriteItem(item("c")));
}
{
  const legacy = parseStoredListView(JSON.stringify({ kind: "todo", sort: "title", hideDone: false }));
  check("옛 저장값은 고정 섹션을 펼친 상태로 읽는다", legacy.pinnedCollapsed === false);
  const restored = parseStoredListView(serializeListView({ ...DEFAULT_NOTE_LIST_VIEW, pinnedCollapsed: true }));
  check("접힘 상태가 저장·복원된다", restored.pinnedCollapsed === true);
  check("모르는 저장값은 기본으로 되돌린다",
    parseStoredListView("{").pinnedCollapsed === DEFAULT_NOTE_LIST_VIEW.pinnedCollapsed);
}

console.log(`\n${assertions} assertions, ${failures} failures`);
if (failures > 0) process.exit(1);
