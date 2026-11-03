import { invoke } from "@tauri-apps/api/core";

import { getVaultPath } from "../local-fs.ts";

export interface SyncQueueStore {
  readonly getVaultPath: () => string | null;
  readonly createDirectory: (dirPath: string, recursive: boolean) => Promise<void>;
  readonly writeTextFile: (path: string, content: string) => Promise<void>;
  readonly listDirectory: (dirPath: string) => Promise<readonly string[]>;
  readonly readTextFile: (path: string) => Promise<string>;
  readonly deleteFile: (path: string) => Promise<void>;
}

export const tauriSyncQueueStore: SyncQueueStore = {
  getVaultPath,
  createDirectory: async (dirPath, recursive) => {
    await invoke("create_directory", { dirPath, recursive });
  },
  writeTextFile: async (path, content) => {
    await invoke("write_text_file", { path, content });
  },
  listDirectory: async (dirPath) => invoke<string[]>("list_directory", { dirPath }),
  readTextFile: async (path) => invoke<string>("read_text_file", { path }),
  deleteFile: async (path) => {
    await invoke("delete_file", { path });
  },
};
