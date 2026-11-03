// 추출 결과 출력기 — 새 출력 폴더에만 쓰고 완료 영수증(manifest)을 남긴다.
// 원래 scripts/ticktick-local-export-lib.mjs(769줄) 분리(2026-08-15 리팩토링 2순위).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { isPathInside } from "./normalize.mjs";
import { buildAgentSafeTask, buildReviewMarkdown, safeTaskFileName, taskToMarkdown } from "./format.mjs";

function assertSafeOutputPath(outputPath, sourceDatabasePath) {
  const output = resolve(outputPath);
  const sourceDirectory = dirname(resolve(sourceDatabasePath));
  if (output === resolve("/") || output === resolve(homedir())) {
    throw new Error(`너무 넓은 출력 경로는 거부합니다: ${output}`);
  }
  if (isPathInside(sourceDirectory, output)) {
    throw new Error("출력 경로는 TickTick 데이터 폴더 밖이어야 합니다.");
  }
  if (existsSync(output)) {
    throw new Error(`기존 출력 경로를 덮어쓰지 않습니다: ${output}`);
  }
}

export class TickTickExportWriter {
  constructor({ outputPath, sourceDatabasePath }) {
    this.outputPath = resolve(outputPath);
    this.sourceDatabasePath = resolve(sourceDatabasePath);
  }

  write(snapshot, sourceEvidence) {
    if (!snapshot.quality.passed) {
      throw new Error("데이터 품질 검사가 실패해 출력하지 않습니다.");
    }
    if (!sourceEvidence.stable) {
      throw new Error("읽는 동안 TickTick 원본이 바뀌어 출력하지 않습니다.");
    }
    assertSafeOutputPath(this.outputPath, this.sourceDatabasePath);
    const agentTasksDirectory = resolve(this.outputPath, "agent-tasks");
    mkdirSync(agentTasksDirectory, { recursive: true, mode: 0o700 });

    const exportedAt = new Date().toISOString();
    const manifest = {
      schemaVersion: 1,
      exportedAt,
      source: {
        kind: "ticktick-local-snapshot",
        databasePath: this.sourceDatabasePath,
        filesBeforeRead: sourceEvidence.before,
        filesAfterRead: sourceEvidence.after,
        sourceStableDuringRead: sourceEvidence.stable,
      },
      selection: snapshot.selection,
      counts: {
        tasks: snapshot.tasks.length,
        projects: new Set(snapshot.tasks.map((task) => task.project.sourceId)).size,
        checklistItems: snapshot.tasks.reduce((sum, task) => sum + task.checklistItems.length, 0),
        reminders: snapshot.tasks.reduce((sum, task) => sum + task.reminders.length, 0),
        attachments: snapshot.tasks.reduce((sum, task) => sum + task.attachments.length, 0),
      },
      quality: {
        ...snapshot.quality,
        passed: snapshot.quality.passed && sourceEvidence.stable,
      },
      redactions: [
        "TickTick account ID",
        "attachment local path",
        "attachment remote URL",
      ],
      warnings: [
        "TickTick 내부 Core Data 스키마는 공개 안정 계약이 아니므로 앱 업데이트 후 다시 검증해야 합니다.",
        "이 결과는 읽기 전용 검토용이며 TickTick 완료·이동·삭제와 연결되지 않습니다.",
      ],
    };

    const agentTasks = snapshot.tasks.map(buildAgentSafeTask);
    const sensitiveTaskCount = agentTasks.filter((task) => task.safety.sensitiveContentSuspected).length;
    const destructiveActionTaskCount = agentTasks.filter((task) => task.safety.destructiveActionSuspected).length;
    const mutatingCommandTaskCount = agentTasks.filter((task) => task.safety.mutatingCommandSuspected).length;
    const financialDecisionTaskCount = agentTasks.filter((task) => task.safety.financialDecisionSuspected).length;
    const manualReviewOnlyCount = agentTasks.filter((task) => task.safety.action === "manual-review-only").length;
    manifest.safety = {
      sensitiveTaskCount,
      destructiveActionTaskCount,
      mutatingCommandTaskCount,
      financialDecisionTaskCount,
      manualReviewOnlyCount,
      agentReviewAllowedCount: agentTasks.length - manualReviewOnlyCount,
      policy: "sensitive-body-blocked-and-risky-actions-manual-only",
    };
    manifest.exportComplete = true;
    manifest.expectedAgentTaskFiles = snapshot.tasks.length;

    writePrivateJson(resolve(this.outputPath, "agent-input.json"), {
      schemaVersion: snapshot.schemaVersion,
      exportedAt,
      source: snapshot.source,
      selection: snapshot.selection,
      tasks: agentTasks,
    });
    writePrivateText(
      resolve(this.outputPath, "review.md"),
      buildReviewMarkdown({ ...snapshot, tasks: agentTasks }, manifest),
    );

    const usedNames = new Set();
    for (const task of snapshot.tasks) {
      const fileName = safeTaskFileName(task.sourceId);
      if (usedNames.has(fileName)) {
        throw new Error(`할 일 파일명이 충돌했습니다: ${fileName}`);
      }
      usedNames.add(fileName);
      const agentTask = agentTasks.find((candidate) => candidate.sourceId === task.sourceId);
      writePrivateText(resolve(agentTasksDirectory, fileName), taskToMarkdown(agentTask));
    }
    writePrivateJson(resolve(this.outputPath, "manifest.json"), manifest);

    return manifest;
  }
}

function writePrivateJson(filePath, value) {
  writePrivateText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writePrivateText(filePath, value) {
  writeFileSync(filePath, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function fingerprintFile(filePath) {
  if (!existsSync(filePath)) return null;
  const bytes = readFileSync(filePath);
  const stats = statSync(filePath);
  return {
    fileName: filePath.endsWith("-wal")
      ? "OSXCoreDataObjC.storedata-wal"
      : filePath.endsWith("-shm")
        ? "OSXCoreDataObjC.storedata-shm"
        : "OSXCoreDataObjC.storedata",
    size: stats.size,
    modifiedAtMs: stats.mtimeMs,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function fingerprintTickTickSource(databasePath) {
  const source = resolve(databasePath);
  return {
    database: fingerprintFile(source),
    wal: fingerprintFile(`${source}-wal`),
    shm: fingerprintFile(`${source}-shm`),
  };
}

export function sourceFingerprintsEqual(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

export function buildDefaultOutputPath(workspacePath) {
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return resolve(workspacePath, ".codex-artifacts/ticktick-local-export", stamp);
}
