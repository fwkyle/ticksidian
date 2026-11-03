/**
 * qa-note-info.mjs — 노트 정보 바 순수 규칙 QA (2026-08-18 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/노트-정보-바.md
 * Why: [kyle]이 목록의 태그를 폴더명으로 오해했다. `#` 접두와 위치 표기 규칙을 잠근다.
 */

import {
  EMPTY_VALUE,
  ROOT_FOLDER_LABEL,
  addTags,
  buildNoteInfo,
  folderBreadcrumb,
  formatTag,
  parseTagInput,
  removeTag,
} from "./src/lib/note-info.ts";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// QA는 고정 포맷을 주입해 로케일/시간대에 흔들리지 않게 한다.
const fmt = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "");
const at = (iso) => new Date(iso);

const note = (over = {}) => ({
  id: "n1",
  fileBasename: "n1",
  title: "샘플",
  createdAt: at("2026-08-13T01:00:00Z"),
  updatedAt: at("2026-08-14T01:00:00Z"),
  folder: "",
  ...over,
});

const rowOf = (info, label) => info.details.find((d) => d.label === label)?.value;
const keyOf = (info, key) => info.details.find((d) => d.key === key)?.value;

/* ── formatTag ── */
check("태그에 # 을 붙인다", formatTag("ticktick-inbox") === "#ticktick-inbox");
check("이미 # 이 있으면 중복해서 붙이지 않는다", formatTag("#업무") === "#업무");
check("앞뒤 공백을 다듬는다", formatTag("  회의  ") === "#회의");
check("빈 태그는 빈 문자열", formatTag("   ") === "");

/* ── folderBreadcrumb ── */
check("폴더를 조각으로 쪼갠다", JSON.stringify(folderBreadcrumb("notes/ticktick-import")) === '["notes","ticktick-import"]');
check("루트는 빈 배열", folderBreadcrumb("").length === 0);
check("빈 segment 를 버린다", JSON.stringify(folderBreadcrumb("/a//b/")) === '["a","b"]');

/* ── 종류 판정 ── */
{
  const plain = buildNoteInfo(note(), fmt);
  check("일반 노트는 isTodo=false", plain.isTodo === false);
  check("일반 노트 라벨은 '노트'", plain.kindLabel === "노트");
  check("일반 노트 종류 행", rowOf(plain, "종류") === "노트");
  check("일반 노트에는 기한 행이 없다", rowOf(plain, "기한") === undefined);
}
{
  const todo = buildNoteInfo(note({ type: "todo" }), fmt);
  check("미완료 투두 라벨", todo.kindLabel === "투두");
  check("미완료 투두 종류 행", rowOf(todo, "종류") === "투두 (미완료)");
  const doneTodo = buildNoteInfo(note({ type: "todo", done: true }), fmt);
  check("완료 투두 라벨", doneTodo.kindLabel === "완료");
  check("완료 투두 종류 행", rowOf(doneTodo, "종류") === "투두 (완료)");
}

/* ── detail key (2026-08-18 검수 후속 P3 — 라벨이 아닌 안정 key 매칭) ── */
{
  const plain = buildNoteInfo(note(), fmt);
  const todo = buildNoteInfo(note({ type: "todo", dueDate: "2026-08-20" }), fmt);
  check(
    "모든 detail 은 key 를 가진다",
    plain.details.every((d) => typeof d.key === "string") &&
      todo.details.every((d) => typeof d.key === "string"),
  );
  check(
    "detail key 는 고유하다",
    new Set(todo.details.map((d) => d.key)).size === todo.details.length,
  );
  check("투두 기한 행은 dueDate key 로 잡는다", keyOf(todo, "dueDate") === "2026-08-20");
  check("일반 노트에는 dueDate key 행이 없다", keyOf(plain, "dueDate") === undefined);
}

/* ── 위치 ── */
{
  const root = buildNoteInfo(note(), fmt);
  check("루트 폴더 라벨", root.folderLabel === ROOT_FOLDER_LABEL, root.folderLabel);
  check("루트 위치 행도 라벨을 쓴다", rowOf(root, "위치") === ROOT_FOLDER_LABEL);
  check("루트 빵부스러기는 비어 있다", root.folderSegments.length === 0);

  const nested = buildNoteInfo(note({ folder: "notes/ticktick-import" }), fmt);
  check("중첩 폴더 라벨은 ' / ' 로 잇는다", nested.folderLabel === "notes / ticktick-import", nested.folderLabel);
  check("중첩 위치 행은 원본 경로", rowOf(nested, "위치") === "notes/ticktick-import");
  const inbox = buildNoteInfo(note({ folder: "inbox" }), fmt);
  check("기본함 표시 이름", inbox.folderLabel === "기본함");
  check("기본함 실제 경로 보존", inbox.folderPath === "inbox" && rowOf(inbox, "파일") === "inbox/n1.md");
  check("기본함 하위 표시", buildNoteInfo(note({ folder: "inbox/업무" }), fmt).folderLabel === "기본함 / 업무");
  check("다른 폴더 안 inbox 이름 보존", buildNoteInfo(note({ folder: "notes/inbox" }), fmt).folderLabel === "notes / inbox");
}

