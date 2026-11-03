import { useCallback, useMemo, useState } from "react";
import { useSecretsViewer } from "../../hooks/useSecretsViewer";
import { maskSecret } from "../../lib/secrets-viewer/parser";
import {
  buildSecretFileTree,
  collectFolderPaths,
} from "../../lib/secrets-viewer/tree";
import { SecretFileList } from "./SecretFileList";
import { buildNewSecretRelPath } from "../../lib/secrets-viewer/create";
import { isSecretExternalChangeError } from "../../lib/secrets-viewer/edit-errors";
import { toErrorMessage } from "../../lib/error-utils";

/**
 * 보안 메모 뷰어 패널 — 사용자가 고른 비밀 폴더 (2026-08-15 [kyle] 요청, 2026-11-02 폴더 선택).
 * 설계: docs/waterfall/03-상세설계/보안-메모-뷰어.md
 *
 * 렌더 규칙: env 계열 파일은 키만 보이고 값은 기본 가림. 비 env 파일(.pem 등)은
 * 전체를 가린다. "값 표시" 토글을 눌러야만 실제 값이 렌더된다.
 */
export function SecretsViewerPanel({ onClose }: { onClose: () => void }) {
  const {
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
  } =
    useSecretsViewer(true);
  const [reveal, setReveal] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [editMtime, setEditMtime] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const tree = useMemo(() => buildSecretFileTree(files), [files]);
  const folderOptions = useMemo(() => collectFolderPaths(tree), [tree]);
  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

  const handleSelect = useCallback((relPath: string) => {
    setReveal(false); // 파일을 바꾸면 가림 상태로 되돌린다
    setEditing(false);
    setConflict(false);
    setActionError(null);
    // 선택된 파일의 조상 폴더를 펼친다 — 필터 해제 후에도 선택이 보이게 유지한다.
    const segments = relPath.split("/");
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (let i = 1; i < segments.length; i += 1) {
        next.add(segments.slice(0, i).join("/"));
      }
      return next.size === prev.size ? prev : next;
    });
    selectFile(relPath);
  }, [selectFile]);

  const handleStartCreate = () => {
    setCreating(true);
    setCreateError(null);
    setNewFolder("");
    setNewFileName("");
    setNewContent("");
    setEditing(false);
  };

  const handleCreateSubmit = async () => {
    const relPath = buildNewSecretRelPath(newFolder, newFileName);
    if (!relPath) {
      setCreateError("파일명을 확인하세요(빈 칸 없이, / 없이).");
      return;
    }
    try {
      await createFile(relPath, newContent);
      setCreating(false);
      setCreateError(null);
    } catch (e) {
      setCreateError(toErrorMessage(e, "파일을 만들지 못했습니다."));
    }
  };

  const handleBeginEdit = async () => {
    if (!selectedPath) return;
    setActionError(null);
    try {
      const mtime = await beginEdit(selectedPath);
      setEditMtime(mtime);
      setDraft(rawContent ?? "");
      setEditing(true);
      setConflict(false);
      setCreating(false);
    } catch (e) {
      setActionError(toErrorMessage(e, "편집을 시작하지 못했습니다."));
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedPath || editMtime === null) return;
    setActionError(null);
    try {
      await saveEdit(selectedPath, draft, editMtime);
      setEditing(false);
      setConflict(false);
      await reloadFile(selectedPath);
      await refreshFiles();
    } catch (e) {
      if (isSecretExternalChangeError(e)) {
        setConflict(true);
      } else {
        setActionError(toErrorMessage(e, "저장하지 못했습니다."));
      }
    }
  };

  const handleConflictReload = async () => {
    if (!selectedPath) return;
    setActionError(null);
    try {
      // 외부 변경본 기준으로 편집을 다시 시작한다(백업 재생성 + mtime 갱신).
      const mtime = await beginEdit(selectedPath);
      const content = await reloadFile(selectedPath);
      setEditMtime(mtime);
      setDraft(content);
      setConflict(false);
    } catch (e) {
      setActionError(toErrorMessage(e, "다시 불러오지 못했습니다."));
    }
  };

  const handleRevealInFinder = async () => {
    if (!selectedPath) return;
    setActionError(null);
    try {
      await revealInFinder(selectedPath);
    } catch (e) {
      setActionError(toErrorMessage(e, "Finder에서 열지 못했습니다."));
    }
  };

  if (folder === null) {
    return (
      <div className="flex h-full flex-col bg-gray-50 dark:bg-zinc-900" role="region" aria-label="보안 메모">
        <p className="p-4 text-xs text-gray-500 dark:text-zinc-400">비밀 폴더 확인 중…</p>
      </div>
    );
  }

  if (!folder.configured) {
    return (
      <div className="flex h-full flex-col bg-gray-50 dark:bg-zinc-900" role="region" aria-label="보안 메모">
        <div className="mx-auto mt-16 max-w-md px-4 text-center">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">비밀 폴더를 고르세요</h2>
          <p className="mt-2 break-keep break-words text-pretty text-xs text-gray-600 dark:text-zinc-300">
            보안 메모는 직접 고른 폴더 안의 파일만 보여 줍니다. 비밀 파일만 둔 폴더를 고르세요.
            홈 폴더 전체나 노트 볼트를 포함한 폴더는 고를 수 없습니다.
          </p>
          {folder.reason && (
            <p
              className="mt-3 break-keep break-words text-pretty rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
              role="status"
              data-testid="secrets-folder-reason"
            >
              {folder.reason}
            </p>
          )}
          {error && (
            <p className="mt-3 break-keep break-words text-pretty rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => void chooseFolder()}
              className="min-h-11 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              비밀 폴더 고르기
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col bg-gray-50 dark:bg-zinc-900"
      role="region"
      aria-label="보안 메모"
    >
      {/* 헤더 */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">보안 메모</h2>
          <span
            className="min-w-0 max-w-[40%] truncate text-xs text-gray-400 dark:text-zinc-500"
            title={folder.path ?? undefined}
            data-testid="secrets-folder-path"
          >
            {folder.path}
          </span>
          <button
            type="button"
            onClick={() => void chooseFolder()}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            폴더 변경
          </button>
          <div className="ms-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleStartCreate}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              + 새 메모
            </button>
            {selectedPath && !editing && !creating && (
              <button
                type="button"
                onClick={() => setReveal((prev) => !prev)}
                aria-pressed={reveal}
                className={`rounded-md px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                  reveal
                    ? "bg-amber-500 text-white hover:bg-amber-600"
                    : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                }`}
                title={reveal ? "값을 다시 가립니다" : "가린 값을 화면에 표시합니다. 주의: 화면 공유/스크린샷 노출"}
              >
                {reveal ? "값 가리기" : "값 표시"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
              title="보안 메모 닫기"
              aria-label="보안 메모 닫기"
            >
              ✕
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          민감 정보 화면입니다. 화면 공유·스크린샷에 주의하세요. 삭제·이름변경은 없습니다. 수정은
          '수정' 버튼으로만 진입하며, 누르는 시점에 원본 백업이 자동으로 만들어집니다.
        </p>
        {error && (
          <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 좌: 파일 목록 */}
        <SecretFileList
          tree={tree}
          loading={loading}
          expandedFolders={expandedFolders}
          selectedPath={selectedPath}
          onToggleFolder={toggleFolder}
          onSelectFile={handleSelect}
        />

        {/* 우: 내용 뷰어 */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {creating ? (
            <div className="mx-auto max-w-3xl">
              <h3 className="mb-3 border-b border-gray-200 pb-2 text-base font-bold text-gray-900 dark:border-zinc-700 dark:text-zinc-100">
                새 보안 메모
              </h3>
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="new-secret-folder"
                    className="mb-1 block text-xs font-medium text-gray-600 dark:text-zinc-300"
                  >
                    폴더
                  </label>
                  <select
                    id="new-secret-folder"
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    aria-label="폴더"
                    className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="">루트(폴더 없음)</option>
                    {folderOptions.map((path) => (
                      <option key={path} value={path}>
                        {path}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="new-secret-filename"
                    className="mb-1 block text-xs font-medium text-gray-600 dark:text-zinc-300"
                  >
                    파일명
                  </label>
                  <input
                    id="new-secret-filename"
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    aria-label="파일명"
                    placeholder="예: api-key.env"
                    className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 font-mono text-xs text-gray-800 placeholder-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-secret-content"
                    className="mb-1 block text-xs font-medium text-gray-600 dark:text-zinc-300"
                  >
                    내용
                  </label>
                  <textarea
                    id="new-secret-content"
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    aria-label="내용"
                    rows={10}
                    placeholder={"KEY=VALUE 형태로 입력하세요"}
                    className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-2 font-mono text-xs text-gray-800 placeholder-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                  />
                </div>
                {createError && (
                  <p
                    className="rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300"
                    role="alert"
                  >
                    {createError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCreateSubmit}
                    className="min-h-11 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    만들기
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          ) : !selectedPath ? (
            <p className="mt-10 text-center text-sm text-gray-400 dark:text-zinc-500">
              왼쪽 목록에서 파일을 선택하세요. 값은 기본으로 가려집니다.
            </p>
          ) : editing ? (
            <div className="mx-auto max-w-3xl">
              <h3
                className="mb-3 break-all border-b border-gray-200 pb-2 text-base font-bold text-gray-900 dark:border-zinc-700 dark:text-zinc-100"
                data-secret-file-path={selectedPath}
              >
                {selectedPath}
              </h3>
              <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                편집 모드 — 내용이 평문으로 표시됩니다. '수정' 버튼을 누른 시점에 원본 백업이
                .backup 폴더에 만들어졌습니다(최근 5개 유지).
              </p>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="보안 메모 편집 내용"
                rows={20}
                spellCheck={false}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              {conflict && (
                <div
                  role="alert"
                  className="mt-3 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/60 dark:bg-amber-900/30 dark:text-amber-200"
                >
                  <p className="font-medium">
                    파일이 열려 있는 동안 외부에서 바뀌었습니다. 저장하지 못했습니다.
                  </p>
                  <p className="mt-1 text-amber-700 dark:text-amber-300">
                    새로 불러오면 외부 변경본으로 교체되고 백업이 다시 생성됩니다. 계속 편집하면
                    수정본은 그대로 남습니다.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={handleConflictReload}
                      className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      새로 불러와 다시 시도
                    </button>
                    <button
                      type="button"
                      onClick={() => setConflict(false)}
                      className="rounded border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:border-amber-500/60 dark:text-amber-200 dark:hover:bg-amber-900/50"
                    >
                      계속 편집
                    </button>
                  </div>
                </div>
              )}
              {actionError && (
                <p
                  className="mt-3 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300"
                  role="alert"
                >
                  {actionError}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="min-h-11 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setConflict(false);
                    setActionError(null);
                  }}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  취소
                </button>
              </div>
            </div>
          ) : contentLoading || !parsed ? (
            <p className="mt-10 text-center text-sm text-gray-400 dark:text-zinc-500">
              {contentLoading ? "파일을 여는 중…" : "내용이 비어 있습니다."}
            </p>
          ) : (
            <div className="mx-auto max-w-3xl">
              <h3
                className="mb-3 break-all border-b border-gray-200 pb-2 text-base font-bold text-gray-900 dark:border-zinc-700 dark:text-zinc-100"
                data-secret-file-path={selectedPath}
              >
                {selectedPath}
              </h3>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleBeginEdit}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={handleRevealInFinder}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  Finder에서 보기
                </button>
              </div>
              {actionError && (
                <p
                  className="mb-3 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300"
                  role="alert"
                >
                  {actionError}
                </p>
              )}
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
                {parsed.lines.map((line, index) => {
                  if (line.kind === "env") {
                    const shown = parsed.envLike
                      ? reveal
                        ? line.value
                        : maskSecret(line.value)
                      : null;
                    // envLike 파일: 키는 표시, 값은 가림. 비 envLike 파일의 env 줄도 통째로 가림 대상이다.
                    return parsed.envLike ? (
                      <div
                        key={index}
                        className="flex gap-2 border-b border-gray-100 px-3 py-1.5 font-mono text-xs last:border-b-0 dark:border-zinc-700/60"
                      >
                        <span className="shrink-0 text-gray-500 dark:text-zinc-400">{line.key}=</span>
                        <span
                          className={`min-w-0 break-all ${reveal ? "text-gray-800 dark:text-zinc-100" : "text-gray-400 dark:text-zinc-500"}`}
                        >
                          {shown}
                        </span>
                      </div>
                    ) : (
                      <MaskedTextLine key={index} text={`${line.key}=${line.value}`} reveal={reveal} />
                    );
                  }
                  if (line.kind === "comment" && parsed.envLike) {
                    return (
                      <div
                        key={index}
                        className="border-b border-gray-100 px-3 py-1.5 font-mono text-xs text-green-700 last:border-b-0 dark:border-zinc-700/60 dark:text-green-400"
                      >
                        {line.text}
                      </div>
                    );
                  }
                  return <MaskedTextLine key={index} text={line.text} reveal={reveal} />;
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 일반 텍스트 줄(.pem 본문 등): 기본 전체 가림. */
function MaskedTextLine({ text, reveal }: { text: string; reveal: boolean }) {
  if (reveal) {
    return (
      <div className="whitespace-pre-wrap break-all border-b border-gray-100 px-3 py-1.5 font-mono text-xs text-gray-800 last:border-b-0 dark:border-zinc-700/60 dark:text-zinc-100">
        {text || " "}
      </div>
    );
  }
  return (
    <div className="border-b border-gray-100 px-3 py-1.5 font-mono text-xs text-gray-400 last:border-b-0 dark:border-zinc-700/60 dark:text-zinc-500">
      {maskSecret(text)}
    </div>
  );
}
