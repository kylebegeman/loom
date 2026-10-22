// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ProviderInstanceId } from "@t3tools/contracts";
import type { BotDefinition } from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({
  bot: null as BotDefinition | null,
  permissions: new Set<string>(),
  bindings: {} as Record<
    string,
    { slot: string; itemId: string | null; itemLabel: string | null }[]
  >,
  execute: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), canGoBack: () => true }),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (permission: string) => harness.permissions.has(permission),
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
  BotSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  BotChoice: () => null,
  BotToggle: () => null,
}));
vi.mock("../vault/ReferenceSearch", () => ({
  VaultReferenceSearch: ({
    environmentId,
    connected,
    onSelect,
  }: {
    environmentId: string;
    connected: boolean;
    onSelect: (reference: { item: { id: string } }) => void;
  }) => (
    <div role="dialog">
      <span>Vault items on {environmentId}</span>
      <button
        disabled={!connected}
        onClick={() => onSelect({ item: { id: `key-${environmentId}` } })}
      >
        Choose registry key
      </button>
    </div>
  ),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { name: string }) => (target: unknown) =>
    harness.execute(command.name, target),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: { name: string; target: { environmentId: string } } | null) => ({
    data:
      query?.name === "remoteSettings"
        ? { acceptRemote: false, runtimeModeCeiling: "auto" }
        : query?.name === "targets"
          ? { library: "available", targets: [] }
          : query?.name === "vaultBindings"
            ? { bindings: harness.bindings[query.target.environmentId] ?? [] }
            : query?.name === "listRuns"
              ? { runs: [], hasMore: false }
              : null,
    error: null,
    isPending: false,
    refresh: harness.refresh,
  }),
}));
vi.mock("./state", () => {
  const query = (name: string) => (target: unknown) => ({ name, target });
  const command = (name: string) => ({ name, permissionAtom: () => name });
  return {
    bots: {
      remoteSettings: query("remoteSettings"),
      targets: query("targets"),
      vaultBindings: query("vaultBindings"),
      listRuns: query("listRuns"),
      setRemoteSettings: command("setRemoteSettings"),
      syncLibrary: command("syncLibrary"),
      share: command("share"),
      unshare: command("unshare"),
      bindVaultSlot: command("bindVaultSlot"),
    },
    useBotsCapabilities: () => ({
      connected: true,
      supported: true,
      anywhereSupported: true,
      label: "Computer",
    }),
    useBotsCollection: () => ({
      bots: harness.bot ? [harness.bot] : [],
      changes: { bots: new Map(), runs: new Map(), pruned: 0 },
      query: { data: {}, error: null, isPending: false },
      refresh: harness.refresh,
    }),
    useBotsReconnect: () => {},
    useRefreshWhenBotsChangesPruned: () => {},
  };
});
import { BotsComputersRouteScreen } from "./BotsComputersScreen";

const bot: BotDefinition = {
  id: "publisher",
  name: "Publish",
  description: "",
  instructions: "Publish the release.",
  parameters: [],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "scratch" },
  timeoutMinutes: 5,
  maxConcurrentRuns: 1,
  scopeProjectId: null,
  version: 1,
  createdBy: "user",
  createdAt: "2026-10-22T10:00:00Z",
  updatedAt: "2026-10-22T10:00:00Z",
  archivedAt: null,
  vaultSlots: [{ name: "registry", label: "Registry", action: "use" }],
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.bot = bot;
  harness.permissions = new Set([
    "bindVaultSlot",
    "share",
    "unshare",
    "setRemoteSettings",
    "syncLibrary",
  ]);
  harness.bindings = { first: [], second: [] };
  harness.execute.mockReset();
  harness.refresh.mockReset();
  harness.execute.mockImplementation(
    async (
      name: string,
      target: { environmentId: string; input: { slot?: string; itemId?: string | null } },
    ) => {
      if (name === "bindVaultSlot")
        harness.bindings[target.environmentId] = [
          {
            slot: target.input.slot!,
            itemId: target.input.itemId ?? null,
            itemLabel: target.input.itemId ? "Registry key" : null,
          },
        ];
      return { _tag: "Success", value: {} };
    },
  );
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));
const render = (environmentId = "first") =>
  act(() =>
    root.render(<BotsComputersRouteScreen route={{ params: { environmentId, botId: bot.id } }} />),
  );
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === label || entry.getAttribute("aria-label") === label,
  );
  expect(found, label).toBeDefined();
  return found!;
}
const click = async (label: string) => {
  await act(async () => {
    button(label).click();
  });
};

it("binds a picked native Vault reference to the selected bot slot on the selected computer and clears it", async () => {
  render();
  await click("Bind Registry Vault item");
  expect(container.textContent).toContain("Vault items on first");
  await click("Choose registry key");
  expect(harness.execute).toHaveBeenCalledWith("bindVaultSlot", {
    environmentId: "first",
    input: { botId: "publisher", slot: "registry", itemId: "key-first" },
  });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain("Registry key");
  await click("Clear Registry binding");
  expect(harness.execute).toHaveBeenLastCalledWith("bindVaultSlot", {
    environmentId: "first",
    input: { botId: "publisher", slot: "registry", itemId: null },
  });
  expect(container.textContent).toContain("Not bound on this computer");
});

it("blocks binding after the connection becomes read-only, including an already open picker", async () => {
  render();
  await click("Bind Registry Vault item");
  harness.permissions.clear();
  render();
  expect(button("Choose registry key").disabled).toBe(true);
  expect(button("Bind Registry Vault item").disabled).toBe(true);
  await click("Choose registry key");
  expect(harness.execute).not.toHaveBeenCalled();
});

it("closes a pending Vault choice when navigating to another computer", async () => {
  render();
  await click("Bind Registry Vault item");
  render("second");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await click("Bind Registry Vault item");
  expect(container.textContent).toContain("Vault items on second");
  await click("Choose registry key");
  expect(harness.execute).toHaveBeenCalledOnce();
  expect(harness.execute).toHaveBeenCalledWith("bindVaultSlot", {
    environmentId: "second",
    input: { botId: "publisher", slot: "registry", itemId: "key-second" },
  });
});

it("keeps the selected slot available to retry a refused Vault binding", async () => {
  harness.execute.mockRejectedValueOnce(
    new Error("This item does not grant the required Vault action."),
  );
  render();
  await click("Bind Registry Vault item");
  await click("Choose registry key");
  expect(container.textContent).toContain("This item does not grant the required Vault action.");
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(button("Choose registry key").disabled).toBe(false);
  await click("Choose registry key");
  expect(harness.execute).toHaveBeenCalledTimes(2);
});
