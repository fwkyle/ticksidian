import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readConfig = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const base = readConfig("tauri.conf.json");
const local = readConfig("tauri.conf.local.json");
const dev = readConfig("tauri.conf.dev.json");
const stability = readConfig("tauri.conf.stability-qa.json");

assert.equal(base.app.windows.length, 1);
assert.equal(base.app.windows[0].width, 1280, "초기 창 너비는 1280");
assert.equal(base.app.windows[0].height, 820, "초기 창 높이는 820");
assert.equal(base.app.windows[0].dragDropEnabled, false, "웹 에디터 드롭 처리 보존");
// Tauri JSON merge에서 배열은 교체된다. local 제목만 바꿔도 나머지 필드가 모두 필요하다.
assert.deepEqual(local.app.windows, base.app.windows.map((window) => ({
  ...window,
  title: local.productName,
})), "local 창은 제목 외 기본 창 계약을 모두 보존해야 한다");
assert.equal(dev.app?.windows, undefined, "dev는 기본 창 설정을 그대로 사용한다");
assert.equal(local.identifier, "com.ticksidian.desktop.local");
assert.equal(dev.identifier, "com.ticksidian.desktop.dev");
assert.equal(stability.identifier, "com.ticksidian.desktop.stability-qa");
assert.deepEqual(stability.app.windows, base.app.windows.map((window) => ({
  ...window, title: "Ticksidian 안정성 검증용", focus: false,
})), "안정성 QA는 창 크기를 보존하고 시작 포커스를 이동하지 않는다");
const ime = readConfig("tauri.conf.ime-native.json");
assert.equal(ime.identifier, "com.ticksidian.desktop.ime-native");
assert.deepEqual(ime.app.windows, base.app.windows.map((window) => ({
  ...window, title: "Ticksidian 한글 조합 검증 — 개인 노트 없음", focus: false,
})), "한글 QA는 시작 포커스와 전체 창 설정을 보존한다");
assert.equal(ime.build.devUrl, "http://127.0.0.1:5187");
assert.equal(ime.build.beforeDevCommand, "", "QA 서버를 제품 dev 서버로 대체하지 않는다");
console.log("[qa-window-config] PASS: 1280x820, local 창 필드 보존, dev 상속, 빌드 ID 격리");
