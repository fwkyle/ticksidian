// Review queue QA (TICK-P0-007 검토 큐 UI 1차)
//
// Given: 검토 큐 순수 규칙, store 기반 operations, fixture 스냅샷 50개.
// When: 분류 정규화, 스냅샷 가져오기, 사용자 분류/상태 변경, 손상 파일 복구를 실행한다.
// Then: 중복 방지 계약과 사용자 변경 보존 계약이 유지된다.
//
// Usage:
//   cd app && node --experimental-strip-types qa-review-queue.mjs

import {
  REVIEW_QUEUE_DIR,
  applyCardStatus,
  applyConversion,
  applyUserClassification,
  buildCaptureSnapshotItem,
  confidenceLabel,
  displayClassification,
  isConvertibleCard,
  mergeSnapshotCards,
  normalizeClassification,
  normalizeConfidence,
  normalizeSnapshotItem,
  noteTargetForCard,
  parseReviewQueueFile,
  resolveReviewQueueFilePath,
  serializeReviewQueueFile,
  toReviewNoteId,
  toSourceKey,
} from "./src/lib/review-queue/rules.ts";
import { createReviewQueueOperations } from "./src/lib/review-queue/operations.ts";
import {
  CLASSIFICATION_NOTE_TARGETS,
  CONVERTIBLE_CLASSIFICATIONS,
  REVIEW_CAPTURE_SOURCE,
  REVIEW_CLASSIFICATIONS,
} from "./src/lib/review-queue/types.ts";
import { REVIEW_SNAPSHOT_FIXTURE } from "./src/lib/review-queue/fixture-snapshot.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";
import {
  pickVaultNoteCandidates,
  VAULT_NOTE_DAILY_LIMIT,
} from "./src/lib/review-queue/vault-note-candidates.ts";

const { check, expectResolve, summary } = createReporter();

const NOW = "2026-08-15T00:00:00.000Z";
const fixedRuntime = { now: () => NOW };

function snapshotItem(overrides = {}) {
  return {
    source: "ticktick-local-snapshot",
    sourceId: "id-1",
    title: "제목",
    safeContent: "내용",
    projectName: "기본함",
    safetyAction: "agent-review-allowed",
    suggestion: { classification: "실행", reason: "이유", confidence: 0.8 },
    ...overrides,
  };
}

// ── Fake store (vault 안 파일만 다루는 메모리 구현) ──────────────────────────

