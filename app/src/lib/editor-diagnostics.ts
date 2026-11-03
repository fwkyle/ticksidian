/** 본문/원문 오류 없이 저장 판단을 기록한다. 기록 실패는 저장에 영향을 주지 않는다. */
export const EDITOR_DIAGNOSTICS_KEY = 'ticksidian.editor-diagnostics.v1';
export const MAX_DIAGNOSTIC_EVENTS = 200;
const EVENTS = ['save-start', 'save-succeeded', 'save-failed', 'save-blocked', 'external-pending', 'external-reload', 'load-failed', 'reload-selected', 'keep-local-selected'] as const;
export type DiagnosticEvent = typeof EVENTS[number];
export type DiagnosticStage = 'prepare' | 'stat' | 'write' | 'post-write' | 'notify' | 'poll' | 'pending' | 'initial' | 'external' | 'manualReload';
export interface DiagnosticContext {
  path: string;
  baselineMtime: number | null;
  observedMtime: number | null;
  pendingMtime: number | null;
  dirty: boolean;
  timerPending: boolean;
  mounted: boolean;
  stage: DiagnosticStage;
}
export interface DiagnosticEntry extends DiagnosticContext {
  event: DiagnosticEvent;
  at: number;
  lastAt: number;
  repeats: number;
  session: string;
  errorCode: string | null;
}
interface DiagnosticStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STAGES: readonly string[] = ['prepare', 'stat', 'write', 'post-write', 'notify', 'poll', 'pending', 'initial', 'external', 'manualReload'];
const ERROR_CODES = ['fileModifiedExternally', 'io', 'invalidPath', 'database', 'databaseStatePoisoned', 'fsScopeUnavailable', 'fsScopeRegistration', 'secretModifiedExternally', 'fileTooLarge', 'dialogPathConversion', 'vaultBoundaryViolation', 'vaultRegistryFull', 'watch'];
function errorCode(error: unknown): string | null {
  if (error === undefined) return null;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  return typeof code === 'string' && ERROR_CODES.includes(code) ? code : 'unknown';
}
function mtime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function sanitize(value: unknown): DiagnosticEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!EVENTS.some(event => event === v.event) || !STAGES.includes(String(v.stage))
    || typeof v.path !== 'string' || mtime(v.at) === null) return null;
  return {
    event: v.event as DiagnosticEvent, stage: v.stage as DiagnosticStage,
    path: v.path.slice(0, 1024), at: v.at as number, lastAt: mtime(v.lastAt) ?? v.at as number,
    repeats: typeof v.repeats === 'number' && Number.isFinite(v.repeats) ? Math.max(1, Math.floor(v.repeats)) : 1,
    session: typeof v.session === 'string' && /^[\w-]{1,80}$/.test(v.session) ? v.session : 'unknown',
    baselineMtime: mtime(v.baselineMtime), observedMtime: mtime(v.observedMtime), pendingMtime: mtime(v.pendingMtime),
    dirty: v.dirty === true, timerPending: v.timerPending === true, mounted: v.mounted === true,
    errorCode: v.errorCode === null ? null : ERROR_CODES.includes(String(v.errorCode)) ? String(v.errorCode) : 'unknown',
  };
}

export class EditorDiagnostics {
  private entries: DiagnosticEntry[] = [];
  private listeners = new Set<() => void>();
  private initialized = false;
  private revision = 0;
  private storage: () => DiagnosticStorage;
  private session: string;
  persisted = true;

  constructor(storage: () => DiagnosticStorage, session = globalThis.crypto.randomUUID()) {
    this.storage = storage;
    this.session = session;
  }

  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const raw = this.storage().getItem(EDITOR_DIAGNOSTICS_KEY);
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Invalid diagnostics');
      this.entries = parsed.slice(-MAX_DIAGNOSTIC_EVENTS).map(sanitize).filter((v): v is DiagnosticEntry => v !== null);
    } catch {
      this.persisted = false;
    }
  }

  record(event: DiagnosticEvent, context: DiagnosticContext, error?: unknown): void {
    this.initialize();
    const at = Date.now();
    const entry = sanitize({ ...context, event, at, lastAt: at, repeats: 1, session: this.session, errorCode: errorCode(error) });
    if (!entry) return;
    const last = this.entries.at(-1);
    // 같은 판단만 합친다. 수정 시각이나 상태가 달라지면 별도 사건으로 남긴다.
    if (last && at >= last.lastAt && at - last.lastAt < 10_000
      && JSON.stringify({ ...last, at: 0, lastAt: 0, repeats: 0 }) === JSON.stringify({ ...entry, at: 0, lastAt: 0, repeats: 0 })) {
      last.lastAt = at;
      last.repeats += 1;
    } else {
      this.entries.push(entry);
      this.entries = this.entries.slice(-MAX_DIAGNOSTIC_EVENTS);
    }
    try {
      this.storage().setItem(EDITOR_DIAGNOSTICS_KEY, JSON.stringify(this.entries));
      this.persisted = true;
    } catch {
      this.persisted = false;
    }
    this.revision += 1;
    for (const listener of this.listeners) {
      try { listener(); } catch { /* 기록 구독자의 실패로 저장을 막지 않는다. */ }
    }
  }

  get count(): number { this.initialize(); return this.entries.length; }
  getSnapshot = (): number => { this.initialize(); return this.revision; };
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  exportJson(): string {
    this.initialize();
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), persisted: this.persisted, entries: this.entries }, null, 2);
  }
}

export const editorDiagnostics = new EditorDiagnostics(() => window.localStorage);
