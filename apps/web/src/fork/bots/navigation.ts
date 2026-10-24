import { useNavigate, useSearch } from "@tanstack/react-router";
import type { BotsSearch } from "./botsRoute";

/** The search keys of dialogs and sheets, which open over a page rather than being one. */
const OVERLAY_KEYS = [
  "run",
  "many",
  "runId",
  "replay",
  "trigger",
  "editTrigger",
  "newTrigger",
  "triggerPipeline",
  "runPipeline",
  "computers",
] as const satisfies readonly (keyof BotsSearch)[];

type OverlayKey = (typeof OVERLAY_KEYS)[number];
export type BotsOverlay = Pick<BotsSearch, OverlayKey>;
export type BotsPageSearch = Omit<BotsSearch, OverlayKey>;

/** The page a search shows, without the dialog or sheet open over it. */
export function botsPageOf(search: BotsSearch): BotsPageSearch {
  const page: Record<string, unknown> = { ...search };
  for (const key of OVERLAY_KEYS) delete page[key];
  return page as BotsPageSearch;
}

/**
 * Every move on the Bots page goes through the URL, so each page, dialog and sheet can be linked
 * to, reloaded and reached from the palette. Pages push, so Back returns; views, dialogs and sheets
 * replace, so Back never steps through filters or reopens a closed dialog.
 */
export function useBotsNavigation() {
  const search = useSearch({ from: "/loom/bots" });
  const navigate = useNavigate();
  return {
    search,
    /** Opens a page a step deeper. */
    open: (page: BotsPageSearch) => void navigate({ to: "/loom/bots", search: page }),
    /** Changes the view in place, such as the tab or the Runs scope, and closes any overlay. */
    show: (page: BotsPageSearch) =>
      void navigate({ to: "/loom/bots", search: page, replace: true }),
    /** Opens one dialog or sheet over the current page, closing any other. */
    overlay: (overlay: BotsOverlay) =>
      void navigate({
        to: "/loom/bots",
        search: { ...botsPageOf(search), ...overlay },
        replace: true,
      }),
    /** Closes the open dialog or sheet. */
    close: () => void navigate({ to: "/loom/bots", search: botsPageOf(search), replace: true }),
  };
}

export type BotsNavigation = ReturnType<typeof useBotsNavigation>;
