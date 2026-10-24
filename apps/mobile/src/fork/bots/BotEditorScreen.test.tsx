// @vitest-environment jsdom
import { StrictMode, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import * as Cause from "effect/Cause";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type { BotDefinition, BotDraftResult } from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({
  bot: null as BotDefinition | null,
  connected: true,
  save: vi.fn(),
  draft: vi.fn(),
  command: vi.fn(),
  goBack: vi.fn(),
  navigate: vi.fn(),
  dispatch: vi.fn(),
  alert: vi.fn(),
  confirm: vi.fn(),
  prevented: false,
  remove: (_event: { data: { action: object } }) => {},
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: harness.goBack,
    navigate: harness.navigate,
    dispatch: harness.dispatch,
    isFocused: () => true,
  }),
  usePreventRemove: (prevented: boolean, callback: typeof harness.remove) => {
    harness.prevented = prevented;
    harness.remove = callback;
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
vi.mock("../../components/ui/Dialog", () => ({ alert: harness.alert, confirm: harness.confirm }));
vi.mock("../../state/entities", () => ({
  useEnvironmentServerConfig: () => null,
  useProjects: () => [],
}));
vi.mock("../../features/settings/scheduledTaskDraft", () => ({
  scheduledTaskDefaultModel: () => ({ instanceId: "codex", model: "test" }),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { name: string }) =>
    command.name === "save"
      ? harness.save
      : command.name === "draftFromThread"
        ? harness.draft
        : harness.command,
}));
vi.mock("./BotModelField", () => ({ BotModelField: () => <span>Model options</span> }));
vi.mock("./state", () => {
  const command = (name: string) => ({ name, permissionAtom: () => null });
  return {
    bots: {
      save: command("save"),
      draftFromThread: command("draftFromThread"),
      refineDraft: command("refineDraft"),
      suggestEdit: command("suggestEdit"),
      restoreStarter: command("restoreStarter"),
      replay: command("replay"),
      dismissSuggestion: command("dismissSuggestion"),
    },
    useBotsCapabilities: () => ({
      connected: harness.connected,
      supported: true,
      startersSupported: true,
      fromThreadSupported: true,
      versionsSupported: true,
      verdictsSupported: true,
      budgetsSupported: true,
      anywhereSupported: true,
    }),
    useBotsCollection: () => ({
      bots: harness.bot ? [harness.bot] : [],
      query: { error: null, isPending: false },
      refresh: () => {},
    }),
  };
});
vi.mock("./BotControls", () => ({
  BotPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  BotSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  BotNotice: ({ error, detail }: { error?: string; detail?: string }) => (
    <div>
      <span>{detail}</span>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  ),
  BotInput: ({
    label,
    value,
    onChangeText,
    disabled,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    disabled?: boolean;
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
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: readonly { value: string; label: string }[];
    onChange: (value: string) => void;
    disabled?: boolean;
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
    onChange,
    disabled,
  }: {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
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

import { BotCreateRouteScreen, BotEditRouteScreen } from "./BotEditorScreen";

const environmentId = EnvironmentId.make("computer");
const fixture: BotDefinition = {
  id: "reviewer",
  name: "Reviewer",
  description: "Review changes",
  instructions: "Review {{file}}.",
  parameters: [
    {
      name: "file",
      label: "File",
      description: "Relative path",
      type: "string",
      required: true,
      default: "src/main.ts",
    },
  ],
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "test",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
  runtimeMode: "auto",
  interactionMode: "plan",
  workspace: { type: "project", projectId: null, worktree: true, baseRef: "main" },
  timeoutMinutes: 15,
  maxConcurrentRuns: 3,
  scopeProjectId: null,
  output: "verdict",
  budget: { runsPerDay: 25, tokensPerDay: 50_000 },
  vaultSlots: [
    {
      name: "github-token",
      label: "GitHub token",
      action: "use",
      destination: "https://api.github.com",
    },
  ],
  version: 7,
  createdBy: "user",
  createdAt: "2026-10-22T12:00:00Z",
  updatedAt: "2026-10-22T12:00:00Z",
  archivedAt: null,
};
let container: HTMLDivElement;
let root: Root;
function edit() {
  act(() =>
    root.render(<BotEditRouteScreen route={{ params: { environmentId, botId: fixture.id } }} />),
  );
}
function button(label: string) {
  const value = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!value) throw new Error(`Missing button: ${label}`);
  return value;
}
function change(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (!input) throw new Error(`Missing input: ${label}`);
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  harness.bot = fixture;
  harness.connected = true;
  harness.save.mockReset();
  harness.draft.mockReset();
  harness.command.mockReset();
  harness.goBack.mockClear();
  harness.navigate.mockClear();
  harness.dispatch.mockClear();
  harness.alert.mockClear();
  harness.confirm.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps the full definition and failed edits through a pending save, then retries the same version", async () => {
  let reject!: (error: Error) => void;
  harness.save.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  edit();
  change("Name", "Reviewed changes");
  act(() => button("Save bot").click());
  expect(harness.save.mock.calls[0]?.[0]).toEqual({
    environmentId,
    input: {
      id: fixture.id,
      name: "Reviewed changes",
      description: fixture.description,
      instructions: fixture.instructions,
      parameters: fixture.parameters,
      modelSelection: fixture.modelSelection,
      runtimeMode: fixture.runtimeMode,
      interactionMode: fixture.interactionMode,
      workspace: fixture.workspace,
      timeoutMinutes: fixture.timeoutMinutes,
      maxConcurrentRuns: fixture.maxConcurrentRuns,
      scopeProjectId: fixture.scopeProjectId,
      output: fixture.output,
      budget: fixture.budget,
      vaultSlots: fixture.vaultSlots,
      expectedVersion: 7,
    },
  });
  act(() => harness.remove({ data: { action: { type: "GO_BACK" } } }));
  expect(harness.alert).toHaveBeenCalledWith("Saving bot", expect.any(String));
  expect(harness.dispatch).not.toHaveBeenCalled();
  await act(async () => reject(new Error("Connection interrupted")));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Connection interrupted");
  expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')?.value).toBe(
    "Reviewed changes",
  );
  harness.save.mockResolvedValueOnce({ _tag: "Success", value: fixture });
  await act(async () => button("Save bot").click());
  expect(harness.save.mock.calls[1]?.[0].input.expectedVersion).toBe(7);
  expect(harness.goBack).toHaveBeenCalledOnce();
});

it("protects unsaved changes from remote edits and only advances the version after reload", async () => {
  edit();
  change("Name", "Unsaved name");
  harness.bot = { ...fixture, name: "Changed elsewhere", version: 8 };
  edit();
  expect(button("Save bot").disabled).toBe(true);
  expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')?.value).toBe(
    "Unsaved name",
  );
  act(() => button("Reload latest bot").click());
  act(() => harness.confirm.mock.calls[0]?.[0].onConfirm());
  expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')?.value).toBe(
    "Changed elsewhere",
  );
  harness.save.mockResolvedValueOnce({ _tag: "Success", value: harness.bot });
  await act(async () => button("Save bot").click());
  expect(harness.save.mock.calls[0]?.[0].input.expectedVersion).toBe(8);
});

it("retains an unsaved definition when the bot is deleted elsewhere", () => {
  edit();
  change("Name", "Unsaved name");
  harness.bot = null;
  edit();
  expect(container.textContent).toContain("This bot was removed");
  expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')?.value).toBe(
    "Unsaved name",
  );
  expect(button("Save bot").disabled).toBe(true);
  expect(harness.prevented).toBe(true);
});

