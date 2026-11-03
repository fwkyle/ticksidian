import type { VaultAdapter } from '../lib/vault-adapter';

/** 제어 가능한 가짜 AI/파일 이동. 실제 모델 품질·rename 원자성은 검증하지 않는다. */
export interface InboxOrganizerFixture {
  calls: { content: string; folders: string[]; vaultPath: string; sourcePath: string }[];
  response: unknown;
  failRecommend: boolean;
  failMove: boolean;
  delayMs: number;
}
declare global { interface Window { __qa_inboxOrganizer: InboxOrganizerFixture } }

export function createInboxOrganizerFixture(adapter: VaultAdapter) {
  const state: InboxOrganizerFixture = { calls: [], response: { folder: 'notes', reason: '앱 설계 내용이라 기존 notes 폴더를 추천합니다.' }, failRecommend: false, failMove: false, delayMs: 0 };
  window.__qa_inboxOrganizer = state;
  async function read(path: string) {
    const content = await adapter.readTextFile(path);
    const stat = await adapter.getFileStat(path);
    return { content, version: JSON.stringify([content, stat.modifiedAt]) };
  }
  return async (cmd: string, p: Record<string, unknown>) => {
    const vaultPath = String(p.vaultPath);
    const sourcePath = String(p.sourcePath);
    if (!/^inbox\/[^/]+\.md$/.test(sourcePath) || sourcePath.includes('..')) throw new Error('기본함 노트가 아닙니다.');
    const path = `${vaultPath}/${sourcePath}`;
    const snapshot = await read(path);
    if (cmd === 'read_inbox_organizer_note') return snapshot;
    if (snapshot.version !== p.expectedVersion) throw new Error('추천 이후 원본이 바뀌었습니다. 다시 읽고 추천받아 주세요.');
    if (cmd === 'recommend_inbox_folder') {
      const folders = p.folders as string[];
      state.calls.push({ content: snapshot.content, folders, vaultPath, sourcePath });
      if (state.delayMs) await new Promise(resolve => setTimeout(resolve, state.delayMs));
      if (state.failRecommend) throw new Error('AI 요청 실패. 원본은 그대로입니다.');
      if ((await read(path)).version !== p.expectedVersion) throw new Error('추천 이후 원본이 바뀌었습니다. 다시 읽고 추천받아 주세요.');
      return state.response;
    }
    if (state.failMove) throw new Error('권한 문제로 이동하지 못했습니다. 원본은 그대로입니다.');
    const target = `${vaultPath}/${String(p.folder)}/${sourcePath.slice('inbox/'.length)}`;
    const entries = await adapter.listDirectoryEntries(`${vaultPath}/${String(p.folder)}`);
    if (entries.some(entry => entry.path === target)) throw new Error('같은 이름의 파일이 있습니다. 덮어쓰지 않았습니다.');
    await adapter.writeTextFile(target, snapshot.content);
    await adapter.deleteFile(path);
    return null;
  };
}
