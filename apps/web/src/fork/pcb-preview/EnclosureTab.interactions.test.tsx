// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { AssemblyReadResult, PcbDesign, PcbReferenceResult } from "@t3tools/contracts/fork";
const mocks = vi.hoisted(() => ({
  terminal: false,
  run: vi.fn(),
  update: { permissionAtom: () => true },
  export: { permissionAtom: () => "terminal" },
  enclosure: { permissionAtom: () => "terminal", resultAtom: vi.fn() },
  refresh: vi.fn(),
  revert: vi.fn(),
  snapshot: null as AssemblyReadResult | null,
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (value: unknown) =>
    value === "terminal"
      ? mocks.terminal
      : typeof value === "boolean"
        ? value
        : { _tag: "Initial", waiting: false },
}));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () =>
    new Map([
      [
        "enclosure-env",
        {
          environment: {
            capabilities: { loomFeatures: ["pcb-enclosure-fit", "model-assemblies"] },
          },
        },
      ],
    ]),
}));
vi.mock("../model-preview-3d/state", () => ({
  runModelCommand: mocks.run,
  models: { models: () => null, updateAssembly: mocks.update },
}));
vi.mock("./state", () => ({ pcb: { enclosure: mocks.enclosure, exportReference: mocks.export } }));
vi.mock("../model-preview-3d/useAssembly", () => ({
  useAssembly: () => ({
    snapshot: mocks.snapshot,
    busy: false,
    refresh: mocks.refresh,
    revert: mocks.revert,
    canUndo: true,
    error: null,
  }),
}));
import { EnclosureTab } from "./EnclosureTab";
const threadRef = {
  environmentId: EnvironmentId.make("enclosure-env"),
  threadId: ThreadId.make("enclosure-thread"),
};
const design: PcbDesign = {
  id: "boards/board.kicad_pcb",
  name: "Board",
  absolutePath: "/workspace/boards/board.kicad_pcb",
  kind: "kicad",
  boardPath: "boards/board.kicad_pcb",
  toolAvailable: true,
  toolStatus: { found: true },
};
const reference: PcbReferenceResult = {
  path: "/workspace/.loom/pcb-references/board.glb",
  sourceHash: "board-revision",
  metadataPath: "/workspace/.loom/pcb-references/board.json",
  targetThreadId: threadRef.threadId,
  relativePath: ".loom/pcb-references/board.glb",
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.terminal = false;
  mocks.run.mockReset().mockResolvedValue(reference);
  mocks.refresh.mockReset();
  mocks.revert.mockReset();
  mocks.snapshot = null;
  mocks.enclosure.resultAtom.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = () =>
  root.render(
    <EnclosureTab
      threadRef={threadRef}
      design={design}
      inspection={null}
      sourceHash={null}
      executionAllowed
    />,
  );
async function chooseCase() {
  const input = host.querySelector<HTMLInputElement>("input[list]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "models/case.stl",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Use case and centre board",
  )!;
  await act(async () => button.click());
}
it("explains denied CAD permission and does not prepare or generate a case", async () => {
  await act(async () => render());
  expect(host.textContent).toContain("This connection does not permit running CAD tools");
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Generate case")?.disabled,
  ).toBe(true);
  expect(mocks.enclosure.resultAtom).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it("rejects an older server's absolute-only reference before mutating an assembly", async () => {
  mocks.terminal = true;
  const { relativePath: _relative, ...legacy } = reference;
  mocks.run.mockResolvedValue(legacy);
  await act(async () => render());
  await chooseCase();
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "workspace-relative board reference",
  );
});
it("uses a portable board reference when creating the assembly in the design directory", async () => {
  mocks.terminal = true;
  await act(async () => render());
  await chooseCase();
  expect(mocks.run).toHaveBeenCalledWith(
    mocks.update,
    expect.objectContaining({
      input: {
        file: { threadId: threadRef.threadId, path: "boards/board.loom-assembly.json" },
        createOnly: true,
        operations: [
          { op: "add-part", id: "board", name: "Board", path: reference.relativePath },
          { op: "add-part", id: "case", name: "Case", path: "models/case.stl" },
          { op: "set-enclosure", board: "board", parts: ["case"] },
          { op: "place-board", id: "board" },
        ],
      },
    }),
  );
});

it("reports a failed board undo beside the enclosure controls", async () => {
  mocks.terminal = true;
  mocks.snapshot = {
    path: "boards/board.loom-assembly.json",
    revision: "saved",
    readOnly: false,
    parts: [],
    assembly: {
      format: "loom-assembly",
      version: 1,
      units: "mm",
      name: "Case",
      parts: [],
      clearances: [],
      enclosure: null,
    },
  };
  mocks.revert.mockRejectedValue(new Error("The assembly changed. Reload and retry."));
  await act(async () => render());
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "Undo board change")!
      .click(),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("The assembly changed");
});
