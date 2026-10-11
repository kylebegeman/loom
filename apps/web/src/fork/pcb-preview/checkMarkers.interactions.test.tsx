// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, ProjectId } from "@t3tools/contracts";
import type { PcbCheckResult, PcbDesign, PcbEditorEvent, PcbView } from "@t3tools/contracts/fork";
import { DesignWorkspace } from "./PcbPreviewPanel";
import { usePcbPreferences } from "./preferences";
const mocks = vi.hoisted(() => ({
  reports: {} as Partial<Record<"erc" | "drc", PcbCheckResult>>,
  event: null as PcbEditorEvent | null,
  run: vi.fn(),
  sourceHash: "hash",
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: (value: unknown) => value }));
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
    editorEvents: () => mocks.event,
    completeEditorAction: {},
  },
}));
vi.mock("./usePcbWorkbench", () => ({
  usePcbWorkbench: () => ({
    inspection: null,
    canEdit: false,
    ready: true,
    pending: 0,
    error: null,
    inspectionError: null,
    data: {
      version: 0,
      views: [],
      layerSets: [],
      measurements: [],
      annotations: [],
      simulations: [],
      variants: [],
      requests: [],
    },
    mutate: vi.fn(),
  }),
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
it("steps across sheets, wraps, re-enables hidden markers and clears the active detail before closing Checks", async () => {
  await act(async () => root.render(render()));
  await ready();
  expect(host.querySelectorAll("svg[data-overlays] circle")).toHaveLength(1);
  await key("c");
  expect(host.querySelectorAll("svg[data-overlays] circle")).toHaveLength(0);
  await key(".");
  expect(usePcbPreferences.getState().checkMarkers).toBe(true);
  expect(host.textContent).toContain("Finding 1 of 2");
  expect(host.querySelectorAll("svg[data-overlays] circle")).toHaveLength(3);
  await key(".");
  await ready();
  expect(host.querySelector("[data-pcb-drawing]")?.getAttribute("aria-label")).toContain("Sub");
  expect(host.textContent).toContain("Finding 2 of 2");
  await key(".");
  await ready();
  expect(host.textContent).toContain("Back to the first finding");
  await key(",");
  await ready();
  expect(host.textContent).toContain("Back to the last finding");
  await key("Escape");
  expect(host.querySelector("[data-active]")).toBeNull();
  expect(host.querySelector('[aria-label="Show on drawing"]')).not.toBeNull();
  await key("Escape");
  expect(host.querySelector('[aria-label="Show on drawing"]')).toBeNull();
});
it("shares excluded visibility, keeps pins stale against the drawing and preserves constant screen size on zoom", async () => {
  await act(async () => root.render(render()));
  await ready();
  await key(".");
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Show excluded"]')!.click(),
  );
  expect(host.querySelectorAll("svg[data-overlays] circle")).toHaveLength(4);
  expect(host.querySelector('svg[data-overlays] circle[cx="5"]')?.getAttribute("fill")).toBe(
    "none",
  );
  const pin = () => host.querySelector('svg[data-overlays] circle[cx="2"]')!;
  const radius = Number(pin().getAttribute("r"));
  const canvas = host.querySelector<HTMLElement>("[data-pcb-drawing]")!;
  await act(async () =>
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true }),
    ),
  );
  await act(async () => {
    frames.splice(0).forEach((callback) => callback(0));
  });
  expect(Number(pin().getAttribute("r"))).toBeCloseTo(radius / 1.25, 2);
  mocks.sourceHash = "newer";
  await act(async () => root.render(render()));
  expect(pin().parentElement?.getAttribute("opacity")).toBe("0.45");
  expect(host.textContent).toContain("Stale");
});
it("agent commands select findings across surfaces and return bounded marker snapshots", async () => {
  await act(async () => root.render(render()));
  await ready();
  await command({ action: "finding", name: "next" });
  await command({ action: "snapshot" });
  expect(mocks.run.mock.lastCall?.[1].input.state.findings).toMatchObject({
    visible: true,
    active: "erc-root",
    total: 2,
    items: [{ id: "erc-root" }, { id: "erc-sub" }],
  });
  expect(mocks.run.mock.lastCall?.[1].input.state.findings.items[0]).not.toHaveProperty(
    "otherPoints",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      text: async () =>
        '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"/>',
    })),
  );
  await command({ action: "capture", format: "svg", full: true });
  const captured = new DOMParser().parseFromString(
    mocks.run.mock.lastCall?.[1].input.svg,
    "image/svg+xml",
  );
  expect(captured.querySelector("parsererror")).toBeNull();
  expect(captured.querySelectorAll("#overlay circle")).toHaveLength(3);
  expect(captured.documentElement.getAttribute("width")).toBe("100mm");
  await command({ action: "finding", name: "drc-board" });
  await ready();
  await command({ action: "markers", enabled: false });
  await command({ action: "snapshot" });
  expect(mocks.run.mock.lastCall?.[1].input.state).toMatchObject({
    view: "pcb",
    findings: { visible: false, active: "drc-board", total: 1 },
  });
  await command({ action: "finding", name: "gone" });
  expect(mocks.run.mock.lastCall?.[1].input).toMatchObject({
    error: true,
    message: expect.stringContaining("No finding with that id"),
  });
});

it("picks a pin before components in Select mode and clears it on empty drawing", async () => {
  await act(async () => root.render(render()));
  await ready();
  const canvas = host.querySelector<HTMLElement>("[data-pcb-drawing]")!;
  canvas.setPointerCapture = vi.fn();
  const click = async (x: number, y: number) =>
    act(async () => {
      for (const type of ["pointerdown", "pointerup"])
        canvas.dispatchEvent(
          new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true }),
        );
    });
  await click(44, 44);
  expect(host.textContent).toContain("Finding 1 of 2");
  expect(host.querySelector("[data-active]")?.textContent).toContain("erc-root");
  await click(0, 0);
  expect(host.querySelector("[data-active]")).toBeNull();
});
it("moves focus into tools with I, returns on close, and retains drawing focus across surface changes", async () => {
  await act(async () => root.render(render()));
  await ready();
  const drawing = host.querySelector<HTMLElement>("[data-pcb-drawing]")!;
  await act(async () => drawing.focus());
  await key("i");
  expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  expect(document.activeElement?.tagName).toBe("SECTION");
  await key("i");
  expect(document.activeElement).toBe(drawing);
  await key("2");
  await ready();
  const board = host.querySelector<HTMLElement>("[data-pcb-drawing]")!;
  expect(board).not.toBe(drawing);
  expect(document.activeElement).toBe(board);
  expect(host.querySelector("main")).toBeNull();
});
it("announces explicit finding steps ahead of the sheet change they cause", async () => {
  await act(async () => root.render(render()));
  await ready();
  const live = () => host.querySelector('[aria-live="polite"]')!;
  expect(live().textContent).toBe("");
  await key(".");
  expect(live().textContent).toContain("Finding 1 of 2. Error, ERC: erc-root");
  await key(".");
  expect(live().textContent).toContain("Finding 2 of 2. Error, ERC: erc-sub");
  expect(live().textContent).toContain("On sheet Sub");
});
