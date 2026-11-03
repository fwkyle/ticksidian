// useNoteEditor 사전 보강 검증기
//
// 역할
//   - app/src/hooks/useNoteEditor.helpers.ts의 4개 순수 함수 동작을 Node 레벨로
//     미러링해 큰 분해 전후의 회귀를 잡는 안전망을 만든다.
//   - 원본은 useNoteEditor.helpers.ts. helper 동작이 바뀌면 이 파일도 같이 갱신해야
//     drift가 생기지 않는다. 양쪽 모두 docstring에 동기화 주의를 명시.
//
// 사용법
//   cd app && node qa-note-editor-helpers.mjs
//
// 종료 코드
//   0  — 모든 assertion 통과
//   1  — assertion 1건 이상 실패

let assertions = 0;
let failures = 0;
function check(label, condition, detail) {
  assertions += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// 미러링: useNoteEditor.helpers.ts와 동일한 로직
// ---------------------------------------------------------------------------

function accumulateAliases(prevTitle, nextTitle, existing) {
  if (!prevTitle || prevTitle === nextTitle || prevTitle.trim().length === 0) {
    return existing;
  }
  if (existing.includes(prevTitle)) {
    return existing;
  }
  return [...existing, prevTitle];
}

function normalizeFrontmatterAliases(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((a) => typeof a === "string");
}

function shouldDeferExternalReload(hasLocalChanges, hasPendingTimer) {
  return hasLocalChanges || hasPendingTimer;
}

function noticeForReloadReason(reason) {
  if (reason === "external") {
    return "외부 수정이 감지되어 최신 파일 내용으로 다시 불러왔습니다.";
  }
  if (reason === "manualReload") {
    return "외부 변경 버전으로 다시 불러왔습니다.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// 케이스
// ---------------------------------------------------------------------------

// accumulateAliases (5 케이스)
check(
  "accumulateAliases: prevTitle undefined → existing 그대로",
  JSON.stringify(accumulateAliases(undefined, "B", ["x"])) === JSON.stringify(["x"]),
);
check(
  "accumulateAliases: prevTitle === nextTitle → existing 그대로",
  JSON.stringify(accumulateAliases("A", "A", [])) === JSON.stringify([]),
);
check(
  "accumulateAliases: prevTitle 공백만 → existing 그대로",
  JSON.stringify(accumulateAliases("   ", "B", ["x"])) === JSON.stringify(["x"]),
);
check(
  "accumulateAliases: 이미 포함된 prevTitle → existing 그대로",
  JSON.stringify(accumulateAliases("A", "B", ["A"])) === JSON.stringify(["A"]),
);
check(
  "accumulateAliases: 새 prevTitle → 끝에 push",
  JSON.stringify(accumulateAliases("A", "B", ["X"])) === JSON.stringify(["X", "A"]),
);

// normalizeFrontmatterAliases (4 케이스)
check(
  "normalizeFrontmatterAliases: undefined → []",
  JSON.stringify(normalizeFrontmatterAliases(undefined)) === JSON.stringify([]),
);
check(
  "normalizeFrontmatterAliases: 비-array(string) → []",
  JSON.stringify(normalizeFrontmatterAliases("not-array")) === JSON.stringify([]),
);
check(
  "normalizeFrontmatterAliases: array of mixed types → string만",
  JSON.stringify(normalizeFrontmatterAliases(["a", 1, null, "b", undefined, true])) ===
    JSON.stringify(["a", "b"]),
);
check(
  "normalizeFrontmatterAliases: 모두 string → 그대로",
  JSON.stringify(normalizeFrontmatterAliases(["a", "b", "c"])) ===
    JSON.stringify(["a", "b", "c"]),
);

// shouldDeferExternalReload (4 케이스)
check(
  "shouldDeferExternalReload(false, false) → false (즉시 로드 가능)",
  shouldDeferExternalReload(false, false) === false,
);
check(
  "shouldDeferExternalReload(true, false) → true (defer)",
  shouldDeferExternalReload(true, false) === true,
);
check(
  "shouldDeferExternalReload(false, true) → true (defer)",
  shouldDeferExternalReload(false, true) === true,
);
check(
  "shouldDeferExternalReload(true, true) → true (defer)",
  shouldDeferExternalReload(true, true) === true,
);

// noticeForReloadReason (3 케이스)
check(
  "noticeForReloadReason('initial') → null",
  noticeForReloadReason("initial") === null,
);
check(
  "noticeForReloadReason('external') → 외부 수정 메시지",
  noticeForReloadReason("external") ===
    "외부 수정이 감지되어 최신 파일 내용으로 다시 불러왔습니다.",
);
check(
  "noticeForReloadReason('manualReload') → 수동 재로드 메시지",
  noticeForReloadReason("manualReload") === "외부 변경 버전으로 다시 불러왔습니다.",
);

// ---------------------------------------------------------------------------
// 호출부 회귀 가드: useNoteEditor.ts loadNoteFromDisk의 aliases 로드 분기를
// 미러링한다. helper 단독 검증으로는 못 잡았던 "frontmatter.aliases가 빈 배열이면
// aliasesRef.current를 빈 배열로 갱신해야 한다"는 동작을 직접 보장한다.
// (Codex 검수 후속, 2026-05-10)
// ---------------------------------------------------------------------------

function applyLoadedAliases(previousAliases, rawFrontmatterAliases) {
  let aliases = previousAliases;
  if (Array.isArray(rawFrontmatterAliases)) {
    aliases = normalizeFrontmatterAliases(rawFrontmatterAliases);
  }
  return aliases;
}

check(
  "applyLoadedAliases: frontmatter.aliases가 빈 배열 → 기존 alias를 비운다",
  JSON.stringify(applyLoadedAliases(["old"], [])) === JSON.stringify([]),
);
check(
  "applyLoadedAliases: frontmatter.aliases가 mixed types → string만 남기고 ref 교체",
  JSON.stringify(applyLoadedAliases(["old"], ["new", 1, null])) ===
    JSON.stringify(["new"]),
);
check(
  "applyLoadedAliases: frontmatter.aliases가 undefined → 기존 alias 유지",
  JSON.stringify(applyLoadedAliases(["old"], undefined)) === JSON.stringify(["old"]),
);

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

console.log(`\n${assertions} assertions, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
