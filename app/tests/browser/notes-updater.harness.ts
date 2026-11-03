import '../../src/qa/browser-qa-setup';
import { act, createElement, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useNotes } from '../../src/hooks/useNotes';
import { useLinkIndex } from '../../src/hooks/useLinkIndex';

// 실제 useNotes + useLinkIndex를 StrictMode로 돌린다(DFUB-R002, 2026-10-20).
// 가짜 setNotes로는 "렌더 전에 이미 들어간 변경"을 표현할 수 없다.
type Notes = ReturnType<typeof useNotes>;
type Links = ReturnType<typeof useLinkIndex>;

async function mount() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const latest: { state?: Notes; links?: Links } = {};
  function Probe() {
    const notes = useNotes();
    const linkIndex = useLinkIndex(notes.notes, { vaultPath: notes.vaultPath });
    useEffect(() => { latest.state = notes; latest.links = linkIndex; });
    return null;
  }
  const tick = () => new Promise<void>(resolve => setTimeout(resolve, 10));
  const settle = async () => { await act(async () => { await tick(); }); };
  await act(async () => { root.render(createElement(StrictMode, null, createElement(Probe))); });
  for (let i = 0; i < 100 && (!latest.state || latest.state.loading || !latest.links?.linkIndex || latest.links.loading); i++) await settle();
  return {
    get state() { return latest.state as Notes; },
    get links() { return latest.links as Links; },
    settle,
    noteTitle: (id: string) => latest.state?.notes.find(n => n.id === id)?.title,
    indexTitle: (id: string) => latest.links?.linkIndex?.notesById.get(id)?.title,
    noteAliases: (id: string) => latest.state?.notes.find(n => n.id === id)?.aliases ?? [],
    indexAliases: (id: string) => latest.links?.linkIndex?.notesById.get(id)?.aliases ?? [],
    close: async () => { await act(async () => { root.unmount(); }); host.remove(); },
  };
}

/** 같은 act 묶음 안의 연속 알림, 생성·재스캔 직후 알림이 마지막 값으로 남는지. */
export async function orders() {
  const h = await mount();
  try {
    const id = 'note-alpha';
    const title = h.noteTitle(id) as string;
    const aliases = h.noteAliases(id);
    const out: Record<string, unknown> = { initial: { title, aliases } };

    await act(async () => { h.state.updateNoteTitle(id, 'review-title'); }); await h.settle();
    out.control = { title: h.noteTitle(id), index: h.indexTitle(id) };
    await act(async () => { h.state.updateNoteTitle(id, title); }); await h.settle();

    await act(async () => { h.state.updateNoteTitle(id, 'review-intermediate'); h.state.updateNoteTitle(id, title); }); await h.settle();
    out.batchedTitle = { title: h.noteTitle(id), index: h.indexTitle(id) };

    await act(async () => { h.state.updateNoteAliases(id, ['review-alias']); }); await h.settle();
    out.controlAlias = { aliases: h.noteAliases(id), index: h.indexAliases(id) };
    await act(async () => { h.state.updateNoteAliases(id, aliases); }); await h.settle();

    await act(async () => { h.state.updateNoteAliases(id, ['review-intermediate']); h.state.updateNoteAliases(id, aliases); }); await h.settle();
    out.batchedAlias = { aliases: h.noteAliases(id), index: h.indexAliases(id) };

    let created = '';
    await act(async () => { created = await h.state.createNote('inbox'); h.state.updateNoteTitle(created, 'review-created'); }); await h.settle();
    out.immediateCreate = { title: h.noteTitle(created), index: h.indexTitle(created) };

    const scanned = h.state.notes.map(n => (n.id === id ? { ...n, title: 'review-scanned' } : n));
    await act(async () => {
      await h.state.refreshNotes({ noteList: scanned, scannedVaultPath: h.state.vaultPath as string });
      h.state.updateNoteTitle(id, title);
    });
    await h.settle();
    out.afterRescan = { title: h.noteTitle(id), index: h.indexTitle(id) };
    return out;
  } finally { await h.close(); }
}

/** DFUB-R004: 제목 변경 직후 다른 노트를 지워도 남은 노트의 수정 시각이 바뀌지 않는지. */
export async function deleteAfterRename() {
  const h = await mount();
  try {
    const id = 'note-alpha';
    const other = h.state.notes.find(n => n.id !== id && !n.drawing)?.id as string;
    const stamp = (target: string) => h.state.notes.find(n => n.id === target)?.updatedAt.getTime();

    // 렌더 보류: act가 끝나기 전 100ms를 기다려,
    // 최신 목록 ref 계산과 React 상태 계산 사이에 시간이 흐르게 한다.
    await act(async () => {
      h.state.updateNoteTitle(id, 'review-renamed');
      await new Promise<void>(r => setTimeout(r, 100));
    });
    await h.settle();
    const beforeDelete = stamp(id);

    await act(async () => { await h.state.deleteNote(other); });
    await h.settle();
    return {
      remaining: h.noteTitle(id),
      beforeDelete,
      afterDelete: stamp(id),
      deletedGone: h.noteTitle(other) === undefined
    };
  } finally { await h.close(); }
}
