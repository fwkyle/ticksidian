import type { NoteListItem } from "../types/note";
import { MAX_EDITABLE_NOTE_CHARS, isTooLargeToEdit } from "./note-size.ts";

/**
 * UTF-8 바이트 수는 JS 문자열 length(UTF-16 code unit)의 최대 3배까지 클 수 있다.
 * 한글 BMP 문자가 대표적인 3바이트 경우다. 이 배수를 넘으면 문자 수 판정 없이 차단해
 * 12MB 로그 파일을 자동 오픈 판정 때문에 읽지 않는다.
 */
const MAX_UTF8_BYTES_PER_JS_CHAR = 3;

export type AutoOpenSizeGate = "pass" | "inspect" | "block";

export function classifyAutoOpenSize(sizeBytes: number | null | undefined): AutoOpenSizeGate {
  if (sizeBytes === null || sizeBytes === undefined) return "inspect";
  if (sizeBytes <= MAX_EDITABLE_NOTE_CHARS) return "pass";
  if (sizeBytes > MAX_EDITABLE_NOTE_CHARS * MAX_UTF8_BYTES_PER_JS_CHAR) return "block";
  return "inspect";
}

export interface AutoOpenSelectionIO {
  getFileSize(noteId: string, folder: string): Promise<number | null>;
  readNoteContent(noteId: string, folder: string): Promise<string>;
}

/**
 * 자동 오픈 후보 순서는 스캔 결과(수정일 내림차순)를 그대로 따른다.
 * 크기 판정은 후보만 발생하며, 한 후보가 실패하면 다음 후보로 넘어간다.
 */
export async function findAutoOpenableNoteId(
  notes: readonly NoteListItem[],
  io: AutoOpenSelectionIO,
): Promise<string | null> {
  for (const note of notes) {
    if (note.type === "todo") continue;
    // Excalidraw 플러그인 그림은 에디터가 열지 않으므로 첫 화면 자동 선택에서도 제외
    // ([kyle] 2026-08-18 결정 "열 수 있는 노트만"의 연장, 2026-08-20).
    if (note.excalidrawPlugin) continue;
    // 그림은 노트 에디터가 아니라 전용 화면에서 연다 — 자동 선택 대상이 아니다.
    if (note.drawing) continue;
    const basename = note.fileBasename ?? note.id;
    try {
      const sizeBytes = await io.getFileSize(basename, note.folder);
      const gate = classifyAutoOpenSize(sizeBytes);
      if (gate === "pass") return note.id;
      if (gate === "block") continue;
      const content = await io.readNoteContent(basename, note.folder);
      if (!isTooLargeToEdit(content)) return note.id;
    } catch {
      // 자동 선택이 부팅을 막지 않는다. 읽을 수 없는 후보는 건너뛴다.
    }
  }
  return null;
}
