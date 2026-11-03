export type {
  WikiLinkMode,
  WikiLinkResolution,
  WikiLinkToken,
  LinkableNoteMeta,
  ResolvedWikiLink,
  BacklinkItem,
  LinkIndex,
} from "./wiki-link-types";

export { parseWikiLinks, parseSingleWikiLink } from "./wiki-link-parser";
export { resolveWikiLink, buildTitleKeyMap, collectTitleCandidates } from "./wiki-link-resolver";
export { normalizeLinkKey, isIdModeRef, extractNoteIdFromRef, extractContext } from "./wiki-link-utils";
export { LinkIndexBuilder, buildLinkIndex, getBacklinksForNote, applyNoteChange } from "./wiki-link-index";
export type { BuildLinkIndexInput, NoteChangeAction, NoteChangeInput } from "./wiki-link-index";
export { rewriteAmbiguousLinkInBlocks } from "./wiki-link-rewrite";
export type { RewriteResult } from "./wiki-link-rewrite";