class FakeReviewQueueStore {
  constructor(vaultPath = "/vault") {
    this.vaultPath = vaultPath;
    this.files = new Map();
    this.createDirectoryCalls = [];
    this.writeCalls = [];
  }
  getVaultPath() {
    return this.vaultPath;
  }
  async createDirectory(dirPath, recursive) {
    this.createDirectoryCalls.push({ dirPath, recursive });
  }
  async readTextFile(path) {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing file: ${path}`);
    return content;
  }
  async writeTextFile(path, content) {
    this.writeCalls.push({ path, content });
    this.files.set(path, content);
  }
}

// ── 1. 분류 체계 ────────────────────────────────────────────────────────────

{
  check(
    "분류 7종이 정확히 정의된다 (보류 없음, 일반 메모 포함)",
    JSON.stringify([...REVIEW_CLASSIFICATIONS]) ===
      JSON.stringify(["실행", "아이디어", "참고", "일반 메모", "중복 의심", "정리 후보", "수동 검토"]),
  );
  check("과거 분류 보류는 일반 메모로 정규화된다", normalizeClassification("보류") === "일반 메모");
  check("현재 분류는 그대로 통과한다", normalizeClassification("실행") === "실행");
  check("알 수 없는 분류는 null이다", normalizeClassification("없는분류") === null);
  check("확신 값은 0..1로 묶인다", normalizeConfidence(1.7) === 1 && normalizeConfidence(-3) === 0 && normalizeConfidence(Number.NaN) === 0);
  check("확신 단계: 0.85 높음, 0.5 중간, 0.3 낮음", confidenceLabel(0.85) === "높음" && confidenceLabel(0.5) === "중간" && confidenceLabel(0.3) === "낮음");
}

// ── 2. 경로/키 규칙 ─────────────────────────────────────────────────────────

{
  check("큐 파일 경로는 볼트 안 .ticksidian-review-queue/queue.json이다", resolveReviewQueueFilePath("/vault") === `/vault/${REVIEW_QUEUE_DIR}/queue.json`);
  let threw = false;
  try {
    resolveReviewQueueFilePath(null);
  } catch {
    threw = true;
  }
  check("볼트 없이는 경로 계산이 실패한다", threw);
  check("sourceKey는 source:sourceId 형태다", toSourceKey("ticktick-local-snapshot", "abc") === "ticktick-local-snapshot:abc");
}

// ── 3. 스냅샷 정규화 ────────────────────────────────────────────────────────

{
  const card = normalizeSnapshotItem(snapshotItem(), NOW);
  check("정상 항목은 대기 상태 카드가 된다", card !== null && card.status === "pending" && card.userClassification === null && card.decidedAt === null);
  check("카드 sourceKey는 원본 기준으로 만들어진다", card.sourceKey === "ticktick-local-snapshot:id-1");

  const legacy = normalizeSnapshotItem(snapshotItem({ suggestion: { classification: "보류", reason: "r", confidence: 0.4 } }), NOW);
  check("스냅샷의 보류 분류는 일반 메모로 바뀐다", legacy !== null && legacy.suggestion.classification === "일반 메모");

  check("빈 제목 항목은 버려진다", normalizeSnapshotItem(snapshotItem({ title: "  " }), NOW) === null);
  check("알 수 없는 분류 항목은 버려진다", normalizeSnapshotItem(snapshotItem({ suggestion: { classification: "??", reason: "r", confidence: 0.5 } }), NOW) === null);
  const clamped = normalizeSnapshotItem(snapshotItem({ suggestion: { classification: "실행", reason: "r", confidence: 5 } }), NOW);
  check("확신 5는 1로 묶인다", clamped !== null && clamped.suggestion.confidence === 1);
}

// ── 4. 저장 파일 파싱 ───────────────────────────────────────────────────────

{
  const card = normalizeSnapshotItem(snapshotItem(), NOW);
  const serialized = serializeReviewQueueFile({ schemaVersion: 1, cards: [card] });
  const parsed = parseReviewQueueFile(serialized);
  check("직렬화/파싱 round-trip이 일치한다", parsed !== null && parsed.cards.length === 1 && parsed.cards[0].sourceKey === card.sourceKey);

  check("깨진 JSON은 null이다", parseReviewQueueFile("{oops") === null);
  check("스키마 버전이 다르면 null이다", parseReviewQueueFile(JSON.stringify({ schemaVersion: 2, cards: [] })) === null);
  check("cards가 배열이 아니면 null이다", parseReviewQueueFile(JSON.stringify({ schemaVersion: 1, cards: {} })) === null);

  const withBadCard = serializeReviewQueueFile({ schemaVersion: 1, cards: [{ garbage: true }, card] });
  const parsedWithBad = parseReviewQueueFile(withBadCard);
  check("깨진 카드 1개만 버리고 나머지는 살린다", parsedWithBad !== null && parsedWithBad.cards.length === 1);

  const dupCards = serializeReviewQueueFile({ schemaVersion: 1, cards: [card, { ...card }] });
  const parsedDup = parseReviewQueueFile(dupCards);
  check("파일 안 중복 sourceKey는 1개만 남는다", parsedDup !== null && parsedDup.cards.length === 1);
}

// ── 5. 재가져오기 중복 방지 + 사용자 변경 보존 ───────────────────────────────

{
  const cardA = normalizeSnapshotItem(snapshotItem(), NOW);
  const cardB = normalizeSnapshotItem(snapshotItem({ sourceId: "id-2", title: "B" }), NOW);

  const first = mergeSnapshotCards([], [cardA, cardB]);
  check("첫 가져오기는 2개를 추가한다", first.cards.length === 2 && first.summary.addedCount === 2);

  const again = mergeSnapshotCards(first.cards, [cardA, cardB]);
  check("같은 스냅샷 재가져오기는 카드를 늘리지 않는다", again.cards.length === 2 && again.summary.addedCount === 0 && again.summary.unchangedCount === 2);

  const userEdited = applyUserClassification(applyCardStatus(first.cards[0], "approved", NOW), "참고", NOW);
  const afterUser = mergeSnapshotCards([userEdited, first.cards[1]], [cardA, cardB]);
  check("재가져오기가 사용자 분류를 덮어쓰지 않는다", afterUser.cards[0].userClassification === "참고");
  check("재가져오기가 승인 상태를 덮어쓰지 않는다", afterUser.cards[0].status === "approved" && afterUser.cards[0].decidedAt === NOW);

  const changedSuggestion = normalizeSnapshotItem(
    snapshotItem({ suggestion: { classification: "아이디어", reason: "바뀐 이유", confidence: 0.6 } }),
    NOW,
  );
  const afterChange = mergeSnapshotCards(first.cards, [changedSuggestion, cardB]);
  check("제안이 바뀐 항목은 갱신으로 센다", afterChange.summary.updatedCount === 1 && afterChange.summary.unchangedCount === 1);
  check("제안 갱신은 suggestion에 반영된다", afterChange.cards[0].suggestion.classification === "아이디어");

  const newCard = normalizeSnapshotItem(snapshotItem({ sourceId: "id-3", title: "C" }), NOW);
  const grown = mergeSnapshotCards(first.cards, [newCard]);
  check("새 원본은 뒤에 붙고 기존 순서는 유지된다", grown.cards.length === 3 && grown.cards[2].sourceKey === newCard.sourceKey && grown.cards[0].sourceKey === cardA.sourceKey);
}

// ── 6. 카드 변경 규칙 ───────────────────────────────────────────────────────

{
  const card = normalizeSnapshotItem(snapshotItem(), NOW);
  check("표시 분류 기본은 제안을 따른다", displayClassification(card) === "실행");
  const overridden = applyUserClassification(card, "수동 검토", NOW);
  check("사용자 분류가 표시를 바꾼다", displayClassification(overridden) === "수동 검토");
  const restored = applyUserClassification(overridden, null, NOW);
  check("제안 복원은 사용자 분류를 null로 되돌린다", displayClassification(restored) === "실행" && restored.userClassification === null);

  const approved = applyCardStatus(card, "approved", NOW);
  const later = applyCardStatus(card, "later", NOW);
  const pending = applyCardStatus(approved, "pending", NOW);
  check("승인과 나중에 보기는 다른 상태다", approved.status === "approved" && later.status === "later");
  check("승인/나중에 모두 결정 시각이 찍힌다", approved.decidedAt === NOW && later.decidedAt === NOW);
  check("대기로 되돌리면 결정 시각이 지워진다", pending.status === "pending" && pending.decidedAt === null);
}

// ── 7. operations (store 기반) ──────────────────────────────────────────────

{
  const store = new FakeReviewQueueStore();
  const operations = createReviewQueueOperations({ store, runtime: fixedRuntime });
  const queuePath = `/vault/${REVIEW_QUEUE_DIR}/queue.json`;

  await expectResolve("빈 볼트에서 loadQueue는 빈 배열을 반환한다", async () => {
    const loaded = await operations.loadQueue();
    check("빈 볼트 loadQueue = []", loaded.length === 0);
  });

  const imported = await operations.importSnapshot([snapshotItem(), snapshotItem({ sourceId: "id-2" })]);
  check("importSnapshot은 2개를 추가한다", imported.summary.addedCount === 2 && imported.cards.length === 2);
  check("큐 파일은 볼트 안에 쓰인다", store.files.has(queuePath));
  check("디렉터리 생성은 재귀로 요청된다", store.createDirectoryCalls.some((c) => c.dirPath === `/vault/${REVIEW_QUEUE_DIR}` && c.recursive === true));
  check("모든 쓰기는 볼트 경로 안에서만 일어난다", store.writeCalls.every((c) => c.path.startsWith("/vault/")));

  await operations.setClassification("ticktick-local-snapshot:id-1", "참고");
  await operations.setCardStatus("ticktick-local-snapshot:id-1", "approved");
  const afterDecide = await operations.loadQueue();
  check("분류와 승인 상태가 디스크에 유지된다", afterDecide[0].userClassification === "참고" && afterDecide[0].status === "approved");

  const reimported = await operations.importSnapshot([snapshotItem(), snapshotItem({ sourceId: "id-2" })]);
  check("재가져오기 후에도 카드는 2개다 (중복 0)", reimported.cards.length === 2 && reimported.summary.addedCount === 0);
  check("재가져오기 후에도 사용자 변경이 보존된다", reimported.cards[0].userClassification === "참고" && reimported.cards[0].status === "approved");

  await operations.setCardStatus("ticktick-local-snapshot:id-2", "later");
  check("나중에 보기 상태가 저장된다", (await operations.loadQueue())[1].status === "later");

  // 손상 파일 fail-safe: 빈 큐로 재시작, 원복 불필요
  store.files.set(queuePath, "<<<corrupted>>>");
  const afterCorruption = await operations.loadQueue();
  check("손상 파일은 빈 큐로 재시작한다", afterCorruption.length === 0);

  const afterRecover = await operations.importSnapshot([snapshotItem()]);
  check("손상 후 재가져오기로 새 큐가 만들어진다", afterRecover.summary.addedCount === 1 && afterRecover.cards.length === 1);
}

// ── 8. fixture 스냅샷 무결성 ────────────────────────────────────────────────

{
  check("fixture는 50개다", REVIEW_SNAPSHOT_FIXTURE.length === 50);
  const sourceKeys = REVIEW_SNAPSHOT_FIXTURE.map((item) => toSourceKey(item.source, item.sourceId));
  check("fixture 원본 ID는 모두 유일하다 (중복 방지 전제)", new Set(sourceKeys).size === 50);
  check("fixture에 과거 분류 보류가 남아 있지 않다", REVIEW_SNAPSHOT_FIXTURE.every((item) => item.suggestion.classification !== "보류"));
  check("fixture 분류는 모두 현재 7종 안에 있다", REVIEW_SNAPSHOT_FIXTURE.every((item) => normalizeClassification(item.suggestion.classification) !== null));
  const manualOnly = REVIEW_SNAPSHOT_FIXTURE.filter((item) => item.safetyAction === "manual-review-only");
  check("수동 검토 전용(자동 처리 금지) 항목이 존재한다", manualOnly.length > 0);
  check("fixture 확신은 모두 0..1이다", REVIEW_SNAPSHOT_FIXTURE.every((item) => item.suggestion.confidence >= 0 && item.suggestion.confidence <= 1));

  // fixture 전체를 실제 연산에 통과시켜 본다
  const store = new FakeReviewQueueStore();
  const operations = createReviewQueueOperations({ store, runtime: fixedRuntime });
  const result = await operations.importSnapshot(REVIEW_SNAPSHOT_FIXTURE);
  check("fixture 50개 가져오기가 카드 50개를 만든다", result.cards.length === 50 && result.summary.addedCount === 50);
  const again = await operations.importSnapshot(REVIEW_SNAPSHOT_FIXTURE);
  check("fixture 재가져오기는 중복 카드를 만들지 않는다", again.cards.length === 50 && again.summary.addedCount === 0);
  check("fixture 재가져오기는 전부 동일 항목으로 센다", again.summary.unchangedCount === 50);
}

// ── 9. 2차 변환 규칙 (승인 항목 → 노트/투두) ────────────────────────────────

{
  check("변환 가능 분류는 4종이다", JSON.stringify([...CONVERTIBLE_CLASSIFICATIONS]) === JSON.stringify(["실행", "아이디어", "참고", "일반 메모"]));
  check("변환 비대상 3종은 매핑에 없다", ["중복 의심", "정리 후보", "수동 검토"].every((c) => !(c in CLASSIFICATION_NOTE_TARGETS)));
  check("실행은 투두 + notes/실행 폴더다 (2026-08-16 볼트 전체 스캔 후 notes/ 명시)",
    CLASSIFICATION_NOTE_TARGETS["실행"].kind === "todo" && CLASSIFICATION_NOTE_TARGETS["실행"].folder === "notes/실행");
  check("아이디어/참고는 일반 노트다", CLASSIFICATION_NOTE_TARGETS["아이디어"].kind === "note" && CLASSIFICATION_NOTE_TARGETS["참고"].kind === "note");
  check("일반 메모는 notes/메모 폴더 노트다", CLASSIFICATION_NOTE_TARGETS["일반 메모"].folder === "notes/메모" && CLASSIFICATION_NOTE_TARGETS["일반 메모"].kind === "note");
  check("변환 폴더는 전부 notes/ 아래다 — 볼트 루트를 어지럽히지 않는다",
    Object.values(CLASSIFICATION_NOTE_TARGETS).every((t) => t.folder.startsWith("notes/")));

  check("노트 ID는 ticktick-{원본ID} 규칙을 따른다", toReviewNoteId("ticktick-local-snapshot", "example-001") === "ticktick-example-001");
  check("캡처 source의 노트 ID는 capture- 접두다", toReviewNoteId(REVIEW_CAPTURE_SOURCE, "abc-123") === "capture-abc-123");
  const fallback1 = toReviewNoteId("ticktick-local-snapshot", "위험/경로;id");
  const fallback2 = toReviewNoteId("ticktick-local-snapshot", "위험/경로;id");
  check("불안전 원본 ID는 결정적 폴백 해시로 대체된다", fallback1.startsWith("ticktick-") && fallback1 === fallback2 && !fallback1.includes("/"));

  const card = normalizeSnapshotItem(snapshotItem(), NOW);
  check("대기 상태는 변환할 수 없다", !isConvertibleCard(card));
  const approved = applyCardStatus(card, "approved", NOW);
  check("승인 + 변환 가능 분류 + 미변환이면 변환할 수 있다", isConvertibleCard(approved));

  const target = noteTargetForCard(approved);
  check("변환 대상은 표시 분류를 따른다", target !== null && target.kind === "todo" && target.folder === "notes/실행" && target.noteId === "ticktick-id-1");

  const converted = applyConversion(approved, { noteId: target.noteId, noteFolder: target.folder, noteKind: target.kind, convertedAt: NOW, preexisting: false }, NOW);
  check("변환된 카드는 재변환 대상이 아니다", !isConvertibleCard(converted) && converted.conversion.noteId === "ticktick-id-1" && converted.conversion.preexisting === false);

  const overridden = applyUserClassification(applyCardStatus(card, "approved", NOW), "수동 검토", NOW);
  check("변환 비대상 분류는 승인돼도 변환할 수 없다", !isConvertibleCard(overridden));

  // 변환 상태는 재가져오기로 보존된다
  const afterReimport = mergeSnapshotCards([converted], [card]);
  check("재가져오기가 변환 기록을 덮어쓰지 않는다", afterReimport.cards[0].conversion !== null && afterReimport.cards[0].conversion.noteId === "ticktick-id-1");

  // 큐 파일 round-trip에 conversion이 포함된다
  const roundTripped = parseReviewQueueFile(serializeReviewQueueFile({ schemaVersion: 1, cards: [converted] }));
  check("conversion은 큐 파일 round-trip에서 유지된다", roundTripped !== null && roundTripped.cards[0].conversion !== null && roundTripped.cards[0].conversion.noteKind === "todo");

  const brokenConversion = parseReviewQueueFile(
    JSON.stringify({ schemaVersion: 1, cards: [{ ...converted, conversion: { garbage: true } }] }),
  );
  check("깨진 conversion은 null로 내려가고 카드는 살린다", brokenConversion !== null && brokenConversion.cards[0].conversion === null);

  // operations.applyConversion 저장 확인
  const store = new FakeReviewQueueStore();
  const operations = createReviewQueueOperations({ store, runtime: fixedRuntime });
  await operations.importSnapshot([snapshotItem()]);
  await operations.setCardStatus("ticktick-local-snapshot:id-1", "approved");
  const afterOp = await operations.applyConversion("ticktick-local-snapshot:id-1", { noteId: "ticktick-id-1", noteFolder: "실행", noteKind: "todo", convertedAt: NOW, preexisting: true });
  check("operations.applyConversion이 큐에 기록된다", afterOp[0].conversion !== null && afterOp[0].conversion.preexisting === true);
  const reloaded = await operations.loadQueue();
  check("변환 기록은 디스크에서 유지된다", reloaded[0].conversion.noteFolder === "실행");
}

// ── 10. 3차 캡처 → AI 분류 규칙 ─────────────────────────────────────────────

{
  const item = buildCaptureSnapshotItem(
    { title: "  새 아이디어 메모  ", content: " 내용 " },
    { classification: "아이디어", reason: "구상 단계", confidence: 0.9 },
    "cap-1",
  );
  check("캡처 항목은 ticksidian-capture source를 쓴다", item.source === REVIEW_CAPTURE_SOURCE);
  check("캡처 항목 제목/내용은 trim된다", item.title === "새 아이디어 메모" && item.safeContent === "내용");
  check("캡처 항목은 importSnapshot을 통과해 카드가 된다", normalizeSnapshotItem(item, NOW) !== null);

  const card = normalizeSnapshotItem(item, NOW);
  check("캡처 카드의 변환 노트 ID는 capture- 접두다", noteTargetForCard(applyCardStatus(card, "approved", NOW)) !== null && noteTargetForCard(applyCardStatus(card, "approved", NOW)).noteId === "capture-cap-1");

  const invalid = buildCaptureSnapshotItem(
    { title: "t", content: "" },
    { classification: "???", reason: "r", confidence: 5 },
    "cap-2",
  );
  check("알 수 없는 분류는 수동 검토로 fail-closed된다", invalid.suggestion.classification === "수동 검토");
  check("범위 밖 확신은 1로 묶인다", invalid.suggestion.confidence === 1);

  // 캡처 카드도 중복 방지/보존 계약을 그대로 탄다
  const store = new FakeReviewQueueStore();
  const operations = createReviewQueueOperations({ store, runtime: fixedRuntime });
  await operations.importSnapshot([item]);
  await operations.importSnapshot([item]);
  const loaded = await operations.loadQueue();
  check("같은 캡처 항목 재추가는 카드를 늘리지 않는다", loaded.length === 1);
}

// ── 2026-08-30 단계 2: vault-note 후보 선정 규칙 ─────────────────────────
{
  const NOW = new Date("2026-08-30T12:00:00.000Z");
  const item = (title, extra = {}) => ({
    id: title,
    fileBasename: `${title}.md`,
    filePath: `notes/${title}.md`,
    folder: "notes",
    title,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...extra,
  });
  const old = item("오래된 노트", { updatedAt: new Date("2026-03-01T00:00:00.000Z") }); // 182일 전
  const temp = item("QA-발표-임시"); // 임시 흔적
  const fresh = item("어제 쓴 노트", { updatedAt: new Date("2026-08-28T00:00:00.000Z") });
  const todo = item("완료된 투두", { type: "todo" });
  const drawing = item("그림", { drawing: true });
  const archived = item("보관 감", { folder: "archive", filePath: "archive/보관 감.md" });

  check("stale: 90일 이상 미수정 노트가 후보다",
    pickVaultNoteCandidates([old], new Set(), NOW).length === 1);
  check("temp: 임시 흔적 제목이 최근 노트여도 후보다",
    pickVaultNoteCandidates([temp], new Set(), NOW).length === 1);
  check("최근 수정한 노트·투두·그림·보관 노트는 후보가 아니다",
    pickVaultNoteCandidates([fresh, todo, drawing, archived], new Set(), NOW).length === 0);
  check("이미 큐에 있는 키는 다시 뽑지 않는다",
    pickVaultNoteCandidates([old], new Set(["vault-note:notes/오래된 노트.md"]), NOW).length === 0);

  const many = Array.from({ length: 30 }, (_, i) =>
    item(`임시${String(i).padStart(2, "0")}`));
  check("하루 상한(10장)을 넘지 않는다",
    pickVaultNoteCandidates(many, new Set(), NOW).length === VAULT_NOTE_DAILY_LIMIT);

  const [candidate] = pickVaultNoteCandidates([old], new Set(), NOW);
  check("후보는 vault-note 소스 + reviewReason을 가진다",
    candidate.source === "vault-note" && candidate.reviewReason.length > 0);
  check("후보 제안은 AI가 아니다(정리 후보, confidence 0)",
    candidate.suggestion.classification === "정리 후보" && candidate.suggestion.confidence === 0);

  // normalize → origin 유도까지 파이프라인 확인
  const normalized = normalizeSnapshotItem(candidate, NOW.toISOString());
  check("가져오면 origin이 vault-note로 유도된다",
    normalized !== null && normalized.origin === "vault-note" && normalized.reviewReason.length > 0);
}

const result = summary();
console.log(`\n${result.assertions} assertions, ${result.failures} failures`);
if (result.failures > 0) process.exit(1);
