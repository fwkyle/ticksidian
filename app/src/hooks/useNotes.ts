import { useState, useCallback, useEffect, useRef } from "react";
import type { NoteListItem, FolderNode } from "../types/note";
import { generateId } from "../lib/id";
import {
  getVaultPath,
  selectVaultFolder,
  setVaultPath,
  initializeVault,
  scanNoteFiles,
  scanFolderTree,
  readNoteFile,
  getNoteFileSize,
  writeNoteFile,
  deleteDrawingFile,
  deleteNoteFile,
  moveNoteFile,
  createNoteFolder,
  renameNoteFolder,
  trashNoteFolder,
  setFolderAsProject,
} from "../lib/local-fs";
import { toErrorMessage } from "../lib/error-utils";
import { findAutoOpenableNoteId, type AutoOpenSelectionIO } from "../lib/note-open-selection";
import { INBOX_FOLDER, selectNotesForFolder } from "../lib/folder-tree";
import { currentStartPlan } from "../lib/start-screen";

const VAULT_PATH_KEY = "ticksidian-vault-path";
import { buildMarkdownExportDocument } from "../lib/markdown-export";

const autoOpenSelectionIO: AutoOpenSelectionIO = {
  getFileSize: getNoteFileSize,
  readNoteContent: async (noteId, folder) => {
    const note = await readNoteFile(noteId, folder);
    return note.content;
  },
};

export interface UseNotesReturn {
  notes: NoteListItem[];
  folders: FolderNode[];
  activeNoteId: string | null;
  activeFolder: string;
  setActiveNoteId: (id: string | null) => void;
  setActiveFolder: (folder: string) => void;
  /**
   * 빈 항목 만들기(Cmd+N). `todo: true`면 빈 할 일(`type: "todo"`)을 만들고,
   * 아니면 빈 기록을 만든다(2026-09-22 — 탭을 따른다). 제목은 둘 다 "새 노트"다.
   */
  createNote: (folder?: string, options?: { todo?: boolean }) => Promise<string>;
  /**
   * 빠른 입력으로 만드는 새 항목(2026-09-22 확장).
   *
   * `todo: true`면 할 일(`type: "todo"`, `done: false`)로 만든다 — 목록이 할 일 필터일 때
   * 상단 입력이 기록이 아니라 할 일을 만들도록 하기 위한 옵션이다.
   */
  createQuickNote: (
    title: string,
    folder?: string,
    onCreated?: (id: string) => void,
    options?: { todo?: boolean },
  ) => Promise<string>;
  /**
   * 제목이 정해진 새 일반 노트를 생성한다. 위키링크 UX 2차에서 unresolved
   * `[[새 노트]]`를 실제 노트로 승격할 때 사용한다.
   * 설계: docs/waterfall/03-상세설계/위키링크-백링크-설계안.md §UX 2차
   */
  createNoteWithTitle: (title: string, folder?: string) => Promise<string>;
  updateNoteTitle: (id: string, title: string) => void;
  updateNoteAliases: (id: string, aliases: string[]) => void;
  deleteNote: (id: string) => Promise<void>;
  createFolder: (name: string, parent?: string) => Promise<void>;
  renameFolder: (folderPath: string, newName: string) => Promise<void>;
  trashFolder: (folderPath: string) => Promise<void>;
  moveNote: (noteId: string, toFolder: string) => Promise<void>;
  toggleProject: (folderPath: string, isProject: boolean) => Promise<void>;
  loading: boolean;
  vaultPath: string | null;
  selectVault: () => Promise<boolean>;
  hasVault: boolean;
  /** 시작 때 저장된 볼트를 열지 못한 이유(Rust가 돌려준 문장 그대로). 볼트 선택 화면에 보인다. */
  startupVaultNotice: string | null;
  /**
   * 노트 목록을 새로고침한다.
   *
   * `preScanned`를 넘기면 파일 시스템을 다시 읽지 않고 그 결과를 그대로 상태에 반영한다.
   * 단, 볼트 전환 안전 가드: 스캔 시점의 `scannedVaultPath`가 현재 볼트 경로와 다르면
   * preScanned를 버리고 전체 재읽기(full read)로 fallback한다. cross-vault 캐시 오염 방지.
   *
   * `preScanned`를 생략하면 기존과 동일하게 scanNoteFiles()를 직접 호출한다.
   */
  refreshNotes: (preScanned?: { noteList: NoteListItem[]; scannedVaultPath: string }) => Promise<NoteListItem[]>;
}

