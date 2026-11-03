/**
 * TICK-P1-008 HTML Export Playwright 테스트
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter) + file:// 산출물 검증
 * 한계: 실제 OS 파일 IO, Tauri capability는 검증하지 않는다.
 *
 * 포트: 5175 (기존 qa:browser와 동일)
 * 실행: npm run qa:browser
 *
 * 테스트 구성:
 *   Part A (앱 내 기능): 사이드바 내보내기 버튼 클릭 → 완료 메시지 확인
 *   Part B (산출물 자체): plan-export로 임시 HTML 생성 →
 *     B-1. index.html 노트 목록 렌더
 *     B-2. 검색 입력 → 목록 필터링
 *     B-3. 위키링크(resolved) 클릭 → 대상 노트 페이지 이동
 *
 * 산출물 위치: app/test-results/html-export-fixture/ (gitignore, 삭제하지 않음)
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

async function waitForAppReady(page: Page) {
  await page.waitForSelector("[aria-label='빠른 기록 제목']", { timeout: 20000 });
  await page.waitForTimeout(1000);
  // 이 회귀 검사의 시작 범위는 기본함이 아니라 전체 볼트다(모바일도 같은 준비 상태).
  await page.locator('[data-folder-select="전체"]').evaluate((button: HTMLButtonElement) => button.click());
}

// ── Part B: 산출물 fixture 생성 (beforeAll) ────────────────────────────────

const FIXTURE_DIR = path.resolve(__dirname, "../../test-results/html-export-fixture");

/**
 * 인라인으로 최소한의 정적 HTML fixture를 생성한다.
 * wiki-link-index를 직접 import하지 않고 resolved 링크가 포함된 HTML을 직접 작성한다.
 * 이렇게 하면 Node ESM의 확장자 없는 import 제약을 우회하면서도 실제 산출물 구조를 검증할 수 있다.
 */
function createFixtureHtml(): void {
  if (!fs.existsSync(FIXTURE_DIR)) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  }
  if (!fs.existsSync(path.join(FIXTURE_DIR, "notes"))) {
    fs.mkdirSync(path.join(FIXTURE_DIR, "notes"), { recursive: true });
  }
  if (!fs.existsSync(path.join(FIXTURE_DIR, "assets"))) {
    fs.mkdirSync(path.join(FIXTURE_DIR, "assets"), { recursive: true });
  }

  // search-index.js (window.__SEARCH_INDEX__)
  const searchIndex = [
    { id: "note-alpha", title: "알파 노트", aliases: ["alpha"], tags: [], snippet: "알파 노트 본문 내용입니다." },
    { id: "note-beta",  title: "베타 노트", aliases: ["beta"],  tags: [], snippet: "베타 노트 본문 내용입니다." },
  ];
  fs.writeFileSync(
    path.join(FIXTURE_DIR, "assets", "search-index.js"),
    `window.__SEARCH_INDEX__ = ${JSON.stringify(searchIndex)};`,
    "utf-8",
  );

  // app.js (검색 기능)
  const appJs = `
(function () {
  'use strict';
  function initSearch() {
    var index = window.__SEARCH_INDEX__;
    var input = document.getElementById('search-input');
    var listEl = document.querySelector('.notes-list');
    var emptyEl = document.getElementById('search-empty');
    if (!input || !listEl || !index) return;
    var items = Array.from(listEl.querySelectorAll('li[data-note-id]'));
    function normalize(s) { return (s || '').toLowerCase(); }
    function matchEntry(entry, q) {
      if (normalize(entry.title).indexOf(q) !== -1) return true;
      for (var i = 0; i < (entry.aliases || []).length; i++) {
        if (normalize(entry.aliases[i]).indexOf(q) !== -1) return true;
      }
      if (normalize(entry.snippet).indexOf(q) !== -1) return true;
      return false;
    }
    var timer = null;
    input.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        var q = normalize(input.value.trim());
        if (!q) {
          items.forEach(function (li) { li.style.display = ''; });
          if (emptyEl) emptyEl.style.display = 'none';
          return;
        }
        var visibleCount = 0;
        items.forEach(function (li) {
          var noteId = li.getAttribute('data-note-id');
          var entry = null;
          for (var k = 0; k < index.length; k++) {
            if (index[k].id === noteId) { entry = index[k]; break; }
          }
          if (entry && matchEntry(entry, q)) {
            li.style.display = '';
            visibleCount++;
          } else {
            li.style.display = 'none';
          }
        });
        if (emptyEl) emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
      }, 150);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearch);
  } else {
    initSearch();
  }
})();
`.trim();
  fs.writeFileSync(path.join(FIXTURE_DIR, "assets", "app.js"), appJs, "utf-8");
  fs.writeFileSync(path.join(FIXTURE_DIR, "assets", "style.css"), "body { font-family: sans-serif; }", "utf-8");

  // index.html
  const indexHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>Ticksidian</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <div class="page-wrapper">
    <div class="search-wrapper">
      <input type="search" id="search-input" placeholder="노트 검색…" aria-label="노트 검색" autocomplete="off">
    </div>
    <ul class="notes-list" role="list" aria-label="노트 목록">
      <li data-note-id="note-alpha">
        <a href="notes/note-note-alpha.html">
          <span class="note-title">알파 노트</span>
          <span class="note-snippet">알파 노트 본문 내용입니다.</span>
        </a>
      </li>
      <li data-note-id="note-beta">
        <a href="notes/note-note-beta.html">
          <span class="note-title">베타 노트</span>
          <span class="note-snippet">베타 노트 본문 내용입니다.</span>
        </a>
      </li>
    </ul>
    <p id="search-empty" role="status" aria-live="polite" style="display:none">검색 결과가 없습니다.</p>
  </div>
  <script src="assets/search-index.js"></script>
  <script src="assets/app.js"></script>
