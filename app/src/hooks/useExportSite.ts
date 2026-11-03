import { useCallback, useState } from "react";
import type { NoteListItem } from "../types/note";
import { toErrorMessage } from "../lib/error-utils";
import { exportSite } from "../lib/html-export/export-site";
import { readNoteFile } from "../lib/local-fs";
import { mapWithConcurrency } from "../lib/async-pool";

export type ExportSiteStatus = "idle" | "exporting" | "done" | "error";

/**
 * TICK-P1-008 HTML 내보내기 — 상태와 실행을 App에서 추출한 훅.
 * notes를 LinkableNoteMeta로 변환해 각 노트의 마크다운을 읽고 exportSite를 호출한다.
 * 원본 App.tsx 로직과 동일(2026-08-15 1단계 리팩토링).
 */
export function useExportSite(notes: NoteListItem[]) {
  const [status, setStatus] = useState<ExportSiteStatus>("idle");
  const [message, setMessage] = useState<string | undefined>(undefined);

  const exportSiteNow = useCallback(async () => {
    if (status === "exporting") return;
    setStatus("exporting");
    setMessage(undefined);

    try {
      const pairs = await mapWithConcurrency(notes, 12, async (note) => {
        try {
          const { content } = await readNoteFile(note.fileBasename ?? note.id, note.folder ?? "");
          return { id: note.id, content };
        } catch {
          return { id: note.id, content: "" };
        }
      });
      const markdownByNoteId: Record<string, string> = Object.fromEntries(
        pairs.map(({ id, content }) => [id, content]),
      );

      // notes → LinkableNoteMeta 변환
      const notesMeta = notes.map((n) => ({
        noteId: n.id,
        title: n.title,
        aliases: n.aliases ?? [],
        folder: n.folder ?? "",
        filePath: n.filePath ?? `${n.folder ?? ""}/${n.fileBasename ?? n.id}.md`,
        updatedAt: n.updatedAt?.getTime() ?? 0,
        ...(n.type === "todo" ? { type: "todo" as const } : {}),
      }));

      const result = await exportSite({
        notes: notesMeta,
        markdownByNoteId,
      });

      setStatus("done");
      setMessage(`${result.noteCount}개 노트 내보냄 (.ticksidian-site/)`);
    } catch (err) {
      setStatus("error");
      setMessage(toErrorMessage(err, "내보내기에 실패했습니다."));
    }
  }, [status, notes]);

  return { status, message, exportSiteNow } as const;
}
