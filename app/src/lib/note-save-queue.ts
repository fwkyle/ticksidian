/** 같은 절대경로의 편집기 저장/재열기를 직렬화한다. 끝난 경로는 즉시 퇴출한다. */
export class FileTaskQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(path: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(path) ?? Promise.resolve();
    const result = previous.then(task);
    const settled = result.then(() => {}, () => {});
    this.tails.set(path, settled);
    void settled.then(() => {
      if (this.tails.get(path) === settled) this.tails.delete(path);
    });
    return result;
  }
}

export const editorFileTasks = new FileTaskQueue();

/** 실행 중 요청은 최신 하나만 남긴다. 호출자는 전체 대기 저장 완료까지 기다린다. */
export class LatestSaveQueue {
  private pending: (() => Promise<void>) | null = null;
  private running: Promise<void> | null = null;
  private readonly path: string;
  private readonly files: FileTaskQueue;

  constructor(path: string, files = editorFileTasks) {
    this.path = path;
    this.files = files;
  }

  request(task: () => Promise<void>): Promise<void> {
    this.pending = task;
    if (this.running) return this.running;
    this.running = this.files.run(this.path, async () => {
      let failed = false;
      let error: unknown;
      try {
        while (this.pending) {
          const next = this.pending;
          this.pending = null;
          try {
            await next();
          } catch (cause) {
            // 한 요청의 실패로 뒤에 있는 최신 초안까지 버리지 않는다.
            failed = true;
            error = cause;
          }
        }
        if (failed) throw error;
      } finally {
        this.running = null;
      }
    });
    return this.running;
  }
}
