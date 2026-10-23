// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type { BotDefinition, BotPipeline, BotTrigger } from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({ saveTrigger: vi.fn(), savePipeline: vi.fn(), check: vi.fn() }));
vi.mock("react-native", () => ({
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
vi.mock("../../state/entities", () => ({ useProjects: () => [] }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: { library: "none", targets: [] }, error: null }),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "saveTrigger" ? harness.saveTrigger : harness.savePipeline,
}));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => harness.check }));
vi.mock("./state", () => ({
  bots: {
    saveTrigger: "saveTrigger",
    savePipeline: "savePipeline",
    targets: () => null,
    checkPipeline: () => null,
  },
  useBotsCapabilities: () => ({
    versionsSupported: true,
    batchesSupported: true,
    anywhereSupported: true,
  }),
}));
vi.mock("./BotControls", () => ({
  BotSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  BotField: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
vi.mock("./BotModelField", () => ({ BotModelField: () => <span>Model</span> }));
vi.mock("./BotEditorScreen", () => ({ BotParameterEditor: () => <span>Parameter</span> }));
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
    choices: ReadonlyArray<{ value: string; label: string }>;
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
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  ),
}));

import { BotTriggerEditor } from "./BotTriggerEditor";
import { BotPipelineEditor } from "./BotPipelineEditor";
const environmentId = EnvironmentId.make("first");
const at = "2026-10-22T10:00:00.000Z";
const bot: BotDefinition = {
  id: "review",
  name: "Review",
  description: "",
  instructions: "Review {{url}}",
  parameters: [{ name: "url", label: "URL", type: "string", required: true }],
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
  output: "verdict",
};
const trigger: BotTrigger = {
  id: "trigger",
  botId: bot.id,
  name: "Webhook review",
  event: {
    kind: "webhook",
    signature: { header: "x-signature", encoding: "hex", prefix: "sha256=" },
  },
  mapping: { url: { field: "body.url" } },
  enabled: true,
  cooldownMinutes: 10,
  dailyLimit: 20,
  pinnedVersion: 2,
  followLatest: false,
  followStable: true,
  createdBy: "user",
  createdAt: at,
  updatedAt: at,
  lastFiredAt: null,
  nextFireAt: null,
  webhook: { path: "/hook", url: null, hasSecret: true },
};
const pipeline: BotPipeline = {
  id: "review-flow",
  name: "Review flow",
  description: "",
  parameters: [],
  steps: [
    {
      id: "review",
      botId: bot.id,
      version: 2,
      inputs: { url: "{{item}}" },
      forEach: { from: "{{input.targets}}", itemLabel: "Target {{item}}" },
      onFail: { goTo: "review", maxRounds: 2 },
      onNeedsAttention: "continue",
      onError: "continue",
      modelSelection: bot.modelSelection,
      target: { type: "best" },
    },
  ],
  version: 7,
  createdBy: "user",
  createdAt: at,
  updatedAt: at,
};
let container: HTMLDivElement, root: Root | null;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.saveTrigger.mockReset().mockResolvedValue({ _tag: "Success", value: trigger });
  harness.savePipeline.mockReset().mockResolvedValue({ _tag: "Success", value: pipeline });
  harness.check.mockReset().mockResolvedValue({ _tag: "Success", value: { problems: [] } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});
const render = async (node: ReactNode) => {
  await act(async () => root?.render(node));
};
const press = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
};
const type = async (label: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

it("updates a signed trigger without discarding its stored secret, version policy or edit authority", async () => {
  const saved = vi.fn();
  await render(
    <BotTriggerEditor
      environmentId={environmentId}
      bot={bot}
      trigger={trigger}
      pipelines={[]}
      canSave
      stableSupported
      onSaved={saved}
      onClose={() => {}}
    />,
  );
  await type("Name", "Updated trigger");
  await press("Save trigger");
  expect(harness.saveTrigger).toHaveBeenCalledWith({
    environmentId,
    input: expect.objectContaining({
      id: trigger.id,
      expectedUpdatedAt: at,
      name: "Updated trigger",
      mapping: { url: { field: "body.url" } },
      followStable: true,
    }),
  });
  expect(harness.saveTrigger.mock.calls[0]?.[0].input).not.toHaveProperty("webhookSecret");
  expect(saved).toHaveBeenCalledWith(trigger);
});

it("validates trigger limits before invoking its command", async () => {
  await render(
    <BotTriggerEditor
      environmentId={environmentId}
      bot={bot}
      trigger={trigger}
      pipelines={[]}
      canSave
      stableSupported
      onSaved={() => {}}
      onClose={() => {}}
    />,
  );
  await type("Maximum runs per day", "0");
  await press("Save trigger");
  expect(harness.saveTrigger).not.toHaveBeenCalled();
  expect(container.textContent).toContain("The daily limit is 1 to 500 runs.");
});

it("does not dismiss a departed trigger form when its save finishes", async () => {
  let finish!: (result: { _tag: "Success"; value: BotTrigger }) => void;
  harness.saveTrigger.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const saved = vi.fn();
  await render(
    <BotTriggerEditor
      environmentId={environmentId}
      bot={bot}
      trigger={trigger}
      pipelines={[]}
      canSave
      stableSupported
      onSaved={saved}
      onClose={() => {}}
    />,
  );
  await press("Save trigger");
  await act(async () => {
    root?.unmount();
    root = null;
  });
  await act(async () => finish({ _tag: "Success", value: trigger }));
  expect(saved).not.toHaveBeenCalled();
});

it("checks pipeline references before saving and preserves every step override", async () => {
  const saved = vi.fn();
  await render(
    <BotPipelineEditor
      environmentId={environmentId}
      pipeline={pipeline}
      allBots={[bot]}
      canSave
      onSaved={saved}
      onClose={() => {}}
    />,
  );
  await type("Name", "Updated pipeline");
  await press("Save pipeline");
  expect(harness.check).toHaveBeenCalledWith({
    environmentId,
    input: {
      pipeline: expect.objectContaining({ name: "Updated pipeline", steps: pipeline.steps }),
    },
  });
  expect(harness.savePipeline).toHaveBeenCalledWith({
    environmentId,
    input: {
      expectedVersion: 7,
      pipeline: expect.objectContaining({ name: "Updated pipeline", steps: pipeline.steps }),
    },
  });
  expect(saved).toHaveBeenCalledWith(pipeline);
});

it("blocks pipeline save when the server finds an invalid step reference", async () => {
  harness.check.mockResolvedValue({
    _tag: "Success",
    value: {
      problems: [
        {
          stepId: "review",
          field: "forEach",
          message: "Input targets does not exist.",
          severity: "error",
        },
      ],
    },
  });
  await render(
    <BotPipelineEditor
      environmentId={environmentId}
      pipeline={pipeline}
      allBots={[bot]}
      canSave
      onSaved={() => {}}
      onClose={() => {}}
    />,
  );
  await press("Save pipeline");
  expect(harness.savePipeline).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Input targets does not exist.");
});

it("does not save a departed pipeline after its check resolves", async () => {
  let finish!: (result: { _tag: "Success"; value: { problems: [] } }) => void;
  harness.check.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render(
    <BotPipelineEditor
      environmentId={environmentId}
      pipeline={pipeline}
      allBots={[bot]}
      canSave
      onSaved={() => {}}
      onClose={() => {}}
    />,
  );
  await press("Save pipeline");
  await act(async () => {
    root?.unmount();
    root = null;
  });
  await act(async () => finish({ _tag: "Success", value: { problems: [] } }));
  expect(harness.savePipeline).not.toHaveBeenCalled();
});
