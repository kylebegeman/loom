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
import type { DisplayUnits, ModelPreviewSettings } from "@t3tools/contracts/fork";
import { toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { models, runModelCommand } from "./state";

export const MM_PER_INCH = 25.4;
export const fromMm = (mm: number, units: DisplayUnits) => (units === "in" ? mm / MM_PER_INCH : mm);
export const toMm = (value: number, units: DisplayUnits) =>
  units === "in" ? value * MM_PER_INCH : value;
export const unitSuffix = (units: DisplayUnits) => units;
export const unitName = (units: DisplayUnits) => (units === "in" ? "inches" : "millimetres");
export type LengthOptions = {
  /** Millimetre precision; inches get one more decimal. */
  digits?: number;
  trim?: boolean;
  unit?: boolean;
};

/** A display length. Stored and tool values stay in millimetres. */
export function formatLength(mm: number, units: DisplayUnits, options: LengthOptions = {}) {
  let value = fromMm(mm, units).toFixed((options.digits ?? 1) + (units === "in" ? 1 : 0));
  if (Number(value) === 0) value = value.replace(/^-/, "");
  if (options.trim) value = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
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

export type DisplayUnitsControl = {
  readonly units: DisplayUnits;
  readonly setUnits: (units: DisplayUnits) => void;
  readonly canSave: boolean;
};
const DisplayUnitsContext = createContext<DisplayUnitsControl>({
  units: "mm",
  setUnits: () => {},
  canSave: false,
});
export const DisplayUnitsProvider = DisplayUnitsContext.Provider;
export const useDisplayUnits = () => useContext(DisplayUnitsContext).units;
export const useDisplayUnitsControl = () => useContext(DisplayUnitsContext);

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
  return useMemo(() => ({ units, setUnits, canSave }), [units, setUnits, canSave]);
}
