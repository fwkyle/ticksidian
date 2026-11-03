// local-fs 순수 helper 사전 보강 검증기
//
// 역할
//   - app/src/lib/local-fs-helpers.ts의 순수 로직을 Node 레벨에서 미러링해
//     VaultAdapter 리팩터링 전후 회귀를 잡는다.
//   - 원본 helper 동작이 바뀌면 이 파일도 같이 갱신해야 drift가 생기지 않는다.
//
// 사용법
//   cd app && node qa-local-fs-helpers.mjs

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

function expectThrow(label, fn) {
  let didThrow = false;
  try {
    fn();
  } catch {
    didThrow = true;
  }
  check(label, didThrow);
}

function assertSafeFolderPath(folder) {
  if (folder === "") return;
  const segments = folder.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new Error(`unsafe folder segment: '${seg}' in '${folder}'`);
    }
    if (seg.includes("\\") || seg.includes("\0")) {
      throw new Error(`unsafe character in folder segment: '${seg}'`);
    }
  }
}

function assertSafeFileName(fileName) {
  if (fileName === "" || fileName === "." || fileName === "..") {
    throw new Error(`unsafe file name: '${fileName}'`);
  }
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0")) {
    throw new Error(`unsafe character in file name: '${fileName}'`);
  }
}

function slugifyFolder(folder) {
  return encodeURIComponent(folder);
}

function extractTitleFromMarkdown(content, fallback) {
  const frontmatterMatch = content.match(/^---\s*\n[\s\S]*?title:\s*["']?([^"'\n]+)["']?\s*\n[\s\S]*?---/);
  if (frontmatterMatch) return frontmatterMatch[1].trim();
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  const firstLine = content.split("\n")[0]?.trim();
  if (firstLine && firstLine.length > 0) return firstLine.slice(0, 100);
  return fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item) => typeof item === "string");
}

function createScannedNoteItem(input) {
  const { stem, fileName, relativeFolder, content, frontmatter, mtime, birthtime } = input;
  const title = extractTitleFromMarkdown(content, stem);
  const item = {
    id: stem,
    fileBasename: stem,
    title,
    // 생성일 우선순위: frontmatter createdAt > birthtime > mtime (TICK-UX-006, 원본과 동일)
    createdAt: typeof frontmatter.createdAt === "string"
      ? new Date(frontmatter.createdAt)
      : new Date(birthtime ?? mtime),
    updatedAt: typeof frontmatter.updatedAt === "string"
      ? new Date(frontmatter.updatedAt)
      : new Date(mtime),
    fileMtime: mtime,
    folder: relativeFolder,
    filePath: relativeFolder ? `${relativeFolder}/${fileName}` : fileName,
  };
  const aliases = normalizeStringArray(frontmatter.aliases);
  if (aliases) item.aliases = aliases;
  const tags = normalizeStringArray(frontmatter.tags);
  if (tags) item.tags = tags;
  if (typeof frontmatter.externalSource === 'string') item.externalSource = frontmatter.externalSource;
  if (frontmatter.type === "todo") {
    item.type = "todo";
    item.done = frontmatter.done === true;
    if (typeof frontmatter.dueDate === "string") item.dueDate = frontmatter.dueDate;
    if (typeof frontmatter.priority === "string") item.priority = frontmatter.priority;
  }
  return item;
}

function assignDeterministicNoteIds(notes) {
  const stemGroups = new Map();
  for (const item of notes) {
    const group = stemGroups.get(item.fileBasename);
    if (group) group.push(item);
    else stemGroups.set(item.fileBasename, [item]);
  }
  for (const group of stemGroups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => a.folder.localeCompare(b.folder));
    for (let i = 1; i < group.length; i++) {
      const item = group[i];
      item.id = `${item.fileBasename}__${slugifyFolder(item.folder)}`;
    }
  }

  const usedIds = new Set();
  const orderedForUniq = [...notes].sort((a, b) => {
    const af = a.filePath ?? "";
    const bf = b.filePath ?? "";
    return af.localeCompare(bf);
  });
  for (const item of orderedForUniq) {
    if (!usedIds.has(item.id)) {
      usedIds.add(item.id);
      continue;
    }
    let n = 2;
    while (usedIds.has(`${item.id}__${n}`)) n += 1;
    item.id = `${item.id}__${n}`;
    usedIds.add(item.id);
  }
}

