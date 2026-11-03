import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import {
  buildAgentSafeTask,
  fingerprintTickTickSource,
  sourceFingerprintsEqual,
  TickTickLocalReader,
} from "./ticktick-local-export-lib.mjs";

const SECRET_PATTERNS = [
  /\bntn_[A-Za-z0-9]{20,}\b/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  /\bAIza[A-Za-z0-9_-]{30,}\b/gu,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu,
  /-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/gu,
];

function isPathInside(parentPath, candidatePath) {
  const rel = relative(resolve(parentPath), resolve(candidatePath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function yaml(value) {
  return JSON.stringify(value ?? null);
}

function safeHeading(value) {
  return String(value ?? "").replace(/[\r\n]+/gu, " ").trim() || "제목 없음";
}

function normalizeMarkdownBody(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+$/gmu, "")
    .trim();
}

function safeTaskFileName(sourceId) {
  if (/^[A-Za-z0-9._-]+$/u.test(sourceId)) return `ticktick-${sourceId}.md`;
  return `ticktick-${sha256(sourceId).slice(0, 24)}.md`;
}

function uniqueTags(task) {
  const values = [
    "ticktick-import",
    ...task.tags,
    task.project.isInbox ? "ticktick-inbox" : task.project.name,
    task.safety.action === "manual-review-only" ? "manual-review" : null,
  ].filter((value) => typeof value === "string" && value.trim() !== "");
  return [...new Set(values.map((value) => value.trim()))];
}

function todoBody(task) {
  const sections = [`# ${safeHeading(task.title)}`];
  const body = normalizeMarkdownBody(task.content) || normalizeMarkdownBody(task.description);
  if (body) sections.push(body);
  if (task.checklistItems.length > 0) {
    sections.push(
      "## 하위 할 일",
      task.checklistItems
        .map((item) => `- [${item.completed ? "x" : " "}] ${safeHeading(item.title)}`)
        .join("\n"),
    );
  }
  sections.push(
    "## 가져오기 정보",
    `- TickTick 목록: ${task.project.name}`,
    `- TickTick 원본 ID: \`${task.sourceId}\``,
    "- 원본 상태: TickTick에서 변경하지 않음",
  );
  if (task.safety.action === "manual-review-only") {
    sections.push(
      "> [!WARNING]\n> 실행·완료 전에 사람이 확인해야 하는 내용이 포함되어 있습니다.",
    );
  }
  return `${sections.join("\n\n")}\n`;
}

export function taskToTicksidianMarkdown(task, importedAt) {
  const noteId = `ticktick-${task.sourceId}`;
  const createdAt = task.createdAt ?? importedAt;
  const updatedAt = task.modifiedAt ?? importedAt;
  const dueDate = task.ticksidianDueDateCandidate?.slice(0, 10) ?? null;
  const lines = [
    "---",
    `id: ${yaml(noteId)}`,
    `title: ${yaml(task.title)}`,
    'type: "todo"',
    "done: false",
  ];
  if (dueDate) lines.push(`dueDate: ${yaml(dueDate)}`);
  if (task.priority.label !== "없음") lines.push(`priority: ${yaml(task.priority.label)}`);
  lines.push(
    `tags: ${JSON.stringify(uniqueTags(task))}`,
    `createdAt: ${yaml(createdAt)}`,
    `updatedAt: ${yaml(updatedAt)}`,
    `exportedAt: ${yaml(importedAt)}`,
    'source: "ticksidian"',
    'externalSource: "ticktick"',
    `externalSourceId: ${yaml(task.sourceId)}`,
    `importedAt: ${yaml(importedAt)}`,
    "---",
    "",
    todoBody(task).trimEnd(),
    "",
  );
  return lines.join("\n");
}

export function sensitiveTitlesToMarkdown(tasks, importedAt) {
  const titles = tasks.map((task) => safeHeading(task.title)).sort((a, b) => a.localeCompare(b, "ko"));
  return `---
id: "ticktick-sensitive-manual-review"
title: "TickTick 민감정보 수동관리"
createdAt: ${yaml(importedAt)}
updatedAt: ${yaml(importedAt)}
exportedAt: ${yaml(importedAt)}
source: "ticksidian"
tags: ["ticktick-import", "sensitive-manual-review"]
---

# TickTick 민감정보 수동관리

본문이나 값은 이관하지 않았다. 아래 제목의 원본은 TickTick에서 직접 확인하고 별도 비밀 저장소로 옮긴다.

${titles.map((title) => `- [ ] ${title}`).join("\n")}
`;
}

function assertNoKnownSecrets(fileMap) {
  for (const [fileName, content] of fileMap) {
    for (const pattern of SECRET_PATTERNS) {
      const found = pattern.test(content);
      pattern.lastIndex = 0;
      if (found) throw new Error(`민감값 패턴이 남아 있어 이관을 중단합니다: ${fileName}`);
    }
  }
}

function writePrivate(filePath, content) {
  writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function stageDirectory(vaultPath, stamp) {
  const staging = resolve(vaultPath, ".staging", `ticktick-import-${stamp}`);
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  return staging;
}

export class TickTickMarkdownImporter {
  constructor({ databasePath, vaultPath }) {
    this.databasePath = resolve(databasePath);
    this.vaultPath = resolve(vaultPath);
    this.targetPath = resolve(this.vaultPath, "notes", "ticktick-import");
  }

  importActiveTasks() {
    if (!existsSync(this.vaultPath)) throw new Error(`볼트를 찾지 못했습니다: ${this.vaultPath}`);
    if (isPathInside(dirname(this.databasePath), this.vaultPath)) {
      throw new Error("TickTick 원본 폴더 안으로 이관할 수 없습니다.");
    }

    const before = fingerprintTickTickSource(this.databasePath);
    const snapshot = new TickTickLocalReader(this.databasePath).readActiveSnapshot();
    const safeTasks = snapshot.tasks.map(buildAgentSafeTask);
    const after = fingerprintTickTickSource(this.databasePath);
    if (!snapshot.quality.passed) throw new Error("TickTick 데이터 품질 검사가 실패했습니다.");
    if (!sourceFingerprintsEqual(before, after)) {
      throw new Error("읽는 동안 TickTick 원본이 바뀌어 이관을 중단합니다.");
    }

    const importedAt = new Date().toISOString();
    const sensitive = safeTasks.filter((task) => task.safety.sensitiveContentSuspected);
    const importable = safeTasks.filter((task) => !task.safety.sensitiveContentSuspected);
    const files = new Map(importable.map((task) => [
      safeTaskFileName(task.sourceId),
      taskToTicksidianMarkdown(task, importedAt),
    ]));
    files.set("민감정보-수동관리.md", sensitiveTitlesToMarkdown(sensitive, importedAt));
    assertNoKnownSecrets(files);

    if (existsSync(this.targetPath)) {
      const created = [];
      const skipped = [];
      for (const [fileName, content] of files) {
        const target = resolve(this.targetPath, fileName);
        if (existsSync(target)) {
          skipped.push(fileName);
          continue;
        }
        writePrivate(target, content);
        created.push(fileName);
      }
      return this.#manifest({ snapshot, safeTasks, sensitive, files, created, skipped, importedAt, before, after });
    }

    const stamp = importedAt.replace(/[:.]/gu, "-");
    const staged = stageDirectory(this.vaultPath, stamp);
    for (const [fileName, content] of files) writePrivate(resolve(staged, fileName), content);
    for (const [fileName, content] of files) {
      const actual = readFileSync(resolve(staged, fileName), "utf8");
      if (actual !== content) throw new Error(`준비 파일 검증에 실패했습니다: ${fileName}`);
    }
    mkdirSync(dirname(this.targetPath), { recursive: true });
    renameSync(staged, this.targetPath);
    return this.#manifest({
      snapshot,
      safeTasks,
      sensitive,
      files,
      created: [...files.keys()],
      skipped: [],
      importedAt,
      before,
      after,
    });
  }

  #manifest({ snapshot, safeTasks, sensitive, files, created, skipped, importedAt, before, after }) {
    const outputHashes = Object.fromEntries([...files.keys()].map((fileName) => {
      const bytes = readFileSync(resolve(this.targetPath, fileName));
      return [fileName, createHash("sha256").update(bytes).digest("hex")];
    }));
    return {
      schemaVersion: 1,
      importedAt,
      sourceStableDuringRead: sourceFingerprintsEqual(before, after),
      activeTaskCount: snapshot.tasks.length,
      markdownTodoCount: safeTasks.length - sensitive.length,
      sensitiveTitleOnlyCount: sensitive.length,
      manualReviewTodoCount: safeTasks.filter((task) => task.safety.action === "manual-review-only" && !task.safety.sensitiveContentSuspected).length,
      createdCount: created.length,
      skippedCount: skipped.length,
      targetPath: this.targetPath,
      created,
      skipped,
      sensitiveTitles: sensitive.map((task) => task.title),
      outputHashes,
    };
  }
}
