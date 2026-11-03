import { downloadTextFile, type TextFileDownloader } from "./browser-download.ts";

export interface MarkdownExportPayload {
  noteId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  exportedAt: number;
  markdownBody: string;
  /** 위키링크 해석용 보조 이름 목록 */
  aliases?: string[];
  /** "todo"이면 투두 노트 */
  type?: "todo";
  /** 투두 완료 여부 */
  done?: boolean;
  /** 마감일 (ISO 날짜 문자열) */
  dueDate?: string;
  /** 우선순위 */
  priority?: string;
  /** 태그 목록 */
  tags?: string[];
  /** 즐겨찾기(별표). true일 때만 `favorite: true` 줄을 쓴다 (2026-09-19 TICK-UX-013) */
  favorite?: boolean;
  /** 외부 가져오기 원본 이름 */
  externalSource?: string;
  /** 외부 원본의 안정 ID */
  externalSourceId?: string;
  /** 외부 원본을 Markdown으로 가져온 시각 */
  importedAt?: string;
}

export interface MarkdownExportOptions {
  readonly downloader?: TextFileDownloader;
}

function escapeYamlString(value: string): string {
  return JSON.stringify(value);
}

function sanitizeFileNameSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "untitled-note";
}

export function createMarkdownExportFilename(title: string): string {
  return `${sanitizeFileNameSegment(title)}.md`;
}

export function buildMarkdownExportDocument({
  noteId,
  title,
  createdAt,
  updatedAt,
  exportedAt,
  markdownBody,
  aliases,
  type,
  done,
  dueDate,
  priority,
  tags,
  favorite,
  externalSource,
  externalSourceId,
  importedAt,
}: MarkdownExportPayload): string {
  // 끝의 개행만 정리. trimEnd()는 NBSP(\u00A0)까지 whitespace로 보고 날리므로,
  // 문서 맨 끝의 "빈 문단 NBSP 마커"가 유실됨(useNoteEditor.ts의 maskEmptyParagraphs 참고).
  const body = markdownBody.replace(/\n+$/, "");

  const lines = [
    "---",
    `id: ${escapeYamlString(noteId)}`,
    `title: ${escapeYamlString(title)}`,
  ];

  // aliases (빈 배열이면 출력하지 않음)
  if (aliases && aliases.length > 0) {
    lines.push(`aliases: ${JSON.stringify(aliases)}`);
  }

  // 할 일 표시와 이력은 별개다. 표시를 꺼도 기록에 남은 정보는 보존한다.
  if (type === "todo") {
    lines.push(`type: "todo"`);
  }
  if (type === "todo" || done !== undefined) lines.push(`done: ${done === true}`);
  if (dueDate) lines.push(`dueDate: ${escapeYamlString(dueDate)}`);
  if (priority) lines.push(`priority: ${escapeYamlString(priority)}`);

  // 태그는 노트 공통 메타(2026-08-23 TICK-UX-007). 예전엔 투두 블록 안에서만 써서
  // 틱시디언 생성 일반 노트의 태그가 저장 때 사라졌다. 위치는 투두 필드 바로 뒤 그대로다.
  if (tags && tags.length > 0) lines.push(`tags: ${JSON.stringify(tags)}`);

  // 즐겨찾기는 참일 때만 쓴다. 해제(false)는 키를 지우는 것과 같다(최소 필드).
  if (favorite) lines.push("favorite: true");

  if (externalSource) lines.push(`externalSource: ${escapeYamlString(externalSource)}`);
  if (externalSourceId) lines.push(`externalSourceId: ${escapeYamlString(externalSourceId)}`);
  if (importedAt) lines.push(`importedAt: ${escapeYamlString(importedAt)}`);

  lines.push(
    `createdAt: ${escapeYamlString(new Date(createdAt).toISOString())}`,
    `updatedAt: ${escapeYamlString(new Date(updatedAt).toISOString())}`,
    `exportedAt: ${escapeYamlString(new Date(exportedAt).toISOString())}`,
    `source: ${escapeYamlString("ticksidian")}`,
    "---",
    "",
    body,
    "",
  );

  return lines.join("\n");
}

export function exportNoteAsMarkdown(
  payload: MarkdownExportPayload,
  options: MarkdownExportOptions = {},
): string {
  const filename = createMarkdownExportFilename(payload.title);
  const contents = buildMarkdownExportDocument(payload);
  const downloader = options.downloader ?? downloadTextFile;
  downloader(filename, contents);
  return filename;
}
