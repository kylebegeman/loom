import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";
import type { ProjectLifecycleSettings } from "@t3tools/contracts/fork";

const state = vi.hoisted(() => ({
  environmentId: "storage-env",
  settings: {
    enabled: false,
    lanesRoot: "/isolated/lanes",
    defaultCapGb: 40,
    appleCapGb: 100,
    reserveGb: 40,
    projectCapsGb: {},
    buildSlots: null,
  } as ProjectLifecycleSettings,
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
vi.mock("@t3tools/client-runtime/fork", () => ({
  loomFeaturesOf: () => ["project-lifecycle"],
}));
vi.mock("~/components/settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({ environment: { environmentId: state.environmentId } }),
}));
vi.mock("~/state/entities", () => ({ useServerConfigs: () => new Map() }));
vi.mock("~/localApi", () => ({ ensureLocalApi: vi.fn() }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: state.refresh } }));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/input", () => ({ Input: "input" }));
vi.mock("~/components/ui/switch", () => ({ Switch: "button" }));
vi.mock("~/fork/settings/PathField", () => ({ PathField: "path-field" }));
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
vi.mock("./state", () => ({
  FEATURE: "project-lifecycle",
  lanes: {
    settings: () => "settings",
    status: () => "status",
    updateSettings: { permissionAtom: () => "permission" },
  },
  runLaneCommand: state.save,
  formatGb: String,
}));

import { ProjectLifecycleSettingsSection } from "./SettingsSection";

let renderer: ReactTestRenderer | undefined;
async function render() {
  await act(async () => {
    if (renderer) renderer.update(<ProjectLifecycleSettingsSection />);
    else renderer = create(<ProjectLifecycleSettingsSection />);
  });
}
function notices() {
  return renderer!.root.findAllByProps({ role: "status" }).map((node) => node.props.children);
}
async function saveCap(value: number) {
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Lane cap" })
      .props.onChange({ target: { value: String(value) } });
  });
  await act(async () => {
    renderer!.root
      .findAllByType("button")
      .find((node) => node.props.children === "Save settings")!
      .props.onClick();
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  state.environmentId = "storage-env";
  state.settings = { ...state.settings, defaultCapGb: 40 };
  state.save.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("keeps the save confirmation after refreshed settings arrive and clears it on a computer change", async () => {
  await render();
  await saveCap(41);
  expect(state.save).toHaveBeenCalledWith(expect.anything(), {
    environmentId: "storage-env",
    input: { ...state.settings, defaultCapGb: 41 },
  });
  expect(state.refresh).toHaveBeenCalledOnce();
  state.settings = { ...state.settings, defaultCapGb: 41 };
  await render();
  expect(notices()).toContain("Settings saved.");
  expect(renderer!.root.findByProps({ "aria-label": "Lane cap" }).props.value).toBe("41");
  state.environmentId = "another-computer";
  await render();
  expect(notices()).not.toContain("Settings saved.");
});

it("keeps the draft and displays a failed save so it can be retried", async () => {
  state.save.mockRejectedValueOnce(new Error("Computer disconnected"));
  await render();
  await saveCap(41);
  expect(state.refresh).not.toHaveBeenCalled();
  expect(
    renderer!.root.findAllByProps({ role: "alert" }).map((node) => node.props.children),
  ).toContain("Computer disconnected");
  expect(renderer!.root.findByProps({ "aria-label": "Lane cap" }).props.value).toBe("41");
  await saveCap(41);
  expect(notices()).toContain("Settings saved.");
});

it("keeps an empty numeric draft visible and prevents saving it", async () => {
  await render();
  const saveButton = () =>
    renderer!.root.findAllByType("button").find((node) => node.props.children === "Save settings")!;
  expect(saveButton().props.disabled).toBe(true);
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Lane cap" })
      .props.onChange({ target: { value: "" } });
  });
  expect(renderer!.root.findByProps({ "aria-label": "Lane cap" }).props.value).toBe("");
  expect(saveButton().props.disabled).toBe(true);
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Lane cap" })
      .props.onChange({ target: { value: "42" } });
  });
  expect(saveButton().props.disabled).toBe(false);
});

it("disables saving after a draft is restored to its original values", async () => {
  await render();
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Lane cap" })
      .props.onChange({ target: { value: "42" } });
  });
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Lane cap" })
      .props.onChange({ target: { value: "40" } });
  });
  const button = renderer!.root
    .findAllByType("button")
    .find((node) => node.props.children === "Save settings")!;
  expect(button.props.disabled).toBe(true);
  expect(state.save).not.toHaveBeenCalled();
});
