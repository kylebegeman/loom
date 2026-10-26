// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, ProjectId } from "@t3tools/contracts";
import type {
  PcbCheckResult,
  PcbDesign,
  PcbEditorEvent,
  PcbView,
  PcbWorkspace,
  PcbInspection,
  PcbChangeRequestOperation,
} from "@t3tools/contracts/fork";
import { DesignWorkspace } from "./PcbPreviewPanel";
import { useComposerDraftStore } from "~/composerDraftStore";
import { usePcbPreferences } from "./preferences";
const mocks = vi.hoisted(() => ({
  reports: {} as Partial<Record<"erc" | "drc", PcbCheckResult>>,
  event: null as PcbEditorEvent | null,
  run: vi.fn(),
  sourceHash: "hash",
  canEdit: true,
  operations: vi.fn(),
  attach: vi.fn(),
  inspection: null as PcbInspection | null,
}));
// The React Compiler caches atom-family calls by argument, so a mocked atom is a reader that
// useAtomValue calls on every render, the way the real hook reads the atom's current value.
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) => (typeof atom === "function" ? atom() : atom),
}));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () => new Map(),
  useThreadProjection: () => undefined,
}));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: vi.fn() } }));
vi.mock("./AutoCheckSettings", () => ({ AutoCheckSettings: () => null }));
vi.mock("./TrueScalePrintDialog", () => ({ TrueScalePrintDialog: () => null }));
vi.mock("./HardwareLibrary", () => ({ HardwareLibrary: () => null }));
vi.mock("./SimulationEditor", () => ({ SimulationEditor: () => null }));
vi.mock("./ParameterEditor", () => ({ ParameterEditor: () => null }));
vi.mock("./RevisionCompare", () => ({ RevisionCompare: () => null }));
vi.mock("../model-preview-3d/state", () => ({ runModelCommand: mocks.run }));
vi.mock("./state", () => ({
  pcb: {
    historyRestore: { permissionAtom: () => false },
    print: { permissionAtom: () => false },
    asset: { permissionAtom: () => false },
    inspect: { permissionAtom: () => false },
    compare: { permissionAtom: () => false },
    editorEvents: () => () => mocks.event,
    completeEditorAction: {},
  },
}));
vi.mock("./usePcbWorkbench", async () => {
  const { useState, useRef } = await import("react");
  return {
    usePcbWorkbench: function useWorkbench() {
      const [data, setData] = useState<PcbWorkspace>({
        version: 0,
        views: [],
        layerSets: [],
        measurements: [],
        annotations: [],
        simulations: [],
        variants: [],
        requests: [],
      });
      const current = useRef(data);
      return {
        inspection: mocks.inspection,
        canEdit: mocks.canEdit,
        canRequest: mocks.canEdit,
        ready: true,
        pending: 0,
        error: null,
        inspectionError: null,
        data,
        mutate: vi.fn(),
        changeRequest: async (op: PcbChangeRequestOperation) => {
          mocks.operations(op);
          const data = current.current;
          let next = data;
          if (op.op === "create")
            next = {
              ...data,
              version: data.version + 1,
              requests: [
                ...data.requests,
                {
                  ...op.request,
                  createdAt: "now",
                  status: "open",
                  baseRef: null,
                  sentAt: null,
                  response: null,
                  reviewRevision: null,
                  resolvedRevision: null,
                  resolvedRef: null,
                  resolvedAt: null,
                },
              ],
            };
          if (op.op === "sent")
            next = {
              ...data,
              version: data.version + 1,
              requests: data.requests.map((r) =>
                op.ids.includes(r.id) ? { ...r, sentAt: "now" } : r,
              ),
            };
          current.current = next;
          setData(next);
          return next;
        },
      };
    },
  };
});
vi.mock("../model-preview-3d/capture", () => ({
  attachModelImage: mocks.attach,
  captureBase64: async () => "image",
}));
vi.mock("../model-preview-3d/viewer/captureSheet", () => ({
  thumbnail: async () => "data:image/jpeg;base64,AAAA",
}));
vi.mock("./usePcbPreview", async () => {
  const { useState } = await import("react");
  return {
    asyncValue: (value: unknown) => value,
    asyncError: () => null,
    usePcbPreview: function usePreview(_thread: unknown, _design: unknown, view: PcbView) {
      const [sheet, setSheet] = useState("board.svg");
      const sheets = [
        { id: "board.svg", label: "Root", bytes: 100, tooLarge: false },
        { id: "board-sub.svg", label: "Sub", bytes: 100, tooLarge: false },
      ];
      const id = view === "pcb" ? "pcb.svg" : sheet;
      const result = {
        sourceHash: mocks.sourceHash,
        sheets: view === "pcb" ? [{ id, label: "Board", bytes: 100, tooLarge: false }] : sheets,
      };
      return {
        sourceHash: mocks.sourceHash,
        checks: mocks.reports,
        good: { view, result },
        display: {
          view,
          sheetId: id,
          sourceHash: mocks.sourceHash,
          result,
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"/>',
          label: id,
        },
        selectedSheet: id,
        selectSheet: setSheet,
        sheet: { id, tooLarge: false },
        canRender: true,
        canCheck: false,
        rendering: false,
        loadingSheet: false,
        watching: false,
        checksLoading: false,
        checking: null,
        checkRevision: 0,
        render: null,
        refresh: vi.fn(),
        cancelCheck: vi.fn(),
        cancelRender: vi.fn(),
        runCheck: vi.fn(),
      };
    },
  };
});
const threadRef = {
  environmentId: EnvironmentId.make("markers-env"),
  threadId: ThreadId.make("markers-thread"),
};
const design: PcbDesign = {
  id: "board.kicad_pro",
  name: "Board",
  absolutePath: "/workspace/board.kicad_pro",
  kind: "kicad",
  schematicPath: "board.kicad_sch",
  boardPath: "board.kicad_pcb",
  toolAvailable: true,
  toolStatus: { found: true, version: "10.0.6" },
};
const violation = (id: string, sheetId: string, x: number, excluded = false) => ({
  id,
  type: "clearance",
  description: id,
  severity: "error" as const,
  excluded,
  group: "violation" as const,
  sheetId,
  items: [
    { description: "first", x, y: 2 },
    { description: "second", x: x + 3, y: 4 },
  ],
});
const report = (kind: "erc" | "drc", violations: PcbCheckResult["violations"]): PcbCheckResult => ({
  kind,
  violations,
  pointsInMm: true,
  coordinateUnits: "mm",
  outcome: "violations",
  sourceHash: "hash",
  counts: { errors: 2, warnings: 0, excluded: 1 },
  ranAt: "2026-10-11T00:00:00Z",
  log: "",
  truncated: false,
});
let root: Root, host: HTMLDivElement;
let frames: FrameRequestCallback[];
const previous = usePcbPreferences.getState();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        queueMicrotask(() =>
          this.callback(
            [{ target, contentRect: { width: 1048, height: 548 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          ),
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:markers"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  frames = [];
  mocks.event = null;
  mocks.canEdit = true;
  mocks.operations.mockReset();
  mocks.attach.mockReset().mockResolvedValue(undefined);
  mocks.inspection = {
    sourceHash: "hash",
    components: [
      {
        id: "r1",
        reference: "R1",
        value: "10k",
        footprint: "",
        schematic: { x: 10, y: 10, sheet: "board.svg" },
        pcb: { x: 20, y: 20 },
        pins: [
          {
            number: "1",
            name: "",
            net: "N",
            schematic: { x: 11, y: 10, sheet: "board.svg" },
            pcb: { x: 21, y: 20 },
          },
        ],
      },
    ],
    nets: [{ name: "N", members: [{ reference: "R1", pin: "1" }] }],
    layers: [],
    bounds: null,
    thickness: 1.6,
    mountingHoles: [],
    warnings: [],
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
    scale: vi.fn(),
    translate: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
    cb(new Blob(["image"], { type: "image/png" })),
  );
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: async () => {},
  });

  mocks.run.mockReset().mockResolvedValue({});
  mocks.sourceHash = "hash";
  mocks.reports = {
    erc: report("erc", [
      violation("erc-root", "board.svg", 2),
      violation("erc-sub", "board-sub.svg", 8),
      violation("erc-excluded", "board.svg", 5, true),
    ]),
    drc: report("drc", [violation("drc-board", "", 20)]),
  };
  usePcbPreferences.setState({ ...previous, selections: {}, checkMarkers: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  useComposerDraftStore.getState().setPrompt(threadRef, "");
  host.remove();
  usePcbPreferences.setState(previous);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = () => (
  <DesignWorkspace
    threadRef={threadRef}
    design={design}
    listing={{
      designs: [design],
      projectId: ProjectId.make("markers-project"),
      workspaceKey: "workspace",
      truncated: false,
    }}
    listingBusy={false}
    listingError={null}
    preferenceKey="markers"
    onSelect={vi.fn()}
    onDiscover={vi.fn()}
    onClose={vi.fn()}
  />
);
async function ready() {
  const image = host.querySelector("img")!;
  Object.defineProperties(image, {
    complete: { value: true, configurable: true },
    naturalWidth: { value: 1000, configurable: true },
    naturalHeight: { value: 500, configurable: true },
  });
  await act(async () => image.dispatchEvent(new Event("load")));
  await act(async () => {
    const pending = frames.splice(0);
    pending.forEach((callback) => callback(0));
  });
}
async function key(key: string) {
  await act(async () =>
    host
      .querySelector<HTMLElement>('[role="region"][aria-label^="PCB workspace,"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  );
}
async function command(action: PcbEditorEvent["command"]) {
  mocks.event = {
    requestId: `request-${mocks.run.mock.calls.length}`,
    designId: design.id,
    command: action,
  };
  await act(async () => root.render(render()));
}

async function input(label: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
it("creates a component request from R and adds marked capture and text before marking sent", async () => {
  await act(async () => root.render(render()));
  await ready();
  await command({ action: "select", reference: "R1" });
  await key("r");
  expect(host.querySelector('[aria-label="Request title"]')).not.toBeNull();
  await input("Request title", "Move resistor");
  await input("Change requested", "Move R1 left");
  await click("Add to draft");
  await act(async () => {});
  const create = mocks.operations.mock.calls.find(([op]) => op.op === "create")?.[0];
  expect(create).toMatchObject({
    sent: false,
    request: {
      title: "Move resistor",
      anchor: { kind: "component", reference: "R1" },
      referenceImage: "data:image/jpeg;base64,AAAA",
    },
  });
  expect(mocks.attach).toHaveBeenCalledTimes(1);
  expect(mocks.operations.mock.calls.at(-1)?.[0].op).toBe("sent");
  expect(useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt).toContain(
    "Move R1 left",
  );
});
it("a full draft leaves the saved request unsent and exposes the capture error", async () => {
  mocks.attach.mockRejectedValue(new Error("The draft has no room for another attachment."));
  await act(async () => root.render(render()));
  await ready();
  await command({ action: "select", reference: "R1" });
  await key("r");
  await input("Request title", "Move resistor");
  await input("Change requested", "Move R1 left");
  await click("Add to draft");
  await act(async () => {});
  expect(mocks.operations.mock.calls.some(([op]) => op.op === "create")).toBe(true);
  expect(mocks.operations.mock.calls.some(([op]) => op.op === "sent")).toBe(false);
  expect(host.textContent).toContain("The draft has no room");
});
it("disables request creation without workspace permission", async () => {
  mocks.canEdit = false;
  await act(async () => root.render(render()));
  await ready();
  await key("r");
  expect(host.querySelector('[aria-label="Request title"]')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Request"]')?.disabled).toBe(true);
});

it("saves component and net asks then adds one numbered capture for their shared sheet", async () => {
  await act(async () => root.render(render()));
  await ready();
  await command({ action: "select", reference: "R1" });
  await key("r");
  await input("Request title", "First");
  await input("Change requested", "Move R1 left");
  await click("Save without adding");
  await command({ action: "net", net: "N" });
  await key("r");
  await input("Request title", "Second");
  await input("Change requested", "Reroute N");
  await click("Save without adding");
  expect(
    mocks.operations.mock.calls
      .filter(([op]) => op.op === "create")
      .map(([op]) => op.request.anchor.kind),
  ).toEqual(["component", "net"]);
  const checks = [
    ...host.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"][aria-label^="Select request"]',
    ),
  ];
  expect(checks).toHaveLength(2);
  for (const checkbox of checks) await act(async () => checkbox.click());
  await click("Add 2 to draft");
  await act(async () => {});
  expect(mocks.attach).toHaveBeenCalledTimes(1);
  expect(mocks.operations.mock.calls.at(-1)?.[0].ids).toHaveLength(2);
  const prompt = useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt;
  expect(prompt).toContain("1. First");
  expect(prompt).toContain("2. Second");
});
