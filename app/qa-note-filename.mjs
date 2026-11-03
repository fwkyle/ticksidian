/**
 * qa-note-filename.mjs — 파일명-제목 동기화 순수 규칙 QA (2026-08-18 [kyle] 결정).
 *
 * 설계: docs/waterfall/03-상세설계/파일명-제목-동기화.md
 * Why: 새 노트 UUID 파일명을 제목으로 바꾸는 규칙(1단계)과 제목 변경 추적 rename(2단계)의
 * 판정을 잠근다. 특히 "옵시디언 기존 노트를 건드리지 않는다", "볼트 전체 유일 stem",
 * "ticktick- 변환본 보호"가 회귀하면 안 된다.
 */

import {
  isUuidBasename,
  planFilenameSync,
  resolveBasenameCollision,
  sanitizeTitleForFilename,
  stripMarkdownExtension,
} from "./src/lib/note-filename.ts";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const UUID = "3b241101-e2bb-4255-8caf-4136c566a962";
const note = (over = {}) => ({
  id: UUID,
  fileBasename: UUID,
  title: "회의 메모",
  createdAt: new Date("2026-08-18T01:00:00Z"),
  updatedAt: new Date("2026-08-18T02:00:00Z"),
  folder: "",
  ...over,
});

/* ── isUuidBasename ── */
check("UUID 파일명을 인식한다", isUuidBasename(UUID) === true);
check("대문자 UUID도 인식한다", isUuidBasename(UUID.toUpperCase()) === true);
check("일반 제목 파일명은 UUID가 아니다", isUuidBasename("회의 메모") === false);
check("짧은 hex는 UUID가 아니다", isUuidBasename("3b241101") === false);

/* ── sanitizeTitleForFilename ── */
check("일반 한글 제목은 그대로", sanitizeTitleForFilename("회의 메모") === "회의 메모");
check("하이픈은 유지한다", sanitizeTitleForFilename("회의-메모") === "회의-메모");
check(
  "금지 문자는 공백으로 바뀌고 정리된다",
  sanitizeTitleForFilename('a/b\\c:d*e?f"g<h>i|j') === "a b c d e f g h i j",
  JSON.stringify(sanitizeTitleForFilename('a/b\\c:d*e?f"g<h>i|j')),
);
check(
  "옵시디언 링크 문법 문자를 제거한다",
  sanitizeTitleForFilename("[[제목]] #태그 ^블록") === "제목 태그 블록",
);
check("선행 점은 제거한다(숨김 파일 방지)", sanitizeTitleForFilename("...숨김") === "숨김");
check("후행 점/공백은 제거한다", sanitizeTitleForFilename("제목. . ") === "제목");
check("빈 결과는 null", sanitizeTitleForFilename("///:::") === null);
check("공백만은 null", sanitizeTitleForFilename("   ") === null);
check(
  "80자 상한",
  (sanitizeTitleForFilename("가".repeat(200)) ?? "").length === 80,
);

/* ── resolveBasenameCollision ── */
const taken = new Set(["회의 메모", "회의 메모 1"].map((s) => s.toLowerCase()));
check("충돌 없으면 그대로", resolveBasenameCollision("일지", taken) === "일지");
check("충돌 시 다음 숫자 접미사", resolveBasenameCollision("회의 메모", taken) === "회의 메모 2");
check(
  "대소문자 무시 충돌(macOS)",
  resolveBasenameCollision("MEMO", new Set(["memo"])) === "MEMO 1",
);

/* ── planFilenameSync: 1단계 (UUID 파일명) ── */
{
  const plan = planFilenameSync(note(), [note()], { titleChanged: false });
  check("UUID 노트는 titleChanged 없이도 대상", plan !== null);
  check("대상 이름은 정리된 제목", plan?.toBasename === "회의 메모");
  check("원본 이름/폴더가 계획에 담긴다", plan?.fromBasename === UUID && plan?.folder === "");
}
check(
  "기본 제목(새 노트)은 rename하지 않는다",
  planFilenameSync(note({ title: "새 노트" }), [], { titleChanged: false }) === null,
);
check(
  "기본 제목(새 투두)도 rename하지 않는다",
  planFilenameSync(note({ title: "새 투두" }), [], { titleChanged: true }) === null,
);
check(
  "빈 제목은 rename하지 않는다",
  planFilenameSync(note({ title: "  " }), [], { titleChanged: true }) === null,
);

/* ── planFilenameSync: 2단계 (제목 변경 추적) ── */
check(
  "비 UUID + 제목 변경 없음 → 옵시디언 기존 노트 보호",
  planFilenameSync(note({ fileBasename: "살구", id: "살구", title: "복숭아" }), [], {
    titleChanged: false,
  }) === null,
);
{
  const plan = planFilenameSync(
    note({ fileBasename: "살구", id: "살구", title: "복숭아" }),
    [],
    { titleChanged: true },
  );
  check("비 UUID + 제목 변경 → 2단계 대상", plan?.toBasename === "복숭아");
}
check(
  "제목과 파일명이 이미 같으면(대소문자 무시) 안 한다",
  planFilenameSync(note({ fileBasename: "Memo", id: "Memo", title: "memo" }), [], {
    titleChanged: true,
  }) === null,
);
check(
  "이미 숫자 접미 변형이면 유지한다",
  planFilenameSync(note({ fileBasename: "회의 메모 1", id: "회의 메모 1" }), [], {
    titleChanged: true,
  }) === null,
);

/* ── 보호 규칙 ── */
check(
  "ticktick- 변환본은 rename하지 않는다(검토 큐 경로 계약)",
  planFilenameSync(
    note({ fileBasename: "ticktick-abc123", id: "ticktick-abc123" }),
    [],
    { titleChanged: true },
  ) === null,
);

/* ── 충돌: 볼트 전체(폴더 무관) 유일 ── */
{
  const others = [
    note({ id: "x1", fileBasename: "회의 메모", folder: "다른폴더", title: "다른 것" }),
  ];
  const plan = planFilenameSync(note(), [note(), ...others], { titleChanged: false });
  check("다른 폴더의 같은 stem과도 충돌 처리한다", plan?.toBasename === "회의 메모 1");
}
{
  const plan = planFilenameSync(note(), [note()], { titleChanged: false });
  check("자기 자신은 충돌 계산에서 제외한다", plan?.toBasename === "회의 메모");
}

/* ── 특수문자 제목이 전부 지워지는 경우 ── */
check(
  "정리 후 빈 제목이면 rename하지 않는다",
  planFilenameSync(note({ title: "###" }), [], { titleChanged: true }) === null,
);

/* ── stripMarkdownExtension (DEF-CONTRACT-001) ── */
check("끝의 .md만 자른다", stripMarkdownExtension("메모.md") === "메모");
check("이름 중간 .md를 보존한다", stripMarkdownExtension("CLAUDE.md 정리.md") === "CLAUDE.md 정리");
check("a.mdx.md는 a.mdx로 읽힌다", stripMarkdownExtension("a.mdx.md") === "a.mdx");
check(".md로 끝나지 않으면 그대로다", stripMarkdownExtension("메모.txt") === "메모.txt");

console.log(`\n${failures === 0 ? "OK" : "FAILED"} — qa-note-filename`);
if (failures > 0) process.exit(1);
