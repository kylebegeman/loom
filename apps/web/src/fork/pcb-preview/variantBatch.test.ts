import { expect, it, vi } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { PcbVariant, type PcbRenderVariantResult } from "@t3tools/contracts/fork";
import { runVariantBatch } from "./variantBatch";
const decodeVariant = Schema.decodeUnknownSync(PcbVariant);
const variants = ["a", "b", "c"].map((id) =>
  decodeVariant({ id, name: id, values: {}, sourceHash: "source" }),
);
const result = (id: string): PcbRenderVariantResult => ({
  variantId: id,
  outcome: "ok",
  renderKey: "render",
  sourceHash: "revision",
  sheet: { id: "1.svg", label: "Board", bytes: 1, tooLarge: false },
  stats: null,
  log: "",
  cached: false,
});
function options() {
  return {
    variants,
    current: () => true,
    progress: vi.fn(),
    render: vi.fn(async (v: PcbVariant) => result(v.id)),
    read: vi.fn(async () => "svg"),
    thumbnail: vi.fn(async () => "thumbnail"),
    save: vi.fn(async (_variant: PcbVariant, _patch: Partial<PcbVariant>) => undefined),
  };
}
it("renders sequentially, saves completed previews and continues after a failed candidate", async () => {
  const o = options();
  o.render.mockImplementation(async (v) =>
    v.id === "b" ? { ...result(v.id), outcome: "failed", log: "Exporter failed" } : result(v.id),
  );
  await runVariantBatch(o);
  expect(o.render.mock.calls.map(([v]) => v.id)).toEqual(["a", "b", "c"]);
  expect(o.save.mock.calls[0]?.[1]).toMatchObject({
    thumbnail: "thumbnail",
    renderedRevision: "revision",
    error: null,
  });
  expect(o.save.mock.calls[1]?.[1]).toEqual({ error: "Exporter failed" });
  expect(o.thumbnail).toHaveBeenCalledTimes(2);
});
it("stops on a source conflict and discards a cancelled in-flight result", async () => {
  const o = options();
  o.render.mockRejectedValueOnce(new Error("The circuit source changed."));
  await expect(runVariantBatch(o)).rejects.toThrow("source changed");
  expect(o.render).toHaveBeenCalledTimes(1);
  expect(o.save).not.toHaveBeenCalled();
  const c = options();
  let current = true;
  c.current = () => current;
  c.render.mockImplementation(async (v) => {
    current = false;
    return result(v.id);
  });
  await runVariantBatch(c);
  expect(c.render).toHaveBeenCalledTimes(1);
  expect(c.read).not.toHaveBeenCalled();
  expect(c.save).not.toHaveBeenCalled();
});
it("waits for one candidate to finish before starting the next", async () => {
  const o = options();
  let release!: (v: PcbRenderVariantResult) => void;
  o.render.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const job = runVariantBatch(o);
  expect(o.render).toHaveBeenCalledTimes(1);
  expect(o.progress).toHaveBeenCalledWith(0, variants[0]);
  release(result("a"));
  await job;
  expect(o.render).toHaveBeenCalledTimes(3);
});
