// 안전 가공본 포맷 — buildAgentSafeTask와 Markdown 출력 형식.
// 원래 scripts/ticktick-local-export-lib.mjs(769줄) 분리(2026-08-15 리팩토링 2순위).

import { createHash } from "node:crypto";

import { normalizeText } from "./normalize.mjs";
import {
  DESTRUCTIVE_ACTION_PATTERN,
  FINANCIAL_DECISION_PATTERN,
  MUTATING_CLI_PATTERN,
  detectSensitiveText,
  redactSensitiveValues,
  summarizeRichMetadata,
} from "./safety.mjs";

function safeTaskFileName(sourceId) {
  if (/^[A-Za-z0-9._-]+$/u.test(sourceId)) return `task-${sourceId}.md`;
  const digest = createHash("sha256").update(sourceId).digest("hex").slice(0, 16);
  return `task-${digest}.md`;
}

function yamlString(value) {
  return JSON.stringify(value ?? null);
}

function oneLine(value) {
  return normalizeText(value).replace(/\s+/gu, " ").trim();
}

function preview(value, maxLength = 240) {
  const compact = oneLine(value);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength)}…`;
}

export function buildAgentSafeTask(task) {
  const fullText = [
    task.project.name,
    task.title,
    task.content,
    task.description,
    task.tags.join("\n"),
    task.checklistItems.map((item) => item.title).join("\n"),
    task.richMetadata === null ? "" : JSON.stringify(task.richMetadata),
    task.richMetadataRaw ?? "",
  ].join("\n");
  const findings = detectSensitiveText(fullText);
  const blocked = findings.length > 0;
  const destructiveActionSuspected = DESTRUCTIVE_ACTION_PATTERN.test(fullText);
  const mutatingCommandSuspected = MUTATING_CLI_PATTERN.test(fullText);
  const financialDecisionSuspected = FINANCIAL_DECISION_PATTERN.test(fullText);
  const manualReviewOnly = blocked
    || destructiveActionSuspected
    || mutatingCommandSuspected
    || financialDecisionSuspected;
  return {
    ...task,
    project: {
      ...task.project,
      name: redactSensitiveValues(task.project.name),
    },
    title: redactSensitiveValues(task.title),
    content: blocked ? "[민감정보 의심 본문 가림 - 수동 검토 필요]" : redactSensitiveValues(task.content),
    description: blocked ? "" : redactSensitiveValues(task.description),
    tags: task.tags.map(redactSensitiveValues),
    checklistItems: task.checklistItems.map((item) => ({
      ...item,
      title: redactSensitiveValues(item.title),
    })),
    richMetadata: null,
    richMetadataRaw: null,
    richMetadataSummary: blocked ? null : summarizeRichMetadata(task.richMetadata),
    attachments: task.attachments.map((attachment) => ({
      ...attachment,
      fileName: attachment.fileName ? "[첨부파일명 가림]" : null,
    })),
    safety: {
      sensitiveContentSuspected: blocked,
      findings,
      destructiveActionSuspected,
      mutatingCommandSuspected,
      financialDecisionSuspected,
      action: manualReviewOnly ? "manual-review-only" : "agent-review-allowed",
    },
  };
}

export function taskToMarkdown(task) {
  const body = task.content || task.description;
  const metadata = task.richMetadataSummary !== null && task.richMetadataSummary !== undefined
    ? `\n## TickTick 리치 메타데이터 요약\n\n\`\`\`json\n${JSON.stringify(task.richMetadataSummary, null, 2)}\n\`\`\`\n`
    : "";
  const checklist = task.checklistItems.length > 0
    ? `\n## 하위 할 일\n\n${task.checklistItems.map((item) => `- [${item.completed ? "x" : " "}] ${oneLine(item.title)}`).join("\n")}\n`
    : "";

  return `---
source: "ticktick-local-snapshot"
sourceId: ${yamlString(task.sourceId)}
projectId: ${yamlString(task.project.sourceId)}
project: ${yamlString(task.project.name)}
inbox: ${task.project.isInbox}
title: ${yamlString(task.title)}
createdAt: ${yamlString(task.createdAt)}
updatedAt: ${yamlString(task.modifiedAt)}
startDate: ${yamlString(task.startDate)}
endDate: ${yamlString(task.endDate)}
dueDateCandidate: ${yamlString(task.ticksidianDueDateCandidate)}
priority: ${yamlString(task.priority.label)}
tags: ${JSON.stringify(task.tags)}
repeatRule: ${yamlString(task.repeatRule)}
---

# ${oneLine(task.title)}

${body}${checklist}${metadata}`;
}

export function buildReviewMarkdown(snapshot, manifest) {
  const groups = new Map();
  for (const task of snapshot.tasks) {
    if (!groups.has(task.project.name)) groups.set(task.project.name, []);
    groups.get(task.project.name).push(task);
  }

  const sections = [...groups.entries()].map(([projectName, tasks]) => {
    const rows = tasks.map((task) => {
      const body = task.content || task.description;
      const bodyPreview = preview(body);
      const details = [
        task.safety?.action === "manual-review-only" ? "자동 처리 금지: 수동 검토" : null,
        task.priority.label !== "없음" ? `우선순위: ${task.priority.label}` : null,
        task.ticksidianDueDateCandidate ? `날짜: ${task.ticksidianDueDateCandidate.slice(0, 10)}` : null,
        task.repeatRule ? "반복" : null,
        bodyPreview ? `본문 ${body.length}자: ${bodyPreview}` : "본문 없음",
      ].filter(Boolean).join(" · ");
      return `- [ ] **${oneLine(task.title)}**  \n  ${details}  \n  원본 ID: \`${task.sourceId}\``;
    });
    return `## ${oneLine(projectName)} (${tasks.length})\n\n${rows.join("\n")}`;
  });

  return `# TickTick 로컬 읽기 전용 검토표

## Why

TickTick 원본을 바꾸지 않고, [kyle]과 에이전트가 활성 할 일의 정리 후보를 검토하기 위한 스냅샷이다.

## 추출 요약

- 추출 시각: ${manifest.exportedAt}
- 활성 할 일: ${snapshot.tasks.length}개
- 본문 또는 리치 메타데이터 있음: ${snapshot.quality.checks.withBody}개
- 품질 검사: ${manifest.quality.passed ? "PASS" : "FAIL"}
- 원본 쓰기: 없음

> 이 파일의 체크박스는 검토 표시일 뿐 TickTick 완료 상태와 연결되지 않는다.

${sections.join("\n\n")}
`;
}

export { safeTaskFileName };
