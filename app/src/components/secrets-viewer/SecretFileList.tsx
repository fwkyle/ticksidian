import { memo, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { collectVisibleSecretRows, filterSecretTree } from "../../lib/secrets-viewer/tree";
import type { SecretTreeNode, SecretTreeRow } from "../../lib/secrets-viewer/tree";

const PAGE_SIZE = 100;
const NO_EXPANDED_FOLDERS: ReadonlySet<string> = new Set();

interface SecretFileListProps {
  tree: readonly SecretTreeNode[];
  loading: boolean;
  expandedFolders: ReadonlySet<string>;
  selectedPath: string | null;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
}

/** 입력 상태를 본문과 분리하고, 결과 갱신보다 키 입력을 우선한다. */
export const SecretFileList = memo(function SecretFileList(props: SecretFileListProps) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const deferredQuery = useDeferredValue(query);
  return (
    <div className="flex min-h-0 w-72 min-w-56 flex-col border-r border-gray-200 dark:border-zinc-700">
      <div className="p-2">
        <input
          type="text"
          value={filter}
          onChange={event => setFilter(event.target.value)}
          placeholder="경로 필터 (예: aws, gemini)"
          aria-label="보안 메모 경로 필터"
          className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-800 placeholder-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col" aria-busy={query !== deferredQuery}>
        <SecretFileResults {...props} query={deferredQuery} />
      </div>
    </div>
  );
});

const SecretFileResults = memo(function SecretFileResults({
  tree, loading, expandedFolders, selectedPath, onToggleFolder, onSelectFile, query,
}: SecretFileListProps & { query: string }) {
  // 검색 중에는 사용자 접힘 상태와 무관하게 결과를 펼친다. 선택으로 조상을 펼쳐도 페이지를 보존한다.
  const activeFolders = query ? NO_EXPANDED_FOLDERS : expandedFolders;
  const rows = useMemo(() => collectVisibleSecretRows(
    filterSecretTree(tree, query), activeFolders, Boolean(query),
  ), [tree, query, activeFolders]);
  const [pagination, setPagination] = useState<{ rows: readonly SecretTreeRow[]; page: number } | null>(null);
  const page = pagination?.rows === rows ? pagination.page : 0;
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, rows.length);
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { scroll.current?.scrollTo(0, 0); }, [rows, page]);

  return (
    <>
      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" aria-label="보안 메모 파일 목록">
        {loading ? (
          <p className="px-2 py-4 text-xs text-gray-400 dark:text-zinc-500">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-4 text-xs text-gray-400 dark:text-zinc-500">
            {tree.length === 0 ? "파일이 없습니다." : "필터에 맞는 파일이 없습니다."}
          </p>
        ) : rows.slice(start, end).map(({ node, depth }) => node.kind === "folder" ? (
          <button
            key={node.path}
            data-secret-folder={node.path}
            type="button"
            onClick={() => onToggleFolder(node.path)}
            aria-expanded={Boolean(query) || expandedFolders.has(node.path)}
            aria-label={`${node.name} 폴더 ${query || expandedFolders.has(node.path) ? "접기" : "펼치기"}`}
            style={{ paddingInlineStart: 8 + depth * 12 }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <span aria-hidden="true" className="w-3 shrink-0 text-gray-400 dark:text-zinc-500">
              {query || expandedFolders.has(node.path) ? "▾" : "▸"}
            </span>
            <span className="min-w-0 break-all">{node.name}</span>
            <span className="ms-auto shrink-0 text-[10px] tabular-nums text-gray-400 dark:text-zinc-500">
              {query ? node.matchCount : node.fileCount}
            </span>
          </button>
        ) : (
          <button
            key={node.file.path}
            type="button"
            onClick={() => onSelectFile(node.file.path)}
            aria-current={node.file.path === selectedPath}
            style={{ paddingInlineStart: 8 + depth * 12 }}
            className={`flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              node.file.path === selectedPath
                ? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100"
                : "text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            <span className="w-full break-all font-medium">{node.file.path}</span>
            <span className="text-[10px] text-gray-400 dark:text-zinc-500">
              {(node.file.sizeBytes / 1024).toFixed(1)} KB
            </span>
          </button>
        ))}
      </div>
      {rows.length > PAGE_SIZE && (
        <nav aria-label="보안 메모 목록 페이지" className="flex items-center justify-between gap-1 border-t border-gray-200 px-2 text-xs dark:border-zinc-700">
          <button type="button" aria-label="보안 메모 이전 페이지" disabled={page === 0}
            className="min-h-11 px-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            onClick={() => setPagination({ rows, page: page - 1 })}>이전</button>
          <span role="status" className="tabular-nums">{start + 1}–{end} / {rows.length}행</span>
          <button type="button" aria-label="보안 메모 다음 페이지" disabled={end === rows.length}
            className="min-h-11 px-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            onClick={() => setPagination({ rows, page: page + 1 })}>다음</button>
        </nav>
      )}
    </>
  );
});
