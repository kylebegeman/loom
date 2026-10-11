import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Semaphore from "effect/Semaphore";
import {
  PcbFabCapability,
  PcbFabCapabilitiesUpdate,
  PcbPreviewError,
  DEFAULT_FAB_ID,
  type PcbFabCatalog,
} from "@t3tools/contracts/fork";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
const JLC = "https://jlcpcb.com/capabilities/pcb-capabilities",
  WAY = "https://www.pcbway.com/capabilities.html",
  OSH = "https://docs.oshpark.com/services/";
const common = {
  checkedOn: "2026-10-10",
  layerCounts: [1, ...Array.from({ length: 16 }, (_, i) => (i + 1) * 2)],
  thicknessesMm: [0.4, 0.6, 0.8, 1, 1.2, 1.6, 2],
  finishes: ["HASL", "Lead-free HASL", "ENIG", "OSP"],
};
/** Published limits, with conservative layer-dependent values. See each entry's caveats. */
export const BUILT_IN_FABS: readonly PcbFabCapability[] = [
  {
    ...common,
    id: "jlcpcb-standard",
    name: "JLCPCB standard",
    tier: "standard",
    minTrackMm: 0.1,
    minSpaceMm: 0.1,
    minDrillMm: 0.2,
    minAnnularRingMm: 0.25,
    minViaMm: 0.45,
    minEdgeClearanceMm: 0.2,
    minHoleToHoleMm: 0.2,
    sourceUrl: JLC,
    notes:
      "No-surcharge via sizes and recommended 2-layer annular ring. Multilayer track/space can reach 0.09 mm; ring 0.20 mm recommended. Hole spacing here covers vias, not component holes (0.45 mm). Common FR4 thicknesses only; published thickness ranges disagree. Copper to routed edge only, not V-cut.",
  },
  {
    ...common,
    id: "jlcpcb-advanced",
    name: "JLCPCB advanced",
    tier: "advanced",
    minTrackMm: 0.1,
    minSpaceMm: 0.1,
    minDrillMm: 0.15,
    minAnnularRingMm: 0.18,
    minViaMm: 0.25,
    minEdgeClearanceMm: 0.2,
    minHoleToHoleMm: 0.2,
    sourceUrl: JLC,
    notes:
      "Smallest standard-process via, usually at extra cost. Two-layer annular ring minimum; multilayer ring can be 0.15 mm. Track/space can reach 0.09 mm on multilayer boards. Special thin-board 0.10 mm drills are not included. Hole spacing covers vias only. Common FR4 thicknesses only.",
  },
  {
    ...common,
    id: "pcbway-standard",
    name: "PCBWay standard",
    tier: "standard",
    layerCounts: [1, 2, 4, 6, 8, 10, 12, 14],
    finishes: [
      "HASL",
      "Lead-free HASL",
      "Immersion gold",
      "OSP",
      "Hard gold",
      "Immersion silver",
      "Immersion tin",
      "ENEPIG",
    ],
    minTrackMm: 0.1,
    minSpaceMm: 0.1,
    minDrillMm: 0.2,
    minAnnularRingMm: 0.15,
    minViaMm: 0.5,
    minEdgeClearanceMm: 0.25,
    minHoleToHoleMm: 0.28,
    sourceUrl: WAY,
    notes:
      "Via pad diameter derived from 0.20 mm hole plus two 0.15 mm rings. Smaller than 0.20 mm drills cost extra. Hole spacing covers vias; component holes need 16 mil. Common FR4 thicknesses only, more order options are available.",
  },
  {
    ...common,
    id: "oshpark-2-layer",
    name: "OSH Park 2-layer",
    tier: "standard",
    layerCounts: [2],
    thicknessesMm: [1.6],
    finishes: ["ENIG"],
    minTrackMm: 0.1524,
    minSpaceMm: 0.1524,
    minDrillMm: 0.254,
    minAnnularRingMm: 0.127,
    minViaMm: 0.508,
    minEdgeClearanceMm: null,
    minHoleToHoleMm: 0.127,
    sourceUrl: OSH,
    notes:
      "6 mil track/space, 10 mil drill, 5 mil annular ring, 20 mil via. Edge clearance is not published and is not checked. Published price: $5 per square inch for three boards.",
  },
  {
    ...common,
    id: "oshpark-4-layer",
    name: "OSH Park 4-layer",
    tier: "standard",
    layerCounts: [4],
    thicknessesMm: [1.6],
    finishes: ["ENIG"],
    minTrackMm: 0.127,
    minSpaceMm: 0.127,
    minDrillMm: 0.254,
    minAnnularRingMm: 0.1016,
    minViaMm: 0.4572,
    minEdgeClearanceMm: null,
    minHoleToHoleMm: 0.127,
    sourceUrl: OSH,
    notes:
      "5 mil track/space, 10 mil drill, 4 mil annular ring, 18 mil via. Edge clearance is not published and is not checked. Published price: $10 per square inch for three boards.",
  },
];
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const Envelope = Schema.Struct({
  version: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  defaultId: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  entries: Schema.Array(Schema.Unknown).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
const decodeEnvelope = Schema.decodeUnknownSync(Envelope),
  decodeEntry = Schema.decodeUnknownSync(PcbFabCapability);
export function decodeFabCapabilitiesLenient(source: string) {
  const raw = decodeEnvelope(decodeJson(source));
  const entries: PcbFabCapability[] = [],
    skipped: string[] = [];
  for (const [i, value] of raw.entries.entries()) {
    try {
      const entry = decodeEntry(value);
      if (
        !validCapability(entry) ||
        entries.some((e) => e.id === entry.id) ||
        BUILT_IN_FABS.some((e) => e.id === entry.id) ||
        entries.length >= 24
      )
        throw new Error("Duplicate or excess entry");
      entries.push(entry);
    } catch {
      const id =
        value && typeof value === "object" && "id" in value && typeof value.id === "string"
          ? value.id.slice(0, 160)
          : `entry ${i + 1}`;
      skipped.push(id);
    }
  }
  return { version: raw.version, defaultId: raw.defaultId, entries, skipped: skipped.slice(0, 24) };
}
export function toCatalog(stored: {
  version: number;
  entries: readonly PcbFabCapability[];
  defaultId: string | null;
  skipped?: readonly string[];
}): PcbFabCatalog {
  const exists = [...BUILT_IN_FABS, ...stored.entries].some((e) => e.id === stored.defaultId);
  return {
    version: stored.version,
    builtIns: BUILT_IN_FABS,
    entries: stored.entries,
    defaultId: exists ? stored.defaultId! : DEFAULT_FAB_ID,
    skipped: stored.skipped ?? [],
  };
}
export function isPlainHttpUrl(link: string) {
  try {
    const url = new URL(link);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
function validCapability(entry: PcbFabCapability) {
  return (
    (!entry.sourceUrl || isPlainHttpUrl(entry.sourceUrl)) &&
    entry.minTrackMm >= 0.05 &&
    entry.minSpaceMm >= 0.05 &&
    entry.minViaMm > entry.minDrillMm &&
    entry.layerCounts.length > 0 &&
    entry.thicknessesMm.length > 0 &&
    entry.finishes.length > 0
  );
}
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeUpdate = Schema.decodeUnknownEffect(PcbFabCapabilitiesUpdate);
export const makeFabCatalog = Effect.fn("PcbPreview.makeFabCatalog")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem,
    lock = yield* Semaphore.make(1);
  const stored = Effect.gen(function* () {
    if (!(yield* fs.exists(file))) return { version: 0, entries: [], defaultId: null, skipped: [] };
    if (Number((yield* fs.stat(file)).size) > 1024 * 1024)
      return yield* new PcbPreviewError({
        reason: "source-limit",
        message: "Fab capabilities exceed the storage limit.",
      });
    const source = yield* fs.readFileString(file);
    return yield* Effect.try({
      try: () => decodeFabCapabilitiesLenient(source),
      catch: () =>
        new PcbPreviewError({
          reason: "invalid-report",
          message: "Fab capabilities could not be read.",
        }),
    });
  });
  const read = stored.pipe(Effect.map(toCatalog));
  const update = Effect.fn("PcbPreview.updateFabCapabilities")(function* (
    input: typeof PcbFabCapabilitiesUpdate.Type,
  ) {
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const valid = yield* decodeUpdate(input).pipe(
          Effect.mapError(
            () =>
              new PcbPreviewError({
                reason: "invalid-parameters",
                message: "Fab capabilities contain invalid values.",
              }),
          ),
        );
        const current = yield* stored;
        if (current.version !== valid.expectedVersion)
          return yield* new PcbPreviewError({
            reason: "conflict",
            message: "Fab capabilities changed on another client. Reload them before saving.",
          });
        const ids = new Set(BUILT_IN_FABS.map((e) => e.id));
        for (const entry of valid.entries) {
          if (ids.has(entry.id) || !validCapability(entry))
            return yield* new PcbPreviewError({
              reason: "invalid-parameters",
              message:
                "Fab IDs must be unique, sources must be plain HTTP links, and limits must be valid millimetres.",
            });
          ids.add(entry.id);
        }
        if (valid.defaultId !== null && !ids.has(valid.defaultId))
          return yield* new PcbPreviewError({
            reason: "invalid-parameters",
            message: "Choose an existing default fab.",
          });
        const next = {
          version: current.version + 1,
          entries: valid.entries,
          defaultId: valid.defaultId,
        };
        yield* writeFileStringAtomically({ filePath: file, contents: encodeJson(next) });
        return toCatalog(next);
      }),
    );
  });
  return { read, update };
});
