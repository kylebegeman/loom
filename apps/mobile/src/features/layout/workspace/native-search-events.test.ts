import { expect, it } from "vite-plus/test";
import { acceptsNativeSearchEvent } from "./native-search-events";
import { initialWorkspaceTabsState, workspaceTabsReducer } from "./workspace-tabs-state";

it("keeps the query when native search emits an empty update after a result covers it", () => {
  let state = workspaceTabsReducer(initialWorkspaceTabsState(), {
    type: "query",
    tab: "search",
    query: "Loom",
  });
  if (acceptsNativeSearchEvent({ globalSearch: true, focused: false, tabActive: true })) {
    state = workspaceTabsReducer(state, { type: "query", tab: "search", query: "" });
  }
  expect(state.tabs.search.query).toBe("Loom");
  expect(acceptsNativeSearchEvent({ globalSearch: true, focused: true, tabActive: false })).toBe(
    false,
  );
});

it("accepts intentional clearing in focused global search", () => {
  expect(acceptsNativeSearchEvent({ globalSearch: true, focused: true, tabActive: true })).toBe(
    true,
  );
  expect(acceptsNativeSearchEvent({ globalSearch: false, focused: false, tabActive: false })).toBe(
    true,
  );
});
