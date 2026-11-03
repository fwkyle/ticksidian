const DEFAULT_NOTE_TITLE = "새 노트";

interface TextNodeLike {
  text?: unknown;
}

interface BlockLike {
  content?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readInlineText(node: unknown): string {
  if (!isRecord(node)) {
    return "";
  }

  if (node.type === 'link' && Array.isArray(node.content)) {
    return node.content.map(readInlineText).join('');
  }

  return typeof (node as TextNodeLike).text === "string"
    ? ((node as TextNodeLike).text as string)
    : "";
}

function readBlockText(block: BlockLike): string {
  if (!Array.isArray(block.content)) {
    return "";
  }

  return block.content.map(readInlineText).join("").trim();
}

export function getNoteTitleFromBlocks(blocks: readonly BlockLike[]): string {
  const firstBlock = blocks[0];
  if (!firstBlock) {
    return DEFAULT_NOTE_TITLE;
  }

  const extractedTitle = readBlockText(firstBlock);
  return extractedTitle.length > 0 ? extractedTitle : DEFAULT_NOTE_TITLE;
}

export { DEFAULT_NOTE_TITLE };
