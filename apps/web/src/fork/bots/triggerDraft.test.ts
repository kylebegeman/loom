import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import type { BotDefinition, BotTrigger } from "@t3tools/contracts/fork";
import {
  emptyTriggerDraft,
  triggerDraftFrom,
  triggerInputFromDraft,
  triggerSummary,
} from "./triggerDraft";

const bot: BotDefinition = {
  id: "fixer",
  name: "Fixer",
  description: "",
  instructions: "Fix {{url}} at depth {{depth}}.",
  parameters: [
    { name: "url", label: "Pull request", type: "string", required: true },
    { name: "depth", label: "Depth", type: "number", required: false },
    { name: "strict", label: "Strict", type: "boolean", required: false },
  ],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "scratch" },
  timeoutMinutes: 5,
  maxConcurrentRuns: 1,
  scopeProjectId: null,
  version: 3,
  createdBy: "user",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  archivedAt: null,
};

describe("trigger drafts", () => {
  it("maps inputs to same-named event fields and saves typed fixed values", () => {
    const draft = emptyTriggerDraft(bot);
    expect(draft.mapping.url).toEqual({ mode: "field", field: "url", value: "" });
    const result = triggerInputFromDraft(
      bot,
      {
        ...draft,
        repository: " acme/app ",
        mapping: {
          ...draft.mapping,
          depth: { mode: "value", field: "", value: "2" },
          strict: { mode: "value", field: "", value: "true" },
        },
      },
      null,
    );
    expect(result).toEqual({
      input: {
        botId: "fixer",
        name: "Fixer on checks failing",
        event: { kind: "pull-request-checks-failing", repository: "acme/app" },
        mapping: { url: { field: "url" }, depth: { value: 2 }, strict: { value: true } },
        enabled: true,
        cooldownMinutes: 10,
        dailyLimit: 20,
        followLatest: false,
      },
    });
  });

  it("sends followStable only for a stable choice", () => {
    const draft = emptyTriggerDraft(bot);
    expect(triggerInputFromDraft(bot, { ...draft, follow: "stable" }, null)).toMatchObject({
      input: { followLatest: false, followStable: true },
    });
    const pinned = triggerInputFromDraft(bot, { ...draft, follow: "pinned" }, null);
    expect("input" in pinned && "followStable" in pinned.input).toBe(false);
  });

  it("reports what to fix with the server's mapping rule", () => {
    const draft = emptyTriggerDraft(bot);
    const unmapped = {
      ...draft,
      mapping: { ...draft.mapping, url: { mode: "none" as const, field: "", value: "" } },
    };
    expect(triggerInputFromDraft(bot, unmapped, null)).toEqual({
      error: "Fixer needs Pull request; map it to a field or a fixed value.",
    });
    expect(triggerInputFromDraft(bot, { ...draft, kind: "thread-settled" }, null)).toEqual({
      error: "Choose the project whose threads start this bot.",
    });
    expect(
      triggerInputFromDraft(
        bot,
        { ...draft, kind: "schedule", scheduleType: "interval", everyMinutes: "0" },
        null,
      ),
    ).toEqual({ error: "Run at most once a minute." });
  });

  it("round-trips a saved webhook trigger and removes its secret when signing is turned off", () => {
    const trigger: BotTrigger = {
      id: "trg_00000000000000000001",
      botId: "fixer",
      name: "From GitHub",
      event: {
        kind: "webhook",
        signature: { header: "x-hub-signature-256", encoding: "hex", prefix: "sha256=" },
      },
      mapping: { url: { field: "body.pull_request.html_url" } },
      enabled: true,
      cooldownMinutes: 0,
      dailyLimit: 5,
      followLatest: true,
      pinnedVersion: 3,
      createdBy: "user",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T11:00:00.000Z",
      webhook: { path: "/hooks/x", url: null, hasSecret: true },
      lastFiredAt: null,
    };
    const draft = triggerDraftFrom(bot, trigger);
    const kept = triggerInputFromDraft(bot, draft, trigger);
    expect(kept).toMatchObject({
      input: {
        id: trigger.id,
        expectedUpdatedAt: trigger.updatedAt,
        event: trigger.event,
        mapping: trigger.mapping,
        followLatest: true,
      },
    });
    expect("input" in kept && "webhookSecret" in kept.input).toBe(false);
    expect(triggerInputFromDraft(bot, { ...draft, signed: false }, trigger)).toMatchObject({
      input: { event: { kind: "webhook" }, webhookSecret: "" },
    });

    const stable: BotTrigger = { ...trigger, followLatest: false, followStable: true };
    const stableDraft = triggerDraftFrom(bot, stable);
    expect(stableDraft.follow).toBe("stable");
    expect(triggerInputFromDraft(bot, { ...stableDraft, follow: "pinned" }, stable)).toMatchObject({
      input: { followLatest: false, followStable: false },
    });
  });

  it("describes when a trigger fires", () => {
    const title = () => "Loom";
    expect(
      triggerSummary(
        { kind: "pull-request-opened", projectId: ProjectId.make("p"), branchPattern: "release/*" },
        title,
      ),
    ).toBe("Pull request opens in Loom, branch release/*");
    expect(
      triggerSummary(
        { kind: "schedule", schedule: { type: "interval", everyMs: 7_200_000 } },
        title,
      ),
    ).toBe("Every 2 hours");
    expect(
      triggerSummary(
        {
          kind: "schedule",
          schedule: { type: "fixed_time", timeOfDay: "09:30", weekdays: [1, 5] },
        },
        title,
      ),
    ).toBe("At 09:30, Mon, Fri");
  });
});
