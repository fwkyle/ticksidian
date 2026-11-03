import type { NoteListItem } from '../types/note';
import type { VaultAdapter } from './vault-adapter';
import { parseFrontmatter } from './markdown-import.ts';
import { normalizeLinkKey } from './wiki-links/wiki-link-utils.ts';

export type SearchMatchField = 'title' | 'alias' | 'tag' | 'body';
export interface SearchHit { note: NoteListItem; matchField: SearchMatchField; matchText: string; score: number }
export interface LocalSearchResult { hits: SearchHit[]; skipped: number }
export const LOCAL_SEARCH_LIMITS = { fileBytes: 512_000, queryBytes: 16 * 1024 * 1024, cacheChars: 4 * 1024 * 1024, concurrency: 4, hits: 50 } as const;
type SearchIO = Pick<VaultAdapter, 'readTextFile' | 'getFileStat'>;

function metadataHit(note: NoteListItem, query: string): SearchHit | null {
  const values: [SearchMatchField, string][] = [['title', note.title],
    ...(note.aliases ?? []).map(value => ['alias', value] as [SearchMatchField, string]),
    ...(note.tags ?? []).map(value => ['tag', value] as [SearchMatchField, string])];
  let best: SearchHit | null = null;
  for (const [field, text] of values) {
    const value = normalizeLinkKey(text);
    const index = value.indexOf(query);
    if (index < 0) continue;
    const score = value === query ? 0 : index === 0 ? 1 : index + 2;
    if (!best || score < best.score) best = { note, matchField: field, matchText: text, score };
  }
  return best;
}

/** 볼트 한 개의 읽기 전용 검색. 검색어가 있을 때만 IO, 파일/총 읽기/동시성/메모리 제한. */
export class LocalRecordSearch {
  private readonly cache = new Map<string, { mtime: number; size: number; body: string }>();
  private cacheChars = 0;
  private readonly vaultPath: string;
  private readonly io: SearchIO;
  constructor(vaultPath: string, io: SearchIO) { this.vaultPath = vaultPath; this.io = io; }

  private remember(path: string, mtime: number, size: number, body: string) {
    const old = this.cache.get(path);
    if (old) { this.cacheChars -= old.body.length; this.cache.delete(path); }
    while (this.cacheChars + body.length > LOCAL_SEARCH_LIMITS.cacheChars && this.cache.size) {
      const first = this.cache.entries().next().value;
      if (!first) break;
      this.cacheChars -= first[1].body.length;
      this.cache.delete(first[0]);
    }
    this.cache.set(path, { mtime, size, body });
    this.cacheChars += body.length;
  }

  async search(notes: readonly NoteListItem[], raw: string, alive: () => boolean = () => true): Promise<LocalSearchResult> {
    const query = normalizeLinkKey(raw);
    const result: LocalSearchResult = { hits: [], skipped: 0 };
    if (!query || !alive()) return result;
    const pending: NoteListItem[] = [];
    for (const note of notes) {
      const match = metadataHit(note, query);
      if (match) result.hits.push(match);
      else if (!note.drawing && !note.excalidrawPlugin) pending.push(note);
    }
    let cursor = 0;
    let bytes = 0;
    const worker = async () => {
      while (cursor < pending.length && alive()) {
        const note = pending[cursor++];
        const relative = note.filePath ?? `${note.folder ? `${note.folder}/` : ''}${note.fileBasename}.md`;
        if (relative.includes('\\') || relative.split('/').some(part => !part || part.startsWith('.'))
          || !relative.endsWith('.md') || relative.endsWith('.excalidraw.md')) { result.skipped++; continue; }
        const path = `${this.vaultPath}/${relative}`;
        try {
          const stat = await this.io.getFileStat(path);
          if (!alive()) break;
          if (stat.modifiedAt === null || stat.size > LOCAL_SEARCH_LIMITS.fileBytes) { result.skipped++; continue; }
          const cached = this.cache.get(path);
          let body: string;
          if (cached?.mtime === stat.modifiedAt && cached.size === stat.size) body = cached.body;
          else {
            if (bytes + stat.size > LOCAL_SEARCH_LIMITS.queryBytes) { result.skipped++; continue; }
            bytes += stat.size;
            const content = await this.io.readTextFile(path);
            if (!alive()) break;
            const after = await this.io.getFileStat(path);
            if (!alive()) break;
            if (content.length > LOCAL_SEARCH_LIMITS.fileBytes || after.modifiedAt !== stat.modifiedAt || after.size !== stat.size) { result.skipped++; continue; }
            body = normalizeLinkKey(parseFrontmatter(content).body);
            this.remember(path, stat.modifiedAt, stat.size, body);
          }
          const index = body.indexOf(query);
          if (index >= 0) result.hits.push({ note, matchField: 'body', matchText: body.slice(Math.max(0, index - 25), index + query.length + 75), score: 10_000 + index });
        } catch { if (alive()) result.skipped++; }
      }
    };
    await Promise.all(Array.from({ length: LOCAL_SEARCH_LIMITS.concurrency }, worker));
    if (!alive()) return { hits: [], skipped: 0 };
    // 최신순(수정 시각 내림차순), 같은 시각이면 일치도. 자르기 전에 정렬해 최신 결과가 남는다.
    result.hits.sort((a, b) => b.note.updatedAt.getTime() - a.note.updatedAt.getTime() || a.score - b.score);
    result.hits = result.hits.slice(0, LOCAL_SEARCH_LIMITS.hits);
    return result;
  }
}
