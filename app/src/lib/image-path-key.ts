/** Compare names without changing the original Markdown or filesystem path. */
export function imagePathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}
