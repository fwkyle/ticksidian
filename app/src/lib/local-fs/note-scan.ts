/**
 * note-scan.ts
 *
 * 볼트의 모든 노트(.md) 파일을 스캔해 NoteListItem 목록을 만든다.
 * P1-006 mtime 빠른 경로: previousNotes를 주면 mtime이 동일한 파일은 재읽기 없이 캐시를 재사용.
 */

import type { NoteListItem } from '../../types/note';
import { parseFrontmatter } from '../markdown-import';
import { stripMarkdownExtension } from '../note-filename';
import {
  assignDeterministicNoteIds,
  createFallbackScannedNoteItem,
  createScannedDrawingItem,
  createScannedNoteItem,
  planRescanByMtime,
  sortNotesByUpdatedAt,
  type ScanStatEntry,
} from '../local-fs-helpers';
import { isRawExcalidrawPath } from '../excalidraw-document';
import { tauriVaultAdapter } from '../tauri-vault-adapter';
import { mapWithConcurrency } from '../async-pool';
import { getNotesRootDir, readTextFile } from './vault-paths';

const PROJECT_META_FILE = '.project.json';

/** 첫 스캔에서 동시에 읽을 파일 수 상한(useLinkIndex.fullRebuild와 같은 기준). */
const SCAN_READ_CONCURRENCY = 12;

export interface NoteFileDescriptor {
  entryPath: string;
  name: string;
  stem: string;
  relativeFolder: string;
  relFilePath: string;
  mtime: number;
  /** 폴더 목록이 준 birthtime. 없으면 null — 추가 stat을 부르지 않는다(P1-006 성능 결정 유지). */
  birthtime: number | null;
  /** raw JSON 그림 파일(`*.excalidraw`)인가 (2026-08-23 TICK-DRAW-001). */
  isDrawing: boolean;
}

// 파일 수정 시간 조회
export async function getFileMtime(path: string): Promise<number> {
  try {
    const stat = await tauriVaultAdapter.getFileStat(path);
    return stat.modifiedAt ?? Date.now();
  } catch {
    return Date.now();
  }
}

/**
 * 볼트의 모든 노트(.md)를 스캔해 NoteListItem 목록을 만든다.
 *
 * P1-006 mtime 빠른 경로: `previousNotes`를 주면, 디렉터리를 stat만 먼저 돌고
 * mtime이 그대로인 파일은 readTextFile/파싱 없이 직전 항목을 재사용한다. 변경/신규
 * 파일만 실제로 읽는다.
 */
export async function scanNoteFiles(
  previousNotes?: NoteListItem[],
): Promise<NoteListItem[]> {
  const notesRoot = getNotesRootDir();

  const descriptors: NoteFileDescriptor[] = [];

  async function scanDir(dir: string, relativeFolder: string) {
    let entries: Awaited<ReturnType<typeof tauriVaultAdapter.listDirectoryEntries>>;
    try {
      entries = await tauriVaultAdapter.listDirectoryEntries(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const { name, path: entryPath, isDir, isFile } = entry;

      if (name.startsWith('.')) continue;
      if (name === PROJECT_META_FILE) continue;

      if (isDir) {
        const childFolder = relativeFolder ? `${relativeFolder}/${name}` : name;
        await scanDir(entryPath, childFolder);
        continue;
      }

      if (!isFile) continue;
      const isDrawing = isRawExcalidrawPath(name);
      if (!entryPath.endsWith('.md') && !isDrawing) continue;

      // 그림은 확장자를 stem에 남긴다 — 같은 이름 `.md`와 id가 겹치지 않게 (TICK-DRAW-001).
      const stem = isDrawing ? name : stripMarkdownExtension(name);
      const relFilePath = relativeFolder ? `${relativeFolder}/${name}` : name;
      const mtime =
        entry.modifiedAt != null ? entry.modifiedAt : await getFileMtime(entryPath);
      const birthtime = entry.createdAt ?? null;
      descriptors.push({
        entryPath, name, stem, relativeFolder, relFilePath, mtime, birthtime, isDrawing,
      });
    }
  }

  await scanDir(notesRoot, '');

  // 직전 스캔(filePath→item)과 mtime을 비교해 재사용/재읽기 계획을 세운다.
  const prevByPath = new Map<string, NoteListItem>();
  const prevMtimeByPath = new Map<string, number>();
  if (previousNotes) {
    for (const item of previousNotes) {
      if (!item.filePath) continue;
      prevByPath.set(item.filePath, item);
      if (item.fileMtime !== undefined) prevMtimeByPath.set(item.filePath, item.fileMtime);
    }
  }
  const currentStats: ScanStatEntry[] = descriptors.map((d) => ({
    path: d.relFilePath,
    mtime: d.mtime,
  }));
  const plan = planRescanByMtime(prevMtimeByPath, currentStats);
  const reuse = new Set(plan.unchanged);

  // unchanged는 캐시 재사용(얕은 복제), 변경/신규만 read+파싱.
  //
  // 2026-08-16: 스캔 뿌리가 볼트 폴더 자체로 넓어지면서 첫 로드 대상이 크게 늘었다
  // (실측 실사용 볼트 537개). 파일을 하나씩 순차로 읽으면 IPC 왕복이 그대로 쌓이므로,
  // 링크 인덱스와 같은 공통 모듈로 동시성을 제한한 병렬 읽기로 바꿨다.
  // 순서는 마지막 sortNotesByUpdatedAt이 정하므로 병렬로 읽어도 결과가 흔들리지 않는다.
  // 설계: docs/waterfall/03-상세설계/볼트-전체-스캔.md
  const notes = await mapWithConcurrency(
    descriptors,
    SCAN_READ_CONCURRENCY,
    async (d): Promise<NoteListItem> => {
      const cached = prevByPath.get(d.relFilePath);
      if (cached && reuse.has(d.relFilePath)) {
        return { ...cached };
      }
      // 그림은 내용을 읽지 않는다 — 목록에 필요한 건 제목·시각뿐이다(TICK-DRAW-001).
      if (d.isDrawing) {
        return createScannedDrawingItem({
          fileName: d.name,
          relativeFolder: d.relativeFolder,
          mtime: d.mtime,
          birthtime: d.birthtime,
        });
      }
      try {
        const content = await readTextFile(d.entryPath);
        const { frontmatter } = parseFrontmatter(content);
        return createScannedNoteItem({
          stem: d.stem,
          fileName: d.name,
          relativeFolder: d.relativeFolder,
          content,
          frontmatter,
          mtime: d.mtime,
          birthtime: d.birthtime,
        });
      } catch {
        return createFallbackScannedNoteItem(d.stem, d.relativeFolder);
      }
    },
  );

  assignDeterministicNoteIds(notes);
  return sortNotesByUpdatedAt(notes);
}
