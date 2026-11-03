// ticktick-local-export-lib.mjs — 재export 전용 barrel.
//
// 구현은 2026-08-15 리팩토링으로 ticktick-export-lib/ 하위 모듈로 분리됐다
// (docs/architecture/script-size-audit-2026-08-15.md 2순위).
// 이 파일은 기존 import 경로(./ticktick-local-export-lib.mjs)를 유지하기 위한 경계다.
//
// 모듈 구성:
//   ticktick-export-lib/normalize.mjs — 내부 표기 → Ticksidian 표기 정규화 공통 유틸
//   ticktick-export-lib/safety.mjs    — 민감정보 패턴/검출/가림(안전 정책)
//   ticktick-export-lib/queries.mjs   — 스키마 기대값 + 읽기 전용 SQL
//   ticktick-export-lib/reader.mjs    — TickTickLocalReader(읽기 전용 SQLite 조회)
//   ticktick-export-lib/format.mjs    — buildAgentSafeTask + Markdown 출력 형식
//   ticktick-export-lib/writer.mjs    — TickTickExportWriter + 지문(fingerprint) 유틸

export { DEFAULT_TICKTICK_DATABASE_PATH, TickTickLocalReader } from "./ticktick-export-lib/reader.mjs";
export { buildAgentSafeTask } from "./ticktick-export-lib/format.mjs";
export {
  TickTickExportWriter,
  buildDefaultOutputPath,
  fingerprintTickTickSource,
  sourceFingerprintsEqual,
} from "./ticktick-export-lib/writer.mjs";
