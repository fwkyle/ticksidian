import type {
  VaultAdapter,
  VaultCreateDirectoryOptions,
  VaultDirectoryEntry,
  VaultFileStat,
} from "./vault-adapter";
import {
  createDirectory,
  deleteFile,
  renameDirectory,
  trashDirectory,
  getFileStat,
  listDirectoryEntries,
  readTextFile,
  readBinaryFile,
  writeBinaryFile,
  registerVaultPath,
  selectVaultFolder,
  writeTextFile,
} from "./tauri-commands";

let currentVaultPath: string | null = null;

/**
 * 브라우저 QA 모드(VITE_TICKSIDIAN_BROWSER_QA=1)에서 메모리 픽스처로 교체할 때 사용.
 * 일반 빌드/dev에서는 호출하지 않는다.
 */
let _activeAdapter: VaultAdapter | null = null;

export function setActiveVaultAdapter(adapter: VaultAdapter): void {
  _activeAdapter = adapter;
}

const tauriImpl: VaultAdapter = {
  kind: "tauri",

  selectVaultFolder(): Promise<string | null> {
    return selectVaultFolder();
  },

  async registerVaultPath(vaultPath: string): Promise<void> {
    await registerVaultPath(vaultPath);
    currentVaultPath = vaultPath;
  },

  getVaultPath(): string | null {
    return currentVaultPath;
  },

  setVaultPath(vaultPath: string | null): void {
    currentVaultPath = vaultPath;
  },

  createDirectory(
    dirPath: string,
    options: VaultCreateDirectoryOptions = {},
  ): Promise<void> {
    return createDirectory(dirPath, options.recursive ?? true);
  },

  readTextFile(path: string): Promise<string> {
    return readTextFile(path);
  },

  readBinaryFile(path: string): Promise<Uint8Array> {
    return readBinaryFile(path);
  },

  writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
    return writeBinaryFile(path, bytes);
  },

  writeTextFile(path: string, content: string, expectedMtime?: number): Promise<number> {
    return writeTextFile(path, content, expectedMtime);
  },

  deleteFile(path: string): Promise<void> {
    return deleteFile(path);
  },

  renameDirectory(dirPath: string, newName: string): Promise<void> {
    return renameDirectory(dirPath, newName);
  },

  trashDirectory(dirPath: string): Promise<void> {
    return trashDirectory(dirPath);
  },

  listDirectoryEntries(dirPath: string): Promise<VaultDirectoryEntry[]> {
    return listDirectoryEntries(dirPath);
  },

  getFileStat(path: string): Promise<VaultFileStat> {
    return getFileStat(path);
  },
};

/**
 * 실제 사용 진입점. `_activeAdapter`가 설정되어 있으면(브라우저 QA 모드) 그것을 쓰고,
 * 없으면 Tauri 구현을 쓴다. Proxy를 사용해 모든 메서드 호출을 투명하게 위임한다.
 */
export const tauriVaultAdapter: VaultAdapter = new Proxy({} as VaultAdapter, {
  get(_target, prop: string) {
    const delegate = _activeAdapter ?? tauriImpl;
    return (delegate as unknown as Record<string, unknown>)[prop];
  },
});
