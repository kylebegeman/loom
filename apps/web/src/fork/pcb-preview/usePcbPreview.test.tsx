import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import type { PcbCheckResult, PcbDesign, PcbRenderResult } from "@t3tools/contracts/fork";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import { usePcbPreview } from "./usePcbPreview";
const mocked = vi.hoisted(() => ({
  watch: vi.fn(),
  latestChecks: vi.fn(),
  render: { permissionAtom: vi.fn(), resultAtom: vi.fn() },
  readSheet: { resultAtom: vi.fn() },
  check: { permissionAtom: vi.fn(), resultAtom: vi.fn() },
}));
vi.mock("./state", () => ({ pcb: mocked }));
const ref = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };
const design: PcbDesign = {
  id: "board.kicad_pro",
  absolutePath: "/workspace/board.kicad_pro",
  name: "board",
  kind: "kicad",
  schematicPath: "board.kicad_sch",
  boardPath: "board.kicad_pcb",
  toolAvailable: true,
  toolStatus: { found: true },
};
const good: PcbRenderResult = {
  renderKey: "render",
  sourceHash: "one",
  sheets: [{ id: "board.svg", label: "Board", bytes: 10, tooLarge: false }],
  outcome: "ok",
  cached: false,
  renderedAt: "2026-10-07T12:00:00.000Z",
  log: "",
};
let registry: AtomRegistry.AtomRegistry, renderer: ReactTestRenderer | null;
let preview: ReturnType<typeof usePcbPreview>;
const watch = Atom.make<AsyncResult.AsyncResult<{ sourceHash: string }, Error>>(
  AsyncResult.success({ sourceHash: "one" }),
);
const render = Atom.make<AsyncResult.AsyncResult<PcbRenderResult, Error>>(AsyncResult.initial());
const check = Atom.make<AsyncResult.AsyncResult<PcbCheckResult, Error>>(AsyncResult.initial());
const sheet = Atom.make<AsyncResult.AsyncResult<{ svg: string }, Error>>(
  AsyncResult.success({ svg: "<svg/>" }),
);
const latest = Atom.make(AsyncResult.success<readonly PcbCheckResult[]>([]));
function Harness({
  trusted = true,
  circuit = false,
  visible = true,
}: {
  trusted?: boolean;
  circuit?: boolean;
  visible?: boolean;
}) {
  const result = usePcbPreview(
    ref,
    circuit ? { ...design, kind: "tscircuit" } : design,
    "schematic",
    "front",
    trusted,
    undefined,
    visible,
  );
  useLayoutEffect(() => {
    preview = result;
  });
  return null;
}
async function mount(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => {
    const node = (
      <RegistryContext.Provider value={registry}>
        <Harness {...props} />
      </RegistryContext.Provider>
    );
    if (renderer) renderer.update(node);
    else renderer = create(node);
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  registry = AtomRegistry.make();
  renderer = null;
  const permitted = Atom.make(true);
  mocked.watch.mockReturnValue(watch);
  mocked.render.permissionAtom.mockReturnValue(permitted);
  mocked.check.permissionAtom.mockReturnValue(permitted);
  mocked.render.resultAtom.mockReturnValue(render);
  mocked.check.resultAtom.mockReturnValue(check);
  mocked.readSheet.resultAtom.mockReturnValue(sheet);
  mocked.latestChecks.mockReturnValue(latest);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  registry.dispose();
  vi.unstubAllGlobals();
});
it("retains the drawing during a failed rebuild and requests a distinct manual retry", async () => {
  await mount();
  await act(async () => registry.set(render, AsyncResult.success(good)));
  expect(preview.display?.svg).toBe("<svg/>");
  const firstKey = preview.requestKey;
  await act(async () => {
    registry.set(watch, AsyncResult.success({ sourceHash: "two" }));
    registry.set(render, AsyncResult.failure(Cause.fail(new Error("Export failed"))));
  });
  expect(preview.error).toBe("Export failed");
  expect(preview.display?.renderKey).toBe("render");
  await act(async () => preview.refresh());
  expect(preview.requestKey).not.toBe(firstKey);
  expect(mocked.render.resultAtom.mock.lastCall?.[0].input.force).toBe(true);
  await act(async () => {
    registry.set(render, AsyncResult.success({ ...good }));
    registry.set(sheet, AsyncResult.success({ svg: "<svg><updated/></svg>" }));
  });
  expect(preview.display?.svg).toBe("<svg><updated/></svg>");
  await act(async () => registry.set(watch, AsyncResult.success({ sourceHash: "three" })));
  expect(mocked.render.resultAtom.mock.lastCall?.[0].input.force).toBe(false);
});
it("renders without a live revision and preserves check errors after the job finishes", async () => {
  registry.set(watch, AsyncResult.failure(Cause.fail(new Error("Watch failed"))));
  await mount();
  expect(preview.rendering).toBe(true);
  expect(preview.watchError).toBe("Watch failed");
  await act(async () => preview.runCheck("erc"));
  await act(async () =>
    registry.set(check, AsyncResult.failure(Cause.fail(new Error("Check unavailable")))),
  );
  expect(preview.checking).toBeNull();
  expect(preview.checkError).toBe("Check unavailable");
  await act(async () => preview.cancelCheck());
  expect(preview.checkError).toBeNull();
});
it("does not run circuit code before trust and stops requesting it on revocation", async () => {
  await mount({ trusted: false, circuit: true });
  expect(mocked.render.resultAtom).not.toHaveBeenCalled();
  expect(mocked.latestChecks).not.toHaveBeenCalled();
  await mount({ trusted: true, circuit: true });
  expect(mocked.render.resultAtom).toHaveBeenCalled();
  mocked.render.resultAtom.mockClear();
  await mount({ trusted: false, circuit: true });
  expect(mocked.render.resultAtom).not.toHaveBeenCalled();
  expect(preview.rendering).toBe(false);
});
it("pauses a cancelled request until a source change or explicit refresh", async () => {
  await mount();
  await act(async () => preview.cancelRender());
  expect(preview.cancelled).toBe(true);
  expect(preview.rendering).toBe(false);
  await act(async () => registry.set(watch, AsyncResult.success({ sourceHash: "two" })));
  expect(preview.cancelled).toBe(false);
  expect(preview.rendering).toBe(true);
});

