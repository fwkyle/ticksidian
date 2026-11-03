#!/usr/bin/env node
import { resolve } from "node:path";

import { DEFAULT_TICKTICK_DATABASE_PATH } from "./ticktick-local-export-lib.mjs";
import { TickTickMarkdownImporter } from "./ticktick-import-lib.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const vault = option("--vault");
if (!vault) {
  console.error("사용법: node scripts/ticktick-import-to-vault.mjs --vault /절대/볼트/경로 [--db /TickTick/DB]");
  process.exitCode = 2;
} else {
  const manifest = new TickTickMarkdownImporter({
    databasePath: option("--db", DEFAULT_TICKTICK_DATABASE_PATH),
    vaultPath: resolve(vault),
  }).importActiveTasks();
  console.log(JSON.stringify(manifest, null, 2));
}
