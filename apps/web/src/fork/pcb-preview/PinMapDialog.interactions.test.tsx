// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { PcbInspection } from "@t3tools/contracts/fork";
import { PinMapDialog } from "./PinMapDialog";
const mocks = vi.hoisted(() => ({ run: vi.fn(), allowed: true }));
// The React Compiler caches atom-family calls by argument, so a mocked atom is a reader that
// useAtomValue calls on every render, the way the real hook reads the atom's current value.
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) => (typeof atom === "function" ? atom() : atom),
}));
vi.mock("./state", () => ({ pcb: { pinMap: { permissionAtom: () => () => mocks.allowed } } }));
vi.mock("../model-preview-3d/state", () => ({ runModelCommand: mocks.run }));
vi.mock("~/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: vi.fn() }),
}));
const inspection: PcbInspection = {
  sourceHash: "hash",
  components: [
    {
      id: "U1",
      reference: "U1",
      value: "RP2040",
      footprint: "",
      pins: [{ number: "27", name: "GPIO25", net: "LED" }],
    },
  ],
  nets: [],
  layers: [],
  bounds: null,
  mountingHoles: [],
  thickness: 1.6,
  warnings: [],
};
const threadRef = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.allowed = true;
});
it("confirms replacement for the exact export and refuses invalid identifiers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  cleanup = async () => {
    await act(async () => root.unmount());
  };
  const render = (value = inspection) =>
    act(async () =>
      root.render(
        <PinMapDialog
          threadRef={threadRef}
          designId="board.kicad_pro"
          reference="U1"
          inspection={value}
          onClose={vi.fn()}
        />,
      ),
    );
  await render();
  const button = (label: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;
  mocks.run.mockRejectedValueOnce(
    new Error("A file already exists at this path. Confirm Replace to overwrite it."),
  );
  await act(async () => button("Save file").click());
  expect(button("Replace")).toBeTruthy();
  expect(mocks.run.mock.calls[0]?.[1].input.save.overwrite).toBe(false);
  // A newer inspection invalidates overwrite consent, even at the same destination.
  await render({ ...inspection, sourceHash: "new" });
  expect(button("Save file")).toBeTruthy();
  const constant = document.querySelector<HTMLInputElement>('[aria-label="Constant for pin 27"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      constant,
      "int",
    );
    constant.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(constant.getAttribute("aria-invalid")).toBe("true");
  expect(button("Save file").disabled).toBe(true);
  mocks.allowed = false;
  await render({ ...inspection, sourceHash: "new" });
  expect(document.body.textContent).toContain("This connection cannot write files.");
});
