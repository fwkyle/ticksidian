import { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { FolderColumn } from "./components/sidebar/FolderColumn";
import { NoteColumn } from "./components/sidebar/NoteColumn";
import { OutsideListNotice } from "./components/sidebar/OutsideListNotice";
import { SidebarNavigation, type SidebarPane } from "./components/sidebar/SidebarNavigation";
import { MoveNoteDialog } from "./components/common/MoveNoteDialog";
import { AppRail, type RailAction } from "./components/layout/AppRail";
import { DrawerToolRow } from "./components/layout/DrawerToolRow";
import { RailIcons } from "./components/layout/rail-icons";
import { ContextMenu } from "./components/common/ContextMenu";
import { FolderNameDialog } from "./components/common/FolderNameDialog";
import { DeleteFolderConfirmDialog } from "./components/common/DeleteFolderConfirmDialog";
import type { FolderSelection } from "./lib/folder-tree";
import { collectFolderPaths, countNotesByFolder, resolveFolderSelection, INBOX_FOLDER } from "./lib/folder-tree";
import { ARCHIVE_FOLDER, ATTACHMENTS_FOLDER, isAttachmentsFolder } from "./lib/archive-folder";
import type { FolderNode } from "./types/note";
import type { NoteListItem } from "./types/note";
import {
  DEFAULT_NOTE_LIST_VIEW,
  NOTE_LIST_VIEW_STORAGE_KEY,
  parseStoredListView,
  serializeListView,
  type NoteListView,
} from "./lib/note-list-view";
import {
  START_SCREEN_LABELS,
  currentStartPlan,
  readStartScreen,
  toggleStartScreen,
  writeStartScreen,
  type StartScreen,
} from "./lib/start-screen";
import { SearchBar } from "./components/sidebar/SearchBar";
import { useNotes } from "./hooks/useNotes";
import { useQuickRecordCreation } from "./hooks/useQuickRecordCreation";
import { useTodos } from "./hooks/useTodos";
import { useReviewQueue } from "./hooks/useReviewQueue";
import { useLinkIndex } from "./hooks/useLinkIndex";
import { useVaultImageFiles } from "./hooks/useVaultImageFiles";
import { useBacklinks } from "./hooks/useBacklinks";
import { useVaultWatcher } from "./hooks/useVaultWatcher";
import { useSearch } from "./hooks/useSearch";
import { QuickRecordInput } from "./components/sidebar/QuickRecordInput";
import { useRagSearch, type RagSearchMode } from "./hooks/useRagSearch";
import { useVaultBinding } from "./hooks/useVaultBinding";
import { useAuthState } from "./hooks/useAuthState";
import { useAuthRefreshOnFocus } from "./hooks/useAuthRefreshOnFocus";
import { useStaleActiveFallback } from "./hooks/useStaleActiveFallback";
import { useEditorRiskState } from "./hooks/useEditorRiskState";
import { useFilenameSync } from "./hooks/useFilenameSync";
import { useAppErrorBanner } from "./hooks/useAppErrorBanner";
import { useExportSite } from "./hooks/useExportSite";
import { useVaultSwitch } from "./hooks/useVaultSwitch";
import { useNoteSelection } from "./hooks/useNoteSelection";
import { usePanelWidths } from "./hooks/usePanelWidths";
import { useTodoNoteActions } from "./hooks/useTodoNoteActions";
import type { TodoMetaUpdateHandler, TodoKindUpdateHandler, TodoKindUpdateTarget, MoveToFolderHandler } from "./hooks/useNoteEditor";
import type { FavoriteUpdateHandler } from "./hooks/useNoteEditor";
import { VaultSelectionScreen } from "./components/app-screens/VaultSelectionScreen";
import { EmptyVaultScreen } from "./components/app-screens/EmptyVaultScreen";
import { RiskyVaultSwitchDialog } from "./components/app-screens/RiskyVaultSwitchDialog";
import { DeleteNoteConfirmDialog } from "./components/common/DeleteNoteConfirmDialog";
import {
  deleteVaultFile,
  getVaultPath,
  readNoteFile,
  updateNoteFrontmatter,
} from "./lib/local-fs";
import { findExclusiveImageReferences } from "./lib/image-embed-attachment-cleanup";
import { AppErrorBanner } from "./components/app-screens/AppErrorBanner";
import { PanelResizer } from "./components/layout/PanelResizer";
import { toErrorMessage } from "./lib/error-utils";
import { runtimeToPersistedAuthState } from "./lib/auth/auth-state-machine";
import { activeAuthMode, selectAuthAdapter } from "./lib/auth";

// 코드 스플리팅: 조건부 렌더링 컴포넌트를 lazy 로드
const NoteEditor = lazy(() =>
  import("./components/editor/NoteEditor").then((m) => ({ default: m.NoteEditor }))
);
const ReviewQueuePanel = lazy(() =>
  import("./components/review-queue/ReviewQueuePanel").then((m) => ({ default: m.ReviewQueuePanel }))
);
const SecretsViewerPanel = lazy(() =>
  import("./components/secrets-viewer/SecretsViewerPanel").then((m) => ({ default: m.SecretsViewerPanel }))
);
const DrawingEditor = lazy(() =>
  import("./components/drawing/DrawingEditor").then((m) => ({ default: m.DrawingEditor })),
);
const BacklinkPanel = lazy(() =>
  import("./components/sidebar/BacklinkPanel").then((m) => ({ default: m.BacklinkPanel }))
);

function App() {
  const {
    notes,
    folders,
    activeNoteId,
    setActiveNoteId,
    createNote,
    createQuickNote,
    createNoteWithTitle,
    updateNoteTitle: renameNote,
    updateNoteAliases,
    deleteNote,
    moveNote,
    createFolder,
    renameFolder,
    trashFolder,
    toggleProject,
    loading: notesLoading,
    selectVault,
    hasVault,
    startupVaultNotice,
    vaultPath,
    refreshNotes,
  } = useNotes();

  // 1024px 미만은 폴더→목록의 한 열 탐색이다. 넓은 창은 기존 두 열을 유지한다.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // 시작 화면 설정(기본함/오늘 할 일). 시작·볼트 전환·자동 열기가 같은 규칙을 쓴다.
  // 설계: docs/waterfall/03-상세설계/시작-화면-선택.md
  const [initialStartPlan] = useState(currentStartPlan);
  const [startScreen, setStartScreenState] = useState<StartScreen>(readStartScreen);
  // 1024px 미만에서 `오늘 할 일` 시작은 폴더 창이 아니라 목록 창으로 연다.
  const [sidebarPane, setSidebarPane] = useState<SidebarPane>(
    initialStartPlan.goToday ? "notes" : "folders",
  );

  // 현재 볼트의 동기화 모드/인증 상태는 내부 binding으로 유지한다(메인 표시 없음).
  // M3-1c: setAuthState로 영구 인증 상태(signed_in/signed_out/reauth_required)를 binding에 반영.
  //        실제 노트 업로드/다운로드는 후속 단계(M3-2)에서 추가.
  const {
    binding: vaultBinding,
    setAuthState: setBindingAuthState,
  } = useVaultBinding(hasVault ? vaultPath : null);

  // M3-1c/M3-1e: 인증 상태 머신.
  // - VITE_TICKSIDIAN_AUTH_MODE 미지정 또는 "mock" → mockAuthAdapter (앱 기본).
  // - VITE_TICKSIDIAN_AUTH_MODE=real → realAuthAdapter (M3-1e dev-only auth server).
  // 어느 쪽이든 어떤 인증 실패도 throw하지 않고 error 상태로만 노출 → 노트 편집 흐름은 절대 막지 않는다.
  // useMemo가 아니라 ref 캐시 패턴으로도 가능하지만 어댑터는 module-singleton이라 매 렌더 같은 참조가 돌아온다.
  const adapter = useMemo(() => selectAuthAdapter(), []);
  const auth = useAuthState(adapter);

  // M3-1e: real 모드 + signed_in일 때만 visibility/focus 복귀 시 자동 refresh.
  // mock에서는 의미 없으므로 비활성. 노트 편집 흐름과는 분리되어 있다.
  useAuthRefreshOnFocus({
    enabled: activeAuthMode === "real" && auth.runtime === "signed_in",
    triggerRefresh: auth.triggerRefresh,
  });

  // 영구 인증 상태(signed_in / signed_out / reauth_required)일 때만 binding 갱신.
  // 일시 상태(signing_in / refreshing / signing_out)는 DB에 쓰지 않는다.
  // 의도적으로 syncMode는 건드리지 않는다 — M3 원칙: 로그인 != 동기화 활성화.
  useEffect(() => {
    const persisted = runtimeToPersistedAuthState(auth.runtime);
    if (persisted === null) return;
    if (!vaultBinding) return; // binding 로드 전이면 다음 사이클에 다시 시도
    if (vaultBinding.authState === persisted) return;
    void setBindingAuthState(persisted);
  }, [auth.runtime, vaultBinding, setBindingAuthState]);

  const todosHook = useTodos({ notes, refreshNotes });

  // 위키링크 인덱스 & 백링크
  const {
    linkIndex,
    reload: reloadLinkIndex,
    applyContentChange: applyLinkIndexContentChange,
  } = useLinkIndex(notes, { vaultPath });

  // 볼트 안 이미지 파일 색인(2026-08-19 이미지 임베드 보기). 임베드 해석용 1회 스캔.
  const { imageFiles: vaultImageFiles, reloadImageFiles } = useVaultImageFiles(vaultPath);

  // 노트 본문 저장 직후: 그 노트만 링크 인덱스 증분 갱신(P1-006).
  // 매 저장 full rebuild로 전체 파일을 다시 읽지 않는다. 제목/별칭 변경은
  // updateNoteTitle/updateNoteAliases → notes 갱신 → notes-변경 경로가 full rebuild로 잡는다.
  const handleContentSaved = useCallback(
    (savedNoteId: string) => {
      void applyLinkIndexContentChange(savedNoteId);
    },
    [applyLinkIndexContentChange],
  );

  // M2: 전체 볼트 변경 감지 (7초 폴링 + diff). P1-006: OS push watcher 추가, 폴링은 fallback.
  useVaultWatcher({ hasVault, notes, refreshNotes, vaultPath });

  // M2: 제목/aliases/태그 검색
  const search = useSearch(notes, hasVault ? vaultPath : null);

  // RAG: 제목 ↔ 전체 검색 모드 전환. 볼트 없으면 비활성.
  const ragSearch = useRagSearch(hasVault ? vaultPath : null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickFocusSignal, setQuickFocusSignal] = useState(0);
  const closeSearch = useCallback((returnToInput = false) => {
    setSearchOpen(false);
    search.setQuery('');
    ragSearch.setQuery('');
    ragSearch.setMode('title');
    if (returnToInput) setQuickFocusSignal(value => value + 1);
  }, [search, ragSearch]);

  // 검색 모드 전환 시 제목 검색어와 RAG 검색어를 함께 초기화
  const handleSearchModeChange = useCallback(
    (mode: RagSearchMode) => {
      ragSearch.setMode(mode);
      if (mode === "rag") {
        search.setQuery("");
      } else {
        ragSearch.setQuery("");
      }
    },
    [ragSearch, search],
  );

  // 노트 삭제는 확인 다이얼로그를 거친다(TICK-UX-008 P0-2). 즉시 삭제 경로는 없다.
  // 취소(Esc/배경/취소 버튼)는 상태만 비우고 파일을 건드리지 않는다.
  const [notePendingDelete, setNotePendingDelete] = useState<{
    id: string;
    title: string;
    /** 이 노트만 참조하는 이미지 경로(2026-08-19 TICK-IMG-002). 계산 중에는 빈 배열. */
    exclusiveImages: string[];
  } | null>(null);
  const handleRequestDeleteNote = useCallback(
    async (noteId: string) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) {
        setNotePendingDelete({ id: noteId, title: noteId, exclusiveImages: [] });
        return;
      }
      const vaultRootPath = getVaultPath();
      let exclusiveImages: string[] = [];
      if (vaultRootPath) {
        try {
          const target = await readNoteFile(note.fileBasename, note.folder);
          const otherNotes = await Promise.all(
            notes
              // 그림(`*.excalidraw`)은 마크다운이 아니라 readNoteFile이 항상 실패한다.
              // 그대로 두면 fail-closed 규칙이 전용 이미지를 전부 0개로 만든다
              // (2026-08-23 [kyle] 실창 B6 FAIL → TICK-BUG-004).
              .filter((candidate) => candidate.id !== noteId && !candidate.drawing)
              .map(async (candidate) => {
                try {
                  const file = await readNoteFile(candidate.fileBasename, candidate.folder);
                  return { noteId: candidate.id, folder: candidate.folder, content: file.content };
                } catch {
                  // 판정 불확실 — fail-closed로 전체를 비운다.
                  return null;
                }
              }),
          );
          exclusiveImages = findExclusiveImageReferences({
            targetNoteContent: target.content,
            targetNoteFolder: note.folder,
            otherNotes,
            vaultRootPath,
            imageFiles: vaultImageFiles,
          });
        } catch {
          exclusiveImages = [];
        }
      }
      setNotePendingDelete({ id: noteId, title: note.title, exclusiveImages });
    },
    [notes, vaultImageFiles],
  );

  const handleConfirmDeleteNote = useCallback(async (cleanupImages: boolean) => {
    const target = notePendingDelete;
    if (!target) return;
    setNotePendingDelete(null);
    await deleteNote(target.id);
    // 노트 삭제가 성공한 뒤에만 전용 이미지를 정리한다(.trash 이동 — 잠긴 계약 7).
    if (cleanupImages) {
      for (const imagePath of target.exclusiveImages) {
        try {
          await deleteVaultFile(imagePath);
        } catch {
          // 이미지 하나가 실패해도 나머지는 계속한다(각각 .trash 이동이므로 안전).
        }
      }
      void reloadImageFiles();
    }
  }, [notePendingDelete, deleteNote, reloadImageFiles]);
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [focusNewBody, setFocusNewBody] = useState(false);

  // TICK-P0-007: TickTick 검토 큐. 열리면 메인 영역이 검토 큐 패널로 대체된다.
  // 저장 차단/외부 충돌 중에는 패널 진입을 거부해 편집기를 보존한다.
  // 2차: 승인 항목 변환으로 노트가 생기면 노트 목록을 다시 스캔한다.
  const [showReviewQueue, setShowReviewQueue] = useState(false);

  // 보안 메모(사용자가 고른 비밀 폴더 뷰어, 2026-08-15 [kyle] 요청)
  const [showSecretsViewer, setShowSecretsViewer] = useState(false);
  const reviewQueue = useReviewQueue(hasVault ? vaultPath : null, {
    onNotesChanged: () => void refreshNotes(),
  });
  // 뱃지 완화(2026-08-30 ux-ui-analysis): 50개짜리 붉은 숫자는 임무처럼 느껴져 회피를 부른다.
  // 하루 처리 가능량 개념으로 9까지만 숫자로 보여주고, 넘으면 점(1)만 표시한다.
  const reviewBadge = notes.filter(note => note.folder === INBOX_FOLDER && !note.drawing && !note.excalidrawPlugin).length;

  // 위험한 볼트 전환 차단용: 현재 열린 NoteEditor의 상태를 App으로 리프팅.
  const editorNoteId = selectedTodoId ?? activeNoteId;
  const {
    editorDirty,
    editorExternalPending,
    handleEditorDirtyChange,
    handleEditorExternalPendingChange,
  } = useEditorRiskState(editorNoteId);

  const openTodoMetaUpdateRef = useRef<TodoMetaUpdateHandler | null>(null);
  const handleTodoMetaUpdateReady = useCallback((updater: TodoMetaUpdateHandler | null) => {
    openTodoMetaUpdateRef.current = updater;
  }, []);
  // 열린 노트의 즐겨찾기 토글(2026-09-19 TICK-UX-013). 목록 우클릭 메뉴가 이걸 쓴다.
  const openFavoriteUpdateRef = useRef<FavoriteUpdateHandler | null>(null);
  const handleFavoriteUpdateReady = useCallback((updater: FavoriteUpdateHandler | null) => {
    openFavoriteUpdateRef.current = updater;
  }, []);
  const openTodoKindUpdateRef = useRef<TodoKindUpdateHandler | null>(null);
  const openMoveRef = useRef<MoveToFolderHandler | null>(null);
  const handleMoveReady = useCallback((mover: MoveToFolderHandler | null) => {
    openMoveRef.current = mover;
  }, []);
  const handleTodoKindUpdateReady = useCallback((updater: TodoKindUpdateHandler | null) => {
    openTodoKindUpdateRef.current = updater;
  }, []);

  // 파일명-제목 동기화(2026-08-18 [kyle] 결정): UUID 새 노트와 제목이 바뀐 노트의
  // 파일명을 "노트를 벗어나는 순간"에 제목으로 맞춘다. 열려 있는 에디터는 건드리지 않는다.
  // 설계: docs/waterfall/03-상세설계/파일명-제목-동기화.md
  const { markTitleChanged, notifyBeforeEditorSwitch } = useFilenameSync({
    notes,
    hasVault,
    notesLoading,
    vaultPath,
    editorNoteId,
    editorDirty,
    refreshNotes,
  });
  // 선택 변경 직전에 떠나는 노트의 파일명 동기화를 시도하는 래퍼.
  // useNoteSelection의 모든 선택 경로가 이 두 세터를 지나간다.
  const setActiveNoteIdWithSync = useCallback((id: string | null) => {
    setFocusNewBody(false);
    if (id !== activeNoteId) notifyBeforeEditorSwitch(id);
    setActiveNoteId(id);
  }, [notifyBeforeEditorSwitch, setActiveNoteId, activeNoteId]);
  const setSelectedTodoIdWithSync = useCallback((id: string | null) => {
    setFocusNewBody(false);
    if (id !== selectedTodoId) notifyBeforeEditorSwitch(id);
    setSelectedTodoId(id);
  }, [notifyBeforeEditorSwitch, selectedTodoId]);
  // 새 노트 생성도 에디터 전환이다 — 떠나는 노트의 파일명 동기화를 먼저 시도한다.
  // 기본함부터 시작하되 명시적으로 고른 폴더는 유지한다.
  const [folderSelection, setFolderSelection] = useState<FolderSelection>(
    initialStartPlan.goToday ? null : INBOX_FOLDER,
  );
  // `오늘 할 일` 보기(전체 + 할 일 + 날짜 그룹). 폴더·종류를 바꾸면 아래 effect가 끈다.
  const [todayView, setTodayView] = useState(initialStartPlan.goToday);
  // (useNotes.createNote는 내부에서 setActiveNoteId를 직접 부르므로 래퍼 세터를 안 거친다.)
  // 아래 단축키 effect보다 먼저 선언해야 한다(TDZ — 2026-08-18 codex 사고 기록 참고).
  // 앱 에러 배너 상태 + 무음 저장 실패 surface (TICK-P0-003)
  const { appError, setAppError } = useAppErrorBanner();

  // TICK-P1-008: HTML 내보내기 (2026-08-15 1단계 리팩토링으로 App에서 추출)
  const { status: exportSiteStatus, message: exportSiteMessage, exportSiteNow } = useExportSite(notes);

  // 목록 보기(종류 필터 + 정렬). 화면 설정이라 localStorage에 둔다.
  // 설계: docs/waterfall/03-상세설계/노트-투두-통합-목록.md
  const [listView, setListViewState] = useState<NoteListView>(() => {
    if (typeof window === "undefined") return DEFAULT_NOTE_LIST_VIEW;
    try {
      const stored = parseStoredListView(window.localStorage.getItem(NOTE_LIST_VIEW_STORAGE_KEY));
      // `오늘 할 일` 시작은 저장된 보기를 덮어쓰지 않고 이번 실행에만 할 일 종류로 연다.
      return initialStartPlan.goToday ? { ...stored, kind: 'todo' } : stored;
    } catch {
      return initialStartPlan.goToday ? { ...DEFAULT_NOTE_LIST_VIEW, kind: 'todo' } : DEFAULT_NOTE_LIST_VIEW;
    }
  });
  const setListView = useCallback((next: NoteListView) => {
    setListViewState(next);
    try {
      window.localStorage.setItem(NOTE_LIST_VIEW_STORAGE_KEY, serializeListView(next));
    } catch {
      // 화면 설정이라 저장 실패는 조용히 넘긴다
    }
  }, []);

  /**
   * 새 빈 항목 만들기(2026-09-22 확장 — Cmd+N도 보고 있는 탭을 따른다).
   *
   * 할 일 탭이면 빈 할 일(`type: "todo"`, 제목 "새 할 일")을 만들고 필터를 할 일로
   * 유지하며 투두 선택 경로로 연다. 기록·그림 탭에서는 기존대로 빈 기록("새 노트")을
   * 만들고 기록 필터로 돌아온다.
   */
  const handleCreateNote = useCallback(async (folder?: string) => {
    setFocusNewBody(false);
    closeSearch();
    notifyBeforeEditorSwitch(null);
    const todo = listView.kind === 'todo';
    const target = folder ?? INBOX_FOLDER;
    try {
      const id = await createNote(target, { todo });
      setShowReviewQueue(false);
      setShowSecretsViewer(false);
      setFolderSelection(target);
      setListView({ ...listView, kind: todo ? 'todo' : 'record' });
      if (todo) {
        setActiveNoteId(null);
        setSelectedTodoIdWithSync(id);
      } else {
        setSelectedTodoId(null);
      }
      setMobileSidebarOpen(false);
      return id;
    } catch (error) {
      setAppError(toErrorMessage(error, todo ? '할 일을 만들지 못했습니다.' : '기록을 만들지 못했습니다.'));
    }
  }, [notifyBeforeEditorSwitch, createNote, listView, setListView, setAppError, closeSearch, setSelectedTodoIdWithSync, setActiveNoteId]);

  // `오늘 할 일` 보기에서 같은 종류·정렬로 다시 누르면(변화 없음) 전체 할 일로 푼다.
  // 정렬 등 다른 값만 바꾸는 호출은 오늘 보기를 유지한다.
  const handleListViewChange = useCallback((next: NoteListView) => {
    if (
      todayView && next.kind === listView.kind && next.sort === listView.sort
      && next.hideDone === listView.hideDone && next.pinnedCollapsed === listView.pinnedCollapsed
    ) setTodayView(false);
    setListView(next);
  }, [todayView, listView, setListView]);

  const handleSelectFolder = useCallback((folder: FolderSelection) => {
    // 같은 폴더(전체)를 다시 골라도 `오늘 할 일` 제한은 풀린다(검수 SSR-001).
    setTodayView(false);
    setFolderSelection(folder);
    setSidebarPane("notes");
  }, []);

  // 폴더 우클릭 메뉴/다이얼로그 상태(2026-08-19 폴더 작업).
  const [folderMenu, setFolderMenu] = useState<{ folder: FolderNode; x: number; y: number } | null>(null);
  const [folderNameDialog, setFolderNameDialog] = useState<
    | { mode: "rename"; folder: FolderNode }
    | { mode: "create"; parent: FolderNode }
    | null
  >(null);
  const [folderPendingDelete, setFolderPendingDelete] = useState<FolderNode | null>(null);
  const [noteToMove, setNoteToMove] = useState<{ id: string; vault: string | null } | null>(null);
  const [noteMenu, setNoteMenu] = useState<{ note: NoteListItem; x: number; y: number } | null>(null);

  // 폴더 우클릭 작업. 실제 IO는 useNotes → local-fs → adapter/Rust 경계를 지나간다.
  const handleFolderContextMenu = useCallback((folder: FolderNode, position: { x: number; y: number }) => {
    setFolderMenu({ folder, ...position });
  }, []);

  const handleFolderNameSubmit = useCallback(async (name: string) => {
    const dialog = folderNameDialog;
    setFolderNameDialog(null);
    try {
      if (!dialog) return;
      if (dialog.mode === "rename") {
        await renameFolder(dialog.folder.path, name);
      } else {
        await createFolder(name, dialog.parent.path);
      }
    } catch (error) {
      setAppError(toErrorMessage(error, "폴더 작업을 완료하지 못했습니다."));
    }
  }, [folderNameDialog, renameFolder, createFolder, setAppError]);

  const handleConfirmFolderDelete = useCallback(async () => {
    const folder = folderPendingDelete;
    setFolderPendingDelete(null);
    if (!folder) return;
    try {
      await trashFolder(folder.path);
    } catch (error) {
      setAppError(toErrorMessage(error, "폴더를 삭제하지 못했습니다."));
    }
  }, [folderPendingDelete, trashFolder, setAppError]);

  // 노트 → 투두 변환 / 폴더 이동 (2026-08-15 1단계 리팩토링으로 App에서 추출)
  // 2026-08-19: 메뉴에서 상호 변환을 쓰므로 사용 지점보다 앞에 둔다.
  const { handleConvertToTodo, handleConvertTodoToNote } = useTodoNoteActions({
    notes,
    refreshNotes,
    setAppError,
  });

  // 노트 항목 우클릭 메뉴 — 현재는 보관 이동. 실제 이동은 기존 moveNote 경로다.
  const handleNoteContextMenu = useCallback((note: NoteListItem, position: { x: number; y: number }) => {
    setNoteMenu({ note, ...position });
  }, []);

  /**
   * 목록 우클릭 즐겨찾기 토글(2026-09-19 TICK-UX-013).
   *
   * 열린 노트는 에디터 경유(handleFavoriteUpdate)로 저장한다 — App이 직접 쓰면 자동 저장과
   * 경합해 별표가 되돌아갈 수 있다(에디터-밖-쓰기 정리 규칙). 닫힌 노트는 frontmatter만 고친다.
   * 해제는 값을 undefined로 넘겨 키를 지운다(파일에는 true만 남긴다).
   */
  const handleToggleFavorite = useCallback(async (note: NoteListItem) => {
    const next = note.favorite !== true;
    try {
      setAppError(null);
      if (note.id === editorNoteId && openFavoriteUpdateRef.current) {
        await openFavoriteUpdateRef.current(next);
        return;
      }
      await updateNoteFrontmatter(note.fileBasename ?? note.id, note.folder, {
        favorite: next ? true : undefined,
        updatedAt: new Date().toISOString(),
      });
      await refreshNotes();
    } catch (error) {
      setAppError(toErrorMessage(error, '즐겨찾기를 바꾸지 못했습니다.'));
    }
  }, [editorNoteId, refreshNotes, setAppError]);

  const handleMoveRecord = useCallback(async (noteId: string, toFolder: string) => {
    const note = notes.find((item) => item.id === noteId);
    if (!note || note.drawing || note.excalidrawPlugin) return false;
    if (note.folder === toFolder) return true;
    try {
      setAppError(null);
      if (editorNoteId === noteId && !showReviewQueue && !showSecretsViewer) {
        if (!openMoveRef.current) throw new Error('편집기를 준비 중입니다. 잠시 뒤 다시 이동해 주세요.');
        return await openMoveRef.current(() => moveNote(noteId, toFolder));
      } else {
        await moveNote(noteId, toFolder);
        return true;
      }
    } catch (error) {
      setAppError(toErrorMessage(error, '기록을 옮기지 못했습니다.'));
      return false;
    }
  }, [notes, editorNoteId, showReviewQueue, showSecretsViewer, moveNote, setAppError]);

  const handleArchiveNote = useCallback(async (noteId: string) => {
    const note = notes.find((item) => item.id === noteId);
    if (!note || note.drawing || note.excalidrawPlugin) return false;
    try {
      setAppError(null);
      if (note.folder !== ARCHIVE_FOLDER) {
        await createFolder(ARCHIVE_FOLDER);
        return await handleMoveRecord(noteId, ARCHIVE_FOLDER);
      }
      return true;
    } catch (error) {
      setAppError(toErrorMessage(error, "노트를 보관 폴더로 옮기지 못했습니다."));
      return false;
    }
  }, [notes, createFolder, handleMoveRecord, setAppError]);

  // 노트↔투두 변환. 열린 항목은 에디터 경유 저장으로, 닫힌 항목은 기존
  // frontmatter 경로로 보낸다(에디터 밖 중복 쓰기 레이스 재생 방지).
  const handleConvertNoteKind = useCallback(async (noteId: string, target: TodoKindUpdateTarget) => {
    const note = notes.find((item) => item.id === noteId);
    if (!note) return;
    const editorVisible = !showReviewQueue && !showSecretsViewer && editorNoteId === noteId;
    try {
      setAppError(null);
      if (editorVisible) {
        const updateKind = openTodoKindUpdateRef.current;
        if (!updateKind) return; // 에디터가 준비되지 않으면 쓰지 않는다.
        await updateKind(target);
      } else if (target === "todo") {
        await handleConvertToTodo(noteId);
      } else {
        await handleConvertTodoToNote(noteId);
      }

      // 선택 상태도 새 종류를 따라간다. 제목 변경과 투두 메타 저장 경로가 맞게.
      if (target === "todo") {
        setActiveNoteId(null);
        setSelectedTodoIdWithSync(noteId);
      } else {
        setSelectedTodoId(null);
        setActiveNoteIdWithSync(noteId);
      }
    } catch (error) {
      setAppError(toErrorMessage(error, "항목 종류를 바꾸지 못했습니다."));
    }
  }, [
    notes,
    showReviewQueue,
    showSecretsViewer,
    editorNoteId,
    setAppError,
    handleConvertToTodo,
    handleConvertTodoToNote,
    setSelectedTodoIdWithSync,
    setActiveNoteIdWithSync,
    setActiveNoteId,
  ]);
  // 오른쪽 패널(백링크) 켜고 끄기 — 레일 아이콘과 패널 접기 버튼이 같은 상태를 쓴다.
  const [showBacklinkPanel, setShowBacklinkPanel] = useState(false);
  // 사이드바 2열(폴더+노트) 일괄 접힘 — Cmd+\ 집중 모드(2026-08-18 TICK-UX-008 2단계).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Cmd+K 검색 포커스 신호. 값이 커질 때 SearchBar가 입력창을 깨운다.
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setSidebarCollapsed(false);
    setMobileSidebarOpen(true);
    setSidebarPane("notes");
    setSearchFocusSignal(value => value + 1);
  }, []);
  // 목록에서 이미 열린 노트를 다시 눌렀을 때 에디터로 포커스를 되돌리는 신호.
  const [editorFocusSignal, setEditorFocusSignal] = useState(0);

  // 좌우 패널 폭 (2026-08-16 [kyle] 요청 — 패널 리사이저).
  // 설계: docs/waterfall/03-상세설계/패널-너비-조정.md
  const { widths: panelWidths, compact: compactSidebar, setPanelWidth, commitPanelWidths } =
    usePanelWidths({ backlinkOpen: showBacklinkPanel });

  // 백링크: early return 전에 호출해야 Hooks 순서 보장
  const backlinkTargetId = selectedTodoId ?? activeNoteId;
  const { backlinks } = useBacklinks(backlinkTargetId, linkIndex);

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!activeNoteId) return;
      // 제목이 실제로 바뀐 경우만 파일명 동기화 대상으로 기록한다(2단계).
      const current = notes.find((n) => n.id === activeNoteId);
      if (current && current.title !== title) markTitleChanged(activeNoteId);
      renameNote(activeNoteId, title);
    },
    [activeNoteId, renameNote, notes, markTitleChanged],
  );

  // aliases 변경 핸들러 (링크 인덱스 즉시 반영)
  const handleAliasesChange = useCallback(
    (aliases: string[]) => {
      const targetId = selectedTodoId ?? activeNoteId;
      if (targetId) updateNoteAliases(targetId, aliases);
    },
    [selectedTodoId, activeNoteId, updateNoteAliases],
  );

  // 목록 열은 노트와 투두를 함께 담는다(2026-08-18 [kyle] 결정: "한 화면 + 종류 필터").
  // 좁혀 보는 것은 NoteColumn 위쪽 필터가 맡는다.
  const sidebarNotes = notes;

  // 볼트 전환 성공 시 휘발성 상태 초기화 (useVaultSwitch에 주입)
  const resetTransientState = useCallback(() => {
    // 시작과 같은 규칙: 저장된 시작 화면 설정을 다시 읽어 전환 직후 화면을 정한다.
    const { goToday } = currentStartPlan();
    setFolderSelection(goToday ? null : INBOX_FOLDER);
    if (goToday) setListViewState((view) => ({ ...view, kind: 'todo' }));
    setTodayView(goToday);
    setNoteToMove(null);
    setSidebarPane(goToday ? "notes" : "folders");
    setMobileSidebarOpen(false);
    setShowBacklinkPanel(false);
    setSelectedTodoId(null);
    setShowReviewQueue(false);
    setShowSecretsViewer(false);
    closeSearch();
  }, [closeSearch]);

  // 볼트 전환 정책: 위험 상태(미저장 변경/외부 수정 pending)면 모달 확인 (useVaultSwitch)
  const {
    showRiskySwitchDialog,
    setShowRiskySwitchDialog,
    handleSelectVault,
    handleConfirmRiskySwitch,
  } = useVaultSwitch({
    selectVault,
    editorDirty,
    editorExternalPending,
    resetTransientState,
    onSwitchError: (error) => setAppError(
      toErrorMessage(error, "볼트를 열지 못했습니다. 이전 볼트를 그대로 유지합니다."),
    ),
  });

  // Stale active state fallback: 외부 삭제/이동으로 선택이 notes에 없으면 자동 복구.
  // 설계: docs/waterfall/03-상세설계/파일-감시-외부-수정-반영-정책.md §10.4
  useStaleActiveFallback({
    notes,
    activeNoteId,
    selectedTodoId,
    setActiveNoteId,
    setSelectedTodoId,
  });

  const handleToggleReviewQueue = useCallback(() => {
    if (!showReviewQueue && (editorDirty || editorExternalPending)) {
      setAppError("아직 저장하지 못한 글이 있습니다. 저장 또는 외부 수정 확인을 마친 뒤 AI 정리를 다시 열어 주세요.");
      return;
    }
    setShowReviewQueue((prev) => {
      if (!prev) setShowSecretsViewer(false); // 한 번에 하나의 특수 패널만
      return !prev;
    });
  }, [showReviewQueue, editorDirty, editorExternalPending, setAppError]);

  const handleToggleSecretsViewer = useCallback(() => {
    if (!showSecretsViewer && (editorDirty || editorExternalPending)) {
      setAppError("아직 저장하지 못한 글이 있습니다. 저장 또는 외부 수정 확인을 마친 뒤 보안 메모를 다시 열어 주세요.");
      return;
    }
    setShowSecretsViewer((prev) => {
      if (!prev) setShowReviewQueue(false); // 한 번에 하나의 특수 패널만
      return !prev;
    });
  }, [showSecretsViewer, editorDirty, editorExternalPending, setAppError]);

  // 현재 활성 아이템 (노트 또는 투두) 의 폴더 정보
  const activeItemId = selectedTodoId ?? activeNoteId;
  const activeItem = activeItemId ? notes.find((n) => n.id === activeItemId) : null;
  // 정보 바 폴더 이동 선택지(TICK-UX-007): 폴더 트리 순서 그대로, 이미지 첨부 폴더만 뺀다.
  const moveFolderOptions = useMemo(
    () => collectFolderPaths(folders).filter(
      (path) => !isAttachmentsFolder(path) && !path.startsWith(`${ATTACHMENTS_FOLDER}/`),
    ),
    [folders],
  );
  // 정보 바 태그 칩 → 제목 검색(useSearch는 태그도 매칭한다). RAG 모드면 제목 모드로 돌린다.
  const handleSearchTag = useCallback((tag: string) => {
    if (ragSearch.mode !== "title") handleSearchModeChange("title");
    search.setQuery(tag);
    openSearch();
  }, [ragSearch.mode, handleSearchModeChange, search, openSearch]);

  // 노트/투두 열기 시 특수 패널 닫기 (useNoteSelection에 주입)
  const closeSpecialPanels = useCallback(() => {
    setShowReviewQueue(false);
    setShowSecretsViewer(false);
  }, []);

  // 선택/열기 흐름 (2026-08-15 1단계 리팩토링으로 App에서 추출)
  const {
    handleOpenNote,
    handleSelectSearchHit,
    handleSelectRagHit,
  } = useNoteSelection({
    notes,
    // 파일명 동기화 래퍼 경유 — 선택이 바뀌기 직전, 떠나는 노트의 rename을 시도한다.
    setActiveNoteId: setActiveNoteIdWithSync,
    setSelectedTodoId: setSelectedTodoIdWithSync,
    closeSpecialPanels,
    clearTitleSearch: () => search.setQuery(""),
    clearRagSearch: () => ragSearch.setQuery(""),
  });

  // 투두 제목 변경: 파일 제목은 에디터 저장이 이미 썼다. 여기는 목록 상태만 갱신한다.
  const handleTodoTitleChange = useCallback((title: string) => {
    if (!selectedTodoId) return;
    const todo = notes.find((n) => n.id === selectedTodoId);
    if (todo && todo.title !== title) {
      markTitleChanged(selectedTodoId); // 파일명 동기화 대상 기록(2단계)
      renameNote(selectedTodoId, title);
    }
  }, [selectedTodoId, renameNote, notes, markTitleChanged]);

  // 열려 있는 투두는 에디터 경유 메타 저장으로 토글한다. 에디터가 언마운트된
  // 특수 패널 화면이라면 기존 닫힌 노트 경로를 쓴다.
  const handleToggleTodo = useCallback(async (noteId: string) => {
    const todo = notes.find((n) => n.id === noteId);
    if (!todo) return;
    const editorVisible = !showReviewQueue && !showSecretsViewer && editorNoteId === noteId;
    if (editorVisible) {
      const updateOpenTodoMeta = openTodoMetaUpdateRef.current;
      if (!updateOpenTodoMeta) return; // 에디터가 준비되지 않으면 쓰지 않는다(fail-closed).
      await updateOpenTodoMeta("done", !todo.done);
      return;
    }
    await todosHook.toggleTodo(noteId);
  }, [notes, showReviewQueue, showSecretsViewer, editorNoteId, todosHook]);

  // 볼트 전환/폴더 삭제로 선택한 폴더가 사라지면 "전체"로 되돌린다.
  // 그러지 않으면 노트 열이 영원히 빈 목록으로 남는다.
  //
  // effect에서 setState로 되돌리지 않고 **렌더 중 파생값**으로 계산한다. state를 고치는
  // effect는 한 프레임 늦게 반영돼 그 사이 빈 목록이 깜빡이고, lint(set-state-in-effect)도
  // 막는다. 사용자가 고른 값(folderSelection)은 그대로 두고 화면에 쓰는 값만 보정한다 —
  // 폴더가 다시 생기면(볼트 되돌리기) 선택이 살아난다.
  const knownFolderPaths = useMemo(() => collectFolderPaths(folders), [folders]);
  const effectiveFolderSelection = useMemo(
    () => resolveFolderSelection(folderSelection, knownFolderPaths),
    [folderSelection, knownFolderPaths],
  );

  // `오늘 할 일`은 전체 + 할 일 조건에서만 성립한다. 폴더·종류를 바꾸면 보기를 푼다.
  useEffect(() => {
    if (todayView && (listView.kind !== 'todo' || folderSelection !== null)) setTodayView(false);
  }, [todayView, listView.kind, folderSelection]);

  const revealActiveItem = useCallback(() => {
    if (!activeItem) return;
    closeSearch();
    setTodayView(false);
    setFolderSelection(activeItem.folder);
    setListView({
      ...listView,
      kind: activeItem.drawing ? "drawing" : activeItem.type === "todo" ? "todo" : "record",
      hideDone: activeItem.type === "todo" && activeItem.done ? false : listView.hideDone,
      pinnedCollapsed: activeItem.favorite ? false : listView.pinnedCollapsed,
    });
    setSidebarPane("notes");
    setMobileSidebarOpen(true);
    setSidebarCollapsed(false);
  }, [activeItem, closeSearch, listView, setListView]);

  /**
   * 상단 입력으로 만든 항목을 연다(2026-09-22).
   *
   * 할 일 필터에서 만든 항목은 투두 선택 경로로 열고 필터도 할 일로 유지한다. 만들기 직후에는
   * `notes` 상태가 아직 갱신 전이라 handleOpenNote의 종류 판정에 기대지 않고 여기서 정한다.
   * 기록·그림 필터에서는 기존대로 기록 필터로 돌아와 새 기록이 보이게 한다.
   */
  const openCreatedRecord = useCallback((id: string, folder: string) => {
    if (listView.kind === 'todo') {
      setActiveNoteId(null);
      setSelectedTodoIdWithSync(id);
    } else {
      handleOpenNote(id);
    }
    setFocusNewBody(true);
    setFolderSelection(folder);
    setListView({ ...listView, kind: listView.kind === 'todo' ? 'todo' : 'record' });
    setMobileSidebarOpen(false);
  }, [handleOpenNote, listView, setListView, setSelectedTodoIdWithSync, setActiveNoteId]);
  /** 지금 보고 있는 필터가 할 일이면 상단 입력도 할 일을 만든다(2026-09-22). */
  const createQuickRecord = useCallback(
    (title: string, folder: string, onCreated: (id: string) => void) =>
      createQuickNote(title, folder, onCreated, { todo: listView.kind === 'todo' }),
    [createQuickNote, listView.kind],
  );
  const handleQuickRecord = useQuickRecordCreation({
    vaultPath, folder: effectiveFolderSelection, listKind: listView.kind, editorNoteId,
    editorDirty, editorExternalPending, searchOpen, showReviewQueue, showSecretsViewer,
    create: createQuickRecord, open: openCreatedRecord,
  });

  // 전역 단축키 3종(2026-08-18 TICK-UX-008 2단계).
  // Cmd/Ctrl+\: 사이드바 2열 일괄 토글, Cmd/Ctrl+N: 새 항목, Cmd/Ctrl+K: 검색 포커스.
  // 모달(삭제 확인/위험 볼트 전환)이나 검토 큐·보안 메모가 열려 있으면 에디터 조작과
  // 섞이지 않게 무시한다. hasVault가 아니어도 무시한다.
  //
  // 검수 후속 2건(2026-08-18) 반영:
  // - Cmd+N은 고른 폴더에 빈 일반 기록을 만들고 편집한다. 빠른 제목 입력은
  //   제목을 보존한 채 새 본문으로 진입한다.
  // - 한국어 입력 소스에서는 백슬래시 키가 e.key "₩"로 들어올 수 있어 e.code 판정을
  //   병행한다(실창 Tauri webview 최종 확인 필요).
  useEffect(() => {
    if (!hasVault) return;
    if (showRiskySwitchDialog || notePendingDelete || noteToMove || showReviewQueue || showSecretsViewer) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "\\" || e.code === "Backslash") {
        e.preventDefault();
        if (compactSidebar) setMobileSidebarOpen((open) => !open);
        else setSidebarCollapsed((collapsed) => !collapsed);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        // handleCreateNote는 createNote에 파일명 동기화(switch-away) 알림을 얹은 래퍼다.
        // 투두 경로는 handleSelectTodo가 동기화 래퍼 세터를 지나므로 별도 알림이 필요 없다.
        void handleCreateNote(effectiveFolderSelection ?? undefined);
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        openSearch();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    hasVault,
    showRiskySwitchDialog,
    notePendingDelete,
    noteToMove,
    compactSidebar,
    showReviewQueue,
    showSecretsViewer,
    handleCreateNote,
    listView,
    effectiveFolderSelection,
    openSearch,
  ]);

  // 아이콘 레일 버튼 (2026-08-18 [kyle] 요청 — 사이드바 하단 버튼 5종을 옮겼다).
  // 설계: docs/waterfall/03-상세설계/사이드바-3열-레이아웃.md
  const railPrimaryActions = useMemo<RailAction[]>(() => {
    const actions: RailAction[] = [
      {
        id: "todos",
        // 별도 패널을 여는 대신 목록을 투두만으로 좁힌다(2026-08-18).
        // "전체" 필터 제거(2026-08-29)로 해제 시 기본 보기(노트)로 되돌린다.
        label: "전체 할 일 보기",
        icon: RailIcons.todo,
        onClick: () => {
          // 전체 할 일은 언제나 오늘 제한을 푼다. 앞날 할 일의 진입점이다(검수 SSR-001).
          setTodayView(false);
          setFolderSelection(null);
          setListView({ ...listView, kind: 'todo' });
        },
        active: listView.kind === "todo" && folderSelection === null,
      },
    ];
    if (hasVault) {
      actions.push({
        id: "review-queue",
        label: "AI 정리 열기/닫기",
        icon: RailIcons.reviewQueue,
        onClick: handleToggleReviewQueue,
        active: showReviewQueue,
        badge: reviewBadge,
      });
    }
    return actions;
  }, [
    listView,
    folderSelection,
    setListView,
    hasVault,
    handleToggleReviewQueue,
    showReviewQueue,
    reviewBadge,
  ]);

  const railSecondaryActions = useMemo<RailAction[]>(() => {
    const actions: RailAction[] = [
      { id: 'secrets', label: '보안 메모 열기/닫기 — 값은 기본 가림', shortLabel: '보안 메모', icon: RailIcons.secrets,
        onClick: handleToggleSecretsViewer, active: showSecretsViewer },
      { id: 'backlink', label: '백링크 패널 켜기/끄기', icon: RailIcons.backlink,
        onClick: () => setShowBacklinkPanel(prev => !prev), active: showBacklinkPanel,
        inDrawer: false /* 1024px 미만 백링크 숨김은 의도(design-rules) */ },
    ];
    if (hasVault) {
      actions.push({
        id: "export-site",
        label:
          exportSiteStatus === "exporting" ? "HTML 내보내는 중…" : "HTML 내보내기",
        shortLabel: exportSiteStatus === "exporting" ? "내보내는 중…" : "HTML 내보내기",
        icon: RailIcons.exportSite,
        onClick: exportSiteNow,
        disabled: exportSiteStatus === "exporting",
      });
    }
    const nextStartScreen = toggleStartScreen(startScreen);
    actions.push({
      id: "start-screen",
      label: `시작 화면: ${START_SCREEN_LABELS[startScreen]} — 누르면 ${START_SCREEN_LABELS[nextStartScreen]}(으)로 바꿉니다`,
      shortLabel: `시작 화면: ${START_SCREEN_LABELS[startScreen]}`,
      icon: RailIcons.startScreen,
      // 다음 시작과 다음 볼트 전환부터 적용한다. 지금 화면은 바꾸지 않는다.
      onClick: () => {
        writeStartScreen(nextStartScreen);
        setStartScreenState(nextStartScreen);
      },
    });
    actions.push({
      id: "select-vault",
      label: "볼트 폴더 변경/재선택",
      shortLabel: "볼트 폴더 변경",
      icon: RailIcons.vault,
      onClick: handleSelectVault,
    });
    return actions;
  }, [hasVault, exportSiteStatus, exportSiteNow, handleSelectVault, handleToggleSecretsViewer, showSecretsViewer, showBacklinkPanel, startScreen]);

  // 1024px 미만 드로어 도구 줄 — 레일과 같은 동작 정의를 재사용한다(DEF-UI-001).
  const drawerToolActions = useMemo(
    () => railSecondaryActions.filter((action) => action.inDrawer !== false),
    [railSecondaryActions],
  );

  // 위키링크 UX 2차: unresolved `[[title]]` 승격.
  // 현재 편집 중인 노트의 폴더와 같은 폴더에 새 노트를 만든다.
  // 저장 후 watcher/linkIndex full rebuild로 자동 resolved 갱신.
  const activeFolderForLink = useMemo(() => {
    const id = selectedTodoId ?? activeNoteId;
    return id ? (notes.find((n) => n.id === id)?.folder ?? "") : "";
  }, [selectedTodoId, activeNoteId, notes]);

  const handleCreateLinkedNote = useCallback(
    async (title: string) => {
      await createNoteWithTitle(title, activeFolderForLink);
      await refreshNotes();
      reloadLinkIndex();
    },
    [createNoteWithTitle, activeFolderForLink, refreshNotes, reloadLinkIndex],
  );

  if (notesLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white text-gray-400 dark:bg-zinc-900 dark:text-zinc-500">
        로딩 중…
      </div>
    );
  }

  if (!hasVault) {
    return <VaultSelectionScreen onSelectVault={handleSelectVault} notice={appError ?? startupVaultNotice} />;
  }

  const movingNote = noteToMove?.vault === vaultPath
    ? notes.find((note) => note.id === noteToMove.id && !note.drawing && !note.excalidrawPlugin)
    : undefined;

  // 중앙 영역에 뭘 보여줄지 결정
  // 투두 선택 시에도 NoteEditor를 사용 (투두 = 노트이므로)
  const showEditor = editorNoteId !== null;
  const showEmpty = !showEditor;
  // 그림(`*.excalidraw`)은 노트 에디터가 아니라 전용 캔버스 화면에서 연다(TICK-DRAW-001).
  const activeDrawing = activeItem?.drawing === true ? activeItem : null;
  const activeDrawingPath = activeDrawing
    ? `${vaultPath ?? ""}/${activeDrawing.filePath ?? activeDrawing.fileBasename}`
    : null;

  // 투두 선택 시 제목 변경 핸들러
  const handleEditorTitleChange = selectedTodoId ? handleTodoTitleChange : handleTitleChange;

  return (
    <div className="flex h-screen w-screen bg-white dark:bg-zinc-900">
      {appError && (
        <AppErrorBanner
          message={appError}
          onDismiss={() => setAppError(null)}
        />
      )}

      {/* 좁은 창 탐색 열기. 1024px 이상은 기존 고정 사이드바를 쓴다. */}
      <button
        type="button"
        onClick={() => setMobileSidebarOpen(true)}
        aria-label="사이드바 열기"
        className="fixed left-3 top-3 z-30 inline-flex h-11 w-11 items-center justify-center rounded-md border border-gray-200 bg-white text-lg text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      >
        ☰
      </button>
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {hasVault && <button type="button" onClick={handleToggleReviewQueue} aria-label="AI 정리 열기/닫기" aria-pressed={showReviewQueue}
        className="fixed right-3 top-3 z-30 min-h-11 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 focus-visible:ring-2 focus-visible:ring-blue-500 lg:hidden dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">AI 정리</button>}

      {/* 0. 아이콘 레일 — 화면 제일 왼쪽 단축 버튼 (2026-08-18 [kyle] 요청) */}
      <AppRail primary={railPrimaryActions} secondary={railSecondaryActions} />

      {/* HTML 내보내기 결과 — 레일 버튼에는 글자가 없으므로 하단 안내로 알린다 */}
      {exportSiteMessage && (
        <p
          role="status"
          aria-live="polite"
          className={`fixed bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-md px-3 py-2 text-xs shadow-lg ${
            exportSiteStatus === "error"
              ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200"
              : "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-200"
          }`}
        >
          {exportSiteMessage}
        </p>
      )}

      <SidebarNavigation
        open={mobileSidebarOpen} compact={compactSidebar} collapsed={sidebarCollapsed}
        pane={sidebarPane} onPaneChange={setSidebarPane} onClose={() => setMobileSidebarOpen(false)}
        folderWidth={panelWidths.folder} noteWidth={panelWidths.notes}
        onResizeFolder={(width) => setPanelWidth("folder", width)} onResizeEnd={commitPanelWidths}
        toolRow={<DrawerToolRow actions={drawerToolActions} onAfterAction={() => setMobileSidebarOpen(false)} />}
        folders={
          <FolderColumn
            folders={folders}
            notes={sidebarNotes}
            view={listView}
            selection={effectiveFolderSelection}
            onSelect={handleSelectFolder}
            onCreateFolder={createFolder}
            onToggleProject={toggleProject}
            onMoveNote={handleMoveRecord}
            onFolderContextMenu={handleFolderContextMenu}
          />
        }
        notes={
          <NoteColumn
            notes={sidebarNotes}
            selection={effectiveFolderSelection}
            activeNoteId={editorNoteId}
            view={listView}
            todayView={todayView}
            searching={searchOpen && (ragSearch.mode === 'rag' ? ragSearch.query.trim().length > 0 : search.isActive)}
            onViewChange={handleListViewChange}
            onToggleTodo={handleToggleTodo}
            onSelectNote={(noteId) => {
              if (showReviewQueue && notes.some(note => note.id === noteId && note.folder === INBOX_FOLDER && !note.drawing && !note.excalidrawPlugin)) {
                setSelectedTodoId(null);
                setActiveNoteIdWithSync(noteId);
                setEditorFocusSignal(signal => signal + 1);
                setMobileSidebarOpen(false);
                return;
              }
              // 목록에 투두가 섞여 있으므로 종류에 맞는 열기 경로를 쓴다.
              handleOpenNote(noteId);
              // 같은 노트를 다시 누르면 NoteEditor가 remount되지 않는다. 이 신호로
              // 편집 DOM을 다시 포커스해 "누르면 바로 타이핑" 경험을 유지한다.
              setEditorFocusSignal((signal) => signal + 1);
              setMobileSidebarOpen(false);
            }}
            searchOpen={searchOpen}
            onToggleSearch={() => searchOpen ? closeSearch(true) : openSearch()}
            captureSlot={
              <QuickRecordInput key={vaultPath} hidden={searchOpen} focusSignal={quickFocusSignal}
                todo={listView.kind === 'todo'} onCreate={handleQuickRecord} />
            }
            onDeleteNote={handleRequestDeleteNote}
            onNoteContextMenu={handleNoteContextMenu}
            searchSlot={
              <SearchBar
                mode={ragSearch.mode}
                onModeChange={handleSearchModeChange}
                query={search.query}
                onQueryChange={search.setQuery}
                hits={search.hits}
                isActive={search.isActive}
                searching={search.searching}
                skipped={search.skipped}
                onSelectHit={(hit) => {
                  handleSelectFolder(hit.note.folder);
                  setListView({
                    ...listView,
                    kind: hit.note.drawing ? "drawing" : hit.note.type === "todo" ? "todo" : "record",
                    hideDone: false,
                  });
                  handleSelectSearchHit(hit);
                  closeSearch();
                  setMobileSidebarOpen(false);
                }}
                ragQuery={ragSearch.query}
                onRagQueryChange={ragSearch.setQuery}
                ragHits={ragSearch.hits}
                ragStatus={ragSearch.status}
                ragError={ragSearch.error}
                ragIndexStatus={ragSearch.indexStatus}
                onSelectRagHit={(hit) => {
                  handleSelectRagHit(hit);
                  closeSearch();
                  setMobileSidebarOpen(false);
                }}
                focusSignal={searchFocusSignal}
                onClose={() => closeSearch(true)}
              />
            }
          />
        }
      />

      {/* 1-d. 노트 열 폭 조절 손잡이 */}
      <PanelResizer
        panel="notes"
        width={panelWidths.notes}
        onResize={(next) => setPanelWidth("notes", next)}
        onResizeEnd={commitPanelWidths}
        label="노트 목록 패널 너비 조절"
        className={`hidden lg:block ${sidebarCollapsed ? "lg:hidden" : ""}`}
        // 사이드바가 접혀 있으면 리사이저도 함께 숨긴다(집중 모드).
      />

      {/* 2. 투두는 별도 열이 아니라 목록 열의 '투두' 필터로 본다
             (2026-08-18 [kyle] 결정 — 열이 5개가 되어 답답하다는 지적). */}

      {/* 3. 중앙 메인 영역 — 검토 큐/보안 메모가 열려 있으면 해당 패널, 아니면 노트/투두 에디터 */}
      <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden pt-16 lg:pt-0">
        {!showReviewQueue && !showSecretsViewer && !searchOpen && activeItem && (
          <OutsideListNotice
            note={activeItem} selection={effectiveFolderSelection} view={listView}
            onReveal={revealActiveItem}
          />
        )}
        {showReviewQueue && (
          <Suspense fallback={<div className="flex-1 h-full flex items-center justify-center text-gray-400 dark:text-zinc-500">검토 큐 로딩 중…</div>}>
            <ReviewQueuePanel
              key={vaultPath}
              vaultPath={vaultPath ?? ''}
              selectedNoteId={editorNoteId}
              selectionSignal={editorFocusSignal}
              onSelectCandidate={(path) => {
                const note = notes.find(item => item.folder === INBOX_FOLDER && !item.drawing && !item.excalidrawPlugin && `${item.folder}/${item.fileBasename}.md` === path);
                if (!note) return;
                setSelectedTodoId(null);
                setActiveNoteIdWithSync(note.id);
                setEditorFocusSignal(signal => signal + 1);
              }}
              folders={folders}
              onNotesMoved={async () => { await refreshNotes(); }}
              hook={reviewQueue}
              onClose={() => setShowReviewQueue(false)}
              notes={notes}
              onArchiveNote={handleArchiveNote}
            />
          </Suspense>
        )}

        {!showReviewQueue && showSecretsViewer && (
          <Suspense fallback={<div className="flex-1 h-full flex items-center justify-center text-gray-400 dark:text-zinc-500">보안 메모 로딩 중…</div>}>
            <SecretsViewerPanel onClose={() => setShowSecretsViewer(false)} />
          </Suspense>
        )}

        {!showReviewQueue && !showSecretsViewer && showEditor && activeDrawing && activeDrawingPath && (
          <Suspense fallback={<div className="flex-1 h-full flex items-center justify-center text-gray-400 dark:text-zinc-500">그림 로딩 중…</div>}>
            <DrawingEditor
              key={activeDrawing.id}
              absolutePath={activeDrawingPath}
              title={activeDrawing.title}
            />
          </Suspense>
        )}

        {!showReviewQueue && !showSecretsViewer && showEditor && !activeDrawing && (
          <Suspense fallback={<div className="flex-1 h-full flex items-center justify-center text-gray-400 dark:text-zinc-500">에디터 로딩 중…</div>}>
            <NoteEditor
              key={`${vaultPath}:${editorNoteId}`}
              noteId={editorNoteId!}
              fileBasename={activeItem?.fileBasename}
              folder={activeItem?.folder}
              imageFiles={vaultImageFiles}
              onImagesInserted={() => { void reloadImageFiles(); }}
              createdAt={activeItem?.createdAt}
              updatedAt={activeItem?.updatedAt}
              note={activeItem ?? undefined}
              onSelectFolder={setFolderSelection}
              folderOptions={moveFolderOptions}
              onMoveToFolder={moveNote}
              onSearchTag={handleSearchTag}
              onTodoMetaCommit={() => {
                // 정보 바 투두 필드 커밋이 저장됐다 — 목록(dueDate/priority 표시) 재스캔.
                void refreshNotes();
              }}
              onTodoMetaUpdateReady={handleTodoMetaUpdateReady}
              onFavoriteUpdateReady={handleFavoriteUpdateReady}
              onTodoKindUpdateReady={handleTodoKindUpdateReady}
              onMoveReady={handleMoveReady}
              focusSignal={editorFocusSignal}
              focusBodyOnLoad={focusNewBody}
              onTitleChange={handleEditorTitleChange}
              onAliasesChange={handleAliasesChange}
              onContentSave={handleContentSaved}
              linkIndex={linkIndex}
              onOpenNote={handleOpenNote}
              onCreateLinkedNote={handleCreateLinkedNote}
              onDirtyChange={handleEditorDirtyChange}
              onExternalPendingChange={handleEditorExternalPendingChange}
            />
          </Suspense>
        )}

        {!showReviewQueue && !showSecretsViewer && showEmpty && (
          notes.length === 0 ? (
            <EmptyVaultScreen onCreateNote={handleCreateNote} />
          ) : (
            <div className="flex-1 h-full flex items-center justify-center text-gray-400 dark:text-zinc-500">
              노트를 선택하거나 새로 만드세요
            </div>
          )
        )}
      </main>

      {/* 4. 백링크 패널 (우측) + 폭 조절 손잡이 — 백링크가 숨는 구간(<lg)에서는 손잡이도 숨긴다 */}
      {showEditor && showBacklinkPanel && !showReviewQueue && !showSecretsViewer && (
        <>
          <PanelResizer
            panel="backlink"
            width={panelWidths.backlink}
            onResize={(next) => setPanelWidth("backlink", next)}
            onResizeEnd={commitPanelWidths}
            label="백링크 패널 너비 조절"
            className="hidden lg:block"
          />
          <Suspense
            fallback={
              <div
                style={{ width: panelWidths.backlink }}
                className="hidden lg:block h-full shrink-0 border-l border-gray-200 bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800"
              />
            }
          >
            <BacklinkPanel
              activeNoteId={backlinkTargetId}
              backlinks={backlinks}
              onOpenNote={handleOpenNote}
              width={panelWidths.backlink}
              onHidePanel={() => setShowBacklinkPanel(false)}
            />
          </Suspense>
        </>
      )}

      {/* 위험한 볼트 전환 차단 모달 */}
      {showRiskySwitchDialog && (
        <RiskyVaultSwitchDialog
          dirty={editorDirty}
          externalPending={editorExternalPending}
          onCancel={() => setShowRiskySwitchDialog(false)}
          onDiscard={() => void handleConfirmRiskySwitch()}
        />
      )}

      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          ariaLabel={`${folderMenu.folder.name} 폴더 작업`}
          onClose={() => setFolderMenu(null)}
          items={[
            {
              label: "이름 바꾸기",
              onSelect: () => setFolderNameDialog({ mode: "rename", folder: folderMenu.folder }),
            },
            {
              label: "하위폴더 추가",
              onSelect: () => setFolderNameDialog({ mode: "create", parent: folderMenu.folder }),
            },
            {
              label: "폴더 삭제",
              destructive: true,
              onSelect: () => setFolderPendingDelete(folderMenu.folder),
            },
          ]}
        />
      )}

      {folderNameDialog && (
        <FolderNameDialog
          title={folderNameDialog.mode === "rename"
            ? `'${folderNameDialog.folder.name}' 이름 바꾸기`
            : `'${folderNameDialog.parent.name}' 안에 폴더 추가`}
          initialValue={folderNameDialog.mode === "rename" ? folderNameDialog.folder.name : ""}
          confirmLabel={folderNameDialog.mode === "rename" ? "이름 바꾸기" : "폴더 추가"}
          onSubmit={handleFolderNameSubmit}
          onCancel={() => setFolderNameDialog(null)}
        />
      )}

      {folderPendingDelete && (
        <DeleteFolderConfirmDialog
          folderName={folderPendingDelete.name}
          noteCount={countNotesByFolder(notes).get(folderPendingDelete.path) ?? 0}
          onCancel={() => setFolderPendingDelete(null)}
          onConfirm={() => void handleConfirmFolderDelete()}
        />
      )}

      {noteMenu && (
        <ContextMenu
          x={noteMenu.x}
          y={noteMenu.y}
          ariaLabel={`${noteMenu.note.title || "제목 없음"} 항목 작업`}
          onClose={() => setNoteMenu(null)}
          items={[
            // 그림은 `.md` 전제 동작(frontmatter 수정·이동)이 실패하므로 띄우지 않는다(TICK-BUG-004).
            // 즐겨찾기(2026-09-19 TICK-UX-013). 켜면 목록 맨 위 고정 섹션에 모인다.
            ...(noteMenu.note.drawing
              ? []
              : [{
                  label: noteMenu.note.favorite === true ? "즐겨찾기 해제" : "즐겨찾기",
                  onSelect: () => void handleToggleFavorite(noteMenu.note),
                }]),
            ...(noteMenu.note.drawing
              ? []
              : noteMenu.note.type === "todo"
              ? [{
                  label: "할 일 표시 해제",
                  onSelect: () => void handleConvertNoteKind(noteMenu.note.id, "note"),
                }]
              : [{
                  label: "할 일로 표시",
                  onSelect: () => void handleConvertNoteKind(noteMenu.note.id, "todo"),
                }]),
            ...(!noteMenu.note.drawing && !noteMenu.note.excalidrawPlugin ? [{
              label: "다른 폴더로 이동…",
              onSelect: () => setNoteToMove({ id: noteMenu.note.id, vault: vaultPath }),
            }] : []),
            // 보관 이동도 moveNoteFile(`.md` 부착) 경로라 그림에서는 실패한다.
            // 그림 이동은 raw 경로 이동이 필요해 별도 후속(TODO)으로 남긴다.
            ...(noteMenu.note.drawing
              ? []
              : [{
                  label: "보관으로 이동",
                  onSelect: () => void handleArchiveNote(noteMenu.note.id),
                }]),
          ]}
        />
      )}

      {movingNote && noteToMove && (
        <MoveNoteDialog
          key={`${noteToMove.vault}:${movingNote.id}`}
          note={movingNote} folders={knownFolderPaths}
          onMove={(folder) => handleMoveRecord(movingNote.id, folder)}
          onClose={() => setNoteToMove((current) => current === noteToMove ? null : current)}
        />
      )}

      {/* 노트 삭제 확인 모달 (TICK-UX-008 P0-2) */}
      {notePendingDelete && (
        <DeleteNoteConfirmDialog
          noteTitle={notePendingDelete.title}
          exclusiveImageCount={notePendingDelete.exclusiveImages.length}
          onCancel={() => setNotePendingDelete(null)}
          onConfirm={(cleanupImages) => void handleConfirmDeleteNote(cleanupImages)}
        />
      )}
    </div>
  );
}

export default App;
