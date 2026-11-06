import { EnvironmentId } from "@t3tools/contracts";
import { PREVIEW_LINKS_FEATURE, PREVIEW_PAGES_FEATURE } from "@t3tools/contracts/fork";
import { expect, it } from "vite-plus/test";
import {
  matchingResults,
  missingResultsComputerReason,
  resultsComputers,
  selectedResultsComputer,
} from "./results-model";

function computer(id: string, features: string[], connected = true, enabled = true) {
  return {
    environmentId: EnvironmentId.make(id),
    label: "Mac",
    entry: { enabled },
    connection: { phase: connected ? "connected" : "disconnected" },
    serverConfig: {
      environment: { capabilities: { repositoryIdentity: false, loomFeatures: features } },
    },
  };
}

it("keeps pages and previews capability-scoped without dropping an offline selection", () => {
  const computers = resultsComputers([
    computer("pages", [PREVIEW_PAGES_FEATURE]),
    computer("previews", [PREVIEW_LINKS_FEATURE], false),
    computer("disabled", [PREVIEW_LINKS_FEATURE], true, false),
    computer("old-server", []),
  ]);
  expect(computers).toEqual([
    { environmentId: "pages", label: "Mac", connected: true, pages: true, previews: false },
    { environmentId: "previews", label: "Mac", connected: false, pages: false, previews: true },
  ]);
  expect(selectedResultsComputer(computers, EnvironmentId.make("previews"))?.environmentId).toBe(
    "previews",
  );
  expect(selectedResultsComputer(computers, EnvironmentId.make("disabled"))?.environmentId).toBe(
    "pages",
  );
  expect(selectedResultsComputer([], null)).toBeNull();
  expect(selectedResultsComputer([...computers].reverse(), null)?.environmentId).toBe("pages");
});

it("only calls a computer unsupported after its capabilities have loaded", () => {
  expect(missingResultsComputerReason([], false)).toBe("loading");
  expect(missingResultsComputerReason([], true)).toBe("connect");
  expect(
    missingResultsComputerReason([{ ...computer("loading", []), serverConfig: null }], true),
  ).toBe("loading");
  expect(missingResultsComputerReason([computer("old", [])], true)).toBe("unsupported");
  expect(missingResultsComputerReason([computer("offline", [], false)], true)).toBe("reconnect");
});

it("matches every search word across an item's title and source without changing its order", () => {
  const entries = ["Website release Mac", "Website design Linux", "Mac report"];
  expect(matchingResults(entries, "  mac WEBSITE ", (entry) => entry)).toEqual([entries[0]]);
  expect(matchingResults(entries, " ", (entry) => entry)).toBe(entries);
});
