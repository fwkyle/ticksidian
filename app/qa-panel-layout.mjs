/**
 * qa-panel-layout.mjs — 좌우 패널 폭 순수 규칙 검증 (2026-08-16 [kyle] 요청).
 *
 * 설계: docs/waterfall/03-상세설계/패널-너비-조정.md
 * 기준: docs/design-rules.md "패널 너비 조정"
 *
 * 핵심 계약
 * - 패널 하나는 180~560px.
 * - 창 크기를 알면 본문 에디터가 360px 아래로 내려가지 않게 한 번 더 자른다.
 * - 저장값이 깨져도 앱은 기본값으로 뜬다(fail-safe).
 *
 * 실행: node --experimental-strip-types qa-panel-layout.mjs
 */

import {
  DEFAULT_PANEL_WIDTHS,
  KEYBOARD_STEP,
  KEYBOARD_STEP_LARGE,
  MIN_EDITOR_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  PANEL_WIDTHS_STORAGE_KEY,
  clampPanelWidth,
  clampPanelWidths,
  parseStoredPanelWidths,
  serializePanelWidths,
  widthFromDrag,
} from "./src/lib/panel-layout.ts";

let failures = 0;
let assertions = 0;

function check(label, condition) {
  assertions += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}`);
  }
}

// ── 1. 기본값: 기존 화면과 같아야 한다 ────────────────────────────────────
check("기본 폭: 폴더 213 / 노트 319 / 투두 288 / 백링크 256",
  DEFAULT_PANEL_WIDTHS.folder === 213 && DEFAULT_PANEL_WIDTHS.notes === 319
  && DEFAULT_PANEL_WIDTHS.todos === 288 && DEFAULT_PANEL_WIDTHS.backlink === 256);
check("저장 키는 볼트가 아니라 화면 설정 키다",
  PANEL_WIDTHS_STORAGE_KEY === "ticksidian-panel-widths");

// ── 2. 절대 한계 ─────────────────────────────────────────────────────────
check("하한보다 작으면 하한으로 올린다", clampPanelWidth(10) === PANEL_MIN_WIDTH);
check("하한은 160px다(폴더 열이 들어갈 최소)", PANEL_MIN_WIDTH === 160);
check("상한보다 크면 상한으로 내린다", clampPanelWidth(9999) === PANEL_MAX_WIDTH);
check("범위 안 값은 그대로 둔다", clampPanelWidth(300) === 300);
check("소수점은 정수로 맞춘다", clampPanelWidth(300.6) === 301);
check("숫자가 아니면 기본값으로 되돌린다", clampPanelWidth(Number.NaN) === DEFAULT_PANEL_WIDTHS.notes);
check("무한대도 기본값으로 되돌린다", clampPanelWidth(Number.POSITIVE_INFINITY) === DEFAULT_PANEL_WIDTHS.notes);

// ── 3. 에디터 최소 폭 보장 ───────────────────────────────────────────────
{
  // 창 1000px, 반대편 패널 256px → 사이드바 상한 = 1000 - 256 - 360 = 384
  const width = clampPanelWidth(560, { viewportWidth: 1000, otherPanelWidth: 256 });
  check("창이 좁으면 에디터 360px를 남기고 자른다", width === 384);
  check("자른 뒤에도 에디터가 최소 폭을 지킨다",
    1000 - 256 - width >= MIN_EDITOR_WIDTH);
}
{
  // 창이 아주 좁으면 계산상 상한이 하한보다 작아진다 → 하한 우선(패널이 사라지지 않게)
  const width = clampPanelWidth(400, { viewportWidth: 700, otherPanelWidth: 256 });
  check("계산 상한이 하한보다 작으면 하한을 우선한다", width === PANEL_MIN_WIDTH);
}
{
  // 반대편 패널이 숨겨진 경우(백링크는 1024px 미만에서 숨김)
  const width = clampPanelWidth(500, { viewportWidth: 1000, otherPanelWidth: 0 });
  check("반대편 패널이 없으면 더 넓게 허용한다", width === 500);
}
check("창 크기를 모르면 절대 한계만 적용한다", clampPanelWidth(500) === 500);

// ── 4. 두 패널 동시 clamp ────────────────────────────────────────────────
{
  const result = clampPanelWidths({ folder: 500, notes: 500, todos: 500, backlink: 500 }, 1920,
    { todos: true });
  check("네 패널을 다 펼쳐도 본문 최소 폭이 남는다",
    1920 - result.folder - result.notes - result.todos - result.backlink >= MIN_EDITOR_WIDTH);
  check("네 패널 모두 절대 한계 안이다",
    [result.folder, result.notes, result.todos, result.backlink]
      .every((w) => w >= PANEL_MIN_WIDTH && w <= PANEL_MAX_WIDTH));
}
{
  // 투두는 기본이 닫힘이라 자리를 차지하지 않는다 — 닫혀 있으면 나머지가 더 넓게 쓸 수 있다
  const closed = clampPanelWidths({ folder: 200, notes: 400, todos: 288, backlink: 256 }, 1280);
  const open = clampPanelWidths({ folder: 200, notes: 400, todos: 288, backlink: 256 }, 1280,
    { todos: true });
  check("투두가 닫혀 있으면 노트 열이 더 넓게 허용된다", closed.notes >= open.notes);
  check("투두를 열면 본문 최소 폭을 위해 함께 줄어든다",
    1280 - open.folder - open.notes - open.todos - open.backlink >= MIN_EDITOR_WIDTH - 1);
}
{
  // 좁은 창에서 셋을 다 넓히려 해도 본문이 지켜져야 한다
  const result = clampPanelWidths({ folder: 400, notes: 400, todos: 288, backlink: 400 }, 1280);
  check("좁은 창에서는 패널들이 함께 줄어든다",
    1280 - result.folder - result.notes - result.backlink >= MIN_EDITOR_WIDTH - 1);
}
{
  // 백링크가 숨겨진 구간(1024px 미만)에서는 나머지가 그 폭을 쓸 수 있어야 한다
  const result = clampPanelWidths({ folder: 200, notes: 380, todos: 288, backlink: 256 }, 1000, { backlink: false });
  check("백링크가 숨겨지면 노트 열 상한이 넓어진다", result.notes === 380);
}
{
  // 폴더 열까지 숨는 좁은 화면(<md 드로어 구간)
  const result = clampPanelWidths({ folder: 200, notes: 300, todos: 288, backlink: 256 }, 900,
    { folder: false, backlink: false });
  check("폴더 열이 숨으면 노트 열만 기준으로 계산한다", result.notes === 300);
}

// ── 5. 저장값 파싱 fail-safe ─────────────────────────────────────────────
check("저장값이 없으면 기본값", parseStoredPanelWidths(null).notes === 319);
check("빈 문자열도 기본값", parseStoredPanelWidths("").notes === 319);
check("깨진 JSON은 기본값", parseStoredPanelWidths("{folder:").backlink === 256);
check("JSON이 객체가 아니면 기본값", parseStoredPanelWidths("[1,2]").folder === 213);
check("null JSON도 기본값", parseStoredPanelWidths("null").notes === 319);
{
  const parsed = parseStoredPanelWidths('{"folder":320,"notes":300,"todos":350,"backlink":200}');
  check("정상 저장값은 그대로 복원된다",
    parsed.folder === 320 && parsed.notes === 300 && parsed.todos === 350 && parsed.backlink === 200);
}
{
  const parsed = parseStoredPanelWidths('{"folder":"넓게","notes":9999,"backlink":50}');
  check("숫자가 아닌 값은 그 항목만 기본값", parsed.folder === 213);
  check("범위 밖 저장값은 한계로 잘린다",
    parsed.notes === PANEL_MAX_WIDTH && parsed.backlink === PANEL_MIN_WIDTH);
}
{
  const parsed = parseStoredPanelWidths('{"notes":300}');
  check("일부만 있으면 나머지는 기본값",
    parsed.notes === 300 && parsed.folder === 213 && parsed.todos === 288 && parsed.backlink === 256);
}
{
  // 2026-08-18 이전 저장값(sidebar 키)은 무시되고 새 기본값이 쓰인다
  const parsed = parseStoredPanelWidths('{"sidebar":400,"backlink":300}');
  check("구버전 sidebar 키는 무시하고 기본값으로 뜬다",
    parsed.folder === 213 && parsed.notes === 319 && parsed.backlink === 300);
}

// ── 6. 직렬화 round-trip ─────────────────────────────────────────────────
{
  const original = { folder: 333, notes: 222, todos: 311, backlink: 444 };
  const restored = parseStoredPanelWidths(serializePanelWidths(original));
  check("직렬화 → 파싱 round-trip이 값을 보존한다",
    restored.folder === 333 && restored.notes === 222 && restored.todos === 311
    && restored.backlink === 444);
}
{
  const restored = parseStoredPanelWidths(serializePanelWidths({ folder: 10, notes: 9999, todos: 288, backlink: 256 }));
  check("저장 전에도 한계로 잘라서 이상값이 남지 않는다",
    restored.folder === PANEL_MIN_WIDTH && restored.notes === PANEL_MAX_WIDTH);
}

// ── 7. 드래그 방향 ───────────────────────────────────────────────────────
check("폴더 열은 오른쪽으로 끌면 넓어진다", widthFromDrag("folder", 200, 40) === 240);
check("노트 열도 오른쪽으로 끌면 넓어진다", widthFromDrag("notes", 240, 40) === 280);
check("왼쪽 패널은 왼쪽으로 끌면 좁아진다", widthFromDrag("notes", 240, -40) === 200);
check("투두 패널도 오른쪽으로 끌면 넓어진다(왼쪽 그룹)", widthFromDrag("todos", 288, 40) === 328);
check("오른쪽 패널은 왼쪽으로 끌면 넓어진다", widthFromDrag("backlink", 256, -40) === 296);
check("오른쪽 패널은 오른쪽으로 끌면 좁아진다", widthFromDrag("backlink", 256, 40) === 216);
check("움직이지 않으면 폭도 그대로다", widthFromDrag("notes", 256, 0) === 256);

// ── 8. 키보드 단위 ───────────────────────────────────────────────────────
check("키보드 기본 단위는 16px", KEYBOARD_STEP === 16);
check("Shift 단위는 기본보다 크다", KEYBOARD_STEP_LARGE > KEYBOARD_STEP);
check("키보드로 하한 아래까지 눌러도 하한에서 멈춘다",
  clampPanelWidth(PANEL_MIN_WIDTH - KEYBOARD_STEP_LARGE) === PANEL_MIN_WIDTH);

console.log(`\n${assertions} assertions, ${failures} failures`);
if (failures > 0) process.exit(1);
