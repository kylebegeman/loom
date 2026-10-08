// @vitest-environment jsdom
import { act } from "react";
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
      observe() {
        this.callback(
          [{ contentRect: { width: 1048, height: 548 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
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
      <ChecksView
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
