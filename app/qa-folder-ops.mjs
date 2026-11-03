import { createMemoryVaultAdapter } from "./src/lib/memory-vault-adapter.ts";
import { createReporter } from "./qa/sync-queue-test-kit.mjs";

const { check, summary } = createReporter();

function makeVault() {
  return createMemoryVaultAdapter({
    initialVaultPath: "/mock-vault",
    initialDirectories: ["/mock-vault/lectures"],
    initialFiles: {
      "/mock-vault/lectures/a.md": "# 강의 A",
      "/mock-vault/lectures/os/b.md": "# 강의 B",
    },
  });
}

async function collectPaths(adapter) {
  const out = [];
  const walk = async (dir) => {
    for (const entry of await adapter.listDirectoryEntries(dir)) {
      out.push(entry.path);
      if (entry.isDir) await walk(entry.path);
    }
  };
  await walk("/mock-vault");
  return out.sort();
}

{
  const adapter = makeVault();
  await adapter.renameDirectory("/mock-vault/lectures", "강의자료");
  const paths = await collectPaths(adapter);
  check("폴더 rename은 하위 파일 경로를 바꾼다", paths.includes("/mock-vault/강의자료/a.md"));
  check("폴더 rename은 중첩 파일도 바꾼다", paths.includes("/mock-vault/강의자료/os/b.md"));
  check("원본 폴더는 사라진다", !paths.includes("/mock-vault/lectures/a.md"));
}

{
  const adapter = makeVault();
  await adapter.trashDirectory("/mock-vault/lectures");
  const paths = await collectPaths(adapter);
  check("폴더 trash는 하위 파일을 .trash 아래로 옮긴다",
    paths.some((p) => p.includes("/.trash/ticksidian/lectures/a.md")));
  check("원본 폴더 파일은 목록에서 사라진다", !paths.includes("/mock-vault/lectures/a.md"));
}

const result = summary();
console.log(`\n${result.assertions} assertions, ${result.failures} failures`);
if (result.failures > 0) process.exit(1);
