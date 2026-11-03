/**
 * qa-editor-clipboard.mjs — 복사 평문 규칙 검증 (2026-09-18 TICK-BUG-007).
 *
 * 설계: docs/waterfall/03-상세설계/복사-평문-클립보드.md
 *
 * 핵심 계약
 * - 평문에는 우리가 기호를 붙이지 않는다. ProseMirror가 준 글자를 그대로 돌려준다
 *   (`<주소>` 오토링크도, `[글자](주소)`도 만들지 않는다).
 * - 블록 구분자는 줄 하나(`\n`)다. 빈 줄을 넣지 않는다.
 * - 선택이 비었거나 글자가 없으면 null이다. 호출부는 이때 클립보드를 건드리지 않는다.
 * - 넘겨받은 from/to를 넓히거나 좁히지 않는다.
 *
 * 실행: node --experimental-strip-types qa-editor-clipboard.mjs
 */

import {
  PLAIN_TEXT_BLOCK_SEPARATOR,
  selectionPlainText,
} from "./src/lib/editor-clipboard.ts";

let failures = 0;
let assertions = 0;
function check(label, condition, detail) {
  assertions += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

/** doc 스텁 — textBetween 호출 인자를 기록하고 문단을 구분자로 이어 붙인다. */
function docOf(paragraphs) {
  const calls = [];
  return {
    calls,
    textBetween(from, to, blockSeparator) {
      calls.push({ from, to, blockSeparator });
      return paragraphs.join(blockSeparator ?? "");
    },
  };
}

{
  const doc = docOf(["https://character.ai/"]);
  const text = selectionPlainText(doc, { from: 1, to: 23, empty: false });
  check("주소만 선택하면 주소 그대로 나온다", text === "https://character.ai/", `text=${JSON.stringify(text)}`);
  check("꺾쇠를 붙이지 않는다", typeof text === "string" && !text.includes("<") && !text.includes(">"));
  check("마크다운 링크 껍데기를 만들지 않는다", typeof text === "string" && !text.includes("]("));
}

{
  const doc = docOf(["첫 문단", "둘째 문단"]);
  const text = selectionPlainText(doc, { from: 0, to: 10, empty: false });
  check("블록 사이는 빈 줄이 아니라 줄 하나", text === "첫 문단\n둘째 문단", `text=${JSON.stringify(text)}`);
  check("doc에 넘긴 구분자가 줄 하나다", doc.calls[0]?.blockSeparator === PLAIN_TEXT_BLOCK_SEPARATOR);
  check("from/to를 그대로 넘긴다", doc.calls[0]?.from === 0 && doc.calls[0]?.to === 10);
}

{
  const doc = docOf(["가"]);
  check("접힌 선택은 null", selectionPlainText(doc, { from: 3, to: 3, empty: true }) === null);
  check("접힌 선택이면 doc을 읽지 않는다", doc.calls.length === 0);
}

{
  const doc = docOf(["가"]);
  check("역전된 범위는 null", selectionPlainText(doc, { from: 5, to: 2, empty: false }) === null);
  check("역전된 범위면 doc을 읽지 않는다", doc.calls.length === 0);
}

{
  // 그림만 선택한 경우처럼 텍스트가 하나도 없으면 클립보드를 건드리지 않는다.
  const doc = docOf([]);
  check("글자가 없으면 null", selectionPlainText(doc, { from: 0, to: 4, empty: false }) === null);
}

console.log(`\n${assertions} assertions, ${failures} failures`);
if (failures > 0) process.exit(1);
