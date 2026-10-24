import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { botPageTabs, botsRoute, indexTabs, routeFeature, selectedTab } from "./botsRoute";

const everything = { pipelinesSupported: true, triggersSupported: true, versionsSupported: true };
const nothing = { pipelinesSupported: false, triggersSupported: false, versionsSupported: false };

describe("botsRoute", () => {
  it("opens the deepest page a search names", () => {
    expect(botsRoute({ bot: "reviewer", batch: "batch-1" })).toEqual({
      kind: "batch",
      batchId: "batch-1",
    });
    expect(botsRoute({ pipeline: "ship", pipelineRun: "run-1" })).toEqual({
      kind: "pipelineRun",
      runId: "run-1",
    });
    expect(botsRoute({ bot: "reviewer", edit: true, newBot: true })).toEqual({ kind: "newBot" });
    expect(
      botsRoute({ fromThread: ThreadId.make("thread-1"), newBot: true, suggestion: "s-1" }),
    ).toEqual({ kind: "fromThread", threadId: "thread-1", suggestionId: "s-1" });
  });

  it("opens the bot itself when edit comes without a bot, or stays on the index", () => {
    expect(botsRoute({ edit: true })).toEqual({ kind: "index" });
    expect(botsRoute({ bot: "reviewer", tab: "runs" })).toEqual({ kind: "bot", botId: "reviewer" });
  });

  it("leaves overlays to the page under them", () => {
    expect(botsRoute({ run: "reviewer", runId: "run-1", computers: true })).toEqual({
      kind: "index",
    });
  });
});

describe("routeFeature", () => {
  it("names the capability each deeper page needs", () => {
    expect(routeFeature({ kind: "editPipeline", pipelineId: "ship" })).toBe("pipelines");
    expect(routeFeature({ kind: "batch", batchId: "b" })).toBe("batches");
    expect(routeFeature({ kind: "bot", botId: "reviewer" })).toBeNull();
  });
});

describe("tabs", () => {
  it("offers only the views this host supports", () => {
    expect(indexTabs(everything)).toEqual(["bots", "runs", "pipelines", "triggers"]);
    expect(indexTabs(nothing)).toEqual(["bots", "runs"]);
    expect(botPageTabs(nothing)).toEqual(["overview", "runs"]);
  });

  it("falls back to the first view for one this page lacks", () => {
    expect(selectedTab(indexTabs(nothing), "pipelines")).toBe("bots");
    expect(selectedTab(botPageTabs(everything), "versions")).toBe("versions");
    expect(selectedTab(botPageTabs(everything), undefined)).toBe("overview");
  });
});
