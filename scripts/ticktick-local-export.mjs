#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDefaultOutputPath,
  DEFAULT_TICKTICK_DATABASE_PATH,
  fingerprintTickTickSource,
  sourceFingerprintsEqual,
  TickTickExportWriter,
  TickTickLocalReader,
} from "./ticktick-local-export-lib.mjs";

function parseArgs(argv) {
  const options = {
    databasePath: DEFAULT_TICKTICK_DATABASE_PATH,
    outputPath: null,
    expectedActiveCount: null,
    limit: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") return { ...options, help: true };
    if (arg === "--db") options.databasePath = resolve(requireValue(argv, ++index, arg));
    else if (arg === "--output") options.outputPath = resolve(requireValue(argv, ++index, arg));
    else if (arg === "--expect-active") options.expectedActiveCount = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
    else if (arg === "--limit") options.limit = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
    else throw new Error(`알 수 없는 옵션입니다: ${arg}`);
  }
  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} 값이 필요합니다.`);
  return value;
}

function parsePositiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} 값은 1 이상의 정수여야 합니다.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`TickTick 로컬 활성 할 일을 읽기 전용으로 추출합니다.

사용법:
  node scripts/ticktick-local-export.mjs [옵션]

옵션:
  --db <경로>             TickTick Core Data DB 경로
  --output <경로>         새 출력 폴더 경로
  --expect-active <개수>  기대 활성 할 일 수와 대조
  --limit <개수>          앞에서 N개만 실험 추출
  --help                  도움말

이 명령에는 TickTick 쓰기, 완료, 이동, 삭제 기능이 없습니다.`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const workspacePath = resolve(scriptDirectory, "..");
  const outputPath = options.outputPath ?? buildDefaultOutputPath(workspacePath);
  const before = fingerprintTickTickSource(options.databasePath);
  const reader = new TickTickLocalReader(options.databasePath);
  const snapshot = reader.readActiveSnapshot({
    expectedActiveCount: options.expectedActiveCount,
    limit: options.limit,
  });
  const after = fingerprintTickTickSource(options.databasePath);
  const stable = sourceFingerprintsEqual(before, after);
  const writer = new TickTickExportWriter({
    outputPath,
    sourceDatabasePath: options.databasePath,
  });
  const manifest = writer.write(snapshot, { before, after, stable });

  console.log(JSON.stringify({
    outputPath,
    tasks: manifest.counts.tasks,
    projects: manifest.counts.projects,
    qualityPassed: manifest.quality.passed,
    sourceStableDuringRead: stable,
  }, null, 2));

  if (!manifest.quality.passed) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
