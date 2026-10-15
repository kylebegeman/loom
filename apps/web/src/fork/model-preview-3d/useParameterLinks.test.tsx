import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { BoxGeometry, Mesh } from "three";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ScadParameter } from "@t3tools/contracts/fork";

const mocks = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("./state", () => ({
  models: { render: "render", renderModel: "renderModel", cancelVariant: "cancel" },
  runModelCommand: mocks.command,
  modelUrl: (_: string, url: string) => url,
}));
vi.mock("./viewer/load", async () => {
  const three = await import("three");
  return {
    loadModel: async () => new three.Mesh(new three.BoxGeometry(20, 30, 40)),
    disposeModel: () => undefined,
  };
});
import {
  LINK_VARIANT_ID,
  linkKey,
  modelLinkRender,
  useParameterLinks,
  type LinkRender,
} from "./useParameterLinks";

/** A box from the origin, as the render path's model-space triangle soup. */
const cuboid = (width: number, depth: number, height: number) =>
  new Mesh(
    new BoxGeometry(width, depth, height)
      .translate(width / 2, depth / 2, height / 2)
      .toNonIndexed(),
  ).geometry.getAttribute("position").array as Float32Array;
const parameter = (
  name: string,
  defaultValue: string,
  range: ScadParameter["range"],
): ScadParameter => ({
  name,
  group: "",
  description: null,
  kind: "number",
  defaultValue,
  range,
  options: null,
});
const parameters = [
  parameter("width", "20", { min: 10, max: 30, step: 2 }),
  parameter("height", "40", null),
  parameter("lip", "5", { min: 5, max: 5, step: null }),
];
const values = { width: "20", height: "40", lip: "5" };
const threadRef = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };

let renderer: ReactTestRenderer | null;
let links: ReturnType<typeof useParameterLinks>;
function Harness({ render }: { render: LinkRender }) {
  const result = useParameterLinks(render);
  useLayoutEffect(() => {
    links = result;
  });
  return null;
}
async function mount(render: LinkRender) {
  await act(async () => {
    renderer = create(<Harness render={render} />);
  });
}
beforeEach(() => {
  renderer = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("renders the part, then each parameter a step either side, and keeps the result", async () => {
  const render = vi.fn<LinkRender>(async (next) =>
    cuboid(Number(next.width), 30, Number(next.height)),
  );
  await mount(render);
  const key = linkKey("source-a", values);
  await act(() => links.run({ key, parameters, values, names: ["width", "height", "lip"] }));

  // The part on screen first, then width ± its step of 2, then height ± the default step of 1.
  expect(render.mock.calls.map(([next]) => [next.width, next.height])).toEqual([
    ["20", "40"],
    ["22", "40"],
    ["18", "40"],
    ["20", "41"],
    ["20", "39"],
  ]);
  expect(links.job).toBeNull();
  const linking = links.linkings.get(key)!;
  const [width, height, lip] = linking.parameters;
  if (width?.status !== "linked" || height?.status !== "linked") throw new Error("not linked");
  // Each moves one face of the box, one millimetre per unit.
  expect(width.rates.size).toBe(1);
  expect([...width.rates.values()][0]).toBeCloseTo(1, 5);
  expect(height.rates.size).toBe(1);
  expect([...height.rates.keys()]).not.toEqual([...width.rates.keys()]);
  expect(lip).toEqual({
    name: "lip",
    status: "failed",
    error: "Its range leaves no room for a step.",
  });
  // The key ignores value order.
  expect(linkKey("source-a", { lip: "5", height: "40", width: "20" })).toBe(key);
});

it("renders through the Python CAD path as its own job, and a cancel drops the partial result", async () => {
  const pending: ((value: unknown) => void)[] = [];
  let renders = 0;
  mocks.command.mockImplementation((command: string) =>
    command === "cancel"
      ? Promise.resolve()
      : command === "renderModel" && renders++ === 0
        ? Promise.resolve({
            status: "ok",
            mesh: { relativeUrl: "/m.stl" },
            meshFormat: "stl",
            log: [],
          })
        : new Promise((resolve) => pending.push(resolve)),
  );
  await mount(modelLinkRender(threadRef, "parts/box.b3d.py"));
  const key = linkKey("source-a", values);
  let finished: Promise<void> | undefined;
  await act(async () => {
    finished = links.run({ key, parameters, values, names: ["width"] });
  });
  expect(mocks.command).toHaveBeenNthCalledWith(1, "renderModel", {
    environmentId: "env",
    input: {
      file: { threadId: "thread", path: "parts/box.b3d.py" },
      overrides: values,
      parameterSet: null,
      variantId: LINK_VARIANT_ID,
    },
  });
  // The base render finished; the first nudge is still rendering.
  expect(links.job).toEqual({ done: 1, total: 3 });
  expect(mocks.command).toHaveBeenLastCalledWith(
    "renderModel",
    expect.objectContaining({
      input: expect.objectContaining({ overrides: { ...values, width: "22" } }),
    }),
  );
  await act(async () => links.cancel());
  expect(mocks.command).toHaveBeenLastCalledWith("cancel", {
    environmentId: "env",
    input: { file: { threadId: "thread", path: "parts/box.b3d.py" }, variantId: LINK_VARIANT_ID },
  });
  await act(async () => {
    pending[0]!({ status: "cancelled", log: [] });
    await finished;
  });
  expect(links.job).toBeNull();
  expect(links.error).toBeNull();
  expect(links.linkings.size).toBe(0);
});

it("keeps a failed analysis to the values it ran on", async () => {
  const render = vi.fn<LinkRender>(async () => {
    throw new Error("OpenSCAD stopped: syntax error");
  });
  await mount(render);
  const key = linkKey("source-a", values);
  await act(() => links.run({ key, parameters, values, names: ["width"] }));
  expect(links.errorFor(key)).toBe("OpenSCAD stopped: syntax error");
  // New values, or a new source revision, have not been analyzed and show no failure.
  expect(links.errorFor(linkKey("source-a", { ...values, width: "22" }))).toBeNull();
  expect(links.errorFor(linkKey("source-b", values))).toBeNull();
  expect(links.errorFor(null)).toBeNull();
});
