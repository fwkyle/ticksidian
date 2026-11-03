import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs, type BlockNoteEditor } from "@blocknote/core";
import { en, ko } from "@blocknote/core/locales";
import type * as Y from "yjs";
import { DatabaseBlockSpec } from "../components/database/DatabaseBlock";
import {
  getNoteAbsolutePath,
  getVaultFileModifiedAt,
  getVaultPath,
  readBinaryFile,
  writeBinaryFile,
  readTextFile,
  writeTextFile,
} from "../lib/local-fs";
import { editorFileTasks, LatestSaveQueue } from "../lib/note-save-queue";
import { ensureDirectory } from "../lib/local-fs/vault-paths";
import { parseFrontmatter, markdownToBlocks, type ParsedFrontmatter } from "../lib/markdown-import";
import { getNoteTitleFromBlocks } from "../lib/note-content";
import {
  classifyPreSaveGuard,
  noticeForReloadReason,
  shouldTreatChangeAsUserEdit,
  type ReloadReason,
} from "./useNoteEditor.helpers";
import { useEditorSyncState } from "./editor-sync-state";
import { useExternalNotePoller } from "./useExternalNotePoller";
import {
  createEmptyBlocks,
  maskEmptyParagraphs,
  unmaskEmptyParagraphs,
} from "./useNoteEditor.markdown-preserve";
import {
  buildNoteSaveDocument,
  extractNoteMetadata,
  type TodoMeta,
} from "./useNoteEditor.metadata";
import { editorDiagnostics, type DiagnosticEvent, type DiagnosticStage } from "../lib/editor-diagnostics";
import { noteRecovery, type RecoveryDraft, type RecoveryVersion } from "../lib/note-recovery";
import { draftMetaOrigin, isFrontmatterWriteBlocked, resolveLoadGuard } from "../lib/frontmatter-write-guard";
import { pendingSaveFailures } from "../lib/pending-save-failures";
import { toErrorMessage } from "../lib/error-utils";
import { isTooLargeToEdit, tooLargeNoteMessage } from "../lib/note-size";
import {
  MAX_IMAGE_ATTACHMENT_BYTES,
  formatImageSize,
} from "../lib/image-attachments";
import { excalidrawNoteMessage, isExcalidrawPluginNote } from "../lib/excalidraw-note";
import { summarizeExternalChange } from "../lib/external-change-summary";
import {
  prepareImageEmbedBlocks,
  restoreImageEmbedsInBlocks,
  revokeBlobUrls,
} from "./useNoteEditor.image-embeds";
import {
  extensionForMimeType,
  planImageAttachmentPaths,
} from "../lib/image-attachments";

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    database: DatabaseBlockSpec(),
  },
});

type EditorInstance = BlockNoteEditor<
  typeof schema.blockSchema,
  typeof schema.inlineContentSchema,
  typeof schema.styleSchema
>;

export interface UseNoteEditorOptions {
  noteId: string;
  /**
   * 디스크 위 실제 파일명 stem. 지정하지 않으면 noteId를 fallback으로 사용한다.
   * stem 충돌로 noteId가 `stem__folder` 형태일 때 필요하다.
   */
  fileBasename?: string;
  folder?: string;
  /** 볼트 안 이미지 파일 절대경로 목록(임베드 해석용). 2026-08-19 이미지 임베드 보기. */
  imageFiles?: readonly string[];
  /** 이미지 붙여넣기/드롭으로 파일 저장이 끝났을 때 호출(이미지 목록 갱신용). */
  onImagesInserted?: () => void;
  onTitleChange?: (title: string) => void;
  /** 제목으로 생성한 새 기록의 첫 로드에만 빈 본문 문단을 준비한다. */
  prepareEmptyBody?: boolean;
  /** 저장 시 aliases가 바뀌면 호출 (링크 인덱스 즉시 반영용) */
  onAliasesChange?: (aliases: string[]) => void;
  /** 저장 완료 시 호출 (저장된 noteId로 링크 인덱스 증분 갱신 트리거). */
  onContentSave?: (noteId: string) => void;
  /**
   * 에디터 dirty 상태(미저장 로컬 변경 or 디바운스 타이머 대기 중)가 바뀔 때 호출.
   * 위험한 볼트 전환 차단 모달이 App 레벨에서 이 값을 읽는다.
   * 설계: docs/waterfall/03-상세설계/런타임-볼트-전환-정책.md §7.5
   */
  onDirtyChange?: (dirty: boolean) => void;
  /** 외부 수정 pending 상태(배너 표시 중)가 바뀔 때 호출. */
  onExternalPendingChange?: (pending: boolean) => void;
  /**
   * 정보 바(노트 정보 바)의 투두 필드 커밋 저장이 끝났을 때 호출.
   * 목록(dueDate/priority 표시) 재스캔이 필요해서다. 본문 자동 저장마다 재스캔이
   * 돌지 않게 onContentSave와는 분리했다(2026-08-18 검수 후속 P1).
   * 설계: docs/waterfall/03-상세설계/노트-정보-바.md §8
   */
  onTodoMetaCommit?: (noteId: string) => void;
  /**
   * 열린 에디터의 메타 저장 함수를 부모에 등록/해제한다. 목록 체크박스처럼
   * 에디터 밖 UI에서 투두 메타를 바꿀 때도 같은 저장 경로를 쓰기 위해서다.
   */
  onTodoMetaUpdateReady?: (updater: TodoMetaUpdateHandler | null) => void;
  /** 열린 항목의 노트↔투두 변환 함수를 부모에 등록/해제한다. */
  onTodoKindUpdateReady?: (updater: TodoKindUpdateHandler | null) => void;
  collaboration?: {
    fragment: Y.XmlFragment;
    user: { name: string; color: string };
  };
}

export type TodoMetaField = "dueDate" | "priority" | "done";
export type TodoMetaUpdateHandler = (
  field: TodoMetaField,
  value: string | boolean | undefined,
) => Promise<void>;

export type TodoKindUpdateTarget = "note" | "todo";
export type TodoKindUpdateHandler = (target: TodoKindUpdateTarget) => Promise<void>;
/** 정보 바 태그 편집(2026-08-23 TICK-UX-007). 저장용 원시 태그 목록(`#` 없음)을 받는다. */
export type TagsUpdateHandler = (tags: string[]) => Promise<void>;
/** 정보 바 즐겨찾기 토글(2026-09-19 TICK-UX-013). true면 저장, false면 키를 지운다. */
export type FavoriteUpdateHandler = (favorite: boolean) => Promise<void>;
/**
 * 에디터 경유 폴더 이동(2026-08-23 TICK-UX-007). `mover`는 App의 실제 파일 이동(moveNote).
 * 에디터가 먼저 미저장 변경을 저장하고 저장을 차단한 뒤 mover를 부른다.
 */
export type MoveToFolderHandler = (mover: () => Promise<void>) => Promise<boolean>;

export interface UseNoteEditorReturn {
  /** 현재 편집 세션의 실제 읽기·저장 절대경로. */
  filePath: string;
  editor: EditorInstance | null;
  isLoading: boolean;
  /** 실제 저장 IO 진행 여부. 입력 대기/실패 후 미저장은 별도 상태다. */
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  isMoving: boolean;
  saveError: string | null;
  loadError: string | null;
  externalChangeNotice: string | null;
  externalChangeSummary: string | null;
  hasExternalChangePending: boolean;
  handleChange: () => void;
  /** 이미지 붙여넣기/드롭 → 노트 소속 저장 + 커서 위치 image 블록 삽입. */
  insertImageFiles: (files: readonly File[]) => Promise<void>;
  handleManualSave: () => Promise<void>;
  handleReloadFromDisk: () => Promise<void>;
  handleKeepLocalChanges: () => void;
  recoveryError: string | null;
  recoveryNotice: string | null;
  recoveryMetadata: RecoveryDraft["meta"] | null;
  recoveryProtected: boolean;
  recoveryVersionText: (version: RecoveryVersion) => string;
  restoreRecoveryVersion: (version: RecoveryVersion) => Promise<void>;
  /** 정보 바의 투두 마감일/우선순위 편집을 에디터 저장 경로로 반영한다. */
  handleTodoMetaUpdate: TodoMetaUpdateHandler;
  handleTodoKindUpdate: TodoKindUpdateHandler;
  /** 정보 바 태그 추가/삭제를 에디터 저장 경로로 반영한다(TICK-UX-007). */
  handleTagsUpdate: TagsUpdateHandler;
  /** 정보 바 즐겨찾기 토글을 에디터 저장 경로로 반영한다(TICK-UX-013). */
  handleFavoriteUpdate: FavoriteUpdateHandler;
  /** 열린 노트의 폴더 이동 — flush → 저장 차단 → mover(TICK-UX-007). */
  handleMoveToFolder: MoveToFolderHandler;
}

