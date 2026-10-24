// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotRun } from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({
  bot: null as BotDefinition | null,
  runs: [] as ReadonlyArray<BotRun>,
  dismissed: false,
  preview: vi.fn(),
  runBatch: vi.fn(),
  cancelBatch: vi.fn(),
  retryBatch: vi.fn(),
  dismiss: vi.fn(),
  navigate: vi.fn(),
  refresh: vi.fn(),
  reportRequested: vi.fn(),
  connected: true,
  usesCheckout: false,
  checkoutId: "",
  checkoutThreadId: null as string | null,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: harness.navigate }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./state", () => ({
  bots: {
    inbox: ({ input }: { input: { dismissed?: boolean } }) => ({ kind: "inbox", input }),
    dismiss: { kind: "dismiss", permissionAtom: () => null },
    listBatches: () => ({ kind: "list" }),
    getBatch: () => ({ kind: "batch" }),
    batchReport: () => {
      harness.reportRequested();
      return { kind: "report" };
    },
    previewBatch: {},
    runBatch: { kind: "runBatch", permissionAtom: () => null },
    cancelBatch: { kind: "cancelBatch", permissionAtom: () => null },
    retryBatch: { kind: "retryBatch", permissionAtom: () => null },
  },
  useBotsCapabilities: () => ({
    supported: true,
    connected: harness.connected,
    batchesSupported: true,
    inboxSupported: true,
  }),
  useBotsCollection: () => ({ bots: harness.bot ? [harness.bot] : [], query: { error: null } }),
  useBotBatchChanges: () => ({ batches: new Map(), items: new Map() }),
  useBotsChanges: () => ({ bots: new Map(), runs: new Map(), pruned: 0 }),
  useBotsReconnect: () => {},
  useRefreshWhenBotsChangesPruned: () => {},
  useWaitingBotRuns: () => [
    {
      id: "waiting-thread",
      title: "Approval",
      environmentId: "computer",
      hasPendingApprovals: true,
    },
  ],
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: ({ kind }: { kind: "runBatch" | "cancelBatch" | "retryBatch" | "dismiss" }) =>
    harness[kind],
}));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => harness.preview }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: { kind?: string; input?: { dismissed?: boolean } } | null) => ({
    data:
      atom?.kind === "inbox"
        ? {
            runs: harness.runs.filter(
              (run) => Boolean(run.dismissedAt) === Boolean(atom.input?.dismissed),
            ),
            total: harness.runs.length,
            hasMore: false,
          }
        : atom?.kind === "list"
          ? { batches: [], hasMore: false }
          : atom?.kind === "batch"
            ? {
                batch: {
                  id: "batch-a",
                  botId: "review",
                  botName: "Review",
                  botVersion: 1,
                  status: "finished",
                  sourceSummary: "Two files",
                  createdAt: "2026-10-22T10:00:00Z",
                  counts: {
                    pending: 0,
                    queued: 0,
                    running: 0,
                    completed: 0,
                    failed: 1,
                    timedOut: 0,
                    cancelled: 0,
                    skipped: 0,
                    pass: 0,
                    fail: 0,
                    needsAttention: 1,
                  },
                },
                items: [],
              }
            : atom?.kind === "report"
              ? { markdown: "# Batch report", truncated: false }
              : null,
    error: null,
    isPending: false,
    refresh: harness.refresh,
  }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../library/libraryProjectColors", () => ({
  useLibraryProjectColorValue: () => () => "#000000",
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AppTextInput: ({
    value,
    accessibilityLabel,
    onChangeText,
    editable,
  }: {
    value: string;
    accessibilityLabel: string;
    onChangeText: (value: string) => void;
    editable: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onInput={(event) => onChangeText(event.currentTarget.value)}
    />
  ),
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("./BotControls", () => ({
  BotPage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BotNotice: ({ error, detail }: { error?: string; detail?: string }) => (
    <span>
      {error}
      {detail}
    </span>
  ),
  BotToggle: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <input
      aria-label={label}
      type="checkbox"
      checked={value}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  ),
}));
vi.mock("./BotRunScreen", () => ({
  BotParameterFields: () => null,
  BotRunDestinationFields: () => null,
  useBotRunDestination: () => ({
    projectRequired: false,
    projectId: "project-a",
    usesCheckout: harness.usesCheckout,
    checkoutId: harness.checkoutId,
    checkoutThreadId: harness.checkoutThreadId,
    target: { type: "environment", environmentId: "remote" },
  }),
  RunChoice: ({
    label,
    value,
    choices,
    onChange,
  }: {
    label: string;
    value: string;
    choices: ReadonlyArray<{ value: string; label: string }>;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("./BotRunDetailScreen", () => ({
  BotRunRow: ({ run, actions }: { run: BotRun; actions?: ReactNode }) => (
    <div>
      <span>{run.id}</span>
      {actions}
    </div>
  ),
}));

import { BotBatchesRouteScreen } from "./BotBatchesScreen";
import { BotsInboxRouteScreen } from "./BotsInboxScreen";

const bot: BotDefinition = {
  id: "review",
  name: "Review",
  description: "",
  instructions: "Review {{file}}",
  parameters: [{ name: "file", label: "File", type: "string", required: true }],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "scratch" },
  timeoutMinutes: 10,
  maxConcurrentRuns: 2,
  scopeProjectId: null,
  version: 2,
  createdBy: "user",
  createdAt: "2026-10-22T10:00:00Z",
  updatedAt: "2026-10-22T10:00:00Z",
  archivedAt: null,
};
const run = (id: string): BotRun => ({
  id,
  botId: "review",
  botName: "Review",
  botVersion: 1,
  threadId: ThreadId.make(`bot-run-${id}`),
  projectId: null,
  inputs: {},
  status: "failed",
  startedBy: "user",
  callerThreadId: null,
  createdAt: "2026-10-22T10:00:00Z",
  startedAt: null,
  finishedAt: null,
  result: null,
  resultTruncated: false,
  error: null,
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.bot = bot;
  harness.runs = [];
  harness.connected = true;
  harness.usesCheckout = false;
  harness.checkoutId = "";
  harness.checkoutThreadId = null;
  harness.dismissed = false;
  for (const mock of [
    harness.preview,
    harness.runBatch,
    harness.cancelBatch,
    harness.retryBatch,
    harness.dismiss,
    harness.navigate,
    harness.refresh,
    harness.reportRequested,
  ])
    mock.mockReset();
  harness.preview.mockResolvedValue({
    _tag: "Success",
    value: {
      total: 2,
      sourceSummary: "2 items",
      items: [
        { label: "one", inputs: { file: "one" } },
        { label: "two", inputs: { file: "two" } },
      ],
      invalid: [],
      note: null,
    },
  });
  harness.runBatch.mockResolvedValue({ _tag: "Success", value: { id: "batch-new" } });
  harness.retryBatch.mockResolvedValue({
    _tag: "Success",
    value: { retried: 1, exhausted: ["too-many-attempts"] },
  });
  harness.cancelBatch.mockResolvedValue({ _tag: "Success", value: {} });
  harness.dismiss.mockImplementation(
    async ({ input }: { input: { runIds: ReadonlyArray<string>; dismissed: boolean } }) => {
      harness.runs = harness.runs.map((candidate) =>
        input.runIds.includes(candidate.id)
          ? { ...candidate, dismissedAt: input.dismissed ? "2026-10-22T11:00:00Z" : null }
          : candidate,
      );
      return { _tag: "Success", value: {} };
    },
  );
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));
const button = (label: string) => {
  const result = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  expect(result, label).toBeDefined();
  return result!;
};
const click = (label: string) => act(() => button(label).click());
const enter = (label: string, value: string) =>
  act(() => {
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const renderBatch = (batchId?: string, environmentId = "computer") =>
  act(() =>
    root.render(
      <BotBatchesRouteScreen
        route={{
          params: { environmentId, botId: "review", ...(batchId ? { batchId } : {}) },
        }}
      />,
    ),
  );

it("requires a new preview after editing a batch source and preserves its remote target", async () => {
  renderBatch();
  click("Run on many");
  enter("One item per line", "one\ntwo");
  click("Preview items");
  await act(async () => {});
  expect(button("Run on 2 items").disabled).toBe(false);
  enter("One item per line", "changed");
  expect(container.textContent).toContain("The inputs changed. Preview again");
  expect(button("Run on 0 items").disabled).toBe(true);
  click("Preview items");
  await act(async () => {});
  click("Run on 2 items");
  await act(async () => {});
  expect(harness.runBatch).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("computer"),
    input: {
      botId: "review",
      source: { type: "lines", text: "changed" },
      itemParameter: "file",
      sharedInputs: {},
      projectId: "project-a",
      target: { type: "environment", environmentId: "remote" },
    },
  });
  expect(harness.navigate).toHaveBeenCalledWith("BotsBatches", {
    environmentId: "computer",
    botId: "review",
    batchId: "batch-new",
  });
});

it("blocks invalid preview items from starting a batch", async () => {
  harness.preview.mockResolvedValue({
    _tag: "Success",
    value: {
      total: 1,
      sourceSummary: "Invalid item",
      items: [],
      invalid: [{ label: "bad", message: "Unsupported file" }],
      note: null,
    },
  });
  renderBatch();
  click("Run on many");
  enter("One item per line", "bad");
  click("Preview items");
  await act(async () => {});
  expect(container.textContent).toContain("bad: Unsupported file");
  expect(button("Run on 1 item").disabled).toBe(true);
  expect(harness.runBatch).not.toHaveBeenCalled();
});

it("blocks batch preview and start when a selected source checkout disappears", async () => {
  harness.usesCheckout = true;
  harness.checkoutId = "thread-a";
  harness.checkoutThreadId = "thread-a";
  renderBatch();
  click("Run on many");
  act(() => {
    const source = container.querySelector<HTMLSelectElement>('[aria-label="Items"]')!;
    source.value = "glob";
    source.dispatchEvent(new Event("change", { bubbles: true }));
  });
  enter("File pattern", "src/**/*.ts");
  click("Preview items");
  await act(async () => {});
  expect(button("Run on 2 items").disabled).toBe(false);
  harness.checkoutThreadId = null;
  renderBatch();
  expect(container.textContent).toContain("Choose another checkout or Project root");
  expect(button("Preview items").disabled).toBe(true);
  expect(button("Run on 0 items").disabled).toBe(true);
  expect(harness.preview).toHaveBeenCalledTimes(1);
  expect(harness.runBatch).not.toHaveBeenCalled();
  harness.checkoutId = "";
  renderBatch();
  expect(button("Preview items").disabled).toBe(false);
  click("Preview items");
  await act(async () => {});
  expect(harness.preview.mock.calls.at(-1)?.[0].input.source).toEqual({
    type: "glob",
    pattern: "src/**/*.ts",
  });
});

it("does not navigate when a batch starts after leaving its environment", async () => {
  let finish: (value: unknown) => void = () => {};
  harness.runBatch.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  renderBatch();
  click("Run on many");
  enter("One item per line", "one\ntwo");
  click("Preview items");
  await act(async () => {});
  click("Run on 2 items");
  await act(async () => {});
  expect(harness.runBatch).toHaveBeenCalledTimes(1);
  renderBatch(undefined, "other-computer");
  await act(async () => {
    finish({ _tag: "Success", value: { id: "old-batch" } });
  });
  expect(harness.navigate).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="One item per line"]')).toBeNull();
});

it("retries a finished batch on the latest version and only fetches its report when opened", async () => {
  renderBatch("batch-a");
  expect(harness.reportRequested).not.toHaveBeenCalled();
  act(() =>
    container
      .querySelector<HTMLInputElement>('[aria-label="Retry with version 2 instead of 1"]')!
      .click(),
  );
  click("Retry failed and needs attention");
  await act(async () => {});
  expect(harness.retryBatch).toHaveBeenCalledWith({
    environmentId: "computer",
    input: { batchId: "batch-a", include: "failed_and_attention", useLatest: true },
  });
  expect(container.textContent).toContain("Attempt limit reached: too-many-attempts");
  const refreshesBeforeOpening = harness.refresh.mock.calls.length;
  click("Show report");
  expect(harness.reportRequested).toHaveBeenCalled();
  expect(container.textContent).toContain("# Batch report");
  expect(harness.refresh).toHaveBeenCalledTimes(refreshesBeforeOpening);
});

it("dismisses inbox runs in accepted chunks and can undo the completed subset after a failure", async () => {
  harness.runs = Array.from({ length: 51 }, (_, index) => run(`run-${index}`));
  const successful = harness.dismiss.getMockImplementation()!;
  harness.dismiss
    .mockImplementationOnce(successful)
    .mockRejectedValueOnce(new Error("Connection interrupted"));
  act(() =>
    root.render(<BotsInboxRouteScreen route={{ params: { environmentId: "computer" } }} />),
  );
  click("Answer in thread");
  expect(harness.navigate).toHaveBeenCalledWith("Thread", {
    environmentId: "computer",
    threadId: "waiting-thread",
  });
  click("Dismiss all shown");
  await act(async () => {});
  expect(harness.dismiss.mock.calls.map(([request]) => request.input.runIds.length)).toEqual([
    50, 1,
  ]);
  expect(container.textContent).toContain("Connection interrupted");
  expect(button("Undo dismiss (50)").disabled).toBe(false);
  click("Undo dismiss (50)");
  await act(async () => {});
  expect(harness.dismiss.mock.calls.at(-1)?.[0].input.dismissed).toBe(false);
  expect(harness.runs.every((candidate) => !candidate.dismissedAt)).toBe(true);
});
