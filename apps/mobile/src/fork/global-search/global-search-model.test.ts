import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";
import {
  GLOBAL_SEARCH_SETTINGS,
  globalSearchQueryComputers,
  searchSourceIsLoading,
  rankGlobalSearchItems,
  serverResultsMatchQuery,
  unavailableSearchComputerLabels,
  type GlobalSearchItem,
} from "./global-search-model";

function thread(
  environment: string,
  title: string,
  patch: Partial<GlobalSearchItem> = {},
): GlobalSearchItem {
  return {
    key: `thread:${environment}:same-id`,
    category: "threads",
    title,
    destination: {
      kind: "thread",
      environmentId: EnvironmentId.make(environment),
      threadId: ThreadId.make("same-id"),
    },
    ...patch,
  };
}

it("merges title and message hits without collapsing equal thread IDs on different computers", () => {
  const hit = thread("one", "Release", {
    description: "A matching message",
    serverQuality: 0.8,
    destination: {
      kind: "thread",
      environmentId: EnvironmentId.make("one"),
      threadId: ThreadId.make("same-id"),
      messageId: MessageId.make("message"),
    },
  });
  const ranked = rankGlobalSearchItems(
    [thread("one", "Release"), hit, thread("two", "Release")],
    "Release",
  );
  expect(ranked).toHaveLength(2);
  expect(ranked.find((entry) => entry.key === hit.key)?.destination).toEqual(hit.destination);
  expect(ranked.find((entry) => entry.key === hit.key)?.description).toBe("A matching message");
});

it("ranks visible titles above keyword matches and finds limits by usage synonyms", () => {
  const exact = thread("one", "Usage");
  const ranked = rankGlobalSearchItems([...GLOBAL_SEARCH_SETTINGS, exact], "usage");
  expect(ranked[0]?.key).toBe(exact.key);
  expect(
    ranked.some(
      (entry) =>
        entry.destination.kind === "settings" && entry.destination.page === "SettingsUsage",
    ),
  ).toBe(true);
  expect(rankGlobalSearchItems([exact], "unrelated")).toEqual([]);
});

it("retains server message matches even when the snippet does not contain every query token", () => {
  const hit = thread("one", "Conversation", {
    serverQuality: 0.8,
    description: "Truncated matching passage",
  });
  expect(rankGlobalSearchItems([hit], "long server query")).toEqual([hit]);
});

it("prefers readable live threads and falls back to the matching saved conversation", () => {
  const saved = thread("one", "Release", {
    serverQuality: 0.7,
    destination: {
      kind: "library-history",
      projectId: "project",
      archiveId: "archive",
      itemId: "item",
      position: 5,
    },
  });
  const available = thread("one", "Release", { liveAvailable: true });
  expect(rankGlobalSearchItems([available, saved], "release")[0]?.destination).toEqual(
    available.destination,
  );
  expect(rankGlobalSearchItems([saved, available], "release")[0]?.destination).toEqual(
    available.destination,
  );
  expect(
    rankGlobalSearchItems([{ ...available, liveAvailable: false }, saved], "release")[0]
      ?.destination,
  ).toEqual(saved.destination);
});

it("rejects results from an earlier query while accepting case and accent folding", () => {
  expect(serverResultsMatchQuery("release", "relea")).toBe(false);
  expect(serverResultsMatchQuery("billing", "release")).toBe(false);
  expect(serverResultsMatchQuery("", "")).toBe(false);
  expect(serverResultsMatchQuery("resume", "Résumé")).toBe(true);
});

it("names an unavailable computer once without conflating its scoped results", () => {
  expect(
    unavailableSearchComputerLabels([
      { label: "Dorothy" },
      { label: "Dorothy" },
      { label: "Mac mini" },
    ]),
  ).toBe("Dorothy, Mac mini");
  expect(
    rankGlobalSearchItems([thread("one", "Same"), thread("two", "Same")], "same"),
  ).toHaveLength(2);
});

it("never starts a search on an offline computer even when its cached session still grants read access", () => {
  const offline = {
    environmentId: EnvironmentId.make("offline"),
    connection: { phase: "offline" },
  };
  const retrying = {
    environmentId: EnvironmentId.make("retrying"),
    connection: { phase: "connecting" },
  };
  const connected = {
    environmentId: EnvironmentId.make("connected"),
    connection: { phase: "connected" },
  };
  const unauthorized = {
    environmentId: EnvironmentId.make("unauthorized"),
    connection: { phase: "connected" },
  };
  const readable = new Set([
    offline.environmentId,
    retrying.environmentId,
    connected.environmentId,
  ]);
  expect(
    globalSearchQueryComputers([offline, retrying, connected, unauthorized], readable),
  ).toEqual([connected]);
});

it("stops loading once a live subscription has supplied data while it keeps listening", () => {
  expect(searchSourceIsLoading(AsyncResult.initial(true))).toBe(true);
  expect(searchSourceIsLoading(AsyncResult.success({ links: [] }, { waiting: true }))).toBe(false);
  expect(searchSourceIsLoading(null)).toBe(false);
});
