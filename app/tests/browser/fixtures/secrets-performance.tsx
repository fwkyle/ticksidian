// Why: 실제 보안 메모 패널을 합성 경로/가짜 IPC로 검증한다. 개인 파일은 읽지 않는다.
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { SecretsViewerPanel } from "../../../src/components/secrets-viewer/SecretsViewerPanel";
import "../../../src/index.css";

declare global {
  interface Window {
    __secretMetrics: { calls: string[]; inputFrames: number[] };
  }
}
const count = Number(new URLSearchParams(location.search).get("count") ?? 5000);
const files = Array.from({ length: count }, (_, i) => ({
  path: i < 98 ? `aws/service-${String(i).padStart(5, "0")}.env`
    : `archive/group-${String(Math.floor(i / 25)).padStart(5, "0")}/file-${String(i).padStart(5, "0")}.env`,
  sizeBytes: 64,
  modifiedMs: 1700000000000,
}));
window.__secretMetrics = { calls: [], inputFrames: [] };
mockIPC((command) => {
  // 비밀 폴더 설정 확인은 목록 성능 호출 기록에 넣지 않는다(2026-11-02).
  if (command === "get_secrets_folder_status") return { configured: true, path: "/qa/secrets-folder" };
  window.__secretMetrics.calls.push(command);
  if (command === "list_secret_files") return files;
  if (command === "read_secret_file") return "TOKEN=fake-performance-value\n";
  throw new Error(`unexpected fixture command: ${command}`);
});
document.addEventListener("input", event => {
  if (!(event.target instanceof HTMLInputElement)) return;
  const start = performance.now();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__secretMetrics.inputFrames.push(performance.now() - start);
  }));
});
createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100vh" }}><SecretsViewerPanel onClose={() => {}} /></div>,
);
