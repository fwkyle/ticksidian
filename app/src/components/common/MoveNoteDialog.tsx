import { useRef, useState } from "react";
import type { NoteListItem } from "../../types/note";
import { folderLocationLabel } from "../../lib/note-info";
import { ModalDialog } from "./ModalDialog";

/** 이동의 확인/진행 상태만 소유한다. 파일 변경은 기존 이동 경계에 위임한다. */
export function MoveNoteDialog({ note, folders, onMove, onClose }: {
  note: NoteListItem;
  folders: readonly string[];
  onMove: (folder: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState(note.folder);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const allowed = destination === "" || folders.includes(destination);
  const disabled = pending || !allowed || destination === note.folder;
  const close = () => { if (!busy.current) onClose(); };

  const submit = async () => {
    if (busy.current || disabled) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (await onMove(destination)) onClose();
      else setError("이동하지 못했습니다. 안내를 확인한 뒤 다시 시도해 주세요.");
    } catch {
      setError("이동하지 못했습니다. 선택한 폴더를 확인하고 다시 시도해 주세요.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <ModalDialog title="다른 폴더로 이동" onClose={close} closeOnOverlayClick={!pending}>
      <form
        className="space-y-4 break-keep break-words"
        aria-busy={pending}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        <p className="text-sm text-gray-700 dark:text-zinc-200">{note.title || "제목 없음"}</p>
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          현재 위치: {folderLocationLabel(note.folder)}
        </p>
        <label className="block text-sm text-gray-700 dark:text-zinc-200">
          이동할 폴더
          <select
            value={destination}
            disabled={pending}
            onChange={(event) => { setDestination(event.target.value); setError(null); }}
            className="mt-1 min-h-11 w-full rounded border border-gray-300 bg-white px-3
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
              dark:border-zinc-600 dark:bg-zinc-900"
          >
            <option value="">{folderLocationLabel("")}</option>
            {folders.map((path) => <option key={path} value={path}>{folderLocationLabel(path)}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button" onClick={close} disabled={pending}
            className="min-h-11 rounded border border-gray-300 px-4 text-sm text-gray-700
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
              disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
          >취소</button>
          <button
            type="submit" disabled={disabled}
            className="min-h-11 rounded bg-blue-600 px-4 text-sm text-white hover:bg-blue-700
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50"
          >{pending ? "이동 중…" : "이동"}</button>
        </div>
      </form>
    </ModalDialog>
  );
}
