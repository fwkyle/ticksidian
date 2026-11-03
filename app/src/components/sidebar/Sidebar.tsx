import type { ReactNode } from "react";
import type { NoteListItem, FolderNode } from "../../types/note";
import { FolderTreeItem } from "./FolderTreeItem";
import { NoteItem } from "./NoteItem";
import { NewFolderInput } from "./NewFolderInput";
import { RootDropZone } from "./RootDropZone";

export type SidebarTab = "notes" | "projects";

interface SidebarProps {
  notes: NoteListItem[];
  folders: FolderNode[];
  activeNoteId: string | null;
  activeTab: SidebarTab;
  showTodos: boolean;
  onSelectNote: (id: string) => void;
  onCreateNote: (folder?: string) => void;
  onDeleteNote: (id: string) => void;
  onTabChange: (tab: SidebarTab) => void;
  onToggleTodos: () => void;
  /** TickTick 검토 큐(TICK-P0-007) 열기/닫기. 없으면 버튼 숨김. */
  onToggleReviewQueue?: () => void;
  /** 검토 큐 패널이 열려 있는지 */
  showReviewQueue?: boolean;
  /** 아직 검토하지 않은(대기) 검토 카드 수. 없으면 표시 안 함. */
  reviewPendingCount?: number;
  /** 보안 메모(비밀 폴더 뷰어) 열기/닫기. 없으면 버튼 숨김. */
  onToggleSecretsViewer?: () => void;
  /** 보안 메모 패널이 열려 있는지 */
  showSecretsViewer?: boolean;
  onCreateFolder: (name: string, parent?: string) => void;
  onToggleProject: (folderPath: string, isProject: boolean) => void;
  onMoveNote: (noteId: string, toFolder: string) => void;
  /** 볼트 변경/재선택. HMR로 모듈 state가 날아간 경우나 다른 볼트로 전환할 때 사용 */
  onSelectVault?: () => void;
  /** HTML 내보내기 (TICK-P1-008). 없으면 버튼 숨김. */
  onExportSite?: () => void;
  /** HTML 내보내기 진행 중 여부 */
  exportSiteStatus?: "idle" | "exporting" | "done" | "error";
  /** HTML 내보내기 완료 메시지 또는 에러 메시지 */
  exportSiteMessage?: string;
  /** 헤더와 탭 사이에 노출되는 검색 UI (선택). */
  searchSlot?: ReactNode;
  /**
   * 사이드바 상단 헤더(앱 제목 줄) 아래에 노출되는 보조 UI.
   * 예: M3-1b의 볼트 동기화 모드/인증 상태 배지.
   */
  statusSlot?: ReactNode;
}

/* ── 메인 사이드바 ── */

