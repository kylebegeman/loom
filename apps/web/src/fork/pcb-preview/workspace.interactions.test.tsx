// @vitest-environment jsdom
import { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { PcbCheckResult, PcbDesign } from "@t3tools/contracts/fork";
import { useComposerDraftStore } from "~/composerDraftStore";
import { SvgViewport, type PcbViewportHandle } from "./SvgViewport";
import { ChecksView } from "./ChecksView";
import { ToolPanel } from "./Inspector";
import { OperationStatus } from "./OperationStatus";
vi.mock("./HardwareLibrary", () => ({ HardwareLibrary: () => null }));
vi.mock("./SimulationEditor", () => ({ SimulationEditor: () => null }));
vi.mock("./ParameterEditor", () => ({ ParameterEditor: () => null }));
vi.mock("./RevisionCompare", () => ({ RevisionCompare: () => null }));
function ChecksHarness(props: ComponentProps<typeof ChecksView>) {
  const [showExcluded, setShowExcluded] = useState(false);
  return <ChecksView {...props} showExcluded={showExcluded} onShowExcluded={setShowExcluded} />;
}
let root: Root, host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const revoke = vi.fn(),
  disconnect = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  frames = new Map();
  nextFrame = 0;
  revoke.mockClear();
  disconnect.mockClear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
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
      disconnect = disconnect;
    },
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn().mockReturnValue("blob:pcb-test"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function flushFrames() {
  await act(async () => {
    const pending = [...frames];
    frames.clear();
    for (const [, callback] of pending) callback(0);
  });
}
it("fits, zooms by keyboard and wheel, stays idle, and releases image/listener resources", async () => {
  await act(async () => root.render(<SvgViewport svg="<svg/>" label="Board" />));
  const image = host.querySelector("img")!;
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } });
  await act(async () => image.dispatchEvent(new Event("load")));
  await flushFrames();
  expect(image.parentElement!.style.transform).toBe("translate(24px, 24px) scale(1)");
  expect(frames.size).toBe(0);
  const viewport = host.querySelector<HTMLElement>("[data-loom-canvas]")!;
  await act(async () =>
    viewport.dispatchEvent(
      new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true }),
    ),
  );
  await flushFrames();
  expect(image.parentElement!.style.transform).toContain("scale(1.25)");
  expect(frames.size).toBe(0);
  const wheel = new WheelEvent("wheel", {
    deltaY: 100,
    clientX: 100,
    clientY: 100,
    cancelable: true,
  });
  await act(async () => viewport.dispatchEvent(wheel));
  await flushFrames();
  expect(wheel.defaultPrevented).toBe(true);
  await act(async () =>
    viewport.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", bubbles: true, cancelable: true }),
    ),
  );
  await flushFrames();
  expect(image.parentElement!.style.transform).toContain("scale(1)");
  await act(async () => root.render(<SvgViewport svg="<svg><path/></svg>" label="Board" />));
  expect(revoke).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  expect(revoke).toHaveBeenCalledTimes(2);
  expect(disconnect).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  const detachedWheel = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
  viewport.dispatchEvent(detachedWheel);
  expect(detachedWheel.defaultPrevented).toBe(false);
});
it("shows elapsed progress and removes the timer when the operation ends", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  await act(async () => root.render(<OperationStatus label="Building board" onCancel={cancel} />));
  expect(host.textContent).toContain("Building board");
  expect(host.textContent).toContain("0s");
  await act(async () => vi.advanceTimersByTime(2000));
  expect(host.textContent).toContain("2s");
  await act(async () => host.querySelector("button")!.click());
  expect(cancel).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});
