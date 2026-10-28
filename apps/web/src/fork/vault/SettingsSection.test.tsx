// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

// Query results reach the section through a store subscription, as in the app. The React
// Compiler memoizes the item list, so re-rendering the root would not re-read the query.
const state = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listError: false,
    features: ["vault-core"],
    list: vi.fn(() => "items"),
    run: vi.fn(),
    refresh: vi.fn(),
    change: { permissionAtom: () => "change-permission" },
    item: {
      id: "a".repeat(32),
      label: "Development credential",
      kind: "secret",
      state: "active",
      version: 3,
      createdAt: "2026-10-20T00:00:00Z",
      updatedAt: "2026-10-20T00:00:00Z",
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify: () => listeners.forEach((listener) => listener()),
  };
});
vi.mock("@effect/atom-react", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useAtomValue: (atom: string) => {
      const listError = useSyncExternalStore(state.subscribe, () => state.listError);
      return atom === "add-target"
        ? null
        : atom === "status"
          ? AsyncResult.success({ state: "ready" })
          : atom === "items"
            ? listError
              ? AsyncResult.fail(new Error("Backend unavailable"))
              : AsyncResult.success({ items: [state.item], nextCursor: null })
            : true;
    },
  };
});
vi.mock("@t3tools/client-runtime/fork", () => ({
  loomFeaturesOf: () => state.features,
  vaultStatusMessage: () => "Vault is connected.",
  VAULT_KIND_LABELS: { secret: "Secret" },
  VAULT_FILE_LIMIT_BYTES: 512 * 1024,
  vaultItemActions: () => ({ manager: null, revealValue: true, replaceValue: true }),
  VAULT_GENERIC_ITEM_KINDS: ["secret"],
  VAULT_REVEAL_DURATION_MS: 60_000,
  VAULT_SEARCH_DEBOUNCE_MS: 250,
  vaultItemChanges: () => "item-changes",
}));
vi.mock("~/components/settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({ environment: { environmentId: "development-computer" } }),
}));
vi.mock("~/state/entities", () => ({ useServerConfigs: () => new Map() }));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("~/rpc/atomRegistry", () => ({
  appAtomRegistry: { refresh: state.refresh, get: () => 0, set: vi.fn() },
}));
vi.mock("./add-navigation", () => ({ vaultAddTarget: "add-target" }));
vi.mock("./OwnerSettingsSection", () => ({ VaultOwnerSettings: () => null }));
vi.mock("./SshDialog", () => ({ VaultSshDialog: () => null }));
vi.mock("./access-navigation", () => ({ openVaultAccess: vi.fn() }));
vi.mock("./state", () => ({
  vault: {
    status: () => "status",
    list: state.list,
    archivedPage: () => "archived-items",
    save: { permissionAtom: () => "save-permission" },
    reveal: { permissionAtom: () => "reveal-permission" },
    change: state.change,
  },
  runVault: state.run,
}));
vi.mock("~/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  DialogPopup: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}));

import { VaultSettingsSection } from "./SettingsSection";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.listError = false;
  state.features = ["vault-core"];
  vi.resetAllMocks();
  state.list.mockReturnValue("items");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const button = (name: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll("button")].find((element) => element.textContent === name)!;

it("recovers a failed record query without leaving a loading message", () => {
  state.listError = true;
  act(() => root.render(<VaultSettingsSection />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Backend unavailable");
  expect(container.textContent).not.toContain("Loading Vault items");
  act(() => button("Retry").click());
  expect(state.refresh).toHaveBeenCalledWith("items");
  act(() => {
    state.listError = false;
    state.notify();
  });
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain(state.item.label);
});

it("requires deletion confirmation and keeps a failed mutation visible inside the open dialog", async () => {
  state.run.mockRejectedValueOnce(new Error("This item changed. Refresh it before deleting."));
  act(() => root.render(<VaultSettingsSection />));
  act(() =>
    [...container.querySelectorAll<HTMLElement>("summary, button")]
      .find((element) => element.textContent === "Item details and maintenance")!
      .click(),
  );
  act(() => button("Delete").click());
  const dialog = container.querySelector('[role="dialog"]')!;
  expect(state.run).not.toHaveBeenCalled();
  await act(async () => button("Delete item", dialog).click());
  expect(state.run).toHaveBeenCalledWith(state.change, {
    environmentId: "development-computer",
    input: {
      id: state.item.id,
      expectedVersion: 3,
      action: "delete",
      operationId: expect.stringMatching(/^[a-f0-9]{32}$/),
    },
  });
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("This item changed.");
  expect(button("Delete item", dialog).disabled).toBe(false);
  act(() => button("Cancel", dialog).click());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(state.run).toHaveBeenCalledOnce();
});

it("shows the searchable list by default, debounces its query and copies a value-free reference", async () => {
  vi.useFakeTimers();
  state.features = ["vault-core", "vault-owner-trusted", "vault-item-search"];
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  act(() => root.render(<VaultSettingsSection />));
  expect(container.textContent).toContain(state.item.label);
  expect(container.textContent).not.toContain("Vault records and advanced controls");
  expect(state.list).toHaveBeenLastCalledWith({
    environmentId: "development-computer",
    input: { cursor: null, includeArchived: false, query: "", sort: "label" },
  });
  const search = container.querySelector<HTMLInputElement>("#loom-vault-item-search")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      search,
      "credential",
    );
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTimeAsync(249));
  expect(state.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ input: expect.objectContaining({ query: "" }) }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(state.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ input: expect.objectContaining({ query: "credential" }) }),
  );
  await act(async () => button("Copy reference").click());
  expect(writeText).toHaveBeenCalledWith(`loom-vault:development-computer:${state.item.id}`);
  expect(writeText.mock.calls[0]?.[0]).not.toContain("synthetic-account-secret");
});
