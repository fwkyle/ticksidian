import "@blocknote/mantine/style.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { createInsertDatabaseItem, createInsertTodoItem } from "../database/DatabaseBlock";
import { useNoteEditor, type TodoMetaUpdateHandler, type TodoKindUpdateHandler, type MoveToFolderHandler } from "../../hooks/useNoteEditor";
import type { FavoriteUpdateHandler } from "../../hooks/useNoteEditor";
import { useSystemTheme } from "../../hooks/useSystemTheme";
import type { LinkIndex, LinkableNoteMeta } from "../../lib/wiki-links";
import { normalizeLinkKey, rewriteAmbiguousLinkInBlocks } from "../../lib/wiki-links";
import { OutgoingLinksBar } from "./OutgoingLinksBar";
import { EditorMetaBar } from "./EditorMetaBar";
import { NoteInfoBar } from "./NoteInfoBar";
import { RecoveryVersions } from "./RecoveryVersions";
import { ExternalChangeConflictBanner } from "./ExternalChangeConflictBanner";
import { EditorSideMenu } from "./EditorSideMenu";
import {
  buildWikiLinkInsertText,
  filterSlashMenuItems,
  rankWikiLinkCandidates,
} from "./wiki-link-suggestion";
import type { NoteListItem } from "../../types/note";
import { replaceSelectedBodyText, selectEditorScope } from "../../lib/editor-select-scope";
import { EditorKoreanEnter } from "../../lib/editor-korean-enter";
import { EditorBlankSpaceFocus } from "../../lib/editor-blank-space-focus";
import { selectionPlainText } from "../../lib/editor-clipboard";

interface NoteEditorProps {
  noteId: string;
  /** 디스크 위 실제 파일명 stem. stem 충돌 시 noteId와 다를 수 있음. */
  fileBasename?: string;
  folder?: string;
  /** 볼트 안 이미지 파일 절대경로 목록(임베드 해석용). 2026-08-19 이미지 임베드 보기. */
  imageFiles?: readonly string[];
  /** 이미지 붙여넣기/드롭 저장 완료 후 호출(이미지 목록 갱신). */
  onImagesInserted?: () => void;
  createdAt?: Date;
  updatedAt?: Date;
  /** 지금 열어 둔 항목. 본문 위 노트 정보 바가 쓴다(2026-08-18 [kyle] 요청). */
  note?: NoteListItem;
  /** 정보 바의 폴더 칩을 눌렀을 때. 목록 열만 옮기고 편집 중인 노트는 유지한다. */
  onSelectFolder?: (folder: string) => void;
  /** 정보 바 폴더 이동 선택지(볼트 상대 경로, 첨부 폴더 제외). 2026-08-23 TICK-UX-007 */
  folderOptions?: readonly string[];
  /** 정보 바에서 고른 폴더로 실제 이동(App의 moveNote). 에디터가 flush·차단 뒤에 부른다. */
  onMoveToFolder?: (noteId: string, toFolder: string) => Promise<void>;
  /** 정보 바 태그 칩을 누르면 그 태그로 검색한다. */
  onSearchTag?: (tag: string) => void;
  /**
   * 정보 바 투두 필드 커밋 저장 후 호출(목록 재스캔용). 저장 자체는 에디터 내부
   * 경로(handleTodoMetaUpdate → saveToFile)로 일어난다 — 검수 후속 P1.
   */
  onTodoMetaCommit?: (noteId: string) => void;
  /** 열린 에디터의 메타 저장 함수 등록/해제. 목록 체크박스 토글이 사용한다. */
  onTodoMetaUpdateReady?: (updater: TodoMetaUpdateHandler | null) => void;
  /**
   * 열린 노트의 즐겨찾기 토글을 App이 쓰게 넘긴다(2026-09-19 TICK-UX-013).
   * 목록 우클릭 메뉴에서 별표를 켤 때 자동 저장과 경합하지 않도록 에디터 경유로 보낸다.
   */
  onFavoriteUpdateReady?: (updater: FavoriteUpdateHandler | null) => void;
  /** 열린 항목의 종류 변환 함수 등록/해제. */
  onTodoKindUpdateReady?: (updater: TodoKindUpdateHandler | null) => void;
  onMoveReady?: (mover: MoveToFolderHandler | null) => void;
  /** 값이 커지면 이미 열려 있는 편집 DOM을 다시 포커스한다. */
  focusSignal?: number;
  /** 제목으로 생성한 새 기록만 첫 로드에서 본문에 커서를 둔다. */
  focusBodyOnLoad?: boolean;
  onTitleChange?: (title: string) => void;
  onAliasesChange?: (aliases: string[]) => void;
  onContentSave?: (noteId: string) => void;
  /** 위키링크 UX 2차: `[[` 자동완성 후보/Outgoing 상태 계산용 */
  linkIndex?: LinkIndex | null;
  /** 위키링크 UX 2차: resolved/ambiguous 후보 클릭으로 대상 노트 열기 */
  onOpenNote?: (noteId: string) => void;
  /** 위키링크 UX 2차: unresolved `[[title]]` → 새 노트 생성 */
  onCreateLinkedNote?: (title: string) => Promise<void> | void;
  /** 볼트 전환 차단 모달을 위해 App이 읽는 dirty 상태 */
  onDirtyChange?: (dirty: boolean) => void;
  /** 볼트 전환 차단 모달을 위해 App이 읽는 외부 수정 pending 상태 */
  onExternalPendingChange?: (pending: boolean) => void;
}

