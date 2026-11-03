import { memo, useCallback } from "react";
import type { NoteListItem } from "../../types/note";
import { isNoteDraggable, setNoteDragData } from "../../lib/dnd-types";
import { folderLocationLabel } from "../../lib/note-info";

/* ── 노트 아이템 (드래그 소스) ── */

interface NoteItemProps {
  note: NoteListItem;
  depth: number;
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
  onNoteContextMenu?: (note: NoteListItem, position: { x: number; y: number }) => void;
}

export const NoteItem = memo(function NoteItem({ note, depth, activeNoteId, onSelectNote, onDeleteNote, onContextMenu, onNoteContextMenu }: NoteItemProps) {
  const handleDragStart = useCallback((e: React.DragEvent) => {
    setNoteDragData(e.dataTransfer, note.id);
  }, [note.id]);

  return (
    <div
      data-list-item={note.title || "제목 없음"}
      draggable={isNoteDraggable(note)}
      onDragStart={handleDragStart}
      onContextMenu={onContextMenu ?? (onNoteContextMenu ? (event) => {
        event.preventDefault();
        onNoteContextMenu(note, { x: event.clientX, y: event.clientY });
      } : undefined)}
      className={`note-list-row group relative flex items-center rounded-md text-sm font-medium leading-5 h-11 md:h-10 cursor-grab active:cursor-grabbing ${
        note.id === activeNoteId
          ? "bg-selection text-gray-800 dark:text-zinc-100"
          : "text-gray-600 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-700"
      }`}
      style={{ paddingLeft: `${depth * 16}px`, WebkitUserDrag: "element" } as React.CSSProperties}
    >
      <button
        draggable={false}
        aria-current={note.id === activeNoteId ? "true" : undefined}
        title={`${note.title || "제목 없음"} · ${folderLocationLabel(note.folder)}`}
        onClick={() => onSelectNote(note.id)}
        className="note-list-title h-full min-w-0 flex-1 px-2.5 py-2 text-left font-semibold rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
      >
        <span className="block truncate">{note.title || "제목 없음"}</span>
      </button>
      {note.id !== "welcome" && (
        <button
          draggable={false}
          onClick={() => onDeleteNote(note.id)}
          className="note-list-delete h-full w-11 shrink-0 rounded text-gray-500 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-400"
          title="삭제"
          aria-label={`${note.title || "제목 없음"} 삭제`}
        >
          ×
        </button>
      )}
    </div>
  );
});
