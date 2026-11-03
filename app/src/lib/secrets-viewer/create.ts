/**
 * 새 보안 메모 경로 조립 규칙(TICK-SEC-002, 2026-08-20).
 * 폴더는 트리에서 온 검증된 값, 파일명만 사용자 자유 입력이라 여기서 걸러낸다.
 * Rust validate_rel_path가 최종 가드다(1차 프론트 검증으로 IPC 낭비를 줄인다).
 */
export function buildNewSecretRelPath(folderPath: string, fileName: string): string | null {
  const folder = folderPath.trim();
  const name = fileName.trim();
  if (!name) return null;
  if (name.includes("/") || name.includes("\\")) return null;
  if (name === "." || name === "..") return null;
  if (folder) return `${folder}/${name}`;
  return name;
}
