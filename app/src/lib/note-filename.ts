/**
 * note-filename.ts — 파일명-제목 동기화의 순수 규칙 (2026-08-18 [kyle] 결정).
 *
 * 새 노트의 UUID 파일명을 제목으로 바꾸고(1단계), 사용자가 제목을 실제로 바꾼
 * 노트의 파일명을 따라가게 한다(2단계). 실행 시점/IO는 useFilenameSync가 맡고,
 * 이 모듈은 "바꿀지, 무엇으로 바꿀지"만 판정한다.
 *
 * 설계: docs/waterfall/03-상세설계/파일명-제목-동기화.md
 */

import type { NoteListItem } from "../types/note";

/** 파일 이름 끝의 `.md`만 자른다. 이름 중간의 `.md`(`CLAUDE.md 정리.md`)는 보존한다. */
export function stripMarkdownExtension(fileName: string): string {
  return fileName.endsWith(".md") ? fileName.slice(0, -".md".length) : fileName;
}

/** crypto.randomUUID() 형식 — createNoteInternal/addTodo가 만드는 파일명. */
const UUID_BASENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 앱이 만든 기본 제목 — 이 제목으로는 rename하지 않는다. */
const DEFAULT_TITLES = new Set(["새 노트", "새 투두"]);

/**
 * 검토 큐 2차 변환본(`ticktick-{원본ID}.md`)은 sourceKey↔경로 계약(preexisting 검사)이
 * 파일명에 걸려 있어 rename 대상에서 제외한다(잠긴 계약 11 연관).
 */
const PROTECTED_BASENAME_PREFIX = "ticktick-";

/** 파일명에 쓸 수 없는 문자 — Windows 금지 + 옵시디언 링크 문법 + 제어 문자. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS_RE = /[/\\:*?"<>|#^[\]\u0000-\u001f]/g;

const MAX_BASENAME_LENGTH = 80;

export function isUuidBasename(stem: string): boolean {
  return UUID_BASENAME_RE.test(stem);
}

/**
 * 제목을 안전한 파일명 stem으로 정리한다. 쓸 수 없으면 null.
 * 선행 `.`은 숨김 파일(스캔 제외)이 되므로 제거한다.
 */
export function sanitizeTitleForFilename(title: string): string | null {
  const cleaned = title
    .replace(FORBIDDEN_CHARS_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, MAX_BASENAME_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * 볼트 전체(폴더 무관) + 대소문자 무시 기준으로 유일한 stem을 만든다.
 * 충돌 시 옵시디언과 같은 `제목 1`, `제목 2` 접미사.
 *
 * 폴더별이 아니라 볼트 전체인 이유: 현재 id 체계는 stem이 겹치면 **다른 폴더의
 * 기존 노트 id까지** `stem__folder`로 바뀐다(assignDeterministicNoteIds). rename이
 * 남의 노트 id를 흔들지 않으려면 볼트 전체 유일이 필요하다.
 */
export function resolveBasenameCollision(
  desired: string,
  takenLowercase: ReadonlySet<string>,
): string {
  if (!takenLowercase.has(desired.toLowerCase())) return desired;
  for (let n = 1; ; n++) {
    const candidate = `${desired} ${n}`;
    if (!takenLowercase.has(candidate.toLowerCase())) return candidate;
  }
}

export interface FilenameSyncPlan {
  readonly noteId: string;
  readonly folder: string;
  readonly fromBasename: string;
  readonly toBasename: string;
}

/**
 * 이 노트의 파일명을 제목으로 바꿔야 하는지 판정하고, 바꾼다면 어떤 이름으로
 * 바꿀지 계획을 돌려준다. 바꾸지 않으면 null.
 *
 * @param titleChanged 이번 세션에서 사용자가 이 노트의 제목을 실제로 바꿨는가(2단계).
 *   false여도 UUID 파일명(1단계)이면 대상이다. 정적으로 "H1 ≠ 파일명"인 옵시디언
 *   기존 노트를 건드리지 않기 위한 구분이다.
 * @param extraTakenLowercase 같은 배치에서 방금 배정한 이름들(소문자). 여러 노트를
 *   연속 rename할 때 목록 상태가 아직 갱신되지 않아도 충돌하지 않게 한다.
 */
export function planFilenameSync(
  note: NoteListItem,
  allNotes: readonly NoteListItem[],
  {
    titleChanged,
    extraTakenLowercase,
  }: { titleChanged: boolean; extraTakenLowercase?: ReadonlySet<string> },
): FilenameSyncPlan | null {
  const currentBasename = note.fileBasename ?? note.id;
  // 그림(`*.excalidraw`)은 노트가 아니다 — 제목-파일명 동기화 대상에서 뺀다(TICK-DRAW-001).
  if (note.drawing) return null;
  if (currentBasename.startsWith(PROTECTED_BASENAME_PREFIX)) return null;
  if (!titleChanged && !isUuidBasename(currentBasename)) return null;

  const title = note.title?.trim() ?? "";
  if (title.length === 0 || DEFAULT_TITLES.has(title)) return null;

  const desired = sanitizeTitleForFilename(title);
  if (desired === null) return null;

  const desiredLower = desired.toLowerCase();
  const currentLower = currentBasename.toLowerCase();
  if (currentLower === desiredLower) return null;
  // 이미 이 제목의 숫자 접미 변형(`제목 1`)이면 유지한다 — 매번 밀리는 rename 방지.
  if (new RegExp(`^${escapeRegExp(desiredLower)} \\d+$`).test(currentLower)) {
    return null;
  }

  const taken = new Set<string>(extraTakenLowercase);
  for (const other of allNotes) {
    if (other.id === note.id) continue;
    taken.add((other.fileBasename ?? other.id).toLowerCase());
  }

  return {
    noteId: note.id,
    folder: note.folder,
    fromBasename: currentBasename,
    toBasename: resolveBasenameCollision(desired, taken),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
