// TickTick Core Data 읽기 전용 리더 — SQLite 조회와 스키마 검증만 담는다.
// 원래 scripts/ticktick-local-export-lib.mjs(769줄) 분리(2026-08-15 리팩토링 2순위).

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  bytesMetadata,
  normalizeNullableText,
  normalizeText,
  parseRichMetadata,
  parseTags,
  priorityLabel,
  toIsoDate,
} from "./normalize.mjs";
import {
  ACTIVE_TASK_QUERY,
  ATTACHMENT_QUERY,
  CHECKLIST_QUERY,
  REMINDER_QUERY,
  REQUIRED_SCHEMA,
} from "./queries.mjs";

export const DEFAULT_TICKTICK_DATABASE_PATH = resolve(
  homedir(),
  "Library/Group Containers/75TY9UT8AY.com.TickTick.task.mac/OSXCoreDataObjC.storedata",
);

function groupRowsByTask(rows, mapRow) {
  const grouped = new Map();
  for (const row of rows) {
    const taskId = normalizeText(row.task_id);
    if (!grouped.has(taskId)) grouped.set(taskId, []);
    grouped.get(taskId).push(mapRow(row));
  }
  return grouped;
}

function buildTask(row, related) {
  const rich = parseRichMetadata(row.rich_metadata);
  const startDate = toIsoDate(row.start_date);
  const endDate = toIsoDate(row.end_date);
  const projectId = normalizeNullableText(row.project_id)
    ?? normalizeNullableText(row.stored_project_id);

  return {
    source: "ticktick-local-snapshot",
    sourceId: normalizeText(row.source_id),
    etag: normalizeNullableText(row.etag),
    project: {
      sourceId: projectId,
      name: row.project_is_inbox === 1
        ? "기본함"
        : (normalizeNullableText(row.project_name) ?? "목록 없음"),
      isInbox: row.project_is_inbox === 1,
      kind: normalizeNullableText(row.project_kind),
      sortOrder: row.project_sort_order ?? null,
    },
    title: normalizeText(row.title),
    content: normalizeText(row.content),
    description: normalizeText(row.description),
    kind: normalizeNullableText(row.kind),
    allDay: row.all_day === 1,
    startDate,
    endDate,
    ticksidianDueDateCandidate: endDate ?? startDate,
    timezone: normalizeNullableText(row.timezone),
    priority: {
      ticktickValue: Number(row.priority ?? 0),
      label: priorityLabel(Number(row.priority ?? 0)),
    },
    tags: parseTags(row.tags),
    repeatRule: normalizeNullableText(row.repeat_rule),
    sortOrder: row.sort_order ?? null,
    createdAt: toIsoDate(row.creation_date),
    modifiedAt: toIsoDate(row.modified_date),
    checklistItems: related.checklists.get(normalizeText(row.source_id)) ?? [],
    reminders: related.reminders.get(normalizeText(row.source_id)) ?? [],
    attachments: related.attachments.get(normalizeText(row.source_id)) ?? [],
    richMetadata: rich.value,
    richMetadataRaw: rich.raw,
    richMetadataValid: rich.valid,
  };
}

function buildQuality(tasks, expectedActiveCount) {
  const ids = tasks.map((task) => task.sourceId);
  const uniqueIds = new Set(ids.filter(Boolean));
  const missingSourceIds = ids.filter((id) => id === "").length;
  const duplicateSourceIds = ids.length - missingSourceIds - uniqueIds.size;
  const blankTitles = tasks.filter((task) => task.title.trim() === "").length;
  const orphanProjects = tasks.filter((task) => task.project.sourceId === null).length;
  const invalidRichMetadata = tasks.filter((task) => !task.richMetadataValid).length;
  const withBody = tasks.filter((task) => (
    task.content.length > 0
    || task.description.length > 0
    || task.richMetadata !== null
    || task.richMetadataRaw !== null
  )).length;
  const expectedCountMatches = expectedActiveCount === null
    || tasks.length === expectedActiveCount;

  const checks = {
    extractedActiveTasks: tasks.length,
    expectedActiveCount,
    expectedCountMatches,
    missingSourceIds,
    duplicateSourceIds,
    blankTitles,
    orphanProjects,
    invalidRichMetadata,
    withBody,
    withoutBody: tasks.length - withBody,
  };

  return {
    passed: expectedCountMatches
      && missingSourceIds === 0
      && duplicateSourceIds === 0
      && blankTitles === 0
      && orphanProjects === 0
      && invalidRichMetadata === 0,
    checks,
  };
}