export function useNotes(): UseNotesReturn {
  const [notes, setNotesState] = useState<NoteListItem[]>([]);
  // 렌더 전에 이미 들어간 변경까지 반영한 "최신 목록". 모든 목록 변경이 setNotes를 지나므로
  // 같은 updater를 여기에 먼저 적용해 둔다(updater는 순수해야 한다). 렌더 때만 갱신되는 ref와 달리
  // 같은 묶음 안의 A→B→A, 생성·재스캔 직후 알림을 "같다"고 잘못 버리지 않는다(DFUB-R002).
  const latestNotesRef = useRef<NoteListItem[]>(notes);
  const setNotes = useCallback((action: React.SetStateAction<NoteListItem[]>) => {
    latestNotesRef.current = typeof action === "function" ? action(latestNotesRef.current) : action;
    setNotesState(action);
  }, []);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [hasVault, setHasVault] = useState(false);
  const [startupVaultNotice, setStartupVaultNotice] = useState<string | null>(null);
  const vaultInitializedRef = useRef(false);
  const vaultGenerationRef = useRef(0);

  // IO 어댑터의 가변 값에만 기대지 않고, 완료된 전환을 React 구독자에게 게시한다.
  const [vaultPath, setPublishedVaultPath] = useState<string | null>(getVaultPath);

  // 노트 + 폴더 새로고침.
  //
  // preScanned: watcher tick이 mtime 빠른 경로로 이미 스캔한 결과를 재활용할 때 사용.
  //   → 이중 스캔(watcher scan + refreshNotes scan) 제거 — P1-006 이중 스캔 수정.
  //   볼트 전환 안전 가드: scannedVaultPath와 현재 getVaultPath()가 다르면 preScanned를 버리고
  //   전체 재읽기로 fallback한다(cross-vault 캐시 오염 방지).
  const refreshNotes = useCallback(async (
    preScanned?: { noteList: NoteListItem[]; scannedVaultPath: string },
  ) => {
    let noteList: NoteListItem[];
    if (preScanned) {
      const currentVaultPath = getVaultPath();
      if (currentVaultPath && preScanned.scannedVaultPath === currentVaultPath) {
        // 볼트가 스캔 시점과 동일 → 미리 스캔된 결과를 그대로 사용.
        noteList = preScanned.noteList;
      } else {
        // 볼트가 바뀌었거나 경로를 특정할 수 없음 → 안전하게 전체 재읽기.
        noteList = await scanNoteFiles();
      }
    } else {
      noteList = await scanNoteFiles();
    }
    const folderTree = await scanFolderTree();
    setNotes(noteList);
    setFolders(folderTree);
    return noteList;
  }, [setNotes]);

  // 볼트 선택/전환. 전환이면 이전 볼트 상태를 명시적으로 비우고
  // 새 볼트를 로드한다. 정책 §4 초기화 규칙의 핵심 부분을 수행.
  // 설계: docs/waterfall/03-상세설계/런타임-볼트-전환-정책.md §7.2
  // 반환값: true = 볼트 실제 전환됨, false = 폴더 선택 취소
  const selectVault = useCallback(async (): Promise<boolean> => {
    const path = await selectVaultFolder();
    if (!path) return false;
    vaultGenerationRef.current += 1;

    // 이미 볼트가 있는 상태에서 버튼을 눌렀다 = 전환. 없었다 = 최초 선택.
    const isInitialSelect = !hasVault;
    // initializeVault가 어댑터 경로를 바꾼 뒤 실패하면 이 경로로 되돌린다(DEF-CONC-001).
    const previousPath = getVaultPath();

    setLoading(true);
    // §4.1 / §4.3 / §4.4 이전 볼트 상태 즉시 폐기.
    // notes를 먼저 비우면 useLinkIndex의 useEffect가 linkIndexRef를 null로 리셋한다.
    setNotes([]);
    setFolders([]);
    setActiveNoteId(null);
    setActiveFolder("");
    try {
      await initializeVault(path);
      // 실패할 수 있는 준비(재스캔·자동 열기 후보·경로 저장)를 모두 끝낸 뒤 한 번만 게시한다.
      // 게시가 감시·검색·검토 큐를 새 볼트로 옮기므로, 게시 뒤에는 실패할 일이 없어야 한다(DFXR-002).
      const noteList = await refreshNotes();
      const firstOpenableNoteId = isInitialSelect && currentStartPlan().autoOpenInbox
        // 최초 볼트 선택: 기본함의 열 수 있는 첫 일반 노트만 자동 열기.
        // 시작 화면이 `오늘 할 일`이면 열지 않는다(설계 시작-화면-선택.md).
        ? await findAutoOpenableNoteId(selectNotesForFolder(noteList, INBOX_FOLDER), autoOpenSelectionIO)
        : null;
      localStorage.setItem(VAULT_PATH_KEY, path);
      setPublishedVaultPath(path);
      setHasVault(true);
      if (firstOpenableNoteId) setActiveNoteId(firstOpenableNoteId);
      // 전환 경로에서는 §4.3 대로 active를 null로 두고 사용자가 명시 선택하게 한다.
    } catch (error) {
      // 어댑터·watcher는 새 볼트인데 화면은 이전 볼트인 갈라짐을 막는다. 게시값(vaultPath)·hasVault·저장 경로는
      // 모든 준비가 끝난 성공 때만 바꾸므로 그대로 이전 볼트다. 설계: 런타임-볼트-전환-정책.md §7.3
      setVaultPath(previousPath);
      if (previousPath) {
        try {
          await refreshNotes();
        } catch {
          // 이전 볼트 재스캔 실패는 원래 오류를 가리지 않는다.
        }
      } else {
        // 최초 선택 실패: 새 볼트 목록이 남지 않게 비운다(hasVault는 아직 false다).
        setNotes([]);
        setFolders([]);
      }
      throw error;
    } finally {
      setLoading(false);
    }
    return true;
  }, [refreshNotes, hasVault, setNotes]);

  // 초기화: 저장된 볼트 경로가 있으면 자동으로 열기
  useEffect(() => {
    if (vaultInitializedRef.current) return;
    vaultInitializedRef.current = true;

    async function init() {
      // 이미 메모리에 볼트가 있는 경우
      let currentVault = getVaultPath();

      // 없으면 localStorage에서 복원 시도
      if (!currentVault) {
        const saved = localStorage.getItem(VAULT_PATH_KEY);
        if (saved) {
          try {
            await initializeVault(saved);
            currentVault = saved;
          } catch (error) {
            // 저장된 경로가 유효하지 않거나 등록 범위 규칙(런타임-볼트-전환-정책.md §9)에 걸리면
            // 저장 경로를 지우고 이유를 볼트 선택 화면에 알린다. 재시도하지 않는다.
            localStorage.removeItem(VAULT_PATH_KEY);
            setStartupVaultNotice(toErrorMessage(error, "저장된 볼트를 열지 못했습니다."));
          }
        }
      }

      if (currentVault) {
        setPublishedVaultPath(currentVault);
        try {
          const noteList = await refreshNotes();
          // 기본함의 최근 일반 노트를 초기 선택 (투두/그림/편집기 한계 초과 제외).
          // 시작 화면이 `오늘 할 일`이면 자동 열기를 건너뛴다(편집기는 빈 상태).
          const firstOpenableNoteId = currentStartPlan().autoOpenInbox
            ? await findAutoOpenableNoteId(selectNotesForFolder(noteList, INBOX_FOLDER), autoOpenSelectionIO)
            : null;
          if (firstOpenableNoteId) {
            setActiveNoteId(firstOpenableNoteId);
          }
          setHasVault(true);
        } catch {
          setHasVault(false);
        }
      } else {
        setHasVault(false);
      }
      setLoading(false);
    }

    init();
  }, [refreshNotes]);

  const createNoteInternal = useCallback(
    async (title: string, folder: string, { setActive, blank = false, literal = false, todo = false, onCreated }: { setActive: boolean; blank?: boolean; literal?: boolean; todo?: boolean; onCreated?: (id: string) => void }): Promise<string> => {
      const sourceVault = getVaultPath();
      const sourceGeneration = vaultGenerationRef.current;
      const id = generateId();
      const now = Date.now();

      // 빠른 제목의 Markdown 기호는 서식/링크가 아니라 사용자가 입력한 글자다.
      const heading = literal ? title.replace(/[!-/:-@[-`{-~]/g, char => `&#${char.codePointAt(0)};`) : title;
      const markdownBody = `# ${blank ? '' : heading}\n\n`;
      const content = buildMarkdownExportDocument({
        noteId: id,
        title,
        createdAt: now,
        updatedAt: now,
        exportedAt: now,
        markdownBody,
        // 할 일로 만들 때는 투두 frontmatter를 함께 쓴다(2026-09-22).
        ...(todo ? { type: "todo" as const, done: false } : {}),
      });

      // UUID는 충돌이 없으므로 id == fileBasename
      await writeNoteFile(id, content, folder);
      if (sourceVault !== getVaultPath() || sourceGeneration !== vaultGenerationRef.current) return id;

      const newItem: NoteListItem = {
        id,
        fileBasename: id, // UUID라 충돌 없음, id == fileBasename
        title,
        createdAt: new Date(now),
        updatedAt: new Date(now),
        folder,
        // 목록이 곧바로 같은 항목을 할 일로 그리도록 스캔 결과와 같은 모양을 넣는다.
        ...(todo ? { type: "todo" as const, done: false } : {}),
      };

      setNotes((prev) => [newItem, ...prev]);
      if (setActive) setActiveNoteId(id);
      onCreated?.(id);
      return id;
    },
    [setNotes],
  );

  const createNote = useCallback(
    async (folder = "", options?: { todo?: boolean }): Promise<string> =>
      // 제목은 두 종류 모두 "새 노트"다. 본문 제목을 비우면 편집기가 기본 제목을 다시
      // 보고하기 때문에(lib/note-content의 DEFAULT_NOTE_TITLE), 다른 기본값을 주면
      // 개봉 직후 제목이 한 번 바뀐다. 종류만 탭을 따른다.
      createNoteInternal("새 노트", folder, {
        setActive: options?.todo !== true,
        blank: true,
        todo: options?.todo === true,
      }),
    [createNoteInternal],
  );

  const createQuickNote = useCallback(
    async (
      title: string,
      folder = INBOX_FOLDER,
      onCreated?: (id: string) => void,
      options?: { todo?: boolean },
    ): Promise<string> => {
      const normalized = title.replace(/[\r\n]+/g, ' ').trim();
      if (!normalized) throw new Error('기록 제목을 입력해 주세요.');
      return createNoteInternal(normalized, folder, {
        setActive: false,
        literal: true,
        todo: options?.todo === true,
        onCreated,
      });
    },
    [createNoteInternal],
  );

  // 위키링크 UX 2차: unresolved `[[title]]`에서 새 노트로 승격할 때 사용.
  // 현재 편집 중인 노트 선택을 바꾸지 않도록 setActive=false.
  const createNoteWithTitle = useCallback(
    async (title: string, folder = ""): Promise<string> => {
      const trimmed = title.trim();
      const safeTitle = trimmed.length > 0 ? trimmed : "새 노트";
      return createNoteInternal(safeTitle, folder, { setActive: false });
    },
    [createNoteInternal],
  );

  /**
   * 제목이 **실제로 바뀐 경우에만** 상태를 갱신한다.
   *
   * Why: 노트를 열면 에디터가 본문에서 제목을 뽑아 `onTitleChange`로 항상 한 번
   * 알려준다. 예전에는 제목이 같아도 `updatedAt`을 지금 시각으로 덮어써서, **클릭만
   * 해도 그 노트가 수정일 정렬 맨 위로 튀어 올랐다**([kyle] 2026-08-18 실사용 보고).
   * 파일은 건드리지 않았으므로 화면 표시만 틀어진 것이지만, 수정일 정렬이 무의미해진다.
   * 투두 경로(`handleTodoTitleChange`)는 이미 같은 비교를 하고 있었다 — 그래서 투두만
   * 멀쩡했다는 [kyle]의 관찰이 정확했다.
   *
   * 변화가 없으면 `prev`를 그대로 돌려주므로 불필요한 재렌더도 생기지 않는다.
   */
  const updateNoteTitle = useCallback((id: string, title: string) => {
    // 최신 목록과 같으면 setNotes를 부르지 않는다. 같은 상태를 돌려주는 호출도 App 렌더를 일으키고,
    // 편집기가 불러올 때마다 제목을 알리므로 렌더 → 편집기 효과 → 알림 → 렌더 고리가 된다(inbox-first 멈춤).
    const current = latestNotesRef.current.find((note) => note.id === id);
    if (!current || current.title === title) return;
    // updater는 최신 목록 계산과 React 상태 계산에서 각각 실행되므로 시각을 안에서 만들면 두 값이 어긋난다(DFUB-R004).
    const updatedAt = new Date();
    setNotes((prev) => {
      const target = prev.find((note) => note.id === id);
      if (!target || target.title === title) return prev;
      return prev.map((note) =>
        note.id === id ? { ...note, title, updatedAt } : note
      );
    });
  }, [setNotes]);

  const updateNoteAliases = useCallback((id: string, aliases: string[]) => {
    const current = latestNotesRef.current.find((note) => note.id === id);
    const known = current?.aliases ?? [];
    if (!current || (known.length === aliases.length && known.every((alias, index) => alias === aliases[index]))) return;
    setNotes((prev) => {
      const target = prev.find((note) => note.id === id);
      if (!target) return prev;
      const previousAliases = target.aliases ?? [];
      if (previousAliases.length === aliases.length &&
          previousAliases.every((alias, index) => alias === aliases[index])) return prev;
      return prev.map((note) =>
        note.id === id ? { ...note, aliases } : note
      );
    });
  }, [setNotes]);

  const deleteNote = useCallback(async (id: string) => {
    const note = notes.find((n) => n.id === id);
    // 그림은 `.md`가 아니라 파일명 그대로 지운다(TICK-BUG-004).
    if (note?.drawing) {
      await deleteDrawingFile(note.fileBasename, note.folder);
    } else {
      // fileBasename이 있으면 사용 (stem 충돌 케이스 대응), 없으면 id fallback
      await deleteNoteFile(note?.fileBasename ?? id, note?.folder ?? "");
    }
    // updater 안에서 다른 상태를 바꾸지 않는다(updater는 최신 목록 미리 계산에도 쓰이므로 순수해야 한다).
    const filtered = latestNotesRef.current.filter((n) => n.id !== id);
    setActiveNoteId(filtered.length > 0 ? filtered[0].id : null);
    setNotes(filtered);
  }, [notes, setNotes]);

  const moveNote = useCallback(async (noteId: string, toFolder: string) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) {
      console.warn('[moveNote] note not found:', noteId);
      return;
    }
    const fromFolder = note.folder;
    if (note.drawing || note.excalidrawPlugin) throw new Error('그림 파일은 이 방법으로 옮기지 않습니다.');
    if (fromFolder === toFolder) return;

    try {
      // fileBasename이 있으면 사용 (stem 충돌 케이스 대응), 없으면 noteId fallback
      await moveNoteFile(note.fileBasename ?? noteId, fromFolder, toFolder);
      // 파일 시스템 기준으로 목록 새로고침 (상태 패치보다 안전)
      await refreshNotes();
    } catch (error) {
      console.error(`[moveNote] failed: ${toErrorMessage(error)}`, error);
      throw error;
    }
  }, [notes, refreshNotes]);

  const createFolder = useCallback(async (name: string, parent = "") => {
    const folderPath = parent ? `${parent}/${name}` : name;
    await createNoteFolder(folderPath);
    await refreshNotes();
  }, [refreshNotes]);

  const renameFolder = useCallback(async (folderPath: string, newName: string) => {
    await renameNoteFolder(folderPath, newName);
    await refreshNotes();
  }, [refreshNotes]);

  const trashFolder = useCallback(async (folderPath: string) => {
    await trashNoteFolder(folderPath);
    await refreshNotes();
  }, [refreshNotes]);

  const toggleProject = useCallback(async (folderPath: string, isProject: boolean) => {
    await setFolderAsProject(folderPath, isProject);
    await refreshNotes();
  }, [refreshNotes]);

  return {
    notes,
    folders,
    activeNoteId,
    activeFolder,
    setActiveNoteId,
    setActiveFolder,
    createNote,
    createQuickNote,
    createNoteWithTitle,
    updateNoteTitle,
    updateNoteAliases,
    deleteNote,
    moveNote,
    createFolder,
    renameFolder,
    trashFolder,
    toggleProject,
    loading,
    vaultPath,
    selectVault,
    hasVault,
    startupVaultNotice,
    refreshNotes,
  };
}
