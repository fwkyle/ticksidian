import { build } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

// QA 전용. 개인 볼트/본문/설정에 접근하지 않고 고정 합성 입력만 측정한다.
if (process.argv[2] !== '--worker') {
  const output = resolve(process.argv[2] ?? 'output/memory-profile');
  mkdirSync(output, { recursive: true });
  const bundle = join(output, 'memory-modules.mjs');
  const entry = join(output, 'memory-entry.ts');
  writeFileSync(entry, `export * as session from '${process.cwd()}/src/lib/wiki-links/link-content-session.ts';
    export * as links from '${process.cwd()}/src/lib/wiki-links/wiki-link-index.ts';
    export * as recovery from '${process.cwd()}/src/lib/note-recovery.ts';`);
  await build({
    configFile: false, logLevel: 'silent',
    build: { emptyOutDir: false, outDir: output, minify: false,
      lib: { entry, formats: ['es'], fileName: () => 'memory-modules.mjs' } },
  });
  const results = [];
  for (const kind of ['links', 'saved-recovery']) {
    for (let trial = 1; trial <= 3; trial++) {
      const child = spawnSync(process.execPath,
        ['--expose-gc', fileURLToPath(import.meta.url), '--worker', bundle, kind],
        { encoding: 'utf8' });
      if (child.status !== 0) throw new Error(child.stderr || 'memory profile failed');
      results.push({ trial, ...JSON.parse(child.stdout) });
    }
  }
  writeFileSync(join(output, 'metrics.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results));
} else {
  const { session, links, recovery } = await import(pathToFileURL(process.argv[3]).href);
  const kind = process.argv[4];
  const heap = () => { global.gc(); return process.memoryUsage().heapUsed; };
  const before = heap();
  let peak = before;
  const measure = () => { const used = heap(); peak = Math.max(peak, used); return used; };
  const started = performance.now();
  let live, count;
  if (kind === 'links') {
    count = 800;
    const notes = Array.from({ length: count }, (_, i) => ({
      id: `memory-note-${i}`, title: `memory-note-${i}`, fileBasename: `memory-note-${i}`, folder: '',
      filePath: `memory-note-${i}.md`, fileMtime: 1, updatedAt: new Date(0), createdAt: new Date(0),
    }));
    const store = new session.LinkContentSession();
    const task = store.begin('/synthetic');
    const read = async note => {
      const i = Number(note.id.slice('memory-note-'.length));
      return Buffer.alloc(65536, 65 + i % 26).toString() + `\n[[id:memory-note-${(i + 1) % count}]]`;
    };
    let index;
    if (typeof store.readEach === 'function') {
      const builder = new links.LinkIndexBuilder(notes.map(note => ({
        noteId: note.id, title: note.title, aliases: [], folder: '',
        filePath: note.filePath, updatedAt: 0,
      })));
      let consumed = 0;
      await store.readEach(task, notes, read, (note, content) => {
        builder.addNote(note.id, content);
        if (++consumed % 120 === 0) measure();
      });
      index = builder.finish();
    } else {
      const contents = await store.readMany(task, notes, read);
      measure();
      index = links.buildLinkIndex({
        notes: notes.map(note => ({ noteId: note.id, title: note.title, aliases: [],
          folder: '', filePath: note.filePath, updatedAt: 0 })),
        markdownByNoteId: Object.fromEntries(contents),
      });
      measure();
    }
    live = measure();
    if (index.outgoingBySourceId.size !== count || index.backlinksByTargetId.size !== count) {
      throw new Error('profile lost links');
    }
    globalThis.keepProfileAlive = { index, store };
  } else {
    count = 250;
    const disk = new Map();
    const storage = { get length() { return disk.size; }, key: i => [...disk.keys()][i] ?? null,
      getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value),
      removeItem: key => disk.delete(key) };
    const store = new recovery.NoteRecoveryStore(() => storage);
    for (let i = 0; i < count; i++) {
      const path = `/synthetic/${i}.md`;
      const draft = store.writeDraft({ path, baselineMtime: 1,
        blocks: [{ type: 'paragraph', content: [{ type: 'text',
          text: Buffer.alloc(32768, 65 + i % 26).toString() }] }],
        meta: { aliases: [], todoMeta: {}, frontmatter: {} },
      });
      store.markSaved(path, draft.id);
    }
    if (disk.size !== count || store.getDraft('/synthetic/0.md') !== null) {
      throw new Error('profile changed durable recovery state');
    }
    live = measure();
    globalThis.keepProfileAlive = { store, disk };
  }
  console.log(JSON.stringify({ kind, count, inputChars: kind === 'links' ? 65536 : 32768,
    heapBefore: before, heapLive: live, heapPeakSampled: peak,
    liveDelta: live - before, peakDelta: peak - before,
    durationMs: Math.round(performance.now() - started),
    note: 'V8 synthetic data; storage is an in-memory mock; sampled post-GC live heap',
  }));
}
