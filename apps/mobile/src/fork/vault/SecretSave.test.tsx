// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Cause from "effect/Cause";
import * as Redacted from "effect/Redacted";
const state = vi.hoisted(() => ({
  allowed: true,
  supported: true,
  save: vi.fn(),
  answer: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.allowed }));
vi.mock("@t3tools/client-runtime/fork", () => ({
  supportsLoomFeature: () => state.supported,
  createVaultCoreAtoms: () => ({ save: { permissionAtom: () => null } }),
}));
vi.mock("../../state/entities", () => ({
  useEnvironmentServerConfig: () => ({ environment: { capabilities: {} } }),
}));
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
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  state.allowed = true;
  state.supported = true;
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
    state.allowed = unavailable !== "permission";
    state.supported = unavailable !== "capability";
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
    await submit();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.answer).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    await submit();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.answer).toHaveBeenCalledOnce();
  },
);