export function useNoteEditor({
  prepareEmptyBody = false,
  noteId,
  fileBasename,
  folder = '',
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
  collaboration,
}: UseNoteEditorOptions): UseNoteEditorReturn {
  // 실제 파일명 stem: fileBasename 지정 시 사용, 없으면 noteId fallback
  const resolvedFileBasename = fileBasename ?? noteId;
  // 볼트의 가변 전역 경로를 await 뒤 다시 읽어 쓰기 대상을 바꾸지 않는다.
  const file = useMemo(() => {
    const path = getNoteAbsolutePath(resolvedFileBasename, folder);
    return { path, vault: getVaultPath(), saves: new LatestSaveQueue(path) };
  }, [resolvedFileBasename, folder]);
  const currentFileRef = useRef(file);
  currentFileRef.current = file;
  const isCurrentFile = useCallback(() => (
    currentFileRef.current === file && getVaultPath() === file.vault
  ), [file]);
  const [isLoading, setIsLoading] = useState(true);
  const prepareEmptyBodyRef = useRef(prepareEmptyBody);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const movingRef = useRef(false);
  const savesInFlight = useRef(0);
  const imagesInFlight = useRef(0);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryMetadata, setRecoveryMetadata] = useState<RecoveryDraft["meta"] | null>(null);
  const recoveredMetadataRef = useRef(false);
  const recoveryChoiceInFlight = useRef(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [recoveryProtected, setRecoveryProtected] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [externalChangeNotice, setExternalChangeNotice] = useState<string | null>(null);
  const [externalChangeSummary, setExternalChangeSummary] = useState<string | null>(null);
  const [hasExternalChangePending, setHasExternalChangePending] = useState(false);
  
  // 에디터는 한 번만 생성 (빈 내용으로 시작)
  const editor = useCreateBlockNote({
    schema,
    dictionary: {
      ...en,
      placeholders: { ...ko.placeholders, default: "글을 쓰거나 /로 메뉴 열기" },
    },
    initialContent: createEmptyBlocks() as never[],
    ...(collaboration ? { collaboration } : {}),
    domAttributes: {
      editor: {
        "data-note-id": noteId,
      },
    },
  });
 
  // 임베드 해석용 이미지 목록은 ref로 읽는다(스캔 갱신이 로드 effect를 다시 돌리지 않게).
  const imageFilesRef = useRef(imageFiles);
  imageFilesRef.current = imageFiles;

  const createdAtRef = useRef<number | undefined>(undefined);
  const updatedAtRef = useRef<number | undefined>(undefined);
  const aliasesRef = useRef<string[]>([]);
  const previousTitleRef = useRef<string | undefined>(undefined);
  // 투두 전용 frontmatter 보존 (저장 시 그대로 다시 써야 함)
  const todoMetaRef = useRef<TodoMeta>({});
  // 노트 공통 태그(TICK-UX-007). undefined = 파일에 키 없음(옵시디언 원본이면 손대지 않음).
  // todoMeta처럼 로드마다 파일 기준으로 덮어쓴다.
  const tagsRef = useRef<string[] | undefined>(undefined);
  // 즐겨찾기(TICK-UX-013). true만 파일에 쓰고, false는 키 삭제다.
  // undefined = 파일에 키 없음(옵시디언 원본이면 손대지 않음).
  const favoriteRef = useRef<boolean | undefined>(undefined);
  // 이미지 임베드 복원 매핑(image 블록 URL → 원문 raw). 저장 원본 불변의 근거다.
  const imageRestoreMappingRef = useRef<Map<string, string>>(new Map());
  // 이번 에디터 세션에서 만든 blob URL들. 재로드/언마운트 때 revoke한다.
  const imageBlobUrlsRef = useRef<string[]>([]);
  // 원본 frontmatter 보존(TICK-UX-002). 재로드마다 파일 기준으로 교체한다.
  const sourceFrontmatterRef = useRef<ParsedFrontmatter>({});
  // 머리말을 읽지 못한 노트(DEF-DATA-002): 저장하면 원본 머리말이 사라지므로 저장을 거부한다.
  const frontmatterUnreadableRef = useRef(false);
  // 로컬 메타가 "읽은 디스크 메타 위에서 만들어졌다"는 증거가 없는가(DFXR-005·007). 초기값은 증거 없음(true)이고
  // 로드가 읽기·파싱 판정을 마친 뒤에만 false가 된다. 작성본에는 반대값을 metaFromDisk로 저장한다.
  const metaUnreadableRef = useRef(true);
  // 외부 수정 요약을 만들기 위한 마지막 디스크/저장 기준(raw Markdown).
  const lastSavedFileContentRef = useRef<string>("");
  const externalSummaryRequestRef = useRef(0);
  const lastObservedContentRef = useRef<string | null>(null);
  const savedMetaSigRef = useRef<string | null>(null);
  const detachedBlocksRef = useRef<typeof editor.document | null>(null);
  const isMountedRef = useRef(false);
  // cleanup에서 stale closure 없이 saveToFile을 호출하기 위한 ref
  const saveToFileRef = useRef<() => Promise<void>>(async () => { /* placeholder */ });
  // 동기화 상태 클러스터(앱 3단계 패스 2): load/save/외부수정 폴러가 같은 경로로 갱신한다.
  const syncState = useEditorSyncState();
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const onAliasesChangeRef = useRef(onAliasesChange);
  onAliasesChangeRef.current = onAliasesChange;
  const onContentSaveRef = useRef(onContentSave);
  onContentSaveRef.current = onContentSave;
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const onExternalPendingChangeRef = useRef(onExternalPendingChange);
  onExternalPendingChangeRef.current = onExternalPendingChange;
  const onTodoMetaCommitRef = useRef(onTodoMetaCommit);
  onTodoMetaCommitRef.current = onTodoMetaCommit;
  const onTodoMetaUpdateReadyRef = useRef(onTodoMetaUpdateReady);
  onTodoMetaUpdateReadyRef.current = onTodoMetaUpdateReady;
  const onTodoKindUpdateReadyRef = useRef(onTodoKindUpdateReady);
  onTodoKindUpdateReadyRef.current = onTodoKindUpdateReady;
  const onImagesInsertedRef = useRef(onImagesInserted);
  onImagesInsertedRef.current = onImagesInserted;
  // 콜백 스팸 방지를 위해 마지막으로 보고한 값을 기억.
  const lastReportedDirtyRef = useRef<boolean>(false);
  const lastReportedExternalPendingRef = useRef<boolean>(false);

  // dirty = "hasLocalChanges 또는 디바운스 저장 타이머가 예약된 상태".
  // 전환 차단 모달이 이 값을 본다.
  const reportDirty = useCallback((dirty: boolean) => {
    if (isMountedRef.current) setHasUnsavedChanges(dirty);
    if (lastReportedDirtyRef.current === dirty) return;
    lastReportedDirtyRef.current = dirty;
    onDirtyChangeRef.current?.(dirty);
  }, []);

  const reportExternalPending = useCallback((pending: boolean) => {
    if (lastReportedExternalPendingRef.current === pending) return;
    lastReportedExternalPendingRef.current = pending;
    onExternalPendingChangeRef.current?.(pending);
  }, []);

  // 언마운트 시 dirty/external pending 상태를 반드시 false로 되돌린다.
  // 다음 에디터(다른 noteId/다른 볼트)가 마운트되기 전까지 App 상태가
  // stale 참조를 들고 있지 않게 한다.
  useEffect(() => {
    return () => {
      if (lastReportedDirtyRef.current) {
        lastReportedDirtyRef.current = false;
        onDirtyChangeRef.current?.(false);
      }
      if (lastReportedExternalPendingRef.current) {
        lastReportedExternalPendingRef.current = false;
        onExternalPendingChangeRef.current?.(false);
      }
    };
  }, []);

  // 내 변경 유지처럼 디스크 원문을 새 기준으로 받는 지점이 부른다(DFXR-003).
  // 디스크 사실만 갱신한다. 메타 출처 사실(metaUnreadableRef)과 로컬 메타는 건드리지 않는다(DFXR-004·005).
  // 로드 경로의 가드는 loadNoteFromDisk가 resolveLoadGuard로 정한다.
  const adoptDiskFrontmatter = useCallback((diskContent: string): void => {
    frontmatterUnreadableRef.current = parseFrontmatter(diskContent).error !== undefined;
  }, []);

  const preserveDraft = useCallback((): RecoveryDraft | null => {
    if (!syncState.hasLoaded() || syncState.isReloading()) return null;
    try {
      const draft = noteRecovery.writeDraft({
        path: file.path, baselineMtime: syncState.lastKnownFileMtime(),
        blocks: restoreImageEmbedsInBlocks(detachedBlocksRef.current ?? editor.document, imageRestoreMappingRef.current),
        metaFromDisk: !metaUnreadableRef.current,
        meta: { createdAt: createdAtRef.current, aliases: aliasesRef.current, previousTitle: previousTitleRef.current,
          todoMeta: todoMetaRef.current, tags: tagsRef.current, favorite: favoriteRef.current, frontmatter: sourceFrontmatterRef.current },
      });
      const protectedDraft = noteRecovery.isProtected(file.path);
      if (isMountedRef.current) {
        setRecoveryProtected(protectedDraft);
        setRecoveryError(protectedDraft ? null : '복구본을 보관하지 못했습니다. 앱을 닫기 전에 작성 내용을 복사해 주세요.');
      }
      return draft;
    } catch {
      if (isMountedRef.current) {
        setRecoveryProtected(false);
        setRecoveryError('복구본을 만들지 못했습니다. 앱을 닫기 전에 작성 내용을 복사해 주세요.');
      }
      return null;
    }
  }, [editor, file, syncState]);
  const preserveDraftRef = useRef(preserveDraft);
  preserveDraftRef.current = preserveDraft;

  const loadNoteFromDisk = useCallback((reason: ReloadReason) => editorFileTasks.run(file.path, async () => {
    if (!isMountedRef.current || !isCurrentFile()) return;
    // 새 로드가 시작되면 이전 요약 계산의 결과가 현재 노트를 덮어쓰지 않게 무효화한다.
    externalSummaryRequestRef.current += 1;
    if (reason === "initial") {
      setIsLoading(true);
      setLoadError(null);
      setSaveError(null);
      createdAtRef.current = undefined;
      updatedAtRef.current = undefined;
      aliasesRef.current = [];
      previousTitleRef.current = undefined;
      todoMetaRef.current = {};
      tagsRef.current = undefined;
      favoriteRef.current = undefined;
      sourceFrontmatterRef.current = {};
      frontmatterUnreadableRef.current = false;
      metaUnreadableRef.current = true;
      syncState.resetForNewNote();
      setExternalChangeNotice(null);
      setExternalChangeSummary(null);
      setHasExternalChangePending(false);
    }

    try {
      // 이전 편집기의 flush 전체가 끝난 뒤 읽는다(같은 파일 재마운트 경합 방지).
      const recovery = reason === 'initial' ? noteRecovery.getDraft(file.path) : null;
      let content: string;
      // 작성본이 있어도 원문 읽기 실패는 "읽을 수 있는 빈 머리말"이 아니다(DFXR-006).
      // 빈 문자열은 본문 자리 채움일 뿐 가드 판정에는 diskState로 따로 넘긴다.
      let diskReadFailed = false;
      try { content = await readTextFile(file.path); }
      catch (error) { if (!recovery) throw error; content = ''; diskReadFailed = true; }
      const fileMtime = await getVaultFileModifiedAt(file.path);
      if (!isMountedRef.current || !isCurrentFile()) return;

      // 편집기 한계를 넘는 파일은 파싱조차 하지 않는다. BlockNote 파서가 UI 스레드에서
      // 도는 탓에 큰 문서(실측: 12MB 크래시 로그 노트)는 화면을 완전히 멈춘다.
      // hasLoaded를 켜지 않으므로 자동 저장이 원본을 덮어쓸 수 없다.
      // 설계: app/src/lib/note-size.ts
      if (!recovery && isTooLargeToEdit(content)) {
        if (isMountedRef.current) {
          setLoadError(tooLargeNoteMessage(content.length));
          syncState.markLoadBlocked();
        }
        return;
      }

      const parsed = parseFrontmatter(content);
      const frontmatter = parsed.frontmatter;
      const body = recovery ? editor.blocksToMarkdownLossy(maskEmptyParagraphs(recovery.blocks) as typeof editor.document) : parsed.body;

      // 옵시디언 Excalidraw 플러그인 그림 파일은 편집을 열지 않는다(2026-08-20).
      // 일반 에디터로 저장하면 압축 그림 데이터가 오염된다. too-large와 같은 차단
      // 경로라 hasLoaded가 켜지지 않아 자동 저장이 원본을 건드릴 수 없다.
      // 설계: app/src/lib/excalidraw-note.ts
      if (!recovery && isExcalidrawPluginNote(frontmatter)) {
        if (isMountedRef.current) {
          setLoadError(excalidrawNoteMessage());
          syncState.markLoadBlocked();
        }
        return;
      }

      // 메타데이터 추출(순수): createdAt/updatedAt/aliases/previousTitle/todoMeta.
      // null/undefined 필드는 "파일에 없으니 기존 유지"를 뜻한다.
      const loadGuard = resolveLoadGuard({ disk: diskReadFailed ? 'read-failed' : parsed.error !== undefined ? 'unreadable' : 'readable', draft: recovery });
      const metadata = recovery && !loadGuard.useDiskMeta ? { ...recovery.meta, updatedAt: recovery.at } : extractNoteMetadata(frontmatter);
      // 마크다운을 블록으로 변환 (BlockNote 내장 파서 우선, 실패 시 간이 파서 폴백)
      let blocks: unknown[];
      try {
        blocks = recovery ? recovery.blocks : editor.tryParseMarkdownToBlocks(body);
      } catch {
        console.warn('[NoteEditor] BlockNote markdown parser failed, falling back to simple parser');
        blocks = markdownToBlocks(body);
      }

      // NBSP로 마스킹된 빈 문단을 원래대로 복원
      blocks = unmaskEmptyParagraphs(blocks);
      if (!recovery && reason === 'initial' && prepareEmptyBodyRef.current && blocks.length === 1) {
        blocks.push({ type: 'paragraph', content: [] });
      }

      // 이미지 임베드를 image 블록(blob URL/자리표시)으로 변환한다.
      // 기존 blob URL과 매핑은 새 로드를 화면에 적용할 때만 교체한다.
      let nextImageMapping = new Map<string, string>();
      let nextBlobUrls: string[] = [];
      const vaultRootPath = file.vault;
      if (vaultRootPath) {
        const prepared = await prepareImageEmbedBlocks({
          body,
          blocks,
          imageFiles: imageFilesRef.current ?? [],
          noteFolderPath: folder,
          vaultRootPath,
          readBinaryFile,
        });
        blocks = prepared.blocks;
        nextImageMapping = prepared.restoreMapping;
        nextBlobUrls = prepared.blobUrls;
      }

      if (!isMountedRef.current || !isCurrentFile()) {
        revokeBlobUrls(nextBlobUrls);
        return false;
      }
      // 재로드 IO 동안 새 입력이 생기면 블록/메타/이미지 상태를 교체하지 않는다.
      if (reason === 'external' && (syncState.hasLocalChanges() || syncState.saveTimer() !== null)) {
        revokeBlobUrls(nextBlobUrls);
        preserveDraft();
        syncState.deferExternalChange(fileMtime ?? Date.now());
        setHasExternalChangePending(true);
        setExternalChangeNotice('파일 변경이 감지되었습니다. 작성 중인 내용은 그대로 유지합니다.');
        reportExternalPending(true);
        return false;
      }
      if (isMountedRef.current && isCurrentFile()) {
        lastSavedFileContentRef.current = content;
        sourceFrontmatterRef.current = metadata.frontmatter;
        // 작성본 복구여도 기준은 디스크 원본이다. 작성본 보관이 원본 저장 차단을 풀지 않는다(DFXR-001).
        frontmatterUnreadableRef.current = loadGuard.diskUnreadable;
        metaUnreadableRef.current = loadGuard.metaUnreadable;
        if (metadata.createdAt !== undefined) {
          createdAtRef.current = metadata.createdAt;
        }
        if (metadata.updatedAt !== undefined) {
          updatedAtRef.current = metadata.updatedAt;
        }
        if (metadata.aliases !== null) {
          aliasesRef.current = metadata.aliases;
        }
        if (metadata.previousTitle !== undefined) {
          previousTitleRef.current = metadata.previousTitle;
        }
        // todoMeta는 조건 없이 파일 기준으로 덮어쓴다 — 외부에서 type: todo를 지웠으면
        // 다음 저장에도 되살아나지 않는다(2026-08-16 F4 계약, extractNoteMetadata 주석 참고).
        todoMetaRef.current = metadata.todoMeta;
        // 태그도 같은 이유로 파일 기준(TICK-UX-007 노트 공통 태그).
        tagsRef.current = metadata.tags;
        // 즐겨찾기도 파일 기준이다(2026-09-19 TICK-UX-013).
        favoriteRef.current = metadata.favorite;
        savedMetaSigRef.current = JSON.stringify([metadata.todoMeta, metadata.tags, metadata.favorite]);
        revokeBlobUrls(imageBlobUrlsRef.current);
        imageRestoreMappingRef.current = nextImageMapping;
        imageBlobUrlsRef.current = nextBlobUrls;
        const typedBlocks = blocks as Parameters<typeof editor.replaceBlocks>[1];
        // replaceBlocks는 BlockNote onChange를 동기 또는 비동기로 트리거할 수 있다.
        // 이 구간 동안 handleChange가 hasLocalChanges를 켜고 디바운스 저장 타이머를
        // 돌리면, 방금 읽어온 파일을 같은 내용으로 다시 저장해 mtime을 바꿔버린다.
        // reload guard를 켠 뒤 다음 tick까지 유지해 비동기 change까지 흡수한다.
        syncState.setReloading(true);
        editor.replaceBlocks(editor.document, typedBlocks);
        // 혹시 handleChange가 이미 타이머를 걸었다면 여기서 취소한다.
        syncState.clearSaveTimer();
        // 같은 tick에 남아 있을 수 있는 change 이벤트까지 흡수한 뒤 해제한다.
        window.setTimeout(() => {
          syncState.setReloading(false);
        }, 0);
        // 내용 기준선 기록: 이후 handleChange는 이 서명과 현재 내용을 비교해,
        // guard가 일찍 풀려 들어온 스푸리어스 change(=내용 동일)를 사용자 편집으로
        // 오인하지 않는다 (reload guard race idempotency).
        syncState.markLoaded(JSON.stringify(editor.document), fileMtime);
        // 원문을 실제로 읽은 경우만 쓰기 허용 증거를 만든다. 작성본+읽기 실패의 빈 content는 증거가 아니다.
        if (!diskReadFailed) syncState.grantWrite();
        lastObservedContentRef.current = syncState.lastLoadedContentSig();
        setHasExternalChangePending(false);
        reportDirty(false);
        reportExternalPending(false);
        if (recovery) {
          setRecoveryMetadata(loadGuard.useDiskMeta ? null : recovery.meta);
          recoveredMetadataRef.current = true;
          syncState.setHasLocalChanges(true);
          syncState.deferExternalChange(fileMtime ?? Date.now());
          savedMetaSigRef.current = null;
          setHasExternalChangePending(true);
          reportDirty(true);
          reportExternalPending(true);
          setRecoveryProtected(noteRecovery.isProtected(file.path));
          setRecoveryNotice(loadGuard.droppedLocalMeta
            ? '미저장 작성본을 복구했습니다. 원본 파일은 바꾸지 않았습니다. 머리말이 깨진 동안 바꾼 태그·할 일 등 메타는 반영하지 않고 본문만 고친 머리말 위에 올렸습니다.'
            : '미저장 작성본을 복구했습니다. 원본 파일은 바꾸지 않았습니다.');
          if (!noteRecovery.isProtected(file.path)) setRecoveryError('복구본은 현재 앱에만 남아 있습니다. 닫기 전에 내용을 복사해 주세요.');
          else if (diskReadFailed) setRecoveryError('원본 파일을 읽지 못해 머리말을 확인할 수 없습니다. 원본 저장을 멈췄고 작성본은 보관 중입니다. 다시 열거나 외부 변경 버전을 불러온 뒤 편집해 주세요.');
        } else { setRecoveryNotice(null); setRecoveryMetadata(null); recoveredMetadataRef.current = false; }
        const reloadNotice = recovery ? '복구한 작성본을 확인한 뒤 저장할 버전을 선택해 주세요.' : noticeForReloadReason(reason);
        if (reloadNotice !== null) {
          setExternalChangeNotice(reloadNotice);
        }

        const title = getNoteTitleFromBlocks(
          blocks as Parameters<typeof getNoteTitleFromBlocks>[0]
        );
        onTitleChangeRef.current?.(title);
        // 외부/수동 재로드에서는 디스크 기준 aliases를 앱 상태에 동기화해
        // 링크 인덱스가 파일과 어긋나지 않게 유지한다.
        // initial 로드에서는 scanNoteFiles가 이미 최신 값을 실어줬으므로 생략.
        // 설계: docs/waterfall/03-상세설계/검색-링크-인덱싱-전략.md §6.2
        if (reason !== "initial") {
          onAliasesChangeRef.current?.(aliasesRef.current);
        }
        return true;
      }
      return false;
    } catch (error) {
      editorDiagnostics.record('load-failed', {
        path: file.path, stage: reason, observedMtime: null,
        baselineMtime: syncState.lastKnownFileMtime(), pendingMtime: syncState.pendingExternalMtime(),
        dirty: syncState.hasLocalChanges(), timerPending: syncState.saveTimer() !== null, mounted: isMountedRef.current,
      }, error);
      console.error('Failed to load note:', error);
      if (isMountedRef.current && isCurrentFile()) {
        setLoadError('노트를 불러오는데 실패했습니다.');
        // 읽지 못한 외부 버전을 자동으로 덮어쓰지 않는다. 입력은 복구본에 보관한다.
        syncState.markLoadFailed(false);
        if (reason === 'external') {
          preserveDraft();
          setHasExternalChangePending(true);
          reportExternalPending(true);
          setExternalChangeNotice('외부 버전을 읽지 못해 원본 저장을 멈췄습니다. 작성 중인 글은 유지합니다.');
          savedMetaSigRef.current = null;
        }
      }
      return false;
    } finally {
      if (isMountedRef.current && isCurrentFile()) {
        setIsLoading(false);
      }
    }
  }), [editor, file, isCurrentFile, folder, syncState, reportDirty, reportExternalPending, preserveDraft]);

  // 파일 로드 후 에디터에 내용 주입
  useEffect(() => {
    isMountedRef.current = true;
    detachedBlocksRef.current = null;
    loadNoteFromDisk("initial");

    return () => {
      isMountedRef.current = false;
    };
  }, [loadNoteFromDisk]);

  const recordDiagnostic = useCallback((event: DiagnosticEvent, stage: DiagnosticStage, observedMtime: number | null = null, error?: unknown) => {
    editorDiagnostics.record(event, {
      path: file.path, stage, observedMtime,
      baselineMtime: syncState.lastKnownFileMtime(),
      pendingMtime: syncState.pendingExternalMtime(),
      dirty: syncState.hasLocalChanges(),
      timerPending: syncState.saveTimer() !== null,
      mounted: isMountedRef.current,
    }, error);
  }, [file, syncState]);

  /**
   * 외부 변경 pending 상태로 들어간다(충돌 배너 + 자동 저장 정지 + 변경 요약).
   *
   * 진입점이 둘이라 공용으로 뺐다:
   *   1) 3초 폴러가 미저장 변경 중에 더 새 파일을 봤을 때(defer-pending)
   *   2) 저장 직전 재확인이 외부 변경을 잡았을 때(TICK-BUG-001)
   * 두 경로가 같은 배너/요약을 쓰지 않으면 사용자에게 보이는 상태가 갈린다.
   */
  const enterExternalPendingState = useCallback((mtime: number) => {
    syncState.deferExternalChange(mtime);
    setHasExternalChangePending(true);
    setExternalChangeSummary(null);
    setExternalChangeNotice("파일 변경이 감지되었습니다. 작성 중인 글을 유지하며 저장할 버전 선택을 기다립니다.");
    reportExternalPending(true);

    const requestId = externalSummaryRequestRef.current + 1;
    externalSummaryRequestRef.current = requestId;
    void (async () => {
      try {
        const external = await readTextFile(file.path);
        const summary = summarizeExternalChange(
          lastSavedFileContentRef.current,
          external,
        );
        if (
          isMountedRef.current
          && externalSummaryRequestRef.current === requestId
        ) {
          setExternalChangeSummary(summary.skipped ? null : summary.summary);
        }
      } catch {
        if (
          isMountedRef.current
          && externalSummaryRequestRef.current === requestId
        ) {
          setExternalChangeSummary(null);
        }
      }
    })();
  }, [syncState, reportExternalPending, file]);

  // 저장 함수
  const saveLatestSnapshot = useCallback(async () => {
    if (currentFileRef.current !== file) return;
    if (!syncState.hasLoaded()) return;
    if (syncState.hasExternalChangePending()) {
      recordDiagnostic('save-blocked', 'pending');
      // 마운트된 상태에서만 state setter 호출
      if (isMountedRef.current) {
        setSaveError('외부 수정이 감지되어 자동 저장을 멈췄습니다. 작성 중인 글은 유지됩니다. 저장할 버전을 선택해 주세요.');
      }
      return;
    }

    if (isFrontmatterWriteBlocked({ writeGranted: syncState.isWriteGranted(), diskUnreadable: frontmatterUnreadableRef.current, metaUnreadable: metaUnreadableRef.current })) {
      recordDiagnostic('save-blocked', 'prepare');
      preserveDraft();
      if (isMountedRef.current) {
        setSaveError(!syncState.isWriteGranted()
          ? '원본 파일의 현재 내용을 확인하지 못해 저장을 멈췄습니다. 작성 중인 글은 복구본에 보관합니다. 노트를 다시 열거나 외부 변경 버전을 불러온 뒤 편집해 주세요.'
          : frontmatterUnreadableRef.current
          ? '머리말(frontmatter)을 읽을 수 없어 저장을 멈췄습니다. 작성 중인 글은 복구본에 보관합니다. 노트 파일의 머리말을 고친 뒤 다시 열어 주세요.'
          : '머리말을 읽지 못한 상태에서 편집한 내용이라 원본 저장을 멈췄습니다. 작성 중인 글은 복구본에 보관합니다. 외부 변경 버전 불러오기로 고친 원문을 다시 연 뒤 편집해 주세요.');
      } else {
        pendingSaveFailures.record({
          noteId,
          message: '원본 내용을 확인하지 못해 노트 저장을 멈췄습니다. 변경 내용이 저장되지 않았을 수 있습니다.',
          at: Date.now(),
        });
      }
      return;
    }

    savesInFlight.current += 1;
    // 마운트된 상태에서만 UI 상태 업데이트
    if (isMountedRef.current) {
      setIsSaving(true);
      setSaveError(null);
    }

    let stage: DiagnosticStage = 'prepare';
    let observedMtime: number | null = null;
    let recoveryId: string | null = null;
    recordDiagnostic('save-start', stage);
    try {
      const blocks = detachedBlocksRef.current ?? editor.document;
      const contentSig = JSON.stringify(blocks);
      // 즐겨찾기도 메타 서명에 포함한다 — 별표만 바뀌어도 저장이 필요하다(TICK-UX-013).
      const metaSig = JSON.stringify([
        todoMetaRef.current,
        tagsRef.current,
        favoriteRef.current,
      ]);
      // 재요청만 있고 본문/메타가 그대로면 변환과 쓰기를 반복하지 않는다.
      if (contentSig === syncState.lastLoadedContentSig() && metaSig === savedMetaSigRef.current) {
        syncState.setHasLocalChanges(false);
        const draft = noteRecovery.getDraft(file.path);
        if (draft) noteRecovery.markSaved(file.path, draft.id);
        if (isMountedRef.current && isCurrentFile()) {
          reportDirty(false);
          setRecoveryNotice(null);
          setRecoveryError(null);
          setRecoveryProtected(false);
        }
        return;
      }
      recoveryId = preserveDraft()?.id ?? null;
      const title = getNoteTitleFromBlocks(blocks);
      // 이미지 임베드 블록을 원문 raw 문단으로 되돌린 뒤(원본 문법 불변),
      // 빈 paragraph는 blocksToMarkdownLossy가 누락시키므로 NBSP로 마스킹해 변환한다.
      const restoredBlocks = restoreImageEmbedsInBlocks(
        blocks,
        imageRestoreMappingRef.current,
      );
      const blocksForMarkdown = maskEmptyParagraphs(restoredBlocks) as typeof blocks;
      const markdownBody = editor.blocksToMarkdownLossy(blocksForMarkdown);

      // 문서 조립(순수): alias 누적 + createdAt 최초 확정 + todo frontmatter 재기입
      const saved = buildNoteSaveDocument({
        noteId,
        title,
        markdownBody,
        now: Date.now(),
        meta: {
          createdAt: createdAtRef.current,
          aliases: aliasesRef.current,
          previousTitle: previousTitleRef.current,
          todoMeta: todoMetaRef.current,
          tags: tagsRef.current,
          favorite: favoriteRef.current,
          frontmatter: sourceFrontmatterRef.current,
        },
      });
      // 기존 부모 폴더 확인도 고정된 경로에서 수행한다. stat 뒤에는 실제 쓰기만 남긴다.
      await ensureDirectory(file.path.slice(0, file.path.lastIndexOf('/')));
      // 저장 직전 외부 변경 재확인(TICK-BUG-001). 3초 폴러는 "마지막 폴링 ~ 쓰기" 틈을
      // 구조적으로 못 본다. 여기서 먼저 확인하고, 전달한 expectedMtime을 native 작업자가
      // 대기 후 실제 쓰기 직전에 다시 비교한다. 외부 프로세스와의 원자적 CAS는 아니다.
      stage = 'stat';
      observedMtime = await getVaultFileModifiedAt(file.path);
      const guard = classifyPreSaveGuard({
        currentMtime: observedMtime,
        baselineMtime: syncState.lastKnownFileMtime(),
      });
      if (guard.action === "abort-external-change") {
        recordDiagnostic('save-blocked', stage, observedMtime);
        const externalMtime = guard.externalMtime ?? Date.now();
        if (isMountedRef.current) {
          enterExternalPendingState(externalMtime);
        } else {
          // 언마운트 flush 중이면 배너를 띄울 화면이 없다 → 무음 유실을 막기 위해
          // 저장 실패 store에 적재한다(언마운트 저장 실패 경로와 같은 취급).
          syncState.deferExternalChange(externalMtime);
          pendingSaveFailures.record({
            noteId,
            message:
              '파일이 외부에서 수정되어 자동 저장을 멈췄습니다. 해당 노트를 다시 열어 변경 내용을 확인하세요.',
            at: Date.now(),
          });
        }
        return;
      }

      // 실제 디스크 IO: 언마운트 후에도 실행되어야 저장이 보장됨
      stage = 'write';
      // 기준선은 쓰기 명령이 돌려준 "내가 쓴 내용의 mtime"이다. 저장 뒤 stat을 다시 읽으면
      // 그 사이 외부 쓰기의 mtime이 기준선이 되어 폴러가 영구히 무시한다(DEF-CONC-002).
      const savedMtime = await writeTextFile(file.path, saved.content, syncState.lastKnownFileMtime() ?? undefined);
      stage = 'post-write';
      recordDiagnostic('save-succeeded', stage, savedMtime);
      if (currentFileRef.current !== file) return;
      createdAtRef.current = saved.createdAt;
      aliasesRef.current = saved.aliases;
      previousTitleRef.current = saved.previousTitle;
      lastSavedFileContentRef.current = saved.content;
      updatedAtRef.current = saved.updatedAt;
      savedMetaSigRef.current = metaSig;
      const hasNewerChanges = JSON.stringify(detachedBlocksRef.current ?? editor.document) !== contentSig
        || JSON.stringify([todoMetaRef.current, tagsRef.current, favoriteRef.current]) !== metaSig;
      if (recoveryId) noteRecovery.markSaved(file.path, recoveryId);
      if (isMountedRef.current && !hasNewerChanges) { setRecoveryError(null); setRecoveryNotice(null); setRecoveryProtected(false); }
      // 기준선 갱신은 markSaved가 담당한다(저장 스냅샷 기준 — 되돌림 무음 유실 방지).
      syncState.markSaved(
        contentSig,
        savedMtime,
        hasNewerChanges,
      );

      stage = 'notify';
      // state setter와 콜백은 마운트된 상태에서만 호출
      if (isMountedRef.current && isCurrentFile()) {
        setHasExternalChangePending(false);
        setExternalChangeNotice(null);
        setExternalChangeSummary(null);
        reportDirty(hasNewerChanges);
        reportExternalPending(false);
        // 제목 변경 알림 (저장 직후 목록 상태도 맞춤)
        onTitleChangeRef.current?.(title);
        // aliases 변경 알림 (링크 인덱스 즉시 반영)
        onAliasesChangeRef.current?.(aliasesRef.current);
        // 저장 완료 → 저장된 노트만 링크 인덱스 증분 갱신 트리거(P1-006).
        onContentSaveRef.current?.(noteId);
        if (recoveredMetadataRef.current) {
          onTodoMetaCommitRef.current?.(noteId);
          recoveredMetadataRef.current = false;
          setRecoveryMetadata(null);
        }
      }
    } catch (error) {
      recordDiagnostic('save-failed', stage, observedMtime, error);
      console.error('Failed to save note:', error);
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'fileModifiedExternally') {
        const observed = await getVaultFileModifiedAt(file.path);
        recordDiagnostic('save-blocked', 'write', observed, error);
        if (currentFileRef.current !== file) return;
        const externalMtime = observed ?? syncState.lastKnownFileMtime() ?? Date.now();
        if (isMountedRef.current && isCurrentFile()) {
          enterExternalPendingState(externalMtime);
        } else {
          syncState.deferExternalChange(externalMtime);
          pendingSaveFailures.record({ noteId, message: '저장을 기다리는 동안 파일이 외부에서 바뀌어 저장을 멈췄습니다.', at: Date.now() });
        }
        return;
      }
      if (isMountedRef.current) {
        setSaveError(recoveryId && noteRecovery.isProtected(file.path) ? '원본 파일 저장에 실패했습니다. 작성 내용은 복구본에 보관했습니다.' : '노트 저장에 실패했습니다. 앱을 닫기 전에 작성 내용을 복사해 주세요.');
      } else {
        // 언마운트(노트/볼트 전환) 후 flush 저장이 실패하면 컴포넌트가 이미 사라져
        // saveError를 띄울 수 없다 → 무음 유실(TICK-P0-003). 모듈 store에 적재해
        // App이 다음에 surface하게 한다.
        pendingSaveFailures.record({
          noteId,
          message:
            '노트 자동 저장이 실패했습니다. 변경 내용이 저장되지 않았을 수 있으니 해당 노트를 다시 열어 확인하세요.',
          at: Date.now(),
        });
      }
    } finally {
      savesInFlight.current -= 1;
      if (isMountedRef.current) {
        setIsSaving(savesInFlight.current > 0);
      }
    }
  }, [
    editor,
    noteId,
    file,
    isCurrentFile,
    syncState,
    reportDirty,
    reportExternalPending,
    enterExternalPendingState,
    recordDiagnostic,
    preserveDraft,
  ]);

  const saveToFile = useCallback(() => file.saves.request(saveLatestSnapshot), [file, saveLatestSnapshot]);

  // saveToFileRef를 항상 최신 saveToFile로 유지
  useEffect(() => {
    saveToFileRef.current = saveToFile;
  }, [saveToFile]);

  // 언마운트 시 타이머가 활성이면 취소하고 즉시 저장 flush (저장 보장)
  // isMountedRef.current는 loadNoteFromDisk effect의 cleanup에서 false로 처리되므로
  // 이 cleanup 안에서 state setter는 saveToFile 내부의 isMountedRef 가드가 차단한다.
  useEffect(() => {
    return () => {
      // 앞선 쓰기 대기 중 에디터가 파괴돼도 최신 본문/이미지 원문 복원 자료를 보존한다.
      detachedBlocksRef.current = editor.document;
      if (syncState.hasLocalChanges()) preserveDraftRef.current();
      if (syncState.saveTimer() !== null || syncState.hasLocalChanges()) {
        syncState.clearSaveTimer();
        // fire-and-forget: 언마운트 직전 저장 시작. saveToFile 내부 가드가 setter 호출 차단.
        void saveToFileRef.current();
      }
    };
  }, [syncState, editor]);

  // 언마운트 시 이 에디터가 만든 blob URL을 전부 회수한다(메모리 누수 방지, 설계 2-E).
  useEffect(() => {
    return () => {
      revokeBlobUrls(imageBlobUrlsRef.current);
      imageBlobUrlsRef.current = [];
      // 대기 flush가 이 매핑을 사용한다. 훅 수명이 끝나면 자연스럽게 회수된다.
    };
  }, []);

  // 변경사항 자동 저장 (1초 디바운스)
  const handleChange = useCallback(() => {
    // 사용자 편집 판정(TICK-P0-003):
    //  - 로드 전이면 무시.
    //  - reload 구간(isReloading)에서 editor.replaceBlocks가 트리거한 change는 무시.
    //  - guard가 setTimeout(0) race로 일찍 풀렸더라도, 현재 내용이 방금 로드한
    //    디스크 내용과 같으면(스푸리어스) 사용자 편집이 아니다 → 저장 루프를 안 만든다.
    // 내용 동일성 비교는 큰 노트에서 비용이 있으나(P1-006 폴링 통합 시 함께 검토),
    // 데이터 안전(외부 편집 덮어쓰기 방지)이 우선이다.
    const contentSig = JSON.stringify(editor.document);
    const contentChangedSinceLoad = contentSig !== syncState.lastLoadedContentSig()
      || (savesInFlight.current > 0 && contentSig !== lastObservedContentRef.current);
    lastObservedContentRef.current = contentSig;
    if (
      !shouldTreatChangeAsUserEdit(
        syncState.hasLoaded(),
        syncState.isReloading(),
        contentChangedSinceLoad,
      )
    ) {
      return;
    }
    syncState.setHasLocalChanges(true);
    preserveDraft();
    setExternalChangeNotice(null);
    reportDirty(true);
    syncState.clearSaveTimer();
    syncState.setSaveTimer(window.setTimeout(() => {
      syncState.setSaveTimer(null); // 저장 시작 직전에 비워야 외부 수정 폴링이 정확함
      void saveToFile();
    }, 1000));
  }, [editor, saveToFile, syncState, reportDirty, preserveDraft]);

  useEffect(() => {
    const preserveBeforeClose = () => { if (syncState.hasLocalChanges()) preserveDraftRef.current(); };
    window.addEventListener('beforeunload', preserveBeforeClose);
    return () => window.removeEventListener('beforeunload', preserveBeforeClose);
  }, [syncState]);

  // 수동 저장
  const handleManualSave = useCallback(async () => {
    if (movingRef.current) return;
    syncState.clearSaveTimer();
    await saveToFile();
  }, [saveToFile, syncState]);

  /**
   * 이미지 붙여넣기/드롭 저장(2026-08-19 TICK-IMG-002 노션 체감형).
   * 노트 소속 경로(attachments/{제목}/)에 원자적 쓰기 후 커서 뒤 image 블록을 삽입한다.
   * 복원 매핑에 등록하므로 다음 저장부터 파일에는 경로 포함 ![[…]] 원문이 남는다.
   */
  const insertImageFiles = useCallback(async (files: readonly File[]) => {
    if (movingRef.current) return;
    if (files.length === 0 || !syncState.hasLoaded()) return;
    const vaultRootPath = getVaultPath();
    if (!vaultRootPath) return;

    imagesInFlight.current += 1;
    try {
      const title = getNoteTitleFromBlocks(editor.document);
      const takenLowercase = new Set(
        (imageFilesRef.current ?? []).map((file) => file.toLowerCase()),
      );
      let anchorBlockId = editor.getTextCursorPosition().block.id;

      for (const file of files) {
        const extension = extensionForMimeType(file.type);
        if (extension === null) {
          if (isMountedRef.current) {
            setSaveError(`지원하지 않는 이미지 형식입니다: ${file.type || file.name}`);
          }
          continue;
        }
        const plan = planImageAttachmentPaths({
          noteTitle: title,
          extension,
          count: 1,
          existingLowercase: takenLowercase,
          vaultRootPath,
        });
        if (plan === null) {
          if (isMountedRef.current) {
            setSaveError("이미지를 저장할 수 없습니다: 노트 제목을 먼저 입력해 주세요.");
          }
          return;
        }
        // 크기 상한 선검사(TICK-BUG-002). arrayBuffer()로 통째로 올리기 전에 막아야
        // 22MB를 메모리에 실은 뒤 Rust가 거부하는 낭비가 없다.
        if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
          if (isMountedRef.current) {
            setSaveError(
              `이미지가 너무 큽니다(${formatImageSize(MAX_IMAGE_ATTACHMENT_BYTES)} 초과): `
              + `${file.name} ${formatImageSize(file.size)}`,
            );
          }
          continue;
        }

        const absolutePath = plan.absolutePaths[0];
        const relativePath = plan.relativePaths[0];
        const bytes = new Uint8Array(await file.arrayBuffer());
        // 쓰기 실패를 잡지 않으면 호출부가 `void insertImageFiles(...)`라 unhandled rejection이
        // 되어 화면에 아무 말도 안 뜨고 남은 파일 처리까지 멈춘다(2026-08-23 [kyle] B5).
        try {
          await writeBinaryFile(absolutePath, bytes);
        } catch (error) {
          console.error("Failed to write image attachment:", error);
          if (isMountedRef.current) {
            setSaveError(`이미지를 저장하지 못했습니다: ${file.name}`);
          }
          continue;
        }

        const blob = new Blob([bytes], { type: file.type });
        const url = URL.createObjectURL(blob);
        imageBlobUrlsRef.current.push(url);
        imageRestoreMappingRef.current.set(url, `![[${relativePath}]]`);
        takenLowercase.add(absolutePath.toLowerCase());

        const inserted = editor.insertBlocks(
          [{ type: "image", props: { url, name: file.name, caption: "" } }],
          anchorBlockId,
          "after",
        );
        const lastId = inserted[inserted.length - 1]?.id;
        if (typeof lastId === "string") anchorBlockId = lastId;
      }

      onImagesInsertedRef.current?.();
    } finally {
      imagesInFlight.current -= 1;
    }
  }, [editor, syncState]);

  const handleReloadFromDisk = useCallback(async () => {
    recordDiagnostic('reload-selected', 'manualReload');
    if (recoveryChoiceInFlight.current || savesInFlight.current > 0 || imagesInFlight.current > 0 || movingRef.current) return;
    const draft = preserveDraft();
    if (!draft || !noteRecovery.isProtected(file.path) || !noteRecovery.archiveDraft(file.path)) {
      setRecoveryError('작성본을 보관하지 못해 외부 버전을 불러오지 않았습니다. 현재 글을 복사해 주세요.');
      return;
    }
    recoveryChoiceInFlight.current = true;
    editor.isEditable = false;
    syncState.clearSaveTimer();
    try { if (await loadNoteFromDisk("manualReload")) noteRecovery.markArchived(file.path, draft.id); }
    finally { recoveryChoiceInFlight.current = false; editor.isEditable = true; }
  }, [loadNoteFromDisk, recordDiagnostic, preserveDraft, file, editor, syncState]);

  const handleKeepLocalChanges = useCallback(() => {
    if (recoveryChoiceInFlight.current || savesInFlight.current > 0 || imagesInFlight.current > 0 || movingRef.current) return;
    recoveryChoiceInFlight.current = true;
    recordDiagnostic('keep-local-selected', 'pending');
    // 기준 mtime을 디스크 현재 상태로 올린다(TICK-BUG-001 후속).
    // 이게 없으면 "내 변경 유지" 뒤의 재저장을 저장 직전 가드가 또 막아 무한 거부에 빠지고,
    // 3초 폴러도 같은 외부 mtime을 다시 pending으로 올려 배너가 되살아난다.
    // 사용자가 "덮어쓰겠다"를 명시적으로 고른 순간이므로 여기서만 기준선을 앞당긴다.
    void (async () => {
      try {
        const draft = preserveDraft();
        if (!draft || !noteRecovery.isProtected(file.path)) throw new Error('Recovery unavailable');
        const before = await getVaultFileModifiedAt(file.path);
        const external = await readTextFile(file.path);
        const currentMtime = await getVaultFileModifiedAt(file.path);
        if (!isMountedRef.current || !isCurrentFile()) return;
        if (before === null || before !== currentMtime || !noteRecovery.archiveExternal(file.path, external, before)) throw new Error('External backup unavailable');
        syncState.setLastKnownFileMtime(before);
        // 새 기준이 된 외부 원문의 머리말 읽기 결과로 저장 차단을 다시 정한다(DFXR-003).
        adoptDiskFrontmatter(external);
        syncState.grantWrite(); // 외부 원문을 실제로 읽었다.
        // 읽지 못한 머리말 위에서 만든 메타는 디스크가 고쳐져도 쓰지 않는다(DFXR-004·005).
        // 충돌 선택을 닫지 않아 '외부 변경 버전 불러오기'로 빠져나올 수 있게 한다.
        if (metaUnreadableRef.current) {
          if (isMountedRef.current) setRecoveryError('머리말을 읽지 못한 상태에서 편집한 내용이라 내 변경 유지로는 저장하지 않습니다. 작성본은 보관했습니다. \'외부 변경 버전 불러오기\'를 선택해 고친 원문을 다시 연 뒤 편집해 주세요.');
          return;
        }
      } catch {
        if (isMountedRef.current) setRecoveryError('외부 버전을 보관하지 못해 덮어쓰기를 멈췄습니다. 현재 글은 유지합니다.');
        return;
      } finally { recoveryChoiceInFlight.current = false; }
      // 기준선을 올릴 때까지 pending을 유지해 수동 저장이 옛 mtime으로 시작하지 않게 한다.
      // 외부 파일을 무시했으므로 이전 저장 서명만으로 중복 저장을 생략할 수 없다.
      savedMetaSigRef.current = null;
      syncState.setHasExternalChangePending(false);
      syncState.clearPendingExternal();
      setHasExternalChangePending(false);
      setExternalChangeSummary(null);
      setSaveError(null);
      setExternalChangeNotice("내 변경을 유지합니다. 외부 변경 버전은 무시하고 자동 저장을 다시 시작합니다.");
      reportExternalPending(false);
      if (!syncState.hasLocalChanges()) return;
      syncState.clearSaveTimer();
      syncState.setSaveTimer(window.setTimeout(() => {
        syncState.setSaveTimer(null); // 저장 시작 직전에 비워야 외부 수정 폴링이 정확함
        void saveToFile();
      }, 1000));
    })();
  }, [saveToFile, syncState, reportExternalPending, file, isCurrentFile, recordDiagnostic, preserveDraft, adoptDiskFrontmatter]);

  const recoveryVersionText = useCallback((version: RecoveryVersion): string => {
    if (version.kind === 'external') return version.content;
    try {
      return buildNoteSaveDocument({ noteId, title: getNoteTitleFromBlocks(version.draft.blocks as Parameters<typeof getNoteTitleFromBlocks>[0]),
        markdownBody: editor.blocksToMarkdownLossy(maskEmptyParagraphs(version.draft.blocks) as typeof editor.document),
        meta: version.draft.meta, now: version.draft.at }).content;
    } catch { return '이 버전을 표시하지 못했습니다.'; }
  }, [editor, noteId]);

  const restoreRecoveryVersion = useCallback(async (version: RecoveryVersion) => {
    if (version.path !== file.path || recoveryChoiceInFlight.current || savesInFlight.current > 0 || imagesInFlight.current > 0 || movingRef.current || !syncState.hasLoaded()) return;
    const current = preserveDraft();
    if (!current || !noteRecovery.isProtected(file.path) || !noteRecovery.archiveDraft(file.path)) {
      setRecoveryError('현재 작성본을 보관하지 못해 복원을 멈췄습니다.'); return;
    }
    recoveryChoiceInFlight.current = true;
    try {
      const recovered = version.kind === 'draft' ? version.draft : (() => {
        const parsed = parseFrontmatter(version.content);
        const meta = extractNoteMetadata(parsed.frontmatter);
        return { blocks: editor.tryParseMarkdownToBlocks(parsed.body), meta: { ...meta, aliases: meta.aliases ?? [] }, baselineMtime: version.mtime, metaFromDisk: parsed.error === undefined };
      })();
      noteRecovery.writeDraft({ path: file.path, blocks: recovered.blocks, meta: recovered.meta, baselineMtime: recovered.baselineMtime, ...draftMetaOrigin(recovered) });
      if (!noteRecovery.isProtected(file.path)) { setRecoveryError('복원할 작성본을 보관하지 못했습니다. 현재 글은 유지합니다.'); return; }
      syncState.clearSaveTimer();
      editor.isEditable = false;
      if (!await loadNoteFromDisk('initial')) {
        noteRecovery.writeDraft({ path: file.path, blocks: current.blocks, meta: current.meta, baselineMtime: current.baselineMtime, ...draftMetaOrigin(current) });
        await loadNoteFromDisk('initial');
        setRecoveryError('보관한 버전을 복원하지 못해 이전 작성본을 유지했습니다.');
      }
    } catch { setRecoveryError('보관한 버전을 복원하지 못했습니다. 현재 글은 유지합니다.'); }
    finally { recoveryChoiceInFlight.current = false; editor.isEditable = true; }
  }, [file, editor, preserveDraft, syncState, loadNoteFromDisk]);

  // 정보 바의 투두 필드 편집 저장 경로(2026-08-18 검수 후속 P1).
  // 예전처럼 updateTodoField가 에디터 밖에서 파일을 직접 쓰면 todoMetaRef와 폴러 기준
  // mtime이 어긋나, 3초 폴러 재로드 전에 본문을 타이핑했을 때 1초 디바운스 자동 저장이
  // 옛 스냅샷으로 frontmatter를 되돌렸다. 여기서는 todoMetaRef를 먼저 갱신하고 즉시
  // saveToFile로 본문과 frontmatter를 한 번에 저장한다. 저장 성공 시 markSaved가
  // 폴러 기준 mtime을 맞추므로 자기 편집이 외부 수정 배너로 뜨지도 않는다.
  // 설계: docs/waterfall/03-상세설계/노트-정보-바.md §8
  const handleTodoMetaUpdate = useCallback<TodoMetaUpdateHandler>(async (field, value) => {
    if (movingRef.current || !syncState.hasLoaded() || syncState.hasExternalChangePending()) return;
    const next: TodoMeta = { ...todoMetaRef.current };
    if (field === "done") {
      if (value === undefined) {
        delete next.done;
      } else {
        next.done = value === true;
      }
    } else if (value === undefined || value === "") {
      // 빈 값은 frontmatter에서 키가 사라지는 것을 뜻한다.
      // buildMarkdownExportDocument가 값 없는 키를 생략하므로 삭제로 반영된다.
      delete next[field];
    } else if (field === "dueDate") {
      if (typeof value === "string") next.dueDate = value;
    } else if (typeof value === "string") {
      next.priority = value;
    }
    todoMetaRef.current = next;
    syncState.setHasLocalChanges(true);
    preserveDraft();
    reportDirty(true);
    // 정보 바 편집은 명시적 커밋이라 디바운스를 기다리지 않는다.
    syncState.clearSaveTimer();
    await saveToFile();
    // 저장 실패 시에도 재스캔하면 화면이 파일(옛 값)을 따라가 사용자가 인지할 수 있다.
    // 저장 실패 자체는 saveError 배너가 안내한다.
    if (isMountedRef.current) {
      onTodoMetaCommitRef.current?.(noteId);
    }
  }, [saveToFile, syncState, noteId, reportDirty, preserveDraft]);

  useEffect(() => {
    onTodoMetaUpdateReadyRef.current?.(handleTodoMetaUpdate);
    return () => {
      onTodoMetaUpdateReadyRef.current?.(null);
    };
  }, [handleTodoMetaUpdate]);

  /**
   * 열린 항목의 노트↔투두 변환(2026-08-19 TICK-UX-005).
   * 닫힌 항목은 기존 updateNoteFrontmatter 경로를 쓰고, 열린 항목은 여기로 온다.
   */
  const handleTodoKindUpdate = useCallback<TodoKindUpdateHandler>(async (target) => {
    if (movingRef.current || !syncState.hasLoaded() || syncState.hasExternalChangePending()) return;
    todoMetaRef.current = target === "todo"
      ? { ...todoMetaRef.current, type: "todo", done: todoMetaRef.current.done ?? false }
      : { ...todoMetaRef.current, type: undefined };
    syncState.setHasLocalChanges(true);
    preserveDraft();
    reportDirty(true);
    syncState.clearSaveTimer();
    await saveToFile();
    if (isMountedRef.current) {
      onTodoMetaCommitRef.current?.(noteId);
    }
  }, [saveToFile, syncState, noteId, reportDirty, preserveDraft]);

  /**
   * 정보 바 즐겨찾기 토글(2026-09-19 TICK-UX-013). 태그 편집과 같은 에디터 경유 경로다:
   * ref 갱신 → 디바운스 취소 → 즉시 저장 → 목록 재스캔. 새 파일 쓰기 경로를 만들지 않는다.
   * 열린 노트의 별표를 App이 직접 쓰면 자동 저장과 경합하므로 반드시 여기를 지난다.
   */
  const handleFavoriteUpdate = useCallback<FavoriteUpdateHandler>(async (favorite) => {
    if (movingRef.current || !syncState.hasLoaded() || syncState.hasExternalChangePending()) return;
    favoriteRef.current = favorite;
    syncState.setHasLocalChanges(true);
    preserveDraft();
    reportDirty(true);
    syncState.clearSaveTimer();
    await saveToFile();
    if (isMountedRef.current) {
      onTodoMetaCommitRef.current?.(noteId);
    }
  }, [saveToFile, syncState, noteId, reportDirty, preserveDraft]);

  /**
   * 정보 바 태그 편집(2026-08-23 TICK-UX-007). 마감일/우선순위와 같은 에디터 경유 경로:
   * ref 갱신 → 디바운스 취소 → 즉시 저장 → 목록 재스캔. 새 파일 쓰기 경로를 만들지 않는다.
   */
  const handleTagsUpdate = useCallback<TagsUpdateHandler>(async (tags) => {
    if (movingRef.current || !syncState.hasLoaded() || syncState.hasExternalChangePending()) return;
    tagsRef.current = tags;
    syncState.setHasLocalChanges(true);
    preserveDraft();
    reportDirty(true);
    syncState.clearSaveTimer();
    await saveToFile();
    if (isMountedRef.current) {
      onTodoMetaCommitRef.current?.(noteId);
    }
  }, [saveToFile, syncState, noteId, reportDirty, preserveDraft]);

  /**
   * 에디터 경유 폴더 이동(2026-08-23 TICK-UX-007).
   * 설계: docs/waterfall/03-상세설계/정보-바-태그-폴더-편집.md §2-3
   *
   * 왜 에디터가 끼는가: 열린 노트를 App이 그냥 옮기면, 이동 직후 미저장 변경의 자동 저장이
   * 옛 경로에 파일을 되살린다(2026-08-19 보관 이동 P3 관찰). 그래서
   *   1) 미저장 변경을 먼저 저장(flush)하고,
   *   2) 새 경로로 다시 로드될 때까지 저장을 차단(pauseForMove)한 뒤,
   *   3) App의 실제 이동(mover)을 부른다. 성공하면 folder prop이 바뀌어 initial 로드가 다시 돈다.
   * flush가 안 되면(저장 실패/외부 수정 pending) 이동을 시작하지 않는다.
   */
  const handleMoveToFolder = useCallback<MoveToFolderHandler>(async (mover) => {
    if (movingRef.current) return false;
    if (imagesInFlight.current > 0) {
      setSaveError('이미지 저장이 끝난 뒤 다시 이동해 주세요.');
      return false;
    }
    if (!syncState.hasLoaded() || savesInFlight.current > 0) {
      setSaveError('불러오기나 저장이 끝난 뒤 다시 이동해 주세요.');
      return false;
    }
    movingRef.current = true;
    setIsMoving(true);
    // React 반영 전에도 입력을 막는다. 이동 뒤에는 새 경로에서 다시 읽는다.
    editor.isEditable = false;
    try {
      syncState.clearSaveTimer();
      if (syncState.hasLocalChanges()) {
        await saveToFile();
      }
      if (syncState.hasLocalChanges() || syncState.hasExternalChangePending()) {
        if (isMountedRef.current) {
          setSaveError('이동 전에 저장을 마치지 못했습니다. 외부 수정 배너나 저장 오류를 먼저 해결해 주세요.');
        }
        return false;
      }
      const mtime = await getVaultFileModifiedAt(file.path);
      if (mtime === null || mtime !== syncState.lastKnownFileMtime()) {
        if (mtime !== null) enterExternalPendingState(mtime);
        setSaveError('파일 상태가 바뀌었거나 확인되지 않아 이동을 멈췄습니다. 다시 확인해 주세요.');
        return false;
      }
      if (JSON.stringify(editor.document) !== syncState.lastLoadedContentSig()) {
        syncState.setHasLocalChanges(true);
        setSaveError('추가 입력을 저장한 뒤 다시 이동해 주세요.');
        return false;
      }
      syncState.pauseForMove();
      await mover();
      return true;
    } catch (error) {
      console.error('Failed to move note:', error);
      syncState.restoreLoaded();
      if (isMountedRef.current) {
        setSaveError(`노트를 옮기지 못했습니다: ${toErrorMessage(error, '알 수 없는 오류')}`);
      }
      return false;
    } finally {
      movingRef.current = false;
      editor.isEditable = true;
      if (isMountedRef.current) setIsMoving(false);
    }
  }, [saveToFile, syncState, editor, file, enterExternalPendingState]);

  useEffect(() => {
    onTodoKindUpdateReadyRef.current?.(handleTodoKindUpdate);
    return () => {
      onTodoKindUpdateReadyRef.current?.(null);
    };
  }, [handleTodoKindUpdate]);

  // 외부 수정 감지 폴러(3초) — 앱 3단계 패스 2에서 분리.
  // 결정 트리(classifyExternalPoll)는 순수 함수 그대로, 상태는 syncState로 공유.
  const handlePollerExternalChange = useCallback((mtime: number) => {
    recordDiagnostic('external-reload', 'poll', mtime);
    void loadNoteFromDisk("external");
    // 재로드가 도는 동안 pending을 켜 두면 그 사이의 저장이 낡은 내용으로 디스크를
    // 덮어쓰는 것을 막는다. 성공하면 markLoaded가 해제한다. 실패하면 markLoadFailed(false)로
    // pending을 유지한 채 화면 경고·작성본 복구를 보여 주고 원본 저장은 보류한다(2026-10-07).
    syncState.deferExternalChange(mtime);
  }, [loadNoteFromDisk, syncState, recordDiagnostic]);

  const handlePollerPendingExternal = useCallback((mtime: number) => {
    recordDiagnostic('external-pending', 'poll', mtime);
    enterExternalPendingState(mtime);
  }, [enterExternalPendingState, recordDiagnostic]);

  useExternalNotePoller({
    fileKey: noteId,
    filePath: file.path,
    enabled: !isLoading && isCurrentFile(),
    isSaving,
    syncState,
    onExternalChange: handlePollerExternalChange,
    onPendingExternalChange: handlePollerPendingExternal,
  });

  // 로딩 중이면 에디터를 null로 반환
  const safeEditor = isLoading ? null : editor;

  return {
    editor: safeEditor,
    filePath: file.path,
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
    handleManualSave,
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
  };
}