it("prepares a report in the existing draft, filters exclusions, and copies over plain HTTP", async () => {
  const threadRef = {
    environmentId: EnvironmentId.make("pcb-ui-env"),
    threadId: ThreadId.make("pcb-ui-thread"),
  };
  const design: PcbDesign = {
    id: "board.kicad_pro",
    name: "Board",
    absolutePath: "/workspace/board.kicad_pro",
    kind: "kicad",
    schematicPath: "board.kicad_sch",
    boardPath: "board.kicad_pcb",
    toolAvailable: true,
    toolStatus: { found: true },
  };
  const result: PcbCheckResult = {
    kind: "erc",
    outcome: "violations",
    sourceHash: "hash",
    counts: { errors: 1, warnings: 0, excluded: 1 },
    violations: [
      {
        type: "pin",
        description: "Connect the resistor",
        severity: "error",
        excluded: false,
        group: "violation",
        items: [],
      },
      {
        type: "pin",
        description: "Intentionally excluded",
        severity: "warning",
        excluded: true,
        group: "violation",
        items: [],
      },
    ],
    log: "",
    truncated: false,
    ranAt: "2026-10-07T12:00:00.000Z",
  };
  useComposerDraftStore.getState().setPrompt(threadRef, "Please explain these findings.");
  const copied: string[] = [];
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn(() => {
      copied.push(document.querySelector("textarea")!.value);
      return true;
    }),
  });
  const button = (text: string) =>
    [...host.querySelectorAll("button")].find((node) => node.textContent?.includes(text))!;
  await act(async () =>
    root.render(
      <ChecksHarness
        threadRef={threadRef}
        design={design}
        results={{ erc: result }}
        sourceHash="newer"
        canCheck
        checking={null}
        jobRevision={0}
        error={null}
        loading={false}
        onRun={vi.fn()}
        onCancel={vi.fn()}
      />,
    ),
  );
  expect(host.textContent).toContain("Files changed since this run.");
  expect(host.textContent).not.toContain("Intentionally excluded");
  await act(async () => button("Excluded").click());
  expect(host.textContent).toContain("Intentionally excluded");
  await act(async () => button("Add summary to draft").click());
  const prompt = useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt;
  expect(prompt).toContain("Please explain these findings.\n\nERC for Board");
  expect(prompt).toContain("Connect the resistor");
  expect(prompt).not.toContain("Intentionally excluded");
  await act(async () => button("Copy summary").click());
  expect(copied).toHaveLength(1);
  expect(copied[0]).toContain("ERC for Board");
  useComposerDraftStore.getState().setPrompt(threadRef, "");
});

it("defers component focus until the drawing dimensions are available", async () => {
  const handle = { current: null as PcbViewportHandle | null };
  await act(async () =>
    root.render(<SvgViewport svg='<svg viewBox="0 0 100 50"/>' label="Board" handle={handle} />),
  );
  await act(async () => handle.current!.focus({ x: 75, y: 25 }));
  const image = host.querySelector("img")!;
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } });
  await act(async () => image.dispatchEvent(new Event("load")));
  await flushFrames();
  expect(handle.current!.snapshot()).toEqual({ x: -226, y: 24, scale: 1 });
  expect(frames.size).toBe(0);
});

it("refuses blank or partial captures until the drawing and visible layers decode", async () => {
  const handle = { current: null as PcbViewportHandle | null };
  await act(async () =>
    root.render(
      <SvgViewport svg='<svg viewBox="0 0 100 50"/>' label="Board" handle={handle} layered>
        <img data-layer-image data-layer-loading="true" style={{ opacity: 1 }} alt="Front copper" />
      </SvgViewport>,
    ),
  );
  await expect(handle.current!.capture(false)).rejects.toThrow("Wait for the drawing");
  const image = host.querySelector("img")!;
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } });
  await act(async () => image.dispatchEvent(new Event("load")));
  await expect(handle.current!.capture(false)).rejects.toThrow("visible layers");
});

