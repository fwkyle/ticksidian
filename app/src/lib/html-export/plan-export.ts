/**
 * Plan Export
 *
 * 노트 목록 + 마크다운 본문 + LinkIndex를 받아
 * .ticksidian-site/ 아래에 기록할 파일 계획 배열을 반환한다.
 *
 * IO 없음 — 순수 함수.
 * .gitignore 항목도 여기서 포함한다.
 *
 * 의존성 주입:
 *   buildLinkIndexFn / getBacklinksForNoteFn 을 인자로 받아
 *   wiki-link-index.ts 를 직접 import하지 않는다.
 *   이렇게 하면 QA에서 stub을 주입해 Node ESM 제약을 우회할 수 있다.
 */

import type { LinkIndex, LinkableNoteMeta, BacklinkItem } from "../wiki-links/wiki-link-types.ts";
import { buildSearchIndex, serializeSearchIndexJson, serializeSearchIndexJs } from "./build-search-index.ts";
import { renderNotePage } from "./render-note-page.ts";
import { renderIndexPage } from "./render-index-page.ts";
import { notePageFileName } from "./note-page-file-name.ts";
import { STYLE_CSS, APP_JS } from "./site-assets.ts";

export interface ExportFileEntry {
  /** .ticksidian-site/ 기준 상대 경로 */
  relPath: string;
  /** 파일 내용 문자열 */
  content: string;
}

export interface ExportPlan {
  /** 기록할 파일 목록 */
  files: ExportFileEntry[];
  /** 실제 노트 HTML 파일 수 (고정 파일 제외) */
  noteCount: number;
}

export interface BuildLinkIndexInput {
  notes: LinkableNoteMeta[];
  markdownByNoteId: Record<string, string>;
}

export interface PlanExportInput {
  /** 볼트 내 모든 노트 메타데이터 */
  notes: LinkableNoteMeta[];
  /** noteId → 마크다운 전체 본문 (frontmatter 포함) */
  markdownByNoteId: Record<string, string>;
  /** 사전에 구성된 LinkIndex. 없으면 buildLinkIndexFn으로 생성한다. */
  linkIndex?: LinkIndex;
  /** 사이트 이름 */
  siteName?: string;
  /**
   * LinkIndex를 빌드하는 함수.
   * linkIndex가 주어지지 않을 때만 호출된다.
   * 기본값: 빈 인덱스를 반환하는 no-op (실제 사용 시 반드시 주입해야 한다).
   */
  buildLinkIndexFn?: (input: BuildLinkIndexInput) => LinkIndex;
  /**
   * noteId의 백링크 목록을 가져오는 함수.
   * 기본값: 빈 배열 반환.
   */
  getBacklinksForNoteFn?: (index: LinkIndex, noteId: string) => BacklinkItem[];
}

/** 빈 LinkIndex 기본값 */
function makeEmptyLinkIndex(): LinkIndex {
  return {
    notesById: new Map(),
    noteIdsByTitleKey: new Map(),
    outgoingBySourceId: new Map(),
    backlinksByTargetId: new Map(),
  };
}

/**
 * .ticksidian-site/ 아래에 기록할 파일 계획을 반환한다.
 * 순서: index.html → notes/ → assets/ → search-index.* → .gitignore
 */
export function planExport(input: PlanExportInput): ExportPlan {
  const { notes, markdownByNoteId, siteName } = input;

  const buildLinkIndexFn =
    input.buildLinkIndexFn ?? (() => makeEmptyLinkIndex());
  const getBacklinksForNoteFn =
    input.getBacklinksForNoteFn ?? ((): BacklinkItem[] => []);

  // 1. 링크 인덱스 (주입 or 생성)
  const linkIndex =
    input.linkIndex ??
    buildLinkIndexFn({ notes, markdownByNoteId });

  // 2. 검색 인덱스
  const searchEntries = buildSearchIndex(notes, markdownByNoteId);

  const files: ExportFileEntry[] = [];

  // 3. 개별 노트 HTML
  for (const note of notes) {
    const markdown = markdownByNoteId[note.noteId] ?? "";
    const outgoingLinks = linkIndex.outgoingBySourceId.get(note.noteId) ?? [];
    const backlinks = getBacklinksForNoteFn(linkIndex, note.noteId);

    const html = renderNotePage({
      noteId: note.noteId,
      title: note.title,
      markdownContent: markdown,
      outgoingLinks,
      backlinks,
      siteName,
    });

    files.push({
      relPath: `notes/${notePageFileName(note.noteId)}`,
      content: html,
    });
  }

  // noteCount는 notes[] 크기 — 고정 파일 추가 전에 확정한다
  const noteCount = notes.length;

  // 4. index.html
  files.unshift({
    relPath: "index.html",
    content: renderIndexPage({ searchEntries, siteName }),
  });

  // 5. assets
  files.push({ relPath: "assets/style.css", content: STYLE_CSS });
  files.push({ relPath: "assets/app.js", content: APP_JS });

  // 6. search-index.json (외부 도구용)
  files.push({
    relPath: "search-index.json",
    content: serializeSearchIndexJson(searchEntries),
  });

  // 7. search-index.js (file:// 호환, window.__SEARCH_INDEX__ 주입)
  files.push({
    relPath: "assets/search-index.js",
    content: serializeSearchIndexJs(searchEntries),
  });

  // 8. .gitignore — 산출물이 실수로 git 커밋되지 않도록
  files.push({
    relPath: ".gitignore",
    content: "*\n",
  });

  return { files, noteCount };
}
