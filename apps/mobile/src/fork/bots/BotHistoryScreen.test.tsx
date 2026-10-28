// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotReplay, BotRun } from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({
  bot: null as BotDefinition | null,
  runs: [] as BotRun[],
  connected: true,
  exactRuns: {} as Record<string, BotRun>,
  replay: null as BotReplay | null,
  permissions: new Set<string>(),
  execute: vi.fn(),
  refresh: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: harness.navigate, canGoBack: () => true, goBack: vi.fn() }),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (permission: string) => harness.permissions.has(permission),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    accessibilityLabel,
    onPress,
    disabled,
  }: {
    label: string;
    accessibilityLabel?: string;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>
      {label}
    </button>
  ),
}));
vi.mock("./BotControls", () => ({
  BotPage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { name: string }) => (input: unknown) =>
    harness.execute(command.name, input),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (
    query: { name: string; target?: { input?: { runId?: string } } } | null,
  ) => ({
    data:
      query?.name === "getRun"
        ? { run: harness.exactRuns[query.target?.input?.runId ?? ""] ?? null }
        : query?.name === "getReplay"
          ? harness.replay
          : query?.name === "listRuns"
            ? { runs: harness.runs }
            : query?.name === "versions"
              ? {
                  versions: [
                    {
                      botId: "bot",
                      version: 2,
                      savedBy: "user",
                      savedAt: "2026-10-22T10:00:00Z",
                      changed: ["instructions"],
                      restoredFrom: null,
                      runs: 1,
                      passRate: null,
                      medianTotalTokens: null,
                    },
                    {
                      botId: "bot",
                      version: 1,
                      savedBy: "user",
                      savedAt: "2026-10-21T10:00:00Z",
                      changed: [],
                      restoredFrom: null,
                      runs: 1,
                      passRate: null,
                      medianTotalTokens: null,
                    },
                  ],
                  hasMore: false,
                }
              : null,
    error: null,
    isPending: false,
    refresh: harness.refresh,
  }),
}));
vi.mock("./state", () => {
  const command = (name: string) => ({ name, permissionAtom: () => name });
  const query = (name: string) => (target: unknown) => ({ name, target });
  return {
    bots: {
      setStable: command("setStable"),
      restoreVersion: command("restoreVersion"),
      replay: command("replay"),
      cancelReplay: command("cancelReplay"),
      listRuns: query("listRuns"),
      versions: query("versions"),
      version: query("version"),
      getReplay: query("getReplay"),
      getRun: query("getRun"),
    },
    useBotsCapabilities: () => ({
      connected: harness.connected,
      supported: true,
      versionsSupported: true,
      runDetailsSupported: true,
    }),
    useBotsCollection: () => ({
      bots: harness.bot ? [harness.bot] : [],
      changes: { bots: new Map(), runs: new Map(), pruned: 0 },
      query: { data: {}, error: null, isPending: false },
      refresh: harness.refresh,
    }),
    useBotsReconnect: () => {},
  };
});
import { BotHistoryRouteScreen, BotsReplayRouteScreen } from "./BotHistoryScreen";

const definition: BotDefinition = {
  id: "bot",
  name: "Review",
  description: "",
  instructions: "Review changes.",
  parameters: [],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "scratch" },
  timeoutMinutes: 5,
  maxConcurrentRuns: 1,
  scopeProjectId: null,
  version: 2,
  createdBy: "user",
  createdAt: "2026-10-21T10:00:00Z",
  updatedAt: "2026-10-22T10:00:00Z",
  archivedAt: null,
};
const original: BotRun = {
  id: "original",
  botId: "bot",
  botVersion: 1,
  botName: "Review",
  threadId: ThreadId.make("bot-run-original"),
  projectId: null,
  inputs: {},
  status: "completed",
  startedBy: "user",
  callerThreadId: null,
  createdAt: "2026-10-22T10:00:00Z",
  startedAt: "2026-10-22T10:00:00Z",
  finishedAt: "2026-10-22T10:00:05Z",
  result: "Original answer",
  resultTruncated: false,
  error: null,
};
const replay: BotReplay = {
  id: "replay",
  botId: "bot",
  source: { kind: "draft" },
  baseVersion: 2,
  createdAt: "2026-10-22T10:10:00Z",
  finishedAt: null,
  status: "running",
  items: [{ originalRunId: "original", replayRunId: null, comparison: "pending", reason: null }],
  summary: { fixed: 0, broke: 0, same: 0, changed: 0, failed: 0 },
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.bot = definition;
  harness.runs = [original];
  harness.connected = true;
  harness.exactRuns = {};
  harness.replay = null;
  harness.permissions = new Set(["replay", "cancelReplay", "restoreVersion", "setStable"]);
  harness.execute.mockReset();
  harness.refresh.mockReset();
  harness.navigate.mockReset();
  harness.execute.mockResolvedValue({ _tag: "Success", value: replay });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));
