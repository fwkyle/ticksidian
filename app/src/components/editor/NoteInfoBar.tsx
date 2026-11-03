import { useMemo, useState, type ReactNode } from "react";

import type { NoteListItem } from "../../types/note";
import { ROOT_FOLDER_LABEL, addTags, buildNoteInfo, folderLocationLabel, removeTag } from "../../lib/note-info";
import { PRIORITY_LEVELS } from "../../lib/priority";
import { PriorityFlag } from "../common/PriorityFlag";

/**
 * NoteInfoBar — 본문 위 "이 노트가 뭐고 어디 있는지" 한 줄 (2026-08-18 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/노트-정보-바.md
 *       docs/waterfall/03-상세설계/정보-바-태그-폴더-편집.md (2026-08-23 TICK-UX-007 편집)
 *
 * Why: [kyle]이 목록의 `ticktick-inbox`를 폴더명으로 오해했고, 본문에서는 지금 보는 것이
 * 노트인지 투두인지·어느 폴더인지 알 방법이 없었다. 종류 배지 + 폴더 + `#`태그를 한 줄로
 * 세우고, 나머지는 `상세`로 접어 둔다(위키링크 배너와 같은 규칙 — 본문을 밀지 않는다).
 * 2026-08-23부터 태그 추가/삭제와 폴더 이동도 이 자리에서 한다. 저장은 전부 에디터 경유다.
 */
export interface NoteInfoBarProps {
  readonly note: NoteListItem;
  /** 편집기가 실제 읽기·저장에 쓰는 절대경로. */
  readonly filePath: string;
  /** 저장 상태와 오류는 접지 않고 정보 줄 앞에 표시한다. */
  readonly status?: ReactNode;
  /** 폴더 칩을 누르면 목록 열을 그 폴더로 옮긴다. 편집 중인 노트는 그대로 둔다. */
  readonly onSelectFolder?: (folder: string) => void;
  /**
   * 투두 마감일/우선순위를 그 자리에서 고친다(2026-08-18 TICK-UX-008 1단계).
   * 대상 노트는 이 바가 받은 note뿐이므로 noteId는 넘기지 않는다.
   * 저장은 에디터 경유(handleTodoMetaUpdate → saveToFile)다 — 검수 후속 P1.
   */
  readonly onUpdateTodoField?: (
    field: "dueDate" | "priority",
    value: string | undefined,
  ) => void;
  /** 태그 추가/삭제 결과(저장용 원시 목록, `#` 없음). 에디터 경유 저장(TICK-UX-007). */
  readonly onUpdateTags?: (tags: string[]) => void;
  /** 태그 칩 본문을 누르면 그 태그로 검색한다(TICK-UX-007). */
  readonly onSearchTag?: (tag: string) => void;
  /**
   * 즐겨찾기(별표) 토글(2026-09-19 TICK-UX-013). 목록 맨 위 고정에 반영된다.
   * 저장은 태그와 같은 에디터 경유 경로다 — 별표만 바뀌어도 updatedAt이 갱신된다.
   */
  readonly onUpdateFavorite?: (favorite: boolean) => void;
  /** 폴더 이동 선택지(볼트 상대 경로). 없으면 이동 컨트롤을 그리지 않는다. */
  readonly folderOptions?: readonly string[];
  /** 상세 "위치" 행에서 고른 폴더로 이동(TICK-UX-007, 에디터 경유). */
  readonly onMoveToFolder?: (folder: string) => void;
  readonly onToggleTask?: () => void;
  readonly taskToggleDisabled?: boolean;
}

