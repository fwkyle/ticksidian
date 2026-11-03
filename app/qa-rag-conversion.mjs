// GLM-5.2 결함1 회귀: RAG Rust camelCase 직렬화 계약 변환.
// Rust(src-tauri rag)는 serde(rename_all="camelCase")로 보내므로, 프론트 변환이
// camelCase 원형을 그대로 받아야 한다 (과거 snake_case 가정 회귀 방지).
const { toRagIndexStatus, toRagSearchHit } = await import("./src/lib/rag-conversion.ts");

let assertions = 0;
let failures = 0;
function check(label, cond, detail) {
  assertions += 1;
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? " " + detail : ""}`);
  }
}

// Rust가 보내는 camelCase 원형
const rawStatus = {
  exists: true,
  indexComplete: true,
  embeddingModel: "gemini-embedding-001",
  embeddingDimensions: 768,
  documentCount: 12,
  chunkCount: 30,
  builtAt: "2026-08-14T00:00:00.000Z",
};
const status = toRagIndexStatus(rawStatus);
check("camelCase indexComplete 보존", status.indexComplete === true, `(got ${status.indexComplete})`);
check("camelCase embeddingModel 보존", status.embeddingModel === "gemini-embedding-001");
check("camelCase embeddingDimensions 보존", status.embeddingDimensions === 768);
check("camelCase documentCount 보존", status.documentCount === 12);
check("camelCase chunkCount 보존", status.chunkCount === 30);
check("camelCase builtAt 보존", status.builtAt === "2026-08-14T00:00:00.000Z");

// 회귀: snake_case 키가 들어오면 값이 undefined여야 한다 (snake_case 가정 금지).
const snake = toRagIndexStatus({
  exists: true,
  index_complete: true,
  embedding_model: "x",
  embedding_dimensions: 1,
  document_count: 1,
  chunk_count: 1,
  built_at: "y",
});
check("snake_case index_complete는 매핑 안 됨(undefined)", snake.indexComplete === undefined);
check("snake_case document_count는 매핑 안 됨(undefined)", snake.documentCount === undefined);

const rawHit = { filePath: "notes/a.md", title: "A", heading: "h", preview: "p", sources: ["fts5", "sqlite-vec"], score: 0.5 };
const hit = toRagSearchHit(rawHit);
check("camelCase filePath 보존", hit.filePath === "notes/a.md", `(got ${hit.filePath})`);
check("camelCase title 보존", hit.title === "A");
check("camelCase sources 보존", Array.isArray(hit.sources) && hit.sources.length === 2);
check("camelCase score 보존", hit.score === 0.5);

// 회귀: snake_case file_path 는 undefined
const snakeHit = toRagSearchHit({ file_path: "notes/a.md", title: "A", heading: "", preview: "", sources: [], score: 0 });
check("snake_case file_path는 매핑 안 됨(undefined)", snakeHit.filePath === undefined);

if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
console.log(`qa-rag-conversion: ${assertions} assertions PASS`);

