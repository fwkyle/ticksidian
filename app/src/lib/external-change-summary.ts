import { parseFrontmatter } from "./markdown-import.ts";
import { MAX_EDITABLE_NOTE_CHARS } from "./note-size.ts";

export interface ExternalChangeSummaryResult {
  /** 배너에 표시할 한 줄. 계산하지 못했거나 차이가 없으면 null. */
  summary: string | null;
  /** 편집기 한계를 넘어 요약을 계산하지 않았는가. */
  skipped: boolean;
  changedFrontmatterFields: string[];
  addedLines: number;
  deletedLines: number;
}

/**
 * 마지막 저장본과 외부 디스크 버전의 짧은 차이.
 * 줄 수는 정확한 Myers diff가 아니라 다중집합 차이다. 사용자에게 "정도"를 알리는
 * 목적이라 본문이 크지 않아도 O(n)으로 계산할 수 있게 한다.
 */
export function summarizeExternalChange(
  beforeContent: string,
  afterContent: string,
): ExternalChangeSummaryResult {
  if (
    beforeContent.length > MAX_EDITABLE_NOTE_CHARS
    || afterContent.length > MAX_EDITABLE_NOTE_CHARS
  ) {
    return {
      summary: null,
      skipped: true,
      changedFrontmatterFields: [],
      addedLines: 0,
      deletedLines: 0,
    };
  }

  const before = parseFrontmatter(beforeContent);
  const after = parseFrontmatter(afterContent);
  const changedFrontmatterFields = changedKeys(before.frontmatter, after.frontmatter);
  const { addedLines, deletedLines } = countBodyLineChanges(before.body, after.body);

  const parts: string[] = [];
  if (changedFrontmatterFields.length > 0) {
    parts.push(`frontmatter: ${changedFrontmatterFields.join(", ")}`);
  }
  if (addedLines > 0 || deletedLines > 0) {
    parts.push(`본문 +${addedLines}줄 -${deletedLines}줄`);
  }

  return {
    summary: parts.length > 0 ? parts.join(" · ") : null,
    skipped: false,
    changedFrontmatterFields,
    addedLines,
    deletedLines,
  };
}

function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => stableValue(before[key]) !== stableValue(after[key]));
}

function stableValue(value: unknown): string {
  return value === undefined ? "<missing>" : JSON.stringify(value);
}

function countBodyLineChanges(
  beforeBody: string,
  afterBody: string,
): { addedLines: number; deletedLines: number } {
  const remaining = new Map<string, number>();
  for (const line of splitLines(beforeBody)) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }

  let addedLines = 0;
  for (const line of splitLines(afterBody)) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
    } else {
      addedLines += 1;
    }
  }

  let deletedLines = 0;
  for (const count of remaining.values()) deletedLines += count;
  return { addedLines, deletedLines };
}

function splitLines(content: string): string[] {
  return content.replace(/\n+$/, "").split("\n");
}
