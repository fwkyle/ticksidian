import type { SaveDocumentInput } from '../hooks/useNoteEditor.metadata';

const PREFIX = 'ticksidian.note-recovery.v1.';
export interface RecoveryDraft {
  id: string;
  path: string;
  at: number;
  baselineMtime: number | null;
  blocks: unknown[];
  meta: SaveDocumentInput['meta'];
  /** 메타 출처 긍정 증거(DFXR-007). false면 읽은 디스크 메타 위에서 만들지 않았다. 없으면 옛 작성본으로 정상 취급. */
  metaFromDisk?: boolean;
  /** 옛 표시(DFXR-005). true는 metaFromDisk:false와 같은 뜻. 새 작성본에는 쓰지 않는다. */
  metaUnreadable?: true;
  status: 'draft' | 'saved' | 'archived';
}
export type RecoveryVersion = { id: string; path: string; at: number } & (
  { kind: 'draft'; draft: RecoveryDraft } | { kind: 'external'; content: string; mtime: number }
);
interface StorageBoundary {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 복구본은 원본/진단 로그와 분리한다. 미저장 글과 보관 버전을 자동 퇴출하지 않는다. */
export class NoteRecoveryStore {
  private storage: () => StorageBoundary;
  private memory = new Map<string, RecoveryDraft>();
  private versions = new Map<string, RecoveryVersion>();
  private unprotected = new Set<string>();
  private revision = 0;
  private listeners = new Set<() => void>();
  constructor(storage: () => StorageBoundary) { this.storage = storage; }
  private key(path: string): string { return PREFIX + 'active.' + encodeURIComponent(path); }
  private changed(): void {
    this.revision += 1;
    for (const listener of this.listeners) {
      try { listener(); } catch { /* 화면 구독 실패가 본문 보관을 막지 않는다. */ }
    }
  }
  private persist(draft: RecoveryDraft, serialized?: string): boolean {
    this.memory.set(draft.path, draft);
    try {
      this.storage().setItem(this.key(draft.path), serialized ?? JSON.stringify(draft));
      this.unprotected.delete(draft.path);
      // 완료 상태 영속 보관 성공 뒤에만 본문 사본을 놓는다. 실패 시 안전망은 유지한다.
      if (draft.status !== 'draft') this.memory.delete(draft.path);
      return true;
    } catch {
      this.unprotected.add(draft.path);
      return false;
    }
  }
  getDraft(path: string): RecoveryDraft | null {
    const inMemory = this.memory.get(path);
    if (inMemory) return inMemory.status === 'draft' ? inMemory : null;
    try {
      const raw = this.storage().getItem(this.key(path));
      if (!raw) return null;
      const value = JSON.parse(raw) as RecoveryDraft;
      if (value.path !== path || typeof value.id !== 'string' || !Array.isArray(value.blocks)
        || !value.meta || !Array.isArray(value.meta.aliases) || !value.meta.todoMeta || !value.meta.frontmatter
        || !['draft', 'saved', 'archived'].includes(value.status)) throw new Error('Invalid draft');
      if (value.status === 'draft') this.memory.set(path, value);
      return value.status === 'draft' ? value : null;
    } catch {
      this.unprotected.add(path);
      return null;
    }
  }
  writeDraft(input: Omit<RecoveryDraft, 'id' | 'at' | 'status'>): RecoveryDraft {
    // 이후 메타 변경으로 이미 보관한 버전이 바뀌지 않도록 값으로 복제한다.
    const serialized = JSON.stringify({ ...input, id: crypto.randomUUID(), at: Date.now(), status: 'draft' });
    const draft: RecoveryDraft = JSON.parse(serialized);
    this.persist(draft, serialized);
    return draft;
  }
  isProtected(path: string): boolean { return !this.unprotected.has(path); }
  markSaved(path: string, id: string): void {
    const draft = this.getDraft(path);
    // 옛 저장의 완료가 그동안 새로 쓴 글을 완료 처리하지 않게 한다.
    if (draft?.id === id) this.persist({ ...draft, status: 'saved' });
  }
  archiveDraft(path: string): boolean {
    const draft = this.getDraft(path);
    if (!draft || !this.isProtected(path)) return false;
    const version: RecoveryVersion = { id: crypto.randomUUID(), path, at: Date.now(), kind: 'draft', draft };
    if (!this.archive(version)) return false;
    return true;
  }
  markArchived(path: string, id: string): void {
    const draft = this.getDraft(path);
    if (draft?.id === id) this.persist({ ...draft, status: 'archived' });
  }
  archiveExternal(path: string, content: string, mtime: number): boolean {
    return this.archive({ id: crypto.randomUUID(), path, at: Date.now(), kind: 'external', content, mtime });
  }
  private archive(version: RecoveryVersion): boolean {
    try {
      this.storage().setItem(PREFIX + 'version.' + version.id, JSON.stringify(version));
      this.versions.set(version.id, version);
      this.changed();
      return true;
    } catch { return false; }
  }
  listVersions(path: string): RecoveryVersion[] {
    try {
      const storage = this.storage();
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(PREFIX + 'version.')) continue;
        try {
          const v = JSON.parse(storage.getItem(key) ?? 'null') as RecoveryVersion | null;
          if (v?.path === path && typeof v.id === 'string' && Number.isFinite(v.at)
            && (v.kind === 'external' && typeof v.content === 'string' || v.kind === 'draft' && Array.isArray(v.draft?.blocks))) this.versions.set(v.id, v);
        } catch { /* 손상된 다른 버전 때문에 읽을 수 있는 글을 숨기지 않는다. */ }
      }
    } catch { /* 이번 실행에서 이미 보관한 버전은 계속 볼 수 있다. */ }
    return [...this.versions.values()].filter(v => v.path === path).sort((a, b) => b.at - a.at);
  }
  removeVersion(path: string, id: string): boolean {
    try {
      const storage = this.storage();
      const key = PREFIX + 'version.' + id;
      const raw = storage.getItem(key);
      if (!raw) return false;
      const version = JSON.parse(raw) as RecoveryVersion;
      if (version.path !== path || version.id !== id) return false;
      // 영구 삭제 대신 제거 사본을 먼저 남긴다. 실패하면 목록을 유지한다.
      storage.setItem(PREFIX + '.trash.' + id, raw);
      storage.removeItem(key);
      this.versions.delete(id);
      this.changed();
      return true;
    } catch { return false; }
  }
  getSnapshot = (): number => this.revision;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
}
export const noteRecovery = new NoteRecoveryStore(() => window.localStorage);
