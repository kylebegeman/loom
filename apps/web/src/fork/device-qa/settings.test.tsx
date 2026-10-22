import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";

const state = vi.hoisted(() => ({
  settings: {
    argentPath: null,
    keepRunsPerProject: 20,
    evidenceExpireDays: 30,
    defaultCleanStatusBar: true,
  },
  save: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) =>
    atom === "settings" ? AsyncResult.success(state.settings) : true,
}));
vi.mock("@t3tools/client-runtime/fork", () => ({ loomFeaturesOf: () => ["device-qa"] }));
vi.mock("~/components/settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({ environment: { environmentId: "qa-env" } }),
}));
vi.mock("~/state/entities", () => ({ useServerConfigs: () => new Map() }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: state.refresh } }));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/input", () => ({ Input: "input" }));
vi.mock("~/components/ui/switch", () => ({ Switch: "button" }));
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
  FEATURE: "device-qa",
  deviceQa: { settings: () => "settings", updateSettings: { permissionAtom: () => "permission" } },
  runCommand: state.save,
  errorText: (error: unknown) => String(error),
}));

import { DeviceQaSettingsSection } from "./settings";

let renderer: ReactTestRenderer;
const input = (label: string) => renderer.root.findByProps({ "aria-label": label });
async function edit(label: string, value: string) {
  await act(async () => input(label).props.onChange({ target: { value } }));
}
async function blur(label: string) {
  await act(async () => input(label).props.onBlur());
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  state.save.mockResolvedValue(undefined);
  await act(async () => {
    renderer = create(<DeviceQaSettingsSection />);
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

it("keeps invalid numeric edits visible and never rounds or saves them", async () => {
  for (const value of ["", "8.5", "201"]) {
    await edit("Runs kept per project", value);
    await blur("Runs kept per project");
    expect(input("Runs kept per project").props.value).toBe(value);
    expect(input("Runs kept per project").props["aria-invalid"]).toBe(true);
  }
  expect(state.save).not.toHaveBeenCalled();
  await edit("Runs kept per project", "25");
  await blur("Runs kept per project");
  expect(state.save).toHaveBeenCalledWith(expect.anything(), {
    environmentId: "qa-env",
    input: { keepRunsPerProject: 25 },
  });
});

it("retains a failed numeric save so leaving the field can retry it", async () => {
  state.save.mockRejectedValueOnce(new Error("Connection lost"));
  await edit("Runs kept per project", "25");
  await blur("Runs kept per project");
  expect(input("Runs kept per project").props.value).toBe("25");
  expect(state.refresh).not.toHaveBeenCalled();
  expect(renderer.root.findAllByProps({ role: "alert" }).length).toBeGreaterThan(0);
  await blur("Runs kept per project");
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.refresh).toHaveBeenCalledOnce();
});

it("retains a failed executable edit for retry", async () => {
  state.save.mockRejectedValueOnce(new Error("Connection lost"));
  await edit("argent path", "/tools/argent");
  await blur("argent path");
  expect(input("argent path").props.value).toBe("/tools/argent");
  await blur("argent path");
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.save).toHaveBeenLastCalledWith(expect.anything(), {
    environmentId: "qa-env",
    input: { argentPath: "/tools/argent" },
  });
});