/* ── 파일 경로 ── */
{
  const withPath = buildNoteInfo(note({ filePath: "notes/a/x.md", folder: "notes/a" }), fmt);
  check("filePath 가 있으면 그대로 쓴다", rowOf(withPath, "파일") === "notes/a/x.md");

  const noPath = buildNoteInfo(note({ folder: "notes/a", fileBasename: "x" }), fmt);
  check("filePath 가 없으면 폴더+파일명으로 만든다", rowOf(noPath, "파일") === "notes/a/x.md", rowOf(noPath, "파일"));

  const rootFile = buildNoteInfo(note({ fileBasename: "x" }), fmt);
  check("루트 파일은 앞에 / 를 붙이지 않는다", rowOf(rootFile, "파일") === "x.md", rowOf(rootFile, "파일"));
}

/* ── 태그 / 별칭 ── */
{
  const tagged = buildNoteInfo(note({ tags: ["ticktick-import", "#업무", "  "] }), fmt);
  check("표시 태그에 # 이 붙는다", JSON.stringify(tagged.tags) === '["#ticktick-import","#업무"]', JSON.stringify(tagged.tags));
  check("빈 태그는 걸러진다", tagged.tags.length === 2);
  check("태그 행", rowOf(tagged, "태그") === "#ticktick-import #업무");

  const bare = buildNoteInfo(note(), fmt);
  check("태그가 없으면 '없음'", rowOf(bare, "태그") === EMPTY_VALUE);
  check("별칭이 없으면 '없음'", rowOf(bare, "별칭") === EMPTY_VALUE);

  const aliased = buildNoteInfo(note({ aliases: ["옛 제목", " "] }), fmt);
  check("빈 별칭은 걸러진다", rowOf(aliased, "별칭") === "옛 제목");
}

/* ── 날짜 ── */
{
  const info = buildNoteInfo(note(), fmt);
  check("생성 행은 주입한 포맷을 쓴다", rowOf(info, "생성") === "2026-08-13", rowOf(info, "생성"));
  check("수정 행은 주입한 포맷을 쓴다", rowOf(info, "수정") === "2026-08-14");

  const broken = buildNoteInfo(note({ createdAt: new Date(Number.NaN) }), fmt);
  check("깨진 날짜는 '없음'", rowOf(broken, "생성") === EMPTY_VALUE);
}

/* ── 행 순서: 종류가 항상 맨 앞, 투두 전용 행은 그 다음 ── */
{
  const todo = buildNoteInfo(note({ type: "todo", dueDate: "2026-09-01", priority: "높음" }), fmt);
  const labels = todo.details.map((d) => d.label);
  check("행 순서가 고정이다", JSON.stringify(labels) === '["종류","기한","우선순위","위치","파일","태그","별칭","생성","수정"]', JSON.stringify(labels));
  check("기한 값", rowOf(todo, "기한") === "2026-09-01");
  check("우선순위 값", rowOf(todo, "우선순위") === "높음");

  const noDue = buildNoteInfo(note({ type: "todo" }), fmt);
  check("기한 없는 투두도 행은 남고 '없음'", rowOf(noDue, "기한") === EMPTY_VALUE);
}

// ── 태그 편집 순수 규칙 (2026-08-23 TICK-UX-007) ─────────────────────────────
{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check("parseTagInput: 쉼표·공백으로 나누고 앞 #을 뗀다", eq(parseTagInput("#업무, 개인  #프로젝트"), ["업무", "개인", "프로젝트"]));
  check("parseTagInput: 빈 조각·#만 있는 조각은 버린다", eq(parseTagInput(" , # ,, "), []));
  check("parseTagInput: 앞뒤 공백 제거", eq(parseTagInput("  회의  "), ["회의"]));
  check("addTags: 기존 순서를 유지하고 새 것만 뒤에 붙인다", eq(addTags(["a", "b"], "c a"), ["a", "b", "c"]));
  check("addTags: 대소문자만 다른 중복은 추가하지 않는다", eq(addTags(["Work"], "work WORK 개인"), ["Work", "개인"]));
  check("addTags: 입력이 비면 원본 그대로", eq(addTags(["a"], "  "), ["a"]));
  check("addTags: 입력에 #이 붙어 있어도 저장값엔 #이 없다", eq(addTags([], "#x"), ["x"]));
  check("removeTag: 지정 태그만 뺀다(#표시값으로 불러도 된다)", eq(removeTag(["a", "b", "c"], "#b"), ["a", "c"]));
  check("removeTag: 없는 태그를 빼면 원본 그대로", eq(removeTag(["a"], "z"), ["a"]));
}

console.log(`\n${failures === 0 ? "모든 검사 통과" : `${failures}건 실패`}`);
process.exit(failures === 0 ? 0 : 1);