const button = (label: string) => {
  const element = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === label || entry.getAttribute("aria-label") === label,
  );
  expect(element, label).toBeDefined();
  return element!;
};
const click = async (label: string) => {
  await act(async () => {
    button(label).click();
  });
};
const renderReplay = (environmentId = "first", draft = definition) =>
  act(() =>
    root.render(
      <BotsReplayRouteScreen route={{ params: { environmentId, botId: "bot", draft } }} />,
    ),
  );

it("replays an unsaved definition with selected past inputs and can cancel it", async () => {
  const draft = { ...definition, instructions: "Improve the answer." };
  renderReplay("first", draft);
  await click("Replay 1 run");
  expect(harness.execute).toHaveBeenCalledWith("replay", {
    environmentId: EnvironmentId.make("first"),
    input: { botId: "bot", draft, runIds: ["original"] },
  });
  expect(container.textContent).toContain("Original answer");
  await click("Cancel replay");
  expect(harness.execute).toHaveBeenCalledWith("cancelReplay", {
    environmentId: EnvironmentId.make("first"),
    input: { replayId: "replay" },
  });
});

it("loads both results directly when reopening a replay outside the recent history", () => {
  harness.runs = [];
  harness.replay = {
    ...replay,
    items: [{ originalRunId: "original", replayRunId: "after", comparison: "fixed", reason: null }],
  };
  harness.exactRuns = {
    original,
    after: { ...original, id: "after", result: "Improved answer", replayId: replay.id },
  };
  act(() =>
    root.render(
      <BotsReplayRouteScreen
        route={{ params: { environmentId: "first", botId: "bot", replayId: replay.id } }}
      />,
    ),
  );
  expect(container.textContent).toContain("Original answer");
  expect(container.textContent).toContain("Improved answer");
  expect(container.textContent).not.toContain("outside the recent");
});

it("explains results removed by retention when reopening an older replay", () => {
  harness.runs = [];
  harness.replay = replay;
  act(() =>
    root.render(
      <BotsReplayRouteScreen
        route={{ params: { environmentId: "first", botId: "bot", replayId: replay.id } }}
      />,
    ),
  );
  expect(container.textContent).toContain("This result is no longer in the retained run history.");
  expect(container.textContent).toContain("Not started");
});

it("prevents replay mutations from read-only and disconnected connections", async () => {
  harness.permissions.clear();
  renderReplay();
  expect(button("Replay 1 run").disabled).toBe(true);
  await click("Replay 1 run");
  expect(harness.execute).not.toHaveBeenCalled();
  harness.permissions.add("replay");
  harness.connected = false;
  renderReplay();
  expect(button("Replay 1 run").disabled).toBe(true);
});

it("does not carry a running replay to a different computer", async () => {
  renderReplay();
  await click("Replay 1 run");
  expect(container.textContent).toContain("Cancel replay");
  renderReplay("second");
  expect(container.textContent).not.toContain("Cancel replay");
  await click("Replay 1 run");
  expect(harness.execute).toHaveBeenLastCalledWith(
    "replay",
    expect.objectContaining({ environmentId: "second" }),
  );
});

it("starts a fresh replay when the editor sends a different unsaved definition", async () => {
  renderReplay();
  await click("Replay 1 run");
  const updated = { ...definition, instructions: "Use the newer instructions." };
  renderReplay("first", updated);
  expect(container.textContent).not.toContain("Cancel replay");
  await click("Replay 1 run");
  expect(harness.execute).toHaveBeenLastCalledWith(
    "replay",
    expect.objectContaining({ input: { botId: "bot", draft: updated, runIds: ["original"] } }),
  );
});

it("guards a version restore against a bot saved after the restore confirmation opened", async () => {
  const render = () =>
    act(() =>
      root.render(
        <BotHistoryRouteScreen route={{ params: { environmentId: "first", botId: "bot" } }} />,
      ),
    );
  render();
  await click("Restore v1");
  harness.bot = { ...definition, version: 3 };
  render();
  expect(button("Confirm restore").disabled).toBe(true);
  expect(container.textContent).toContain("This bot changed after you opened the confirmation.");
  await click("Confirm restore");
  expect(harness.execute).not.toHaveBeenCalled();
  await click("Cancel restore");
  await click("Restore v1");
  await click("Confirm restore");
  expect(harness.execute).toHaveBeenCalledWith("restoreVersion", {
    environmentId: "first",
    input: { botId: "bot", version: 1, expectedVersion: 3 },
  });
});

it("shows mutation failures without losing the replay selection", async () => {
  harness.execute.mockRejectedValueOnce(new Error("Daily budget reached."));
  renderReplay();
  await click("Replay 1 run");
  expect(container.textContent).toContain("Daily budget reached.");
  expect(button("Replay 1 run").disabled).toBe(false);
});
