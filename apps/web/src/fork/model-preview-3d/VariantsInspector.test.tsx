// @vitest-environment jsdom
import { act, createElement, useState, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  DEFAULT_MODEL_PREVIEW_SETTINGS,
  EMPTY_MODEL_WORKSPACE,
  type ModelWorkspace,
  type ModelWorkspaceOperation,
  type ScadParameter,
} from "@t3tools/contracts/fork";
import type { ScadSession } from "./ScadCustomizer";
import type { Plate } from "./buildPlate";

type Props = { children?: ReactNode } & Record<string, unknown>;
const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  promote: vi.fn(),
  operations: [] as unknown[],
  renders: [] as { resolve: (value: unknown) => void }[],
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => false }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("./state", () => ({
  models: { slice: { permissionAtom: () => ({}) }, render: "render", cancelVariant: "cancel" },
  runModelCommand: mocks.command,
  modelUrl: (_: string, url: string) => url,
}));
vi.mock("./printers", () => ({ usePrinterLibrary: () => null }));
vi.mock("./useSlicing", () => ({ startSliceRequest: vi.fn() }));
vi.mock("./units", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./units")>()),
  useDisplayUnits: () => "mm",
  useDisplayPrecision: () => "auto",
}));
vi.mock("./viewer/createViewer", () => ({
  createViewer: () => ({
    setVisible: () => undefined,
    setOrientation: () => undefined,
    setBed: () => undefined,
    setModel: () => ({ size: [40, 30.25, 10], triangles: 12 }),
    capture: async () => null,
    dispose: () => undefined,
  }),
}));
vi.mock("./viewer/load", () => ({ loadModel: async () => ({}), disposeModel: () => undefined }));
vi.mock("./viewer/captureSheet", () => ({ thumbnail: async () => "data:image/png;base64,AA" }));
// Plain stand-ins for the UI kit, so the test drives the inspector's own logic.
const { pass } = vi.hoisted(() => ({ pass: ({ children }: Props) => children ?? null }));
vi.mock("~/components/ui/button", async () => {
  const { createElement } = await import("react");
  return {
    Button: ({ children, variant: _v, size: _s, render: _r, ...props }: Props) =>
      createElement("button", { type: "button", ...props }, children),
  };
});
vi.mock("~/components/ui/input", async () => {
  const { createElement } = await import("react");
  return { Input: ({ size: _s, ...props }: Props) => createElement("input", props) };
});
vi.mock("~/components/ui/checkbox", () => ({ Checkbox: () => null }));
vi.mock("~/components/ui/dialog", () => ({
  Dialog: ({ open, children }: Props) => (open ? children : null),
  DialogDescription: pass,
  DialogFooter: pass,
  DialogHeader: pass,
  DialogPanel: pass,
  DialogPopup: pass,
  DialogTitle: pass,
}));
vi.mock("~/components/ui/menu", async () => {
  const { createElement } = await import("react");
  return {
    Menu: pass,
    MenuGroup: pass,
    MenuGroupLabel: pass,
    MenuPopup: pass,
    MenuShortcut: pass,
    MenuTrigger: pass,
    MenuSeparator: () => null,
    MenuItem: ({ children, onClick, disabled }: Props) =>
      createElement("button", { type: "button", onClick, disabled }, children),
  };
});
vi.mock("~/components/ui/select", () => ({
  Select: (props: Props) => pass(props),
  SelectItem: () => null,
  SelectPopup: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock("./controls", () => ({
  Chip: pass,
  CopyValue: pass,
  EmptyNote: pass,
  ParameterRow: () => null,
  RenameInput: () => null,
  SectionHead: pass,
  Tip: pass,
  TitleInput: () => null,
}));
import { Select } from "~/components/ui/select";
import { VariantsInspector } from "./VariantsInspector";

const parameter = (name: string, min: number, max: number): ScadParameter => ({
  name,
  group: "",
  description: null,
  kind: "number",
  defaultValue: "1",
  range: { min, max, step: null },
  options: null,
});
const session = {
  data: {
    sourceRevision: "source-a",
    parameters: [parameter("width", 20, 200), parameter("wall", 1, 5)],
    sets: [],
    setValues: {},
    lastUsed: {},
    lastUsedSet: null,
  },
  values: { width: "60", wall: "2" },
  promote: mocks.promote,
} as unknown as ScadSession;
const plate: Plate = { volume: [256, 256, 256], pattern: "grid-mm", zones: [], showZones: false };
let renderer: ReactTestRenderer | undefined;

function apply(state: ModelWorkspace, operation: ModelWorkspaceOperation): ModelWorkspace {
  if (operation.kind === "remove")
    return { ...state, variants: state.variants.filter((item) => item.id !== operation.id) };
  if (operation.kind !== "variant") return state;
  const { item } = operation;
  return {
    ...state,
    variants: state.variants.some((v) => v.id === item.id)
      ? state.variants.map((v) => (v.id === item.id ? item : v))
      : [...state.variants, item],
  };
}
function Harness({ refuse }: { refuse?: (operation: ModelWorkspaceOperation) => boolean }) {
  const [data, setData] = useState(EMPTY_MODEL_WORKSPACE);
  return createElement(VariantsInspector, {
    data,
    session,
    plate,
    path: "box.scad",
    threadRef: { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") },
    settings: DEFAULT_MODEL_PREVIEW_SETTINGS,
    onActivity: () => undefined,
    mutate: async (operation: ModelWorkspaceOperation) => {
      mocks.operations.push(operation);
      if (refuse?.(operation)) return false;
      setData((current) => apply(current, operation));
      return true;
    },
  });
}
const root = () => renderer!.root;
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
const button = (label: string) =>
  root().find(
    (node) =>
      node.type === "button" && (node.props["aria-label"] === label || text(node) === label),
  );
const alert = () => root().findAll((node) => node.props.role === "alert" && node.type === "p");
const type = (label: string, value: string) =>
  act(() =>
    root()
      .find((node) => node.type === "input" && node.props["aria-label"] === label)
      .props.onChange({ target: { value } }),
  );
const submit = () =>
  act(async () =>
    root()
      .findByType("form")
      .props.onSubmit({ preventDefault: () => undefined }),
  );

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  mocks.operations.length = 0;
  mocks.renders.length = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("sweeps two parameters with inline limits, then keeps one and discards the rest", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.command.mockImplementation((command: string) =>
    command === "render"
      ? new Promise((resolve) => mocks.renders.push({ resolve }))
      : Promise.resolve(),
  );
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  await act(async () => button("Parameter sweepUp to 6").props.onClick());
  await type("Sweep values", "40 60 80");
  await act(() => root().findAllByType(Select)[1]!.props.onValueChange("wall"));
  await type("Second sweep values", "2, 3; 4");
  // Errors wait for the first attempt, then follow each edit.
  expect(alert()).toHaveLength(0);
  await submit();
  expect(text(alert()[0]!)).toBe("That makes 9 variants; explore up to 6 at once.");
  await type("Sweep values", "40 250");
  expect(text(alert()[0]!)).toBe("width 250 is outside 20 to 200.");
  await type("Sweep values", "40, 60");
  expect(alert()).toHaveLength(0);
  expect(text(button("Make 6 variants"))).toBe("Make 6 variants");
  await submit();
  const added = mocks.operations.flatMap((operation) =>
    (operation as ModelWorkspaceOperation).kind === "variant"
      ? [(operation as { item: { name: string; values: unknown } }).item]
      : [],
  );
  expect(added.map((item) => item.name)).toEqual([
    "width 40 · wall 2",
    "width 40 · wall 3",
    "width 40 · wall 4",
    "width 60 · wall 2",
    "width 60 · wall 3",
    "width 60 · wall 4",
  ]);
  expect(added[4]!.values).toEqual({ width: "60", wall: "3" });
  expect(root().findAllByType("form")).toHaveLength(0);

  // One render at a time: finish the first, then stop the batch.
  const done = { status: "ok", mesh: { relativeUrl: "/m.stl" }, meshFormat: "stl", log: [] };
  await act(async () => mocks.renders[0]!.resolve(done));
  await act(async () => undefined);
  expect(mocks.renders).toHaveLength(2);
  await act(async () => button("Stop").props.onClick());
  expect(mocks.command).toHaveBeenCalledWith("cancel", expect.anything());
  expect(button("Keep width 40 · wall 2").props.disabled).toBe(false);
  expect(button("Keep width 40 · wall 3").props.disabled).toBe(true);
  expect(text(root())).toContain("40 × 30.3 × 10 mm");

  await act(async () => button("Keep width 40 · wall 2").props.onClick({ stopPropagation() {} }));
  expect(mocks.promote).toHaveBeenCalledWith({ width: "40", wall: "2" }, "width 40 · wall 2");
  expect(text(root())).toContain("Sweep of 5 variants");
  await act(async () => button("Discard all").props.onClick());
  const removed = mocks.operations.filter(
    (operation) => (operation as ModelWorkspaceOperation).kind === "remove",
  );
  expect(removed).toHaveLength(5);
  // The kept variant stays as a saved card; the sweep bar is gone.
  expect(root().findAll((node) => node.props["aria-label"] === "width 40 · wall 2")).not.toEqual(
    [],
  );
  expect(text(root())).not.toContain("Discard all");
});

it("stops a render batch when a thumbnail save is refused, after releasing the hidden viewer", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.command.mockImplementation((command: string) =>
    command === "render"
      ? new Promise((resolve) => mocks.renders.push({ resolve }))
      : Promise.resolve(),
  );
  await act(async () => {
    renderer = create(
      createElement(Harness, {
        refuse: (operation) => operation.kind === "variant" && operation.item.thumbnail !== null,
      }),
    );
  });
  await act(async () => button("Parameter sweepUp to 6").props.onClick());
  await type("Sweep values", "40, 60");
  await submit();
  expect(mocks.renders).toHaveLength(1);

  const done = { status: "ok", mesh: { relativeUrl: "/m.stl" }, meshFormat: "stl", log: [] };
  await act(async () => mocks.renders[0]!.resolve(done));
  await act(async () => undefined);
  // The refused save ends the batch: the second variant never renders and nothing is left running.
  expect(mocks.renders).toHaveLength(1);
  expect(document.body.childElementCount).toBe(0);
  expect(root().findAll((node) => node.type === "button" && text(node) === "Stop")).toEqual([]);
  expect(alert()).toHaveLength(0);
});
