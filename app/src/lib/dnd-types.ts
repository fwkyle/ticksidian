import type { NoteListItem } from "../types/note";

/** 노트/투두를 드래그할 때 사용하는 공유 DnD MIME 타입 식별자. */
export const NOTE_DND_TYPE = "application/x-ticksidian-note";

/** 폴더로 끌어 옮길 수 있는 항목인지. 그림은 `.md` 이동 경로를 쓰지 않으므로 끌 수 없다. */
export function isNoteDraggable(note: Pick<NoteListItem, "drawing" | "excalidrawPlugin">): boolean {
  return !note.drawing && !note.excalidrawPlugin;
}

/** 노트 끌기 시작 데이터. 받는 쪽(폴더 항목·폴더 열·루트 영역)은 이 ID로 기존 이동 경로를 탄다. */
export function setNoteDragData(dataTransfer: DataTransfer, noteId: string): void {
  dataTransfer.setData(NOTE_DND_TYPE, noteId);
  dataTransfer.effectAllowed = "move";
}