export function NoteEditor({
  noteId,
  fileBasename,
  folder,
  imageFiles,
  onImagesInserted,
  createdAt,
  updatedAt,
  note,
  onSelectFolder,
  folderOptions,
  onMoveToFolder,
  onSearchTag,
  onTodoMetaCommit,
  onTodoMetaUpdateReady,
  onFavoriteUpdateReady,
  onTodoKindUpdateReady,
  onMoveReady,
  focusSignal = 0,
  focusBodyOnLoad = false,
  onTitleChange,
  onAliasesChange,
  onContentSave,
  linkIndex,
  onOpenNote,
  onCreateLinkedNote,
  onDirtyChange,
  onExternalPendingChange,
}: NoteEditorProps) {
  const {
    editor,
    filePath,
    isLoading,
    isSaving,
    hasUnsavedChanges,
    isMoving,
    saveError,
    loadError,
    externalChangeNotice,
    externalChangeSummary,
    hasExternalChangePending,
    handleChange,
    insertImageFiles,
    handleReloadFromDisk,
    handleKeepLocalChanges,
    recoveryError,
    recoveryNotice,
    recoveryMetadata,
    recoveryProtected,
    recoveryVersionText,
    restoreRecoveryVersion,
    handleTodoMetaUpdate,
    handleTodoKindUpdate,
    handleTagsUpdate,
    handleFavoriteUpdate,
    handleMoveToFolder,
  } = useNoteEditor({
    prepareEmptyBody: focusBodyOnLoad,
    noteId,
    fileBasename,
    folder,
    imageFiles,
    onImagesInserted,
    onTitleChange,
    onAliasesChange,
    onContentSave,
    onDirtyChange,
    onExternalPendingChange,
    onTodoMetaCommit,
    onTodoMetaUpdateReady,
    onTodoKindUpdateReady,
  });

  useEffect(() => {
    onMoveReady?.(handleMoveToFolder);
    return () => onMoveReady?.(null);
  }, [onMoveReady, handleMoveToFolder]);

  useEffect(() => {
    if (!editor || isLoading || loadError || isMoving) return;
    const enter = new EditorKoreanEnter(editor.prosemirrorView);
    return () => enter.dispose();
  }, [editor, isLoading, loadError, isMoving]);

  // 즐겨찾기 토글도 App이 쓸 수 있게 넘긴다(목록 우클릭 메뉴 → 에디터 경유 저장).
  useEffect(() => {
    onFavoriteUpdateReady?.(handleFavoriteUpdate);
    return () => onFavoriteUpdateReady?.(null);
  }, [onFavoriteUpdateReady, handleFavoriteUpdate]);

  // 다크모드: BlockNote theme을 OS 설정과 동기화 (docs/design-rules.md "다크모드 토큰")
  const systemTheme = useSystemTheme();

  // 초기 로드 완료 감지용(TICK-UX-008 P0-1). isLoading은 initial 로드에서만 true가 되므로
  // true→false 전이를 에디터 포커스 트리거로 쓴다. 외부 수정 재로드는 이 값을 안 바꾼다.
  const prevIsLoadingRef = useRef(isLoading);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const editorContentRef = useRef<HTMLDivElement | null>(null);
  const lastFocusSignalRef = useRef(focusSignal);

  useEffect(() => {
    const root = editorScrollRef.current;
    const content = editorContentRef.current;
    if (!editor || !root || !content || isLoading || loadError || isMoving) return;
    const focus = new EditorBlankSpaceFocus(root, content, editor.prosemirrorView);
    return () => focus.dispose();
  }, [editor, isLoading, loadError, isMoving]);

  // 문서 제목(첫 헤딩) 백스페이스 강등 방지 (2026-08-15 [kyle] 요청).
  // 제목 텍스트를 끝까지 지운 뒤 백스페이스를 한 번 더 누르면 BlockNote가 빈 헤딩을
  // 일반 문단으로 강등해 `#` 제목이 사라진다. 첫 블록이 heading이고 이미 비어 있을 때의
  // Backspace만 막는다 — 제목 편집은 자유롭고, 타입 변경은 블록 메뉴로 의도적으로만.
  // BlockNote doc 구조는 doc > blockGroup > 블록들이므로 첫 블록은 blockGroup의 첫 자식이고,
  // 커서가 그 안에 있는지는 좌표 계산 대신 조상 노드 참조로 판정한다.
  useEffect(() => {
    if (!editor) return;
    const view = editor.prosemirrorView;
    const onBeforeInput = (event: InputEvent) => replaceSelectedBodyText(view, event);
    const onKeyDown = (event: KeyboardEvent) => {
      if (selectEditorScope(view, event)) return;
      if (event.key !== "Backspace") return;
      const { selection, doc } = view.state;
      if (!selection.empty) return;
      // BlockNote 구조: doc > blockGroup > blockContainer > heading. 첫 블록의 실제 노드는
      // blockContainer의 첫 자식이다.
      const container = doc.firstChild?.firstChild;
      const first = container?.content.firstChild;
      if (!first || first.type.name !== "heading" || first.content.size > 0) return;
      const $from = doc.resolve(selection.from);
      for (let depth = 0; depth <= $from.depth; depth += 1) {
        if ($from.node(depth) === first) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
    };
    view.dom.addEventListener("keydown", onKeyDown, true);
    view.dom.addEventListener("beforeinput", onBeforeInput, true);
    return () => {
      view.dom.removeEventListener("keydown", onKeyDown, true);
      view.dom.removeEventListener("beforeinput", onBeforeInput, true);
    };
  }, [editor]);

  // 이미지 붙여넣기/드롭(2026-08-19 TICK-IMG-002 노션 체감형).
  // capture 단계에서 먼저 잡아 기본 동작(텍스트 붙여넣기/링크 드롭)을 막고 노트 소속 저장으로 흘린다.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.prosemirrorView.dom;
    const imageFilesFrom = (data: DataTransfer | null): File[] => {
      if (!data) return [];
      return Array.from(data.files).filter((file) => file.type.startsWith("image/"));
    };
    const onPaste = (event: ClipboardEvent) => {
      const files = imageFilesFrom(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void insertImageFiles(files);
    };
    const onDrop = (event: DragEvent) => {
      const files = imageFilesFrom(event.dataTransfer);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void insertImageFiles(files);
    };
    dom.addEventListener("paste", onPaste, true);
    dom.addEventListener("drop", onDrop, true);
    return () => {
      dom.removeEventListener("paste", onPaste, true);
      dom.removeEventListener("drop", onDrop, true);
    };
  }, [editor, insertImageFiles]);

  // 복사·잘라내기 평문 정리(2026-09-18 TICK-BUG-007).
  // BlockNote가 `text/plain`에 마크다운을 넣기 때문에(`<주소>` 오토링크 포함),
  // 그 뒤에 실행되는 이 리스너가 "보이는 글자"로 덮어쓴다.
  // 순서: ProseMirror는 view.dom에 리스너를 먼저 등록하고, 이 효과는 마운트 뒤에 붙는다.
  // 같은 요소·같은 단계(버블)에서는 등록 순서대로 실행되므로 우리가 마지막에 쓴다.
  // 캡처 단계로 바꾸면 순서가 뒤집혀 마크다운이 다시 덮어쓰이므로 캡처를 쓰지 않는다.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.prosemirrorView.dom;
    const onCopyOrCut = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;
      const { doc, selection } = editor.prosemirrorView.state;
      const plain = selectionPlainText(doc, selection);
      if (plain === null) return;
      data.setData("text/plain", plain);
    };
    dom.addEventListener("copy", onCopyOrCut);
    dom.addEventListener("cut", onCopyOrCut);
    return () => {
      dom.removeEventListener("copy", onCopyOrCut);
      dom.removeEventListener("cut", onCopyOrCut);
    };
  }, [editor]);

  // 링크 인덱스의 note list를 memoize (getItems가 매 입력마다 새 배열을 안 만들게)
  const wikiLinkCandidatesBase = useMemo<LinkableNoteMeta[]>(() => {
    if (!linkIndex) return [];
    return Array.from(linkIndex.notesById.values());
  }, [linkIndex]);

  // ambiguous 후보 선택으로 본문 `[[ref]]` / `[[ref|label]]`을
  // `[[id:chosenNoteId|display]]`로 rewrite한다.
  // editor.replaceBlocks 한 번으로 전체 적용 → BlockNote가 onChange를 발동하고
  // useNoteEditor의 1초 디바운스 저장이 파일에 반영한다. 저장 완료 시
  // onContentSave(=reloadLinkIndex)가 호출되어 OutgoingLinksBar가 더 이상
  // 해당 링크를 ambiguous로 보이지 않는다.
  // 설계: docs/waterfall/03-상세설계/위키링크-백링크-설계안.md §18.4
  const handleResolveAmbiguous = useCallback(
    async (ref: string, chosenNoteId: string) => {
      if (!editor) return;
      type AnyBlock = {
        id?: string;
        type?: string;
        content?: unknown;
        children?: AnyBlock[];
      };
      const current = editor.document as unknown as AnyBlock[];
      const { blocks, changedCount } = rewriteAmbiguousLinkInBlocks<AnyBlock>(
        current,
        ref,
        chosenNoteId,
      );
      if (changedCount === 0) return;
      // replaceBlocks(blocksToRemove, blocksToInsert): 전체 문서를 새 블록 배열로 대체.
      const ids = current
        .map((b) => b.id)
        .filter((id): id is string => typeof id === "string");
      if (ids.length === 0) return;
      editor.replaceBlocks(
        ids,
        blocks as Parameters<typeof editor.replaceBlocks>[1],
      );
    },
    [editor],
  );

  // 초기 로드 성공 직후 에디터로 포커스를 옮긴다(2026-08-18 TICK-UX-008 P0-1).
  // 두지 않으면 포커스가 목록의 생성/선택 버튼에 남아 스페이스 입력이 버튼 재클릭으로
  // 해석돼 노트가 양산되고 입력이 유실된다.
  // 주의: loadNoteFromDisk 안에서 editor.prosemirrorView에 접근하면 뷰 마운트 전에는
  // tiptap getter가 예외를 던져 로드 자체가 실패한다(실측). 그래서 마운트가 끝난
  // 이 컴포넌트의 effect에서 편집 가능 DOM(contentEditable)에 직접 포커스한다.
  useEffect(() => {
    const wasLoading = prevIsLoadingRef.current;
    prevIsLoadingRef.current = isLoading;
    if (!wasLoading || isLoading || loadError) return;
    const editable = editorScrollRef.current?.querySelector<HTMLElement>(".bn-editor .ProseMirror, .ProseMirror");
    if (!editable) return;
    editable.focus();
    // 로드 기준선에 포함된 빈 문단을 사용한다. 포커스 때문에 파일을 다시 쓰지 않는다.
    const body = editor?.document[1];
    if (focusBodyOnLoad && body) editor?.setTextCursorPosition(body, 'start');
  }, [isLoading, loadError, editor, focusBodyOnLoad]);

  // 같은 노트를 목록에서 다시 선택하면 isLoading 전이가 없다. 신호 변화만으로
  // 편집 DOM을 다시 포커스한다(2026-08-18 자동 오픈 후속).
  useEffect(() => {
    if (lastFocusSignalRef.current === focusSignal) return;
    lastFocusSignalRef.current = focusSignal;
    if (isLoading || loadError) return;
    const editable = editorScrollRef.current?.querySelector<HTMLElement>(".bn-editor .ProseMirror, .ProseMirror");
    editable?.focus();
  }, [focusSignal, isLoading, loadError]);

  // 에디터가 아직 준비되지 않았으면 로딩 표시
  if (!editor) {
    return (
      <div className="flex-1 h-full flex items-center justify-center text-gray-400 dark:text-zinc-500">
        {loadError ? (
          <div className="text-center">
            <p className="text-red-500 dark:text-red-400 mb-2">{loadError}</p>
            <p className="text-sm">빈 문서로 시작합니다.</p>
          </div>
        ) : (
          "로딩 중…"
        )}
      </div>
    );
  }

  const displayedNote = note && recoveryMetadata ? { ...note, ...recoveryMetadata.todoMeta, tags: recoveryMetadata.tags, favorite: recoveryMetadata.favorite } : note;
  const statusBar = (
    <EditorMetaBar
      isLoading={isLoading}
      isSaving={isSaving}
      hasUnsavedChanges={hasUnsavedChanges}
      saveError={saveError}
      loadError={loadError}
      externalChangeNotice={externalChangeNotice}
      hasExternalChangePending={hasExternalChangePending}
    />
  );

  return (
    <div ref={editorScrollRef} className="flex-1 h-full overflow-y-auto bg-white dark:bg-zinc-950">
      {/* 기본함 우선 기록: 중첩 여백을 줄이고 넓은 창에서도 과도한 줄 길이는 제한한다. */}
      <div ref={editorContentRef} className="max-w-[1000px] pb-6 pt-6">
        {note ? (
          <NoteInfoBar
            filePath={filePath}
            note={{ ...displayedNote!, createdAt: createdAt ?? note.createdAt, updatedAt: updatedAt ?? note.updatedAt }}
            status={statusBar}
            onSelectFolder={onSelectFolder}
            onUpdateTodoField={(field, value) => void handleTodoMetaUpdate(field, value)}
            onToggleTask={() => void handleTodoKindUpdate(displayedNote?.type === 'todo' ? 'note' : 'todo')}
            taskToggleDisabled={isSaving || isMoving || hasExternalChangePending}
            onUpdateTags={(tags) => void handleTagsUpdate(tags)}
            onUpdateFavorite={(favorite) => void handleFavoriteUpdate(favorite)}
            onSearchTag={onSearchTag}
            folderOptions={folderOptions}
            onMoveToFolder={
              onMoveToFolder
                ? (target) => void handleMoveToFolder(() => onMoveToFolder(noteId, target))
                : undefined
            }
          />
        ) : <div className="mx-6 mb-2 md:mx-8">{statusBar}</div>}

        {recoveryNotice && <p role="status" className="mx-6 mb-2 text-sm text-blue-700 dark:text-blue-300">{recoveryNotice}</p>}
        {recoveryError && <p role="alert" className="mx-6 mb-2 text-sm text-red-600 dark:text-red-300">{recoveryError}</p>}
        <RecoveryVersions filePath={filePath} text={recoveryVersionText} onRestore={restoreRecoveryVersion} disabled={isLoading || isSaving || isMoving} />
        {hasExternalChangePending && (
          <ExternalChangeConflictBanner
            summary={externalChangeSummary}
            protectedDraft={recoveryProtected}
            onReloadFromDisk={handleReloadFromDisk}
            onKeepLocalChanges={handleKeepLocalChanges}
          />
        )}

        {linkIndex && onOpenNote && onCreateLinkedNote && (
          <OutgoingLinksBar
            activeNoteId={noteId}
            linkIndex={linkIndex}
            onOpenNote={onOpenNote}
            onCreateLinkedNote={onCreateLinkedNote}
            onResolveAmbiguous={handleResolveAmbiguous}
          />
        )}

        {/* 본문 옆 도구는 WebKit 드래그 선택이 위로 튀지 않는 배치로 직접 연결한다(EditorSideMenu). */}
        <BlockNoteView editor={editor} editable={!isMoving} onChange={handleChange} theme={systemTheme} sideMenu={false}>
          <EditorSideMenu />
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => {
              const defaultItems = getDefaultReactSlashMenuItems(editor);
              const databaseItem = createInsertDatabaseItem(editor);
              const todoItem = createInsertTodoItem(editor);
              const allItems = [...defaultItems, databaseItem, todoItem];
              return filterSlashMenuItems(allItems, query);
            }}
          />

          {/*
            위키링크 `[[` 자동완성.
            - BlockNote는 triggerCharacter가 여러 글자여도 지원하며
              (handleTextInput에서 `triggerChar.length > 1` 처리),
              item 선택 시 clearQuery가 `[[query`를 자동 삭제한다.
            - onItemClick은 삭제된 위치에 `[[Title]]`를 새로 삽입하면 된다.
            - ambiguous 해석은 여기서 안 한다. 복수 후보가 있어도 사용자가 고른 하나만
              링크로 삽입하고, ambiguous 판정은 인덱스 기준으로 그대로 유지된다.
              링크 한 건이 2개 이상 매칭되는 경우의 "후보 중 하나로 고정"은 bar에서 처리.
            - 설계: docs/waterfall/03-상세설계/위키링크-백링크-설계안.md §UX 2차
          */}
          <SuggestionMenuController
            triggerCharacter="[["
            minQueryLength={0}
            getItems={async (query) => {
              const items: DefaultReactSuggestionItem[] = [];
              if (wikiLinkCandidatesBase.length > 0) {
                const ranked = rankWikiLinkCandidates(
                  wikiLinkCandidatesBase,
                  query,
                  noteId,
                );
                for (const { meta, matchText } of ranked) {
                  const showAlias =
                    matchText.trim().toLowerCase() !==
                    meta.title.trim().toLowerCase();
                  items.push({
                    title: meta.title || "제목 없음",
                    subtext: showAlias
                      ? `별칭: ${matchText}`
                      : meta.folder
                        ? meta.folder
                        : undefined,
                    onItemClick: () => {
                      const text = buildWikiLinkInsertText(meta, query);
                      editor.insertInlineContent([
                        { type: "text", text, styles: {} },
                      ]);
                    },
                  });
                }
              }
              // 새 노트 승격 항목
              const trimmed = query.trim();
              if (trimmed.length > 0 && onCreateLinkedNote) {
                // 완전 일치 후보가 이미 있으면 중복 유도를 피하기 위해 새 노트 항목을 넣지 않는다
                const exact = wikiLinkCandidatesBase.some(
                  (m) =>
                    normalizeLinkKey(m.title) === normalizeLinkKey(trimmed) ||
                    m.aliases.some(
                      (a) => normalizeLinkKey(a) === normalizeLinkKey(trimmed),
                    ),
                );
                if (!exact) {
                  items.push({
                    title: `새 노트 만들기: ${trimmed}`,
                    subtext: "없는 노트를 새로 만들고 링크",
                    onItemClick: () => {
                      void (async () => {
                        // 링크를 먼저 삽입 (파일이 생성되면 다음 인덱스 빌드에서 resolved로 바뀜)
                        editor.insertInlineContent([
                          { type: "text", text: `[[${trimmed}]]`, styles: {} },
                        ]);
                        try {
                          await onCreateLinkedNote(trimmed);
                        } catch (err) {
                          console.error("[NoteEditor] create linked note failed:", err);
                        }
                      })();
                    },
                  });
                }
              }
              return items;
            }}
          />
        </BlockNoteView>
      </div>
    </div>
  );
}
