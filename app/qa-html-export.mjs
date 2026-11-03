// HTML Export 순수 규칙 검증기
//
// 역할
//   - lib/html-export/ 의 순수 로직을 Node에서 직접 import해 검증한다.
//   - XSS 방어, 위키링크 변환, 백링크 섹션, search-index shape, frontmatter 누수 없음을 확인한다.
//   - IO(Tauri invoke / 실 파일 쓰기)는 실행하지 않는다.
//
// 사용법
//   cd app && node --experimental-strip-types qa-html-export.mjs
//
// 주의
//   plan-export / render-note-page 는 wiki-link-index를 의존하는데,
//   wiki-link 모듈들이 내부 import에 확장자가 없어 Node ESM에서 직접 로드할 수 없다.
//   대신 QA에서 LinkIndex를 직접 만들어 planExport의 linkIndex 옵션으로 주입한다.

const { escapeHtml } = await import("./src/lib/html-export/html-escape.ts");
const { markdownToHtml } = await import("./src/lib/html-export/markdown-to-html.ts");
const { wikilinkToAnchor } = await import("./src/lib/html-export/wikilink-to-anchor.ts");
const { buildSearchIndex, serializeSearchIndexJson, serializeSearchIndexJs } = await import("./src/lib/html-export/build-search-index.ts");
const { renderNotePage } = await import("./src/lib/html-export/render-note-page.ts");
const { renderIndexPage } = await import("./src/lib/html-export/render-index-page.ts");
const { planExport } = await import("./src/lib/html-export/plan-export.ts");
const { notePageFileName } = await import("./src/lib/html-export/note-page-file-name.ts");

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

// ── 공통 픽스처 ────────────────────────────────────────────────────────────────

/** QA용 빈 LinkIndex (wiki-link-index.ts를 Node에서 직접 로드할 수 없어 수동 생성) */
function makeEmptyLinkIndex() {
  return {
    notesById: new Map(),
    noteIdsByTitleKey: new Map(),
    outgoingBySourceId: new Map(),
    backlinksByTargetId: new Map(),
  };
}

const notesMeta = [
  { noteId: "note-a", title: "알파", aliases: ["a", "alpha"], folder: "", filePath: "notes/note-a.md", updatedAt: 0 },
  { noteId: "note-b", title: "베타", aliases: [], folder: "", filePath: "notes/note-b.md", updatedAt: 0 },
];

const markdownByNoteId = {
  "note-a": "---\nid: note-a\n---\n# 알파\n\n알파 설명 텍스트입니다.",
  "note-b": "---\nid: note-b\n---\n# 베타\n\n베타 설명 텍스트입니다.",
};

// ── 케이스 1: escapeHtml 기본 동작 ─────────────────────────────────────────

check("escapeHtml: & → &amp;", escapeHtml("a & b") === "a &amp; b");
check("escapeHtml: < > → &lt; &gt;", escapeHtml("<div>") === "&lt;div&gt;");
check(
  "escapeHtml: \" ' 변환",
  escapeHtml(`say "hello" it's`) === "say &quot;hello&quot; it&#39;s",
);

// ── 케이스 2: XSS — 실행 가능 태그가 출력에 없어야 한다 ─────────────────────

const xssInput = `# 제목\n\n<img src=x onerror=alert(1)> 텍스트\n\n<script>alert('xss')</script>`;
const xssHtml = markdownToHtml(xssInput);

// onerror가 escape되어 onerror=alert(1) 형태로 실행 불가인지 확인
// "onerror" 문자열 자체는 이스케이프 후에도 남을 수 있으므로,
// 실제 실행 가능한 형태인 `<img ... onerror=` 패턴이 없는지 확인한다
check(
  "XSS: <img onerror> 실행 불가 — <img 태그 없어야 함",
  !xssHtml.includes("<img"),
  `출력: ${xssHtml.slice(0, 200)}`,
);
check(
  "XSS: <script> 태그 실행 불가 — 출력에 <script 없어야 함",
  !xssHtml.includes("<script"),
  `출력: ${xssHtml.slice(0, 200)}`,
);
check(
  "XSS: &lt; escape 확인",
  xssHtml.includes("&lt;img") || xssHtml.includes("&lt;script"),
  `출력에 &lt; escape가 있어야 한다: ${xssHtml.slice(0, 300)}`,
);