function formatDateTime(date: Date | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CONTROL_CLASS =
  "rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100";

export function NoteInfoBar({
  note,
  filePath,
  status,
  onSelectFolder,
  onUpdateTodoField,
  onUpdateTags,
  onSearchTag,
  onUpdateFavorite,
  folderOptions,
  onMoveToFolder,
  onToggleTask,
  taskToggleDisabled,
}: NoteInfoBarProps) {
  const [copyResult, setCopyResult] = useState<{ path: string; message: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const info = useMemo(() => buildNoteInfo(note, formatDateTime), [note]);
  // 저장용 원시 태그(표시용 info.tags는 `#`이 붙어 있다).
  const rawTags = useMemo(() => (note.tags ?? []).filter((tag) => tag.trim() !== ""), [note.tags]);

  const isFavorite = note.favorite === true;

  const kindClass = info.isTodo
    ? info.done
      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
    : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";

  const commitTagDraft = () => {
    if (!onUpdateTags) return;
    const next = addTags(rawTags, tagDraft);
    if (next.length !== rawTags.length) onUpdateTags(next);
    setTagDraft("");
    setAddingTag(false);
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(filePath);
      setCopyResult({ path: filePath, message: "경로를 복사했습니다" });
    } catch {
      setCopyResult({ path: filePath, message: "경로를 복사하지 못했습니다. 상세의 파일 경로를 직접 복사해 주세요" });
    }
  };

  // 현재 폴더가 선택지에 없어도(첨부 폴더 등) select 값이 비지 않게 포함한다.
  const moveOptions = useMemo(() => {
    if (!folderOptions) return [];
    const seen = new Set<string>();
    const options: string[] = [];
    for (const path of [...folderOptions, info.folderPath]) {
      if (path === "" || seen.has(path)) continue;
      seen.add(path);
      options.push(path);
    }
    return options;
  }, [folderOptions, info.folderPath]);

  return (
    <section
      data-note-info-bar
      aria-label="노트 정보"
      className="mx-6 mb-2 py-1 text-xs md:mx-8"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {status}
        {onToggleTask ? <button type="button" onClick={onToggleTask} disabled={taskToggleDisabled}
          aria-label={info.isTodo ? '할 일 표시 해제' : '할 일로 표시'}
          aria-pressed={info.isTodo} title="표시만 바꾸며 태그·날짜·완료 기록은 보존합니다"
          className={`min-h-11 md:min-h-0 shrink-0 rounded px-1.5 py-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 ${kindClass}`}>
          {info.isTodo ? (info.done ? '완료' : '☐ 할 일') : '+ 할 일 표시'}
        </button> : <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${kindClass}`}>{info.kindLabel}</span>}

        {/* 즐겨찾기(2026-09-19 TICK-UX-013). 켜면 목록 맨 위 고정 섹션에 모인다. */}
        {onUpdateFavorite && (
          <button
            type="button"
            onClick={() => onUpdateFavorite(!isFavorite)}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기"}
            title={
              isFavorite
                ? "즐겨찾기 해제 — 목록 맨 위 고정에서 내립니다"
                : "즐겨찾기 — 목록 맨 위에 고정합니다"
            }
            className={`min-h-11 md:min-h-0 shrink-0 rounded px-1.5 py-1 text-base leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              isFavorite
                ? "text-amber-500 hover:text-amber-600 dark:text-amber-300"
                : "text-gray-400 hover:text-amber-500 dark:text-zinc-500 dark:hover:text-amber-300"
            }`}
          >
            {isFavorite ? "★" : "☆"}
          </button>
        )}

        {onSelectFolder ? (
          <button
            type="button"
            onClick={() => onSelectFolder(info.folderPath)}
            title={`${info.folderLabel} 폴더 보기`}
            className="min-w-0 truncate rounded text-gray-600 hover:text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-300 dark:hover:text-blue-300"
          >
            📁 {info.folderLabel}
          </button>
        ) : (
          <span className="min-w-0 truncate text-gray-600 dark:text-zinc-300">
            📁 {info.folderLabel}
          </span>
        )}

        {(filePath || info.tags.length > 0 || onUpdateTags) && (
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {info.tags.map((tag, index) => {
              const raw = rawTags[index] ?? tag;
              return (
                <span
                  key={tag}
                  className="inline-flex items-center rounded bg-gray-200 text-gray-600 dark:bg-zinc-700 dark:text-zinc-300"
                >
                  {onSearchTag ? (
                    <button
                      type="button"
                      onClick={() => onSearchTag(raw)}
                      aria-label={`${tag} 태그로 검색`}
                      title={`${tag} 태그로 검색`}
                      className="rounded px-1.5 py-0.5 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:text-blue-300"
                    >
                      {tag}
                    </button>
                  ) : (
                    <span className="px-1.5 py-0.5">{tag}</span>
                  )}
                  {onUpdateTags && (
                    <button
                      type="button"
                      onClick={() => onUpdateTags(removeTag(rawTags, raw))}
                      aria-label={`${tag} 태그 제거`}
                      title={`${tag} 태그 제거`}
                      className="rounded-r px-1 py-0.5 text-gray-500 hover:bg-gray-300 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-400 dark:hover:bg-zinc-600 dark:hover:text-zinc-100"
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
            {filePath && (
              <button
                type="button"
                onClick={() => void copyPath()}
                title={filePath}
                className="min-h-11 md:min-h-0 rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              >
                경로복사
              </button>
            )}
            {onUpdateTags && !addingTag && (
              <button
                type="button"
                onClick={() => setAddingTag(true)}
                aria-label="태그 추가"
                className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              >
                + 태그
              </button>
            )}
            {onUpdateTags && addingTag && (
              <input
                type="text"
                value={tagDraft}
                autoFocus
                aria-label="새 태그"
                placeholder="태그 (쉼표로 여러 개)"
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTagDraft();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setTagDraft("");
                    setAddingTag(false);
                  }
                }}
                className={`${CONTROL_CLASS} w-40`}
              />
            )}
          </span>
        )}

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="ms-auto shrink-0 rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        >
          상세 {expanded ? "⌄" : "›"}
        </button>
      </div>

      <span role="status" className="block text-gray-500 dark:text-zinc-400">
        {copyResult?.path === filePath ? copyResult.message : ""}
      </span>

      {expanded && (
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 border-t border-gray-200 pt-2 dark:border-zinc-700">
          {info.details.map((detail) => (
            <div key={detail.key} className="contents">
              <dt className="text-gray-500 dark:text-zinc-400">{detail.label}</dt>
              <dd className="min-w-0 break-all text-gray-700 dark:text-zinc-200">
                {info.isTodo && onUpdateTodoField && detail.key === "dueDate" ? (
                  <input
                    type="date"
                    value={note.dueDate?.slice(0, 10) ?? ""}
                    onChange={(e) => onUpdateTodoField("dueDate", e.target.value || undefined)}
                    aria-label="마감일 변경"
                    className={CONTROL_CLASS}
                  />
                ) : detail.key === "priority" ? (
                  // 깃발 색은 lib/priority.ts 하나가 정한다(2026-09-19 TICK-UX-014).
                  <span className="inline-flex items-center gap-1">
                    <PriorityFlag value={note.priority} />
                    {info.isTodo && onUpdateTodoField ? (
                      <select
                        value={note.priority ?? ""}
                        onChange={(e) => onUpdateTodoField("priority", e.target.value || undefined)}
                        aria-label="우선순위 변경"
                        className={CONTROL_CLASS}
                      >
                        <option value="">없음</option>
                        {PRIORITY_LEVELS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    ) : (
                      detail.value
                    )}
                  </span>
                ) : onMoveToFolder && folderOptions && detail.key === "location" ? (
                  <select
                    value={info.folderPath}
                    onChange={(e) => {
                      if (e.target.value !== info.folderPath) onMoveToFolder(e.target.value);
                    }}
                    aria-label="폴더 이동"
                    title="이 노트를 다른 폴더로 옮깁니다"
                    className={CONTROL_CLASS}
                  >
                    <option value="">{ROOT_FOLDER_LABEL}</option>
                    {moveOptions.map((path) => (
                      <option key={path} value={path}>{folderLocationLabel(path)}</option>
                    ))}
                  </select>
                ) : (
                  detail.key === "file" ? filePath : detail.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
