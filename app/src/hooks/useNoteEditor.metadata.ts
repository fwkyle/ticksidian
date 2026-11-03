// 노트 메타데이터 추출/저장 문서 조립 — useNoteEditor에서 추출한 순수 함수(앱 3단계 패스 1).
// 설계: docs/waterfall/03-상세설계/에디터-저장-외부수정-리팩토링-설계.md §3 패스 1
// Node QA: qa-note-editor-metadata.mjs

import type { ParsedFrontmatter } from "../lib/markdown-import.ts";
import { formatYamlKey, formatYamlValue } from "../lib/frontmatter-yaml.ts";
import { buildMarkdownExportDocument } from "../lib/markdown-export.ts";
import { normalizeFrontmatterAliases, accumulateAliases } from "./useNoteEditor.helpers.ts";

/** 투두 전용 frontmatter — 저장 시 그대로 다시 써야 한다. */
export interface TodoMeta {
  type?: "todo";
  done?: boolean;
  dueDate?: string;
  priority?: string;
  /**
   * @deprecated 2026-08-23 TICK-UX-007부터 태그는 노트 공통 메타(`NoteMetadata.tags`)다.
   * 에디터는 이 필드를 더 이상 읽거나 쓰지 않는다. 타입 호환을 위해서만 남겨 둔다.
   */
  tags?: string[];
  externalSource?: string;
  externalSourceId?: string;
  importedAt?: string;
}

/**
 * 로드한 frontmatter에서 에디터가 유지할 메타 상태를 뽑는다.
 * null 필드는 "파일에 없으니 기존 값 유지" 신호다(예: aliases가 배열일 때만 반영).
 *
 * 단, `todoMeta`만은 "기존 유지"가 아니라 **항상 파일 기준**이다(2026-08-16 F4로 명문화).
 * 할 일 표시는 파일의 type만 따른다. 표시를 꺼도 파일에 남은 날짜·완료 이력은 보존한다.
 * 리팩토링 전 hook은 `type === 'todo'`일 때만 대입해서, 외부 편집기로 `type: todo`를
 * 지운 파일을 재로드해도 직전 todo frontmatter가 살아남아 다음 저장에 되살아났다.
 * 로컬 `.md`가 원본이라는 잠긴 계약 1번에 맞춰 파일 쪽을 따르는 것이 맞다.
 */
export interface NoteMetadata {
  createdAt: number | undefined;
  updatedAt: number | undefined;
  /** 파일에 배열로 명시됐을 때만 값. null이면 기존 유지. */
  aliases: string[] | null;
  /** 파일에 문자열 title이 있을 때만 값. undefined면 기존 유지. */
  previousTitle: string | undefined;
  /**
   * 노트 공통 태그(2026-08-23 TICK-UX-007). 종류와 무관하게 `tags` 배열을 읽는다(비문자열 제거).
   * 키가 없으면 undefined — 저장 때 "원본 tags 미변경" 신호다(옵시디언 최소 필드).
   * todoMeta처럼 **항상 파일 기준**으로 덮어쓴다(외부에서 지운 태그가 되살아나지 않게).
   */
  tags: string[] | undefined;
  /**
   * 즐겨찾기(2026-09-19 TICK-UX-013). `tags`와 같은 신호를 쓴다 —
   * undefined는 "파일에 키가 없으니 원본 미변경", true/false는 사용자가 정한 값이다.
   */
  favorite: boolean | undefined;
  todoMeta: TodoMeta;
  /** 저장 시 원본 필드 보존 판단에 쓸 로드 시점 frontmatter. */
  frontmatter: ParsedFrontmatter;
}

