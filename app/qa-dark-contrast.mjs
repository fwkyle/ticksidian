/**
 * qa-dark-contrast.mjs — 다크모드 팔레트 가독성 회귀 방지 (2026-08-18 [kyle] 요청).
 *
 * Why: [kyle]이 TickTick과 비교해 "배경이 덜 어둡고 글씨가 덜 희다"고 지적했다.
 * 실측해 보니 흐린 보조 텍스트(zinc-500)가 대비 3.7:1로 WCAG AA(4.5:1)에 미달이었고,
 * 그 토큰이 71곳에서 쓰이고 있었다. 색을 눈대중으로 되돌리지 못하게 수치로 잠근다.
 *
 * 기준: docs/design-rules.md "다크모드 팔레트"
 * 검증 대상: app/src/index.css 의 @theme 블록에 실제로 적힌 값
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "src/index.css"), "utf8");

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** @theme 블록에서 --color-zinc-* 값을 읽는다. */
function readPalette() {
  const block = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
  if (!block) return null;
  const palette = {};
  for (const [, step, hex] of block[1].matchAll(/--color-zinc-(\d+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    palette[Number(step)] = hex.toLowerCase();
  }
  return palette;
}

const toLinear = (channel) => {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * toLinear((n >> 16) & 255) +
    0.7152 * toLinear((n >> 8) & 255) +
    0.0722 * toLinear(n & 255)
  );
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const palette = readPalette();
check("index.css @theme 블록에서 zinc 팔레트를 읽는다", palette !== null);
if (!palette) process.exit(1);

// 1) 필요한 단계가 모두 정의돼 있다 (하나라도 빠지면 Tailwind 기본 푸른 회색으로 되돌아간다)
for (const step of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
  check(`zinc-${step} 정의됨`, palette[step] !== undefined, palette[step] ?? "없음");
}

const bg = palette[900];
const sidebar = palette[800];

// 2) 배경이 TickTick 수준으로 어둡다 (밝기 상한)
check("본문 배경이 충분히 어둡다", luminance(bg) <= luminance("#1c1c1c"), `${bg}`);
check("사이드바 배경이 충분히 어둡다", luminance(sidebar) <= luminance("#232323"), `${sidebar}`);

// 3) 사이드바와 본문이 '구분은 되되 튀지는' 않는다
const panelGap = contrast(sidebar, bg);
check(
  "사이드바와 본문 배경 차이가 미묘하다 (1.02~1.25:1)",
  panelGap >= 1.02 && panelGap <= 1.25,
  `${panelGap.toFixed(2)}:1`,
);

// 4) 텍스트 대비 — 흐린 보조까지 WCAG AA(4.5:1) 이상
const TEXT_MIN = { 100: 15, 200: 12, 300: 9, 400: 6, 500: 4.5 };
for (const [step, min] of Object.entries(TEXT_MIN)) {
  const ratio = contrast(palette[step], bg);
  check(
    `zinc-${step} 본문 대비 ${min}:1 이상`,
    ratio >= min,
    `${palette[step]} on ${bg} = ${ratio.toFixed(1)}:1`,
  );
}

// 5) 사이드바 위에서도 흐린 보조 텍스트가 AA를 지킨다 (배경이 더 밝아 더 불리하다)
const onSidebar = contrast(palette[500], sidebar);
check("zinc-500 이 사이드바 위에서도 AA(4.5:1)", onSidebar >= 4.5, `${onSidebar.toFixed(1)}:1`);

// 6) 제목은 순백이다 ([kyle] 지적의 핵심)
check("zinc-100(제목)이 순백이다", palette[100] === "#ffffff", palette[100]);

// 선택된 행 위에서도 보조 텍스트 대비를 지킨다(2026-09-05).
const selected = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)[\s\S]*?--color-selection:\s*(#[0-9a-fA-F]{6})/)?.[1];
check("다크 선택 배경 토큰이 있다", selected !== undefined);
if (selected) {
  const ratio = contrast(palette[500], selected);
  check("선택 행 보조 텍스트도 AA(4.5:1)", ratio >= 4.5, `${ratio.toFixed(1)}:1`);
}

// 7) BlockNote 다크 본문 글씨도 함께 올렸다
const bnText = css.match(/--bn-colors-editor-text:\s*(#[0-9a-fA-F]{6})/)?.[1]?.toLowerCase();
check("BlockNote 본문 글씨 보정이 있다", bnText !== undefined, bnText ?? "없음");
if (bnText) {
  const bnRatio = contrast(bnText, palette[950]);
  check("BlockNote 본문 대비 12:1 이상", bnRatio >= 12, `${bnText} on ${palette[950]} = ${bnRatio.toFixed(1)}:1`);
}

console.log(`\n${failures === 0 ? "모든 검사 통과" : `${failures}건 실패`}`);
process.exit(failures === 0 ? 0 : 1);
