import { invoke } from '@tauri-apps/api/core';
import { validateFolderSuggestion, type InboxSnapshot } from './inbox-organizer';

/** 모든 요청은 화면 진입 때의 볼트를 명시한다. 전역 볼트가 바뀌어도 다른 볼트에 쓰지 않는다. */
export class InboxOrganizerAdapter {
  private readonly vaultPath: string;
  constructor(vaultPath: string) { this.vaultPath = vaultPath; }
  read(sourcePath: string): Promise<InboxSnapshot> {
    return invoke('read_inbox_organizer_note', { vaultPath: this.vaultPath, sourcePath });
  }
  async recommend(sourcePath: string, expectedVersion: string, folders: readonly string[]) {
    const value: unknown = await invoke('recommend_inbox_folder', { vaultPath: this.vaultPath, sourcePath, expectedVersion, folders });
    return validateFolderSuggestion(value, folders);
  }
  move(sourcePath: string, folder: string, expectedVersion: string): Promise<void> {
    return invoke('move_inbox_organizer_note', { vaultPath: this.vaultPath, sourcePath, folder, expectedVersion });
  }
}
