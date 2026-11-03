import type { NoteListItem } from "../types/note";
import type { ParsedFrontmatter } from "./markdown-import";
import { drawingTitleFromFileName } from "./excalidraw-document.ts";

export interface ScannedNoteInput {
  stem: string;
  fileName: string;
  relativeFolder: string;
  content: string;
  frontmatter: ParsedFrontmatter;
  mtime: number;
  /** 파일 생성 시각(birthtime, ms). 폴더 목록이 못 주면 null/undefined → mtime 대체. */
  birthtime?: number | null;
}

export function assertSafeFolderPath(folder: string): void {
  if (folder === "") return;
  const segments = folder.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new Error(`unsafe folder segment: '${seg}' in '${folder}'`);
    }
    if (seg.includes("\\") || seg.includes("\0")) {
      throw new Error(`unsafe character in folder segment: '${seg}'`);
    }
  }
}

export function assertSafeFileName(fileName: string): void {
  if (fileName === "" || fileName === "." || fileName === "..") {
    throw new Error(`unsafe file name: '${fileName}'`);
  }
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0")) {
    throw new Error(`unsafe character in file name: '${fileName}'`);
  }
}

export function slugifyFolder(folder: string): string {
  return encodeURIComponent(folder);
}

export function extractTitleFromMarkdown(content: string, fallback: string): string {
  const frontmatterMatch = content.match(/^---\s*\n[\s\S]*?title:\s*["']?([^"'\n]+)["']?\s*\n[\s\S]*?---/);
  if (frontmatterMatch) {
    return frontmatterMatch[1].trim();
  }

  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  const firstLine = content.split("\n")[0]?.trim();
  if (firstLine && firstLine.length > 0) {
    return firstLine.slice(0, 100);
  }

  return fallback;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

export function createScannedNoteItem(input: ScannedNoteInput): NoteListItem {
  const { stem, fileName, relativeFolder, content, frontmatter, mtime, birthtime } = input;
  const title = extractTitleFromMarkdown(content, stem);
  // 생성일 우선순위: frontmatter createdAt > 파일 birthtime > mtime (2026-08-23 TICK-UX-006).
  // 옵시디언 원본은 createdAt이 없어 예전엔 생성일=수정일로 보였다.
  const createdAt = typeof frontmatter.createdAt === "string"
    ? new Date(frontmatter.createdAt)
    : new Date(birthtime ?? mtime);
  const updatedAt = typeof frontmatter.updatedAt === "string"
    ? new Date(frontmatter.updatedAt)
    : new Date(mtime);
  const relFilePath = relativeFolder ? `${relativeFolder}/${fileName}` : fileName;

  const item: NoteListItem = {
    id: stem,
    fileBasename: stem,
    title,
    createdAt,
    updatedAt,
    fileMtime: mtime,
    folder: relativeFolder,
    filePath: relFilePath,
  };

  const aliases = normalizeStringArray(frontmatter.aliases);
  if (aliases) item.aliases = aliases;

  const tags = normalizeStringArray(frontmatter.tags);
  if (tags) item.tags = tags;
  // 즐겨찾기(2026-09-19 TICK-UX-013): true만 참으로 본다. 문자열 "true"·숫자 1은 무시한다.
  if (frontmatter.favorite === true) item.favorite = true;
  if (typeof frontmatter.externalSource === 'string') item.externalSource = frontmatter.externalSource;

  // 옵시디언 Excalidraw 플러그인 그림 파일 표시(편집 보호·자동 선택 제외용, 2026-08-20)
  if (frontmatter["excalidraw-plugin"] !== undefined) item.excalidrawPlugin = true;

  if (frontmatter.type === "todo") {
    item.type = "todo";
    item.done = frontmatter.done === true;
    if (typeof frontmatter.dueDate === "string") item.dueDate = frontmatter.dueDate;
    if (typeof frontmatter.priority === "string") item.priority = frontmatter.priority;
  }

  return item;
}

export interface ScannedDrawingInput {
  /** 확장자를 포함한 파일명. 예: "바이브코딩 구조.excalidraw" */
  fileName: string;
  relativeFolder: string;
  mtime: number;
  birthtime?: number | null;
}

/**
 * raw JSON 그림 파일(`*.excalidraw`) 목록 항목 (2026-08-23 TICK-DRAW-001).
 *
 * 내용을 읽지 않는다 — 목록에 필요한 것은 제목과 시각뿐이고, 큰 JSON을 매 스캔
 * 읽을 이유가 없다. `fileBasename`에 확장자를 남겨 같은 이름 `.md` 노트와 id가
 * 충돌하지 않게 한다.
 */
export function createScannedDrawingItem(input: ScannedDrawingInput): NoteListItem {
  const { fileName, relativeFolder, mtime, birthtime } = input;
  return {
    id: fileName,
    fileBasename: fileName,
    title: drawingTitleFromFileName(fileName),
    createdAt: new Date(birthtime ?? mtime),
    updatedAt: new Date(mtime),
    fileMtime: mtime,
    folder: relativeFolder,
    filePath: relativeFolder ? `${relativeFolder}/${fileName}` : fileName,
    drawing: true,
  };
}

export function createFallbackScannedNoteItem(
  stem: string,
  relativeFolder: string,
): NoteListItem {
  return {
    id: stem,
    fileBasename: stem,
    title: stem,
    createdAt: new Date(),
    updatedAt: new Date(),
    folder: relativeFolder,
  };
}

export function assignDeterministicNoteIds(notes: NoteListItem[]): void {
  const stemGroups = new Map<string, NoteListItem[]>();
  for (const item of notes) {
    const key = item.fileBasename;
    const group = stemGroups.get(key);
    if (group) {
      group.push(item);
    } else {
      stemGroups.set(key, [item]);
    }
  }

  for (const group of stemGroups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => a.folder.localeCompare(b.folder));
    for (let i = 1; i < group.length; i++) {
      const item = group[i];
      const suffix = slugifyFolder(item.folder);
      item.id = `${item.fileBasename}__${suffix}`;
    }
  }

  const usedIds = new Set<string>();
  const orderedForUniq = [...notes].sort((a, b) => {
    const af = a.filePath ?? "";
    const bf = b.filePath ?? "";
    return af.localeCompare(bf);
  });
  for (const item of orderedForUniq) {
    if (!usedIds.has(item.id)) {
      usedIds.add(item.id);
      continue;
    }
    let n = 2;
    while (usedIds.has(`${item.id}__${n}`)) n += 1;
    item.id = `${item.id}__${n}`;
    usedIds.add(item.id);
  }
}

