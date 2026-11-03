import { summarizeExternalChange } from "./src/lib/external-change-summary.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

function note(frontmatter, body) {
  return ["---", ...frontmatter, "---", "", ...body].join("\n");
}

{
  const before = note(['id: "a"', 'title: "예전"', 'updatedAt: "2026-01-01T00:00:00.000Z"', 'custom: "old"'], [
    "# 예전",
    "",
    "첫 줄",
    "둘째 줄",
  ]);
  const after = note(['id: "a"', 'title: "새 제목"', 'updatedAt: "2026-01-02T00:00:00.000Z"', 'createdAt: "2026-01-03T00:00:00.000Z"'], [
    "# 새 제목",
    "",
    "첫 줄",
    "셋째 줄",
    "추가 한 줄",
  ]);
  const result = summarizeExternalChange(before, after);
  check("frontmatter 바뀐 필드 이름을 잡는다",
    result.changedFrontmatterFields.includes("title")
    && result.changedFrontmatterFields.includes("updatedAt")
    && result.changedFrontmatterFields.includes("custom")
    && result.changedFrontmatterFields.includes("createdAt"));
  check("본문 추가/삭제 줄 수를 잡는다", result.addedLines === 3 && result.deletedLines === 2);
  check("요약 문자열은 짧고 읽기 쉽다",
    result.summary.includes("frontmatter: title, updatedAt")
    && result.summary.includes("본문 +3줄 -2줄"));
  check("큰 파일이 아니면 skip이 아니다", result.skipped === false);
}

{
  const before = note([], ["같은 본문"]);
  const after = note([], ["같은 본문"]);
  const result = summarizeExternalChange(before, after);
  check("변경이 없으면 요약이 없다", result.summary === null);
}

{
  const huge = "x".repeat(500_001);
  const result = summarizeExternalChange("짧음", huge);
  check("큰 외부 파일은 요약을 건드러지 않는다", result.skipped === true && result.summary === null);
}

const result = summary();
console.log(`\n${result.assertions} assertions, ${result.failures} failures`);
if (result.failures > 0) process.exit(1);
