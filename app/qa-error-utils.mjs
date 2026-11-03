/**
 * qa-error-utils.mjs — 사용자에게 보여줄 오류 문구 변환 계약 검증.
 *
 * Why (2026-08-16 F3): Tauri invoke의 거부값은 Error 인스턴스가 아니라 Rust가
 * 직렬화한 plain object다(RagError → { code, message }). 이걸 String()으로 만들면
 * 사용자 화면에 "[object Object]"가 뜬다. 실제로 RAG 검색 실패 시 사이드바에
 * 그렇게 표시되고 있었다. 이 검증기는 그 회귀를 고정한다.
 *
 * 실행: node --experimental-strip-types qa-error-utils.mjs
 */

import { toErrorMessage, parseJsonWithFallback, isExpectedIoError } from "./src/lib/error-utils.ts";

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

// ── 1. 기존 계약(회귀 방지) ────────────────────────────────────────────────
check(
  "Error 인스턴스는 message를 그대로 쓴다",
  toErrorMessage(new Error("실패 원인"), "기본값") === "실패 원인",
);
check(
  "message가 빈 Error는 fallback을 쓴다",
  toErrorMessage(new Error(""), "기본값") === "기본값",
);
check("문자열 오류는 그대로 쓴다", toErrorMessage("문자열 오류", "기본값") === "문자열 오류");
check("공백만 있는 문자열은 fallback", toErrorMessage("   ", "기본값") === "기본값");
check("undefined는 fallback", toErrorMessage(undefined, "기본값") === "기본값");
check("null은 fallback", toErrorMessage(null, "기본값") === "기본값");
check("숫자는 fallback", toErrorMessage(42, "기본값") === "기본값");

// ── 2. Tauri invoke 거부값(F3 핵심) ────────────────────────────────────────
const ragRejection = { code: "ragMissingDatabase", message: "RAG DB를 찾지 못했습니다: /vault" };
check(
  "invoke 거부 객체는 message를 꺼내 쓴다",
  toErrorMessage(ragRejection, "기본값") === "RAG DB를 찾지 못했습니다: /vault",
);
check(
  "invoke 거부 객체는 [object Object]가 되지 않는다",
  !toErrorMessage(ragRejection, "기본값").includes("[object Object]"),
);
check(
  "message가 없는 객체는 fallback",
  toErrorMessage({ code: "ragSqlite" }, "기본값") === "기본값",
);
check(
  "message가 문자열이 아니면 fallback",
  toErrorMessage({ message: 500 }, "기본값") === "기본값",
);
check(
  "message가 공백만이면 fallback",
  toErrorMessage({ message: "  " }, "기본값") === "기본값",
);
check("빈 객체는 fallback", toErrorMessage({}, "기본값") === "기본값");
check(
  "배열도 message가 없으면 fallback",
  toErrorMessage([1, 2, 3], "기본값") === "기본값",
);
check(
  "fallback 기본값은 Unknown error다",
  toErrorMessage({}) === "Unknown error",
);

// ── 3. parseJsonWithFallback (같은 모듈 회귀) ──────────────────────────────
check(
  "정상 JSON은 파싱된다",
  parseJsonWithFallback('{"a":1}', () => ({ a: 0 }), "qa").a === 1,
);
check(
  "깨진 JSON은 fallback factory 결과를 준다",
  parseJsonWithFallback("{깨짐", () => ({ a: 9 }), "qa").a === 9,
);

// ── 4. 파일 IO 예상 실패 판정 (2026-08-18 실창 사고) ─────────────────────
// 검토 큐 첫 실행에서 큐 파일이 없는 것은 정상인데, Tauri invoke 거부값이 Error가 아니라
// plain object라서 "예상 못한 오류"로 새어나가 화면에 영어 시스템 메시지가 떴다.
check("Error는 예상 가능한 IO 실패다", isExpectedIoError(new Error("io")));
check("문자열도 예상 가능하다", isExpectedIoError("io error"));
check("**Tauri invoke 거부 객체도 예상 가능해야 한다**",
  isExpectedIoError({ code: "io", message: "io error: No such file or directory (os error 2)" }));
check("빈 객체도 예상 가능(파일 없음 계열)", isExpectedIoError({}));
check("undefined는 예상 밖", !isExpectedIoError(undefined));
check("null은 예상 밖", !isExpectedIoError(null));
check("숫자는 예상 밖", !isExpectedIoError(500));

console.log(`\n${assertions} assertions, ${failures} failures`);
if (failures > 0) process.exit(1);