it("keeps a named view after save failure and disables workspace writes without permission", async () => {
  const design: PcbDesign = {
    id: "board.kicad_pcb",
    name: "Board",
    kind: "kicad",
    absolutePath: "/board.kicad_pcb",
    boardPath: "board.kicad_pcb",
    toolAvailable: true,
    toolStatus: { found: true },
  };
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("conflict"))
    .mockResolvedValueOnce(undefined);
  const props = {
    tab: "Views" as const,
    threadRef: { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") },
    design,
    inspection: null,
    executionAllowed: true,
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
    view: "pcb" as const,
    sourceHash: "hash",
    layers: [],
    selected: null,
    net: null,
    onSelect: vi.fn(),
    onPin: vi.fn(),
    onNet: vi.fn(),
    onLayers: vi.fn(),
    onPreset: vi.fn(),
    onShowBoard: vi.fn(),
    onTool: vi.fn(),
    onFocusMark: vi.fn(),
    mutate: vi.fn(),
    onSaveView: save,
    onLoadView: vi.fn(),
    canSave: true,
    canSaveView: true,
    canMark: true,
  };
  await act(async () => root.render(<ToolPanel {...props} />));
  const input = host.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Top detail",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "Save current view")!
      .click(),
  );
  expect(input.value).toBe("Top detail");
  await act(async () => root.render(<ToolPanel {...props} canSave={false} />));
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Save current view",
  )!;
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<ToolPanel {...props} />));
  await act(async () => button.click());
  expect(input.value).toBe("");
});

it("exports visible layers and overlays in physical coordinates, skipping hidden layers", async () => {
  const handle = { current: null as PcbViewportHandle | null };
  const front =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50"><path id="front" d="M10 20h20"/></svg>';
  const back =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50"><path id="back" d="M10 30h20"/></svg>';
  const fetchLayer = vi.fn(async (url: string) => ({
    ok: true,
    text: async () => (url === "blob:front" ? front : back),
  }));
  vi.stubGlobal("fetch", fetchLayer);
  await act(async () =>
    root.render(
      <SvgViewport
        svg={front}
        label="Controller"
        handle={handle}
        layered
        overlays={
          <text x="30" y="30" fill="currentColor">
            Measure
          </text>
        }
      >
        <img src="blob:front" data-layer-image style={{ opacity: 0.5 }} alt="Front" />
        <img
          src="blob:hidden"
          data-layer-image
          data-layer-loading="true"
          style={{ opacity: 0 }}
          alt="Hidden"
        />
        <img src="blob:back" data-layer-image style={{ opacity: 1 }} alt="Back" />
      </SvgViewport>,
    ),
  );
  const images = [...host.querySelectorAll("img")];
  for (const image of images)
    Object.defineProperties(image, {
      complete: { value: true },
      naturalWidth: { value: 1000 },
      naturalHeight: { value: 500 },
    });
  await act(async () => images[0]!.dispatchEvent(new Event("load")));
  await flushFrames();
  await act(async () => handle.current!.restore({ x: -100, y: -50, scale: 2 }));
  const exported = new DOMParser().parseFromString(
    await handle.current!.exportSvg(false),
    "image/svg+xml",
  );
  const frame = exported.documentElement.getAttribute("viewBox")!.split(" ").map(Number);
  expect(frame.slice(0, 2)).toEqual([15, 22.5]);
  expect(frame[2]).toBeCloseTo(52.4);
  expect(frame[3]).toBeCloseTo(27.4);
  expect(fetchLayer.mock.calls.map(([url]) => url)).toEqual(["blob:front", "blob:back"]);
  expect([...exported.querySelectorAll("svg > g")].map((group) => group.id)).toEqual([
    "layer-1",
    "layer-2",
    "overlay",
  ]);
  expect(exported.querySelector("#layer-1")!.getAttribute("opacity")).toBe("0.5");
  expect(exported.querySelector("#overlay")!.textContent).toBe("Measure");
  const whole = new DOMParser().parseFromString(
    await handle.current!.exportSvg(true),
    "image/svg+xml",
  );
  expect(whole.documentElement.getAttribute("width")).toBe("100mm");
});

