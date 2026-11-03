// Note editor markdown-preserve QA (앱 3단계 패스 1)
//
// Given: NBSP 빈 문단 마스킹/복원 순수 규칙(useNoteEditor.markdown-preserve.ts).
// When: 빈 문단/일반 블록/마커 유사 텍스트를 마스킹·복원한다.
// Then: round-trip이 보존되고 마커가 아닌 텍스트는 그대로다.
//
// Usage:
//   cd app && node --experimental-strip-types qa-note-editor-markdown-preserve.mjs

import {
  createEmptyBlocks,
  maskEmptyParagraphs,
  unmaskEmptyParagraphs,
} from "./src/hooks/useNoteEditor.markdown-preserve.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

{
  const empty = createEmptyBlocks();
  check("createEmptyBlocks는 빈 paragraph 하나를 만든다",
    empty.length === 1 && empty[0].type === "paragraph" && empty[0].content.length === 0);

  const masked = maskEmptyParagraphs(empty);
  check("마스킹하면 빈 문단이 NBSP 텍스트 한 개가 된다",
    masked[0].content.length === 1 && masked[0].content[0].text === "\u00A0");

  const restored = unmaskEmptyParagraphs(masked);
  check("복원하면 다시 빈 문단이 된다(round-trip)",
    restored[0].content.length === 0);
  check("round-trip 후 원본과 동일하다", JSON.stringify(restored) === JSON.stringify(empty));
}

{
  const blocks = [
    { type: "paragraph", content: [{ type: "text", text: "일반 텍스트" }] },
    { type: "paragraph", content: [] },
    { type: "heading", props: { level: 1 }, content: [{ type: "text", text: "제목" }] },
    { type: "paragraph", content: [] },
  ];
  const masked = maskEmptyParagraphs(blocks);
  check("빈 문단만 마스킹된다(NBSP 1개짜리 content가 2개)",
    masked.filter((b) => b.content.length === 1 && b.content[0].text === "\u00A0").length === 2);
  check("일반 텍스트 블록은 무변경", masked[0].content[0].text === "일반 텍스트");
  check("heading 블록은 무변경", masked[2].type === "heading");
  const restored = unmaskEmptyParagraphs(masked);
  check("전체 round-trip 보존", JSON.stringify(restored) === JSON.stringify(blocks));
}

{
  // NBSP가 아니라 일반 공백/여러 글자는 마커가 아니다 → 복원 대상 아님
  const blocks = [
    { type: "paragraph", content: [{ type: "text", text: " " }] },
    { type: "paragraph", content: [{ type: "text", text: "\u00A0\u00A0" }] },
    { type: "paragraph", content: [{ type: "text", text: "\u00A0" }, { type: "text", text: "더" }] },
  ];
  const restored = unmaskEmptyParagraphs(blocks);
  check("일반 공백은 복원되지 않는다", restored[0].content.length === 1);
  check("NBSP 2글자는 복원되지 않는다(마커는 정확히 1글자)", restored[1].content.length === 1);
  check("NBSP+다른 텍스트 조합은 복원되지 않는다", restored[2].content.length === 2);
}

{
  // 원본 배열을 변형하지 않는지(불변성)
  const original = [{ type: "paragraph", content: [] }];
  maskEmptyParagraphs(original);
  check("마스킹은 원본을 변형하지 않는다", original[0].content.length === 0);
}

const result = summary();
console.log(`\n${result.assertions} assertions, ${result.failures} failures`);
if (result.failures > 0) process.exit(1);
