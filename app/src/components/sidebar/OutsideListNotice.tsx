import type { NoteListItem } from "../../types/note";
import { isWithinFolder, type FolderSelection } from "../../lib/folder-tree";
import { filterNotesByView, type NoteListView } from "../../lib/note-list-view";
import { folderLocationLabel } from "../../lib/note-info";

/** 목록의 조건만 안내한다. 편집기·원본·저장 상태를 바꾸지 않는다. */
export function OutsideListNotice({ note, selection, view, onReveal }: {
  note: NoteListItem;
  selection: FolderSelection;
  view: NoteListView;
  onReveal: () => void;
}) {
  if (isWithinFolder(note.folder, selection) && filterNotesByView([note], view).length > 0) {
    return null;
  }

  return (
    <div
      role="status"
      data-outside-list-notice
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200
        bg-gray-50 px-4 py-2 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-900
        dark:text-zinc-300"
    >
      <p className="min-w-0 flex-1 break-keep break-words">
        현재 목록 밖의 글 · {folderLocationLabel(note.folder)} / {note.title || "제목 없음"}
      </p>
      <button
        type="button"
        onClick={onReveal}
        className="min-h-11 shrink-0 rounded px-2 font-medium underline underline-offset-2
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:min-h-8"
      >
        이 글의 목록 보기
      </button>
    </div>
  );
}
