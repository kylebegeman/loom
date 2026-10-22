// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import {
  defaultProjectProfile,
  type EnvReport,
  type VarlockValidation,
} from "@t3tools/contracts/fork";
const state = vi.hoisted(() => ({
  supported: true,
  permitted: true,
  report: null as EnvReport | null,
  error: null as string | null,
  validate: vi.fn(),
  run: vi.fn(),
  refresh: vi.fn(),
  edit: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.permitted }));
vi.mock("./state", () => ({
  profiles: {
    envReport: () => "report",
    profile: () => "profile",
    budgetStatus: () => "budget",
    validate: { permissionAtom: () => "validate" },
    command: { permissionAtom: () => "command" },
  },
  useProfilesSupported: () => state.supported,
  requestProfileAction: state.edit,
  runProfileCommand: state.validate,
  profileError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
}));
vi.mock("~/state/entities", () => ({
  useQuietThreadShell: () => ({
    projectId: ProjectId.make("project"),
    providerInstanceId: ProviderInstanceId.make("cursor"),
    latestRun: null,
  }),
  useProject: () => null,
  useServerConfigs: () =>
    new Map([[EnvironmentId.make("host"), { environment: { label: "Remote workstation" } }]]),
}));
vi.mock("~/state/environments", () => ({ useEnvironmentProviders: () => new Map() }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (kind: string) => ({
    data:
      kind === "report"
        ? state.report
        : kind === "profile"
          ? {
              ...defaultProjectProfile(ProjectId.make("project")),
              commands: { test: { _tag: "command", command: "vp test" } },
            }
          : null,
    error: kind === "report" ? state.error : null,
    isPending: false,
    refresh: state.refresh,
  }),
}));
vi.mock("./runInTerminal", () => ({ useRunProfileCommand: () => state.run }));
import EnvPanel, { filterEnvItems, varlockConfirmed } from "./EnvPanel";
const threadRef = { environmentId: EnvironmentId.make("host"), threadId: ThreadId.make("thread") };
const report = (): EnvReport => ({
  root: "/checkout",
  schema: { _tag: "ok", path: ".env.schema", currentEnv: null, imports: [] },
  envFiles: [".env.local"],
  unschematizedKeys: ["EXTRA"],
  varlock: { _tag: "available", version: "1.20.0" },
  items: [
    {
      key: "API_URL",
      description: "Service address",
      type: "url",
      required: true,
      sensitive: false,
      example: null,
      docs: [],
      tags: ["api"],
      line: 3,
      status: { _tag: "set", source: ".env.local" },
    },
    {
      key: "TOKEN",
      description: null,
      type: "string",
      required: true,
      sensitive: true,
      example: null,
      docs: [],
      tags: [],
      line: 5,
      status: { _tag: "resolvedByVarlock", functionName: "exec" },
    },
  ],
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  state.supported = true;
  state.permitted = true;
  state.error = null;
  state.report = report();
  state.validate.mockReset();
  state.run.mockReset();
  state.refresh.mockReset();
  state.edit.mockReset();
  state.validate.mockResolvedValue({
    ok: false,
    rootErrors: [],
    itemErrors: { API_URL: "expected a URL" },
    durationMs: 12,
  });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = () =>
  act(() =>
    root.render(
      <EnvPanel
        threadRef={threadRef}
        visible
        surface={{ id: "fork:project-profiles:env", kind: "fork", panelId: "project-profiles:env" }}
      />,
    ),
  );
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((element) => element.textContent === label)!;
it("runs nothing on cancel, then remembers explicit validation and replaces statuses", async () => {
  render();
  act(() => button("Validate with varlock").click());
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("secret managers");
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "Remote workstation",
  );
  expect(state.validate).not.toHaveBeenCalled();
  await act(async () => button("Cancel").click());
  expect(varlockConfirmed(threadRef.environmentId)).toBe(false);
  act(() => button("Validate with varlock").click());
  await act(async () => button("Validate").click());
  expect(state.validate).toHaveBeenCalledWith(expect.anything(), {
    environmentId: threadRef.environmentId,
    input: { projectId: ProjectId.make("project"), threadId: threadRef.threadId },
  });
  expect(varlockConfirmed(threadRef.environmentId)).toBe(true);
  expect(container.textContent).toContain("Invalid: expected a URL");
  expect(container.textContent).toContain("Validated by varlock");
  await act(async () => button("Refresh").click());
  expect(container.textContent).toContain("Set in .env.local");
  expect(container.textContent).not.toContain("Validated by varlock");
});
it("honors permission loss while confirmation is open", async () => {
  render();
  act(() => button("Validate with varlock").click());
  state.permitted = false;
  render();
  expect(button("Validate").disabled).toBe(true);
  expect(button("Run test with varlock").disabled).toBe(true);
  await act(async () => button("Validate").click());
  expect(state.validate).not.toHaveBeenCalled();
  expect(state.run).not.toHaveBeenCalled();
});
it("runs the selected intent and surfaces a load error with retry", async () => {
  render();
  await act(async () => button("Run test with varlock").click());
  expect(state.run).toHaveBeenCalledWith({ intent: "test" });
  expect(container.textContent).toContain("test started in the terminal.");
  state.report = null;
  state.error = "Connection lost.";
  render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Connection lost.");
  const before = state.refresh.mock.calls.length;
  act(() => button("Try again").click());
  expect(state.refresh.mock.calls.length).toBeGreaterThan(before);
});
it("filters by validated errors without mutating the static report", () => {
  const data = report();
  const validation: VarlockValidation = {
    ok: false,
    rootErrors: [],
    itemErrors: { API_URL: "invalid" },
    durationMs: 1,
  };
  expect(
    filterEnvItems(data.items, "api", "attention", validation).map((item) => item.key),
  ).toEqual(["API_URL"]);
  expect(filterEnvItems(data.items, "", "set", validation).map((item) => item.key)).toEqual([
    "TOKEN",
  ]);
  expect(filterEnvItems(data.items, "", "attention")).toEqual([]);
  expect(data.items[0]?.status._tag).toBe("set");
});
