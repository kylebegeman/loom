import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { DEFAULT_MODEL_PREVIEW_SETTINGS } from "@t3tools/contracts/fork";

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
import { useOverhangAngleSetting } from "./overhangSettings";

let renderer: ReactTestRenderer | undefined;
let control: ReturnType<typeof useOverhangAngleSetting>;
const settings = DEFAULT_MODEL_PREVIEW_SETTINGS;
const snapshot = () => ({
  ...settings,
  displayUnits: "in" as const,
  scaleReference: "card" as const,
});
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  function Harness() {
    const current = useOverhangAngleSetting(EnvironmentId.make("test"), settings, snapshot);
    useLayoutEffect(() => {
      control = current;
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

it("previews drag changes without RPC, then commits the final angle once and preserves other preferences", async () => {
  let resolve!: (value: typeof settings) => void;
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await mount();
  await act(async () => {
    control.setAngle(49);
    control.setAngle(51.3);
  });
  expect(control.angle).toBe(51);
  expect(mocks.save).not.toHaveBeenCalled();
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = control.commit();
    second = control.commit();
  });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0]![1].input).toMatchObject({
    overhangAngleDegrees: 51,
    displayUnits: "in",
    scaleReference: "card",
  });
  await act(async () => {
    resolve({ ...settings, overhangAngleDegrees: 51 });
    await Promise.all([first, second]);
  });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it("rolls back a denied save and leaves a newer local angle alone when an earlier save fails", async () => {
  mocks.save.mockRejectedValueOnce(new Error("Disconnected"));
  await mount();
  await act(async () => {
    control.setAngle(50);
  });
  await act(async () => {
    await control.commit();
  });
  expect(control.angle).toBe(45);
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ type: "error", title: "Overhang angle not changed" }),
  );
  let reject!: (cause: Error) => void;
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((_done, fail) => {
        reject = fail;
      }),
  );
  await act(async () => {
    control.setAngle(50);
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = control.commit();
    control.setAngle(60);
  });
  await act(async () => {
    reject(new Error("Disconnected"));
    await pending;
  });
  expect(control.angle).toBe(60);
});

it("keeps a read-only connection at its saved angle", async () => {
  mocks.canSave = false;
  await mount();
  await act(async () => {
    control.setAngle(70);
    await control.commit();
  });
  expect(control.angle).toBe(45);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(control.canSave).toBe(false);
});

it("restores the acknowledged host angle when the settings atom has not refreshed yet", async () => {
  mocks.save.mockResolvedValueOnce({ ...settings, overhangAngleDegrees: 51 });
  await mount();
  await act(async () => {
    control.setAngle(51);
  });
  await act(async () => {
    await control.commit();
  });
  expect(control.angle).toBe(51);
  // A new local render still sees the original settings prop (45) before its atom refresh.
  mocks.save.mockRejectedValueOnce(new Error("Disconnected"));
  await act(async () => {
    control.setAngle(60);
  });
  await act(async () => {
    await control.commit();
  });
  expect(control.angle).toBe(51);
  await act(async () => {
    await control.commit();
  });
  expect(mocks.save).toHaveBeenCalledTimes(2);
});
