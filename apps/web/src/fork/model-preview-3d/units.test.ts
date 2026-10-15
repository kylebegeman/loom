import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import {
  DEFAULT_MODEL_PREVIEW_SETTINGS,
  DISPLAY_PRECISIONS,
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

import {
  formatArea,
  formatDelta,
  formatLength,
  formatLengths,
  fromMm,
  precisionLabel,
  toMm,
  useDisplayPrecision,
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

it("keeps auto output and shows exactly the chosen decimals otherwise", () => {
  expect(formatLength(12.34, "mm", { precision: "auto" })).toBe("12.3 mm");
  expect(formatLength(12.7, "in", { precision: "auto" })).toBe("0.50 in");
  expect(formatLength(12.3456, "mm", { precision: 1 })).toBe("12.3 mm");
  expect(formatLength(12, "mm", { precision: 2 })).toBe("12.00 mm");
  expect(formatLength(25.4, "in", { precision: 0 })).toBe("1 in");
  expect(formatLength(12.7, "in", { precision: 3 })).toBe("0.500 in");
  expect(formatLength(-0.0004, "mm", { precision: 2 })).toBe("0.00 mm");
  // A chosen precision overrides each site's own digits and trimming.
  expect(formatLength(12.34, "mm", { digits: 0, precision: 3 })).toBe("12.340 mm");
  expect(formatLength(279.4, "in", { trim: true, precision: 2 })).toBe("11.00 in");
  expect(formatLengths([25.4, 50.8, null], "in", { trim: true, precision: 1 })).toBe(
    "1.0 × 2.0 in",
  );
});

it("signs a change by its shown value, with a true minus", () => {
  expect(formatDelta(2, "mm")).toBe("+2.0 mm");
  expect(formatDelta(-1.5, "mm")).toBe("\u22121.5 mm");
  expect(formatDelta(-25.4, "in")).toBe("\u22121.00 in");
  expect(formatDelta(-0.004, "mm")).toBe("0.0 mm");
  expect(formatDelta(0.3, "mm", { precision: 0 })).toBe("0 mm");
  expect(formatDelta(0.3, "mm", { precision: 2 })).toBe("+0.30 mm");
  expect(formatDelta(-12.7, "in", { precision: 1, unit: false })).toBe("\u22120.5");
});

it("formats areas in square display units at the chosen precision", () => {
  expect(formatArea(1234.56, "mm")).toBe("1234.6 mm²");
  expect(formatArea(645.16, "in")).toBe("1.00 in²");
  expect(formatArea(1234.56, "mm", 0)).toBe("1235 mm²");
  expect(formatArea(645.16, "in", 3)).toBe("1.000 in²");
  expect(formatArea(-0.01, "mm", 1)).toBe("0.0 mm²");
});

it("labels precision choices", () => {
  expect(DISPLAY_PRECISIONS.map(precisionLabel)).toEqual([
    "Automatic",
    "0 decimals",
    "1 decimal",
    "2 decimals",
    "3 decimals",
  ]);
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

it("reads precision from the panel's settings and defaults to auto", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let precision: unknown;
  function ReadPrecision() {
    const current = useDisplayPrecision();
    useLayoutEffect(() => {
      precision = current;
    });
    return null;
  }
  function Panel({ settings }: { settings: ModelPreviewSettings }) {
    const control = useDisplayUnitsSetting(EnvironmentId.make("units"), settings);
    return createElement(DisplayUnitsProvider, { value: control }, createElement(ReadPrecision));
  }
  await act(async () => {
    renderer = create(createElement(ReadPrecision));
  });
  expect(precision).toBe("auto");
  await act(async () =>
    renderer!.update(createElement(Panel, { settings: DEFAULT_MODEL_PREVIEW_SETTINGS })),
  );
  expect(precision).toBe("auto");
  await act(async () =>
    renderer!.update(
      createElement(Panel, {
        settings: { ...DEFAULT_MODEL_PREVIEW_SETTINGS, displayPrecision: 2 },
      }),
    ),
  );
  expect(precision).toBe(2);
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
