// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Cause from "effect/Cause";
import * as Redacted from "effect/Redacted";
import type { VaultItemSummary } from "@t3tools/contracts/fork";
const state = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    allowed: true,
    supported: true,
    revision: 0,
    items: [] as VaultItemSummary[],
    refresh: vi.fn(),
    save: vi.fn(),
    answer: vi.fn(),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify: () => {
      state.revision += 1;
      listeners.forEach((listener) => listener());
    },
  };
});
vi.mock("@effect/atom-react", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useAtomValue: () => {
      useSyncExternalStore(state.subscribe, () => state.revision);
      return state.allowed;
    },
  };
});
vi.mock("@t3tools/client-runtime/fork", async () => {
  const { secretSaveTarget } =
    await import("../../../../../packages/client-runtime/src/fork/vault-secret.ts");
  return {
    supportsLoomFeature: () => state.supported,
    createVaultCoreAtoms: () => ({ save: { permissionAtom: () => null }, list: () => "matches" }),
    secretSaveTarget,
    VAULT_SEARCH_DEBOUNCE_MS: 250,
  };
});
vi.mock("../../state/entities", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useEnvironmentServerConfig: () => {
      useSyncExternalStore(state.subscribe, () => state.revision);
      return { environment: { capabilities: {} } };
    },
  };
});
vi.mock("../../state/query", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useEnvironmentQuery: (atom: unknown) => {
      useSyncExternalStore(state.subscribe, () => state.revision);
      return {
        data: atom ? { items: state.items, nextCursor: null } : null,
        isPending: false,
        isSuccess: true,
        refresh: state.refresh,
      };
    },
  };
});
vi.mock("../../state/queries", () => ({ useDebouncedValue: (value: string) => value }));
vi.mock("./SavedSecretAnswer", () => ({ SavedSecretAnswer: () => null }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => crypto.randomUUID() }));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../state/server", () => ({ serverEnvironment: { answerSecretRequest: "answer" } }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => (command === "answer" ? state.answer : state.save),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Switch: ({
    value,
    disabled,
    onValueChange,
  }: {
    value: boolean;
    disabled: boolean;
    onValueChange: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.checked)}
    />
  ),
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AppTextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    editable: boolean;
  }) => (
    <input
      value={value}
      disabled={!editable}
      onChange={(event) => onChangeText(event.target.value)}
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
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
import { SecretRequestCard } from "../../features/threads/SecretRequestCard";
const environmentId = EnvironmentId.make("selected-computer");
const item = {
  type: "secret_request" as const,
  id: TurnItemId.make("secret-1"),
  threadId: ThreadId.make("thread-1"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status: "waiting" as const,
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: DateTime.makeUnsafe("2026-10-25T00:00:00Z"),
  label: "API credential",
  reason: "Use a private credential",
  secretStatus: "pending" as const,
};
const matchedItem: VaultItemSummary = {
  id: "a".repeat(32),
  label: item.label,
  kind: "account",
  state: "active",
  version: 4,
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  state.allowed = true;
  state.supported = true;
  state.items = [];
  state.revision = 0;
  state.refresh.mockReset();
  state.save.mockReset().mockResolvedValue({ _tag: "Success", value: {} });
  state.answer.mockReset().mockResolvedValue({ _tag: "Success", value: {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
  act(() =>
    root.render(
      <SecretRequestCard
        environmentId={environmentId}
        projectedItem={{
          item,
          visibility: "local",
          position: 0,
          sourceThreadId: item.threadId,
          sourceItemId: item.id,
        }}
        iconColor="black"
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
function fillSecret() {
  const input = container.querySelector<HTMLInputElement>("input:not([type=checkbox])")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "synthetic-private-value",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Save securely")!
      .click();
  });
}
it("answers normally unless the human selects a Vault copy", async () => {
  fillSecret();
  await submit();
  expect(state.save).not.toHaveBeenCalled();
  expect(state.answer).toHaveBeenCalledOnce();
});
it("saves through the selected human session before answering and never duplicates a saved copy on retry", async () => {
  fillSecret();
  act(() => container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  state.answer.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("synthetic failure")),
  });
  await submit();
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.save.mock.calls[0]?.[0]).toMatchObject({
    environmentId,
    input: { expectedVersion: 0, label: item.label, kind: "secret" },
  });
  expect(Redacted.value(state.save.mock.calls[0]?.[0].input.value)).toBe("synthetic-private-value");
  expect(state.save.mock.invocationCallOrder[0]).toBeLessThan(
    state.answer.mock.invocationCallOrder[0]!,
  );
  await submit();
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.answer).toHaveBeenCalledTimes(2);
});
it("holds the answer on a failed Vault save, redacts the error and retries the same item", async () => {
  fillSecret();
  act(() => container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  state.save.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("synthetic-private-value")),
  });
  await submit();
  expect(state.answer).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("synthetic-private-value");
  await submit();
  expect(state.save.mock.calls[0]?.[0].input.id).toBe(state.save.mock.calls[1]?.[0].input.id);
  expect(state.answer).toHaveBeenCalledOnce();
});
it.each(["permission", "capability"])(
  "allows answering without a Vault copy after losing %s",
  async (unavailable) => {
    fillSecret();
    act(() => container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    act(() => {
      state.allowed = unavailable !== "permission";
      state.supported = unavailable !== "capability";
      state.notify();
    });
    await submit();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.answer).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    await submit();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.answer).toHaveBeenCalledOnce();
  },
);

