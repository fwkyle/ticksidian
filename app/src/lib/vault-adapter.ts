export type VaultAdapterKind = "tauri" | "memory-fixture" | "mobile";

export interface VaultDirectoryEntry {
  path: string;
  name: string;
  isDir: boolean;
  isFile: boolean;
  /** 파일 수정 시각 (epoch milliseconds). 디렉터리 항목 또는 metadata 조회 실패 시 null/undefined. */
  modifiedAt?: number | null;
  /** 파일 생성 시각(birthtime, epoch ms). 디렉터리/미지원 FS면 null/undefined (2026-08-23 TICK-UX-006). */
  createdAt?: number | null;
}

export interface VaultFileStat {
  path: string;
  size: number;
  modifiedAt: number | null;
  createdAt: number | null;
}

export interface VaultCreateDirectoryOptions {
  recursive?: boolean;
}

export interface VaultAdapter {
  readonly kind: VaultAdapterKind;

  selectVaultFolder(): Promise<string | null>;
  registerVaultPath(vaultPath: string): Promise<void>;
  getVaultPath(): string | null;
  setVaultPath(vaultPath: string | null): void;

  createDirectory(
    dirPath: string,
    options?: VaultCreateDirectoryOptions,
  ): Promise<void>;
  readTextFile(path: string): Promise<string>;
  /** 볼트 안 바이너리 파일(이미지 등)을 바이트로 읽는다. 20MiB 상한은 구현 측이 강제한다. */
  readBinaryFile(path: string): Promise<Uint8Array>;
  /** 바이너리 파일 원자적 쓰기(부모 폴더는 만든다). */
  writeBinaryFile(path: string, bytes: Uint8Array): Promise<void>;
  /**
   * expectedMtime 지정 시 실제 쓰기 직전 수정 시각 불일치를 거부한다.
   * 반환값은 방금 쓴 내용의 mtime(epoch ms)이다. 저장 직후 stat을 다시 읽어 기준선으로
   * 쓰면 그 사이 외부 쓰기가 기준선이 되므로, 기준선은 이 값을 쓴다(DEF-CONC-002).
   */
  writeTextFile(path: string, content: string, expectedMtime?: number): Promise<number>;
  deleteFile(path: string): Promise<void>;
  renameDirectory(dirPath: string, newName: string): Promise<void>;
  trashDirectory(dirPath: string): Promise<void>;
  listDirectoryEntries(dirPath: string): Promise<VaultDirectoryEntry[]>;
  getFileStat(path: string): Promise<VaultFileStat>;
}
