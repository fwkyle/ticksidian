import type { ReviewQueueStore } from "./store.ts";

/** 시작 볼트에 IO를 고정하고, 종료된 화면의 응답/쓰기를 거부한다. */
export class ReviewQueueSession {
  readonly vaultPath: string | null;
  readonly store: ReviewQueueStore;
  private readonly currentVault: () => string | null;
  private active = true;
  private busy = false;

  constructor(vaultPath: string | null, store: ReviewQueueStore) {
    this.vaultPath = vaultPath;
    this.currentVault = store.getVaultPath;
    this.store = {
      getVaultPath: () => { this.assertActive(); return vaultPath; },
      readTextFile: (path) => this.checked(() => store.readTextFile(path)),
      createDirectory: (path, recursive) => this.checked(() => store.createDirectory(path, recursive)),
      writeTextFile: (path, text) => this.checked(() => store.writeTextFile(path, text)),
    };
  }

  // React StrictMode의 effect 재설치도 지원한다. 새 볼트에는 새 객체를 만든다.
  activate(): void { this.active = true; }
  cancel(): void { this.active = false; }
  isActive(): boolean {
    return this.active && this.vaultPath !== null && this.currentVault() === this.vaultPath;
  }
  assertActive(): void {
    if (!this.isActive()) throw new Error("볼트가 바뀌어 이전 검토 작업을 중단했습니다.");
  }
  start(): boolean {
    if (!this.isActive() || this.busy) return false;
    this.busy = true;
    return true;
  }
  finish(): void { this.busy = false; }
  async checked<T>(action: () => Promise<T>): Promise<T> {
    this.assertActive();
    const result = await action();
    this.assertActive();
    return result;
  }
}
