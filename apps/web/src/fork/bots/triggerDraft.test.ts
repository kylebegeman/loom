import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import type { BotDefinition, BotTrigger, BotTriggerFiring } from "@t3tools/contracts/fork";
import {
  emptyTriggerDraft,
  triggerDraftFrom,
  triggerInputFromDraft,
  triggerSummary,
  type TriggerDraft,
} from "@t3tools/client-runtime/fork";
import {
  dayPresetOf,
  defaultTriggerName,
  everyMinutesFrom,
  filterTriggers,
  firingActivity,
  firstProblemStep,
  initialTestFields,
  intervalParts,
  mappingLines,
  maskWebhookAddress,
  newestFiredAt,
  newTriggerDraft,
  remapForKind,
  reviseTriggerDraft,
  schedulePhrase,
  spanAhead,
  testFieldsInput,
  triggerAgenda,
  triggerStepProblem,
  triggerVersion,
  triggerWhen,
  upcomingDays,
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

  it("maps a pipeline's inputs and keeps the pipeline when an existing trigger is saved", () => {
    const pipeline = {
      name: "Review and fix",
      parameters: [{ name: "file", label: "File", type: "string" as const, required: true }],
    };
    const draft = { ...emptyTriggerDraft(bot), kind: "webhook" as const, pipelineId: "review-fix" };
    expect(
      triggerInputFromDraft(
        bot,
        { ...draft, mapping: { file: { mode: "field", field: "body.file", value: "" } } },
        null,
        pipeline,
      ),
    ).toMatchObject({
      input: {
        botId: "fixer",
        pipelineId: "review-fix",
        mapping: { file: { field: "body.file" } },
      },
    });
    expect(
      triggerInputFromDraft(bot, { ...draft, kind: "merge-conflict" }, null, pipeline),
    ).toEqual({ error: "A pipeline runs once per event, not once per conflicting file." });

    const saved: BotTrigger = {
      id: "trg_00000000000000000002",
      botId: "fixer",
      name: "Pipeline hook",
      event: { kind: "webhook" },
      mapping: { file: { field: "body.file" } },
      enabled: true,
      cooldownMinutes: 0,
      dailyLimit: 5,
      followLatest: false,
      pinnedVersion: 3,
      pipelineId: "review-fix",
      createdBy: "agent",
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T11:00:00.000Z",
      lastFiredAt: null,
    };
    const reopened = triggerDraftFrom(bot, saved, pipeline);
    expect(reopened.mapping.file).toEqual({ mode: "field", field: "body.file", value: "" });
    expect(triggerInputFromDraft(bot, reopened, saved, pipeline)).toMatchObject({
      input: { id: saved.id, pipelineId: "review-fix", mapping: saved.mapping },
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

const pipeline = {
  name: "Review and fix",
  parameters: [{ name: "file", label: "File", type: "string" as const, required: true }],
};
const targetName = (pipelineId: string) => (pipelineId === "" ? bot.name : pipeline.name);
const context = { target: bot, hasSecret: false };

const savedTrigger = (overrides: Partial<BotTrigger>): BotTrigger => ({
  id: "trg_00000000000000000009",
  botId: "fixer",
  name: "Trigger",
  event: { kind: "webhook" },
  mapping: {},
  enabled: true,
  cooldownMinutes: 0,
  dailyLimit: 20,
  followLatest: false,
  pinnedVersion: 3,
  createdBy: "user",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  lastFiredAt: null,
  ...overrides,
});

const firing = (
  firedAt: string,
  outcome: BotTriggerFiring["outcome"],
  reason: string | null = null,
): BotTriggerFiring => ({
  id: `firing-${firedAt}`,
  triggerId: "trg_00000000000000000009",
  eventKey: firedAt,
  eventSummary: "acme/app#12 checks failing",
  firedAt,
  outcome,
  runId: null,
  reason,
});

describe("trigger names", () => {
  it("names a new trigger for what starts it, not for checks failing", () => {
    const draft = newTriggerDraft(bot, bot, "");
    expect(draft.name).toBe("Fixer when checks fail");
    expect(defaultTriggerName("Fixer", { ...draft, kind: "webhook" })).toBe("Fixer from a webhook");
    expect(
      defaultTriggerName("Fixer", {
        ...draft,
        kind: "schedule",
        scheduleType: "fixed_time",
        timeOfDay: "09:00",
        weekdays: [1, 2, 3, 4, 5],
      }),
    ).toBe("Fixer weekdays at 09:00");
    expect(defaultTriggerName("Fixer", { ...draft, kind: "schedule", everyMinutes: "abc" })).toBe(
      "Fixer on a schedule",
    );
    expect(defaultTriggerName("x".repeat(130), draft)).toHaveLength(120);
  });

  it("keeps an untouched name following the kind, the schedule and the target", () => {
    let draft = newTriggerDraft(bot, bot, "");
    draft = reviseTriggerDraft(draft, { kind: "schedule" }, targetName);
    expect(draft.name).toBe("Fixer every hour");
    draft = reviseTriggerDraft(draft, { everyMinutes: "120" }, targetName);
    expect(draft.name).toBe("Fixer every 2 hours");
    draft = reviseTriggerDraft(draft, { pipelineId: "review-fix" }, targetName);
    expect(draft.name).toBe("Review and fix every 2 hours");
  });

  it("stops following once the name is typed, until it is typed back", () => {
    let draft = newTriggerDraft(bot, bot, "");
    draft = reviseTriggerDraft(draft, { name: "Nightly sweep" }, targetName);
    draft = reviseTriggerDraft(draft, { kind: "webhook" }, targetName);
    expect(draft.name).toBe("Nightly sweep");
    draft = reviseTriggerDraft(draft, { name: "Fixer from a webhook" }, targetName);
    draft = reviseTriggerDraft(draft, { kind: "pull-request-opened" }, targetName);
    expect(draft.name).toBe("Fixer when a pull request opens");
  });

  it("starts a pipeline trigger named for the pipeline with its inputs guessed", () => {
    const draft = newTriggerDraft(bot, pipeline, "review-fix");
    expect(draft.pipelineId).toBe("review-fix");
    expect(draft.name).toBe("Review and fix when checks fail");
    expect(Object.keys(draft.mapping)).toEqual(["file"]);
  });
});

describe("switching kinds", () => {
  it("keeps fixed values and fields the new event offers, and guesses the rest", () => {
    const mapping = remapForKind(
      bot,
      {
        url: { mode: "field", field: "url", value: "" },
        depth: { mode: "value", field: "", value: "2" },
        strict: { mode: "field", field: "failedChecks", value: "" },
      },
      "pull-request-opened",
    );
    expect(mapping.url).toEqual({ mode: "field", field: "url", value: "" });
    expect(mapping.depth).toEqual({ mode: "value", field: "", value: "2" });
    expect(mapping.strict).toEqual({ mode: "none", field: "", value: "" });
  });

  it("drops event fields a webhook does not offer and keeps webhook paths", () => {
    const toWebhook = remapForKind(
      bot,
      { url: { mode: "field", field: "url", value: "" } },
      "webhook",
    );
    expect(toWebhook.url).toEqual({ mode: "none", field: "", value: "" });
    const kept = remapForKind(
      bot,
      { url: { mode: "field", field: "body.pull_request.html_url", value: "" } },
      "webhook",
    );
    expect(kept.url?.field).toBe("body.pull_request.html_url");
  });
});

describe("schedules", () => {
  it("reads a stored interval in its largest whole unit", () => {
    expect(intervalParts("1440")).toEqual({ amount: "1", unit: "days" });
    expect(intervalParts("120")).toEqual({ amount: "2", unit: "hours" });
    expect(intervalParts("90")).toEqual({ amount: "90", unit: "minutes" });
    expect(intervalParts("")).toEqual({ amount: "", unit: "minutes" });
  });

  it("turns an amount and unit into whole minutes, passing anything else through", () => {
    expect(everyMinutesFrom("1.5", "hours")).toBe("90");
    expect(everyMinutesFrom("2", "days")).toBe("2880");
    expect(everyMinutesFrom("0.5", "minutes")).toBe("0.5");
    expect(everyMinutesFrom("soon", "hours")).toBe("soon");
  });

  it("says when a schedule runs, with no days meaning every day", () => {
    const base = { scheduleType: "fixed_time" as const, everyMinutes: "", timeOfDay: "09:30" };
    expect(schedulePhrase({ ...base, weekdays: [] })).toBe("every day at 09:30");
    expect(schedulePhrase({ ...base, weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe("every day at 09:30");
    expect(schedulePhrase({ ...base, weekdays: [6, 0] })).toBe("weekends at 09:30");
    expect(schedulePhrase({ ...base, weekdays: [5, 1] })).toBe("Mon, Fri at 09:30");
    expect(schedulePhrase({ ...base, timeOfDay: "9am", weekdays: [] })).toBeNull();
    expect(dayPresetOf([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(dayPresetOf([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(dayPresetOf([1, 3])).toBeNull();
  });

  it("describes a saved schedule in the units it was set in", () => {
    const title = () => "Loom";
    expect(
      triggerWhen({ kind: "schedule", schedule: { type: "interval", everyMs: 86_400_000 } }, title),
    ).toBe("Every day");
    expect(
      triggerWhen(
        { kind: "schedule", schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [] } },
        title,
      ),
    ).toBe("Every day at 09:00");
    expect(triggerWhen({ kind: "thread-settled", projectId: ProjectId.make("p") }, title)).toBe(
      "A thread in Loom settles",
    );
  });

  it("lists the next days a time-of-day schedule runs, skipping a time already past", () => {
    const now = new Date(2026, 9, 23, 10, 0);
    const days = upcomingDays({ timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] }, now, 3);
    expect(days.map((day) => [day.getDate(), day.getHours()])).toEqual([
      [26, 9],
      [27, 9],
      [28, 9],
    ]);
    expect(upcomingDays({ timeOfDay: "11:00", weekdays: [] }, now, 1)[0]?.getDate()).toBe(23);
    expect(upcomingDays({ timeOfDay: "late", weekdays: [] }, now, 3)).toEqual([]);
  });
});

describe("step checks", () => {
  const draft: TriggerDraft = newTriggerDraft(bot, bot, "");

  it("checks each step on its own, in the words of its fields", () => {
    expect(triggerStepProblem("kind", draft, context)).toBeNull();
    expect(
      triggerStepProblem("when", { ...draft, kind: "thread-settled", projectId: "" }, context),
    ).toBe("Choose the project whose threads start it.");
    const schedule = { ...draft, kind: "schedule" as const, scheduleType: "interval" as const };
    expect(triggerStepProblem("when", { ...schedule, everyMinutes: "" }, context)).toBe(
      "Enter how often it runs, such as 15 minutes or 2 hours.",
    );
    expect(triggerStepProblem("when", { ...schedule, everyMinutes: "44641" }, context)).toBe(
      "Run at least once every 31 days.",
    );
    expect(triggerStepProblem("when", { ...schedule, everyMinutes: "44640" }, context)).toBeNull();
    expect(triggerStepProblem("when", { ...draft, cooldownMinutes: "1441" }, context)).toBe(
      "Wait 0 to 1440 minutes between runs.",
    );
    expect(triggerStepProblem("when", { ...draft, dailyLimit: "0" }, context)).toBe(
      "Allow 1 to 500 runs a day.",
    );
    expect(triggerStepProblem("review", { ...draft, name: "  " }, context)).toBe(
      "Name the trigger.",
    );
  });

  it("asks for a signing secret unless one is already stored", () => {
    const signed = { ...draft, kind: "webhook" as const, signed: true, secret: "" };
    expect(triggerStepProblem("when", signed, context)).toBe(
      "Add the secret the sender signs with, or turn off the signature check.",
    );
    expect(triggerStepProblem("when", signed, { ...context, hasSecret: true })).toBeNull();
    expect(triggerStepProblem("when", { ...signed, signatureHeader: " " }, context)).toBe(
      "Name the header that carries the signature.",
    );
  });

  it("checks inputs against the target and keeps pipelines off merge conflicts", () => {
    const unmapped = {
      ...draft,
      mapping: { ...draft.mapping, url: { mode: "none" as const, field: "", value: "" } },
    };
    expect(triggerStepProblem("runs", unmapped, context)).toBe(
      "Fixer needs Pull request; map it to a field or a fixed value.",
    );
    expect(
      triggerStepProblem(
        "runs",
        {
          ...draft,
          mapping: { ...draft.mapping, depth: { mode: "value", field: "", value: "x" } },
        },
        context,
      ),
    ).toBe("Depth needs a number.");
    const conflicts = { ...draft, kind: "merge-conflict" as const, pipelineId: "review-fix" };
    expect(triggerStepProblem("kind", conflicts, { ...context, target: pipeline })).toBe(
      "A pipeline runs once per event, not once per conflicting file.",
    );
    expect(firstProblemStep(unmapped, context)).toBe("runs");
    expect(firstProblemStep(draft, context)).toBeNull();
  });

  it("agrees with the save request on a draft the steps accept", () => {
    expect(firstProblemStep(draft, context)).toBeNull();
    expect("input" in triggerInputFromDraft(bot, draft, null)).toBe(true);
  });
});

describe("test firings", () => {
  it("offers the event's fields, typed as the inputs they fill", () => {
    const fields = initialTestFields(
      savedTrigger({
        event: { kind: "pull-request-opened" },
        mapping: { depth: { field: "number" } },
      }),
      bot,
    );
    expect(fields.map((field) => field.name)).toEqual([
      "repository",
      "number",
      "url",
      "title",
      "headBranch",
      "baseBranch",
      "threadId",
    ]);
    expect(fields.find((field) => field.name === "number")?.type).toBe("number");
    const webhook = initialTestFields(
      savedTrigger({ mapping: { url: { field: "body.url" }, depth: { value: 2 } } }),
      bot,
    );
    expect(webhook.map((field) => field.name)).toEqual(["body.url"]);
  });

  it("builds typed fields and names the first one to fix", () => {
    expect(
      testFieldsInput([
        { name: " number ", value: "12", type: "number" },
        { name: "draft", value: "true", type: "boolean" },
        { name: "url", value: "https://x", type: "string" },
      ]),
    ).toEqual({ fields: { number: 12, draft: true, url: "https://x" } });
    expect(testFieldsInput([{ name: "number", value: "twelve", type: "number" }])).toEqual({
      error: "number needs a number.",
    });
    expect(
      testFieldsInput([
        { name: "url", value: "", type: "string" },
        { name: "url", value: "", type: "string" },
      ]),
    ).toEqual({ error: "The field url appears twice." });
    expect(testFieldsInput([{ name: "", value: "x", type: "string" }])).toEqual({
      error: "Name every field, or remove the empty one.",
    });
  });
});

describe("firing activity", () => {
  it("counts the last run without skips, and the skips since it", () => {
    const activity = firingActivity([
      firing("2026-10-23T09:00:00.000Z", "run"),
      firing("2026-10-23T11:00:00.000Z", "skipped", "Cooling down."),
      firing("2026-10-23T10:00:00.000Z", "skipped", "Cooling down."),
      firing("2026-10-23T08:00:00.000Z", "run"),
    ]);
    expect(activity.lastRun?.firedAt).toBe("2026-10-23T09:00:00.000Z");
    expect(activity.lastSkip?.firedAt).toBe("2026-10-23T11:00:00.000Z");
    expect(activity.skippedSinceRun).toBe(2);
    expect([activity.ran, activity.skipped]).toEqual([2, 2]);
  });

  it("reports no run when every firing was skipped", () => {
    const activity = firingActivity([firing("2026-10-23T11:00:00.000Z", "skipped")]);
    expect(activity.lastRun).toBeNull();
    expect(activity.skippedSinceRun).toBe(1);
    expect(firingActivity([]).lastSkip).toBeNull();
    expect(
      newestFiredAt([
        firing("2026-10-23T09:00:00.000Z", "run"),
        firing("2026-10-23T11:00:00.000Z", "skipped"),
      ]),
    ).toBe("2026-10-23T11:00:00.000Z");
  });
});

describe("the agenda", () => {
  const schedule = {
    kind: "schedule" as const,
    schedule: { type: "interval" as const, everyMs: 3_600_000 },
  };
  const triggers = [
    savedTrigger({
      id: "trg_00000000000000000001",
      name: "Later",
      event: schedule,
      nextFireAt: "2026-10-23T15:00:00.000Z",
    }),
    savedTrigger({
      id: "trg_00000000000000000002",
      name: "Paused",
      event: schedule,
      enabled: false,
      nextFireAt: "2026-10-23T09:00:00.000Z",
    }),
    savedTrigger({
      id: "trg_00000000000000000003",
      name: "Soon",
      event: schedule,
      nextFireAt: "2026-10-23T12:00:00.000Z",
    }),
    savedTrigger({ id: "trg_00000000000000000004", name: "Quiet hook", lastFiredAt: null }),
    savedTrigger({
      id: "trg_00000000000000000005",
      name: "Busy hook",
      lastFiredAt: "2026-10-23T10:00:00.000Z",
    }),
    savedTrigger({
      id: "trg_00000000000000000006",
      name: "Off hook",
      enabled: false,
      lastFiredAt: "2026-10-23T11:00:00.000Z",
      event: { kind: "merge-conflict" },
    }),
  ];

  it("puts schedules soonest first with paused ones last, and the rest by last firing", () => {
    const { nextUp, onDemand } = triggerAgenda(triggers);
    expect(nextUp.map((trigger) => trigger.name)).toEqual(["Soon", "Later", "Paused"]);
    expect(onDemand.map((trigger) => trigger.name)).toEqual([
      "Busy hook",
      "Quiet hook",
      "Off hook",
    ]);
  });

  it("filters by words, kind and state together", () => {
    const words = (trigger: BotTrigger) =>
      trigger.event.kind === "merge-conflict" ? "conflicts" : "";
    const all = {
      search: "",
      kinds: new Set<BotTrigger["event"]["kind"]>(),
      state: "all" as const,
    };
    expect(
      filterTriggers(triggers, { ...all, search: "hook busy" }, words).map((t) => t.name),
    ).toEqual(["Busy hook"]);
    expect(filterTriggers(triggers, { ...all, search: "conflicts" }, words)).toHaveLength(1);
    expect(filterTriggers(triggers, { ...all, kinds: new Set(["schedule"]) }, words)).toHaveLength(
      3,
    );
    expect(filterTriggers(triggers, { ...all, state: "paused" }, words).map((t) => t.name)).toEqual(
      ["Paused", "Off hook"],
    );
  });
});

describe("trigger facts", () => {
  it("says which version runs and whether a newer one was saved", () => {
    expect(triggerVersion(savedTrigger({ pinnedVersion: 2 }), bot)).toEqual({
      label: "Version 2",
      short: "v2",
      outdated: true,
    });
    expect(triggerVersion(savedTrigger({ followLatest: true }), bot)?.outdated).toBe(false);
    expect(triggerVersion(savedTrigger({ followStable: true }), bot)?.label).toBe("Stable version");
    expect(triggerVersion(savedTrigger({ pipelineId: "review-fix" }), bot)).toBeNull();
  });

  it("lists where each input comes from", () => {
    expect(mappingLines(bot, { depth: { value: 2 }, url: { field: "url" } })).toEqual([
      "Pull request ← url",
      "Depth = 2",
    ]);
  });

  it("hides a webhook token but keeps the address recognizable", () => {
    expect(maskWebhookAddress("https://loom.example/api/hooks/bot-trigger-trg_1/abc123")).toBe(
      "https://loom.example/api/hooks/bot-trigger-trg_1/••••••••",
    );
    expect(maskWebhookAddress("no-slashes")).toBe("no-slashes");
  });

  it("reads a span ahead in its two largest units", () => {
    expect(spanAhead(20_000)).toBe("1m");
    expect(spanAhead(134 * 60_000)).toBe("2h 14m");
    expect(spanAhead(3 * 86_400_000 + 4 * 3_600_000)).toBe("3d 4h");
  });
});
