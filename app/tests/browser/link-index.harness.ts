import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useLinkIndex, type UseLinkIndexResult } from '../../src/hooks/useLinkIndex';
import { buildLinkIndex } from '../../src/lib/wiki-links';
import type { LinkIndex } from '../../src/lib/wiki-links';
import type { NoteListItem } from '../../src/types/note';

const item = (id: string, extra: Partial<NoteListItem> = {}): NoteListItem => ({
  id, fileBasename: id, title: id, folder: '', filePath: `${id}.md`, fileMtime: 1,
  createdAt: new Date(0), updatedAt: new Date(0), ...extra,
});
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function until(check: () => boolean) {
  const end = performance.now() + 10000;
  while (!check()) { if (performance.now() > end) throw new Error('link harness timeout'); await tick(); }
}
function gate() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function digest(index: LinkIndex | null): string {
  if (!index) return 'null';
  const sorted = <T,>(map: Map<string, T>) => [...map].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({ notes: sorted(index.notesById), titles: sorted(index.noteIdsByTitleKey),
    outgoing: sorted(index.outgoingBySourceId), backlinks: sorted(index.backlinksByTargetId) });
}
function mount(read: (id: string, folder?: string) => Promise<{ content: string; path: string }>) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let result: UseLinkIndexResult | undefined;
  let renderCount = 0;
  let list: NoteListItem[] = [];
  const readNoteFile = async (id: string, folder?: string) => ({ content: (await read(id, folder)).content, title: id });
  function Probe({ notes, vault }: { notes: NoteListItem[]; vault: string }) {
    result = useLinkIndex(notes, { readNoteFile, vaultPath: vault });
    renderCount++;
    return null;
  }
  return {
    get result() { if (!result) throw new Error('hook not mounted'); return result; },
    async render(notes: NoteListItem[], vault = '/A', ready = true) {
      list = notes;
      const before = renderCount;
      await act(async () => { root.render(createElement(Probe, { notes, vault })); });
      await until(() => renderCount > before);
      await tick();
      if (ready) await until(() => Boolean(result && !result.loading &&
        (notes.filter(note => !note.drawing).length ? result.linkIndex : !result.linkIndex)));
    },
    equalsFull(contents: Map<string, string>) {
      const notes = list.filter(note => !note.drawing);
      const expected = buildLinkIndex({ notes: notes.map(note => ({ noteId: note.id, title: note.title,
        aliases: note.aliases ?? [], folder: note.folder, filePath: note.filePath ?? `${note.id}.md`,
        updatedAt: note.updatedAt.getTime(), type: note.type })),
      markdownByNoteId: Object.fromEntries(notes.map(note => [note.id, contents.get(note.fileBasename) ?? ''])) });
      return digest(result?.linkIndex ?? null) === digest(expected);
    },
    async apply(noteId: string) { await act(async () => { await this.result.applyContentChange(noteId); }); },
    close() { act(() => root.unmount()); host.remove(); },
  };
}

export async function countsAndResolution() {
  const contents = new Map<string, string>([['note-0', '[[대상]] [[id:note-2]] ![[그림]]']]);
  let reads = 0;
  const h = mount(async id => { reads++; return { content: contents.get(id) ?? '', path: `/A/${id}.md` }; });
  let list = Array.from({ length: 600 }, (_, i) => item(`note-${i}`, i === 1 ? { title: '대상' } : {}));
  const counts: number[] = [], matches: boolean[] = [], resolution: string[] = [];
  const check = async () => { const before = reads; await h.render(list); counts.push(reads - before);
    matches.push(h.equalsFull(contents)); resolution.push(h.result.linkIndex?.outgoingBySourceId.get('note-0')?.[0]?.resolution ?? 'missing'); };
  try {
    await check();
    list = [...list, item('new', { title: '대상' })]; await check();
    list = list.map(n => n.id === 'new' ? { ...n, title: '다른 제목' } : n); await check();
    list = list.map(n => n.id === 'new' ? { ...n, aliases: ['대상'] } : n); await check();
    list = list.filter(n => n.id !== 'new'); await check();
    list = [...list, item('drawing', { title: '대상', drawing: true })]; await check();
    contents.set('note-0', '[[id:note-3]]');
    list = list.map(n => n.id === 'note-0' ? { ...n, fileMtime: 2 } : n); await check();
    return { counts, matches, resolution };
  } finally { h.close(); }
}

export async function cancelledReads() {
  const pending = gate();
  let oldReads = 0;
  const h = mount(async id => {
    if (id.startsWith('old')) { oldReads++; await pending.promise; }
    return { content: `[[${id}]]`, path: `/A/${id}.md` };
  });
  try {
    await h.render(Array.from({ length: 600 }, (_, i) => item(`old-${i}`)), '/A', false);
    await until(() => oldReads >= 12);
    await h.render([item('new')]);
    pending.release();
    for (let i = 0; i < 20; i++) await tick();
    const afterOld = [...h.result.linkIndex?.notesById.keys() ?? []];
    await h.render([item('new', { title: '새 제목' })]);
    return { oldReads, afterOld, afterFollowup: [...h.result.linkIndex?.notesById.keys() ?? []] };
  } finally { pending.release(); h.close(); }
}

