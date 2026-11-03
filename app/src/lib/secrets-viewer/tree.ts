import type { SecretFileMeta } from "../tauri-commands";

/**
 * 보안 메모 폴더 트리 조립/필터 규칙(TICK-SEC-001, 2026-08-20).
 *
 * 백엔드 walk_files가 이미 "oci/mysql-free-main.env" 같은 폴더 포함 상대경로를 주므로,
 * 여기서는 화면을 위한 순수 조립만 한다(IO 없음 — 컴포넌트에 경로 분해를 흩뿌리지 않는다).
 */
export type SecretTreeNode =
  | {
      kind: "folder";
      name: string;
      path: string;
      children: SecretTreeNode[];
      /** 하위(재귀 전체) 파일 수 — 폴더 배지 표시용 */
      fileCount: number;
      /** 필터 후 남은 하위 파일 수. 필터 없을 때는 fileCount와 같다 */
      matchCount: number;
    }
  | { kind: "file"; file: SecretFileMeta };

interface FolderBucket {
  name: string;
  path: string;
  folders: Map<string, FolderBucket>;
  files: SecretFileMeta[];
}

function newFolder(name: string, path: string): FolderBucket {
  return { name, path, folders: new Map(), files: [] };
}

function countFiles(nodes: readonly SecretTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === "file") count += 1;
    else count += node.fileCount;
  }
  return count;
}

function bucketToNodes(bucket: FolderBucket): SecretTreeNode[] {
  const children: SecretTreeNode[] = [];
  for (const folder of [...bucket.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const folderChildren = bucketToNodes(folder);
    const fileCount = countFiles(folderChildren);
    children.push({
      kind: "folder",
      name: folder.name,
      path: folder.path,
      children: folderChildren,
      fileCount,
      matchCount: fileCount,
    });
  }
  for (const file of [...bucket.files].sort((a, b) => a.path.localeCompare(b.path))) {
    children.push({ kind: "file", file });
  }
  return children;
}

/** 파일 목록(폴더 포함 상대경로)을 폴더/파일 트리로 조립한다. 같은 레벨에서 폴더를 먼저 둔다. */
export function buildSecretFileTree(files: readonly SecretFileMeta[]): SecretTreeNode[] {
  const root = newFolder("", "");
  for (const file of files) {
    const segments = file.path.split("/");
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const name = segments[i];
      if (!cursor.folders.has(name)) {
        cursor.folders.set(name, newFolder(name, segments.slice(0, i + 1).join("/")));
      }
      cursor = cursor.folders.get(name)!;
    }
    cursor.files.push(file);
  }
  return bucketToNodes(root);
}

function filterList(nodes: readonly SecretTreeNode[], query: string): SecretTreeNode[] {
  const kept: SecretTreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === "file") {
      if (node.file.path.toLowerCase().includes(query)) kept.push(node);
      continue;
    }
    // 폴더 경로 자체가 걸리면 하위 전체가 결과다(하위 파일 전부 매칭으로 친다).
    if (node.path.toLowerCase().includes(query)) {
      kept.push({ ...node, matchCount: node.fileCount });
      continue;
    }
    const keptChildren = filterList(node.children, query);
    const matchCount = keptChildren.reduce(
      (sum, child) => sum + (child.kind === "file" ? 1 : child.matchCount),
      0,
    );
    if (matchCount > 0) {
      kept.push({ ...node, children: keptChildren, matchCount });
    }
  }
  return kept;
}

/**
 * 경로 포함 검색(대소문자 무시). 폴더는 자기 경로가 걸리거나 하위 파일이 하나라도 걸리면
 * 남는다. 빈 쿼리는 원래 트리를 그대로 돌려준다.
 */
export function filterSecretTree(
  nodes: readonly SecretTreeNode[],
  query: string,
): SecretTreeNode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...nodes];
  return filterList(nodes, normalized);
}

/** 트리의 모든 폴더 경로를 pre-order(폴더 → 하위 폴더)로 수집한다 — 새 메모 폴더 선택용. */
export function collectFolderPaths(nodes: readonly SecretTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    paths.push(node.path);
    paths.push(...collectFolderPaths(node.children));
  }
  return paths;
}

export interface SecretTreeRow {
  readonly node: SecretTreeNode;
  readonly depth: number;
}

/** 펼친 행만 순서대로 모은다. DOM은 이 결과의 한 페이지에 대해서만 만든다. */
export function collectVisibleSecretRows(
  nodes: readonly SecretTreeNode[],
  expandedFolders: ReadonlySet<string>,
  filterActive: boolean,
): SecretTreeRow[] {
  const rows: SecretTreeRow[] = [];
  const visit = (children: readonly SecretTreeNode[], depth: number) => {
    for (const node of children) {
      rows.push({ node, depth });
      if (node.kind === "folder" && (filterActive || expandedFolders.has(node.path))) {
        visit(node.children, depth + 1);
      }
    }
  };
  visit(nodes, 0);
  return rows;
}
