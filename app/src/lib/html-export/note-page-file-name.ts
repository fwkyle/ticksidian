// Rust 원자적 쓰기는 `.{target}.ticksidian-tmp-{pid}` 임시 파일을 먼저 만든다.
// macOS 255바이트 한계 안에 그 접두·접미와 PID까지 들어갈 여유를 남긴다.
const MAX_ATOMIC_TARGET_FILE_NAME_BYTES = 220;
const HASH_OFFSET_BASIS = 14_695_981_039_346_656_037n;
const HASH_PRIME = 1_099_511_628_211n;
const LONG_NAME_PREFIX_LENGTH = 80;

function fnv1a64(value: string): string {
  let hash = HASH_OFFSET_BASIS;

  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * HASH_PRIME);
  }

  return hash.toString(16).padStart(16, "0");
}

/**
 * 노트 ID를 macOS 파일명 한계 안의 안정적인 HTML 파일명으로 바꾼다.
 * 기존에 안전했던 짧은 ID의 파일명은 그대로 유지한다.
 */
export function notePageFileName(noteId: string): string {
  const encodedNoteId = encodeURIComponent(noteId);
  const legacyFileName = `note-${encodedNoteId}.html`;
  const hasAsciiUppercase = /[A-Z]/.test(noteId);

  if (
    !hasAsciiUppercase &&
    new TextEncoder().encode(legacyFileName).byteLength <=
    MAX_ATOMIC_TARGET_FILE_NAME_BYTES
  ) {
    return legacyFileName;
  }

  return `note-${encodedNoteId.slice(0, LONG_NAME_PREFIX_LENGTH)}-${fnv1a64(noteId)}.html`;
}
