import type { NoteListItem } from '../../types/note';

export const LINK_CONTENT_LIMITS = {
  concurrency: 12,
  cacheBytes: 16 * 1024 * 1024,
  cacheEntries: 4096,
} as const;

interface CacheEntry { content: string; mtime: number; bytes: number }

function contentKey(note: NoteListItem): string {
  // 실제 IO 경로와 링크 메타의 경로를 모두 확인한다. 앱 id는 basename과 다를 수 있다.
  return JSON.stringify([note.folder, note.fileBasename ?? note.id, note.filePath ?? '']);
}

export function hasKnownLinkMtime(note: NoteListItem): boolean {
  return typeof note.fileMtime === 'number' && Number.isFinite(note.fileMtime);
}

export interface LinkReadTask {
  readonly revision: number;
  readonly vaultPath: string | null;
}

export type LinkContentReader = (note: NoteListItem, vaultPath: string) => Promise<string>;

/** 볼트 하나의 제한된 본문 캐시와 읽기 작업 수명. 원본/링크 해석 규칙은 소유하지 않는다. */
export class LinkContentSession {
  private revision = 0;
  private vaultPath: string | null = null;
  private cache = new Map<string, CacheEntry>();
  private bytes = 0;
  private readonly limits: { cacheBytes: number; cacheEntries: number };

  constructor(limits: Partial<{ cacheBytes: number; cacheEntries: number }> = {}) {
    this.limits = { ...LINK_CONTENT_LIMITS, ...limits };
  }

  get cacheSize(): number { return this.cache.size; }
  get cacheBytes(): number { return this.bytes; }

  begin(vaultPath: string | null): LinkReadTask {
    if (vaultPath !== this.vaultPath) this.clear();
    this.vaultPath = vaultPath;
    return { revision: ++this.revision, vaultPath };
  }

  isCurrent(task: LinkReadTask): boolean {
    return task.vaultPath !== null && task.vaultPath === this.vaultPath && task.revision === this.revision;
  }

  cancel(): void { this.revision++; }

  clear(): void {
    this.cancel();
    this.cache.clear();
    this.bytes = 0;
    this.vaultPath = null;
  }

  invalidate(note: NoteListItem): void {
    this.cancel(); // 이전 읽기가 같은 mtime의 캐시를 되살리지 못하게 한다.
    this.evict(contentKey(note));
  }

  retain(notes: readonly NoteListItem[]): void {
    const paths = new Set(notes.filter(note => !note.drawing).map(contentKey));
    for (const key of this.cache.keys()) if (!paths.has(key)) this.evict(key);
  }

  private evict(key: string): void {
    const entry = this.cache.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.cache.delete(key);
  }

  private remember(key: string, content: string, mtime: number): void {
    // JS 문자열의 UTF-16 상한 근사치. 객체 overhead는 항목 수 상한으로 별도 제한한다.
    const bytes = (content.length + key.length) * 2;
    this.evict(key);
    if (bytes > this.limits.cacheBytes || this.limits.cacheEntries <= 0) return;
    while (this.bytes + bytes > this.limits.cacheBytes || this.cache.size >= this.limits.cacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.evict(oldest);
    }
    this.cache.set(key, { content, mtime, bytes });
    this.bytes += bytes;
  }

  private async readOne(task: LinkReadTask, note: NoteListItem, read: LinkContentReader): Promise<string | undefined> {
    if (!this.isCurrent(task) || !task.vaultPath || note.drawing) return undefined;
    const key = contentKey(note);
    const cached = this.cache.get(key);
    const knownMtime = hasKnownLinkMtime(note);
    const observedMtime = note.fileMtime;
    if (knownMtime && cached && cached.mtime === observedMtime) {
      this.cache.delete(key);
      this.cache.set(key, cached); // 최근 사용 순서
      return cached.content;
    }
    this.evict(key);
    try {
      const content = await read(note, task.vaultPath);
      if (!this.isCurrent(task)) return undefined;
      if (knownMtime && observedMtime !== undefined) this.remember(key, content, observedMtime);
      return content;
    } catch {
      // 실패를 빈 본문 성공으로 캐시하지 않는다. 호출자는 다음 갱신에서 재시도한다.
      return undefined;
    }
  }

  /** 원문은 최대12개 묶음만 임시 보관하고 목록 순서로 소비한다. */
  async readEach(
    task: LinkReadTask,
    notes: readonly NoteListItem[],
    read: LinkContentReader,
    consume: (note: NoteListItem, content: string) => void,
  ): Promise<Set<string> | null> {
    if (!this.isCurrent(task)) return null;
    const list = notes.filter(note => !note.drawing);
    const succeeded = new Set<string>();
    for (let offset = 0; offset < list.length; offset += LINK_CONTENT_LIMITS.concurrency) {
      if (!this.isCurrent(task)) return null;
      const batch = list.slice(offset, offset + LINK_CONTENT_LIMITS.concurrency);
      const contents = await Promise.all(batch.map(note => this.readOne(task, note, read)));
      if (!this.isCurrent(task)) return null;
      for (let i = 0; i < batch.length; i++) {
        if (!this.isCurrent(task)) return null;
        const content = contents[i];
        if (content === undefined) continue;
        consume(batch[i], content);
        succeeded.add(batch[i].id);
      }
    }
    return this.isCurrent(task) ? succeeded : null;
  }

  async readMany(
    task: LinkReadTask,
    notes: readonly NoteListItem[],
    read: LinkContentReader,
  ): Promise<Map<string, string> | null> {
    const entries = new Map<string, string>();
    const succeeded = await this.readEach(task, notes, read,
      (note, content) => { entries.set(note.id, content); });
    return succeeded ? entries : null;
  }
}
