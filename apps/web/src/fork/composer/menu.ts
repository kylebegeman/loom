import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";
import type { ComposerTrigger } from "~/composer-logic";
import { BOT_SLASH_SOURCE, useBotSlashItems } from "../bots/composer/slashSource";
import type { ForkComposerContext, ForkPromptReplace } from "./registry";

/** A fork entry in the composer's suggestion menu. */
export interface ForkComposerCommandItem {
  readonly id: string;
  readonly type: "loom";
  /** The source that offered the item and handles choosing it. */
  readonly source: string;
  readonly label: string;
  readonly description: string;
  readonly value: string;
}

/** Acts on a chosen slash item. The `/` token has already been removed from the prompt. */
export interface ForkSlashSource {
  readonly id: string;
  readonly select: (item: ForkComposerCommandItem, context: ForkComposerContext) => void;
}

const FORK_SLASH_SOURCES: ReadonlyArray<ForkSlashSource> = [BOT_SLASH_SOURCE];

/** Items fork sources offer under `/`, in a fixed hook order. One call per source. */
export function useForkSlashMenuItems(
  context: ForkComposerContext,
  active: boolean,
): ReadonlyArray<ForkComposerCommandItem> {
  const bots = useBotSlashItems(context, active);
  return bots;
}

function scoreItem(item: ForkComposerCommandItem, query: string): number | null {
  const scores = [
    scoreQueryMatch({
      value: item.label.replace(/^\/+/, "").toLowerCase(),
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: [":", "-", "_", "/"],
    }),
    scoreQueryMatch({
      value: item.description.toLowerCase(),
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
  ].filter((score): score is number => score !== null);
  return scores.length === 0 ? null : Math.min(...scores);
}

/** Ranked like upstream slash commands; listed after them. */
export function searchForkSlashItems(
  items: ReadonlyArray<ForkComposerCommandItem>,
  query: string,
): ForkComposerCommandItem[] {
  const normalized = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (!normalized) return [...items];
  const ranked: Array<{ item: ForkComposerCommandItem; score: number; tieBreaker: string }> = [];
  for (const item of items) {
    const score = scoreItem(item, normalized);
    if (score === null) continue;
    insertRankedSearchResult(
      ranked,
      { item, score, tieBreaker: item.label },
      Number.POSITIVE_INFINITY,
    );
  }
  return ranked.map((entry) => entry.item);
}

/** Removes the `/` token, then hands the item to its source. False when nothing happened. */
export function selectForkComposerItem(
  item: ForkComposerCommandItem,
  options: {
    readonly snapshot: { readonly value: string };
    readonly trigger: ComposerTrigger;
    readonly replace: ForkPromptReplace;
    readonly context: ForkComposerContext;
  },
): boolean {
  const source = FORK_SLASH_SOURCES.find((candidate) => candidate.id === item.source);
  if (source === undefined) return false;
  const { trigger, snapshot } = options;
  const applied = options.replace(trigger.rangeStart, trigger.rangeEnd, "", {
    expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
    focusEditorAfterReplace: false,
  });
  if (!applied) return false;
  source.select(item, options.context);
  return true;
}
