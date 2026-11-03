/**
 * qa-folder-tree.mjs — 폴더 선택/노트 필터 순수 규칙 검증 (2026-08-18).
 *
 * 설계: docs/waterfall/03-상세설계/사이드바-3열-레이아웃.md
 *
 * 핵심 계약
 * - 폴더를 고르면 하위 폴더 노트까지 함께 보인다(옵시디언 깊은 구조 대응).
 * - 경로는 **세그먼트 단위**로 비교한다. `lectures-old`는 `lectures`의 하위가 아니다.
 * - 없는 폴더가 선택된 채로 남지 않는다(볼트 전환/폴더 삭제).
 *
 * 실행: node --experimental-strip-types qa-folder-tree.mjs
 */

import {
  ALL_NOTES_LABEL,
  countNotesByFolder,
  folderDisplayName,
  isWithinFolder,
  resolveFolderSelection,
  selectNotesForFolder,
} from "./src/lib/folder-tree.ts";

let failures = 0;
let assertions = 0;

function check(label, condition) {
  assertions += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}`);
  }
}

const note = (id, folder) => ({
  id,
  fileBasename: id,
  title: id,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  folder,
  filePath: folder ? `${folder}/${id}.md` : `${id}.md`,
});

// 실사용 볼트 구조를 본뜬 표본
const NOTES = [
  note("루트메모", ""),
  note("강의1", "lectures"),
  note("OS강의", "lectures/OS"),
  note("OS원문", "lectures/OS/source/text"),
  note("옛강의", "lectures-old"),
  note("틱틱1", "notes/ticktick-import"),
  note("틱틱2", "notes/ticktick-import"),
  note("인박스", "inbox"),
];

// ── 1. 경로 경계 — 이 규칙이 틀리면 엉뚱한 폴더 노트가 섞인다 ──────────────
check("자기 자신은 포함", isWithinFolder("lectures", "lectures"));
check("하위 폴더는 포함", isWithinFolder("lectures/OS", "lectures"));
check("깊은 하위도 포함", isWithinFolder("lectures/OS/source/text", "lectures"));
check("이름이 겹치는 다른 폴더는 제외", !isWithinFolder("lectures-old", "lectures"));
check("접두만 같은 폴더도 제외", !isWithinFolder("lecturesX", "lectures"));
check("상위 폴더는 하위 선택에 포함되지 않는다", !isWithinFolder("lectures", "lectures/OS"));
check("전혀 다른 폴더는 제외", !isWithinFolder("inbox", "lectures"));
check("전체 선택(null)은 모두 포함", isWithinFolder("아무거나", null));
check("빈 문자열 선택도 전체로 본다", isWithinFolder("아무거나", ""));
check("루트 노트(폴더 없음)는 전체에만 포함", isWithinFolder("", null) && !isWithinFolder("", "lectures"));

// ── 2. 폴더별 노트 선택 ──────────────────────────────────────────────────
{
  const all = selectNotesForFolder(NOTES, null);
  check("전체 선택은 루트 노트까지 전부 준다", all.length === NOTES.length);
  check("전체 선택은 원본 배열을 복사한다(참조 공유 없음)", all !== NOTES);
}
{
  const lectures = selectNotesForFolder(NOTES, "lectures");
  const ids = lectures.map((n) => n.id).sort();
  check("lectures 선택은 하위 3개를 준다",
    JSON.stringify(ids) === JSON.stringify(["OS강의", "OS원문", "강의1"].sort()));
  check("lectures 선택에 lectures-old는 없다", !ids.includes("옛강의"));
}
{
  const deep = selectNotesForFolder(NOTES, "lectures/OS");
  check("깊은 폴더 선택은 그 아래만 준다", deep.length === 2);
}
{
  const ticktick = selectNotesForFolder(NOTES, "notes/ticktick-import");
  check("중첩 경로 폴더도 정확히 잡는다", ticktick.length === 2);
}
{
  const none = selectNotesForFolder(NOTES, "없는폴더");
  check("없는 폴더는 빈 목록", none.length === 0);
}

// ── 3. 폴더별 개수 집계 (조상 폴더까지 누적) ──────────────────────────────
{
  const counts = countNotesByFolder(NOTES);
  check("lectures는 하위 포함 3개", counts.get("lectures") === 3);
  check("lectures/OS는 2개", counts.get("lectures/OS") === 2);
  check("lectures/OS/source는 1개(중간 경로도 집계)", counts.get("lectures/OS/source") === 1);
  check("lectures-old는 따로 1개", counts.get("lectures-old") === 1);
  check("notes는 하위 ticktick-import 2개를 물려받는다", counts.get("notes") === 2);
  check("notes/ticktick-import는 2개", counts.get("notes/ticktick-import") === 2);
  check("inbox는 1개", counts.get("inbox") === 1);
  check("루트 노트는 폴더 집계에 없다", !counts.has(""));
}

// ── 4. 표시 이름 ─────────────────────────────────────────────────────────
check("전체 선택 라벨", folderDisplayName(null) === ALL_NOTES_LABEL);
check("빈 선택도 전체 라벨", folderDisplayName("") === ALL_NOTES_LABEL);
check("기본함 표시만 바꾸고 inbox 경로는 유지", folderDisplayName("inbox") === "기본함");
check("다른 한 단계 폴더는 그대로", folderDisplayName("notes") === "notes");
check("폴더가 없는 기본함도 선택 유지", resolveFolderSelection("inbox", []) === "inbox");
check("기본함 하위 표시 이름은 유지", folderDisplayName("inbox/보류") === "보류");
check("깊은 폴더는 마지막 이름만", folderDisplayName("lectures/OS/source") === "source");

// ── 5. 없는 폴더 선택 복구 (볼트 전환/폴더 삭제) ──────────────────────────
{
  const known = ["lectures", "lectures/OS", "inbox"];
  check("있는 폴더는 유지", resolveFolderSelection("lectures/OS", known) === "lectures/OS");
  check("없는 폴더는 전체로 되돌린다", resolveFolderSelection("사라진폴더", known) === null);
  check("전체는 그대로 전체", resolveFolderSelection(null, known) === null);
  check("빈 문자열도 전체로 정규화", resolveFolderSelection("", known) === null);
}

console.log(`\n${assertions} assertions, ${failures} failures`);
if (failures > 0) process.exit(1);
