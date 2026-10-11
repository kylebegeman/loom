import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, it, expect, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { AssemblyReadResult } from "@t3tools/contracts/fork";
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  assembly: {},
  update: { permissionAtom: () => "edit" },
  render: { permissionAtom: () => "terminal" },
  check: { permissionAtom: () => "terminal" },
  cancel: {},
  parameters: {},
  terminal: true,
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (permission: string) => (permission === "terminal" ? mocks.terminal : true),
}));
vi.mock("./state", () => ({
  models: {
    assembly: mocks.assembly,
    updateAssembly: mocks.update,
    renderModel: mocks.render,
    checkAssembly: mocks.check,
    cancelAssemblyCheck: mocks.cancel,
    parameters: mocks.parameters,
  },
  runModelCommand: mocks.run,
}));
import { useAssembly, assemblyRestoreOperations, assemblySourceRevision } from "./useAssembly";
const ref = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };
const snapshot = (revision: string, name = revision): AssemblyReadResult => ({
  path: "case.loom-assembly.json",
  revision,
  readOnly: false,
  parts: [],
  assembly: { format: "loom-assembly", version: 1, units: "mm", name, parts: [], clearances: [] },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
let renderer: ReactTestRenderer | undefined, state: ReturnType<typeof useAssembly>;
function Harness() {
  const current = useAssembly(ref, "case.loom-assembly.json", true);
  useLayoutEffect(() => {
    state = current;
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.run.mockReset();
  mocks.terminal = true;
  mocks.run.mockResolvedValue(snapshot("initial"));
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
const mount = async () => {
  await act(async () => {
    renderer = create(<Harness />);
  });
};
it("sends CAS saves and refuses a late pre-save read to replace the committed document", async () => {
  await mount();
  const save = deferred<AssemblyReadResult>(),
    read = deferred<AssemblyReadResult>();
  mocks.run.mockImplementation((command) =>
    command === mocks.update ? save.promise : read.promise,
  );
  let saving!: Promise<void>, reading!: Promise<void>;
  await act(async () => {
    saving = state.apply([{ op: "set-name", name: "Saved" }]);
    reading = state.refresh();
  });
  expect(mocks.run).toHaveBeenCalledWith(
    mocks.update,
    expect.objectContaining({ input: expect.objectContaining({ expectedRevision: "initial" }) }),
  );
  await act(async () => {
    save.resolve(snapshot("saved", "Saved"));
    await saving;
  });
  await act(async () => {
    read.resolve(snapshot("initial"));
    await reading;
  });
  expect(state.snapshot?.revision).toBe("saved");
  expect(state.canUndo).toBe(true);
});
it("clears local undo after an external save so Undo cannot erase another editor's change", async () => {
  await mount();
  mocks.run.mockResolvedValue(snapshot("saved"));
  await act(async () => state.apply([{ op: "set-name", name: "Saved" }]));
  expect(state.canUndo).toBe(true);
  mocks.run.mockResolvedValue(snapshot("external"));
  await act(async () => state.refresh());
  expect(state.canUndo).toBe(false);
  expect(state.snapshot?.revision).toBe("external");
});
it("builds portable restore operations and guards Python checks before sending a command", async () => {
  const source = {
    ...snapshot("python"),
    assembly: {
      ...snapshot("python").assembly,
      parts: [
        {
          id: "body",
          name: "Body",
          path: "body.py",
          position: [0, 0, 0] as const,
          rotation: [0, 0, 0] as const,
          color: null,
          visible: true,
          parameters: {},
          parameterSet: null,
          explode: null,
        },
      ],
    },
  };
  const operations = assemblyRestoreOperations(
    snapshot("empty").assembly,
    source.assembly,
    "models/case.loom-assembly.json",
  );
  expect(operations[0]).toMatchObject({ op: "add-part", path: "models/body.py" });
  mocks.terminal = false;
  mocks.run.mockResolvedValue(source);
  await mount();
  const count = mocks.run.mock.calls.length;
  await act(async () => state.check());
  expect(mocks.run).toHaveBeenCalledTimes(count);
  expect(state.error).toContain("does not permit");
});

it("assembly markup revisions invalidate after dependencies or loaded geometry change", () => {
  const source = {
    ...snapshot("a1"),
    parts: [
      {
        id: "body",
        path: "body.stl",
        format: "stl" as const,
        sizeBytes: 100,
        revision: "s1",
        error: null,
      },
    ],
  };
  const first = assemblySourceRevision(source, {}, { body: "g1" });
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(assemblySourceRevision(source, {}, { body: "g1" })).toBe(first);
  expect(assemblySourceRevision(source, { "body.stl": 1 }, { body: "g1" })).not.toBe(first);
  expect(assemblySourceRevision(source, {}, { body: "g2" })).not.toBe(first);
  expect(assemblySourceRevision({ ...source, revision: "a2" }, {}, { body: "g1" })).not.toBe(first);
});
it("restoring a replaced part also restores its unchanged clearances", () => {
  const part = {
    id: "body",
    name: "Body",
    path: "body.stl",
    position: [0, 0, 0] as const,
    rotation: [0, 0, 0] as const,
    color: null,
    visible: true,
    parameters: {},
    parameterSet: null,
    explode: null,
  };
  const other = { ...part, id: "lid", path: "lid.stl" };
  const clearance = { id: "gap", a: "body", b: "lid", requiredMm: 0.3, label: null };
  const current = { ...snapshot("r1").assembly, parts: [part, other], clearances: [clearance] };
  const target = { ...current, parts: [{ ...part, path: "old-body.stl" }, other] };
  expect(assemblyRestoreOperations(current, target, "case.loom-assembly.json")).toContainEqual({
    op: "set-clearance",
    ...clearance,
  });
});
