// Markdown Export 순수 규칙 + 다운로드 경계 검증기
//
// 역할
//   - markdown-export.ts를 Node에서 직접 import해 파일명, frontmatter, 본문 보존 규칙을 검증한다.
//   - 브라우저 다운로드는 가짜 downloader를 주입해 filename/document 전달과 반환값을 확인한다.
//
// 사용법
//   cd app && node --experimental-strip-types qa-markdown-export.mjs

const {
  buildMarkdownExportDocument,
  createMarkdownExportFilename,
  exportNoteAsMarkdown,
} = await import("./src/lib/markdown-export.ts");

let assertions = 0;
let failures = 0;

function check(label, condition, detail) {
  assertions += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail != null ? `\n      ${detail}` : ""}`);
  }
}

function makePayload(overrides = {}) {
  return {
    noteId: "note-1",
    title: "마크다운 Export",
    createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    updatedAt: Date.UTC(2026, 1, 3, 4, 5, 6),
    exportedAt: Date.UTC(2026, 2, 4, 5, 6, 7),
    markdownBody: "# 제목\n\n본문입니다.",
    ...overrides,
  };
}

// ── 케이스 1: 파일명 sanitize ────────────────────────────────────────────────

check(
  "filename: 영문/숫자/한글은 보존하고 구분자는 하이픈으로 정리",
  createMarkdownExportFilename("  My Note! 한글 2026  ") === "my-note-한글-2026.md",
);

check(
  "filename: 빈 제목은 untitled-note.md로 fallback",
  createMarkdownExportFilename("   !!!   ") === "untitled-note.md",
);

// ── 케이스 2: frontmatter 기본 필드 ─────────────────────────────────────────

const basePayload = makePayload();
const baseDocument = buildMarkdownExportDocument(basePayload);

check("frontmatter: id 출력", baseDocument.includes('id: "note-1"'), baseDocument);
check("frontmatter: title 출력", baseDocument.includes('title: "마크다운 Export"'), baseDocument);
check(
  "frontmatter: createdAt ISO 출력",
  baseDocument.includes('createdAt: "2026-01-02T03:04:05.000Z"'),
  baseDocument,
);
check(
  "frontmatter: updatedAt ISO 출력",
  baseDocument.includes('updatedAt: "2026-02-03T04:05:06.000Z"'),
  baseDocument,
);
check(
  "frontmatter: exportedAt ISO 출력",
  baseDocument.includes('exportedAt: "2026-03-04T05:06:07.000Z"'),
  baseDocument,
);
check("frontmatter: source=ticksidian 출력", baseDocument.includes('source: "ticksidian"'), baseDocument);
check(
  "frontmatter: 기본 필드 순서 유지",
  baseDocument.startsWith(
    [
      "---",
      'id: "note-1"',
      'title: "마크다운 Export"',
      'createdAt: "2026-01-02T03:04:05.000Z"',
      'updatedAt: "2026-02-03T04:05:06.000Z"',
      'exportedAt: "2026-03-04T05:06:07.000Z"',
      'source: "ticksidian"',
      "---",
      "",
      "# 제목",
    ].join("\n"),
  ),
  baseDocument,
);

// ── 케이스 3: aliases / todo / tags 필드 ───────────────────────────────────

const todoPayload = makePayload({
  aliases: ["별칭", "alias-a"],
  type: "todo",
  done: true,
  dueDate: "2026-06-30",
  priority: "high",
  tags: ["work", "검증"],
  externalSource: "ticktick",
  externalSourceId: "task-external-1",
  importedAt: "2026-08-13T00:00:00.000Z",
});
const todoDocument = buildMarkdownExportDocument(todoPayload);

check("frontmatter: aliases 출력", todoDocument.includes('aliases: ["별칭","alias-a"]'), todoDocument);
check("frontmatter: todo type 출력", todoDocument.includes('type: "todo"'), todoDocument);
check("frontmatter: done=true 출력", todoDocument.includes("done: true"), todoDocument);
check("frontmatter: dueDate 출력", todoDocument.includes('dueDate: "2026-06-30"'), todoDocument);
check("frontmatter: priority 출력", todoDocument.includes('priority: "high"'), todoDocument);
check("frontmatter: tags 출력", todoDocument.includes('tags: ["work","검증"]'), todoDocument);
check("frontmatter: externalSource 출력", todoDocument.includes('externalSource: "ticktick"'), todoDocument);
check("frontmatter: externalSourceId 출력", todoDocument.includes('externalSourceId: "task-external-1"'), todoDocument);
check("frontmatter: importedAt 출력", todoDocument.includes('importedAt: "2026-08-13T00:00:00.000Z"'), todoDocument);

// ── 케이스 3-1: 일반 노트(type 없음)의 tags (2026-08-23 TICK-UX-007 노트 공통 태그) ──
const plainTagged = buildMarkdownExportDocument(makePayload({ tags: ["일반", "노트"] }));
check("frontmatter: type 없는 노트도 tags 출력", plainTagged.includes('tags: ["일반","노트"]'), plainTagged);
check("frontmatter: 빈 tags는 출력하지 않음", !buildMarkdownExportDocument(makePayload({ tags: [] })).includes("tags:"));

// ── 케이스 4: NBSP 끝부분 보존 ──────────────────────────────────────────────

const nbspDocument = buildMarkdownExportDocument(makePayload({
  markdownBody: "본문 끝\n\u00A0\n\n\n",
}));

check(
  "본문: 끝의 일반 개행은 정리하되 NBSP 빈 문단 마커는 보존",
  nbspDocument.endsWith("본문 끝\n\u00A0\n"),
  JSON.stringify(nbspDocument.slice(-20)),
);

// ── 케이스 5: exportNoteAsMarkdown downloader 주입 ─────────────────────────

let capturedDownload = null;
const downloadPayload = makePayload({ title: "Download / Note" });
const returnedFilename = exportNoteAsMarkdown(downloadPayload, {
  downloader(filename, document) {
    capturedDownload = { filename, document };
  },
});

check("download: 반환 filename 유지", returnedFilename === "download-note.md", returnedFilename);
check(
  "download: 주입 downloader에 filename 전달",
  capturedDownload?.filename === "download-note.md",
  JSON.stringify(capturedDownload),
);
check(
  "download: 주입 downloader에 생성 document 전달",
  capturedDownload?.document === buildMarkdownExportDocument(downloadPayload),
  capturedDownload?.document,
);

const fallbackPayload = makePayload({ title: "" });
const fallbackFilename = exportNoteAsMarkdown(fallbackPayload, {
  downloader(filename, document) {
    capturedDownload = { filename, document };
  },
});

check("download: 빈 제목 반환 filename fallback", fallbackFilename === "untitled-note.md", fallbackFilename);

console.log(`\n${assertions} assertions, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
