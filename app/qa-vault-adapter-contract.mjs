// VaultAdapter contract QA
//
// 역할
//   - MemoryVaultAdapter가 파일 볼트 IO 계약을 지키는지 Node에서 직접 확인한다.
//   - Tauri 권한, OS dialog, keychain, Rust path guard를 검증하지 않는다.
//
// 사용법
//   cd app && node --experimental-strip-types qa-vault-adapter-contract.mjs

const { createMemoryVaultAdapter } = await import("./src/lib/memory-vault-adapter.ts");

let assertions = 0;
let failures = 0;

function check(label, condition, detail) {
  assertions += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

async function expectReject(label, fn) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  check(label, rejected);
}

let clock = 1000;
const FIXTURE_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
  0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 16, 16, 0, 0, 4,
  241, 1, 160, 137, 202, 111, 191, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);
const adapter = createMemoryVaultAdapter({
  initialVaultPath: "/vault",
  initialBinaryFiles: { "/vault/attachments/fixture.png": FIXTURE_PNG },
  now: () => {
    clock += 1;
    return clock;
  },
});

check("kind is memory-fixture", adapter.kind === "memory-fixture");
check("initial vault path is selectable", await adapter.selectVaultFolder() === "/vault");

await adapter.registerVaultPath("/vault");
check("registerVaultPath sets current vault path", adapter.getVaultPath() === "/vault");

await adapter.createDirectory("/vault/notes", { recursive: true });
await adapter.writeTextFile("/vault/notes/a.md", "Alpha");
check(
  "readTextFile returns written content",
  await adapter.readTextFile("/vault/notes/a.md") === "Alpha",
);

const firstStat = await adapter.getFileStat("/vault/notes/a.md");
check("getFileStat returns byte size", firstStat.size === 5);
check("getFileStat returns created/modified timestamps", firstStat.createdAt !== null && firstStat.modifiedAt !== null);

await adapter.writeTextFile("/vault/notes/a.md", "Alpha Beta");
const secondStat = await adapter.getFileStat("/vault/notes/a.md");
check("writeTextFile preserves createdAt", secondStat.createdAt === firstStat.createdAt);
check("writeTextFile updates modifiedAt", (secondStat.modifiedAt ?? 0) > (firstStat.modifiedAt ?? 0));

{
  // DEF-CONC-002: 쓰기 반환값은 방금 쓴 내용의 mtime이고, 이후 stat과 같다.
  const written = await adapter.writeTextFile('/vault/notes/a.md', 'Alpha Beta', secondStat.modifiedAt);
  const afterWrite = await adapter.getFileStat('/vault/notes/a.md');
  check('writeTextFile returns the mtime of the bytes it wrote', typeof written === 'number' && written === afterWrite.modifiedAt);
  const rewritten = await adapter.writeTextFile('/vault/notes/a.md', 'Alpha Beta', written);
  check('returned mtime is a valid expectedMtime for the next write', rewritten > written);
  // 외부 쓰기가 먼저 끼어든 뒤에는 이전 반환값으로 쓸 수 없다(기준선이 외부 mtime으로 승격되지 않는다).
  await adapter.writeTextFile('/vault/notes/a.md', 'EXTERNAL');
  await expectReject('stale returned mtime cannot overwrite an external write', () =>
    adapter.writeTextFile('/vault/notes/a.md', 'STALE', rewritten));
  check('external bytes survive the rejected write', await adapter.readTextFile('/vault/notes/a.md') === 'EXTERNAL');
  await adapter.writeTextFile('/vault/notes/a.md', 'Alpha Beta');
}

await expectReject('writeTextFile rejects an outdated expected mtime', () =>
  adapter.writeTextFile('/vault/notes/a.md', 'STALE MUST NOT WIN', firstStat.modifiedAt));
check('conditional failure preserves latest bytes', await adapter.readTextFile('/vault/notes/a.md') === 'Alpha Beta');
await adapter.writeTextFile('/vault/notes/a.md', 'Alpha Beta', (await adapter.getFileStat('/vault/notes/a.md')).modifiedAt);
await expectReject('conditional write cannot recreate a missing file', () =>
  adapter.writeTextFile('/vault/notes/missing.md', 'STALE', 1234));

