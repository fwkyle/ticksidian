// Secrets viewer QA (보안 메모 뷰어, 2026-08-15)
//
// Given: 보안 메모 순수 파싱/마스킹 규칙.
// When: env 파일, pem 파일, 주석/빈 줄/ export 줄을 파싱한다.
// Then: env 계열은 키만 노출 대상, 값과 비 env 파일은 가림 대상이 된다.
//
// Usage:
//   cd app && node --experimental-strip-types qa-secrets-viewer.mjs

import {
  maskSecret,
  parseSecretFileContent,
} from "./src/lib/secrets-viewer/parser.ts";
import {
  buildSecretFileTree,
  collectVisibleSecretRows,
  filterSecretTree,
  collectFolderPaths,
} from "./src/lib/secrets-viewer/tree.ts";
import { buildNewSecretRelPath } from "./src/lib/secrets-viewer/create.ts";
import { isSecretExternalChangeError } from "./src/lib/secrets-viewer/edit-errors.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

{
  const envFile = `# Gemini 프로젝트 키
GEMINI_API_KEY=AIzaSy-test-key-123
export NOTION_TOKEN="secret-token-abc"

EMPTY_VALUE=
_PLAIN=no-export-form
`;
  const parsed = parseSecretFileContent(envFile);
  check("env 줄 4개를 감지한다", parsed.lines.filter((l) => l.kind === "env").length === 4);
  check("KEY= 형식을 키/값으로 분리한다", parsed.lines[1]?.kind === "env" && parsed.lines[1].key === "GEMINI_API_KEY" && parsed.lines[1].value === "AIzaSy-test-key-123");
  check("export KEY= 형식도 감지한다", parsed.lines[2]?.kind === "env" && parsed.lines[2].key === "NOTION_TOKEN");
  check("빈 값 env 줄도 env로 둔다", parsed.lines[4]?.kind === "env" && parsed.lines[4].value === "");
  check("# 주석 줄은 comment로 둔다", parsed.lines[0]?.kind === "comment");
  check("빈 줄은 가림 대상 text 줄로 둔다", parsed.lines[3]?.kind === "text" && parsed.lines[3].text === "");
  check("env 과반 파일은 envLike다", parsed.envLike === true);
}

