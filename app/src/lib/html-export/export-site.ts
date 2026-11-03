/**
 * Export Site
 *
 * planExport가 만든 파일 계획 배열을 VaultAdapter를 통해 실제로 기록한다.
 * IO 경계: 이 파일만 VaultAdapter를 직접 호출한다.
 *
 * 어댑터 주입 설계:
 *   - adapter 인자를 받아 MemoryVaultAdapter로도 검증 가능하다.
 *   - adapter가 없으면 tauriVaultAdapter singleton을 사용한다.
 *
 * wiki-link 의존성:
 *   buildLinkIndex / getBacklinksForNote를 여기서 import해 planExport에 주입한다.
 *   이렇게 해야 plan-export.ts가 wiki-link-index에 직접 의존하지 않아도 된다.
 */

import type { VaultAdapter } from "../vault-adapter.ts";
import { tauriVaultAdapter } from "../tauri-vault-adapter.ts";
import { planExport, type PlanExportInput } from "./plan-export.ts";
import {
  buildLinkIndex,
  getBacklinksForNote,
} from "../wiki-links/wiki-link-index";
import type { BuildLinkIndexInput } from "./plan-export.ts";

/** 내보내기 결과 */
export interface ExportSiteResult {
  /** 기록된 파일 수 (고정 파일 포함 전체) */
  fileCount: number;
  /** 실제 노트 HTML 파일 수 (고정 파일 제외) */
  noteCount: number;
  /** .ticksidian-site/ 디렉터리 절대 경로 */
  outputDir: string;
}

/**
 * 볼트의 .ticksidian-site/ 디렉터리에 정적 HTML 사이트를 기록한다.
 *
 * @param input - 노트 메타 + 마크다운 본문
 * @param adapter - VaultAdapter 인스턴스 (없으면 tauriVaultAdapter 사용)
 */
export async function exportSite(
  input: Omit<PlanExportInput, "buildLinkIndexFn" | "getBacklinksForNoteFn">,
  adapter: VaultAdapter = tauriVaultAdapter,
): Promise<ExportSiteResult> {
  const vaultPath = adapter.getVaultPath();
  if (!vaultPath) {
    throw new Error("exportSite: 볼트 경로가 설정되지 않았습니다.");
  }

  const siteDir = `${vaultPath}/.ticksidian-site`;

  // 파일 계획 생성 (순수 규칙) — wiki-link 함수 주입
  const plan = planExport({
    ...input,
    buildLinkIndexFn: (bliInput: BuildLinkIndexInput) =>
      buildLinkIndex({ notes: bliInput.notes, markdownByNoteId: bliInput.markdownByNoteId }),
    getBacklinksForNoteFn: getBacklinksForNote,
  });

  // 필요한 디렉터리를 미리 만든다
  const dirs = new Set<string>([siteDir]);
  for (const { relPath } of plan.files) {
    const slash = relPath.lastIndexOf("/");
    if (slash > 0) {
      dirs.add(`${siteDir}/${relPath.slice(0, slash)}`);
    }
  }

  for (const dir of dirs) {
    await adapter.createDirectory(dir, { recursive: true });
  }

  // 파일 기록
  for (const { relPath, content } of plan.files) {
    await adapter.writeTextFile(`${siteDir}/${relPath}`, content);
  }

  return {
    fileCount: plan.files.length,
    noteCount: plan.noteCount,
    outputDir: siteDir,
  };
}