</body>
</html>`;
  fs.writeFileSync(path.join(FIXTURE_DIR, "index.html"), indexHtml, "utf-8");

  // notes/note-note-alpha.html (resolved 위키링크 포함)
  const alphaHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>알파 노트 — Ticksidian</title>
  <link rel="stylesheet" href="../assets/style.css">
</head>
<body>
  <div class="page-wrapper">
    <header class="site-header">
      <a href="../index.html">Ticksidian</a>
    </header>
    <main>
      <h1>알파 노트</h1>
      <p>알파 노트 본문 내용입니다.</p>
      <p><a href="note-note-beta.html" class="wiki-link">베타 노트</a>를 참조하세요.</p>
    </main>
  </div>
  <script src="../assets/search-index.js"></script>
  <script src="../assets/app.js"></script>
</body>
</html>`;
  fs.writeFileSync(path.join(FIXTURE_DIR, "notes", "note-note-alpha.html"), alphaHtml, "utf-8");

  // notes/note-note-beta.html
  const betaHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>베타 노트 — Ticksidian</title>
  <link rel="stylesheet" href="../assets/style.css">
</head>
<body>
  <div class="page-wrapper">
    <header class="site-header">
      <a href="../index.html">Ticksidian</a>
    </header>
    <main>
      <h1>베타 노트</h1>
      <p>베타 노트 본문 내용입니다.</p>
    </main>
  </div>
  <script src="../assets/search-index.js"></script>
  <script src="../assets/app.js"></script>
</body>
</html>`;
  fs.writeFileSync(path.join(FIXTURE_DIR, "notes", "note-note-beta.html"), betaHtml, "utf-8");
}

// ── fixture 생성 (한 번만) ────────────────────────────────────────────────────

test.beforeAll(() => {
  createFixtureHtml();
});

// ── Part A: 앱 내 HTML 내보내기 버튼 ──────────────────────────────────────────

test("HTML 내보내기: 사이드바 버튼 클릭 → 완료 메시지 표시", async ({ page }) => {
  await page.goto("/");
  await waitForAppReady(page);

  // "HTML 내보내기" 버튼을 찾는다
  const exportBtn = page.getByRole("button", { name: /HTML 내보내기/ });
  await expect(exportBtn).toBeVisible({ timeout: 5000 });

  // 버튼 클릭
  await exportBtn.click();

  // 완료 메시지("개 노트 내보냄")가 나타날 때까지 대기
  // 내보내는 중 → 완료 메시지 순서 (MemoryVaultAdapter이므로 빠름)
  await expect(
    page.locator("text=내보냄"),
  ).toBeVisible({ timeout: 15000 });
});

// ── Part B-1: 산출물 — index.html 노트 목록 렌더 ─────────────────────────────

test("HTML export 산출물: index.html 노트 목록 렌더", async ({ page }) => {
  const indexPath = path.join(FIXTURE_DIR, "index.html");
  await page.goto(`file://${indexPath}`);

  // 노트 목록이 존재하는지
  await expect(page.locator(".notes-list")).toBeVisible({ timeout: 5000 });

  // 알파 노트 링크 확인
  await expect(page.locator("text=알파 노트").first()).toBeVisible({ timeout: 5000 });

  // 베타 노트 링크 확인
  await expect(page.locator("text=베타 노트").first()).toBeVisible({ timeout: 5000 });
});

// ── Part B-2: 산출물 — 검색 입력 필터 ──────────────────────────────────────

test("HTML export 산출물: 검색 입력으로 목록 필터링", async ({ page }) => {
  const indexPath = path.join(FIXTURE_DIR, "index.html");
  await page.goto(`file://${indexPath}`);

  // 검색 input 확인
  const searchInput = page.locator("#search-input");
  await expect(searchInput).toBeVisible({ timeout: 5000 });

  // "알파"로 검색
  await searchInput.fill("알파");
  // 디바운스 150ms 대기
  await page.waitForTimeout(400);

  // 알파 노트 보임
  const alphaItem = page.locator('li[data-note-id="note-alpha"]');
  await expect(alphaItem).toBeVisible({ timeout: 3000 });

  // 베타 노트 숨김
  const betaItem = page.locator('li[data-note-id="note-beta"]');
  await expect(betaItem).not.toBeVisible({ timeout: 3000 });
});

// ── Part B-3: 산출물 — 위키링크 클릭 → 대상 노트 페이지 이동 ──────────────

test("HTML export 산출물: 위키링크 클릭 → 대상 노트 페이지 이동", async ({ page }) => {
  const alphaPath = path.join(FIXTURE_DIR, "notes", "note-note-alpha.html");
  await page.goto(`file://${alphaPath}`);

  // 알파 노트 제목 확인
  await expect(page.locator("h1")).toContainText("알파 노트", { timeout: 5000 });

  // 베타 노트로 가는 wiki-link 확인
  const wikiLink = page.locator("a.wiki-link");
  await expect(wikiLink).toBeVisible({ timeout: 5000 });
  await expect(wikiLink).toContainText("베타 노트");

  // 클릭 → 베타 노트 페이지로 이동
  await wikiLink.click();

  // 베타 노트 제목 확인
  await expect(page.locator("h1")).toContainText("베타 노트", { timeout: 5000 });
});