{
  const baseline = (await adapter.getFileStat('/vault/notes/a.md')).modifiedAt;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = (async () => {
    await gate; // native worker/fixture beforeWrite가 실행을 늦춘 상황
    await adapter.writeTextFile('/vault/notes/a.md', 'QUEUED STALE', baseline);
  })();
  const rejected = waiting.then(() => false, () => true);
  await adapter.writeTextFile('/vault/notes/a.md', 'EXTERNAL WHILE WAITING');
  release();
  check('queued conditional write rejects an external edit during the wait', await rejected);
  check('queued conditional write preserves external bytes', await adapter.readTextFile('/vault/notes/a.md') === 'EXTERNAL WHILE WAITING');
}

await adapter.createDirectory("/vault/notes/folder", { recursive: true });
await adapter.writeTextFile("/vault/notes/folder/b.md", "Bravo");
const rootEntries = await adapter.listDirectoryEntries("/vault/notes");
check(
  "listDirectoryEntries returns direct file and directory only",
  JSON.stringify(rootEntries.map((entry) => [entry.name, entry.isDir, entry.isFile])) ===
    JSON.stringify([
      ["a.md", false, true],
      ["folder", true, false],
    ]),
);

// P1-006: listDirectoryEntries가 modifiedAt을 함께 반환하는지 검증
const fileEntry = rootEntries.find((e) => e.name === "a.md");
const dirEntry = rootEntries.find((e) => e.name === "folder");
check(
  "listDirectoryEntries: file entry has modifiedAt as number",
  fileEntry != null && typeof fileEntry.modifiedAt === "number" && fileEntry.modifiedAt > 0,
  `modifiedAt = ${fileEntry?.modifiedAt}`,
);
check(
  "listDirectoryEntries: directory entry has modifiedAt null",
  dirEntry != null && dirEntry.modifiedAt === null,
  `modifiedAt = ${dirEntry?.modifiedAt}`,
);

// modifiedAt은 writeTextFile 이후 갱신되어야 한다 (MemoryVaultAdapter fixture 검증)
await adapter.writeTextFile("/vault/notes/a.md", "Alpha Beta Gamma");
const updatedEntries = await adapter.listDirectoryEntries("/vault/notes");
const updatedFileEntry = updatedEntries.find((e) => e.name === "a.md");
check(
  "listDirectoryEntries: file modifiedAt advances after write",
  updatedFileEntry != null &&
    typeof updatedFileEntry.modifiedAt === "number" &&
    typeof fileEntry?.modifiedAt === "number" &&
    updatedFileEntry.modifiedAt > fileEntry.modifiedAt,
  `before=${fileEntry?.modifiedAt}, after=${updatedFileEntry?.modifiedAt}`,
);

await expectReject(
  "createDirectory non-recursive rejects missing parent",
  () => adapter.createDirectory("/vault/missing/child", { recursive: false }),
);

await adapter.deleteFile("/vault/notes/a.md");
await expectReject(
  "deleteFile removes file",
  () => adapter.readTextFile("/vault/notes/a.md"),
);

await expectReject(
  "readTextFile rejects missing file",
  () => adapter.readTextFile("/vault/notes/missing.md"),
);

await expectReject(
  "listDirectoryEntries rejects missing directory",
  () => adapter.listDirectoryEntries("/vault/missing"),
);

// ── readBinaryFile 계약 (2026-08-19 이미지 임베드 보기) ──────────────────────

const binaryContent = await adapter.readBinaryFile("/vault/attachments/fixture.png");
check(
  "readBinaryFile returns initial binary bytes as-is",
  binaryContent instanceof Uint8Array && binaryContent.length === FIXTURE_PNG.length
    && binaryContent.every((byte, index) => byte === FIXTURE_PNG[index]),
  `length=${binaryContent?.length}`,
);

