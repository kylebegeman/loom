// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Cause from "effect/Cause";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { BotRun, BotReplay, BotVersion, BotsListRunsInput } from "@t3tools/contracts/fork";

type Query =
  | { readonly kind: "runs"; readonly input: BotsListRunsInput }
  | { readonly kind: "version" }
  | { readonly kind: "replay" };
const state = vi.hoisted(() => ({
  pages: [] as Array<{ runs: ReadonlyArray<BotRun>; hasMore: boolean }>,
  version: null as BotVersion | null,
  versionError: null as string | null,
  replay: null as BotReplay | null,
  changes: { bots: new Map(), runs: new Map<string, BotRun>(), pruned: 0 },
  listInputs: [] as BotsListRunsInput[],
  run: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./state", () => ({
  bots: {
    listRuns: ({ input }: { input: BotsListRunsInput }) => {
      state.listInputs.push(input);
      return { kind: "runs", input };
    },
    version: () => ({ kind: "version" }),
    getReplay: () => ({ kind: "replay" }),
    replay: "run",
    cancelReplay: "cancel",
  },
  useBotsChanges: () => state.changes,
  useRefreshWhenBotsChangesPruned: () => {},
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (query: Query | null) => ({
    data:
      query === null
        ? null
        : query.kind === "version"
          ? state.version
          : query.kind === "replay"
            ? state.replay
            : state.pages[query.input.before === undefined ? 0 : 1],
    error: query?.kind === "version" ? state.versionError : null,
    isPending: query?.kind === "version" && state.version === null && state.versionError === null,
    refresh: state.refresh,
  }),
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "run" ? state.run : state.cancel),
}));
vi.mock("../project-library/LibraryControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../project-library/LibraryControls")>();
  return {
    ...actual,
    LibraryDialog: ({
      title,
      description,
      children,
      actions,
    }: {
      title: string;
      description: string;
      children: ReactNode;
      actions: ReactNode;
    }) => (
      <div role="dialog">
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
        <footer>{actions}</footer>
      </div>
    ),
  };
});

import { BotReplayDialog, type BotReplaySourceChoice } from "./BotReplay";
import { makeBotDefinition, makeBotRun } from "./testFixtures";

let root: Root;
let container: HTMLDivElement;
const environmentId = EnvironmentId.make("test");
const bot = makeBotDefinition();
const original = makeBotRun("original", { inputs: { pr: "94" }, rating: "down" });
const draft: BotReplaySourceChoice = {
  kind: "draft",
  draft: { ...bot, instructions: "Revised {{pr}}." },
};
const replay = (runIds: ReadonlyArray<string>): BotReplay => ({
  id: "comparison",
  botId: bot.id,
  baseVersion: bot.version,
  source: { kind: "draft" },
  createdAt: "2026-10-22T17:00:00Z",
  finishedAt: null,
  status: "running",
  items: runIds.map((id) => ({
    originalRunId: id,
    replayRunId: `after-${id}`,
    comparison: "pending",
    reason: null,
  })),
  summary: { fixed: 0, broke: 0, same: 0, changed: 0, failed: 0 },
});
const render = (source: BotReplaySourceChoice = draft, canRun = true) =>
  act(() =>
    root.render(
      <BotReplayDialog
        environmentId={environmentId}
        bot={bot}
        source={source}
        canRun={canRun}
        onClose={() => {}}
      />,
    ),
  );
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((element) => element.textContent === name)!;
const submit = () =>
  [...container.querySelectorAll<HTMLButtonElement>("footer button")].find((element) =>
    element.textContent?.startsWith("Replay "),
  )!;