assertSafeFolderPath("");
assertSafeFolderPath("project/a");
check("assertSafeFolderPath: root and nested safe paths pass", true);
expectThrow("assertSafeFolderPath: '..' segment rejected", () => assertSafeFolderPath("a/../b"));
expectThrow("assertSafeFolderPath: empty middle segment rejected", () => assertSafeFolderPath("a//b"));

assertSafeFileName("note.md");
check("assertSafeFileName: plain filename passes", true);
expectThrow("assertSafeFileName: slash rejected", () => assertSafeFileName("folder/note.md"));
expectThrow("assertSafeFileName: dot rejected", () => assertSafeFileName("."));

check(
  "slugifyFolder: slash encoded, double underscore unchanged",
  slugifyFolder("a/b") === "a%2Fb" && slugifyFolder("a__b") === "a__b",
);

check(
  "extractTitleFromMarkdown: frontmatter title wins",
  extractTitleFromMarkdown("---\ntitle: Alpha\n---\n# Beta", "fallback") === "Alpha",
);
check(
  "extractTitleFromMarkdown: h1 fallback",
  extractTitleFromMarkdown("intro\n# Beta", "fallback") === "Beta",
);
check(
  "extractTitleFromMarkdown: first line fallback",
  extractTitleFromMarkdown("first line\nsecond", "fallback") === "first line",
);
check(
  "extractTitleFromMarkdown: empty content fallback",
  extractTitleFromMarkdown("", "fallback") === "fallback",
);

const item = createScannedNoteItem({
  stem: "todo-a",
  fileName: "todo-a.md",
  relativeFolder: "work",
  content: "---\ntitle: Todo A\n---\n# Ignored",
  frontmatter: {
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    aliases: ["a", 1, "b"],
    tags: ["x", false, "y"],
    type: "todo",
    done: true,
    dueDate: "2026-01-03",
    priority: "high",
  },
  mtime: 100,
});
check("createScannedNoteItem: title from markdown", item.title === "Todo A");
check("createScannedNoteItem: relative file path", item.filePath === "work/todo-a.md");
check("createScannedNoteItem: aliases string-only", JSON.stringify(item.aliases) === JSON.stringify(["a", "b"]));
check("createScannedNoteItem: tags string-only", JSON.stringify(item.tags) === JSON.stringify(["x", "y"]));
check("createScannedNoteItem: todo fields", item.type === "todo" && item.done === true && item.priority === "high");

const emptyAliases = createScannedNoteItem({
  stem: "empty",
  fileName: "empty.md",
  relativeFolder: "",
  content: "# Empty",
  frontmatter: { aliases: [] },
  mtime: 100,
});
check("createScannedNoteItem: aliases empty array preserved", JSON.stringify(emptyAliases.aliases) === JSON.stringify([]));

// TICK-UX-006 (2026-08-23): 생성일 우선순위 = frontmatter.createdAt > birthtime > mtime
const fromBirthtime = createScannedNoteItem({
  stem: "b", fileName: "b.md", relativeFolder: "", content: "# B",
  frontmatter: {}, mtime: 300, birthtime: 100,
});
check("createScannedNoteItem: frontmatter createdAt 없으면 birthtime이 생성일", fromBirthtime.createdAt.getTime() === 100);
check("createScannedNoteItem: birthtime이 있어도 수정일은 mtime", fromBirthtime.updatedAt.getTime() === 300);
const fmWins = createScannedNoteItem({
  stem: "c", fileName: "c.md", relativeFolder: "", content: "# C",
  frontmatter: { createdAt: "2026-01-01T00:00:00.000Z" }, mtime: 300, birthtime: 100,
});
check("createScannedNoteItem: frontmatter createdAt이 birthtime보다 우선", fmWins.createdAt.toISOString() === "2026-01-01T00:00:00.000Z");
const noBirth = createScannedNoteItem({
  stem: "d", fileName: "d.md", relativeFolder: "", content: "# D",
  frontmatter: {}, mtime: 300, birthtime: null,
});
check("createScannedNoteItem: birthtime null이면 mtime으로 대체(미지원 FS)", noBirth.createdAt.getTime() === 300);
const noBirthKey = createScannedNoteItem({
  stem: "e", fileName: "e.md", relativeFolder: "", content: "# E",
  frontmatter: {}, mtime: 300,
});
check("createScannedNoteItem: birthtime 키 자체가 없어도 mtime으로 대체", noBirthKey.createdAt.getTime() === 300);

