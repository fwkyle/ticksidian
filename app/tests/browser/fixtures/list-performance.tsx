// Why: 실제 목록 컴포넌트만 격리해 반복 실행/선택/접힘 비용을 센다.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteColumn } from '../../../src/components/sidebar/NoteColumn';
import type { NoteListItem } from '../../../src/types/note';
import type { NoteListView } from '../../../src/lib/note-list-view';
import '../../../src/index.css';

export function Harness() {
  const parameters = new URLSearchParams(location.search);
  const count = Number(parameters.get('count') ?? 25);
  const imported = parameters.get('imported') === 'true';
  const [notes, setNotes] = useState<NoteListItem[]>(() => Array.from({ length: count }, (_, i) => ({
    id: `note-${i}`, fileBasename: `note-${i}`, title: `기록 ${String(i).padStart(4, '0')}`,
    folder: 'inbox', createdAt: new Date(2026, 8, 1), updatedAt: new Date(2026, 8, 1),
    type: imported ? 'todo' : undefined,
    externalSource: imported ? 'ticktick' : undefined,
    dueDate: i % 2 ? '2026-09-08' : undefined,
  })));
  const [active, setActive] = useState<string | null>('note-0');
  const [version, setVersion] = useState(0);
  const [event, setEvent] = useState('');
  const [searching, setSearching] = useState(false);
  const [selection, setSelection] = useState<string | null>('inbox');
  const [view, setView] = useState<NoteListView>({ kind: 'record', sort: 'title', hideDone: false });
  return <>
    <button onClick={() => setVersion(v => v + 1)}>무관 상태 변경</button>
    <button onClick={() => setSearching(value => !value)}>검색 결과 전환</button>
    <button onClick={() => setSelection(null)}>전체 폴더 전환</button>
    <button onClick={() => setNotes(previous => previous.map(note => note.id === 'note-1' ? { ...note, title: '바뀐 제목', updatedAt: new Date(2026, 8, 9) } : note))}>한 제목 변경</button>
    <button onClick={() => setNotes([])}>목록 비우기</button>
    <output data-event>{event}</output><output data-version>{version}</output>
    <div style={{ width: 319, height: 760 }}>
      <NoteColumn notes={notes} selection={selection} activeNoteId={active} view={view}
        onViewChange={setView} searching={searching} searchOpen={searching}
        captureSlot={<span data-capture>초안 {version}</span>} searchSlot={<span>검색 결과</span>}
        onToggleSearch={() => setSearching(value => !value)}
        onSelectNote={id => { setActive(id); setEvent(`select:${version}:${id}`); }}
        onDeleteNote={id => setEvent(`delete:${version}:${id}`)}
        onToggleTodo={id => { setEvent(`toggle:${version}:${id}`); setNotes(previous => previous.map(note => note.id === id ? { ...note, done: !note.done } : note)); }}
        onNoteContextMenu={(note, position) => setEvent(`context:${version}:${note.title}:${position.x}:${position.y}`)} />
    </div>
  </>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
