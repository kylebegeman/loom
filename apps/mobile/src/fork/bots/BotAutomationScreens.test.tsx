// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type {
  BotDefinition,
  BotPipeline,
  BotPipelineRun,
  BotTrigger,
  BotTriggerFiring,
} from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({
  connected: true,
  supported: true,
  queryError: null as string | null,
  projects: [] as Array<{ id: string; title: string; environmentId: string; isScratch: boolean }>,
  shells: [] as Array<{
    id: string;
    projectId: string;
    environmentId: string;
    title: string;
    branch: string;
    worktreePath: string;
    archivedAt: null;
    updatedAt: string;
  }>,
  denied: new Set<string>(),
  commands: vi.fn(),
  confirm: vi.fn(),
  navigate: vi.fn(),
  copied: vi.fn(),
  refresh: vi.fn(),
  firstRefresh: vi.fn(),
  trigger: null as BotTrigger | null,
  firings: [] as ReadonlyArray<BotTriggerFiring>,
  pipeline: null as BotPipeline | null,
  bot: null as BotDefinition | null,
  run: null as BotPipelineRun | null,
  reconnect: [] as Array<() => void>,
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (permission: string) => !harness.denied.has(permission),
  useAtomRefresh: () => harness.firstRefresh,
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: harness.navigate }),
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
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
vi.mock("../../components/ui/Sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => harness.projects,
  useThreadShells: () => harness.shells,
}));
vi.mock("../../state/session", async () => {
  const Option = await import("effect/Option");
  return { usePreparedConnection: () => Option.some({ httpBaseUrl: "https://computer.example" }) };
});
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { name: string }) => (input: unknown) =>
    harness.commands(command.name, input),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: { name: string } | null) => ({
    data: harness.queryError
      ? null
      : query?.name === "listTriggers"
        ? { triggers: harness.trigger ? [harness.trigger] : [] }
        : query?.name === "listPipelines"
          ? { pipelines: harness.pipeline ? [harness.pipeline] : [] }
          : query?.name === "listPipelineRuns"
            ? { runs: harness.run ? [harness.run] : [], hasMore: false }
            : query?.name === "getPipelineRun"
              ? { run: harness.run, attempts: [], report: { markdown: "Report", truncated: false } }
              : query?.name === "triggerFirings"
                ? { firings: harness.firings, hasMore: false }
                : null,
    error: harness.queryError,
    isPending: false,
    refresh: harness.refresh,
  }),
}));
vi.mock("../../lib/copyTextWithHaptic", () => ({ tryCopyTextWithHaptic: harness.copied }));
vi.mock("../../features/files/FileMarkdownPreview", () => ({
  useMarkdownPreviewStyles: () => ({ nativeTextStyle: {} }),
}));
vi.mock("../../native/SelectableMarkdownText", () => ({
  SelectableMarkdownText: ({ markdown }: { markdown: string }) => <span>{markdown}</span>,
}));
vi.mock("../preview-links/navigation", () => ({ openThreadUrlExternally: vi.fn() }));
vi.mock("./botAutomationActions", () => ({ confirmBotAutomation: harness.confirm }));
vi.mock("./BotTriggerEditor", () => ({ BotTriggerEditor: () => <span>Trigger editor</span> }));
vi.mock("./BotPipelineEditor", () => ({ BotPipelineEditor: () => <span>Pipeline editor</span> }));
vi.mock("./BotRunScreen", () => ({
  RunChoice: ({
    label,
    value,
    choices,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    choices: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value} disabled={choice.disabled}>
          {choice.label}
        </option>
      ))}
    </select>
  ),
  BotParameterFields: () => <span>Parameters</span>,
}));
vi.mock("./BotControls", () => ({
  BotPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  BotSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  BotNotice: ({ error, detail }: { error?: string; detail?: string }) => (
    <div>
      {error ? <span role="alert">{error}</span> : null}
      {detail}
    </div>
  ),
  BotInput: ({
    label,
    value,
    disabled,
    onChangeText,
  }: {
    label: string;
    value: string;
    disabled?: boolean;
    onChangeText: (value: string) => void;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={disabled}
      onInput={(event) => onChangeText(event.currentTarget.value)}
    />
  ),
  BotChoice: ({
    label,
    value,
    options,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    options: ReadonlyArray<{ value: string; label: string }>;
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  BotToggle: ({
    label,
    value,
    disabled,
    onChange,
  }: {
    label: string;
    value: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <input
      aria-label={label}
      type="checkbox"
      checked={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  ),
}));
vi.mock("./state", async () => {
  const shared = await import("@t3tools/client-runtime/fork");
  const family = (name: string) => (target: unknown) => ({ name, target });
  const command = (name: string) => ({ name, permissionAtom: () => name });
  return {
    bots: {
      listTriggers: family("listTriggers"),
      listPipelines: family("listPipelines"),
      listPipelineRuns: family("listPipelineRuns"),
      getPipelineRun: family("getPipelineRun"),
      triggerFirings: family("triggerFirings"),
      ...Object.fromEntries(
        [
          "setTriggerEnabled",
          "saveTrigger",
          "deleteTrigger",
          "testTrigger",
          "repinTrigger",
          "rotateTriggerToken",
          "savePipeline",
          "deletePipeline",
          "runPipeline",
          "cancelPipelineRun",
          "resumePipelineRun",
        ].map((name) => [name, command(name)]),
      ),
    },
    useBotsCapabilities: () => ({
      connected: harness.connected,
      supported: harness.supported,
      label: "First",
      triggersSupported: harness.supported,
      pipelinesSupported: harness.supported,
      versionsSupported: true,
      batchesSupported: true,
    }),
    useBotsCollection: () => ({
      bots: harness.bot ? [harness.bot] : [],
      query: { error: null, isPending: false },
      refresh: harness.refresh,
    }),
    useBotPipelineChanges: () => shared.EMPTY_BOT_PIPELINE_CHANGES,
    useBotTriggerChanges: () => shared.EMPTY_BOT_TRIGGER_CHANGES,
    useBotsReconnect: (_connected: boolean, refresh: () => void) => {
      harness.reconnect.push(refresh);
    },
  };
});
import { BotTriggersRouteScreen } from "./BotTriggersScreen";
import { BotPipelinesRouteScreen } from "./BotPipelinesScreen";
const environmentId = EnvironmentId.make("first"),
  at = "2026-10-22T10:00:00.000Z";
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.connected = true;
  harness.supported = true;
  harness.queryError = null;
  harness.firings = [];
  harness.projects = [];
  harness.shells = [];
  harness.denied.clear();
  harness.reconnect = [];
  harness.commands.mockReset().mockResolvedValue({ _tag: "Success", value: {} });
  harness.confirm.mockReset().mockResolvedValue(true);
  harness.navigate.mockReset();
  harness.copied.mockReset().mockResolvedValue(true);
  harness.refresh.mockReset();
  harness.firstRefresh.mockReset();
  harness.bot = {
    id: "review",
    name: "Review",
    description: "",
    instructions: "Review",
    parameters: [],
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
    runtimeMode: "auto",
    interactionMode: "default",
    workspace: { type: "scratch" },
    timeoutMinutes: 5,
    maxConcurrentRuns: 1,
    scopeProjectId: null,
    version: 3,
    createdBy: "user",
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
  };
  harness.trigger = {
    id: "trigger",
    botId: "review",
    name: "Review webhook",
    event: { kind: "webhook" },
    mapping: {},
    enabled: true,
    cooldownMinutes: 10,
    dailyLimit: 20,
    pinnedVersion: 3,
    followLatest: false,
    createdBy: "user",
    createdAt: at,
    updatedAt: at,
    lastFiredAt: null,
    nextFireAt: null,
    webhook: { path: "/hooks/review", url: null, hasSecret: false },
  };
  harness.pipeline = {
    id: "flow",
    name: "Flow",
    description: "",
    parameters: [],
    steps: [{ id: "review", botId: "review", inputs: {} }],
    version: 3,
    createdBy: "user",
    createdAt: at,
    updatedAt: at,
  };
  harness.run = {
    id: "pipeline-run",
    pipelineId: "flow",
    pipelineVersion: 2,
    pipelineName: "Flow",
    inputs: {},
    projectId: null,
    checkoutThreadId: null,
    status: "failed",
    retryAt: null,
    cursorStepId: "review",
    finalVerdict: null,
    stoppedRunId: null,
    error: "Step failed",
    startedBy: "user",
    callerThreadId: null,
    createdAt: at,
    finishedAt: at,
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const renderTriggers = (id: string = environmentId) =>
  act(() => root.render(<BotTriggersRouteScreen route={{ params: { environmentId: id } }} />));
const renderPipelines = () =>
  act(() =>
    root.render(
      <BotPipelinesRouteScreen route={{ params: { environmentId, runId: "pipeline-run" } }} />,
    ),
  );
const press = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
};

it("arms triggers and rotates webhook addresses on the selected computer", async () => {
  renderTriggers();
  const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Armed"]');
  await act(async () => toggle!.click());
  expect(harness.commands).toHaveBeenCalledWith("setTriggerEnabled", {
    environmentId,
    input: { triggerId: "trigger", enabled: false },
  });
  await press("Rotate address");
  expect(harness.commands).toHaveBeenCalledWith("rotateTriggerToken", {
    environmentId,
    input: { triggerId: "trigger" },
  });
  await press("Copy address");
  expect(harness.copied).toHaveBeenCalledWith("https://computer.example/hooks/review", {
    target: "trigger address",
  });
});
it("keeps trigger mutations disabled independently when their permission is absent", async () => {
  harness.denied.add("setTriggerEnabled");
  harness.denied.add("rotateTriggerToken");
  harness.denied.add("deleteTrigger");
  renderTriggers();
  await press("Rotate address");
  await press("Delete");
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Armed"]')?.disabled).toBe(
    true,
  );
  expect(harness.commands).not.toHaveBeenCalled();
  expect(harness.confirm).not.toHaveBeenCalled();
});
it("does not execute a confirmed trigger deletion after changing computers", async () => {
  let finish!: (confirmed: boolean) => void;
  harness.confirm.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  renderTriggers();
  await press("Delete");
  renderTriggers("second");
  await act(async () => finish(true));
  expect(harness.commands).not.toHaveBeenCalled();
});
it("retries the pinned step of a failed pipeline through its scoped command", async () => {
  renderPipelines();
  await press("Retry failed step");
  expect(harness.commands).toHaveBeenCalledWith("resumePipelineRun", {
    environmentId,
    input: { pipelineRunId: "pipeline-run" },
  });
});
it("does not cancel a pipeline when confirmation is declined", async () => {
  harness.run = { ...harness.run!, status: "running" };
  harness.confirm.mockResolvedValue(false);
  renderPipelines();
  await press("Cancel pipeline");
  expect(harness.commands).not.toHaveBeenCalled();
});
it("does not refresh pipeline RPCs on a host that lacks pipeline support", () => {
  harness.supported = false;
  renderPipelines();
  act(() => {
    for (const refresh of harness.reconnect) refresh();
  });
  expect(harness.firstRefresh).not.toHaveBeenCalled();
});

it("requires an explicit destination when the selected pipeline checkout disappears", async () => {
  harness.projects = [{ id: "project", title: "Project", environmentId, isScratch: false }];
  harness.shells = [
    {
      id: "thread",
      projectId: "project",
      environmentId,
      title: "Feature",
      branch: "feature",
      worktreePath: "/work/feature",
      archivedAt: null,
      updatedAt: at,
    },
  ];
  harness.bot = {
    ...harness.bot!,
    workspace: { type: "project", projectId: null, worktree: false, checkout: "caller" },
  };
  renderPipelines();
  await press("Run Flow");
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Checkout for caller-checkout steps"]',
  );
  expect(select).not.toBeNull();
  act(() => {
    select!.value = "thread";
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  harness.shells = [];
  renderPipelines();
  await press("Run pipeline");
  expect(harness.commands).not.toHaveBeenCalled();
  expect(container.textContent).toContain(
    "This checkout is no longer available. Choose another checkout or the project root.",
  );
});

it("requires reviewing a pipeline again when it changes while its run form is open", async () => {
  renderPipelines();
  await press("Run Flow");
  harness.pipeline = { ...harness.pipeline!, version: 4 };
  renderPipelines();
  await press("Run pipeline");
  expect(harness.commands).not.toHaveBeenCalled();
  expect(container.textContent).toContain("This pipeline changed or was deleted.");
});

it("does not present a failed trigger query as an empty collection", () => {
  harness.trigger = null;
  harness.queryError = "Could not load triggers.";
  renderTriggers();
  expect(container.textContent).toContain("Could not load triggers.");
  expect(container.textContent).not.toContain("No triggers yet.");
});

it("opens a trigger firing's bot run on its owning computer", async () => {
  harness.firings = [
    {
      id: "firing",
      triggerId: "trigger",
      eventKey: "event",
      eventSummary: "Manual test",
      firedAt: at,
      outcome: "run",
      runId: "bot-run",
      reason: null,
    },
  ];
  renderTriggers();
  await press("Firing history");
  await press("Open bot run");
  expect(harness.navigate).toHaveBeenCalledWith("BotsRunDetail", {
    environmentId,
    runId: "bot-run",
  });
});
