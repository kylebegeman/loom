// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { LayerSheet } from "./LayerSheet";
const mocks = vi.hoisted(() => ({ readSheet: vi.fn() }));
vi.mock("./state", () => ({ pcb: { readSheet: { resultAtom: mocks.readSheet } } }));
let host: HTMLDivElement, root: Root, registry: AtomRegistry.AtomRegistry;
const response = Atom.make<AsyncResult.AsyncResult<{ svg: string }, Error>>(
  AsyncResult.success({ svg: "<svg/>" }),
);
const props = {
  threadRef: { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") },
  renderKey: "render",
  sheetId: "F.Fab",
  revision: "one",
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  registry = AtomRegistry.make();
  mocks.readSheet.mockReturnValue(response);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:layer"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(async () => {
  await act(async () => root.unmount());
  registry.dispose();
  host.remove();
  vi.unstubAllGlobals();
});
async function render(opacity: number) {
  await act(async () =>
    root.render(
      <RegistryContext.Provider value={registry}>
        <LayerSheet {...props} opacity={opacity} />
      </RegistryContext.Provider>,
    ),
  );
}
it("reuses decoded drawings when a preset hides and restores a layer", async () => {
  await render(1);
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("load")));
  await render(0);
  expect(host.querySelector("img")!.getAttribute("aria-hidden")).toBe("true");
  await render(1);
  expect(host.querySelector("img")!.dataset.layerLoading).toBeUndefined();
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
});
it("shows errors only for visible layers in the applied preset", async () => {
  registry.set(response, AsyncResult.failure(Cause.fail(new Error("Layer missing"))));
  await render(0);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await render(1);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Layer missing");
});
