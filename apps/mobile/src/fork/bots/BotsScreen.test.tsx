// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { BOTS_FEATURE, type BotDefinition } from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({
  allowed: true,
  bots: [] as ReadonlyArray<BotDefinition>,
  navigate: vi.fn(),
  setParams: vi.fn(),
  restore: vi.fn(),
  command: vi.fn(),
  confirm: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => harness.allowed }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: harness.navigate,
    setParams: harness.setParams,
    goBack: vi.fn(),
    isFocused: () => true,
  }),
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    environments: ["first", "second"].map((id) => ({
      environmentId: EnvironmentId.make(id),
      label: id,
      entry: { enabled: true },
      connection: { phase: "connected" },
      serverConfig: { environment: { capabilities: { loomFeatures: [BOTS_FEATURE] } } },
    })),
  }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: { kind: string } | null) => ({
    data:
      query?.kind === "starters"
        ? {
            starters: [
              {
                starterId: "reviewer",
                name: "Reviewer starter",
                description: "Reviews changes",
                state: "removed",
                revision: 1,
              },
            ],
          }
        : query?.kind === "inbox"
          ? { runs: [], total: 0, hasMore: false }
          : null,
    refresh: harness.refresh,
  }),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { name: string }) =>
    command.name === "restoreStarter" ? harness.restore : harness.command,
}));
vi.mock("../../components/ui/Dialog", () => ({ confirm: harness.confirm }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    disabled,
    loading,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    loading?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled || loading} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../components/ui/RowPressable", () => ({
  RowPressable: ({
    children,
    accessibilityLabel,
    onPress,
  }: {
    children: ReactNode;
    accessibilityLabel: string;
    onPress: () => void;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
  }: {
    data: ReadonlyArray<BotDefinition>;
    renderItem: (info: { item: BotDefinition }) => ReactNode;
    ListHeaderComponent: ReactNode;
    ListFooterComponent: ReactNode;
  }) => (
    <div>
      {ListHeaderComponent}
      {data.map((item) => (
        <div key={item.id}>{renderItem({ item })}</div>
      ))}
      {ListFooterComponent}
    </div>
  ),
}));
vi.mock("./BotControls", () => ({
  BotPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  BotSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  BotNotice: ({ detail, error }: { detail?: string; error?: string }) => (
    <div>
      {detail}
      {error}
    </div>
  ),
  BotInput: ({
    label,
    value,
    onChangeText,
  }: {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
  }) => (
    <input
      aria-label={label}
      value={value}
      onInput={(event) => onChangeText(event.currentTarget.value)}
    />
  ),
  BotChoice: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: readonly { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
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
vi.mock("./BotSuggestions", () => ({ BotSuggestions: () => null }));
vi.mock("./BotRunDetailScreen", () => ({ BotRunHistory: () => <span>Run history details</span> }));
vi.mock("./state", () => {
  const command = (name: string) => ({ name, permissionAtom: () => null });
  return {
    bots: {
      save: command("save"),
      run: command("run"),
      archive: command("archive"),
      delete: command("delete"),
      restoreStarter: command("restoreStarter"),
      inbox: () => ({ kind: "inbox" }),
      listStarters: () => ({ kind: "starters" }),
    },
    useBotsCapabilities: (environmentId: string | null) => ({
      label: environmentId,
      connected: true,
      supported: true,
      startersSupported: true,
      fromThreadSupported: true,
      versionsSupported: true,
      verdictsSupported: true,
      budgetsSupported: true,
      anywhereSupported: true,
      triggersSupported: true,
      batchesSupported: true,
      pipelinesSupported: true,
      inboxSupported: true,
    }),
    useBotsCollection: () => ({
      bots: harness.bots,
      changes: { bots: new Map(), runs: new Map(), pruned: 0 },
      query: { error: null, isPending: false },
      refresh: harness.refresh,
    }),
    useBotsReconnect: () => {},
    useWaitingBotRuns: () => [],
  };
});

import { BotDetailRouteScreen, BotsRouteScreen } from "./BotsScreen";

const fixture: BotDefinition = {
  id: "reviewer",
  name: "Reviewer",
  description: "Review changes",
  instructions: "Review the changes.",
  parameters: [],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "scratch" },
  timeoutMinutes: 15,
  maxConcurrentRuns: 3,
  scopeProjectId: null,
  version: 7,
  createdBy: "user",
  createdAt: "2026-10-22T12:00:00Z",
  updatedAt: "2026-10-22T12:00:00Z",
  archivedAt: null,
};
let container: HTMLDivElement;
let root: Root;
function renderCatalog(environmentId = "first", callerThreadId?: string) {
  act(() =>
    root.render(
      <BotsRouteScreen
        route={{ params: { environmentId, ...(callerThreadId ? { callerThreadId } : {}) } }}
      />,
    ),
  );
}
function renderDetail(environmentId = "first") {
  act(() =>
    root.render(<BotDetailRouteScreen route={{ params: { environmentId, botId: fixture.id } }} />),
  );
}
function button(label: string) {
  const value = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label || element.getAttribute("aria-label") === label,
  );
  if (!value) throw new Error(`Missing button: ${label}`);
  return value;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.allowed = true;
  harness.bots = [fixture];
  harness.navigate.mockClear();
  harness.setParams.mockClear();
  harness.restore.mockReset();
  harness.command.mockReset();
  harness.confirm.mockClear();
  harness.refresh.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

it("keeps archived bots inspectable while preventing new runs", () => {
  harness.bots = [{ ...fixture, archivedAt: "2026-10-22T13:00:00Z" }];
  renderDetail();
  expect(container.textContent).toContain("Review the changes.");
  expect(button("Run bot").disabled).toBe(true);
  expect(button("Unarchive bot").disabled).toBe(false);
  act(() => button("Run bot").click());
  expect(harness.navigate).not.toHaveBeenCalled();
});

it("keeps read-only management actions disabled while allowing history inspection", () => {
  harness.allowed = false;
  renderDetail();
  for (const label of ["Run bot", "Edit bot", "Archive bot", "Delete bot"]) {
    expect(button(label).disabled).toBe(true);
    act(() => button(label).click());
  }
  expect(harness.navigate).not.toHaveBeenCalled();
  expect(harness.confirm).not.toHaveBeenCalled();
  act(() => button("Versions and replay").click());
  expect(harness.navigate).toHaveBeenCalledWith("BotsHistory", {
    environmentId: EnvironmentId.make("first"),
    botId: fixture.id,
  });
});

it("uses the selected computer for definitions and clears a caller thread when switching computers", () => {
  renderCatalog("first", "first-thread");
  act(() => button("New bot").click());
  expect(harness.navigate).toHaveBeenLastCalledWith("BotsCreate", {
    environmentId: EnvironmentId.make("first"),
  });
  const picker = container.querySelector<HTMLSelectElement>('[aria-label="Computer"]')!;
  act(() => {
    picker.value = "second";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(harness.setParams).toHaveBeenCalledWith({
    environmentId: "second",
    callerThreadId: undefined,
  });
  renderCatalog("second");
  act(() => button("Reviewer, v7").click());
  expect(harness.navigate).toHaveBeenLastCalledWith("BotsDetail", {
    environmentId: EnvironmentId.make("second"),
    botId: fixture.id,
  });
  act(() => button("New bot").click());
  expect(harness.navigate).toHaveBeenLastCalledWith("BotsCreate", {
    environmentId: EnvironmentId.make("second"),
  });
});

it.each(["switch", "unmount"])(
  "ignores a starter restore that finishes after %s",
  async (reason) => {
    let resolve!: (result: { _tag: "Success"; value: BotDefinition }) => void;
    harness.restore.mockImplementationOnce(
      () =>
        new Promise((complete) => {
          resolve = complete;
        }),
    );
    renderCatalog();
    act(() => button("Restore Reviewer starter").click());
    expect(harness.restore).toHaveBeenCalledWith({
      environmentId: EnvironmentId.make("first"),
      input: { starterId: "reviewer" },
    });
    if (reason === "switch") renderCatalog("second");
    else act(() => root.render(null));
    await act(async () => resolve({ _tag: "Success", value: fixture }));
    expect(harness.navigate).not.toHaveBeenCalled();
  },
);
