/**
 * image-scan.ts — 볼트 안 이미지 파일 목록 스캔 (2026-08-19 이미지 임베드 보기).
 *
 * 임베드 해석(resolveImageEmbedTarget)이 파일명-only 참조를 볼트 전체 탐색으로
 * 풀 수 있게 이미지 파일 절대경로 목록을 만든다. dot 폴더와 .trash는 건너뛴다
 * (note-scan/watch noise 규칙과 동일 기준).
 */

import { tauriVaultAdapter } from "../tauri-vault-adapter";
import { getNotesRootDir } from "./vault-paths";
import { isImagePathishTarget } from "../image-embeds";

const IMAGE_SCAN_SKIP_DIRS = new Set([".trash", ".ticksidian-sync", ".ticksidian-site", ".git"]);

export async function scanVaultImageFiles(): Promise<string[]> {
  const root = getNotesRootDir();
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await tauriVaultAdapter.listDirectoryEntries(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.startsWith(".trash")) continue;
      if (entry.isDir) {
        if (IMAGE_SCAN_SKIP_DIRS.has(entry.name)) continue;
        await walk(entry.path);
        continue;
      }
      if (entry.isFile && isImagePathishTarget(entry.name)) {
        found.push(entry.path);
      }
    }
  }

  await walk(root);
  return found.sort();
}