it("starts one thread draft during effect replay and ignores a stopped result", async () => {
  let resolve!: (value: { _tag: "Success"; value: BotDraftResult }) => void;
  harness.bot = null;
  harness.draft.mockImplementationOnce(
    () =>
      new Promise((complete) => {
        resolve = complete;
      }),
  );
  act(() =>
    root.render(
      <StrictMode>
        <BotCreateRouteScreen
          route={{
            params: { environmentId, sourceThreadId: "thread-a" },
          }}
        />
      </StrictMode>,
    ),
  );
  expect(harness.draft).toHaveBeenCalledOnce();
  act(() => button("Stop waiting").click());
  change("Name", "Manual draft");
  expect(container.querySelector<HTMLInputElement>('[aria-label="Id"]')?.value).toBe(
    "manual-draft",
  );
  await act(async () =>
    resolve({
      _tag: "Success",
      value: {
        draft: fixture,
        sourceThreadId: "thread-a" as BotDraftResult["sourceThreadId"],
        notes: [],
      },
    }),
  );
  expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')?.value).toBe(
    "Manual draft",
  );
});

it("dismisses a source suggestion only after its bot was successfully saved", async () => {
  harness.bot = null;
  harness.draft.mockResolvedValueOnce({
    _tag: "Success",
    value: { draft: fixture, sourceThreadId: "thread-a", notes: [] },
  });
  harness.save.mockResolvedValueOnce({ _tag: "Success", value: fixture });
  harness.command.mockResolvedValue({ _tag: "Success", value: {} });
  await act(async () =>
    root.render(
      <BotCreateRouteScreen
        route={{
          params: { environmentId, sourceThreadId: "thread-a", suggestionId: "suggestion-a" },
        }}
      />,
    ),
  );
  expect(harness.command).not.toHaveBeenCalled();
  await act(async () => button("Save bot").click());
  expect(harness.command).toHaveBeenCalledWith({
    environmentId,
    input: { suggestionId: "suggestion-a", dismissed: true },
  });
  expect(harness.goBack).toHaveBeenCalledOnce();
});

it("keeps changes made after drafting when the computer reconnects", async () => {
  harness.bot = null;
  harness.draft.mockResolvedValueOnce({
    _tag: "Success",
    value: { draft: fixture, sourceThreadId: "thread-a", notes: [] },
  });
  const render = () =>
    root.render(
      <BotCreateRouteScreen route={{ params: { environmentId, sourceThreadId: "thread-a" } }} />,
    );
  await act(async () => render());
  change("Name", "Kept after reconnect");
  harness.connected = false;
  act(render);
  harness.connected = true;
  await act(async () => render());
  expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')?.value).toBe(
    "Kept after reconnect",
  );
  expect(harness.draft).toHaveBeenCalledOnce();
});

it("creates a new bot as version 0, so a taken id is refused instead of overwritten", async () => {
  harness.bot = null;
  harness.draft.mockResolvedValueOnce({
    _tag: "Success",
    value: { draft: fixture, sourceThreadId: "thread-a", notes: [] },
  });
  harness.save.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(
      new Error("This bot changed since it was opened. Reload it and apply your edits again."),
    ),
  });
  await act(async () =>
    root.render(
      <BotCreateRouteScreen route={{ params: { environmentId, sourceThreadId: "thread-a" } }} />,
    ),
  );
  await act(async () => button("Save bot").click());
  expect(harness.save.mock.calls[0]?.[0].input.expectedVersion).toBe(0);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    `Another bot already uses the id ${fixture.id}. Choose another id.`,
  );
});
