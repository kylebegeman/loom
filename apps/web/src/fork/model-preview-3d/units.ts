import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { DisplayPrecision, DisplayUnits, ModelPreviewSettings } from "@t3tools/contracts/fork";
import { toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { models, runModelCommand } from "./state";

const MM_PER_INCH = 25.4;
export const fromMm = (mm: number, units: DisplayUnits) => (units === "in" ? mm / MM_PER_INCH : mm);
export const toMm = (value: number, units: DisplayUnits) =>
  units === "in" ? value * MM_PER_INCH : value;
export const unitName = (units: DisplayUnits) => (units === "in" ? "inches" : "millimetres");
export type LengthOptions = {
  /** Millimetre precision for "auto"; inches get one more decimal. */
  digits?: number;
  /** Drops trailing zeros for "auto". A chosen precision always shows its decimals. */
  trim?: boolean;
  unit?: boolean;
  /** The chosen decimals; absent or "auto" keeps each call site's natural form. */
  precision?: DisplayPrecision | undefined;
};

/** Fixed decimals for a chosen precision, without "-0". */
function fixed(value: number, places: number) {
  const text = value.toFixed(places);
  return Number(text) === 0 ? text.replace(/^-/, "") : text;
}

/** A display length. Stored and tool values stay in millimetres. */
export function formatLength(mm: number, units: DisplayUnits, options: LengthOptions = {}) {
  const { precision } = options;
  const chosen = typeof precision === "number";
  let value = fixed(
    fromMm(mm, units),
    chosen ? precision : (options.digits ?? 1) + (units === "in" ? 1 : 0),
  );
  if (options.trim && !chosen) value = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return value + (options.unit === false ? "" : ` ${units}`);
}

/** Several lengths with one suffix, skipping unlimited surface height. */
export function formatLengths(
  values: readonly (number | null)[],
  units: DisplayUnits,
  options: LengthOptions = {},
) {
  const lengths = values
    .filter((value) => value !== null)
    .map((value) => formatLength(value, units, { ...options, unit: false }));
  return lengths.join(" × ") + (lengths.length && options.unit !== false ? ` ${units}` : "");
}

/** A signed change. The sign follows the shown value, so a change that rounds to zero has none. */
export function formatDelta(mm: number, units: DisplayUnits, options: LengthOptions = {}) {
  const magnitude = formatLength(Math.abs(mm), units, { ...options, unit: false });
  const sign = Number(magnitude) === 0 ? "" : mm > 0 ? "+" : "−";
  return sign + magnitude + (options.unit === false ? "" : ` ${units}`);
}

/** A surface area from square millimetres; "auto" shows one decimal, or two in inches. */
export function formatArea(mm2: number, units: DisplayUnits, precision?: DisplayPrecision) {
  const value = units === "in" ? mm2 / MM_PER_INCH ** 2 : mm2;
  return `${fixed(value, typeof precision === "number" ? precision : units === "in" ? 2 : 1)} ${units}²`;
}

export const precisionLabel = (precision: DisplayPrecision) =>
  precision === "auto" ? "Automatic" : `${precision} decimal${precision === 1 ? "" : "s"}`;

export type DisplayUnitsControl = {
  readonly units: DisplayUnits;
  readonly setUnits: (units: DisplayUnits) => void;
  readonly canSave: boolean;
  /** Read from settings and changed in Loom settings. Absent means "auto". */
  readonly precision?: DisplayPrecision | undefined;
};
const DisplayUnitsContext = createContext<DisplayUnitsControl>({
  units: "mm",
  setUnits: () => {},
  canSave: false,
});
export const DisplayUnitsProvider = DisplayUnitsContext.Provider;
export const useDisplayUnits = () => useContext(DisplayUnitsContext).units;
export const useDisplayUnitsControl = () => useContext(DisplayUnitsContext);
export const useDisplayPrecision = (): DisplayPrecision =>
  useContext(DisplayUnitsContext).precision ?? "auto";

/** Saves the environment's display preference optimistically and reverts its own failed choice. */
export function useDisplayUnitsSetting(
  environmentId: EnvironmentId,
  settings: ModelPreviewSettings,
  getSettings?: () => ModelPreviewSettings,
): DisplayUnitsControl {
  const canSave = useAtomValue(models.updateSettings.permissionAtom(environmentId));
  const [pending, setPending] = useState<DisplayUnits | null>(null);
  if (pending === settings.displayUnits) setPending(null);
  const units = pending ?? settings.displayUnits;
  const latest = useRef({ settings, units, getSettings });
  const request = useRef(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest settings, units and getter in a ref for async save callbacks
  useLayoutEffect(() => {
    latest.current = { settings, units, getSettings };
  });
  const setUnits = useCallback(
    (next: DisplayUnits) => {
      if (!canSave || next === latest.current.units) return;
      const version = ++request.current;
      latest.current.units = next;
      setPending(next);
      void runModelCommand(models.updateSettings, {
        environmentId,
        input: {
          ...(latest.current.getSettings?.() ?? latest.current.settings),
          displayUnits: next,
        },
      })
        .then((saved) => {
          if (request.current === version) latest.current.settings = saved;
          appAtomRegistry.refresh(models.settings({ environmentId, input: {} }));
        })
        .catch((error: unknown) => {
          if (request.current === version) {
            latest.current.units = latest.current.settings.displayUnits;
            setPending(null);
          }
          toastManager.add({
            type: "error",
            title: "Units not changed",
            description: error instanceof Error ? error.message : "The setting could not be saved.",
          });
        });
    },
    [canSave, environmentId],
  );
  const precision = settings.displayPrecision ?? "auto";
  return useMemo(
    () => ({ units, setUnits, canSave, precision }),
    [units, setUnits, canSave, precision],
  );
}
