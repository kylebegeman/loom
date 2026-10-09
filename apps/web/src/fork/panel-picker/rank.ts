import type { PanelPickerAction } from "./types";

/** Recent rows shown above the full list when the search is empty. */
export const RECENT_ROWS = 3;

const UPSTREAM_SURFACE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  Browser: "Preview a page in the built-in browser.",
  Terminal: "Open a shell in this thread's workspace.",
  Files: "Browse and open project files.",
  Diff: "Review this thread's changes.",
  "Pull request": "Review this branch's pull request.",
  "Linked pull requests": "Pull requests linked to this thread.",
  Device: "Watch an iOS Simulator or Android Emulator.",
};

/** Fork-owned copy for upstream surfaces, keyed by upstream's label. */
export const upstreamSurfaceDescription = (label: string): string | undefined =>
  UPSTREAM_SURFACE_DESCRIPTIONS[label];

export const panelActionDescription = (action: PanelPickerAction): string | undefined =>
  action.description ?? upstreamSurfaceDescription(action.label);

export interface RankedPanelGroups<A extends PanelPickerAction = PanelPickerAction> {
  readonly recent: ReadonlyArray<A>;
  readonly panels: ReadonlyArray<A>;
  readonly unavailable: ReadonlyArray<A>;
}

const isSubsequence = (needle: string, haystack: string) => {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
};

/** Lower is better; null drops the action. */
function matchScore(action: PanelPickerAction, query: string): number | null {
  const label = action.label.toLowerCase();
  if (query.length === 1 && action.shortcut.toLowerCase() === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.split(/[^a-z0-9]+/).some((word) => word.startsWith(query))) return 2;
  if (label.includes(query)) return 3;
  if (panelActionDescription(action)?.toLowerCase().includes(query)) return 4;
  return isSubsequence(query, label) ? 5 : null;
}

/**
 * Groups actions for the picker. An empty query keeps the given order with recent picks on
 * top; a query keeps matches only, best match first, ties broken by recency then order.
 */
export function rankPanelActions<A extends PanelPickerAction>(
  actions: ReadonlyArray<A>,
  query: string,
  recents: ReadonlyArray<string>,
): RankedPanelGroups<A> {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    const available = actions.filter((action) => action.available);
    const recent = recents
      .flatMap((label) => available.find((action) => action.label === label) ?? [])
      .slice(0, RECENT_ROWS);
    return {
      recent,
      panels: available.filter((action) => !recent.includes(action)),
      unavailable: actions.filter((action) => !action.available),
    };
  }
  const recency = (action: A) => {
    const index = recents.indexOf(action.label);
    return index === -1 ? recents.length : index;
  };
  const matches = actions
    .flatMap((action, order) => {
      const score = matchScore(action, needle);
      return score === null ? [] : [{ action, order, score, recency: recency(action) }];
    })
    .toSorted((a, b) => a.score - b.score || a.recency - b.recency || a.order - b.order)
    .map((match) => match.action);
  return {
    recent: [],
    panels: matches.filter((action) => action.available),
    unavailable: matches.filter((action) => !action.available),
  };
}