export function extractNoteMetadata(frontmatter: ParsedFrontmatter): NoteMetadata {
  const hasHistory = ['type', 'done', 'dueDate', 'priority', 'externalSource', 'externalSourceId', 'importedAt']
    .some((key) => frontmatter[key] !== undefined);
  const todoMeta: TodoMeta = hasHistory
    ? {
        type: frontmatter.type === 'todo' ? 'todo' : undefined,
        done: typeof frontmatter.done === 'boolean' ? frontmatter.done : undefined,
        dueDate: typeof frontmatter.dueDate === 'string' ? frontmatter.dueDate : undefined,
        priority: typeof frontmatter.priority === 'string' ? frontmatter.priority : undefined,
        externalSource: typeof frontmatter.externalSource === 'string' ? frontmatter.externalSource : undefined,
        externalSourceId: typeof frontmatter.externalSourceId === 'string' ? frontmatter.externalSourceId : undefined,
        importedAt: typeof frontmatter.importedAt === 'string' ? frontmatter.importedAt : undefined,
      }
    : {};

  const tags = Array.isArray(frontmatter.tags)
    ? (frontmatter.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : undefined;

  return {
    tags,
    // true만 참이다. false·문자열·숫자는 "파일에 우리가 쓴 값이 아님"으로 보고 미변경 취급한다.
    favorite: frontmatter.favorite === true ? true : undefined,
    createdAt: frontmatter.createdAt ? new Date(frontmatter.createdAt).getTime() : undefined,
    updatedAt: frontmatter.updatedAt ? new Date(frontmatter.updatedAt).getTime() : undefined,
    // frontmatter.aliases가 배열이면 빈 배열도 명시적인 "alias 없음" 상태로 받아들인다.
    // 이전 helper 추출 직후 `length > 0` 가드로 좁혔던 회귀(빈 배열일 때 ref 갱신 누락 →
    // 외부에서 지운 alias가 다음 저장 때 살아남)를 막기 위함이다.
    aliases: Array.isArray(frontmatter.aliases)
      ? normalizeFrontmatterAliases(frontmatter.aliases)
      : null,
    previousTitle: typeof frontmatter.title === 'string' ? frontmatter.title : undefined,
    todoMeta,
    frontmatter,
  };
}

export interface SaveDocumentInput {
  readonly noteId: string;
  readonly title: string;
  /** 마스킹+직렬화가 끝난 마크다운 본문(editor.blocksToMarkdownLossy 결과). */
  readonly markdownBody: string;
  /** 현재 에디터가 유지 중인 메타(ref 값들을 그대로 전달). */
  readonly meta: {
    createdAt?: number;
    aliases: string[];
    previousTitle?: string;
    todoMeta: TodoMeta;
    /** 노트 공통 태그. undefined면 원본 미변경(옵시디언 최소 필드), []면 키 삭제. */
    tags?: string[];
    /** 즐겨찾기. undefined면 원본 미변경, false면 키 삭제(true만 쓴다). */
    favorite?: boolean;
    frontmatter: ParsedFrontmatter;
  };
  readonly now: number;
}

export interface SaveDocumentResult {
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** 제목 변경 누적이 반영된 aliases(설계안 6.3절). */
  readonly aliases: string[];
  readonly previousTitle: string;
}

/** 저장용 문서 조립. alias 누적과 createdAt 최초 확정을 포함한다. */
export function buildNoteSaveDocument(input: SaveDocumentInput): SaveDocumentResult {
  const { noteId, title, markdownBody, meta, now } = input;

  // createdAt은 최초 1회만 설정, 이후 유지
  const createdAt = meta.createdAt ?? now;

  // 제목 변경 시 alias 누적 (설계안 6.3절)
  const aliases = accumulateAliases(meta.previousTitle, title, meta.aliases);

  const content = meta.frontmatter.source === "ticksidian"
    ? buildMarkdownExportDocument({
      noteId,
      title,
      createdAt,
      updatedAt: now,
      exportedAt: now,
      markdownBody,
      aliases: aliases.length > 0 ? aliases : undefined,
      // 투두 전용 frontmatter 보존
      ...meta.todoMeta,
      // 노트 공통 태그(TICK-UX-007) — todoMeta.tags는 더 이상 쓰지 않으므로 여기서 확정한다.
      tags: meta.tags && meta.tags.length > 0 ? meta.tags : undefined,
      favorite: meta.favorite,
    })
    : buildObsidianMinimalDocument({
      noteId,
      title,
      markdownBody,
      now,
      aliases,
      tags: meta.tags,
      favorite: meta.favorite,
      todoMeta: meta.todoMeta,
      frontmatter: meta.frontmatter,
    });

  return { content, createdAt, updatedAt: now, aliases, previousTitle: title };
}

function buildObsidianMinimalDocument(input: {
  noteId: string;
  title: string;
  markdownBody: string;
  now: number;
  aliases: string[];
  tags: string[] | undefined;
  favorite: boolean | undefined;
  todoMeta: TodoMeta;
  frontmatter: ParsedFrontmatter;
}): string {
  const { noteId, title, markdownBody, now, aliases, tags, favorite, todoMeta, frontmatter } = input;
  const next: Record<string, unknown> = { ...frontmatter };

  // 없어도 정체성 추적에 필요한 id만 최소로 추가한다.
  if (next.id === undefined) next.id = noteId;
  if ("title" in next) next.title = title;
  if ("updatedAt" in next) next.updatedAt = new Date(now).toISOString();
  if (Array.isArray(next.aliases)) next.aliases = aliases;
  // 노트 공통 태그(TICK-UX-007): undefined면 원본 그대로(최소 필드), 비었으면 키 삭제.
  if (tags !== undefined) {
    if (tags.length > 0) next.tags = tags;
    else delete next.tags;
  }
  // 즐겨찾기(2026-09-19 TICK-UX-013): tags와 같은 규칙 — 건드리지 않았으면 원본 그대로 둔다.
  if (favorite !== undefined) {
    if (favorite) next.favorite = true;
    else delete next.favorite;
  }
  if (todoMeta.type === "todo") {
    next.type = todoMeta.type;
  } else if (frontmatter.type === "todo") {
    // 할 일 표시만 끈다. 날짜·완료·태그는 원본의 정보다.
    delete next.type;
  }
  // 표시 해제 직전 날짜/완료를 편집했을 수도 있다. 로드 당시 frontmatter 대신
  // 현재 메타를 적용하며, 명시적으로 지운 값(undefined)도 옛 값으로 되살리지 않는다.
  if (todoMeta.type === 'todo' || 'done' in todoMeta) {
    if (todoMeta.done !== undefined || todoMeta.type === 'todo') next.done = todoMeta.done === true;
    else delete next.done;
  }
  for (const field of ['dueDate', 'priority'] as const) {
    if (!(field in todoMeta) && todoMeta.type !== 'todo') continue;
    if (todoMeta[field] !== undefined) next[field] = todoMeta[field];
    else delete next[field];
  }

  const body = markdownBody.replace(/\n+$/, "");
  const lines = [
    "---",
    ...Object.entries(next).map(([key, value]) => `${formatYamlKey(key)}: ${formatYamlValue(value)}`),
    "---",
    "",
    body,
    "",
  ];
  return lines.join("\n");
}
