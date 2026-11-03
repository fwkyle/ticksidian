import type { FolderNode, NoteListItem } from '../types/note';

export interface InboxCandidate { path: string; title: string }
export interface InboxSnapshot { content: string; version: string }
export interface FolderSuggestion { folder: string | null; reason: string }

function safeRelative(path: string): boolean {
  return !path.includes('\\') && !path.includes('\0') && path.split('/').every(s => s.length > 0 && !s.startsWith('.'));
}

export function inboxCandidates(notes: readonly NoteListItem[]): InboxCandidate[] {
  return notes.filter(note => note.folder === 'inbox' && !note.drawing && !note.excalidrawPlugin)
    .map(note => ({ path: `inbox/${note.fileBasename}.md`, title: note.title }))
    .filter(note => safeRelative(note.path) && note.path.split('/').length === 2 && !note.path.toLowerCase().endsWith('.excalidraw.md'));
}

export function organizerFolders(nodes: readonly FolderNode[]): string[] {
  const result = new Set<string>();
  function visit(items: readonly FolderNode[]) {
    for (const item of items) {
      if (!safeRelative(item.path) || ['inbox', 'archive', 'attachments'].includes(item.path.split('/')[0].toLowerCase())) continue;
      result.add(item.path);
      visit(item.children);
    }
  }
  visit(nodes);
  return [...result];
}

export function validateFolderSuggestion(value: unknown, folders: readonly string[]): FolderSuggestion {
  if (!value || typeof value !== 'object' || !('folder' in value) || !('reason' in value)
    || (value.folder !== null && (typeof value.folder !== 'string' || !folders.includes(value.folder)))
    || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000) {
    throw new Error('AI가 잘못된 폴더 추천을 반환했습니다. 다시 요청해 주세요.');
  }
  return { folder: value.folder, reason: value.reason };
}