export function Sidebar({
  notes,
  folders,
  activeNoteId,
  activeTab,
  showTodos,
  onSelectNote,
  onCreateNote,
  onDeleteNote,
  onTabChange,
  onToggleTodos,
  onToggleReviewQueue,
  showReviewQueue = false,
  reviewPendingCount,
  onToggleSecretsViewer,
  showSecretsViewer = false,
  onCreateFolder,
  onToggleProject,
  onMoveNote,
  onSelectVault,
  onExportSite,
  exportSiteStatus = "idle",
  exportSiteMessage,
  searchSlot,
  statusSlot,
}: SidebarProps) {
  const rootNotes = notes.filter((n) => !n.folder);
  const projectFolders = flattenProjectFolders(folders);

  return (
    <aside className="w-full h-full bg-gray-50 dark:bg-zinc-800 border-r border-gray-200 dark:border-zinc-700 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-zinc-700">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-800 dark:text-zinc-100">Ticksidian</h1>
          {activeTab === "notes" && (
            <button
              onClick={() => onCreateNote()}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 text-xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              title="새 노트"
            >
              +
            </button>
          )}
        </div>
        {statusSlot && <div className="mt-2">{statusSlot}</div>}
      </div>

      {/* 검색 슬롯 */}
      {searchSlot}

      {/* 탭 전환 */}
      <div className="flex border-b border-gray-200 dark:border-zinc-700">
        <button
          onClick={() => onTabChange("notes")}
          className={`flex-1 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
            activeTab === "notes"
              ? "text-blue-700 dark:text-blue-300 border-b-2 border-blue-500 dark:border-blue-400"
              : "text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
          }`}
        >
          노트
        </button>
        <button
          onClick={() => onTabChange("projects")}
          className={`flex-1 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
            activeTab === "projects"
              ? "text-blue-700 dark:text-blue-300 border-b-2 border-blue-500 dark:border-blue-400"
              : "text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
          }`}
        >
          프로젝트
        </button>
      </div>

      {/* 노트 탭: 폴더 트리 + 루트 노트 (드롭 가능) */}
      {activeTab === "notes" && (
        <RootDropZone onMoveNote={onMoveNote}>
          {/* 폴더 트리 */}
          {folders.map((folder) => (
            <FolderTreeItem
              key={folder.path}
              folder={folder}
              depth={0}
              notes={notes}
              activeNoteId={activeNoteId}
              onSelectNote={onSelectNote}
              onCreateNote={onCreateNote}
              onDeleteNote={onDeleteNote}
              onToggleProject={onToggleProject}
              onMoveNote={onMoveNote}
            />
          ))}

          {/* 새 폴더 생성 */}
          <NewFolderInput onSubmit={(name) => onCreateFolder(name)} />

          {/* 구분선 */}
          {folders.length > 0 && rootNotes.length > 0 && (
            <div className="my-2 h-px bg-gray-200 dark:bg-zinc-700" />
          )}

          {/* 루트 노트 */}
          {rootNotes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              depth={0}
              activeNoteId={activeNoteId}
              onSelectNote={onSelectNote}
              onDeleteNote={onDeleteNote}
            />
          ))}
        </RootDropZone>
      )}

      {/* 프로젝트 탭 */}
      {activeTab === "projects" && (
        <nav className="flex-1 overflow-y-auto p-2">
          {projectFolders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 dark:text-zinc-500 text-sm text-center px-4">
              <span className="text-2xl mb-2">◆</span>
              <p>프로젝트가 없습니다</p>
              <p className="text-xs mt-1">
                노트 탭에서 폴더의 ◆ 아이콘을 클릭하면
                <br />
                프로젝트로 설정할 수 있어요
              </p>
            </div>
          ) : (
            projectFolders.map((folder) => (
              <FolderTreeItem
                key={folder.path}
                folder={folder}
                depth={0}
                notes={notes}
                activeNoteId={activeNoteId}
                onSelectNote={onSelectNote}
                onCreateNote={onCreateNote}
                onDeleteNote={onDeleteNote}
                onToggleProject={onToggleProject}
                onMoveNote={onMoveNote}
              />
            ))
          )}
        </nav>
      )}

      {/* 하단: 투두 + 검토 큐 + 보안 메모 + HTML 내보내기 + 볼트 변경 */}
      <div className="border-t border-gray-200 dark:border-zinc-700 p-2 space-y-1">
        <button
          onClick={onToggleTodos}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            showTodos
              ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium"
              : "text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-700 hover:text-gray-700 dark:hover:text-zinc-200"
          }`}
          title="투두 열기/닫기"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          투두
        </button>

        {/* TickTick 검토 큐 버튼 (TICK-P0-007) */}
        {onToggleReviewQueue && (
          <button
            onClick={onToggleReviewQueue}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              showReviewQueue
                ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium"
                : "text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-700 hover:text-gray-700 dark:hover:text-zinc-200"
            }`}
            title="TickTick 검토 큐 열기/닫기"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.954 1.976 1.917 1.976 3.052v1.675m-18.1 0h18.1M3.026 9.25v6.75a2.25 2.25 0 002.25 2.25h13.5a2.25 2.25 0 002.25-2.25V9.25" />
            </svg>
            검토 큐
            {typeof reviewPendingCount === "number" && reviewPendingCount > 0 && (
              <span className="ms-auto rounded-full bg-blue-600 px-1.5 py-0.5 text-xs font-medium text-white">
                {reviewPendingCount}
              </span>
            )}
          </button>
        )}

        {/* 보안 메모 버튼 — 사용자가 고른 비밀 폴더 뷰어 (2026-08-15 [kyle] 요청) */}
        {onToggleSecretsViewer && (
          <button
            onClick={onToggleSecretsViewer}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              showSecretsViewer
                ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium"
                : "text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-700 hover:text-gray-700 dark:hover:text-zinc-200"
            }`}
            title="보안 메모 열기/닫기 — 읽기 전용, 값은 기본 가림"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            보안 메모
          </button>
        )}

        {/* HTML 내보내기 버튼 (TICK-P1-008) */}
        {onExportSite && (
          <div>
            <button
              onClick={onExportSite}
              disabled={exportSiteStatus === "exporting"}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-700 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
              title="볼트 노트를 정적 HTML 파일로 내보내기"
              aria-label={exportSiteStatus === "exporting" ? "내보내는 중…" : "HTML 내보내기"}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {exportSiteStatus === "exporting" ? "내보내는 중…" : "HTML 내보내기"}
            </button>
            {exportSiteMessage && (
              <p
                className={`px-3 pt-0.5 pb-1 text-xs leading-snug ${
                  exportSiteStatus === "error" ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400"
                }`}
                role="status"
                aria-live="polite"
              >
                {exportSiteMessage}
              </p>
            )}
          </div>
        )}

        {onSelectVault && (
          <button
            onClick={onSelectVault}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-700 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            title="볼트 폴더 변경/재선택"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
            볼트 변경
          </button>
        )}
      </div>
    </aside>
  );
}

/** 프로젝트 속성이 있는 폴더만 재귀적으로 수집 */
function flattenProjectFolders(nodes: FolderNode[]): FolderNode[] {
  const result: FolderNode[] = [];
  for (const node of nodes) {
    if (node.isProject) result.push(node);
    result.push(...flattenProjectFolders(node.children));
  }
  return result;
}
