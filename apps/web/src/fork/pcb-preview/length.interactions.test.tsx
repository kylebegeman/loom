// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { PcbCheckResult, PcbDesign, PcbHardware } from "@t3tools/contracts/fork";
import { ChecksView } from "./ChecksView";
import { HardwareLibrary } from "./HardwareLibrary";
import { usePcbPreferences } from "./preferences";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  library: { value: { version: 0, items: [] as PcbHardware[] } },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: (value: unknown) => value }));
vi.mock("./AutoCheckSettings", () => ({ AutoCheckSettings: () => null }));
vi.mock("./state", () => ({
  pcb: { library: () => mocks.library, updateLibrary: { permissionAtom: () => true } },
}));
vi.mock("./usePcbPreview", () => ({
  asyncValue: (value: { value: unknown }) => value.value,
  asyncError: () => null,
}));
vi.mock("../model-preview-3d/state", () => ({ runModelCommand: mocks.run }));

const threadRef = {
  environmentId: EnvironmentId.make("units-env"),
  threadId: ThreadId.make("units-thread"),
};
const design: PcbDesign = {
  id: "board.kicad_pcb",
  name: "Board",
  absolutePath: "/workspace/board.kicad_pcb",
  kind: "kicad",
  boardPath: "board.kicad_pcb",
  toolAvailable: true,
  toolStatus: { found: true },
};
let root: Root, host: HTMLDivElement;
const previous = usePcbPreferences.getState();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.run.mockReset();
  usePcbPreferences.setState({ lengthUnit: "mil" });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  usePcbPreferences.setState(previous);
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((node) => node.textContent?.includes(text))!;
async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("locates normalized report positions and updates their labels live", async () => {
  const onLocate = vi.fn();
  const result: PcbCheckResult = {
    kind: "drc",
    outcome: "violations",
    sourceHash: "hash",
    counts: { errors: 1, warnings: 0, excluded: 0 },
    violations: [
      {
        type: "clearance",
        description: "Too close",
        severity: "error",
        excluded: false,
        group: "violation",
        items: [{ description: "R1 pad 1", x: 12.7, y: -6.35 }],
      },
    ],
    log: "",
    truncated: false,
    ranAt: "2026-10-10T00:00:00Z",
    coordinateUnits: "mm",
    pointsInMm: true,
  };
  const render = (report: PcbCheckResult) => (
    <ChecksView
      threadRef={threadRef}
      design={design}
      results={{ drc: report }}
      sourceHash="hash"
      canCheck
      checking={null}
      jobRevision={0}
      error={null}
      loading={false}
      onRun={vi.fn()}
      onCancel={vi.fn()}
      onLocate={onLocate}
    />
  );
  await act(async () => root.render(render(result)));
  expect(host.textContent).toContain("500.0, -250.0 mil");
  const locate = host.querySelector<HTMLButtonElement>('button[aria-label="Go to R1 pad 1"]')!;
  await act(async () => locate.click());
  expect(onLocate).toHaveBeenCalledWith("drc", { x: 12.7, y: -6.35 }, undefined, "Too close");
  await act(async () => usePcbPreferences.getState().setLengthUnit("mm"));
  expect(host.textContent).toContain("12.70, -6.35 mm");
  await act(async () => root.render(render({ ...result, coordinateUnits: "cm" })));
  expect(host.textContent).toContain("12.70, -6.35 mm");
  expect(host.querySelector('button[aria-label="Go to R1 pad 1"]')).not.toBeNull();
});
it("parses hardware suffixes, rejects invalid edits and saves canonical millimetres", async () => {
  const entry: PcbHardware = {
    id: "board",
    name: "Reference board",
    category: "Board",
    description: "",
    manufacturer: "",
    owned: false,
    quantity: 0,
    tags: [],
    documentationUrl: "",
    purchaseUrl: "",
    license: "",
    sourceUrl: "",
    notes: "",
    width: 12.7,
    height: 25.4,
    mountingHoles: [],
    assets: [],
  };
  mocks.library.value = { version: 0, items: [entry] };
  mocks.run.mockResolvedValue({ version: 1, items: [{ ...entry, width: 50.8 }] });
  await act(async () =>
    root.render(<HardwareLibrary threadRef={threadRef} design={design} inspection={null} />),
  );
  expect(host.textContent).toContain("500 × 1000 mil");
  await act(async () => button("Reference board").click());
  let width = host.querySelector<HTMLInputElement>('input[aria-label="Width in mils"]')!;
  await type(width, "2 in");
  await type(width, "-2");
  expect(width.getAttribute("aria-invalid")).toBe("true");
  expect(button("Save").disabled).toBe(true);
  await type(width, "2 in");
  await act(async () => usePcbPreferences.getState().setLengthUnit("mm"));
  width = host.querySelector<HTMLInputElement>('input[aria-label="Width in millimetres"]')!;
  expect(Number(width.value)).toBe(50.8);
  await act(async () =>
    width.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
    ),
  );
  expect(Number(width.value)).toBeCloseTo(50.81);
  await type(width, "2 in");
  await act(async () => button("Save").click());
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.run.mock.calls[0]![1].input.library.items[0].width).toBe(50.8);
});