export async function lifecycle(boundary: 'empty' | 'vault' | 'unmount') {
  const pending = gate();
  let reads = 0, current = 'A';
  const h = mount(async id => { const content = current; reads++; if (content === 'A') await pending.promise;
    return { content: `[[${content}]]`, path: `/${content}/${id}.md` }; });
  let closed = false;
  try {
    await h.render(Array.from({ length: 600 }, (_, i) => item(`same-${i}`)), '/A', false);
    await until(() => reads >= 12);
    const staleApply = h.result.applyContentChange;
    if (boundary === 'unmount') { h.close(); closed = true; }
    else if (boundary === 'empty') await h.render([], '/A');
    else { current = 'B'; await h.render([item('same-0'), item('B')], '/B'); }
    await staleApply('same-0'); // 이전 화면의 저장 완료가 늦게 도착해도 새 볼트를 읽지 않는다.
    pending.release();
    for (let i = 0; i < 20; i++) await tick();
    const ids = [...h.result.linkIndex?.notesById.keys() ?? []];
    const target = h.result.linkIndex?.outgoingBySourceId.get('same-0')?.[0]?.targetNoteId ?? null;
    return { reads, ids, target };
  } finally { pending.release(); if (!closed) h.close(); }
}

export async function forcedContentAndRetry() {
  const pending = gate();
  let text = '[[target]]', block = false, fail = false, reads = 0;
  const h = mount(async id => { reads++; const content = id === 'source' ? text : '';
    if (id === 'source' && block) { block = false; await pending.promise; }
    if (id === 'source' && fail) { fail = false; throw new Error('denied'); }
    return { content, path: `/A/${id}.md` }; });
  let list = [item('source'), item('target'), item('other')];
  try {
    await h.render(list);
    block = true; text = '[[other]]';
    let old = Promise.resolve();
    await act(async () => { old = h.result.applyContentChange('source'); });
    await until(() => reads >= 4);
    text = '[[id:target]]';
    list = list.map(n => n.id === 'target' ? { ...n, title: '바뀐 제목' } : n);
    await h.render(list); // old read가 진행 중이어도 새 메타 + 강제 무효화된 본문을 함께 갱신해야 한다.
    pending.release(); await old;
    const latest = h.result.linkIndex?.outgoingBySourceId.get('source')?.[0];
    fail = true; text = '[[other]]';
    await h.apply('source');
    await h.render([...list]); // 실패한 무효화는 새 배열 갱신에서 재시도한다.
    const retried = h.result.linkIndex?.outgoingBySourceId.get('source')?.[0]?.targetNoteId;
    return { latest: latest?.targetNoteId, title: latest?.targetTitle, retried, reads };
  } finally { pending.release(); h.close(); }
}

export async function failureRemovalAndUnknownMtime() {
  let text = '[[target]]', reads = 0;
  const h = mount(async id => {
    reads++;
    if (id === 'target') throw new Error('denied');
    return { content: text, path: `/A/${id}.md` };
  });
  try {
    const source = item('source');
    await h.render([source, item('target')]);
    await h.render([source]);
    const removed = { ids: [...h.result.linkIndex?.notesById.keys() ?? []],
      resolution: h.result.linkIndex?.outgoingBySourceId.get('source')?.[0]?.resolution };
    const unknown = { ...source, fileMtime: undefined };
    await h.render([unknown]);
    const before = reads;
    text = '[[new]]';
    await h.render([{ ...unknown }]);
    return { removed, unknownReads: reads - before,
      ref: h.result.linkIndex?.outgoingBySourceId.get('source')?.[0]?.ref };
  } finally { h.close(); }
}

export async function fullThenExplicitContent() {
  const pending = gate();
  let block = true, text = '[[새 대상]]';
  const h = mount(async id => {
    const content = id === 'source' ? text : '';
    if (id === 'new' && block) { block = false; await pending.promise; }
    return { content, path: `/A/${id}.md` };
  });
  try {
    await h.render([item('source')]);
    const list = [item('source'), item('new', { title: '새 대상' })];
    await h.render(list, '/A', false);
    await until(() => !block);
    text = '[[id:new]]';
    await h.apply('source'); // 전체 메타 작업을 취소해도 새 대상이 빠져서는 안 된다.
    pending.release();
    for (let i = 0; i < 20; i++) await tick();
    const beforeFollowup = { ids: [...h.result.linkIndex?.notesById.keys() ?? []],
      target: h.result.linkIndex?.outgoingBySourceId.get('source')?.[0]?.targetNoteId };
    await h.render(list.map(n => n.id === 'new' ? { ...n, title: '최신 제목' } : n));
    return { beforeFollowup, title: h.result.linkIndex?.outgoingBySourceId.get('source')?.[0]?.targetTitle };
  } finally { pending.release(); h.close(); }
}
