#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  fingerprintTickTickSource,
  sourceFingerprintsEqual,
  TickTickExportWriter,
  TickTickLocalReader,
} from "./ticktick-local-export-lib.mjs";

let assertions = 0;
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

const runId = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${process.pid}`;
const qaRoot = resolve(".codex-artifacts/ticktick-local-export-qa", runId);
const fixtureDirectory = resolve(qaRoot, "fixture");
const databasePath = resolve(fixtureDirectory, "OSXCoreDataObjC.storedata");
const outputPath = resolve(qaRoot, "output");
const fixtureAwsSigninHost = `${"123456789012"}.signin.aws.amazon.com`;
const fixtureAwsSigninUrl = `https://${fixtureAwsSigninHost}/console`;
const fixtureGitHubToken = ["github", "pat", "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"].join("_");
const fixtureOpenAiKey = ["sk", "proj", "ABCDEFGHIJKLMNOPQRSTUV"].join("-");
mkdirSync(fixtureDirectory, { recursive: true, mode: 0o700 });

const db = new DatabaseSync(databasePath);
db.exec(`
  CREATE TABLE ZTTPROJECT (
    Z_PK INTEGER PRIMARY KEY,
    ZISINBOX INTEGER,
    ZSORTORDER INTEGER,
    ZENTITYID TEXT,
    ZKIND TEXT,
    ZNAME TEXT
  );
  CREATE TABLE ZTTTASK (
    Z_PK INTEGER PRIMARY KEY,
    ZALLDAY INTEGER,
    ZDELETIONSTATUS INTEGER,
    ZPRIORITY INTEGER,
    ZSORTORDER INTEGER,
    ZSTATUS INTEGER,
    ZPROJECT INTEGER,
    ZCREATIONDATE REAL,
    ZENDDATE REAL,
    ZLASTMODIFIEDDATE REAL,
    ZSTARTDATE REAL,
    ZCONTENT TEXT,
    ZDEZCRIPTION TEXT,
    ZENTITYID TEXT,
    ZETAG TEXT,
    ZKIND TEXT,
    ZNOTIONBLOCKSTRING TEXT,
    ZPROJECTID TEXT,
    ZREPEATRULE TEXT,
    ZSTRINGOFTAGS TEXT,
    ZTIMEZONENAME TEXT,
    ZTITLE TEXT,
    ZACCOUNTID TEXT
  );
  CREATE TABLE ZTTCHECKLISTITEM (
    Z_PK INTEGER PRIMARY KEY,
    ZALLDAY INTEGER,
    ZSORTORDER INTEGER,
    ZSTATUS INTEGER,
    ZTASK INTEGER,
    ZCOMPLETIONDATE REAL,
    ZSTARTDATE REAL,
    ZENTITYID TEXT,
    ZTITLE TEXT
  );
  CREATE TABLE ZTTREMINDER (
    Z_PK INTEGER PRIMARY KEY,
    ZTASK INTEGER,
    ZENTITYID TEXT,
    ZRULE BLOB
  );
  CREATE TABLE ZTTATTACHMENT (
    Z_PK INTEGER PRIMARY KEY,
    ZFILESIZE INTEGER,
    ZFILETYPE INTEGER,
    ZSTATUS INTEGER,
    ZTASK INTEGER,
    ZCREATIONDATE REAL,
    ZLASTMODIFIEDDATE REAL,
    ZENTITYID TEXT,
    ZFILENAME TEXT,
    ZLOCALFILEPATH TEXT,
    ZREMOTEFILEURL BLOB
  );
`);

db.prepare("INSERT INTO ZTTPROJECT VALUES (?, ?, ?, ?, ?, ?)").run(
  1, 1, 0, "project-inbox", "TASK", "Inbox",
);
db.prepare("INSERT INTO ZTTPROJECT VALUES (?, ?, ?, ?, ?, ?)").run(
  2, 0, 1, "project-study", "TASK", "학습 study@example.com",
);

