/**
 * qa-excalidraw-document.mjs — Excalidraw 그림 문서 순수 규칙 QA (2026-08-23 TICK-DRAW-001).
 *
 * 설계: docs/waterfall/03-상세설계/엑스칼리드로우-그림-편집.md §2
 * Why: 이 작업의 잠긴 목표는 **포맷 왕복 보존**이다. excalidraw.com이 만든 원본을
 * 우리 앱이 열고 저장해도 글자까지 같아야 하고, 우리가 모르는 키도 사라지면 안 된다.
 */

const {
  EXCALIDRAW_PERSISTED_APP_STATE_KEYS,
  EXCALIDRAW_VOLATILE_ELEMENT_KEYS,
  hasMeaningfulExcalidrawChange,
  buildExcalidrawSaveDocument,
  drawingTitleFromFileName,
  isRawExcalidrawPath,
  parseExcalidrawDocument,
} = await import("./src/lib/excalidraw-document.ts");

let assertions = 0;
let failures = 0;
function check(label, ok, detail) {
  assertions += 1;
  if (ok) console.log(`PASS  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

// [kyle] 실볼트 `바이브코딩 구조.excalidraw`와 같은 모양(2026-08-23 실측):
// 최상위 type/version/source/elements/appState/files, 2칸 들여쓰기, 끝 개행.
const ORIGINAL = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [{ id: "a1", type: "rectangle", x: 10, y: 20 }],
  appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
  files: {},
}, null, 2) + "\n";

// ── 경로 판정 ───────────────────────────────────────────────────────────────
{
  check("isRawExcalidrawPath: .excalidraw는 참", isRawExcalidrawPath("a/b/그림.excalidraw"));
  check("isRawExcalidrawPath: 대소문자 무시", isRawExcalidrawPath("X.EXCALIDRAW"));
  check("isRawExcalidrawPath: 플러그인 .excalidraw.md는 거짓(보호 대상 유지)",
    !isRawExcalidrawPath("kimaki-system.excalidraw.md"));
  check("isRawExcalidrawPath: 일반 .md는 거짓", !isRawExcalidrawPath("note.md"));
  check("drawingTitleFromFileName: 확장자를 뗀다",
    drawingTitleFromFileName("바이브코딩 구조.excalidraw") === "바이브코딩 구조");
}

// ── 파싱 ────────────────────────────────────────────────────────────────────
{
  const parsed = parseExcalidrawDocument(ORIGINAL);
  check("parse: 정상 문서를 읽는다", parsed.ok === true);
  check("parse: elements/appState/files를 준다",
    parsed.ok && parsed.elements.length === 1 && parsed.appState.viewBackgroundColor === "#ffffff"
    && typeof parsed.files === "object");
  check("parse: 깨진 JSON은 실패", parseExcalidrawDocument("{not json").ok === false);
  check("parse: type이 excalidraw가 아니면 실패",
    parseExcalidrawDocument(JSON.stringify({ type: "other", elements: [] })).ok === false);
  check("parse: elements가 배열이 아니면 실패",
    parseExcalidrawDocument(JSON.stringify({ type: "excalidraw", elements: 3 })).ok === false);
  check("parse: 빈 문자열은 실패", parseExcalidrawDocument("").ok === false);
}

// ── 왕복 보존 (이 작업의 잠긴 목표) ─────────────────────────────────────────
{
  const parsed = parseExcalidrawDocument(ORIGINAL);
  const rebuilt = buildExcalidrawSaveDocument({
    original: parsed.original,
    elements: parsed.elements,
    appState: parsed.appState,
    files: parsed.files,
  });
  check("왕복: 표준 2칸 원본이면 글자까지 같다", rebuilt === ORIGINAL,
    `기대:\n${JSON.stringify(ORIGINAL)}\n실제:\n${JSON.stringify(rebuilt)}`);
}

// ── 원본 필드 보존 ──────────────────────────────────────────────────────────
{
  const withUnknown = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: [],
    appState: { gridSize: 20, viewBackgroundColor: "#fff" },
    files: { img1: { mimeType: "image/png" } },
    미래필드: { keep: true },
  }, null, 2) + "\n";
  const parsed = parseExcalidrawDocument(withUnknown);
  const saved = buildExcalidrawSaveDocument({
    original: parsed.original,
    elements: [{ id: "new", type: "ellipse" }],
    appState: {
      gridSize: 20,
      viewBackgroundColor: "#fff",
      // 파일에 넣으면 안 되는 편집 중 임시 상태
      selectedElementIds: { new: true },
      zoom: { value: 2 },
      cursorButton: "down",
    },
  });
  const back = JSON.parse(saved);
  check("보존: 알 수 없는 최상위 키가 남는다", back["미래필드"]?.keep === true);
  check("보존: source를 우리 앱 것으로 바꾸지 않는다", back.source === "https://excalidraw.com");
  check("보존: type/version 유지", back.type === "excalidraw" && back.version === 2);
  check("보존: files를 안 넘기면 원본 유지", back.files?.img1?.mimeType === "image/png");
  check("교체: elements는 새 값", back.elements.length === 1 && back.elements[0].id === "new");
  check("화이트리스트: 편집 중 임시 상태는 파일에 안 들어간다",
    back.appState.selectedElementIds === undefined
    && back.appState.zoom === undefined
    && back.appState.cursorButton === undefined,
    JSON.stringify(back.appState));
  check("화이트리스트 목록은 gridSize/viewBackgroundColor 둘뿐",
    JSON.stringify([...EXCALIDRAW_PERSISTED_APP_STATE_KEYS].sort())
      === JSON.stringify(["gridSize", "viewBackgroundColor"]));
}

// ── appState 갱신 / files 교체 ──────────────────────────────────────────────
{
  const parsed = parseExcalidrawDocument(ORIGINAL);
  const saved = buildExcalidrawSaveDocument({
    original: parsed.original,
    elements: parsed.elements,
    appState: { gridSize: 20, viewBackgroundColor: "#000000" },
    files: { f1: { mimeType: "image/png" } },
  });
  const back = JSON.parse(saved);
  check("갱신: 화이트리스트 값은 반영된다",
    back.appState.gridSize === 20 && back.appState.viewBackgroundColor === "#000000");
  check("갱신: files를 넘기면 교체된다", back.files?.f1?.mimeType === "image/png");
  check("형식: 2칸 들여쓰기 + 끝 개행", saved.endsWith("\n}\n") && saved.includes('\n  "type"'));
}

// ── appState가 없는 원본 ────────────────────────────────────────────────────
{
  const minimal = JSON.stringify({ type: "excalidraw", version: 2, elements: [] }, null, 2) + "\n";
  const parsed = parseExcalidrawDocument(minimal);
  check("parse: appState/files가 없어도 읽는다", parsed.ok === true);
  const saved = buildExcalidrawSaveDocument({
    original: parsed.original,
    elements: [],
    appState: { viewBackgroundColor: "#fff" },
  });
  const back = JSON.parse(saved);
  check("보존: 원본에 없던 files를 새로 만들지 않는다", back.files === undefined);
  check("갱신: appState가 없던 원본에도 화이트리스트 값이 들어간다",
    back.appState.viewBackgroundColor === "#fff");
}

// ── 손으로 다듬은 원본 (2026-08-23 [kyle] 실볼트 실측) ──────────────────────
// `바이브코딩 구조.excalidraw`에는 `"roundness": { "type": 3 }`처럼 한 줄로 적힌 곳이 있다.
// 표준 2칸 직렬화로 다시 쓰면 **공백만** 달라진다(내용은 같다). 그래서 보장은 두 겹이다:
//   1) 내용 동일성은 항상 지킨다.
//   2) 사람이 바꾼 게 없으면 애초에 **쓰지 않는다**(hasMeaningfulExcalidrawChange).
{
  const handFormatted = `{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [
    {
      "id": "a1",
      "roundness": { "type": 3 }
    }
  ],
  "appState": { "gridSize": null, "viewBackgroundColor": "#ffffff" },
  "files": {}
}
`;
  const parsed = parseExcalidrawDocument(handFormatted);
  check("손 정렬 원본도 읽는다", parsed.ok === true);
  const rebuilt = buildExcalidrawSaveDocument({
    original: parsed.original,
    elements: parsed.elements,
    appState: parsed.appState,
    files: parsed.files,
  });
  check("손 정렬 원본은 공백이 표준화될 수 있다(글자 단위 동일은 보장하지 않는다)",
    rebuilt !== handFormatted);
  check("손 정렬 원본이라도 **내용은 완전히 같다**",
    JSON.stringify(JSON.parse(rebuilt)) === JSON.stringify(JSON.parse(handFormatted)));
  check("손 정렬 원본도 사람이 안 바꿨으면 저장 대상이 아니다(그래서 파일이 안 바뀐다)",
    hasMeaningfulExcalidrawChange({
      original: parsed.original,
      elements: parsed.elements,
      appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
    }) === false);
}

// ── 의미 있는 변경 판정 (2026-08-23 실측 기반) ──────────────────────────────
// excalidraw는 파일을 열기만 해도 version/versionNonce/updated/index를 바꾸고
// gridSize를 null→20으로 정규화한다. 그걸 변경으로 보면 열기만 해도 파일이 바뀐다.
{
  const original = JSON.parse(ORIGINAL);
  const opened = [{
    ...original.elements[0],
    version: 2, versionNonce: 1519157768, updated: 1787455488204,
    index: "a0", boundElements: [],
  }];
  check("변경판정: 열기만 한 상태는 변경 아님(휘발성 필드 무시 + null↔[] 정규화)",
    hasMeaningfulExcalidrawChange({
      original, elements: opened, appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
    }) === false);
  const originalText = {
    ...original,
    elements: [{ id: "text-a", type: "text", x: 10, y: 20, text: "원본" }],
  };
  check("변경판정: text autoResize 기본값 누락→true는 변경 아님",
    hasMeaningfulExcalidrawChange({
      original: originalText,
      elements: [{ ...originalText.elements[0], autoResize: true }],
      appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
    }) === false);
  check("변경판정: 원본 text autoResize false→true는 실제 변경",
    hasMeaningfulExcalidrawChange({
      original: {
        ...originalText,
        elements: [{ ...originalText.elements[0], autoResize: false }],
      },
      elements: [{ ...originalText.elements[0], autoResize: true }],
      appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
    }) === true);
  const originalArrow = {
    ...original,
    elements: [{
      id: "arrow-a", type: "arrow", x: 410, y: 206,
      width: -260, height: -72, points: [[0, 0], [-260, -72]],
    }],
  };
  check("변경판정: arrow width/height 부호 정규화는 변경 아님",
    hasMeaningfulExcalidrawChange({
      original: originalArrow,
      elements: [{ ...originalArrow.elements[0], width: 260, height: 72 }],
      appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
    }) === false);
  check("변경판정: arrow 크기 절댓값 변경은 실제 변경",
    hasMeaningfulExcalidrawChange({
      original: originalArrow,
      elements: [{ ...originalArrow.elements[0], width: 280, height: 72 }],
      appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
    }) === true);
  check("변경판정: arrow points 변경은 실제 변경",
    hasMeaningfulExcalidrawChange({
      original: originalArrow,
      elements: [{ ...originalArrow.elements[0], width: 260, height: 72, points: [[0, 0], [-200, -72]] }],
      appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
    }) === true);
  check("변경판정: points 없는 도형의 width 부호는 무시하지 않음",
    hasMeaningfulExcalidrawChange({
      original: { ...original, elements: [{ id: "rect-a", type: "rectangle", width: -260 }] },
      elements: [{ id: "rect-a", type: "rectangle", width: 260 }],
      appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
    }) === true);
  check("변경판정: gridSize 정규화(null→20)만으로는 변경 아님",
    hasMeaningfulExcalidrawChange({
      original, elements: original.elements, appState: { gridSize: 20, viewBackgroundColor: "#ffffff" },
    }) === false);
  check("변경판정: 도형을 옮기면 변경",
    hasMeaningfulExcalidrawChange({
      original,
      elements: [{ ...original.elements[0], x: 999 }],
      appState: { viewBackgroundColor: "#ffffff" },
    }) === true);
  check("변경판정: 도형을 추가하면 변경",
    hasMeaningfulExcalidrawChange({
      original,
      elements: [...original.elements, { id: "b", type: "ellipse" }],
      appState: { viewBackgroundColor: "#ffffff" },
    }) === true);
  check("변경판정: 도형을 지우면 변경",
    hasMeaningfulExcalidrawChange({
      original, elements: [], appState: { viewBackgroundColor: "#ffffff" },
    }) === true);
  check("변경판정: 배경색을 바꾸면 변경",
    hasMeaningfulExcalidrawChange({
      original, elements: original.elements, appState: { viewBackgroundColor: "#000000" },
    }) === true);
  check("변경판정: appState에 viewBackgroundColor가 없으면 배경 비교를 건너뛴다",
    hasMeaningfulExcalidrawChange({
      original, elements: original.elements, appState: {},
    }) === false);
  check("휘발성 필드 목록", JSON.stringify([...EXCALIDRAW_VOLATILE_ELEMENT_KEYS])
    === JSON.stringify(["version", "versionNonce", "updated", "index"]));
}

console.log(`\n${assertions} assertions, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
