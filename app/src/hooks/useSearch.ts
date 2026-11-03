import { useEffect, useMemo, useState } from 'react';
import type { NoteListItem } from '../types/note';
import { LocalRecordSearch, type LocalSearchResult } from '../lib/local-record-search';
import { tauriVaultAdapter } from '../lib/tauri-vault-adapter';
export type { SearchHit, SearchMatchField } from '../lib/local-record-search';

/** 별도 색인/API 없이 로컬 원문 검색. 볼트/검색어가 바뀌면 늦은 결과를 버린다. */
export function useSearch(notes: NoteListItem[], vaultPath: string | null) {
  const [input, setInput] = useState({ vaultPath, query: '' });
  const query = input.vaultPath === vaultPath ? input.query : '';
  const setQuery = (value: string) => setInput({ vaultPath, query: value });
  const engine = useMemo(() => vaultPath ? new LocalRecordSearch(vaultPath, tauriVaultAdapter) : null, [vaultPath]);
  const [response, setResponse] = useState<{ engine: LocalRecordSearch | null; query: string; notes: NoteListItem[]; result: LocalSearchResult } | null>(null);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!engine || !query.trim()) return;
      void engine.search(notes, query, () => active).then(result => {
        if (active) setResponse({ engine, query, notes, result });
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [engine, query, notes]);
  const isActive = query.trim().length > 0;
  const sameSearch = response?.engine === engine && response.query === query;
  const current = sameSearch && response.notes === notes ? response.result : null;
  // 이동·재스캔으로 목록만 바뀐 재검색 동안에는 이전 결과를 새 목록에 다시 붙여 보여준다(빈 상태 깜빡임 방지).
  const stale = useMemo(() => !current && sameSearch && response ? remapHits(response.result, notes) : null,
    [current, sameSearch, response, notes]);
  const shown = current ?? stale;
  return { query, setQuery, activeQuery: query.trim(), isActive, hits: shown?.hits ?? [],
    searching: isActive && !shown, skipped: shown?.skipped ?? 0 };
}

/** 이전 결과의 노트를 같은 ID의 최신 항목으로 바꾼다. 사라진 노트의 결과는 뺀다. */
function remapHits(result: LocalSearchResult, notes: readonly NoteListItem[]): LocalSearchResult {
  const byId = new Map(notes.map(note => [note.id, note]));
  const hits = result.hits.flatMap(hit => {
    const note = byId.get(hit.note.id);
    return note ? [{ ...hit, note }] : [];
  });
  return { hits, skipped: result.skipped };
}