// TICK-DRAW-001 (2026-08-23): 그림 항목은 내용을 읽지 않고 파일명만으로 만든다.
function drawingTitleFromFileName(fileName) {
  const suffix = ".excalidraw";
  return fileName.toLowerCase().endsWith(suffix) ? fileName.slice(0, -suffix.length) : fileName;
}
function createScannedDrawingItem({ fileName, relativeFolder, mtime, birthtime }) {
  return {
    id: fileName,
    fileBasename: fileName,
    title: drawingTitleFromFileName(fileName),
    createdAt: new Date(birthtime ?? mtime),
    updatedAt: new Date(mtime),
    fileMtime: mtime,
    folder: relativeFolder,
    filePath: relativeFolder ? `${relativeFolder}/${fileName}` : fileName,
    drawing: true,
  };
}
{
  const drawing = createScannedDrawingItem({
    fileName: "바이브코딩 구조.excalidraw",
    relativeFolder: "바이브코딩",
    mtime: 500,
    birthtime: 100,
  });
  check("그림: 제목은 확장자를 뗀 이름", drawing.title === "바이브코딩 구조");
  check("그림: fileBasename에 확장자가 남는다(같은 이름 .md와 id 충돌 방지)",
    drawing.fileBasename === "바이브코딩 구조.excalidraw" && drawing.id === "바이브코딩 구조.excalidraw");
  check("그림: drawing 플래그", drawing.drawing === true);
  check("그림: filePath는 폴더 포함", drawing.filePath === "바이브코딩/바이브코딩 구조.excalidraw");
  check("그림: 생성일은 birthtime, 수정일은 mtime",
    drawing.createdAt.getTime() === 100 && drawing.updatedAt.getTime() === 500);
}

const collisionNotes = [
  { id: "foo", fileBasename: "foo", folder: "", filePath: "foo.md", updatedAt: new Date(3) },
  { id: "foo", fileBasename: "foo", folder: "z", filePath: "z/foo.md", updatedAt: new Date(2) },
  { id: "foo", fileBasename: "foo", folder: "a/b", filePath: "a/b/foo.md", updatedAt: new Date(1) },
];
assignDeterministicNoteIds(collisionNotes);
check(
  "assignDeterministicNoteIds: same stem collisions are folder-suffixed",
  JSON.stringify(collisionNotes.map((n) => n.id)) ===
    JSON.stringify(["foo", "foo__z", "foo__a%2Fb"]),
);

const crossGroupNotes = [
  { id: "foo__a%2Fb", fileBasename: "foo__a%2Fb", folder: "", filePath: "foo__a%2Fb.md", updatedAt: new Date(1) },
  { id: "foo", fileBasename: "foo", folder: "a/b", filePath: "a/b/foo.md", updatedAt: new Date(1) },
  { id: "foo", fileBasename: "foo", folder: "", filePath: "foo.md", updatedAt: new Date(1) },
];
assignDeterministicNoteIds(crossGroupNotes);
check(
  "assignDeterministicNoteIds: cross-group id collision gets counter",
  new Set(crossGroupNotes.map((n) => n.id)).size === 3 &&
    crossGroupNotes.some((n) => n.id === "foo__a%2Fb__2"),
);

console.log(`\n${assertions} assertions, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
