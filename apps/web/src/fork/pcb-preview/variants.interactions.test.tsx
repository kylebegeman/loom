// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { PcbWorkspace, type PcbRenderVariantResult } from "@t3tools/contracts/fork";
import { VariantWorkbench } from "./VariantWorkbench";
import { ParameterEditor } from "./ParameterEditor";
import { VariantCompare } from "./VariantCompare";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  thumbnail: vi.fn(),
  permission: true,
  refresh: vi.fn(),
}));
const schema = {
  sourceHash: "source-text",
  schemaPath: "board.parameters.json",
  source: "const width = 20;",
  parameters: [
    { key: "width", label: "Width", type: "number" as const, default: 20, description: "" },
  ],
  values: { width: 20 },
};
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) => (atom === "permission" ? mocks.permission : schema),
}));
vi.mock("./state", () => ({
  pcb: {
    renderVariant: { permissionAtom: () => "permission" },
    cancelVariant: "cancel",
    readSheet: "read",
    applyParameters: "apply",
    parameters: () => "parameters",
  },
}));
vi.mock("./usePcbPreview", () => ({
  asyncValue: (value: unknown) => value,
  asyncError: () => "error",
}));
vi.mock("../model-preview-3d/state", () => ({
  runModelCommand: (...args: unknown[]) => mocks.run(...args),
}));
vi.mock("./variantImages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./variantImages")>()),
  svgThumbnail: (svg: string) => mocks.thumbnail(svg),
}));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: mocks.refresh } }));
vi.mock("./preferences", () => ({ useLengthUnit: () => "mm" }));

let root: Root, host: HTMLDivElement;
const decodeWorkspace = Schema.decodeSync(PcbWorkspace);
const data = () =>
  decodeWorkspace({
    version: 1,
    variants: [
      { id: "a", name: "Wide", values: { width: 40 }, sourceHash: "source-text" },
      { id: "b", name: "Narrow", values: { width: 10 }, sourceHash: "source-text" },
    ],
  });
