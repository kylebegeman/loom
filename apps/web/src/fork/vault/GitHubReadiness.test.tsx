// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { VaultGitHubInfo } from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => ({ _tag: "Initial" }) }));
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
vi.mock("~/connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("~/state/entities", () => ({ useServerConfigs: () => new Map() }));
vi.mock("~/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
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
  harness.check.mockResolvedValue(success);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function render(environmentId = "first", ownerMode = false, selected = info) {
  act(() =>
    root.render(
      <GitHubReadiness
        environmentId={EnvironmentId.make(environmentId)}
        info={selected}
        repository="owner/repo"
        disabled={false}
        ownerMode={ownerMode}
      />,
    ),
  );
}
function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
  expect(button, label).toBeDefined();
  act(() => button!.click());
}

it.each([
  ["another environment", "second", false, info],
  ["a changed owner policy", "first", true, info],
  [
    "another connection at the same version",
    "first",
    false,
    { ...info, item: { ...info.item, id: "b".repeat(32) } },
  ],
] as const)("discards a readiness report for %s", async (_, destination, ownerMode, selected) => {
  render();
  click("Check GitHub readiness");
  await act(async () => {});
  expect(container.textContent).toContain("Agent access: not checked");
  render(destination, ownerMode, selected);
  expect(container.textContent).not.toContain("Agent access: not checked");
});

it("reports an unavailable clipboard without throwing from the copy action", async () => {
  vi.stubGlobal("navigator", {});
  render();
  click("Copy terminal command");
  await act(async () => {});
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not copy the command. Select the example above.",
  );
});
