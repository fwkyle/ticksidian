/**
 * 검토 큐 저장 경계 (TICK-P0-007 검토 큐 UI 1차)
 *
 * VaultAdapter 원칙에 따라 invoke() 호출은 이 어댑터 계층에만 둔다.
 * 새 Rust command는 만들지 않고 기존 파일 IO 명령을 재사용한다.
 * Node QA에서는 Fake store로 갈아끼운다 (qa-review-queue.mjs).
 */

import { invoke } from "@tauri-apps/api/core";

import { getVaultPath } from "../local-fs.ts";

export interface ReviewQueueStore {
  readonly getVaultPath: () => string | null;
  readonly createDirectory: (dirPath: string, recursive: boolean) => Promise<void>;
  readonly readTextFile: (path: string) => Promise<string>;
  readonly writeTextFile: (path: string, content: string) => Promise<void>;
}

export const tauriReviewQueueStore: ReviewQueueStore = {
  getVaultPath,
  createDirectory: async (dirPath, recursive) => {
    await invoke("create_directory", { dirPath, recursive });
  },
  readTextFile: async (path) => invoke<string>("read_text_file", { path }),
  writeTextFile: async (path, content) => {
    await invoke("write_text_file", { path, content });
  },
};