it("pauses 2D rendering and sheet reads while keeping source updates and the last drawing", async () => {
  await mount();
  await act(async () => registry.set(render, AsyncResult.success(good)));
  expect(preview.display?.svg).toBe("<svg/>");
  mocked.render.resultAtom.mockClear();
  mocked.readSheet.resultAtom.mockClear();
  await mount({ visible: false });
  await act(async () => registry.set(watch, AsyncResult.success({ sourceHash: "two" })));
  expect(mocked.render.resultAtom).not.toHaveBeenCalled();
  expect(mocked.readSheet.resultAtom).not.toHaveBeenCalled();
  expect(preview.sourceHash).toBe("two");
  expect(preview.display?.svg).toBe("<svg/>");
  await mount({ visible: true });
  expect(mocked.render.resultAtom.mock.lastCall?.[0].input.revision).toContain("two");
});

it("keeps capture metadata tied to decoded bytes while a new sheet read is refreshing", async () => {
  await mount();
  await act(async () => registry.set(render, AsyncResult.success(good)));
  const displayed = preview.display;
  await act(async () => {
    registry.set(watch, AsyncResult.success({ sourceHash: "two" }));
    registry.set(sheet, AsyncResult.waiting(AsyncResult.success({ svg: "<svg/>" })));
    registry.set(render, AsyncResult.success({ ...good, renderKey: "second", sourceHash: "two" }));
  });
  expect(preview.display).toBe(displayed);
  expect(preview.loadingSheet).toBe(true);
  await act(async () => registry.set(sheet, AsyncResult.success({ svg: "<svg><new/></svg>" })));
  expect(preview.display?.renderKey).toBe("second");
  expect(preview.display?.sourceHash).toBe("two");
});
