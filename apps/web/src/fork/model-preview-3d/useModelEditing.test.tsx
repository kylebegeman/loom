import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import {
  EMPTY_MODEL_WORKSPACE,
  normalizeQuaternion,
  type ModelSavedView,
  type ModelOrientation,
} from "@t3tools/contracts/fork";
import { Vector3 } from "three";
import type { ModelViewer } from "./viewer/createViewer";
import { attachModelImage } from "./capture";
import { captureNamedViews } from "./viewer/captureSheet";
import { useModelEditing } from "./useModelEditing";
const mutate = vi.hoisted(() => vi.fn());
const fixture = vi.hoisted(() => ({
  views: [] as ModelSavedView[],
  orientation: null as ModelOrientation | null,
  canEdit: true,
}));
const composer = vi.hoisted(() => vi.fn());
vi.mock("~/composerDraftStore", () => ({ useComposerDraftStore: { getState: composer } }));
vi.mock("./useModelWorkspace", () => ({
  useModelWorkspace: () => ({
    data: { ...EMPTY_MODEL_WORKSPACE, views: fixture.views, orientation: fixture.orientation },
    canEdit: fixture.canEdit,
    mutate,
    ready: true,
    error: null,
    pendingSaves: 0,
  }),
}));
vi.mock("./capture", () => ({ attachModelImage: vi.fn() }));
vi.mock("./viewer/captureSheet", () => ({ captureNamedViews: vi.fn(), thumbnail: vi.fn() }));

it("shows in-flight work, excludes overlapping capture operations and clears status after failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let editing: ReturnType<typeof useModelEditing>;
  let renderer: ReactTestRenderer | null = null;
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  const pending = { promise, resolve };
  const duplicate = vi.fn(async () => "duplicate");
  function Harness() {
    const state = useModelEditing(
      { environmentId: "env", threadId: "thread" } as ScopedThreadRef,
      "part.scad",
      { current: null },
      "mesh",
      null,
    );
    useLayoutEffect(() => {
      editing = state;
    });
    return null;
  }
  try {
    await act(async () => {
      renderer = create(<Harness />);
    });
    let first: Promise<string | undefined>;
    await act(async () => {
      first = editing.perform("Capturing review", () => pending.promise);
    });
    expect(editing!.operation).toBe("Capturing review");
    await act(async () => {
      expect(await editing.perform("Second capture", duplicate)).toBeUndefined();
    });
    expect(duplicate).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve("saved");
      expect(await first!).toBe("saved");
    });
    expect(editing!.operation).toBeNull();
    await act(async () => {
      await editing.perform("Saving", async () => {
        throw new Error("Disconnected");
      });
    });
    expect(editing!.operation).toBeNull();
    expect(editing!.error).toBe("Disconnected");
  } finally {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});