export class TickTickLocalReader {
  constructor(databasePath) {
    this.databasePath = resolve(databasePath);
  }

  readActiveSnapshot({ expectedActiveCount = null, limit = null } = {}) {
    if (!existsSync(this.databasePath)) {
      throw new Error(`TickTick 데이터베이스를 찾지 못했습니다: ${this.databasePath}`);
    }

    const db = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      db.exec("PRAGMA query_only=ON");
      this.#assertSchema(db);
      db.exec("BEGIN");
      try {
        const taskRows = db.prepare(ACTIVE_TASK_QUERY).all();
        const selectedRows = limit === null ? taskRows : taskRows.slice(0, limit);
        const selectedIds = new Set(selectedRows.map((row) => normalizeText(row.source_id)));

        const checklists = groupRowsByTask(
          db.prepare(CHECKLIST_QUERY).all().filter((row) => selectedIds.has(normalizeText(row.task_id))),
          (row) => ({
            sourceId: normalizeText(row.source_id),
            title: normalizeText(row.title),
            completed: Number(row.status ?? 0) !== 0,
            allDay: row.all_day === 1,
            startDate: toIsoDate(row.start_date),
            completedAt: toIsoDate(row.completion_date),
            sortOrder: row.sort_order ?? null,
          }),
        );
        const reminders = groupRowsByTask(
          db.prepare(REMINDER_QUERY).all().filter((row) => selectedIds.has(normalizeText(row.task_id))),
          (row) => ({
            sourceId: normalizeText(row.source_id),
            rule: bytesMetadata(row.rule),
          }),
        );
        const attachments = groupRowsByTask(
          db.prepare(ATTACHMENT_QUERY).all().filter((row) => selectedIds.has(normalizeText(row.task_id))),
          (row) => ({
            sourceId: normalizeText(row.source_id),
            fileName: normalizeNullableText(row.file_name),
            fileSize: row.file_size ?? null,
            fileType: row.file_type ?? null,
            status: row.status ?? null,
            createdAt: toIsoDate(row.creation_date),
            modifiedAt: toIsoDate(row.modified_date),
          }),
        );

        const tasks = selectedRows.map((row) => buildTask(row, {
          checklists,
          reminders,
          attachments,
        }));
        db.exec("COMMIT");

        const effectiveExpectedCount = limit === null ? expectedActiveCount : null;
        return {
          schemaVersion: 1,
          source: "ticktick-local-snapshot",
          selection: limit === null ? "active" : `active-first-${limit}`,
          tasks,
          quality: buildQuality(tasks, effectiveExpectedCount),
        };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      db.close();
    }
  }

  #assertSchema(db) {
    for (const [table, requiredColumns] of Object.entries(REQUIRED_SCHEMA)) {
      const exists = db.prepare(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(table);
      if (!exists) throw new Error(`지원하지 않는 TickTick DB: ${table} 테이블 없음`);

      const actualColumns = new Set(
        db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => row.name),
      );
      const missing = requiredColumns.filter((column) => !actualColumns.has(column));
      if (missing.length > 0) {
        throw new Error(`지원하지 않는 TickTick DB: ${table} 열 누락 (${missing.join(", ")})`);
      }
    }
  }
}
