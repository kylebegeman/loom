import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import {
  addCustomBed,
  DEFAULT_MODEL_PREVIEW_SETTINGS,
  selectBed,
  type ModelPreviewSettings,
} from "@t3tools/contracts/fork";
const mocks = vi.hoisted(() => ({
  canSave: true,
  save: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => mocks.canSave }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: mocks.refresh } }));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: mocks.toast } }));
vi.mock("./state", () => ({
  models: { updateSettings: { permissionAtom: () => ({}) }, settings: () => ({}) },
  runModelCommand: mocks.save,
}));
import { samePlate, useBuildPlate } from "./BedPicker";
let renderer: ReactTestRenderer | undefined;
let control: ReturnType<typeof useBuildPlate>;
const settings = DEFAULT_MODEL_PREVIEW_SETTINGS;
const laser = { id: "custom-12345678", name: "Laser", volumeMm: [400, 300, null] as const };
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  function Harness() {
    const value = useBuildPlate(EnvironmentId.make("test"), settings);
    useLayoutEffect(() => {
      control = value;
    });
    return null;
  }
  await act(async () => {
    renderer = create(createElement(Harness));
  });
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  mocks.canSave = true;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("compares named bed and hidden preset edits rather than clearing them as unchanged", () => {
  const base = addCustomBed(settings.buildPlate, laser);
  expect(samePlate(base, { ...base, customBedId: null })).toBe(false);
  expect(samePlate(base, { ...base, hiddenPresets: ["prusa-mini"] })).toBe(false);
  expect(samePlate(base, { ...base, customBeds: [{ ...laser, name: "Cutter" }] })).toBe(false);
  expect(samePlate(base, { ...base, customBeds: [{ ...laser, volumeMm: [400, 300, 200] }] })).toBe(
    false,
  );
  expect(samePlate(base, { ...base, customBeds: [{ ...laser }] })).toBe(true);
});
it("serializes rapid saves and keeps the newer named bed visible through an earlier failure", async () => {
  let reject!: (error: Error) => void;
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  mocks.save.mockImplementationOnce((_command, request) => Promise.resolve(request.input));
  await mount();
  const named = addCustomBed(settings.buildPlate, laser);
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = control.save(selectBed(settings.buildPlate, "sheet-a4"));
    second = control.save(named);
  });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(control.plate).toEqual(named);
  await act(async () => {
    reject(new Error("Disconnected"));
    await Promise.all([first, second]);
  });
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(control.plate).toEqual(named);
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Bed not changed" }));
});
it("resolves an older server response to its actual bed choice and refuses read-only writes", async () => {
  mocks.save.mockResolvedValue(settings as ModelPreviewSettings);
  await mount();
  await act(async () => {
    await control.save(addCustomBed(settings.buildPlate, laser));
  });
  expect(control.plate).toEqual(settings.buildPlate);
  await act(async () => renderer?.unmount());
  renderer = undefined;
  mocks.canSave = false;
  await mount();
  await act(async () => {
    await control.save(selectBed(settings.buildPlate, "sheet-a4"));
  });
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
