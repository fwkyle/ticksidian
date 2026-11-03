import type {
  VaultAdapter,
  VaultCreateDirectoryOptions,
  VaultDirectoryEntry,
  VaultFileStat,
} from "./vault-adapter";

export interface MemoryVaultAdapterOptions {
  initialVaultPath?: string;
  initialDirectories?: string[];
  initialFiles?: Record<string, string>;
  /**
   * 이미지 등 바이너리 시드(2026-08-19 이미지 임베드 보기).
   * initialFiles(문자열 전용)와 별개 옵션이다. 브라우저 QA fixture PNG가 여기 들어간다.
   */
  initialBinaryFiles?: Record<string, Uint8Array>;
  now?: () => number;
}

interface MemoryFile {
  /** 문자열 파일은 string, 바이너리 파일은 Uint8Array로 보관한다. */
  content: string | Uint8Array;
  createdAt: number;
  modifiedAt: number;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("path is required");
  const collapsed = trimmed.replace(/\/+/g, "/");
  if (collapsed === "/") return collapsed;
  return collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
}

function pathParts(path: string): string[] {
  return normalizePath(path).split("/").filter(Boolean);
}

function joinParts(parts: string[]): string {
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function parentPath(path: string): string {
  const parts = pathParts(path);
  parts.pop();
  return joinParts(parts);
}

function pathName(path: string): string {
  const parts = pathParts(path);
  return parts[parts.length - 1] ?? "/";
}

function pathPrefix(path: string): string {
  return `${normalizePath(path)}/`;
}

function textSize(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

function fileSize(content: string | Uint8Array): number {
  return typeof content === "string" ? textSize(content) : content.byteLength;
}

export function createMemoryVaultAdapter(
  options: MemoryVaultAdapterOptions = {},
): VaultAdapter {
  const now = options.now ?? (() => Date.now());
  const directories = new Set<string>(["/"]);
  const files = new Map<string, MemoryFile>();
  let currentVaultPath = options.initialVaultPath
    ? normalizePath(options.initialVaultPath)
    : null;

  function ensureDirectoryHierarchy(dirPath: string): void {
    const parts = pathParts(dirPath);
    for (let i = 0; i <= parts.length; i++) {
      directories.add(joinParts(parts.slice(0, i)));
    }
  }

  function ensureParentExists(path: string): void {
    const parent = parentPath(path);
    if (!directories.has(parent)) {
      throw new Error(`directory does not exist: ${parent}`);
    }
  }

  if (currentVaultPath) ensureDirectoryHierarchy(currentVaultPath);
  for (const dirPath of options.initialDirectories ?? []) {
    ensureDirectoryHierarchy(normalizePath(dirPath));
  }
  for (const [path, content] of Object.entries(options.initialFiles ?? {})) {
    const normalizedPath = normalizePath(path);
    ensureDirectoryHierarchy(parentPath(normalizedPath));
    const timestamp = now();
    files.set(normalizedPath, {
      content,
      createdAt: timestamp,
      modifiedAt: timestamp,
    });
  }
  for (const [path, content] of Object.entries(options.initialBinaryFiles ?? {})) {
    const normalizedPath = normalizePath(path);
    ensureDirectoryHierarchy(parentPath(normalizedPath));
    const timestamp = now();
    files.set(normalizedPath, {
      content: new Uint8Array(content),
      createdAt: timestamp,
      modifiedAt: timestamp,
    });
  }

  return {
    kind: "memory-fixture",

    async selectVaultFolder(): Promise<string | null> {
      return currentVaultPath;
    },

    async registerVaultPath(vaultPath: string): Promise<void> {
      currentVaultPath = normalizePath(vaultPath);
      ensureDirectoryHierarchy(currentVaultPath);
    },

    getVaultPath(): string | null {
      return currentVaultPath;
    },

    setVaultPath(vaultPath: string | null): void {
      currentVaultPath = vaultPath ? normalizePath(vaultPath) : null;
      if (currentVaultPath) ensureDirectoryHierarchy(currentVaultPath);
    },

    async createDirectory(
      dirPath: string,
      createOptions: VaultCreateDirectoryOptions = {},
    ): Promise<void> {
      const normalizedPath = normalizePath(dirPath);
      if (createOptions.recursive ?? true) {
        ensureDirectoryHierarchy(normalizedPath);
        return;
      }
      ensureParentExists(normalizedPath);
      directories.add(normalizedPath);
    },

    async readTextFile(path: string): Promise<string> {
      const file = files.get(normalizePath(path));
      if (!file) throw new Error(`file does not exist: ${path}`);
      if (typeof file.content !== "string") {
        throw new Error(`file is binary and cannot be read as text: ${path}`);
      }
      return file.content;
    },

    async readBinaryFile(path: string): Promise<Uint8Array> {
      const file = files.get(normalizePath(path));
      if (!file) throw new Error(`file does not exist: ${path}`);
      if (typeof file.content === "string") {
        return new TextEncoder().encode(file.content);
      }
      // 저장 원본 그대로가 아니라 사본을 돌려준다 — 호출자가 바이트를 바꿔도
      // fixture 상태가 조용히 오염되지 않게 한다.
      return new Uint8Array(file.content);
    },

    async writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
      const normalizedPath = normalizePath(path);
      ensureDirectoryHierarchy(parentPath(normalizedPath));
      const previous = files.get(normalizedPath);
      const timestamp = now();
      // Rust fs::write + read_to_string 의미를 따른다: 바이트가 유효 UTF-8 텍스트면
      // readTextFile로 다시 읽을 수 있다. PNG 등 진짜 바이너리는 그대로 보관한다.
      let content: string | Uint8Array;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        content = new Uint8Array(bytes);
      }
      files.set(normalizedPath, {
        content,
        createdAt: previous?.createdAt ?? timestamp,
        modifiedAt: timestamp,
      });
    },

    async writeTextFile(path: string, content: string, expectedMtime?: number): Promise<number> {
      const normalizedPath = normalizePath(path);
      ensureParentExists(normalizedPath);
      const previous = files.get(normalizedPath);
      if (expectedMtime !== undefined && previous?.modifiedAt !== expectedMtime) {
        throw Object.assign(new Error(`저장을 기다리는 동안 파일이 외부에서 바뀌었습니다: ${path}`), {
          code: 'fileModifiedExternally',
        });
      }
      const timestamp = now();
      files.set(normalizedPath, {
        content,
        createdAt: previous?.createdAt ?? timestamp,
        modifiedAt: timestamp,
      });
      return timestamp;
    },

    async deleteFile(path: string): Promise<void> {
      const normalizedPath = normalizePath(path);
      if (!files.delete(normalizedPath)) {
        throw new Error(`file does not exist: ${path}`);
      }
    },

    async renameDirectory(dirPath: string, newName: string): Promise<void> {
      const source = normalizePath(dirPath);
      const trimmedName = newName.trim();
      if (!directories.has(source)) throw new Error(`directory does not exist: ${dirPath}`);
      if (trimmedName.length === 0) throw new Error("directory name is empty");

      const parent = parentPath(source);
      const target = `${parent === "/" ? "" : parent}/${trimmedName}`;
      if (directories.has(target) || files.has(target)) {
        throw new Error(`directory already exists: ${target}`);
      }
      renameDirectoryPrefix(source, target);
    },

    async trashDirectory(dirPath: string): Promise<void> {
      const source = normalizePath(dirPath);
      const vault = currentVaultPath;
      if (!vault) throw new Error("vault is not selected");
      if (!directories.has(source)) throw new Error(`directory does not exist: ${dirPath}`);
      if (source === vault || source.startsWith(`${vault}/.trash/`)) {
        throw new Error(`directory cannot be trashed: ${dirPath}`);
      }

      const relative = source.slice(`${vault}/`.length);
      let target = `${vault}/.trash/ticksidian/${relative}`;
      let counter = 2;
      while (directories.has(target) || files.has(target)) {
        target = `${vault}/.trash/ticksidian/${relative}__${counter}`;
        counter += 1;
      }
      ensureDirectoryHierarchy(target);
      renameDirectoryPrefix(source, target);
    },

    async listDirectoryEntries(dirPath: string): Promise<VaultDirectoryEntry[]> {
      const normalizedDirPath = normalizePath(dirPath);
      if (!directories.has(normalizedDirPath)) {
        throw new Error(`directory does not exist: ${dirPath}`);
      }

      const entries: VaultDirectoryEntry[] = [];
      for (const path of directories) {
        if (path === normalizedDirPath) continue;
        if (parentPath(path) !== normalizedDirPath) continue;
        entries.push({
          path,
          name: pathName(path),
          isDir: true,
          isFile: false,
          modifiedAt: null, // 디렉터리는 mtime 제공 안 함 (Rust와 동일)
          createdAt: null,
        });
      }
      for (const path of files.keys()) {
        if (parentPath(path) !== normalizedDirPath) continue;
        const file = files.get(path);
        entries.push({
          path,
          name: pathName(path),
          isDir: false,
          isFile: true,
          modifiedAt: file?.modifiedAt ?? null,
          // 첫 쓰기 시각 = birthtime (Rust created_at과 같은 뜻, TICK-UX-006)
          createdAt: file?.createdAt ?? null,
        });
      }

      return entries.sort((a, b) => a.name.localeCompare(b.name));
    },

    async getFileStat(path: string): Promise<VaultFileStat> {
      const normalizedPath = normalizePath(path);
      const file = files.get(normalizedPath);
      if (!file) throw new Error(`file does not exist: ${path}`);
      return {
        path: normalizedPath,
        size: fileSize(file.content),
        modifiedAt: file.modifiedAt,
        createdAt: file.createdAt,
      };
    },
  };

  function renameDirectoryPrefix(source: string, target: string): void {
    const sourcePrefix = pathPrefix(source);
    const dirs = [...directories].filter((p) => p === source || p.startsWith(sourcePrefix));
    dirs.sort((a, b) => a.length - b.length);
    for (const dir of dirs) {
      const suffix = dir === source ? "" : dir.slice(sourcePrefix.length);
      directories.delete(dir);
      directories.add(suffix === "" ? target : `${target}/${suffix}`);
    }

    const fileEntries = [...files.entries()].filter(([path]) => path.startsWith(sourcePrefix));
    for (const [path, file] of fileEntries) {
      const suffix = path.slice(sourcePrefix.length);
      files.delete(path);
      files.set(`${target}/${suffix}`, file);
    }
  }
}