const insertTask = db.prepare(`
  INSERT INTO ZTTTASK VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);
insertTask.run(
  1, 1, 0, 5, -4611686020554227712n, 0, 1,
  800000000, null, 800000100, 800000050,
  "긴 본문입니다. contact@example.com", "", "task-active-1", "etag-1", "TEXT", null,
  "project-inbox", "RRULE:FREQ=DAILY;INTERVAL=1", "업무,개인", "Asia/Seoul",
  "활성 긴 메모", "secret-account",
);
insertTask.run(
  10, 0, 0, 0, 10, 0, 1,
  800000000, null, 800000100, null,
  "hermes sessions optimize-storage\nhermes skills install optional/example", "",
  "task-mutating-cli", "etag-10", "TEXT", null,
  "project-inbox", null, null, "Asia/Seoul", "상태 변경 CLI", "secret-account",
);
insertTask.run(
  8, 0, 0, 0, 8, 0, 1,
  800000000, null, 800000100, null,
  "회사 RDS에서 테스트 DB 삭제", "",
  "task-destructive-ko", "etag-8", "TEXT", null,
  "project-inbox", null, null, "Asia/Seoul", "한국어 삭제 메모", "secret-account",
);
insertTask.run(
  9, 0, 0, 0, 9, 0, 1,
  800000000, null, 800000100, null,
  "삼전 매수 여부 결정", "",
  "task-financial-ko", "etag-9", "TEXT", null,
  "project-inbox", null, null, "Asia/Seoul", "한국어 투자 결정", "secret-account",
);
insertTask.run(
  6, 0, 0, 0, 6, 0, 1,
  800000000, null, 800000100, null,
  "#!/bin/zsh\npkill -TERM -f '/Applications/Example.app'", "",
  "task-destructive", "etag-6", "TEXT", null,
  "project-inbox", null, null, "Asia/Seoul", "프로세스 정리 스크립트", "secret-account",
);
insertTask.run(
  7, 0, 0, 0, 7, 0, 1,
  800000000, null, 800000100, null,
  "ISA 계좌에서 주식 투자 여부 결정", "",
  "task-financial", "etag-7", "TEXT", null,
  "project-inbox", null, null, "Asia/Seoul", "투자 결정", "secret-account",
);
insertTask.run(
  2, 0, 0, 0, 2, 0, 2,
  800000000, 800000200, 800000100, null,
  "", "", "task-active-2", "etag-2", "TEXT",
  JSON.stringify([{ key: "url", value: { id: "link", type: "url", url: "https://example.test", ownerEmail: "rich@example.com" } }]),
  "project-study", null, null, "Asia/Seoul", "리치 메타데이터", "secret-account",
);
insertTask.run(
  5, 0, 0, 0, 5, 0, 1,
  800000000, null, 800000100, null,
  `AWS root password: super-secret-value ${fixtureAwsSigninUrl}`, "",
  "task-sensitive", "etag-5", "TEXT", null,
  "project-inbox", null, fixtureGitHubToken, "Asia/Seoul",
  `자격증명 ${fixtureOpenAiKey}`, "secret-account",
);
insertTask.run(
  3, 0, 0, 0, 3, 2, 1,
  800000000, null, 800000100, null,
  "완료 본문", "", "task-completed", "etag-3", "TEXT", null,
  "project-inbox", null, null, "Asia/Seoul", "완료 항목", "secret-account",
);
insertTask.run(
  4, 0, 1, 0, 4, 0, 1,
  800000000, null, 800000100, null,
  "삭제 본문", "", "task-deleted", "etag-4", "TEXT", null,
  "project-inbox", null, null, "Asia/Seoul", "삭제 항목", "secret-account",
);
db.prepare("INSERT INTO ZTTCHECKLISTITEM VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
  1, 0, 1, 0, 1, null, null, "check-1", "하위 contact-child@example.com",
);
db.prepare("INSERT INTO ZTTREMINDER VALUES (?, ?, ?, ?)").run(
  1, 1, "reminder-1", Buffer.from("private-reminder-rule"),
);
db.prepare("INSERT INTO ZTTATTACHMENT VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
  1, 123, 2, 0, 1, 800000000, 800000100, "attachment-1", "자료.pdf",
  "/private/local/path", Buffer.from("https://private.example/attachment"),
);
db.close();

const before = fingerprintTickTickSource(databasePath);
const reader = new TickTickLocalReader(databasePath);
const snapshot = reader.readActiveSnapshot({ expectedActiveCount: 8 });
const after = fingerprintTickTickSource(databasePath);
const activeLongMemo = snapshot.tasks.find((task) => task.sourceId === "task-active-1");
const richMetadataTask = snapshot.tasks.find((task) => task.sourceId === "task-active-2");

equal(snapshot.tasks.length, 8, "활성 항목만 추출한다");
check(activeLongMemo, "긴 메모 fixture를 원본 ID로 찾는다");
check(richMetadataTask, "리치 메타데이터 fixture를 원본 ID로 찾는다");
equal(activeLongMemo.sourceId, "task-active-1", "원본 ID를 보존한다");
equal(activeLongMemo.project.name, "기본함", "기본함 이름을 정규화한다");
equal(activeLongMemo.priority.label, "높음", "TickTick 우선순위를 매핑한다");
equal(activeLongMemo.sortOrder, "-4611686020554227712", "큰 정렬값을 손실 없이 문자열로 보존한다");
equal(activeLongMemo.tags.length, 2, "쉼표 태그를 배열로 바꾼다");
equal(activeLongMemo.checklistItems.length, 1, "하위 할 일을 연결한다");
equal(activeLongMemo.reminders.length, 1, "알림 메타데이터를 연결한다");
equal(activeLongMemo.attachments.length, 1, "첨부 메타데이터를 연결한다");
check(activeLongMemo.startDate?.startsWith("2026-"), "Core Data 날짜를 ISO로 바꾼다");
check(richMetadataTask.richMetadataValid, "리치 메타데이터 JSON을 검증한다");
equal(richMetadataTask.richMetadata[0].key, "url", "리치 메타데이터를 보존한다");
check(snapshot.quality.passed, "fixture 품질 검사를 통과한다");
check(sourceFingerprintsEqual(before, after), "읽기 전후 fixture DB가 바뀌지 않는다");

const writer = new TickTickExportWriter({ outputPath, sourceDatabasePath: databasePath });
const manifest = writer.write(snapshot, { before, after, stable: true });
check(manifest.quality.passed, "manifest 품질 상태가 PASS다");
check(manifest.exportComplete, "manifest가 완료 영수증임을 표시한다");
equal(manifest.expectedAgentTaskFiles, 8, "manifest에 기대 파일 수를 기록한다");
check(existsSync(resolve(outputPath, "manifest.json")), "manifest.json을 만든다");
check(existsSync(resolve(outputPath, "agent-input.json")), "agent-input.json을 만든다");
check(existsSync(resolve(outputPath, "review.md")), "review.md를 만든다");
equal(readdirSync(resolve(outputPath, "agent-tasks")).length, 8, "에이전트용 Markdown을 만든다");

const exportedText = [
  readFileSync(resolve(outputPath, "manifest.json"), "utf8"),
  readFileSync(resolve(outputPath, "agent-input.json"), "utf8"),
  readFileSync(resolve(outputPath, "review.md"), "utf8"),
  ...readdirSync(resolve(outputPath, "agent-tasks")).map((file) => (
    readFileSync(resolve(outputPath, "agent-tasks", file), "utf8")
  )),
].join("\n");
check(!exportedText.includes("secret-account"), "계정 ID를 출력하지 않는다");
check(!exportedText.includes("/private/local/path"), "첨부 로컬 경로를 출력하지 않는다");
check(!exportedText.includes("https://private.example/attachment"), "첨부 원격 URL을 출력하지 않는다");
check(!exportedText.includes("contact@example.com"), "에이전트 입력에서 이메일을 가린다");
check(!exportedText.includes("contact-child@example.com"), "하위 할 일 이메일도 가린다");
check(!exportedText.includes("study@example.com"), "프로젝트 이름 이메일도 가린다");
check(!exportedText.includes("rich@example.com"), "리치 메타데이터 안 이메일도 가린다");
check(!exportedText.includes(fixtureOpenAiKey), "제목 안 API 키도 가린다");
check(!exportedText.includes(fixtureGitHubToken), "태그 안 토큰도 가린다");
check(!exportedText.includes("https://example.test"), "리치 메타데이터 원문 URL을 복제하지 않는다");
check(exportedText.includes('"richMetadataSummary"'), "리치 메타데이터는 구조 요약만 남긴다");
check(!exportedText.includes("super-secret-value"), "비밀번호 의심 본문을 복제하지 않는다");
check(!exportedText.includes(fixtureAwsSigninHost), "클라우드 로그인 URL을 복제하지 않는다");
check(exportedText.includes("manual-review-only"), "민감 항목을 수동 검토 전용으로 표시한다");
const agentTasks = JSON.parse(readFileSync(resolve(outputPath, "agent-input.json"), "utf8")).tasks;
const destructiveTask = agentTasks.find((task) => task.sourceId === "task-destructive");
const financialTask = agentTasks.find((task) => task.sourceId === "task-financial");
const destructiveKoreanTask = agentTasks.find((task) => task.sourceId === "task-destructive-ko");
const financialKoreanTask = agentTasks.find((task) => task.sourceId === "task-financial-ko");
const mutatingCliTask = agentTasks.find((task) => task.sourceId === "task-mutating-cli");
check(destructiveTask.safety.destructiveActionSuspected, "파괴 가능 명령을 감지한다");
equal(destructiveTask.safety.action, "manual-review-only", "파괴 가능 명령은 자동 처리하지 않는다");
check(financialTask.safety.financialDecisionSuspected, "금융 판단을 감지한다");
equal(financialTask.safety.action, "manual-review-only", "금융 판단은 자동 처리하지 않는다");
check(destructiveKoreanTask.safety.destructiveActionSuspected, "한국어 삭제 문구를 감지한다");
equal(destructiveKoreanTask.safety.action, "manual-review-only", "한국어 삭제 문구는 자동 처리하지 않는다");
check(financialKoreanTask.safety.financialDecisionSuspected, "한국어 투자 문구를 감지한다");
equal(financialKoreanTask.safety.action, "manual-review-only", "한국어 투자 문구는 자동 처리하지 않는다");
check(mutatingCliTask.safety.mutatingCommandSuspected, "설치·저장 최적화 명령을 감지한다");
equal(mutatingCliTask.safety.action, "manual-review-only", "상태 변경 CLI는 자동 처리하지 않는다");

assertions += 1;
assert.throws(
  () => writer.write(snapshot, { before, after, stable: true }),
  /덮어쓰지 않습니다/u,
  "기존 출력 폴더 덮어쓰기를 거부한다",
);

assertions += 1;
assert.throws(
  () => new TickTickExportWriter({
    outputPath: resolve(fixtureDirectory, "unsafe-output"),
    sourceDatabasePath: databasePath,
  }).write(snapshot, { before, after, stable: true }),
  /TickTick 데이터 폴더 밖/u,
  "원본 DB 폴더 안 출력을 거부한다",
);

const unstableOutputPath = resolve(qaRoot, "unstable-output");
assertions += 1;
assert.throws(
  () => new TickTickExportWriter({
    outputPath: unstableOutputPath,
    sourceDatabasePath: databasePath,
  }).write(snapshot, { before, after, stable: false }),
  /원본이 바뀌어 출력하지 않습니다/u,
  "원본 해시가 바뀌면 출력하지 않는다",
);
check(!existsSync(unstableOutputPath), "원본 변동 실패 시 출력 폴더도 만들지 않는다");

const failedQualityOutputPath = resolve(qaRoot, "failed-quality-output");
const failedQualitySnapshot = {
  ...snapshot,
  quality: { ...snapshot.quality, passed: false },
};
assertions += 1;
assert.throws(
  () => new TickTickExportWriter({
    outputPath: failedQualityOutputPath,
    sourceDatabasePath: databasePath,
  }).write(failedQualitySnapshot, { before, after, stable: true }),
  /품질 검사가 실패해 출력하지 않습니다/u,
  "품질 검사 실패 시 출력하지 않는다",
);
check(!existsSync(failedQualityOutputPath), "품질 실패 시 출력 폴더도 만들지 않는다");

console.log(`qa-ticktick-local-export: ${assertions} assertions PASS`);
console.log(`qa-artifact: ${qaRoot}`);
