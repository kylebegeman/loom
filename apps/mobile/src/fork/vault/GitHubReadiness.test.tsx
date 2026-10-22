// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { VaultGitHubInfo } from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@effect/atom-react", async () => {
  const { createContext } = await import("react");
  return { useAtomValue: () => true, RegistryContext: createContext(null) };
});
vi.mock("@t3tools/client-runtime/fork", () => ({
  createVaultGitHubAtoms: () => ({
    readiness: { resultAtom: (target: unknown) => target, permissionAtom: () => null },
  }),
  createVaultAccessAtoms: () => ({ catalog: () => null }),
  supportsLoomFeature: () => true,
  vaultGitHubReadinessReason: (reason: string) => reason,
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  executeAtomQuery: (...args: unknown[]) => harness.check(...args),
  squashAtomCommandFailure: () => new Error("Check failed"),
}));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../state/entities", () => ({
  useEnvironmentServerConfig: () => ({ environment: { capabilities: {} } }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: { subjects: [{ principal: { kind: "thread", id: "thread-1" }, label: "My thread" }] },
  }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AppTextInput: () => null,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {label}
    </button>
  ),
}));
import { GitHubReadiness } from "./GitHubReadiness";

const info: VaultGitHubInfo = {
  item: {
    id: "a".repeat(32),
    label: "GitHub",
    kind: "service-connection",
    state: "active",
    version: 1,
    createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-22T00:00:00Z",
  },
  account: "account",
  mechanism: "token",
  repositories: ["owner/repo"],
};
const success = {
  _tag: "Success",
  value: {
    account: "account",
    repository: "owner/repo",
    expectedVersion: 1,
    checkedAt: "2026-10-22T00:00:00Z",
    expiresAt: "2026-10-22T00:01:00Z",
    context: "loom-server",
    providerInstanceId: null,
    grant: "unchecked",
    checks: [],
  },
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  harness.check.mockReset();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
function render(environmentId = "first", ownerMode = false) {
  act(() =>
    root.render(
      <GitHubReadiness
        environmentId={EnvironmentId.make(environmentId)}
        info={info}
        repository="owner/repo"
        disabled={false}
        ownerMode={ownerMode}
      />,
    ),
  );
}
function button(label: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
}
function click(label: string) {
  expect(button(label), label).toBeDefined();
  act(() => button(label)!.click());
}

it("locks an open thread selector while its original context is being checked", async () => {
  let finish!: (result: unknown) => void;
  harness.check.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  click("Readiness: Loom server tools only");
  click("Check GitHub readiness");
  expect(button("Check thread My thread")?.disabled ?? true).toBe(true);
  await act(async () => finish(success));
  expect(container.textContent).toContain("Agent access: not checked");
});

it.each([
  ["another environment", "second", false],
  ["a changed owner policy", "first", true],
] as const)("discards a readiness report for %s", async (_, destination, ownerMode) => {
  harness.check.mockResolvedValue(success);
  render();
  click("Check GitHub readiness");
  await act(async () => {});
  expect(container.textContent).toContain("Agent access: not checked");
  render(destination, ownerMode);
  expect(container.textContent).not.toContain("Agent access: not checked");
});
