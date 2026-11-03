/**
 * useBacklinks
 *
 * 현재 활성 noteId 기준으로 backlink 목록을 반환한다.
 */

import { useMemo } from "react";
import type { LinkIndex, BacklinkItem } from "../lib/wiki-links";
import { getBacklinksForNote } from "../lib/wiki-links";

export interface UseBacklinksResult {
  backlinks: BacklinkItem[];
}

export function useBacklinks(
  activeNoteId: string | null,
  linkIndex: LinkIndex | null,
): UseBacklinksResult {
  const backlinks = useMemo(() => {
    if (!activeNoteId || !linkIndex) return [];
    return getBacklinksForNote(linkIndex, activeNoteId);
  }, [activeNoteId, linkIndex]);

  return { backlinks };
}
