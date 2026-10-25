// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId } from "@t3tools/contracts";
import { LIBRARY_SEARCH_FEATURE } from "@t3tools/contracts/fork";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("./state", () => ({ projectLibrary: { search: () => ({}) } }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: true }),
}));
vi.mock("~/state/queries", () => ({ useDebouncedValue: (value: string) => value }));
vi.mock("@tanstack/react-router", () => ({ Link: "a" }));
import { LibraryHistorySearch } from "./LibraryHistorySearch";
import { requestLibraryHistorySearch, takeLibraryHistorySearch } from "./actions";

let root: Root;
let container: HTMLDivElement;
const common = {
  authorityId: EnvironmentId.make("library"),
  connected: true,
  capabilities: { repositoryIdentity: false, loomFeatures: [LIBRARY_SEARCH_FEATURE] },
  hostLabel: () => "Computer",
};
function SharedSearch() {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        aria-label="Find projects and history"
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <LibraryHistorySearch
        {...common}
        query={query}
        onQueryChange={setQuery}
        inputRef={inputRef}
      />
    </>
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  takeLibraryHistorySearch();
  takeLibraryHistorySearch("project");
  vi.unstubAllGlobals();
});
it("prefills and focuses a project's history when the palette request arrives before navigation", async () => {
  requestLibraryHistorySearch("project", "map navigation");
  await act(() => root.render(<LibraryHistorySearch {...common} projectId="project" />));
  const input = container.querySelector("input")!;
  expect(input.value).toBe("map navigation");
  expect(document.activeElement).toBe(input);
  await act(() => requestLibraryHistorySearch("project", "second search"));
  expect(input.value).toBe("second search");
});
it("prefills the Projects page's shared field without losing the request to another scope", async () => {
  requestLibraryHistorySearch(undefined, "offline computer");
  await act(() => root.render(<LibraryHistorySearch {...common} projectId="project" />));
  expect(container.querySelector("input")!.value).toBe("");
  await act(() => root.render(<SharedSearch />));
  const input = container.querySelector("input")!;
  expect(input.value).toBe("offline computer");
  expect(document.activeElement).toBe(input);
});
