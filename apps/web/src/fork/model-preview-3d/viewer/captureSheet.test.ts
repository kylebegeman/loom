import { expect, it, vi } from "vite-plus/test";
import { captureNamedViews } from "./captureSheet";
import type { ModelViewer } from "./createViewer";
import type { ModelCamera, ModelSavedView } from "@t3tools/contracts/fork";

it("snapshots every named view before encoding and immediately restores the user's camera", async () => {
  const original: ModelCamera = {
    position: [1, 2, 3],
    target: [0, 0, 0],
    near: 0.1,
    far: 1000,
    wireframe: false,
    gridVisible: true,
    axesVisible: false,
    navigationMode: "orbit",
    section: { enabled: false, axis: "z", offset: 0, flipped: false },
  };
  let camera = original;
  const frames = [0, 1].map(() => {
    let resolve!: (blob: Blob) => void;
    const promise = new Promise<Blob>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  });
  const captured: ModelCamera[] = [];
  const viewer = {
    snapshot: () => camera,
    restore: (next: ModelCamera) => {
      camera = next;
    },
    refit: vi.fn(),
    capture: () => {
      captured.push(camera);
      return frames[captured.length - 1]!.promise;
    },
  } as unknown as ModelViewer;
  const context = { fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn() };
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => context,
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["sheet"])),
    }),
  });
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 100, height: 100, close })),
  );
  const views = [
    {
      id: "a",
      name: "Front",
      sourceRevision: "mesh",
      camera: { ...original, position: [4, 5, 6] },
    },
    { id: "b", name: "Top", sourceRevision: "mesh", camera: { ...original, position: [7, 8, 9] } },
  ] as ModelSavedView[];
  try {
    const sheet = captureNamedViews(viewer, views, "part", "mesh");
    expect(captured).toEqual(views.map((view) => view.camera));
    expect(camera).toBe(original);
    frames.forEach((frame) => frame.resolve(new Blob(["frame"])));
    expect(await (await sheet).text()).toBe("sheet");
    expect(close).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