await adapter.writeTextFile("/vault/notes/텍스트.md", "가나다");
const textBytes = await adapter.readBinaryFile("/vault/notes/텍스트.md");
const expectedTextBytes = new TextEncoder().encode("가나다");
check(
  "readBinaryFile returns UTF-8 bytes of text files",
  textBytes instanceof Uint8Array
    && textBytes.length === expectedTextBytes.length
    && textBytes.every((byte, index) => byte === expectedTextBytes[index]),
);

const binaryStat = await adapter.getFileStat("/vault/attachments/fixture.png");
check(
  "getFileStat reports binary byte size",
  binaryStat.size === FIXTURE_PNG.length,
  `size=${binaryStat.size}`,
);

await expectReject(
  "readBinaryFile rejects missing file",
  () => adapter.readBinaryFile("/vault/attachments/missing.png"),
);

// ── writeBinaryFile 계약 (2026-08-19 이미지 넣기) ──────────────────────

const NEW_PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
await adapter.writeBinaryFile("/vault/attachments/새 이미지/새 이미지 1.png", NEW_PNG);
const readBack = await adapter.readBinaryFile("/vault/attachments/새 이미지/새 이미지 1.png");
check(
  "writeBinaryFile→readBinaryFile round-trip 보존",
  readBack.length === NEW_PNG.length && readBack.every((byte, index) => byte === NEW_PNG[index]),
);

const textBefore = await adapter.readTextFile("/vault/notes/텍스트.md");
await adapter.writeBinaryFile("/vault/notes/텍스트.md", new TextEncoder().encode("바이트로 덮은 텍스트"));
const overwritten = await adapter.readTextFile("/vault/notes/텍스트.md");
check(
  "writeBinaryFile로 텍스트 파일을 덮어쓰면 UTF-8 텍스트로 읽힌다",
  textBefore === "가나다" && overwritten === "바이트로 덮은 텍스트",
);

const writtenStat = await adapter.getFileStat("/vault/attachments/새 이미지/새 이미지 1.png");
check("writeBinaryFile 후 getFileStat 크기 일치", writtenStat.size === NEW_PNG.length);

await adapter.writeBinaryFile("/vault/attachments/새 폴더 깊이/안쪽.png", NEW_PNG);
const nested = await adapter.readBinaryFile("/vault/attachments/새 폴더 깊이/안쪽.png");
check(
  "writeBinaryFile은 부모 폴더를 자동으로 만든다(Rust create_dir_all과 동일)",
  nested.length === NEW_PNG.length,
);

console.log(`\n${assertions} assertions, ${failures} failures`);
// 실제 local-fs → 기본 Tauri adapter → command wrapper를 실행한다.
// invoke만 가짜 함수이며, native 호출 인자의 전달 누락을 검사한다(OS 검증 아님).
{
  const { readFile } = await import('node:fs/promises');
  const { default: ts } = await import('typescript');
  async function load(relative, dependencies) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    new Function('require', 'exports', compiled)(name => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`unexpected import ${name}`);
    }, exports);
    return exports;
  }
  const calls = [];
  const commands = await load('./src/lib/tauri-commands.ts', {
    '@tauri-apps/api/core': { invoke: async (...args) => { calls.push(args); } },
    '@tauri-apps/api/event': {}, '@tauri-apps/plugin-dialog': {}, './rag-conversion': {},
  });
  const bridge = await load('./src/lib/tauri-vault-adapter.ts', { './tauri-commands': commands });
  const paths = await load('./src/lib/local-fs/vault-paths.ts', {
    '../tauri-vault-adapter': bridge, '../local-fs-helpers': {},
  });
  await paths.writeTextFile('/vault/notes/a.md', 'guarded', 1234);
  check('native surface receives expectedMtime through all wrappers',
    JSON.stringify(calls[0]) === JSON.stringify(['write_text_file', { path: '/vault/notes/a.md', content: 'guarded', expectedMtime: 1234 }]));
  await paths.writeTextFile('/vault/notes/a.md', 'legacy');
  check('legacy native surface leaves expectedMtime unspecified', calls[1][1].expectedMtime === undefined);
}
console.log(`\nFinal: ${assertions} assertions, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