it("keeps legacy capture size and reports bounded PNG export dimensions", async () => {
  const handle = { current: null as PcbViewportHandle | null };
  const context = {
    scale: vi.fn(),
    translate: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    filter: "none",
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as ReturnType<HTMLCanvasElement["getContext"]>,
  );
  const sizes: [number, number][] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
  ) {
    sizes.push([this.width, this.height]);
    callback(new Blob(["png"], { type: "image/png" }));
  });
  await act(async () => root.render(<SvgViewport svg="<svg/>" label="Board" handle={handle} />));
  const image = host.querySelector("img")!;
  Object.defineProperties(image, {
    complete: { value: true },
    naturalWidth: { value: 1000 },
    naturalHeight: { value: 500 },
  });
  await act(async () => image.dispatchEvent(new Event("load")));
  await handle.current!.capture(false);
  expect(sizes[0]).toEqual([2096, 1096]);
  const normal = handle.current!.exportPng(false, 1);
  expect(normal).toMatchObject({ width: 1048, height: 548, reduced: false });
  await normal.image;
  await act(async () => handle.current!.restore({ x: 0, y: 0, scale: 32 }));
  const huge = handle.current!.exportPng(true, 2);
  expect(huge.reduced).toBe(true);
  expect(Math.max(huge.width, huge.height)).toBeLessThanOrEqual(8192);
  expect(huge.width * huge.height).toBeLessThanOrEqual(16_777_216);
  await huge.image;
});

it("area drags report millimetres while ordinary drags pan and clicks still pick", async () => {
  const box = vi.fn(),
    pick = vi.fn();
  await act(async () =>
    root.render(
      <SvgViewport svg='<svg viewBox="0 0 100 50"/>' label="Area" onBox={box} onPick={pick} />,
    ),
  );
  const img = host.querySelector("img")!;
  Object.defineProperties(img, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } });
  await act(async () => img.dispatchEvent(new Event("load")));
  await flushFrames();
  const canvas = host.querySelector<HTMLElement>("[data-loom-canvas]")!;
  canvas.setPointerCapture = vi.fn();
  const pointer = async (type: string, x: number, y: number) =>
    act(async () =>
      canvas.dispatchEvent(
        new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }),
      ),
    );
  await pointer("pointerdown", 44, 44);
  await pointer("pointermove", 144, 94);
  await pointer("pointerup", 144, 94);
  expect(box).toHaveBeenCalledWith({ x: 2, y: 2, width: 10, height: 5 });
  expect(pick).not.toHaveBeenCalled();
  await pointer("pointerdown", 44, 44);
  await pointer("pointerup", 44, 44);
  expect(pick).toHaveBeenCalledWith({ x: 2, y: 2 }, true);
  await act(async () =>
    root.render(<SvgViewport svg='<svg viewBox="0 0 100 50"/>' label="Area" onPick={pick} />),
  );
  await pointer("pointerdown", 44, 44);
  await pointer("pointermove", 144, 94);
  await pointer("pointerup", 144, 94);
  await flushFrames();
  expect(img.parentElement!.style.transform).toContain("translate(124px, 74px)");
  expect(box).toHaveBeenCalledTimes(1);
});
it("restores focus only for a drawing remount and exposes drawing instructions", async () => {
  await act(async () => root.render(<SvgViewport key="one" svg="<svg/>" label="Power, Board" />));
  const old = host.querySelector<HTMLElement>("[data-pcb-drawing]")!;
  old.focus();
  await act(async () =>
    root.render(<SvgViewport key="two" svg="<svg/>" label="Power, Schematic" restoreFocus />),
  );
  const next = host.querySelector<HTMLElement>("[data-pcb-drawing]")!;
  expect(document.activeElement).toBe(next);
  expect(next.getAttribute("role")).toBe("application");
  expect(next.getAttribute("aria-label")).toBe("Power, Schematic");
  expect(document.getElementById(next.getAttribute("aria-describedby")!)!.textContent).toContain(
    "arrow keys",
  );
  expect(host.querySelector("img")!.getAttribute("alt")).toBe("");
  await act(async () => root.render(<SvgViewport key="three" svg="<svg/>" label="Power, Board" />));
  expect(document.activeElement).toBe(document.body);
  const control = document.createElement("button");
  document.body.append(control);
  control.focus();
  await act(async () =>
    root.render(<SvgViewport key="four" svg="<svg/>" label="Power, Board" restoreFocus />),
  );
  expect(document.activeElement).toBe(control);
  control.remove();
});
it("keeps centrally announced operations visible without another live region", async () => {
  await act(async () => root.render(<OperationStatus label="Building board" silent />));
  expect(host.textContent).toContain("Building board");
  expect(host.querySelector('[role="status"]')).toBeNull();
});
