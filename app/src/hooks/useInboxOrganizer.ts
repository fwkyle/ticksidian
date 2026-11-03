import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InboxOrganizerAdapter } from '../lib/inbox-organizer-adapter';
import type { FolderSuggestion, InboxCandidate, InboxSnapshot } from '../lib/inbox-organizer';
import { toErrorMessage } from '../lib/error-utils';

/** 패널은 vaultPath를 key로 삼아 볼트 변경 시 재생성한다. 늦은 응답은 epoch로 폐기한다. */
export function useInboxOrganizer(vaultPath: string, onMoved: () => Promise<void>) {
  const adapter = useMemo(() => new InboxOrganizerAdapter(vaultPath), [vaultPath]);
  const epoch = useRef(0);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<InboxCandidate | null>(null);
  const [snapshot, setSnapshot] = useState<InboxSnapshot | null>(null);
  const [suggestion, setSuggestion] = useState<FolderSuggestion | null>(null);
  const [folder, setFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => () => { epoch.current += 1; }, [adapter]);

  const run = useCallback(async (action: (alive: () => boolean) => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    const current = epoch.current;
    const alive = () => current === epoch.current;
    setBusy(true); setError(null); setMessage(null);
    try { await action(alive); }
    catch (e) { if (alive()) setError(toErrorMessage(e)); }
    finally { locked.current = false; if (alive()) setBusy(false); }
  }, []);

  const read = useCallback((note: InboxCandidate) => {
    return run(async alive => {
      setSelected(note); setSnapshot(null); setSuggestion(null); setFolder('');
      const next = await adapter.read(note.path);
      if (alive()) setSnapshot(next);
    });
  }, [adapter, run]);
  function recommend(folders: readonly string[]) {
    if (!selected || !snapshot) return Promise.resolve();
    return run(async alive => {
      setSuggestion(null); setFolder('');
      const next = await adapter.recommend(selected.path, snapshot.version, folders);
      if (alive()) { setSuggestion(next); setFolder(next.folder ?? ''); }
    });
  }
  function move(folders: readonly string[]) {
    if (!selected || !snapshot || !suggestion || !folder || !folders.includes(folder)) return Promise.resolve();
    return run(async alive => {
      await adapter.move(selected.path, folder, snapshot.version);
      if (!alive()) return;
      setSnapshot(null); setSuggestion(null); setSelected(null);
      setMessage(`‘${selected.title}’ 원본을 ${folder} 폴더로 옮겼습니다.`);
      try { await onMoved(); }
      catch { if (alive()) setError('원본 이동은 완료했지만 목록을 갱신하지 못했습니다. 화면을 다시 열어 주세요.'); }
    });
  }
  return { busy, selected, snapshot, suggestion, folder, setFolder, error, message, read, recommend, move };
}
