// @vitest-environment jsdom
import { act, type ReactNode, type InputHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
const state = vi.hoisted(() => ({
  save: vi.fn(),
  navigate: vi.fn(),
  hash: `loom-vault-github?connection=${"a".repeat(32)}&repository=owner%2Fnew`,
  info: {
    item: {
      id: "a".repeat(32),
      version: 4,
      label: "Development GitHub",
      state: "active",
      kind: "service-connection",
    },
    mechanism: "app",
    account: "bot",
    repositories: ["owner/existing"],
  },
}));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => state.hash,
  useNavigate: () => state.navigate,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: (value: unknown) => value }));
vi.mock("@t3tools/client-runtime/fork", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/fork")>()),
  supportsLoomFeature: () => true,
  createVaultGitHubAtoms: () => ({
    info: () => ({ _tag: "Success", value: state.info, waiting: false }),
    save: { permissionAtom: () => true },
  }),
  createVaultAccessAtoms: () => ({
    snapshot: () => ({
      _tag: "Success",
      value: { ownerPolicy: { mode: "owner-trusted" } },
      waiting: false,
    }),
  }),
}));
vi.mock("~/connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("~/state/entities", () => ({ useServerConfigs: () => new Map() }));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("~/components/settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({ environment: { environmentId: "selected-host" } }),
}));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("./state", () => ({ runVault: (...args: unknown[]) => state.save(...args) }));
vi.mock("./GitHubProjectAccess", () => ({ GitHubProjectAccess: () => null }));
vi.mock("./GitHubReadiness", () => ({ GitHubReadiness: () => null }));
vi.mock("~/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("~/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));
import { VaultGitHubSettingsSection } from "./GitHubSettingsSection";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.save.mockReset().mockResolvedValue(state.info);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
it("opens the requested connection with the denied repository prefilled and keeps its App credential", async () => {
  await act(async () => root.render(<VaultGitHubSettingsSection />));
  expect(
    container.querySelector<HTMLInputElement>(
      'input[placeholder="owner/repository, owner/another-repository"]',
    )?.value,
  ).toBe("owner/existing, owner/new");
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(state.save).toHaveBeenCalledOnce();
  const target = state.save.mock.calls[0]?.[1];
  expect(target).toMatchObject({
    environmentId: "selected-host",
    input: {
      id: "a".repeat(32),
      expectedVersion: 4,
      repositories: ["owner/existing", "owner/new"],
    },
  });
  expect(target.input).not.toHaveProperty("credential");
  expect(state.navigate).toHaveBeenCalledWith(
    expect.objectContaining({
      hash: "loom-vault-github",
      search: expect.objectContaining({ machine: "selected-host" }),
    }),
  );
});