// ── 케이스 3: h1~h3 헤딩 변환 ────────────────────────────────────────────────

const headingMd = `# 제목1\n\n## 제목2\n\n### 제목3`;
const headingHtml = markdownToHtml(headingMd);

check("heading: h1 생성", headingHtml.includes("<h1>제목1</h1>"), headingHtml);
check("heading: h2 생성", headingHtml.includes("<h2>제목2</h2>"), headingHtml);
check("heading: h3 생성", headingHtml.includes("<h3>제목3</h3>"), headingHtml);

// ── 케이스 4: 리스트 변환 ────────────────────────────────────────────────────

const listMd = `- 항목 A\n- 항목 B\n\n1. 순서1\n2. 순서2`;
const listHtml = markdownToHtml(listMd);

check("list: ul 생성", listHtml.includes("<ul>"), listHtml);
check("list: ol 생성", listHtml.includes("<ol>"), listHtml);
check("list: li 항목 A", listHtml.includes("<li>항목 A</li>"), listHtml);
check("list: li 순서1", listHtml.includes("<li>순서1</li>"), listHtml);

// ── 케이스 5: 체크박스 변환 ──────────────────────────────────────────────────

const checkMd = `- [ ] 미완료 할일\n- [x] 완료 할일`;
const checkHtml = markdownToHtml(checkMd);

check(
  "checkbox: 미완료 — input[type=checkbox] disabled",
  checkHtml.includes(`<input type="checkbox" disabled>`),
  checkHtml,
);
check(
  "checkbox: 완료 — input checked",
  checkHtml.includes(`<input type="checkbox" disabled checked>`),
  checkHtml,
);

// ── 케이스 6: 코드펜스 변환 ──────────────────────────────────────────────────

const codeMd = "```js\nconsole.log('<hello>');\n```";
const codeHtml = markdownToHtml(codeMd);

check("codefence: <pre><code> 생성", codeHtml.includes("<pre>"), codeHtml);
check("codefence: 내용 escape — &lt;hello&gt;", codeHtml.includes("&lt;hello&gt;"), codeHtml);
check("codefence: XSS — <hello> 원문 없어야 함", !codeHtml.includes("<hello>"), codeHtml);

// ── 케이스 7: 위키링크 — resolved → <a> ─────────────────────────────────────

const resolvedLink = {
  sourceNoteId: "note-a", sourceFilePath: "notes/note-a.md",
  raw: "[[노트B]]", ref: "노트B", displayText: null,
  resolution: "resolved", candidateNoteIds: ["note-b"],
  targetNoteId: "note-b", targetTitle: "노트B",
};

const anchorHtml = wikilinkToAnchor(resolvedLink);
check("wikilink resolved: <a href> 생성", anchorHtml.includes('<a href="note-note-b.html"'), anchorHtml);
check("wikilink resolved: 표시 텍스트 포함", anchorHtml.includes("노트B"), anchorHtml);

// ── 케이스 8: 위키링크 — unresolved → 비활성 span ───────────────────────────

const unresolvedLink = {
  sourceNoteId: "note-a", sourceFilePath: "notes/note-a.md",
  raw: "[[없는노트]]", ref: "없는노트", displayText: null,
  resolution: "unresolved", candidateNoteIds: [], targetNoteId: null, targetTitle: null,
};

const spanHtml = wikilinkToAnchor(unresolvedLink);
check("wikilink unresolved: wiki-link-inactive span", spanHtml.includes('class="wiki-link-inactive"'), spanHtml);
check("wikilink unresolved: <a> 없어야 함", !spanHtml.includes("<a "), spanHtml);

