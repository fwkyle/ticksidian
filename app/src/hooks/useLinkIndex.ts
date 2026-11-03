/**
 * useLinkIndex
 *
 * 노트 목록을 받아 LinkIndex를 생성/갱신한다.
 *
 * 1차 버전은 notes 배열이 바뀔 때마다 전체 재빌드했지만,
 * M2부터는 이전 스냅샷과 diff를 계산해서 작은 변경은 증분 갱신한다.
 *
 * **증분 안전 경계 (보수적)**:
 *   - applyNoteChange는 "변경된 노트 자신"의 outgoing/backlink만 교체한다.
 *   - 다른 노트가 이 노트를 타겟으로 하는 해석은 재계산되지 않는다.
 *   - 따라서 title/aliases/filePath/type이 바뀌거나 added/removed가 있으면
 *     증분은 stale할 수 있으므로 full rebuild로 fallback한다.
 *   - 오직 "해당 노트의 본문/기타 메타만 바뀐 변경"만 증분으로 통과시킨다.
 *
 * 설계: docs/waterfall/03-상세설계/검색-링크-인덱싱-전략.md §6.4
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { NoteListItem } from "../types/note";
import type { LinkIndex, LinkableNoteMeta } from "../lib/wiki-links";
import { applyNoteChange, LinkIndexBuilder } from "../lib/wiki-links";
import { getVaultPath, readNoteFile as readNoteFileFromVault } from "../lib/local-fs";
import { LinkContentSession, hasKnownLinkMtime } from "../lib/wiki-links/link-content-session.ts";

export interface UseLinkIndexResult {
  linkIndex: LinkIndex | null;
  loading: boolean;
  /** 전체 재빌드. 볼트 전환, 대량 변경, 외부 명시 호출에 사용. */
  reload: () => Promise<void>;
  /**
   * 한 노트의 본문 저장 후, 그 노트만 증분 재해석한다(TICK-P1-006).
   * 매 자동저장마다 full rebuild로 전체 파일을 다시 읽는 비용을 없앤다.
   * 제목/별칭 변경은 App이 notes 배열을 갱신 → notes-변경 경로가 full rebuild로
   * 잡으므로, 여기서는 본문(outgoing/backlink)만 안전하게 증분한다.
   */
  applyContentChange: (noteId: string) => Promise<void>;
}

export interface UseLinkIndexDependencies {
  /** React 상태로 게시된 볼트 경로. 가변 adapter 경로를 캐시 식별자로 쓰지 않는다. */
  vaultPath?: string | null;
  readNoteFile?: typeof readNoteFileFromVault;
}

/** diff 크기가 이 값을 넘으면 증분 대신 full rebuild로 빠진다. */
const FULL_REBUILD_THRESHOLD = 20;

function toLinkableMeta(note: NoteListItem): LinkableNoteMeta {
  return {
    noteId: note.id,
    title: note.title,
    aliases: note.aliases ?? [],
    folder: note.folder,
    filePath: note.filePath ?? `${note.id}.md`,
    updatedAt: note.updatedAt.getTime(),
    type: note.type,
  };
}

function aliasesEqual(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}

/**
 * 두 스냅샷 사이에 "변경으로 감지해야 할" 차이가 있는지.
 * watcher가 이미 fileMtime을 봐서 여기 진입한다는 전제지만,
 * 훅 단독 사용 시에도 동작하도록 다양한 필드를 본다.
 */
function isMetaChanged(prev: NoteListItem, curr: NoteListItem): boolean {
  if (prev.title !== curr.title) return true;
  if (prev.folder !== curr.folder) return true;
  if (prev.fileBasename !== curr.fileBasename) return true;
  if ((prev.filePath ?? "") !== (curr.filePath ?? "")) return true;
  if (prev.updatedAt.getTime() !== curr.updatedAt.getTime()) return true;
  if (!hasKnownLinkMtime(curr) || prev.fileMtime !== curr.fileMtime) return true;
  if (!aliasesEqual(prev.aliases, curr.aliases)) return true;
  if (prev.type !== curr.type) return true;
  return false;
}

/**
 * 링크 해석에 영향을 주는 메타 변경인지.
 * 이 중 하나라도 참이면 다른 노트의 해석이 stale해질 수 있으므로
 * full rebuild로 fallback한다.
 */
function isLinkRelevantChange(prev: NoteListItem, curr: NoteListItem): boolean {
  if (prev.title !== curr.title) return true;
  if (!aliasesEqual(prev.aliases, curr.aliases)) return true;
  if ((prev.filePath ?? "") !== (curr.filePath ?? "")) return true;
  if (prev.folder !== curr.folder) return true;
  if (prev.fileBasename !== curr.fileBasename) return true;
  if (prev.type !== curr.type) return true;
  return false;
}

