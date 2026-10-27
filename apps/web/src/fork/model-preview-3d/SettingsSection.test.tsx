import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";
import { DEFAULT_MODEL_PREVIEW_SETTINGS, type ModelPreviewSettings } from "@t3tools/contracts/fork";

const state = vi.hoisted(() => ({
  settings: null as ModelPreviewSettings | null,
  save: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) =>
    atom === "settings"
      ? AsyncResult.success(state.settings)
      : atom === "status"
        ? AsyncResult.initial()
        : true,
}));
vi.mock("@t3tools/client-runtime/fork", () => ({ loomFeaturesOf: () => ["model-preview-3d"] }));
vi.mock("~/components/settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({ environment: { environmentId: "model-env" } }),
}));
vi.mock("~/state/entities", () => ({ useServerConfigs: () => new Map() }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: state.refresh } }));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/input", () => ({ Input: "input" }));
vi.mock("~/components/ui/switch", () => ({ Switch: "button" }));
vi.mock("~/fork/settings/PathField", () => ({ PathField: "path-field" }));
vi.mock("~/components/ui/select", () => ({
  Select: "div",
  SelectGroup: "div",
  SelectGroupLabel: "div",
  SelectItem: "div",
  SelectPopup: "div",
  SelectTrigger: "div",
  SelectValue: "div",
}));
vi.mock("~/components/settings/settingsLayout", () => ({
  SettingsRow: ({
    children,
    control,
  }: {
    children?: React.ReactNode;
    control?: React.ReactNode;
  }) => (
    <div>
      {children}
      {control}
    </div>
  ),
}));
vi.mock("./printers", () => ({ usePrinterLibrary: () => null }));
vi.mock("./ManageBeds", () => ({ ManageBeds: () => null }));
vi.mock("./PrintersSection", () => ({ PrintersSection: () => null }));
vi.mock("./PythonCadSettings", () => ({ PythonCadSettings: () => null }));
vi.mock("./SlicingSettings", () => ({ SlicingSettings: () => null }));
vi.mock("./state", () => ({
  models: {
    settings: () => "settings",
    status: () => "status",
    updateSettings: { permissionAtom: () => "permission" },
    pythonSetup: { permissionAtom: () => "permission" },
  },
  runModelCommand: state.save,
}));

import { ModelPreviewSettingsSection } from "./SettingsSection";
let renderer: ReactTestRenderer;
const input = (label: string) => renderer.root.findByProps({ "aria-label": label });
const button = (text: string) =>
  renderer.root.findAllByType("button").find((node) => node.props.children === text)!;
async function edit(label: string, value: string) {
  await act(async () => input(label).props.onChange({ target: { value } }));
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  state.settings = DEFAULT_MODEL_PREVIEW_SETTINGS;
  state.save.mockImplementation(
    async (_command: unknown, request: { input: ModelPreviewSettings }) => request.input,
  );
  await act(async () => {
    renderer = create(<ModelPreviewSettingsSection />);
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("preserves empty numeric drafts, prevents invalid saves and restores values on discard", async () => {
  expect(button("Save settings").props.disabled).toBe(true);
  await edit("Nozzle diameter (mm)", "");
  expect(input("Nozzle diameter (mm)").props.value).toBe("");
  expect(button("Save settings").props.disabled).toBe(true);
  await edit("Nozzle diameter (mm)", "0.6");
  expect(button("Save settings").props.disabled).toBe(false);
  await act(async () => button("Discard changes").props.onClick());
  expect(input("Nozzle diameter (mm)").props.value).toBe("0.4");
  expect(button("Save settings").props.disabled).toBe(true);
  expect(state.save).not.toHaveBeenCalled();
});

it("keeps drafts when another settings snapshot arrives and uses refreshed values for untouched fields", async () => {
  await edit("Nozzle diameter (mm)", "0.6");
  state.settings = { ...DEFAULT_MODEL_PREVIEW_SETTINGS, renderTimeoutSeconds: 180 };
  await act(async () => renderer.update(<ModelPreviewSettingsSection />));
  expect(input("Nozzle diameter (mm)").props.value).toBe("0.6");
  expect(input("Render timeout").props.value).toBe("180");
  await act(async () => button("Save settings").props.onClick());
  expect(state.save).toHaveBeenLastCalledWith(expect.anything(), {
    environmentId: "model-env",
    input: expect.objectContaining({ nozzleDiameterMm: 0.6, renderTimeoutSeconds: 180 }),
  });
  expect(button("Save settings").props.disabled).toBe(true);
  state.settings = { ...state.settings, nozzleDiameterMm: 0.6 };
  await act(async () => renderer.update(<ModelPreviewSettingsSection />));
  expect(JSON.stringify(renderer.toJSON())).toContain("Settings saved.");
});

it("retains failed saves for retry and clears the failure when editing resumes", async () => {
  state.save.mockRejectedValueOnce(new Error("Model host disconnected"));
  await edit("Nozzle diameter (mm)", "0.6");
  await act(async () => button("Save settings").props.onClick());
  expect(input("Nozzle diameter (mm)").props.value).toBe("0.6");
  expect(state.refresh).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain("Model host disconnected");
  await edit("Nozzle diameter (mm)", "0.5");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Model host disconnected");
  await act(async () => button("Save settings").props.onClick());
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(button("Save settings").props.disabled).toBe(true);
});

it("saves a chosen OpenSCAD executable and returns to automatic detection once it is cleared", async () => {
  const openscad = () => renderer.root.findByProps({ label: "OpenSCAD executable" });
  await act(async () => openscad().props.onChange("/opt/openscad/bin/openscad"));
  await act(async () => button("Save settings").props.onClick());
  expect(state.save).toHaveBeenLastCalledWith(expect.anything(), {
    environmentId: "model-env",
    input: expect.objectContaining({ openscadPath: "/opt/openscad/bin/openscad" }),
  });
  await act(async () => openscad().props.onChange(""));
  expect(openscad().props.value).toBe("");
  await act(async () => button("Save settings").props.onClick());
  expect(state.save).toHaveBeenLastCalledWith(expect.anything(), {
    environmentId: "model-env",
    input: expect.objectContaining({ openscadPath: null }),
  });
});
