import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import type { EnvironmentId } from "@t3tools/contracts";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { PrinterLibrary, PrinterExport, Printer } from "@t3tools/contracts/fork";
import { useServerConfigs } from "~/state/entities";
import { models } from "./state";

const absent = Atom.make<AsyncResult.AsyncResult<PrinterLibrary, never>>(AsyncResult.initial());
/** Older servers retain the preset list and receive no unsupported library request. */
export const usePrinterLibrary = (environmentId: EnvironmentId): PrinterLibrary | undefined => {
  const configs = useServerConfigs();
  const supported = loomFeaturesOf(configs.get(environmentId)?.environment.capabilities).includes(
    "printer-library",
  );
  const result = useAtomValue(supported ? models.printers({ environmentId, input: {} }) : absent);
  return Option.getOrUndefined(AsyncResult.value(result));
};
export const blankPrinter = (id: string, kind: Printer["kind"]): Printer => ({
  id,
  name: kind === "printer" ? "New printer" : "New surface",
  kind,
  volumeMm: [250, 250, kind === "printer" ? 250 : null],
  bedShape: "rectangle",
  nozzlesMm: kind === "printer" ? [0.4] : [],
  materialIds: [],
  defaultMaterialId: null,
  zones: [],
  excludedAreasMm: [],
  notes: "",
  source: { kind: "user", app: null, profileName: null },
  basedOn: null,
});
/** Imports preserve existing ids rather than replacing a user's current numbers. */
export const mergePrinterExport = (library: PrinterLibrary, imported: PrinterExport) => {
  const printers = imported.printers.filter(
    (p) => !library.printers.some((existing) => existing.id === p.id),
  );
  const materials = imported.materials.filter(
    (m) => !library.materials.some((existing) => existing.id === m.id),
  );
  return {
    value: {
      ...library,
      printers: [...library.printers, ...printers],
      materials: [...library.materials, ...materials],
    },
    printers: printers.length,
    materials: materials.length,
    kept: imported.printers.length + imported.materials.length - printers.length - materials.length,
  };
};