let renderer: ReactTestRenderer | null;
let editing: ReturnType<typeof useModelEditing>;
const viewer: { current: ModelViewer | null } = { current: null };
function Harness({ revision }: { revision: string }) {
  const result = useModelEditing(
    { environmentId: EnvironmentId.make("test"), threadId: ThreadId.make("test") },
    "board.glb",
    viewer,
    revision,
    null,
  );
  useLayoutEffect(() => {
    editing = result;
  });
  return null;
}
async function update(revision = "revision") {
  await act(async () => {
    if (renderer) renderer.update(<Harness revision={revision} />);
    else renderer = create(<Harness revision={revision} />);
  });
}
beforeEach(() => {
  renderer = null;
  mutate.mockReset();
  composer.mockReset();
  vi.mocked(attachModelImage).mockReset();
  vi.mocked(captureNamedViews).mockReset();
  fixture.views = [];
  fixture.orientation = null;
  fixture.canEdit = true;
  viewer.current = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("awaits measurement persistence and preserves the first point after a failed save", async () => {
  await update();
  await act(async () => editing.choose("measure"));
  await act(async () => {
    expect(await editing.onPick([[1, 2, 3]])).toEqual({ measurement: null });
  });
  expect(editing.pendingPoint).toEqual([1, 2, 3]);
  mutate.mockResolvedValueOnce(undefined);
  await act(async () => {
    expect(await editing.onPick([[4, 6, 3]])).toBe(false);
  });
  expect(editing.pendingPoint).toEqual([1, 2, 3]);
  let resolve!: (value: typeof EMPTY_MODEL_WORKSPACE) => void;
  mutate.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const saving = editing.onPick([[4, 6, 3]]);
  expect(editing.pendingPoint).toEqual([1, 2, 3]);
  await act(async () => {
    resolve(EMPTY_MODEL_WORKSPACE);
    expect(await saving).toMatchObject({
      measurement: { kind: "distance", start: [1, 2, 3], end: [4, 6, 3] },
    });
  });
  expect(editing.pendingPoint).toBeNull();
  expect(mutate.mock.calls.at(-1)?.[0]).toMatchObject({
    kind: "measurement",
    item: { kind: "distance", sourceRevision: "revision", start: [1, 2, 3], end: [4, 6, 3] },
  });
});
it("rejects empty or inactive picks and invalidates an unfinished region when geometry changes", async () => {
  await update();
  expect(await editing.onPick([[1, 2, 3]])).toBe(false);
  await act(async () => editing.choose("annotate"));
  expect(await editing.onPick([])).toBe(false);
  await act(async () => {
    expect(
      await editing.onPick([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toEqual({ measurement: null });
  });
  expect(editing.pendingRegion).toHaveLength(2);
  await update("changed");
  expect(editing.pendingRegion).toBeNull();
  expect(mutate).not.toHaveBeenCalled();
});

function exportedView(): ModelSavedView {
  return {
    id: "front",
    name: "Front",
    sourceRevision: "revision",
    camera: {
      projection: "orthographic",
      position: [0, -20, 0],
      target: [0, 0, 0],
      near: 0.1,
      far: 100,
      wireframe: false,
      overhangs: false,
      gridVisible: true,
      axesVisible: false,
      navigationMode: "orbit",
      section: { enabled: false, axis: "z", offset: 0, flipped: false, caps: true },
    },
  };
}
function prepareExport() {
  fixture.views = [exportedView()];
  const setOverlays = vi.fn();
  viewer.current = { setOverlays } as unknown as ModelViewer;
  return { setOverlays };
}

it("copies a named view during the gesture and blocks overlapping exports and attachment", async () => {
  const { setOverlays } = prepareExport();
  let resolve!: (blob: Blob) => void;
  const image = new Promise<Blob>((done) => {
    resolve = done;
  });
  vi.mocked(captureNamedViews).mockReturnValueOnce(image);
  class ClipboardItemStub {
    constructor(readonly data: Record<string, Promise<Blob>>) {}
  }
  const write = vi.fn((items: ClipboardItemStub[]) => items[0]!.data["image/png"]!.then(() => {}));
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { clipboard: { write } });
  vi.stubGlobal("ClipboardItem", ClipboardItemStub);
  await update();
  let exporting!: ReturnType<typeof editing.exportViews>;
  await act(async () => {
    exporting = editing.exportViews(["front"], false, "Front", "copy");
    expect(write).toHaveBeenCalledOnce();
  });
  expect(editing.operation).toBe("Copying model image");
  expect(setOverlays).toHaveBeenCalledTimes(2);
  await act(async () => {
    expect(await editing.exportViews(["front"], false, "Front", "save")).toBeUndefined();
    await editing.captureViews(["front"], false, "Front");
  });
  expect(captureNamedViews).toHaveBeenCalledOnce();
  const png = new Blob(["uncompressed full image"], { type: "image/png" });
  await act(async () => {
    resolve(png);
    expect(await exporting).toEqual({ ok: true });
  });
  expect(editing.operation).toBeNull();
  expect(await write.mock.calls[0]![0][0]!.data["image/png"]).toBe(png);
  expect(attachModelImage).not.toHaveBeenCalled();
  expect(composer).not.toHaveBeenCalled();
  expect(mutate).not.toHaveBeenCalled();
});
it("saves the full review sheet and keeps attaching named views unchanged", async () => {
  prepareExport();
  const image = new Blob(["full sheet"], { type: "image/png" });
  vi.mocked(captureNamedViews).mockResolvedValue(image);
  vi.useFakeTimers();
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sheet");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const anchor = { href: "", download: "", click: vi.fn() };
  vi.stubGlobal("document", { createElement: () => anchor });
  await update();
  await act(async () => {
    expect(await editing.exportViews(["front"], true, "Review sheet", "save")).toEqual({
      ok: true,
    });
  });
  expect(createUrl).toHaveBeenCalledWith(image);
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.download).toMatch(/^board-Review-sheet-\d{8}-\d{4}\.png$/);
  expect(attachModelImage).not.toHaveBeenCalled();
  expect(composer).not.toHaveBeenCalled();
  await act(async () => {
    await editing.captureViews(["front"], true, "Review sheet");
  });
  expect(attachModelImage).toHaveBeenCalledWith(
    image,
    { environmentId: EnvironmentId.make("test"), threadId: ThreadId.make("test") },
    "Review sheet.png",
  );
});
it("returns action-specific export failures, restores overlays and releases the operation lock", async () => {
  const { setOverlays } = prepareExport();
  vi.mocked(captureNamedViews).mockRejectedValueOnce(new Error("Render failed"));
  await update();
  await act(async () => {
    expect(await editing.exportViews(["front"], false, "Front", "save")).toEqual({
      ok: false,
      title: "PNG could not be saved",
      message: "Render failed",
    });
  });
  expect(setOverlays).toHaveBeenCalledTimes(2);
  expect(editing.operation).toBeNull();
  expect(editing.error).toBeNull();
  vi.mocked(captureNamedViews).mockResolvedValueOnce(new Blob());
  vi.stubGlobal("window", { isSecureContext: false });
  await act(async () => {
    expect(await editing.exportViews(["front"], false, "Front", "copy")).toEqual({
      ok: false,
      title: "Image could not be copied",
      message: "Image copying is unavailable. Use a secure browser connection or save the image.",
    });
  });
  expect(captureNamedViews).toHaveBeenCalledTimes(2);
  expect(editing.operation).toBeNull();
  expect(editing.error).toBeNull();
  expect(attachModelImage).not.toHaveBeenCalled();
  expect(composer).not.toHaveBeenCalled();
});

it("saves circular measurements with an honest diameter fallback and resets the mode", async () => {
  mutate.mockResolvedValue(EMPTY_MODEL_WORKSPACE);
  await update();
  await act(async () => {
    editing.choose("measure");
    editing.setMeasureMode("hole");
  });
  const fit = {
    center: [5, 6, 7] as [number, number, number],
    normal: [1, 0, 0] as [number, number, number],
    diameter: 3.4,
    sides: 6,
    loop: [],
    rms: 0,
  };
  await act(async () => {
    const saved = await editing.onCircle(fit);
    expect(saved).toMatchObject({
      measurement: {
        kind: "circle",
        name: "Hole 1",
        circle: { center: [5, 6, 7], diameter: 3.4, sides: 6 },
      },
    });
    if (saved) {
      const { start, end } = saved.measurement;
      expect(Math.hypot(...end.map((value, axis) => value - start[axis]!))).toBeCloseTo(3.4);
      expect(start[0]).toBe(5);
      expect(end[0]).toBe(5);
    }
  });
  expect(editing.measureMode).toBe("hole");
  await act(async () => editing.cancel());
  expect(editing.measureMode).toBe("distance");
  expect(editing.picking).toBeNull();
});
it("keeps failed hole picks empty and clears the hint on a successful fit", async () => {
  await update();
  await act(async () => {
    editing.choose("measure");
    editing.setMeasureMode("hole");
  });
  await act(async () => {
    expect(await editing.onCircle(null)).toBe(false);
  });
  expect(editing.error).toBe("Click the rim of the hole");
  expect(mutate).not.toHaveBeenCalled();
  mutate.mockResolvedValue(EMPTY_MODEL_WORKSPACE);
  await act(async () => {
    await editing.onCircle({
      center: [0, 0, 0],
      normal: [0, 0, 1],
      diameter: 4,
      sides: 64,
      loop: [],
      rms: 0,
    });
  });
  expect(editing.error).toBeNull();
});

const sourcePose: ModelOrientation = { quaternion: [0, 0, 0, 1], sourceRevision: "earlier" };
const laidFlat: ModelOrientation = {
  quaternion: normalizeQuaternion([Math.SQRT1_2, 0, 0, Math.SQRT1_2]),
  sourceRevision: "revision",
};
function orientationViewer() {
  const setOrientation = vi.fn();
  const faceOrientationAt = vi.fn(() => ({
    quaternion: laidFlat.quaternion,
    areaMm2: 100,
    floats: false,
  }));
  const autoOrientation = vi.fn(() => laidFlat.quaternion);
  viewer.current = { setOrientation, faceOrientationAt, autoOrientation } as unknown as ModelViewer;
  return { setOrientation, faceOrientationAt, autoOrientation };
}

it("applies a face optimistically, persists its revision and keeps lay-flat picking active", async () => {
  fixture.orientation = sourcePose;
  const { setOrientation } = orientationViewer();
  let resolve!: (value: typeof EMPTY_MODEL_WORKSPACE) => void;
  mutate.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await update();
  await act(async () => editing.choose("lay-flat"));
  let saving!: ReturnType<typeof editing.onPick>;
  await act(async () => {
    saving = editing.onPick([[0, 0, 5]]);
  });
  expect(editing.orientation).toEqual(laidFlat);
  expect(editing.operation).toBe("Saving orientation");
  expect(setOrientation).toHaveBeenLastCalledWith(laidFlat.quaternion);
  expect(mutate).toHaveBeenCalledWith({ kind: "orientation", item: laidFlat });
  await act(async () => {
    resolve({ ...EMPTY_MODEL_WORKSPACE, orientation: laidFlat });
    expect(await saving).toEqual({ measurement: null });
  });
  expect(editing.picking).toBe("lay-flat");
  expect(editing.orientationMessage).toBe("Resting on a face of 100.0 mm².");
  fixture.orientation = laidFlat;
  await update();
  fixture.orientation = sourcePose;
  await update();
  expect(editing.orientation).toEqual(sourcePose);
});

it("rolls a failed orientation save back to the server pose and reports the failure", async () => {
  fixture.orientation = sourcePose;
  const { setOrientation } = orientationViewer();
  mutate.mockRejectedValueOnce(new Error("Disconnected"));
  await update();
  await act(async () => {
    expect(await editing.faceOrientationAt([0, 0, 5])).toBeNull();
  });
  expect(editing.orientation).toEqual(sourcePose);
  expect(setOrientation.mock.calls.map(([q]) => q)).toEqual([
    laidFlat.quaternion,
    sourcePose.quaternion,
  ]);
  expect(editing.error).toBe("Disconnected");
  expect(editing.operation).toBeNull();
});

it("preserves a saved orientation across source revisions and rejects readonly face picks", async () => {
  fixture.orientation = sourcePose;
  fixture.canEdit = false;
  const { faceOrientationAt } = orientationViewer();
  await update("new-file");
  expect(editing.orientation).toEqual(sourcePose);
  await act(async () => {
    expect(await editing.faceOrientationAt([0, 0, 0])).toBeNull();
  });
  expect(faceOrientationAt).not.toHaveBeenCalled();
  expect(mutate).not.toHaveBeenCalled();
});

it("reports already-resting faces without saving and handles absent or floating faces", async () => {
  const { faceOrientationAt } = orientationViewer();
  fixture.orientation = laidFlat;
  await update();
  await act(async () => {
    expect(await editing.faceOrientationAt([0, 0, 5])).not.toBeNull();
  });
  expect(editing.orientationMessage).toBe("Already resting on that face");
  expect(mutate).not.toHaveBeenCalled();
  faceOrientationAt.mockReturnValueOnce(null as never);
  await act(async () => {
    expect(await editing.faceOrientationAt([100, 100, 100])).toBeNull();
  });
  expect(editing.error).toBe("No face at that point.");
  fixture.orientation = sourcePose;
  await update();
  faceOrientationAt.mockReturnValueOnce({
    quaternion: laidFlat.quaternion,
    areaMm2: 25,
    floats: true,
  });
  mutate.mockResolvedValueOnce({ ...EMPTY_MODEL_WORKSPACE, orientation: laidFlat });
  await act(async () => {
    await editing.faceOrientationAt([0, 0, 1]);
  });
  expect(editing.orientationMessage).toBe(
    "This face cannot touch the bed; the part rests on other points.",
  );
});

it("automatically lays flat, persists reset and appends an exact bake request to the composer", async () => {
  orientationViewer();
  const setPrompt = vi.fn();
  composer.mockReturnValue({ getComposerDraft: () => ({ prompt: "Existing request" }), setPrompt });
  mutate.mockResolvedValue({ ...EMPTY_MODEL_WORKSPACE, orientation: laidFlat });
  await update();
  await act(async () => {
    expect(await editing.autoOrient()).toEqual(laidFlat.quaternion);
  });
  expect(editing.orientation).toEqual(laidFlat);
  fixture.orientation = laidFlat;
  await update();
  await act(async () => {
    expect(await editing.prepareOrientationRequest("scad", new Vector3(0, 0, 0), -10)).toBe(true);
  });
  const prompt = setPrompt.mock.calls[0]![1] as string;
  expect(prompt).toContain("Existing request\n\nBake the Loom orientation into board.glb.");
  expect(prompt).toContain("multmatrix(");
  expect(prompt).toContain("translate([0, 0, 10])");
  expect(prompt).toContain('{ "kind": "orientation", "item": null }');
  expect(attachModelImage).not.toHaveBeenCalled();
  mutate.mockResolvedValueOnce(EMPTY_MODEL_WORKSPACE);
  await act(async () => {
    expect(await editing.resetOrientation()).toBe(true);
  });
  expect(mutate).toHaveBeenLastCalledWith({ kind: "orientation", item: null });
  expect(editing.orientation).toBeNull();
});

it("persists wall chords as normal measurements and retains pending state on save failure", async () => {
  await update();
  await act(async () => editing.choose("measure"));
  await act(async () => {
    await editing.onPick([[1, 2, 3]]);
  });
  mutate.mockResolvedValueOnce(undefined);
  await act(async () => {
    expect(await editing.onWall([0, 0, 0], [0, 2, 0])).toBe(false);
  });
  expect(editing.pendingPoint).toEqual([1, 2, 3]);
  mutate.mockResolvedValueOnce(EMPTY_MODEL_WORKSPACE);
  await act(async () => {
    expect(await editing.onWall([0, 0, 0], [0, 2, 0])).toMatchObject({
      measurement: {
        kind: "distance",
        name: "Wall 1",
        sourceRevision: "revision",
        start: [0, 0, 0],
        end: [0, 2, 0],
        visible: true,
      },
    });
  });
  expect(editing.pendingPoint).toBeNull();
  expect(mutate).toHaveBeenLastCalledWith({
    kind: "measurement",
    item: expect.objectContaining({ name: "Wall 1", kind: "distance" }),
  });
});
