import { useState, useCallback } from "react";
import type { NoteListItem, FolderNode } from "../../types/note";
import { NOTE_DND_TYPE } from "../../lib/dnd-types";
import { NoteItem } from "./NoteItem";

/* ── 아이콘 (인라인 SVG) ── */

function FolderIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-4 h-4 text-gray-400 dark:text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-gray-400 dark:text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-gray-400 dark:text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

/* ── 폴더 트리 아이템 (드롭 영역 + 재귀) ── */

interface FolderTreeItemProps {
  folder: FolderNode;
  depth: number;
  notes: NoteListItem[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onCreateNote: (folder?: string) => void;
  onDeleteNote: (id: string) => void;
  onToggleProject: (folderPath: string, isProject: boolean) => void;
  onMoveNote: (noteId: string, toFolder: string) => void;
}

export function FolderTreeItem({
  folder,
  depth,
  notes,
  activeNoteId,
  onSelectNote,
  onCreateNote,
  onDeleteNote,
  onToggleProject,
  onMoveNote,
}: FolderTreeItemProps) {
  const [expanded, setExpanded] = useState(true);
  const [dropOver, setDropOver] = useState(false);
  const folderNotes = notes.filter((n) => n.folder === folder.path);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.indexOf(NOTE_DND_TYPE) >= 0) {
      e.preventDefault();
      e.stopPropagation(); // 부모 폴더/RootDropZone으로 버블링 방지
      e.dataTransfer.dropEffect = "move";
      setDropOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 자식 요소로 이동할 때는 무시
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // 부모 폴더/RootDropZone으로 버블링 방지
    setDropOver(false);
    const noteId = e.dataTransfer.getData(NOTE_DND_TYPE);
    if (noteId) {
      onMoveNote(noteId, folder.path);
    }
  }, [folder.path, onMoveNote]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 폴더 행 */}
      <div
        className={`group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors ${
          dropOver ? "bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-400 dark:ring-blue-400" : "hover:bg-gray-100 dark:hover:bg-zinc-700"
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => setExpanded((p) => !p)}
      >
        <ChevronIcon open={expanded} />
        <FolderIcon open={expanded} />
        <span className="flex-1 truncate text-gray-700 dark:text-zinc-200">{folder.name}</span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleProject(folder.path, !folder.isProject); }}
            className={`w-5 h-5 flex items-center justify-center rounded text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              folder.isProject ? "text-blue-500 dark:text-blue-400" : "text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300"
            }`}
            title={folder.isProject ? "프로젝트 해제" : "프로젝트로 설정"}
          >
            ◆
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onCreateNote(folder.path); }}
            className="w-5 h-5 flex items-center justify-center rounded text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            title="이 폴더에 노트 추가"
          >
            +
          </button>
        </div>
      </div>

      {/* 하위 내용 */}
      {expanded && (
        <>
          {folder.children.map((child) => (
            <FolderTreeItem
              key={child.path}
              folder={child}
              depth={depth + 1}
              notes={notes}
              activeNoteId={activeNoteId}
              onSelectNote={onSelectNote}
              onCreateNote={onCreateNote}
              onDeleteNote={onDeleteNote}
              onToggleProject={onToggleProject}
              onMoveNote={onMoveNote}
            />
          ))}
          {folderNotes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              depth={depth + 1}
              activeNoteId={activeNoteId}
              onSelectNote={onSelectNote}
              onDeleteNote={onDeleteNote}
            />
          ))}
        </>
      )}
    </div>
  );
}
