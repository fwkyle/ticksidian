/**
 * note-info.ts — 지금 열어 둔 항목의 신원 정보를 만드는 순수 규칙 (2026-08-18 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/노트-정보-바.md
 * Node QA: app/qa-note-info.mjs
 *
 * Why: [kyle]이 목록의 `ticktick-inbox`를 **폴더명으로 오해**했다. 아무 표시 없이 제목
 * 아래 회색으로 붙어 있었고, 실제로 같은 이름의 폴더가 왼쪽에 있었기 때문이다.
 * 태그에는 `#`을 붙이고, 본문 위에 "이 노트가 뭐고 어디 있는지"를 한 줄로 세운다.
 *
 * 필요한 값은 `NoteListItem`에 이미 전부 있다. 새로 읽는 IO는 없다.
 */

import type { NoteListItem } from "../types/note";
import { INBOX_FOLDER, INBOX_LABEL } from "./folder-tree.ts";

export interface NoteInfoDetail {
  /**
   * 행의 안정 식별자. 화면 라벨(label)은 문구 변경될 수 있어 편집 컨트롤 매칭에
   * 쓰지 않는다(2026-08-18 검수 후속 P3 — NoteInfoBar 문자열 매칭 취약성).
   */
  readonly key:
    | "kind"
    | "dueDate"
    | "priority"
    | "location"
    | "file"
    | "tags"
    | "aliases"
    | "createdAt"
    | "updatedAt";
  readonly label: string;
  /** 값이 없어도 "없음"이 들어간다 — 행이 사라지면 "정보 없음"과 "안 그림"을 구분할 수 없다. */
  readonly value: string;
}

export interface NoteInfo {
  readonly isTodo: boolean;
  /** 화면에 그대로 쓰는 종류 라벨. 투두는 완료 여부까지 담는다. */
  readonly kindLabel: string;
  readonly done: boolean;
  /** 볼트 루트 기준 폴더 경로. 루트면 "" */
  readonly folderPath: string;
  /** 사람이 읽는 위치 라벨. 루트면 "볼트 최상위" */
  readonly folderLabel: string;
  /** 빵부스러기 조각. 루트면 빈 배열 */
  readonly folderSegments: readonly string[];
  /** `#`이 붙은 표시용 태그 */
  readonly tags: readonly string[];
  readonly details: readonly NoteInfoDetail[];
}

/** 볼트 최상위를 가리키는 라벨. 빈 문자열을 그대로 보여주면 위치가 사라진 것처럼 보인다. */
export const ROOT_FOLDER_LABEL = "볼트 최상위";
/** 값이 없을 때 쓰는 표기. */
export const EMPTY_VALUE = "없음";

/** 태그에 `#`을 붙인다. 이미 붙어 있으면 중복해서 붙이지 않는다. */
export function formatTag(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed === "") return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

/** 저장용 원시 태그. 표시용 `#`이 붙어 있으면 뗀다. */
function stripTagPrefix(tag: string): string {
  return tag.trim().replace(/^#+/, "").trim();
}

/**
 * 정보 바 태그 입력을 저장용 목록으로 바꾼다(2026-08-23 TICK-UX-007).
 * 쉼표·공백으로 여러 개를 나누고, 앞의 `#`을 떼고, 빈 조각은 버린다.
 * 옵시디언 태그에는 공백이 들어갈 수 없으므로 공백도 구분자다.
 */
export function parseTagInput(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map(stripTagPrefix)
    .filter((tag) => tag !== "");
}

/**
 * 기존 태그 뒤에 새 입력을 붙인다. 대소문자만 다른 중복은 추가하지 않는다
 * (옵시디언도 태그를 대소문자 무시로 같은 것으로 본다). 기존 순서는 유지한다.
 */
export function addTags(existing: readonly string[], raw: string): string[] {
  const seen = new Set(existing.map((tag) => tag.toLowerCase()));
  const next = [...existing];
  for (const tag of parseTagInput(raw)) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(tag);
  }
  return next;
}

/** 태그 하나를 뺀다. 표시값(`#tag`)으로 불러도 된다. */
export function removeTag(existing: readonly string[], tag: string): string[] {
  const target = stripTagPrefix(tag).toLowerCase();
  return existing.filter((item) => stripTagPrefix(item).toLowerCase() !== target);
}

/** 폴더 경로를 조각으로 쪼갠다. 빈 segment(`a//b`, 앞뒤 `/`)는 버린다. */
export function folderBreadcrumb(folder: string): string[] {
  return folder.split("/").filter((segment) => segment !== "");
}

/** 루트 기본함의 화면 이름만 바꾼다. 원본 경로와 하위 폴더 이름은 보존한다. */
export function folderLocationLabel(folder: string): string {
  const segments = folderBreadcrumb(folder);
  if (segments[0] === INBOX_FOLDER) segments[0] = INBOX_LABEL;
  return segments.length > 0 ? segments.join(" / ") : ROOT_FOLDER_LABEL;
}

function joinOrEmpty(values: readonly string[]): string {
  return values.length > 0 ? values.join(" ") : EMPTY_VALUE;
}

/**
 * 정보 바가 쓸 값을 한 번에 만든다.
 *
 * `formatDateTime`을 주입받는 이유: 날짜 문자열을 안에서 만들면 Node QA가 실행 환경의
 * 로케일과 시간대에 따라 흔들린다. 화면은 `toLocaleString`을, QA는 고정 포맷을 넘긴다.
 */
export function buildNoteInfo(
  note: NoteListItem,
  formatDateTime: (date: Date | undefined) => string,
): NoteInfo {
  const isTodo = note.type === "todo";
  const done = note.done === true;
  const folderPath = note.folder ?? "";
  const folderSegments = folderBreadcrumb(folderPath);
  const folderLabel = folderLocationLabel(folderPath);
  const tags = (note.tags ?? []).map(formatTag).filter((tag) => tag !== "");
  const aliases = (note.aliases ?? []).filter((alias) => alias.trim() !== "");
  const fileName = `${note.fileBasename}.md`;
  const filePath = note.filePath ?? (folderPath ? `${folderPath}/${fileName}` : fileName);

  const details: NoteInfoDetail[] = [
    { key: "kind", label: "종류", value: isTodo ? (done ? "투두 (완료)" : "투두 (미완료)") : "노트" },
  ];

  if (isTodo) {
    details.push(
      { key: "dueDate", label: "기한", value: note.dueDate?.trim() || EMPTY_VALUE },
      { key: "priority", label: "우선순위", value: note.priority?.trim() || EMPTY_VALUE },
    );
  }

  details.push(
    { key: "location", label: "위치", value: folderPath || ROOT_FOLDER_LABEL },
    { key: "file", label: "파일", value: filePath },
    { key: "tags", label: "태그", value: joinOrEmpty(tags) },
    { key: "aliases", label: "별칭", value: joinOrEmpty(aliases) },
    { key: "createdAt", label: "생성", value: formatDateTime(note.createdAt) || EMPTY_VALUE },
    { key: "updatedAt", label: "수정", value: formatDateTime(note.updatedAt) || EMPTY_VALUE },
  );

  return {
    isTodo,
    kindLabel: isTodo ? (done ? "완료" : "투두") : "노트",
    done,
    folderPath,
    folderLabel,
    folderSegments,
    tags,
    details,
  };
}
