export type TextFileDownloader = (filename: string, contents: string) => void;

export function downloadTextFile(filename: string, contents: string, mimeType = "text/markdown;charset=utf-8"): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