export function sortNotesByUpdatedAt(notes: NoteListItem[]): NoteListItem[] {
  return notes.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

// ===========================================================================
// TICK-P1-006 scanNoteFiles mtime 빠른 경로 (검증기-우선, 아직 미배선).
//
// 현재 scanNoteFiles는 매 tick마다 모든 .md를 readTextFile + stat 한다. 1000노트
// 볼트면 watcher 7초마다 read 1000 + stat 1000 = 2000 invoke. 아래 순수 함수는
// "이전 스캔의 path→mtime"과 "이번 디렉터리 stat 목록"을 비교해, mtime이 바뀐 파일과
// 새 파일만 re-read 대상으로 고른다. 변화 없는 파일은 캐시된 NoteListItem 재사용.
// 배선 단계에서 scanNoteFiles가 이 계획을 따르게 한다.
// ===========================================================================

export interface ScanStatEntry {
  /** vault 기준 상대 경로 (NoteListItem.filePath와 동일 키). */
  path: string;
  /** 파일 수정 시각 ms (FileStat.modified_at). */
  mtime: number;
}

export interface ScanRescanPlan {
  /** mtime 동일 → 캐시된 항목 재사용, read 불필요. */
  unchanged: string[];
  /** mtime 변함 → re-read 필요. */
  changed: string[];
  /** 이전에 없던 새 파일 → read 필요. */
  added: string[];
  /** 사라진 파일 → 캐시/목록에서 제거. */
  removed: string[];
}

// ===========================================================================
// TICK-P1-006 scanNoteFiles mtime 빠른 경로 (검증기-우선, 아직 미배선).
//
// 현재 scanNoteFiles는 매 tick마다 모든 .md를 readTextFile + stat 한다. 1000노트
// 볼트면 watcher 7초마다 read 1000 + stat 1000 = 2000 invoke. 아래 순수 함수는
// "이전 스캔의 path→mtime"과 "이번 디렉터리 stat 목록"을 비교해, mtime이 바뀐 파일과
// 새 파일만 re-read 대상으로 고른다. 변화 없는 파일은 캐시된 NoteListItem 재사용.
// 배선 단계에서 scanNoteFiles가 이 계획을 따르게 한다.
// ===========================================================================

/**
 * 이전 스캔의 path→mtime과 현재 stat 목록을 비교해 어떤 파일만 다시 읽으면 되는지
 * 계획을 만든다. 순수 함수 — IO/ref/side-effect 없음.
 *
 * previous에 같은 path가 여러 번 들어올 일은 없다고 본다(Map 키). current에 중복
 * path가 오면 마지막 항목 기준으로 본다.
 */
export function planRescanByMtime(
  previous: ReadonlyMap<string, number>,
  current: readonly ScanStatEntry[],
): ScanRescanPlan {
  const unchanged: string[] = [];
  const changed: string[] = [];
  const added: string[] = [];
  const seen = new Set<string>();

  for (const { path, mtime } of current) {
    seen.add(path);
    const prevMtime = previous.get(path);
    if (prevMtime === undefined) {
      added.push(path);
    } else if (prevMtime === mtime) {
      unchanged.push(path);
    } else {
      changed.push(path);
    }
  }

  const removed: string[] = [];
  for (const path of previous.keys()) {
    if (!seen.has(path)) removed.push(path);
  }

  return { unchanged, changed, added, removed };
}