// ── 케이스 9: 위키링크 — ambiguous → 비활성 span ────────────────────────────

const ambiguousLink = {
  ...unresolvedLink,
  raw: "[[중복제목]]", ref: "중복제목",
  resolution: "ambiguous", candidateNoteIds: ["note-x", "note-y"],
};

const ambHtml = wikilinkToAnchor(ambiguousLink);
check("wikilink ambiguous: wiki-link-inactive span", ambHtml.includes('class="wiki-link-inactive"'), ambHtml);

// ── 케이스 10: 백링크 섹션 ───────────────────────────────────────────────────

const backlinkItem = {
  targetNoteId: "note-target", sourceNoteId: "note-source",
  sourceTitle: "소스 노트", sourceFolder: "", sourceUpdatedAt: 0,
  raw: "[[타깃 노트]]", displayText: null, context: "관련 맥락 문장입니다.",
};

const notePageHtml = renderNotePage({
  noteId: "note-target",
  title: "타깃 노트",
  markdownContent: "---\nid: note-target\n---\n# 타깃 노트\n\n본문입니다.",
  outgoingLinks: [],
  backlinks: [backlinkItem],
});

check(
  "backlinks: 백링크 섹션 존재",
  notePageHtml.includes("backlinks-section"),
  notePageHtml.slice(notePageHtml.indexOf("backlink"), notePageHtml.indexOf("backlink") + 200),
);
check("backlinks: 소스 노트 링크 포함", notePageHtml.includes("note-note-source.html"), "");

// ── 케이스 11: frontmatter 본문 누수 없음 ───────────────────────────────────

const frontmatterMd = `---\nid: "note-fm"\ntitle: "테스트 노트"\naliases: ["별명"]\ncreatedAt: "2026-01-01"\n---\n# 본문 제목\n\n본문 내용입니다.`;

const fmPageHtml = renderNotePage({
  noteId: "note-fm",
  title: "테스트 노트",
  markdownContent: frontmatterMd,
  outgoingLinks: [],
  backlinks: [],
});

check(
  "frontmatter 누수: createdAt 값이 본문 HTML에 없어야 함",
  !fmPageHtml.includes("2026-01-01"),
  fmPageHtml.slice(0, 300),
);
check("frontmatter 누수: id 값이 p 태그 본문으로 없어야 함", !fmPageHtml.includes("<p>note-fm</p>"), "");

// ── 케이스 12: search-index shape ────────────────────────────────────────────

const searchEntries = buildSearchIndex(notesMeta, markdownByNoteId);

check("search-index: 항목 수 일치", searchEntries.length === 2, `${searchEntries.length}`);
check("search-index: id 필드 존재", searchEntries[0].id === "note-a", JSON.stringify(searchEntries[0]));
check("search-index: title 필드 존재", searchEntries[0].title === "알파", "");
check("search-index: aliases 필드 존재", Array.isArray(searchEntries[0].aliases), "");
check("search-index: snippet 필드 존재", typeof searchEntries[0].snippet === "string", "");
check("search-index: snippet에 frontmatter 없음", !searchEntries[0].snippet.includes("---"), searchEntries[0].snippet);

const jsonStr = serializeSearchIndexJson(searchEntries);
check(
  "search-index json: 유효한 JSON",
  (() => { try { JSON.parse(jsonStr); return true; } catch { return false; } })(),
  jsonStr.slice(0, 100),
);

const jsStr = serializeSearchIndexJs(searchEntries);
check("search-index js: window.__SEARCH_INDEX__ 포함", jsStr.startsWith("window.__SEARCH_INDEX__"), jsStr.slice(0, 80));

