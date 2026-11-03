import { useState, useCallback } from "react";
import { NOTE_DND_TYPE } from "../../lib/dnd-types";

/* ── 루트 드롭 영역 (노트를 루트로 이동) ── */

export function RootDropZone({
  children,
  onMoveNote,
}: {
  children: React.ReactNode;
  onMoveNote: (noteId: string, toFolder: string) => void;
}) {
  const [dropOver, setDropOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.indexOf(NOTE_DND_TYPE) >= 0) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const noteId = e.dataTransfer.getData(NOTE_DND_TYPE);
    if (noteId) {
      onMoveNote(noteId, "");
    }
  }, [onMoveNote]);

  return (
    <div
      className={`flex-1 overflow-y-auto p-2 transition-colors ${
        dropOver ? "bg-blue-50 dark:bg-blue-900/30" : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}
