/**
 * 볼트 등록 범위 좁히기 — 시작 때 저장된 볼트 경로가 등록 거부되면 멈추지 않고
 * 거부 이유와 함께 볼트 선택 화면으로 간다.
 *
 * 분류: 브라우저 fixture QA (mockIPC + MemoryVaultAdapter). 거부 규칙(루트·홈·앱 설정 폴더·비밀 폴더)
 * 자체는 Rust 시험(`secrets_config.rs` vault_candidate_*)이 검증한다. 여기서는 거부 오류가
 * 화면에 이유로 보이는 경로만 본다. 실제 Tauri 등록 거부는 검증하지 않는다 — [kyle] 잔여.
 * 설계: docs/waterfall/03-상세설계/런타임-볼트-전환-정책.md §9
 */

import { test, expect } from "@playwright/test";

const VAULT_KEY = "ticksidian-vault-path";
const REJECTED_VAULT = "/rejected-broad-vault";

test("저장된 볼트가 등록 거부되면 이유를 보이고 볼트 선택 화면으로 가며 저장 경로를 지운다", async ({ page }) => {
  await page.addInitScript(
    ({ key, path }) => {
      const w = window as Window & { __qa_skipVaultSeed?: boolean; __qa_denyVaultPath?: string };
      w.__qa_skipVaultSeed = true;
      w.__qa_denyVaultPath = path;
      localStorage.setItem(key, path);
    },
    { key: VAULT_KEY, path: REJECTED_VAULT },
  );
  await page.goto("/");

  await expect(page.getByRole("button", { name: "볼트 폴더 선택" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("alert").filter({ hasText: REJECTED_VAULT })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), VAULT_KEY)).toBeNull();
});