// ── Fix 1 검증: </script> 삽입 방어 ────────────────────────────────────────
// 노트 제목에 </script><script>alert(1)</script> 가 들어와도
// serializeSearchIndexJs 출력에 </script 시퀀스가 없어야 한다.
const xssScriptEntries = buildSearchIndex(
  [{ noteId: "xss-script", title: `</script><script>alert(1)</script>`, aliases: [], folder: "", filePath: "xss.md", updatedAt: 0 }],
  { "xss-script": "" },
);
const xssJsStr = serializeSearchIndexJs(xssScriptEntries);
check(
  "serializeSearchIndexJs XSS: </script 시퀀스 없어야 함",
  !xssJsStr.includes("</script"),
  xssJsStr.slice(0, 120),
);

// ── 케이스 13: planExport — 예상 파일 경로 생성 ──────────────────────────────

// planExport에 빈 LinkIndex를 직접 주입 (wiki-link-index 의존 우회)
const emptyLinkIndex = makeEmptyLinkIndex();

const planResult = planExport({
  notes: notesMeta,
  markdownByNoteId,
  linkIndex: emptyLinkIndex,
});

const relPaths = planResult.files.map((f) => f.relPath);

check("plan: index.html 포함", relPaths.includes("index.html"), relPaths.join(", "));
check("plan: note-a.html 포함", relPaths.some((p) => p.includes("note-note-a.html")), relPaths.join(", "));
check("plan: style.css 포함", relPaths.includes("assets/style.css"), "");
check("plan: app.js 포함", relPaths.includes("assets/app.js"), "");
check("plan: search-index.json 포함", relPaths.includes("search-index.json"), "");
check("plan: search-index.js 포함", relPaths.includes("assets/search-index.js"), "");
check("plan: .gitignore 포함", relPaths.includes(".gitignore"), "");
check("plan: noteCount == notes 수", planResult.noteCount === notesMeta.length, String(planResult.noteCount));

// ── 케이스 14: renderIndexPage — 노트 목록 렌더 ──────────────────────────────

const indexHtml = renderIndexPage({ searchEntries });
check("index page: notes-list 존재", indexHtml.includes("notes-list"), "");
check("index page: 알파 노트 링크 존재", indexHtml.includes("note-note-a.html"), indexHtml.slice(0, 300));
check("index page: search-input 존재", indexHtml.includes('id="search-input"'), "");
check("index page: data-note-id 존재", indexHtml.includes("data-note-id="), "");

// ── 케이스 15: XSS — renderNotePage에서 위험 입력 ────────────────────────────

const xssNoteHtml = renderNotePage({
  noteId: "xss-note",
  title: `<script>evil()</script>`,
  markdownContent: `---\nid: xss\n---\n# 제목\n\n<img src=x onerror=steal()>`,
  outgoingLinks: [],
  backlinks: [],
});

check(
  "XSS in title: <script> 없어야 함",
  !xssNoteHtml.includes("<script>evil()"),
  xssNoteHtml.slice(xssNoteHtml.indexOf("<title"), xssNoteHtml.indexOf("<title") + 100),
);
// 실행 가능한 형태인 <img 태그가 없는지 확인 (onerror= 은 escape 후에도 문자열로 남음)
check(
  "XSS in body: <img 활성 태그 없어야 함",
  !xssNoteHtml.includes("<img"),
  xssNoteHtml.slice(0, 500),
);

// ── 케이스 16: 실볼트 긴 한글 ID도 파일명 한계를 넘지 않는다 ────────────────

const longNoteId = "Quotio가 저장해둔 API 키를 자동으로 읽어서 “사용 가능한 모델 id”만 정렬해서 보여주는 커멘드";
const anotherLongNoteId = `${longNoteId} 2`;
const longPageFileName = notePageFileName(longNoteId);
const atomicBoundaryNoteId = "README__records%2F2026-04-07%20%ED%86%B5%ED%99%94%EB%85%B9%EC%9D%8C%20%EC%A1%B0%ED%9B%88%EC%83%81%20%EC%BC%80%EC%BC%80%EB%8C%80%ED%91%9C%EB%8B%98";
const atomicBoundaryFileName = notePageFileName(atomicBoundaryNoteId);
const atomicTempFileName = `.${atomicBoundaryFileName}.ticksidian-tmp-99999`;

