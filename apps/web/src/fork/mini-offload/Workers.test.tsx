import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

const state = vi.hoisted(() => ({ run: vi.fn(), refresh: vi.fn() }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) => (atom === "workers" ? AsyncResult.success([]) : true),
}));
vi.mock("@t3tools/client-runtime/fork", () => ({
  loomFeaturesOf: () => ["mini-worker-readiness"],
  MINI_WORKER_EDIT_FEATURE: "edit",
}));
vi.mock("~/state/entities", () => ({ useServerConfigs: () => new Map() }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: state.refresh } }));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/input", () => ({ Input: "input" }));
vi.mock("../apple-build-tooling/parts", () => ({
  valueOf: (result: { value: unknown }) => result.value,
  failureOf: () => null,
  useAction: () => ({
    busy: false,
    error: null,
    act: async (task: () => Promise<unknown>) => {
      try {
        await task();
        return true;
      } catch {
        return false;
      }
    },
  }),
}));
vi.mock("./state", () => ({
  mini: {
    workers: () => "workers",
    ...Object.fromEntries(
      ["register", "setEnabled", "updateWorker", "removeWorker", "check", "prepare"].map((name) => [
        name,
        { name, permissionAtom: () => "permission" },
      ]),
    ),
  },
  runMini: state.run,
}));

import { MiniWorkers } from "./Workers";
let renderer: ReactTestRenderer;
const button = (text: string) =>
  renderer.root.findAllByType("button").find((node) => node.props.children === text)!;
async function edit(label: string, value: string) {
  await act(async () => {
    renderer.root.findByProps({ "aria-label": label }).props.onChange({ target: { value } });
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  state.run.mockImplementation(async (command: { name: string }) => {
    if (command.name === "check") throw new Error("SSH unavailable");
  });
  await act(async () => {
    renderer = create(<MiniWorkers environmentId={EnvironmentId.make("workers-env")} />);
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

it("closes a successfully registered worker form even when its readiness check fails", async () => {
  await act(async () => button("Add command worker").props.onClick());
  await edit("Name", "  Build Mini  ");
  await edit("SSH host alias", "  build-mini  ");
  await act(async () => {
    renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
  expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ name: "register" }), {
    environmentId: "workers-env",
    input: expect.objectContaining({ name: "Build Mini", target: "build-mini" }),
  });
  expect(state.run).toHaveBeenCalledWith(
    expect.objectContaining({ name: "check" }),
    expect.anything(),
  );
  expect(renderer.root.findAllByType("form")).toHaveLength(0);
  await act(async () => button("Add command worker").props.onClick());
  expect(renderer.root.findByProps({ "aria-label": "Name" }).props.value).toBe("");
});
