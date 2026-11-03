import { useMemo, useState, type MouseEvent } from "react";

import type { FolderNode, NoteListItem } from "../../types/note";
import {
  ALL_NOTES_LABEL,
  INBOX_FOLDER,
  INBOX_LABEL,
  countNotesByFolder,
  type FolderSelection,
} from "../../lib/folder-tree";
import { sortFolderNodesForDisplay } from "../../lib/archive-folder";
import { NewFolderInput } from "./NewFolderInput";
import { filterNotesByView, NOTE_KIND_LABELS, type NoteListView } from "../../lib/note-list-view";

/**
 * FolderColumn — 3열 레이아웃의 첫 열(폴더 목록) (2026-08-18 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/사이드바-3열-레이아웃.md
 *
 * 노트는 여기 없다. 폴더만 보여주고, 고른 폴더를 옆 열(NoteColumn)이 받는다.
 * 볼트 전체 스캔 이후 537개가 한 열에 쏟아지던 문제를 이 분리로 푼다.
 */
export interface FolderColumnProps {
  readonly folders: readonly FolderNode[];
  readonly notes: readonly NoteListItem[];
  readonly view: NoteListView;
  readonly selection: FolderSelection;
  readonly onSelect: (selection: FolderSelection) => void;
  readonly onCreateFolder: (name: string, parent?: string) => void;
  readonly onToggleProject: (folderPath: string, isProject: boolean) => void;
  readonly onMoveNote: (noteId: string, toFolder: string) => void;
  /** 폴더 우클릭 메뉴를 연다. */
  readonly onFolderContextMenu: (folder: FolderNode, position: { x: number; y: number }) => void;
}

export function FolderColumn({
  folders,
  notes,
  view,
  selection,
  onSelect,
  onCreateFolder,
  onToggleProject,
  onMoveNote,
  onFolderContextMenu,
}: FolderColumnProps) {
  const visibleNotes = useMemo(() => filterNotesByView(notes, view), [notes, view]);
  const counts = useMemo(() => countNotesByFolder(visibleNotes), [visibleNotes]);
  const rootNoteCount = useMemo(() => visibleNotes.filter((n) => !n.folder).length, [visibleNotes]);
  const displayFolders = useMemo(() => sortFolderNodesForDisplay(folders).filter((folder) => folder.path !== INBOX_FOLDER), [folders]);
  const inboxFolder = folders.find((folder) => folder.path === INBOX_FOLDER);

  return (
    <aside
      data-folder-column
      className="flex h-full w-full flex-col bg-gray-50 dark:bg-zinc-900"
    >
      <div className="border-b border-gray-200 p-4 dark:border-zinc-700">
        <h1 className="text-lg font-semibold text-gray-800 dark:text-zinc-100">Ticksidian</h1>
      </div>

      <nav aria-label="폴더 목록" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {inboxFolder ? (
          <FolderBranch
            folder={inboxFolder}
            depth={0}
            counts={counts}
            selection={selection}
            onSelect={onSelect}
            onToggleProject={onToggleProject}
            onMoveNote={onMoveNote}
            onFolderContextMenu={onFolderContextMenu}
          />
        ) : (
          <FolderRow
            label={INBOX_LABEL}
            count={counts.get(INBOX_FOLDER) ?? 0}
            depth={0}
            selected={selection === INBOX_FOLDER}
            onSelect={() => onSelect(INBOX_FOLDER)}
            onMoveNote={(noteId) => onMoveNote(noteId, INBOX_FOLDER)}
          />
        )}
        <FolderRow
          label={ALL_NOTES_LABEL}
          count={visibleNotes.length}
          depth={0}
          selected={selection === null}
          onSelect={() => onSelect(null)}
          onMoveNote={(noteId) => onMoveNote(noteId, "")}
          icon="◎"
        />

        <div className="sticky top-0 z-10 mt-3 bg-gray-50 pb-2 dark:bg-zinc-900">
          <div className="flex min-h-11 items-center gap-2">
            <h2 className="shrink-0 pl-3 text-xs font-semibold text-gray-600 dark:text-zinc-400">폴더</h2>
            <div className="ml-auto min-w-0">
              <NewFolderInput onSubmit={(name) => onCreateFolder(name)} />
            </div>
          </div>
          <p className="break-keep break-words px-3 text-pretty text-xs text-gray-500 dark:text-zinc-400">
            {view.kind === "todo" && view.hideDone ? "남은 할 일" : NOTE_KIND_LABELS[view.kind]} 개수 · 하위 폴더 포함
          </p>
        </div>
        {displayFolders.map((folder) => (
          <FolderBranch
            key={folder.path}
            folder={folder}
            depth={0}
            counts={counts}
            selection={selection}
            onSelect={onSelect}
            onToggleProject={onToggleProject}
            onMoveNote={onMoveNote}
            onFolderContextMenu={onFolderContextMenu}
          />
        ))}

        {rootNoteCount > 0 && (
          <p className="px-2 pt-2 text-xs text-gray-400 dark:text-zinc-500">
            폴더 없는 노트 {rootNoteCount}개는 “{ALL_NOTES_LABEL}”에 있습니다
          </p>
        )}

      </nav>
    </aside>
  );
}