check(
  "긴 ID 파일명: UTF-8 255바이트 이하",
  Buffer.byteLength(longPageFileName, "utf8") <= 255,
  `${Buffer.byteLength(longPageFileName, "utf8")} bytes: ${longPageFileName}`,
);
check(
  "원자적 쓰기 경계: 임시 파일명까지 UTF-8 255바이트 이하",
  Buffer.byteLength(atomicTempFileName, "utf8") <= 255,
  `${Buffer.byteLength(atomicTempFileName, "utf8")} bytes: ${atomicTempFileName}`,
);
check(
  "macOS 대소문자 경계: index와 INDEX 파일명이 겹치지 않음",
  notePageFileName("index").toLocaleLowerCase("en-US") !==
    notePageFileName("INDEX").toLocaleLowerCase("en-US"),
  `${notePageFileName("index")} / ${notePageFileName("INDEX")}`,
);
check(
  "긴 ID 파일명: 같은 ID는 결정적",
  notePageFileName(longNoteId) === longPageFileName,
  longPageFileName,
);
check(
  "긴 ID 파일명: 다른 ID는 충돌하지 않음",
  notePageFileName(anotherLongNoteId) !== longPageFileName,
  `${longPageFileName} / ${notePageFileName(anotherLongNoteId)}`,
);
check(
  "짧은 ID 파일명: 기존 경로 유지",
  notePageFileName("note-a") === "note-note-a.html",
  notePageFileName("note-a"),
);

const longNotesMeta = [
  { noteId: longNoteId, title: "긴 노트", aliases: [], folder: "", filePath: "long.md", updatedAt: 0 },
];
const longMarkdownByNoteId = { [longNoteId]: "# 긴 노트\n\n본문" };
const longPlan = planExport({
  notes: longNotesMeta,
  markdownByNoteId: longMarkdownByNoteId,
  linkIndex: makeEmptyLinkIndex(),
});
check(
  "긴 ID 파일명: 쓰기 계획이 공통 경로를 사용",
  longPlan.files.some((file) => file.relPath === `notes/${longPageFileName}`),
  longPlan.files.map((file) => file.relPath).join(", "),
);

const longIndexHtml = renderIndexPage({
  searchEntries: [{ id: longNoteId, title: "긴 노트", aliases: [], tags: [], snippet: "본문" }],
});
check(
  "긴 ID 파일명: index 링크가 실제 파일명과 일치",
  longIndexHtml.includes(`notes/${longPageFileName}`),
  longIndexHtml.slice(0, 500),
);

const longAnchorHtml = wikilinkToAnchor({
  ...resolvedLink,
  targetNoteId: longNoteId,
  candidateNoteIds: [longNoteId],
});
check(
  "긴 ID 파일명: 위키링크가 실제 파일명과 일치",
  longAnchorHtml.includes(`href="${longPageFileName}"`),
  longAnchorHtml,
);

const longBacklinkPageHtml = renderNotePage({
  noteId: "note-target",
  title: "타깃 노트",
  markdownContent: "# 타깃 노트",
  outgoingLinks: [],
  backlinks: [{ ...backlinkItem, sourceNoteId: longNoteId }],
});
check(
  "긴 ID 파일명: 백링크가 실제 파일명과 일치",
  longBacklinkPageHtml.includes(`href="${longPageFileName}"`),
  longBacklinkPageHtml.slice(longBacklinkPageHtml.indexOf("backlink-item"), -1),
);

// ── 결과 ───────────────────────────────────────────────────────────────────────

console.log(`\n${failures === 0 ? "ALL PASS" : "FAILURES"}: ${assertions - failures}/${assertions} passed`);
if (failures > 0) process.exit(1);
