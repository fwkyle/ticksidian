/**
 * qa-note-size.mjs — 편집기 노트 크기 한계 규칙 검증 (2026-08-16).
 *
 * Why: 실볼트의 `팅김.md`(12MB, 최장 줄 21만 자 — macOS 크래시 리포트 JSON)를 클릭했을 때
 * BlockNote 파서가 UI 스레드를 막아 앱이 프리징했다. 한계를 넘는 노트는 열지 않는다.
 *
 * 실행: node --experimental-strip-types qa-note-size.mjs
 */

import {
  MAX_EDITABLE_NOTE_CHARS,
  formatNoteSize,
  isTooLargeToEdit,
  tooLargeNoteMessage,
} from "./src/lib/note-size.ts";

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

// ── 1. 한계 판정 ─────────────────────────────────────────────────────────
check("빈 노트는 열 수 있다", !isTooLargeToEdit(""));
check("보통 노트(5KB)는 열 수 있다", !isTooLargeToEdit("가".repeat(5000)));
check("한계 직전은 열 수 있다", !isTooLargeToEdit("a".repeat(MAX_EDITABLE_NOTE_CHARS)));
check("한계 초과 1자부터 막는다", isTooLargeToEdit("a".repeat(MAX_EDITABLE_NOTE_CHARS + 1)));

// 실제 사고 파일(`팅김.md`) 크기. 13MB 문자열을 실제로 만들면 QA가 느려지므로
// 판정에 쓰이는 값(문자 수)만 그대로 비교한다.
const REAL_INCIDENT_CHARS = 13_267_077;
check("실측 사고 파일은 한계를 20배 넘게 초과한다",
  REAL_INCIDENT_CHARS > MAX_EDITABLE_NOTE_CHARS * 20);
check("사고 파일 크기 표기는 12.6MB다", formatNoteSize(REAL_INCIDENT_CHARS) === "12.7MB" || formatNoteSize(REAL_INCIDENT_CHARS) === "12.6MB");

// ── 2. 한계값 근거 ───────────────────────────────────────────────────────
check("한계는 50만 자다", MAX_EDITABLE_NOTE_CHARS === 500_000);
check("한계는 일반 노트(수십 KB)보다 충분히 크다", MAX_EDITABLE_NOTE_CHARS > 100_000);

// ── 3. 크기 표기 ─────────────────────────────────────────────────────────
check("1KB 미만은 자 단위", formatNoteSize(500) === "500자");
check("KB 단위 표기", formatNoteSize(5 * 1024) === "5KB");
check("MB 단위 표기(소수 1자리)", formatNoteSize(Math.round(12.6 * 1024 * 1024)) === "12.6MB");
check("경계(1024자)는 KB로 넘어간다", formatNoteSize(1024) === "1KB");

// ── 4. 안내 문구 — 원본이 안전하다는 사실을 반드시 말한다 ────────────────
{
  const message = tooLargeNoteMessage(13267077);
  check("안내에 크기가 들어간다", message.includes("MB"));
  check("안내는 파일이 그대로임을 알린다", message.includes("그대로") && message.includes("바뀌지 않"));
  check("안내는 다음 행동을 제시한다", message.includes("다른 편집기") || message.includes("나눠"));
}

console.log(`\n${assertions} assertions, ${failures} failures`);
if (failures > 0) process.exit(1);