const rendered: PcbRenderVariantResult = {
  variantId: "a",
  outcome: "ok",
  renderKey: "candidate",
  sourceHash: "display-revision",
  sheet: { id: "1.svg", label: "Board", bytes: 1, tooLarge: false },
  stats: null,
  log: "",
  cached: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const props = (): ComponentProps<typeof VariantWorkbench> => ({
  threadRef: {
    environmentId: EnvironmentId.make("variants-env"),
    threadId: ThreadId.make("variants-thread"),
  },
  designId: "board.tsx",
  schema,
  data: data(),
  currentValues: { width: 20 },
  sourceHash: "display-revision",
  executionAllowed: true,
  canSave: true,
  mutate: vi.fn(async () => undefined),
  onUse: vi.fn(),
});
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.run.mockReset();
  mocks.thumbnail.mockReset();
  mocks.permission = true;
  schema.sourceHash = "source-text";
  mocks.thumbnail.mockResolvedValue("data:image/png;base64,AA");
  mocks.run.mockImplementation(async (command: unknown) =>
    command === "read" ? { svg: '<svg viewBox="0 0 20 10"/>' } : rendered,
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each(["trust", "terminal", "write"])(
  "refuses a queued render without %s authorization",
  async (gate) => {
    const p = props();
    if (gate === "trust") p.executionAllowed = false;
    if (gate === "terminal") mocks.permission = false;
    if (gate === "write") p.canSave = false;
    await act(async () =>
      root.render(<VariantWorkbench {...p} request={{ id: "request", action: "render" }} />),
    );
    expect(button("Render all").disabled).toBe(true);
    expect(host.textContent).toContain("Allow circuit code and workspace/terminal permissions");
    expect(mocks.run).not.toHaveBeenCalled();
  },
);
it("cancels the host and discards a late thumbnail without starting another candidate", async () => {
  const image = deferred<string>(),
    p = props();
  mocks.thumbnail.mockReturnValue(image.promise);
  await act(async () => root.render(<VariantWorkbench {...p} />));
  await act(async () => button("Render all").click());
  expect(host.textContent).toContain("Rendering 1 of 2");
  await act(async () => button("Cancel").click());
  expect(mocks.run).toHaveBeenCalledWith(
    "cancel",
    expect.objectContaining({ input: expect.objectContaining({ variantId: "a" }) }),
  );
  await act(async () => image.resolve("data:image/png;base64,AA"));
  expect(p.mutate).not.toHaveBeenCalled();
  expect(
    mocks.run.mock.calls.filter(([command]) => command !== "read" && command !== "cancel"),
  ).toHaveLength(1);
});
it("cancels an in-flight build on unmount and ignores its result", async () => {
  const job = deferred<PcbRenderVariantResult>(),
    p = props();
  mocks.run.mockReturnValueOnce(job.promise);
  await act(async () => root.render(<VariantWorkbench {...p} />));
  await act(async () => button("Render all").click());
  await act(async () => root.unmount());
  expect(mocks.run).toHaveBeenCalledWith("cancel", expect.anything());
  await act(async () => job.resolve(rendered));
  expect(mocks.thumbnail).not.toHaveBeenCalled();
  expect(p.mutate).not.toHaveBeenCalled();
  root = createRoot(host);
});
it("promotes the chosen values into review, then applies with the same source hash", async () => {
  mocks.run.mockResolvedValue({
    previous: "const width = 20;",
    source: "const width = 40;",
    sourceHash: "source-text",
    applied: false,
  });
  await act(async () => root.render(<ParameterEditor {...props()} />));
  const wide = [...host.querySelectorAll("article")].find((card) =>
    card.textContent?.includes("Wide"),
  )!;
  await act(async () =>
    [...wide.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === "Use these values")!
      .click(),
  );
  expect(mocks.run).toHaveBeenCalledWith(
    "apply",
    expect.objectContaining({
      input: expect.objectContaining({
        values: { width: 40 },
        preview: true,
        expectedSourceHash: "source-text",
      }),
    }),
  );
  expect(host.querySelector('[aria-label="Source change"]')?.textContent).toContain(
    "const width = 40;",
  );
  schema.sourceHash = "updated-source";
  await act(async () => root.render(<ParameterEditor {...props()} />));
  await act(async () => button("Apply to source").click());
  expect(mocks.run).toHaveBeenLastCalledWith(
    "apply",
    expect.objectContaining({
      input: expect.objectContaining({
        values: { width: 40 },
        preview: false,
        expectedSourceHash: "source-text",
      }),
    }),
  );
});
it("does not load the second comparison drawing after the dialog unmounts", async () => {
  const drawing = deferred<string>(),
    load = vi.fn().mockReturnValue(drawing.promise),
    variants = data().variants;
  await act(async () =>
    root.render(
      <VariantCompare variants={[variants[0]!, variants[1]!]} load={load} close={vi.fn()} />,
    ),
  );
  await act(async () => root.unmount());
  await act(async () => drawing.resolve('<svg viewBox="0 0 20 10"/>'));
  expect(load).toHaveBeenCalledTimes(1);
  root = createRoot(host);
});

it("cancels on a source revision change and does not save the old result", async () => {
  const job = deferred<PcbRenderVariantResult>(),
    p = props();
  mocks.run.mockReturnValueOnce(job.promise);
  await act(async () => root.render(<VariantWorkbench {...p} />));
  await act(async () => button("Render all").click());
  await act(async () => root.render(<VariantWorkbench {...p} sourceHash="new-revision" />));
  expect(host.textContent).toContain("source or permissions changed");
  expect(mocks.run).toHaveBeenCalledWith("cancel", expect.anything());
  await act(async () => job.resolve(rendered));
  expect(p.mutate).not.toHaveBeenCalled();
});
it("consumes an agent request once and does not resurrect a deleted or edited candidate", async () => {
  const image = deferred<string>(),
    p = props();
  let current = p.data;
  p.mutate = vi.fn(async (change) => {
    current = change(current);
  });
  mocks.thumbnail.mockReturnValueOnce(image.promise);
  const request = { id: "agent-request", action: "render" as const };
  const consumed = vi.fn();
  await act(async () =>
    root.render(<VariantWorkbench {...p} request={request} onRequestConsumed={consumed} />),
  );
  current = {
    ...current,
    variants: current.variants
      .filter((v) => v.id !== "a")
      .map((v) => ({ ...v, values: { width: 15 } })),
  };
  await act(async () =>
    root.render(
      <VariantWorkbench
        {...p}
        data={current}
        request={{ ...request }}
        onRequestConsumed={consumed}
      />,
    ),
  );
  await act(async () => image.resolve("data:image/png;base64,AA"));
  expect(consumed).toHaveBeenCalledTimes(1);
  expect(mocks.thumbnail).toHaveBeenCalledTimes(2);
  expect(current.variants).toHaveLength(1);
  expect(current.variants[0]).toMatchObject({
    id: "b",
    values: { width: 15 },
    thumbnail: null,
    stats: null,
  });
});

it("makes a sweep and immediately renders its new candidates without waiting for a workspace rerender", async () => {
  const p = props();
  let current = p.data;
  p.mutate = vi.fn(async (change) => {
    current = change(current);
  });
  await act(async () => root.render(<VariantWorkbench {...p} />));
  await act(async () => button("Sweep").click());
  const make = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Make 3 variants",
  )!;
  await act(async () => make.click());
  expect(current.variants).toHaveLength(5);
  expect(
    current.variants
      .slice(2)
      .every((v) => v.thumbnail && v.renderedRevision === "display-revision"),
  ).toBe(true);
  expect(mocks.thumbnail).toHaveBeenCalledTimes(3);
});
