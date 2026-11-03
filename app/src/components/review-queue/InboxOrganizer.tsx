import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderNode, NoteListItem } from '../../types/note';
import { inboxCandidates, organizerFolders } from '../../lib/inbox-organizer';
import { useInboxOrganizer } from '../../hooks/useInboxOrganizer';
import { ModalDialog } from '../common/ModalDialog';

interface Props {
  vaultPath: string;
  notes: readonly NoteListItem[];
  folders: readonly FolderNode[];
  onMoved: () => Promise<void>;
  selectedNoteId?: string | null;
  selectionSignal?: number;
  onSelectCandidate?: (path: string) => void;
}
const button = 'min-h-11 rounded-md px-3 py-2 text-sm font-medium hover:bg-gray-100 dark:hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed';

export function InboxOrganizer({ vaultPath, notes, folders, onMoved, selectedNoteId, selectionSignal = 0, onSelectCandidate }: Props) {
  const candidates = useMemo(() => inboxCandidates(notes), [notes]);
  const targets = useMemo(() => organizerFolders(folders), [folders]);
  const state = useInboxOrganizer(vaultPath, onMoved);
  const initial = useMemo(() => {
    const note = notes.find(item => item.id === selectedNoteId);
    return candidates.find(item => item.path === `${note?.folder}/${note?.fileBasename}.md`) ?? candidates[0];
  }, [candidates, notes, selectedNoteId]);
  const read = state.read;
  const initialized = useRef(false);
  useEffect(() => {
    // 로컬 원문 읽기만 자동으로 한다. AI 전송/이동은 계속 별도 버튼이 필요하다.
    const timer = window.setTimeout(() => {
      if (initial && !initialized.current) { initialized.current = true; void read(initial); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initial, read, selectionSignal]);
  const [confirm, setConfirm] = useState(false);
  const canRecommend = targets.length > 0 && targets.length <= 256 && !!state.snapshot && !state.busy;
  const canMove = !!state.suggestion && !!state.folder && targets.includes(state.folder) && !state.busy;
  const selectCandidate = (candidate: (typeof candidates)[number]) => {
    if (onSelectCandidate) onSelectCandidate(candidate.path);
    else void state.read(candidate);
  };

  return <section aria-label="기본함 AI 정리" className="mx-auto w-full max-w-4xl p-4 md:p-6 text-sm text-gray-800 dark:text-zinc-100">
    <h1 className="text-xl font-semibold">기본함 AI 정리 <span className="text-xs font-normal text-gray-500 dark:text-zinc-500">{candidates.length}</span></h1>
    <p className="mt-2 text-gray-500 dark:text-zinc-400">선택한 기록을 확인하고, 필요할 때 추천받아 정리하세요.</p>
    {state.error && <p role="alert" className="mt-4 rounded border border-red-400 p-3 text-red-700 dark:text-red-300">{state.error}</p>}
    {state.message && <p role="status" className="mt-4 text-green-700 dark:text-green-300">{state.message}</p>}
    <div className="mt-5 border-y border-gray-200 dark:border-zinc-700">
      <label className="flex flex-wrap items-center gap-3 py-2">
        <span className="font-semibold">정리할 노트</span>
        <select aria-label="정리할 기본함 노트" className="min-h-11 min-w-0 flex-1 rounded-md bg-gray-100 px-3 dark:bg-zinc-800" value={state.selected?.path ?? ''} disabled={state.busy}
          onChange={event => { const note = candidates.find(item => item.path === event.target.value); if (note) selectCandidate(note); }}>
          <option value="" disabled>기본함에서 노트를 골라 주세요</option>
          {candidates.map(note => <option key={note.path} value={note.path}>{note.title}</option>)}
        </select>
      </label>
    </div>
    {candidates.length > 0 && (!state.selected || candidates.length > 1) && <button type="button" className={`${button} mt-2 text-gray-500 dark:text-zinc-400`} disabled={state.busy}
      onClick={() => {
        const index = candidates.findIndex(item => item.path === state.selected?.path);
        selectCandidate(candidates[(index + 1) % candidates.length]);
      }}>{state.selected ? '건너뛰고 다음 기록' : '다음 기록'}</button>}
    {candidates.length === 0 && <p className="py-8 text-gray-500 dark:text-zinc-400">정리할 노트가 없습니다. 기본함에 먼저 기록해 주세요. 그림은 여기서 정리하지 않습니다.</p>}
    {targets.length === 0 && <p className="mt-4 text-gray-500 dark:text-zinc-400">추천할 기존 폴더가 없습니다. 폴더를 하나 만든 뒤 다시 열어 주세요.</p>}
    {targets.length > 256 && <p role="alert" className="mt-4">폴더가 너무 많아 AI 추천을 중단했습니다. 최대 256개까지 지원합니다.</p>}
    {state.selected && <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 break-all text-base font-semibold">{state.selected.title}</h2>
        <button className={button} disabled={state.busy} onClick={() => { if (state.selected) void state.read(state.selected); }}>원본 다시 읽기</button>
      </div>
      {state.snapshot && <>
        <details className="mt-2">
          <summary className="cursor-pointer py-3 text-gray-500 dark:text-zinc-400">전송할 원문 확인</summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs dark:bg-zinc-800">{state.snapshot.content}</pre>
        </details>
        <p className="my-3 text-xs leading-relaxed text-gray-500 dark:text-zinc-400">추천 버튼을 누르면 이 노트의 원문과 기존 폴더 이름을 Gemini에 보냅니다. 비밀정보가 없는지 확인해 주세요. 추천만으로 파일이 이동하지 않습니다.</p>
        <button className={`${button} bg-gray-100 dark:bg-zinc-800`} disabled={!canRecommend} onClick={() => void state.recommend(targets)}>Gemini로 폴더 추천</button>
      </>}
    </div>}
    {state.busy && <p role="status" className="mt-4 text-gray-500 dark:text-zinc-400">처리 중…</p>}
    {state.suggestion && <div className="mt-6 border-t border-gray-200 pt-5 dark:border-zinc-700">
      <p className="text-xs text-gray-500 dark:text-zinc-400">AI 추천</p>
      <p className="mt-2 break-all text-base font-semibold">기본함 → {state.suggestion.folder ?? '기본함 유지'}</p>
      <p className="mt-2 break-words leading-relaxed">{state.suggestion.reason}</p>
      <label className="mt-4 flex flex-wrap items-center gap-3">
        <span>이동할 폴더</span>
        <select aria-label="이동할 폴더" className="min-h-11 min-w-0 max-w-full flex-1 rounded bg-gray-100 px-3 dark:bg-zinc-800" value={state.folder} disabled={state.busy} onChange={event => state.setFolder(event.target.value)}>
          <option value="">기본함에 그대로 두기</option>
          {targets.map(folder => <option key={folder} value={folder}>{folder}</option>)}
        </select>
      </label>
      <button className={`${button} mt-4 bg-gray-200 dark:bg-zinc-700`} disabled={!canMove} onClick={() => setConfirm(true)}>이동 확인</button>
    </div>}
    {confirm && <ModalDialog title="원본을 이 폴더로 옮길까요?" onClose={() => setConfirm(false)} description={<span className="break-all">{state.selected?.path} → {state.folder}</span>}>
      <p className="mb-4 text-sm text-gray-600 dark:text-zinc-300">파일명과 내용은 그대로 옮깁니다. 경로를 직접 적은 링크는 자동 수정하지 않으니 확인해 주세요. 원본이 바뀌었거나 같은 이름이 있으면 이동을 막습니다.</p>
      <div className="flex justify-end gap-2">
        <button className={button} onClick={() => setConfirm(false)}>취소</button>
        <button className={`${button} bg-gray-200 dark:bg-zinc-700`} disabled={!canMove} onClick={() => { setConfirm(false); void state.move(targets); }}>확인하고 이동</button>
      </div>
    </ModalDialog>}
  </section>;
}