{
  const pemFile = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB
-----END OPENSSH PRIVATE KEY-----
`;
  const parsed = parseSecretFileContent(pemFile);
  check("pem 파일은 envLike가 아니다", parsed.envLike === false);
  check("pem 본문은 전부 text 줄이다", parsed.lines.every((l) => l.kind === "text"));
}

{
  const mixed = parseSecretFileContent("그냥 문장\nAnother plain line\n");
  check("일반 텍스트 파일은 envLike가 아니다", mixed.envLike === false && mixed.lines.every((l) => l.kind === "text"));
}

{
  check("빈 파일도 파싱되고 envLike가 아니다", parseSecretFileContent("").envLike === false);
  check("마스킹은 값 길이(상한 24)만 노출한다", maskSecret("abc") === "•••" && maskSecret("a".repeat(40)).length === 24);
  check("빈 값 마스킹은 • 1개다", maskSecret("") === "•");
  check("마스킹에 원본 값이 남지 않는다", !maskSecret("super-secret-value").includes("super"));
}

// ── 폴더 트리 조립/필터 (TICK-SEC-001, 2026-08-20) ──────────────────────────

{
  const files = [
    { path: "notion.env", sizeBytes: 30, modifiedMs: 1 },
    { path: "aws/test-key.pem", sizeBytes: 40, modifiedMs: 2 },
    { path: "gemini/projects/memory-core.env", sizeBytes: 50, modifiedMs: 3 },
    { path: "gemini/legacy.env", sizeBytes: 60, modifiedMs: 4 },
  ];
  const tree = buildSecretFileTree(files);

  const folderNames = tree.filter((n) => n.kind === "folder").map((n) => n.name);
  const rootFiles = tree.filter((n) => n.kind === "file").map((n) => n.file.path);
  check("루트 폴더를 만든다(이름순)", folderNames.join(",") === "aws,gemini");
  check("루트 파일은 폴더 뒤에 둔다", rootFiles.join(",") === "notion.env");

  const gemini = tree.find((n) => n.kind === "folder" && n.name === "gemini");
  const geminiChildren = gemini && gemini.kind === "folder" ? gemini.children : [];
  const geminiSub = geminiChildren.find((n) => n.kind === "folder");
  check("2단계 중첩 폴더를 만든다", Boolean(geminiSub && geminiSub.kind === "folder" && geminiSub.name === "projects"));
  check(
    "중첩 폴더 안 파일까지 담는다",
    Boolean(geminiSub && geminiSub.kind === "folder" && geminiSub.children.some((n) => n.kind === "file" && n.file.path === "gemini/projects/memory-core.env")),
  );
  check("빈 쿼리는 트리를 그대로 둔다", filterSecretTree(tree, "").length === tree.length);
}

{
  const files = [
    { path: "aws/test-key.pem", sizeBytes: 40, modifiedMs: 2 },
    { path: "gemini/projects/memory-core.env", sizeBytes: 50, modifiedMs: 3 },
    { path: "gemini/legacy.env", sizeBytes: 60, modifiedMs: 4 },
    { path: "notion.env", sizeBytes: 30, modifiedMs: 1 },
  ];
  const tree = buildSecretFileTree(files);

  const filtered = filterSecretTree(tree, "memory");
  check("폴더 경로가 아니어도 하위 파일 매칭으로 폴더가 남는다", filtered.some((n) => n.kind === "folder" && n.name === "gemini"));
  check("매칭 없는 폴더는 사라진다", !filtered.some((n) => n.kind === "folder" && n.name === "aws"));
  check("매칭 없는 루트 파일은 사라진다", !filtered.some((n) => n.kind === "file" && n.file.path === "notion.env"));

  const gemini = filtered.find((n) => n.kind === "folder" && n.name === "gemini");
  check(
    "폴더 matchCount는 하위 매칭 파일 수다",
    Boolean(gemini && gemini.kind === "folder" && gemini.matchCount === 1),
  );

  const byFolderName = filterSecretTree(tree, "gemini");
  const geminiByName = byFolderName.find((n) => n.kind === "folder" && n.name === "gemini");
  check(
    "폴더 이름 매칭은 하위 파일 전부를 매칭으로 친다",
    Boolean(geminiByName && geminiByName.kind === "folder" && geminiByName.matchCount === 2),
  );
  check("필터는 대소문자를 무시한다", filterSecretTree(tree, "MEMORY").length === filterSecretTree(tree, "memory").length);
}

// ── 새 메모 경로 조립 + 외부 변경 에러 판정 (TICK-SEC-002, 2026-08-20) ───────

{
  check("루트 파일 경로를 조립한다", buildNewSecretRelPath("", "a.env") === "a.env");
  check("폴더+파일명을 조립한다", buildNewSecretRelPath("oci", "key.env") === "oci/key.env");
  check("폴더 양쪽 공백을 정리한다", buildNewSecretRelPath(" oci ", "key.env") === "oci/key.env");
  check("빈/공백 파일명은 거부다", buildNewSecretRelPath("oci", "  ") === null);
  check("슬래시 포함 파일명은 거부다", buildNewSecretRelPath("oci", "a/b.env") === null);
  check("백슬래시 포함 파일명은 거부다", buildNewSecretRelPath("oci", "a\\b.env") === null);
  check("dot 세그먼트 파일명은 거부다", buildNewSecretRelPath("", "..") === null);

  const files = [
    { path: "notion.env", sizeBytes: 30, modifiedMs: 1 },
    { path: "aws/test-key.pem", sizeBytes: 40, modifiedMs: 2 },
    { path: "gemini/projects/memory-core.env", sizeBytes: 50, modifiedMs: 3 },
  ];
  check(
    "폴더 옵션은 중첩 폴더까지 pre-order로 수집한다",
    JSON.stringify(collectFolderPaths(buildSecretFileTree(files))) === JSON.stringify(["aws", "gemini", "gemini/projects"]),
  );
}

{
  check(
    "Rust 코드 객체(secretModifiedExternally)를 판정한다",
    isSecretExternalChangeError({ code: "secretModifiedExternally", message: "파일이 열려 있는 동안 외부에서 바뀌었습니다: a.env" }),
  );
  check(
    "fixture Error 메시지로도 판정한다",
    isSecretExternalChangeError(new Error("파일이 열려 있는 동안 외부에서 바뀌었습니다: a.env")),
  );
  check("문자열 메시지로도 판정한다", isSecretExternalChangeError("파일이 열려 있는 동안 외부에서 바뀌었습니다: a.env"));
  check("무관 io 에러는 false다", !isSecretExternalChangeError(new Error("io error: No such file")));
  check("다른 코드 객체는 false다", !isSecretExternalChangeError({ code: "io", message: "x" }));
  check("null/undefined는 false다", !isSecretExternalChangeError(null) && !isSecretExternalChangeError(undefined));
}

// 펼친 행의 순서/깊이와 전체 결과 보존: UI 페이지 경계 밖의 파일도 검색 대상이다.
{
  const files = Array.from({ length: 77117 }, (_, i) => ({
    path: `archive/group/file-${String(i).padStart(5, "0")}.env`, sizeBytes: 4, modifiedMs: 1,
  }));
  const tree = buildSecretFileTree(files);
  const closed = collectVisibleSecretRows(tree, new Set(), false);
  check("접힌 폴더 안 77117개 파일은 표시 행을 만들지 않는다", closed.length === 1);
  const partial = collectVisibleSecretRows(tree, new Set(["archive"]), false);
  check("펼친 조상만 모으고 깊이를 보존한다", partial.length === 2 && partial[1].depth === 1);
  const all = collectVisibleSecretRows(filterSecretTree(tree, "a"), new Set(), true);
  check("검색 결과 전체를 보존한다", all.length === 77119);
  const last = collectVisibleSecretRows(filterSecretTree(tree, "FILE-77116"), new Set(), true);
  check("페이지 밖 마지막 파일도 찾는다", last.length === 3 && last[2].depth === 2
    && last[2].node.kind === "file" && last[2].node.file.path === files.at(-1).path);
}

const result = summary();
console.log(`\n${result.assertions} assertions, ${result.failures} failures`);
if (result.failures > 0) process.exit(1);
