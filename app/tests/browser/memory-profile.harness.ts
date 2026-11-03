import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useLinkIndex, type UseLinkIndexResult } from '../../src/hooks/useLinkIndex';
import type { NoteListItem } from '../../src/types/note';

const count = 800;
let held = false;
let release = () => {};
let readStatus = () => ({ held: false, complete: false, sources: 0, targets: 0 });
let close = () => {};

export function beginProfile() {
  held = false;
  let result: UseLinkIndexResult | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const notes: NoteListItem[] = Array.from({ length: count }, (_, i) => ({
    id: `memory-note-${i}`, title: `memory-note-${i}`, fileBasename: `memory-note-${i}`,
    folder: '', filePath: `memory-note-${i}.md`, fileMtime: 1,
    updatedAt: new Date(0), createdAt: new Date(0),
  }));
  const readNoteFile = async (id: string) => {
    const i = Number(id.slice('memory-note-'.length));
    const body = new TextDecoder().decode(new Uint8Array(65536).fill(65 + i % 26));
    const content = body + `\n[[id:memory-note-${(i + 1) % count}]]`;
    if (i === count - 1) { held = true; await gate; }
    return { content, title: id };
  };
  function Probe() {
    const current = useLinkIndex(notes, { vaultPath: '/synthetic-memory', readNoteFile });
    useEffect(() => { result = current; }, [current]);
    return null;
  }
  readStatus = () => ({ held, complete: held && result?.loading === false,
    sources: result?.linkIndex?.outgoingBySourceId.size ?? 0,
    targets: result?.linkIndex?.backlinksByTargetId.size ?? 0 });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  root.render(createElement(Probe));
  close = () => {
    root.unmount();
    host.remove();
    result = undefined;
    readStatus = () => ({ held: false, complete: false, sources: 0, targets: 0 });
    close = () => {};
  };
}

export function profileStatus() {
  return readStatus();
}

export function releaseReads() { release(); }
export function closeProfile() { close(); }