export function useLinkIndex(
  notes: NoteListItem[],
  dependencies: UseLinkIndexDependencies = {},
): UseLinkIndexResult {
  const [linkIndex, setLinkIndex] = useState<LinkIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [session] = useState(() => new LinkContentSession());
  const mountedRef = useRef(false);
  const linkIndexRef = useRef<LinkIndex | null>(null);
  // 완료된 인덱스와 같은 스냅샷만 비교 기준으로 둔다. 취소된 작업은 갱신하지 않는다.
  const committedRef = useRef<{ vaultPath: string; notes: NoteListItem[] } | null>(null);
  const contextRef = useRef<{ vaultPath: string | null; notes: NoteListItem[] } | null>(null);
  // 저장 알림이 새 메타 작업에 취소되어도 해당 파일의 무효화/재시도를 잊지 않는다.
  const pendingContentRef = useRef(new Set<string>());
  const vaultPath = dependencies.vaultPath ?? null;
  const readNoteFile = dependencies.readNoteFile ?? readNoteFileFromVault;

  const update = useCallback(async (allItems: NoteListItem[], forceFull = false) => {
    const context = contextRef.current;
    if (!mountedRef.current || context?.notes !== allItems || context.vaultPath !== vaultPath) return;
    const list = allItems.filter(note => !note.drawing);
    if (!vaultPath || list.length === 0) {
      session.clear();
      committedRef.current = null;
      pendingContentRef.current.clear();
      linkIndexRef.current = null;
      setLinkIndex(null);
      setLoading(false);
      return;
    }

    const task = session.begin(vaultPath);
    session.retain(list);
    const previous = committedRef.current?.vaultPath === vaultPath ? committedRef.current.notes : null;
    const prevMap = new Map(previous?.map(note => [note.id, note]));
    const currIds = new Set(list.map(note => note.id));
    for (const id of pendingContentRef.current) if (!currIds.has(id)) pendingContentRef.current.delete(id);
    const changed = list.filter(note => {
      const prev = prevMap.get(note.id);
      return !prev || isMetaChanged(prev, note) || pendingContentRef.current.has(note.id);
    });
    const removed = previous?.some(note => !currIds.has(note.id)) ?? false;
    const full = forceFull || !previous || !linkIndexRef.current || removed ||
      changed.length > FULL_REBUILD_THRESHOLD || changed.some(note => {
        const prev = prevMap.get(note.id);
        return !prev || isLinkRelevantChange(prev, note);
      });
    const toRead = full ? list : changed;
    if (toRead.length === 0) {
      committedRef.current = { vaultPath, notes: list };
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 전체 기준은 작업 시작 시 고정한다. 취소된 부분 계산은 게시하지 않는다.
      const builder = full || !linkIndexRef.current
        ? new LinkIndexBuilder(list.map(toLinkableMeta)) : null;
      let next = linkIndexRef.current;
      const succeeded = await session.readEach(task, toRead, async (note, expectedVault) => {
        // 볼트 초기화 중 adapter가 React 상태보다 먼저 바뀌어도 다른 볼트의 원문을 읽지 않는다.
        // 실제 경로는 readNoteFile이 await 전에 고정한다. 주입 IO는 합성 검사용이다.
        if (readNoteFile === readNoteFileFromVault && getVaultPath() !== expectedVault) {
          throw new Error("Link index vault changed before read");
        }
        const { content } = await readNoteFile(note.fileBasename ?? note.id, note.folder);
        return content;
      }, (note, content) => {
        if (builder) builder.addNote(note.id, content);
        else if (next) {
          next = applyNoteChange(next, {
            action: "upsert", noteId: note.id, meta: toLinkableMeta(note), content,
          });
        }
      });
      if (!succeeded || !mountedRef.current || !session.isCurrent(task)) return;
      if (builder) next = builder.finish();
      linkIndexRef.current = next;
      setLinkIndex(next);

      const attempted = new Set(toRead.map(note => note.id));
      // 메타 스냅샷에는 읽기 실패 항목도 남겨 다음 삭제/이름 변경을 감지한다.
      // 본문 실패는 별도 재시도 집합이 소유한다. mtime이 같아도 다음 갱신 때 다시 읽는다.
      for (const note of list) {
        if (attempted.has(note.id) && !succeeded.has(note.id)) {
          pendingContentRef.current.add(note.id);
        } else if (succeeded.has(note.id)) {
          pendingContentRef.current.delete(note.id);
        }
      }
      committedRef.current = { vaultPath, notes: list };
    } catch (error) {
      if (session.isCurrent(task)) console.error("[useLinkIndex] update failed:", error);
    } finally {
      if (mountedRef.current && session.isCurrent(task)) setLoading(false);
    }
  }, [vaultPath, readNoteFile, session]);

  useEffect(() => {
    mountedRef.current = true;
    const pendingContent = pendingContentRef.current;
    return () => {
      mountedRef.current = false;
      contextRef.current = null;
      committedRef.current = null;
      pendingContent.clear();
      linkIndexRef.current = null;
      session.clear();
    };
  }, [session]);

  useEffect(() => {
    if (contextRef.current?.vaultPath !== vaultPath) {
      committedRef.current = null;
      pendingContentRef.current.clear();
      linkIndexRef.current = null;
      setLinkIndex(null);
    }
    contextRef.current = { vaultPath, notes };
    void update(notes);
    // 빈 목록/언마운트/다음 목록으로 바뀌면 진행 중 IO만 마치고 후속 읽기는 시작하지 않는다.
    return () => session.cancel();
  }, [notes, vaultPath, update, session]);

  const reload = useCallback(async () => {
    if (!mountedRef.current || contextRef.current?.notes !== notes || contextRef.current.vaultPath !== vaultPath) return;
    session.clear(); // 명시적 전체 새로고침은 외부 변경도 다시 읽는다.
    await update(notes, true);
  }, [notes, vaultPath, update, session]);

  const applyContentChange = useCallback(async (noteId: string) => {
    if (!mountedRef.current || contextRef.current?.notes !== notes || contextRef.current.vaultPath !== vaultPath) return;
    const note = notes.find(item => item.id === noteId);
    if (!note || note.drawing) return;
    pendingContentRef.current.add(note.id);
    session.invalidate(note); // 저장 직후 notes의 mtime은 아직 이전 값일 수 있다.
    await update(notes);
  }, [notes, vaultPath, update, session]);

  return { linkIndex, loading, reload, applyContentChange };
}