function showMatches(items: VaultItemSummary[]) {
  act(() => {
    state.items = items;
    state.notify();
  });
}
function clickButton(label: string) {
  act(() => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === label)!
      .click();
  });
}
it("replaces the matching item's current version and preserves its kind", async () => {
  showMatches([matchedItem]);
  fillSecret();
  act(() => container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  await submit();
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.save.mock.calls[0]?.[0]).toMatchObject({
    environmentId,
    input: {
      id: matchedItem.id,
      expectedVersion: matchedItem.version,
      label: matchedItem.label,
      kind: matchedItem.kind,
    },
  });
  expect(state.answer).toHaveBeenCalledOnce();
});
it("saves as a new secret when the human declines replacing the matching item", async () => {
  showMatches([matchedItem]);
  fillSecret();
  act(() => container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  clickButton("Save as new");
  await submit();
  const input = state.save.mock.calls[0]?.[0].input;
  expect(input).toMatchObject({
    expectedVersion: 0,
    label: matchedItem.label,
    kind: "secret",
    operationId: input.id,
  });
  expect(input.id).not.toBe(matchedItem.id);
  expect(state.answer).toHaveBeenCalledOnce();
});
it("holds a stale replacement until refresh clears the error and retries the current version", async () => {
  showMatches([matchedItem]);
  fillSecret();
  act(() => container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
  state.save.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("Version conflict: synthetic-private-value")),
  });
  await submit();
  expect(state.answer).not.toHaveBeenCalled();
  expect(state.save.mock.calls[0]?.[0].input).toMatchObject({
    id: matchedItem.id,
    expectedVersion: 4,
    kind: matchedItem.kind,
  });
  expect(container.textContent).toContain("It may have changed");
  expect(container.textContent).not.toContain("synthetic-private-value");
  state.refresh.mockImplementationOnce(() => {
    state.items = [{ ...matchedItem, version: 5 }];
    state.notify();
  });
  clickButton("Refresh matching item");
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain("It may have changed");
  await submit();
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.save.mock.calls[1]?.[0].input).toMatchObject({
    id: matchedItem.id,
    expectedVersion: 5,
    kind: matchedItem.kind,
    operationId: state.save.mock.calls[0]?.[0].input.operationId,
  });
  expect(state.answer).toHaveBeenCalledOnce();
});
