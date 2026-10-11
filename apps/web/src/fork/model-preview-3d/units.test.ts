import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { DEFAULT_MODEL_PREVIEW_SETTINGS, type ModelPreviewSettings } from "@t3tools/contracts/fork";

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

import {
  formatLength,
  formatLengths,
  fromMm,
  toMm,
  useDisplayUnits,
  useDisplayUnitsControl,
  useDisplayUnitsSetting,
  DisplayUnitsProvider,
  type DisplayUnitsControl,
} from "./units";
import { useScaleReference, type ScaleReferenceControl } from "./BedPicker";

it("converts inches exactly and round-trips lengths in either unit", () => {
  expect(toMm(12, "in")).toBeCloseTo(304.8);
  expect(fromMm(25.4, "in")).toBe(1);
  for (const units of ["mm", "in"] as const) {
    for (const value of [0, 12.7, 350, -25.4])
      expect(toMm(fromMm(value, units), units)).toBeCloseTo(value);
  }
});

it("formats precision, trailing zeros, unit suffixes and negative zero", () => {
  expect(formatLength(12.34, "mm")).toBe("12.3 mm");
  expect(formatLength(12.7, "in")).toBe("0.50 in");
  expect(formatLength(12.34, "mm", { digits: 0 })).toBe("12 mm");
  expect(formatLength(12.7, "in", { digits: 0 })).toBe("0.5 in");
  expect(formatLength(12.345, "mm", { digits: 2 })).toBe("12.35 mm");
  expect(formatLength(12.7, "in", { digits: 2 })).toBe("0.500 in");
  expect(formatLength(279.4, "in", { trim: true })).toBe("11 in");
  expect(formatLength(215.9, "in", { trim: true })).toBe("8.5 in");
  expect(formatLength(100, "mm", { digits: 0, trim: true })).toBe("100 mm");
  expect(formatLength(12.7, "in", { unit: false })).toBe("0.50");
  expect(formatLength(-0.001, "mm")).toBe("0.0 mm");
  expect(formatLength(-0.001, "in", { trim: true })).toBe("0 in");
});

it("joins dimensions with one unit suffix and skips surface height", () => {
  expect(formatLengths([25.4, 25.4, 25.4], "in")).toBe("1.00 × 1.00 × 1.00 in");
  expect(formatLengths([350, 320, 325], "in", { trim: true })).toBe("13.78 × 12.6 × 12.8 in");
  expect(formatLengths([279.4, 215.9, null], "in", { trim: true })).toBe("11 × 8.5 in");
  expect(formatLengths([350, 320, null], "mm", { trim: true, unit: false })).toBe("350 × 320");
  expect(formatLengths([], "mm")).toBe("");
});

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  mocks.canSave = true;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("defaults context to millimetres and follows the provider's pending value", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let units = "";
  let canSave = true;
  function ReadUnits() {
    const currentUnits = useDisplayUnits();
    const currentControl = useDisplayUnitsControl();
    useLayoutEffect(() => {
      units = currentUnits;
      canSave = currentControl.canSave;
    });
    return null;
  }
  await act(async () => {
    renderer = create(createElement(ReadUnits));
  });
  expect(units).toBe("mm");
  expect(canSave).toBe(false);
  await act(async () =>
    renderer!.update(
      createElement(
        DisplayUnitsProvider,
        {
          value: { units: "in", setUnits: () => {}, canSave: true },
        },
        createElement(ReadUnits),
      ),
    ),
  );
  expect(units).toBe("in");
  expect(canSave).toBe(true);
});

it("shows a pending unit immediately and rolls back a failed save", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let reject: (reason: Error) => void = () => {};
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  let control!: DisplayUnitsControl;
  function Harness() {
    const current = useDisplayUnitsSetting(
      EnvironmentId.make("units"),
      DEFAULT_MODEL_PREVIEW_SETTINGS,
    );
    useLayoutEffect(() => {
      control = current;
    });
    return null;
  }
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  await act(async () => control.setUnits("in"));
  expect(control.units).toBe("in");
  expect(mocks.save.mock.calls[0]?.[1].input.buildPlate.customMm).toEqual([350, 320, 325]);
  await act(async () => reject(new Error("Offline")));
  expect(control.units).toBe("mm");
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Units not changed" }));
});

it("reads the shared latest settings and refreshes after saving", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const combined: ModelPreviewSettings = {
    ...DEFAULT_MODEL_PREVIEW_SETTINGS,
    scaleReference: "card",
  };
  mocks.save.mockImplementationOnce((_, { input }) => Promise.resolve(input));
  let control!: DisplayUnitsControl;
  function Harness() {
    const current = useDisplayUnitsSetting(
      EnvironmentId.make("units"),
      DEFAULT_MODEL_PREVIEW_SETTINGS,
      () => combined,
    );
    useLayoutEffect(() => {
      control = current;
    });
    return null;
  }
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  await act(async () => control.setUnits("in"));
  expect(mocks.save.mock.calls[0]?.[1].input).toEqual({ ...combined, displayUnits: "in" });
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("keeps saved units and performs no write without settings permission", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.canSave = false;
  let control!: DisplayUnitsControl;
  function Harness() {
    const current = useDisplayUnitsSetting(
      EnvironmentId.make("units"),
      DEFAULT_MODEL_PREVIEW_SETTINGS,
    );
    useLayoutEffect(() => {
      control = current;
    });
    return null;
  }
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  await act(async () => control.setUnits("in"));
  expect(control.units).toBe("mm");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("reference commands await pending saves and reject failures after reverting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let reject: (reason: Error) => void = () => {};
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  let control!: ScaleReferenceControl;
  function Harness() {
    const current = useScaleReference(EnvironmentId.make("scale"), DEFAULT_MODEL_PREVIEW_SETTINGS);
    useLayoutEffect(() => {
      control = current;
    });
    return null;
  }
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  let first!: Promise<unknown>;
  let duplicate!: Promise<unknown>;
  let settled = false;
  await act(async () => {
    first = control.save("coin-euro").catch((error: unknown) => error);
    duplicate = control.save("coin-euro").then(
      () => {
        settled = true;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
  });
  expect(control.reference).toBe("coin-euro");
  expect(settled).toBe(false);
  expect(mocks.save).toHaveBeenCalledOnce();
  await act(async () => reject(new Error("Offline")));
  expect(await first).toBeInstanceOf(Error);
  expect(await duplicate).toBeInstanceOf(Error);
  expect(control.reference).toBe("none");
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Scale reference not changed" }),
  );
});

it("reference saves preserve shared units and refuse writes without permission", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const combined: ModelPreviewSettings = { ...DEFAULT_MODEL_PREVIEW_SETTINGS, displayUnits: "in" };
  mocks.save.mockImplementationOnce((_, { input }) => Promise.resolve(input));
  let control!: ScaleReferenceControl;
  function Harness() {
    const current = useScaleReference(
      EnvironmentId.make("scale"),
      DEFAULT_MODEL_PREVIEW_SETTINGS,
      () => combined,
    );
    useLayoutEffect(() => {
      control = current;
    });
    return null;
  }
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  await act(async () => control.save("card"));
  expect(mocks.save.mock.calls[0]?.[1].input).toEqual({ ...combined, scaleReference: "card" });
  mocks.canSave = false;
  await act(async () => renderer!.update(createElement(Harness)));
  await expect(control.save("none")).rejects.toThrow(
    "This connection cannot change model settings.",
  );
  expect(mocks.save).toHaveBeenCalledOnce();
});
