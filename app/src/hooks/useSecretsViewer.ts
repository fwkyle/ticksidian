import { useCallback, useEffect, useState } from "react";
import {
  beginSecretEdit,
  createSecretFile,
  getSecretsFolderStatus,
  listSecretFiles,
  readSecretFile,
  revealSecretInFinder,
  selectSecretsFolder,
  writeSecretFile,
} from "../lib/tauri-commands";
import type { SecretFileMeta, SecretsFolderStatus } from "../lib/tauri-commands";
import { parseSecretFileContent } from "../lib/secrets-viewer/parser";
import type { ParsedSecretFile } from "../lib/secrets-viewer/parser";
import { toErrorMessage } from "../lib/error-utils";

/**
 * 보안 메모 뷰어 훅 (사용자가 고른 비밀 폴더, 2026-08-15 [kyle] 요청 + 2026-08-20 쓰기 확장 + 2026-11-02 폴더 선택).
 * 목록은 마운트 시 1회, 내용은 파일 선택 시 읽는다. 읽기 실패는 error 상태로만 노출하고,
 * 쓰기(생성/편집/Finder) 호출은 호출자가 결과를 판단해야 하므로 그대로 throw한다.
 */
export interface UseSecretsViewerReturn {
  /** null = 상태 확인 중. configured=false면 목록 대신 폴더 선택 안내를 보인다. */
  readonly folder: SecretsFolderStatus | null;
  readonly chooseFolder: () => Promise<void>;
  readonly files: readonly SecretFileMeta[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedPath: string | null;
  readonly parsed: ParsedSecretFile | null;
  readonly rawContent: string | null;
  readonly contentLoading: boolean;
  readonly selectFile: (relPath: string) => void;
  readonly reloadFile: (relPath: string) => Promise<string>;
  readonly refreshFiles: () => Promise<void>;
  readonly createFile: (relPath: string, content: string) => Promise<void>;
  readonly beginEdit: (relPath: string) => Promise<string>;
  readonly saveEdit: (
    relPath: string,
    content: string,
    expectedMtime: string,
  ) => Promise<string>;
  readonly revealInFinder: (relPath: string) => Promise<void>;
}

export function useSecretsViewer(enabled: boolean): UseSecretsViewerReturn {
  const [folder, setFolder] = useState<SecretsFolderStatus | null>(null);
  const [files, setFiles] = useState<readonly SecretFileMeta[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSecretFile | null>(null);
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getSecretsFolderStatus()
      .then((status) => {
        if (cancelled) return null;
        setFolder(status);
        return status.configured ? listSecretFiles() : [];
      })
      .then((list) => {
        if (cancelled || list === null) return;
        setFiles(list);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[useSecretsViewer] list failed:", e);
        setError(toErrorMessage(e, "보안 메모 목록을 불러오지 못했습니다."));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const chooseFolder = useCallback(async (): Promise<void> => {
    try {
      const status = await selectSecretsFolder();
      if (!status) return; // 선택 취소
      setFolder(status);
      setSelectedPath(null);
      setParsed(null);
      setRawContent(null);
      setFiles(await listSecretFiles());
      setError(null);
    } catch (e) {
      console.error("[useSecretsViewer] choose folder failed:", e);
      setError(toErrorMessage(e, "비밀 폴더를 설정하지 못했습니다."));
    }
  }, []);

  const selectFile = useCallback((relPath: string) => {
    setSelectedPath(relPath);
    setParsed(null);
    setRawContent(null);
    setContentLoading(true);
    readSecretFile(relPath)
      .then((content) => {
        setParsed(parseSecretFileContent(content));
        setRawContent(content);
        setError(null);
      })
      .catch((e) => {
        console.error("[useSecretsViewer] read failed:", e);
        setError(toErrorMessage(e, "파일을 읽지 못했습니다."));
      })
      .finally(() => setContentLoading(false));
  }, []);

  const reloadFile = useCallback((relPath: string): Promise<string> => {
    setContentLoading(true);
    return readSecretFile(relPath)
      .then((content) => {
        setParsed(parseSecretFileContent(content));
        setRawContent(content);
        setError(null);
        return content;
      })
      .finally(() => setContentLoading(false));
  }, []);

  const refreshFiles = useCallback(async (): Promise<void> => {
    try {
      const list = await listSecretFiles();
      setFiles(list);
    } catch (e) {
      console.error("[useSecretsViewer] refresh failed:", e);
      setError(toErrorMessage(e, "보안 메모 목록을 갱신하지 못했습니다."));
    }
  }, []);

  const createFile = useCallback(
    async (relPath: string, content: string): Promise<void> => {
      await createSecretFile(relPath, content);
      await refreshFiles();
      selectFile(relPath);
    },
    [refreshFiles, selectFile],
  );

  const beginEdit = useCallback((relPath: string): Promise<string> => {
    return beginSecretEdit(relPath);
  }, []);

  const saveEdit = useCallback(
    (relPath: string, content: string, expectedMtime: string): Promise<string> => {
      return writeSecretFile(relPath, content, expectedMtime);
    },
    [],
  );

  const revealInFinder = useCallback((relPath: string): Promise<void> => {
    return revealSecretInFinder(relPath);
  }, []);

  return {
    folder,
    chooseFolder,
    files,
    loading,
    error,
    selectedPath,
    parsed,
    rawContent,
    contentLoading,
    selectFile,
    reloadFile,
    refreshFiles,
    createFile,
    beginEdit,
    saveEdit,
    revealInFinder,
  };
}