const confirmCheckout = () =>
  [...container.querySelectorAll("label")]
    .find((label) => label.textContent?.includes("I understand that replaying"))
    ?.querySelector<HTMLElement>('[role="checkbox"]');

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  state.pages = [{ runs: [original], hasMore: false }];
  state.listInputs = [];
  state.version = null;
  state.versionError = null;
  state.replay = null;
  state.changes = { bots: new Map(), runs: new Map(), pruned: 0 };
  vi.resetAllMocks();
  state.run.mockImplementation(async ({ input }: { input: { runIds: ReadonlyArray<string> } }) => ({
    _tag: "Success",
    value: replay(input.runIds),
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("requires explicit confirmation for the unsaved draft's checkout and submits its pinned settings", async () => {
  const source: BotReplaySourceChoice = {
    kind: "draft",
    draft: {
      ...bot,
      workspace: { type: "project", projectId: null, worktree: false },
      instructions: "Unsaved improvement.",
      timeoutMinutes: 17,
    },
  };
  render(source);
  expect(submit().disabled).toBe(true);
  expect(container.textContent).toContain("repeat side effects");
  expect(state.run).not.toHaveBeenCalled();
  act(() => confirmCheckout()!.click());
  expect(submit().disabled).toBe(false);
  await act(async () => submit().click());
  expect(state.run).toHaveBeenCalledWith({
    environmentId,
    input: { botId: bot.id, runIds: [original.id], draft: source.draft },
  });
  expect(bot.workspace.type).toBe("scratch");
});

it("waits for the selected historical definition and warns for its checkout even when the live bot uses scratch", async () => {
  const source: BotReplaySourceChoice = { kind: "version", version: 1 };
  render(source);
  expect(submit().disabled).toBe(true);
  expect(container.textContent).toContain("Loading v1");
  state.versionError = "Version could not be loaded.";
  render(source);
  expect(submit().disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(state.versionError);
  act(() => button("Reload version").click());
  expect(state.refresh).toHaveBeenCalled();
  state.versionError = null;
  state.version = {
    botId: bot.id,
    version: 1,
    savedBy: "user",
    savedAt: bot.createdAt,
    changed: [],
    restoredFrom: null,
    definition: {
      ...bot,
      workspace: { type: "project", projectId: null, worktree: false, checkout: "caller" },
    },
  };
  render(source);
  expect(container.textContent).toContain("recorded checkouts");
  expect(submit().disabled).toBe(true);
  act(() => confirmCheckout()!.click());
  await act(async () => submit().click());
  expect(state.run).toHaveBeenCalledWith({
    environmentId,
    input: { botId: bot.id, runIds: [original.id], version: 1 },
  });
});

it("does not require checkout confirmation for a worktree draft", () => {
  render({
    kind: "draft",
    draft: { ...bot, workspace: { type: "project", projectId: null, worktree: true } },
  });
  expect(confirmCheckout()).toBeUndefined();
  expect(submit().disabled).toBe(false);
});

it("keeps selected original inputs and results through paging and the replay's newer runs", async () => {
  const older = makeBotRun("older", {
    inputs: { pr: "98" },
    createdAt: "2026-10-19T10:00:00Z",
    result: "Older original result.",
  });
  state.pages = [
    { runs: [original], hasMore: true },
    { runs: [older], hasMore: false },
  ];
  render();
  act(() => button("Older runs").click());
  expect(container.textContent).toContain("Page 2");
  const selection = container.querySelector('fieldset [role="checkbox"]') as HTMLElement;
  act(() => selection.click());
  expect(submit().textContent).toBe("Replay 2 runs");
  await act(async () => submit().click());
  expect(state.run).toHaveBeenCalledWith({
    environmentId,
    input: { botId: bot.id, runIds: [original.id, older.id], draft: draft.draft },
  });
  state.pages = [
    { runs: [makeBotRun("newer")], hasMore: false },
    { runs: [], hasMore: false },
  ];
  state.changes.runs = new Map([
    [
      "after-original",
      makeBotRun("after-original", { replayId: "comparison", result: "New result." }),
    ],
    ["after-older", makeBotRun("after-older", { replayId: "comparison", result: "Other result." })],
  ]);
  render();
  const results = container.querySelector('[aria-label="Replay comparisons"]')!;
  expect(results.textContent).toContain("pr: 94");
  expect(results.textContent).toContain("pr: 98");
  expect(results.textContent).toContain("Original result.");
  expect(results.textContent).toContain("Older original result.");
  expect(results.textContent).toContain("New result.");
});

it("filters by outcome and rating without dropping hand-picked runs", async () => {
  state.pages[0] = {
    runs: [
      original,
      makeBotRun("failed", { status: "failed", inputs: { pr: "95" }, rating: "up" }),
      makeBotRun("timeout", { status: "timed_out", inputs: { pr: "96" } }),
    ],
    hasMore: false,
  };
  render();
  const choose = async (filterIndex: number, label: string) => {
    await act(async () =>
      (container.querySelectorAll('[role="combobox"]')[filterIndex] as HTMLElement).click(),
    );
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (element) => element.textContent === label,
    )!;
    await act(async () => option.click());
  };
  await choose(0, "Failed or timed out");
  expect(container.querySelector("fieldset")?.textContent).not.toContain("pr: 94");
  expect(container.querySelector("fieldset")?.textContent).toContain("pr: 95");
  await choose(1, "Unrated");
  expect(container.querySelector("fieldset")?.textContent).not.toContain("pr: 95");
  expect(container.querySelector("fieldset")?.textContent).toContain("pr: 96");
  expect(container.querySelector('[aria-label="Selected runs"]')?.textContent).toContain("pr: 94");
  act(() => button("Select shown").click());
  await act(async () => submit().click());
  expect(state.run.mock.calls[0]?.[0].input.runIds).toEqual(["timeout"]);
});

it("retains a failed replay selection and prevents launch after permission loss", async () => {
  state.run.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("Budget exhausted.")),
  });
  render();
  await act(async () => submit().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Budget exhausted.");
  expect(submit().textContent).toBe("Replay 1 run");
  render(draft, false);
  expect(submit().disabled).toBe(true);
  act(() => submit().click());
  expect(state.run).toHaveBeenCalledOnce();
});

it("renews checkout confirmation when the selected runs change", () => {
  state.pages[0] = {
    runs: [original, makeBotRun("second", { inputs: { pr: "97" } })],
    hasMore: false,
  };
  const source: BotReplaySourceChoice = {
    kind: "draft",
    draft: { ...bot, workspace: { type: "project", projectId: null, worktree: false } },
  };
  render(source);
  act(() => confirmCheckout()!.click());
  expect(submit().disabled).toBe(false);
  const second = [...container.querySelectorAll("fieldset label")].find((label) =>
    label.textContent?.includes("pr: 97"),
  )!;
  act(() => second.querySelector<HTMLElement>('[role="checkbox"]')!.click());
  expect(submit().textContent).toBe("Replay 2 runs");
  expect(submit().disabled).toBe(true);
  expect(confirmCheckout()?.getAttribute("aria-checked")).toBe("false");
  act(() => confirmCheckout()!.click());
  expect(submit().disabled).toBe(false);
});

it("compares verdicts, runtime and complete token totals alongside retained replies", async () => {
  const before = {
    ...original,
    usage: {
      inputTokens: 800,
      cachedInputTokens: 400,
      outputTokens: 200,
      status: "complete" as const,
    },
    verdict: {
      verdict: "fail" as const,
      summary: "Found a bug.",
      findings: [],
      findingsTruncated: false,
      source: "decoded" as const,
    },
  };
  state.pages[0] = { runs: [before], hasMore: false };
  render();
  await act(async () => submit().click());
  state.changes.runs = new Map([
    [
      "after-original",
      {
        ...before,
        id: "after-original",
        replayId: "comparison",
        result: "Revised result.",
        finishedAt: "2026-10-20T10:02:10Z",
        usage: { inputTokens: 400, cachedInputTokens: 200, outputTokens: 100, status: "complete" },
        verdict: { ...before.verdict, verdict: "pass", summary: "Fixed the bug." },
      },
    ],
  ]);
  state.replay = {
    ...replay([original.id]),
    status: "done",
    finishedAt: "2026-10-22T17:01:00Z",
    items: [
      {
        originalRunId: original.id,
        replayRunId: "after-original",
        comparison: "fixed",
        reason: null,
      },
    ],
    summary: { fixed: 1, broke: 0, same: 0, changed: 0, failed: 0 },
  };
  render();
  const results = container.querySelector('[aria-label="Replay comparisons"]')!;
  expect(results.textContent).toContain("Ran for 1m");
  expect(results.textContent).toContain("Ran for 2m");
  expect(results.textContent).toContain("1,000 tokens");
  expect(results.textContent).toContain("500 tokens");
  expect(results.textContent).toContain("1m slower (100%)");
  expect(results.textContent).toContain("500 fewer tokens (50%)");
  expect(results.textContent).toContain("Found a bug.");
  expect(results.textContent).toContain("Fixed the bug.");
  expect(container.textContent).toContain("Fixed 1, broke 0, same 0");
});

it("cancels a replay immediately even while its query still holds an older running value", async () => {
  render();
  await act(async () => submit().click());
  state.replay = replay([original.id]);
  state.cancel.mockResolvedValueOnce({
    _tag: "Success",
    value: { ...state.replay, status: "cancelled" },
  });
  render();
  await act(async () => button("Cancel replay").click());
  expect(state.cancel).toHaveBeenCalledWith({ environmentId, input: { replayId: "comparison" } });
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Cancelled.");
  expect(button("Cancel replay")).toBeUndefined();
});

it("recovers replay results from the newest page after starting from an older page without watched events", async () => {
  const older = makeBotRun("older", {
    inputs: { pr: "98" },
    createdAt: "2026-10-19T10:00:00Z",
    result: "Kept older reply.",
  });
  state.pages = [
    { runs: [original], hasMore: true },
    { runs: [older], hasMore: false },
  ];
  render();
  act(() => button("Older runs").click());
  act(() => button("Select shown").click());
  await act(async () => submit().click());
  state.pages[0] = {
    runs: [
      makeBotRun("after-older", { replayId: "comparison", result: "Recovered replay reply." }),
    ],
    hasMore: false,
  };
  render();
  const results = container.querySelector('[aria-label="Replay comparisons"]')!;
  expect(results.textContent).toContain("pr: 98");
  expect(results.textContent).toContain("Kept older reply.");
  expect(results.textContent).toContain("Recovered replay reply.");
});

it("pages from the displayed boundary when live runs displace fetched rows", () => {
  const history = Array.from({ length: 50 }, (_, index) =>
    makeBotRun(`history-${index}`, {
      createdAt: new Date(Date.UTC(2026, 9, 20, 10, 0, 50 - index)).toISOString(),
    }),
  );
  state.pages = [
    { runs: history, hasMore: false },
    { runs: [history[49]!], hasMore: false },
  ];
  state.changes.runs = new Map([
    ["new-live", makeBotRun("new-live", { createdAt: "2026-10-21T10:00:00Z" })],
  ]);
  render();
  expect(container.querySelector("fieldset")?.textContent).not.toContain("history-49");
  act(() => button("Older runs").click());
  expect(state.listInputs.at(-1)?.before).toBe(history[48]!.createdAt);
});