/** 폴더 하나 + 하위 폴더(접기/펴기). */
function FolderBranch({
  folder,
  depth,
  counts,
  selection,
  onSelect,
  onToggleProject,
  onMoveNote,
  onFolderContextMenu,
}: {
  folder: FolderNode;
  depth: number;
  counts: Map<string, number>;
  selection: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
  onToggleProject: (folderPath: string, isProject: boolean) => void;
  onMoveNote: (noteId: string, toFolder: string) => void;
  onFolderContextMenu: (folder: FolderNode, position: { x: number; y: number }) => void;
}) {
  // 기본은 접힘. 537개짜리 볼트에서 전부 펼쳐져 있으면 첫 열도 길어진다.
  const [expanded, setExpanded] = useState(false);
  const hasChildren = folder.children.length > 0;

  return (
    <div>
      <FolderRow
        label={folder.path === INBOX_FOLDER ? INBOX_LABEL : folder.name}
        count={counts.get(folder.path) ?? 0}
        depth={depth}
        selected={selection === folder.path}
        onSelect={() => onSelect(folder.path)}
        onMoveNote={(noteId) => onMoveNote(noteId, folder.path)}
        expandable={hasChildren}
        expanded={expanded}
        onToggleExpand={() => setExpanded((prev) => !prev)}
        isProject={folder.isProject === true}
        onToggleProject={() => onToggleProject(folder.path, !folder.isProject)}
        onContextMenu={(event) => {
          event.preventDefault();
          onFolderContextMenu(folder, { x: event.clientX, y: event.clientY });
        }}
      />
      {expanded &&
        folder.children.map((child) => (
          <FolderBranch
            key={child.path}
            folder={child}
            depth={depth + 1}
            counts={counts}
            selection={selection}
            onSelect={onSelect}
            onToggleProject={onToggleProject}
            onMoveNote={onMoveNote}
            onFolderContextMenu={onFolderContextMenu}
          />
        ))}
    </div>
  );
}

/** 폴더 목록의 한 줄. 노트를 끌어와 떨어뜨리면 그 폴더로 옮긴다. */
function FolderRow({
  label,
  count,
  depth,
  selected,
  onSelect,
  onMoveNote,
  expandable = false,
  expanded = false,
  onToggleExpand,
  isProject = false,
  onToggleProject,
  onContextMenu,
  icon,
}: {
  label: string;
  count: number;
  depth: number;
  selected: boolean;
  onSelect: () => void;
  onMoveNote: (noteId: string) => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  isProject?: boolean;
  onToggleProject?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  icon?: string;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      data-folder-row={label}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(NOTE_DND_TYPE)) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const noteId = e.dataTransfer.getData(NOTE_DND_TYPE);
        if (noteId) onMoveNote(noteId);
      }}
      className={`flex items-center rounded ${dragOver ? "bg-blue-50 dark:bg-blue-900/30" : ""}`}
      style={{ paddingLeft: depth * 12 }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={`${label} ${expanded ? "접기" : "펴기"}`}
          aria-expanded={expanded}
          className="flex h-6 w-5 shrink-0 items-center justify-center text-xs text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          {expanded ? "⌄" : "›"}
        </button>
      ) : (
        <span className="w-5 shrink-0" aria-hidden="true" />
      )}

      <button
        type="button"
        data-folder-select={label}
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-2 text-left text-sm font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
          selected
            ? "bg-selection text-gray-800 dark:text-zinc-100"
            : "text-gray-700 hover:bg-gray-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
        }`}
      >
        {/* 폴더 문서 아이콘(🗀)은 2026-08-29 [kyle] 요청으로 뗐다. 글꼴에 따라
            바코드처럼 뭉개져 보이고 위계에 도움이 되지 않는다. */}
        {icon && (
          <span className="shrink-0 text-gray-400 dark:text-zinc-500" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="truncate font-bold">{label}</span>
        {count >= 0 && (
          <span className="ms-auto shrink-0 text-xs tabular-nums text-gray-400 dark:text-zinc-500">{count}</span>
        )}
      </button>

      {onToggleProject && (
        <button
          type="button"
          onClick={onToggleProject}
          aria-label={`${label} 프로젝트 ${isProject ? "해제" : "설정"}`}
          className={`mr-1 shrink-0 rounded px-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            isProject
              ? "text-blue-500 dark:text-blue-400"
              : "text-transparent hover:text-gray-400 dark:hover:text-zinc-500"
          }`}
          title={isProject ? "프로젝트 해제" : "프로젝트로 설정"}
        >
          ◆
        </button>
      )}
    </div>
  );
}
import { NOTE_DND_TYPE } from "../../lib/dnd-types";
