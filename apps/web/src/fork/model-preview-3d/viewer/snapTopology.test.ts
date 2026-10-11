import { BoxGeometry, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial } from "three";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { buildTopologies, meshPositions } from "./snapTopology";
import { buildTopology } from "./snap";
const state = vi.hoisted(() => ({ worker: null as unknown }));
vi.mock("./snapTopology.worker?worker", () => ({
  default: class extends EventTarget {
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() {
      super();
      state.worker = this;
    }
  },
}));
type FakeWorker = EventTarget & {
  terminate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("expands instanced indexed meshes in source triangle order and world space", () => {
  const mesh = new InstancedMesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial(), 2);
  mesh.position.set(5, 6, 7);
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(10, 0, 0));
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(20, 0, 0));
  mesh.updateMatrixWorld(true);
  const positions = meshPositions(mesh);
  expect(positions.length).toBe(12 * 2 * 9);
  expect(Math.min(...Array.from(positions).filter((_, i) => i % 3 === 0))).toBe(14);
  expect(Math.max(...Array.from(positions).filter((_, i) => i % 3 === 0))).toBe(26);
});
it("builds without workers when unavailable and enforces the cap before copying buffers", async () => {
  vi.stubGlobal("Worker", undefined);
  const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  mesh.updateMatrixWorld(true);
  const result = await buildTopologies([mesh], new AbortController().signal);
  expect(result.get(mesh)?.region.length).toBe(12);
  Object.defineProperty(mesh.geometry.index!, "count", { value: 3_000_003 });
  await expect(buildTopologies([mesh], new AbortController().signal)).rejects.toThrow(
    "triangle limit",
  );
});
it("transfers input to one worker and terminates after receiving topology", async () => {
  vi.stubGlobal("Worker", vi.fn());
  const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  mesh.updateMatrixWorld(true);
  const result = buildTopologies([mesh], new AbortController().signal),
    worker = state.worker as FakeWorker;
  const request = worker.postMessage.mock.calls[0]![0] as { id: number; positions: Float32Array };
  expect(worker.postMessage.mock.calls[0]![1]).toEqual([request.positions.buffer]);
  worker.dispatchEvent(
    new MessageEvent("message", {
      data: { id: request.id, topology: buildTopology(request.positions, null) },
    }),
  );
  expect((await result).get(mesh)?.positions.length).toBe(24);
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("cancels a pending worker and propagates worker failures without leaking it", async () => {
  vi.stubGlobal("Worker", vi.fn());
  const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
    controller = new AbortController();
  mesh.updateMatrixWorld(true);
  const cancelled = buildTopologies([mesh], controller.signal),
    worker = state.worker as FakeWorker;
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  expect(worker.terminate).toHaveBeenCalledOnce();
  const failed = buildTopologies([mesh], new AbortController().signal),
    second = state.worker as FakeWorker;
  second.dispatchEvent(new MessageEvent("message", { data: { id: 0, error: "Invalid geometry" } }));
  await expect(failed).rejects.toThrow("Invalid geometry");
  expect(second.terminate).toHaveBeenCalledOnce();
});
