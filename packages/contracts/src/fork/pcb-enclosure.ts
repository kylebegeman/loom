import { ENCLOSURE_MAX_FINDINGS, ENCLOSURE_MAX_CONNECTORS } from "./model-check-limits.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const PCB_REFERENCE_FORMAT = "loom-pcb-reference";
export const PCB_REFERENCE_VERSION = 2;
export {
  ENCLOSURE_MAX_FINDINGS,
  ENCLOSURE_MAX_HOLES,
  ENCLOSURE_MAX_CONNECTORS,
} from "./model-check-limits.ts";
export const ASSUMED_PART_HEIGHT_MM = 10;

const finite = Schema.Number.check(Schema.isFinite());
const mm = finite.check(Schema.isBetween({ minimum: -100_000, maximum: 100_000 }));
const gap = (maximum: number) => finite.check(Schema.isBetween({ minimum: 0, maximum }));
const name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100));
const xy = Schema.Struct({ x: mm, y: mm });
const withDefault = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  schema.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

/** The JSON beside each board reference GLB. Version 1 files (no format) still decode. */
export const PcbReferenceMetadata = Schema.Struct({
  format: withDefault(Schema.Literal(PCB_REFERENCE_FORMAT), PCB_REFERENCE_FORMAT),
  version: withDefault(Schema.Int, 1),
  designId: Schema.String,
  sourceHash: Schema.String,
  /** null in version 1; inferred from designId and the GLB. */
  kind: withDefault(Schema.NullOr(Schema.Literals(["kicad", "tscircuit"])), null),
  units: Schema.Literal("mm"),
  glbUnits: Schema.Literal("metres"),
  bounds: Schema.NullOr(Schema.Struct({ x: mm, y: mm, width: mm, height: mm })),
  thickness: finite,
  /** Drawing frame. null in version 1: the bounds rectangle stands in. */
  outline: withDefault(
    Schema.NullOr(
      Schema.Struct({
        source: Schema.Literals(["edge-cuts", "circuit-outline", "bounds"]),
        loops: Schema.Array(Schema.Array(xy).check(Schema.isMaxLength(4000))).check(
          Schema.isMaxLength(64),
        ),
        outer: Schema.Int,
      }),
    ),
    null,
  ),
  mountingHoles: Schema.Array(
    Schema.Struct({
      x: mm,
      y: mm,
      diameter: finite,
      slotLength: finite,
      plated: withDefault(Schema.Boolean, false),
      footprint: withDefault(Schema.String, ""),
    }),
  ),
  components: Schema.Array(
    Schema.Struct({
      reference: Schema.String,
      value: Schema.String,
      footprint: Schema.String,
      position: Schema.NullOr(xy),
    }),
  ),
  note: Schema.String,
});

export const EnclosureRequirements = Schema.Struct({
  wallGapMm: withDefault(gap(20), 0.5),
  lidGapMm: withDefault(gap(50), 1),
  floorGapMm: withDefault(gap(50), 1),
  connectorMarginMm: withDefault(gap(10), 0.5),
  standoffToleranceMm: withDefault(gap(5), 0.2),
  /** A connector box this close to the outer outline, or past it, faces an edge. */
  edgeMarginMm: withDefault(gap(10), 1),
  connectors: withDefault(
    Schema.Struct({
      include: Schema.Array(name).check(Schema.isMaxLength(ENCLOSURE_MAX_CONNECTORS)),
      exclude: Schema.Array(name).check(Schema.isMaxLength(64)),
    }),
    { include: [], exclude: [] },
  ),
});
export const EnclosureRequirementsPatch = Schema.Struct({
  wallGapMm: Schema.optional(gap(20)),
  lidGapMm: Schema.optional(gap(50)),
  floorGapMm: Schema.optional(gap(50)),
  connectorMarginMm: Schema.optional(gap(10)),
  standoffToleranceMm: Schema.optional(gap(5)),
  edgeMarginMm: Schema.optional(gap(10)),
  connectors: Schema.optional(EnclosureRequirements.fields.connectors),
});

export const EnclosureFinding = Schema.Struct({
  /** Stable within a report: "wall:+x", "above:U3", "connector:J1", "hole:2", "pair:case". */
  id: Schema.String.check(Schema.isMaxLength(120)),
  kind: Schema.Literals(["wall", "above", "below", "connector", "hole", "interference"]),
  status: Schema.Literals(["ok", "tight", "interferes", "unchecked"]),
  label: Schema.String.check(Schema.isMaxLength(120)), // "J1 opening", "Wall, +X side"
  detail: Schema.String.check(Schema.isMaxLength(300)), // one sentence
  measuredMm: Schema.NullOr(finite), // the gap; null when it cannot be measured
  requiredMm: Schema.NullOr(finite),
  point: Schema.Tuple([finite, finite, finite]), // assembly millimetres, for pins and framing
  connector: Schema.optional(
    Schema.Struct({
      openFraction: gap(1),
      setbackMm: Schema.NullOr(finite),
      facing: Schema.Literals(["+x", "-x", "+y", "-y"]), // board part frame
    }),
  ),
  hole: Schema.optional(
    Schema.Struct({
      state: Schema.Literals(["seated", "gap", "off-centre", "missing", "inside", "solid"]),
      offsetMm: Schema.NullOr(Schema.Tuple([finite, finite])),
    }),
  ),
});
export const EnclosureReport = Schema.Struct({
  board: Schema.String, // assembly part id
  boardRevision: Schema.String, // metadata sourceHash
  status: Schema.Literals(["fits", "tight", "interferes", "incomplete"]),
  frame: Schema.Struct({ mirrored: Schema.Boolean, matchedParts: Schema.Int }),
  findings: Schema.Array(EnclosureFinding).check(Schema.isMaxLength(ENCLOSURE_MAX_FINDINGS)),
  /** Move for the board part, in assembly mm, when the holes agree on one. */
  suggestedMove: Schema.NullOr(Schema.Tuple([finite, finite, finite])),
  warnings: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
  complete: Schema.Boolean,
});

export const EnclosureStarterParams = Schema.Struct({
  wallMm: withDefault(gap(10).check(Schema.isGreaterThan(0.4)), 2),
  floorMm: withDefault(gap(10).check(Schema.isGreaterThan(0.4)), 2),
  lidMm: withDefault(gap(10).check(Schema.isGreaterThan(0.4)), 2),
  sideGapMm: withDefault(gap(10), 0.5),
  topGapMm: withDefault(gap(30), 1),
  /** null: max(3, deepest part below the board + floor gap). */
  standoffHeightMm: withDefault(Schema.NullOr(gap(50)), null),
  /** null: hole diameter + 3 per hole. */
  standoffDiameterMm: withDefault(Schema.NullOr(gap(20)), null),
  /** null: max(1, hole diameter - 0.6) per hole; 0 makes solid standoffs. */
  pilotDiameterMm: withDefault(Schema.NullOr(gap(10)), null),
  cornerRadiusMm: withDefault(gap(20), 1),
  cutoutMarginMm: withDefault(gap(5), 0.5),
  lidLipMm: withDefault(gap(10), 1.5),
  lidLipGapMm: withDefault(gap(2), 0.2),
  /** Height used for parts with no 3D model. 0 ignores them. */
  assumedHeightMm: withDefault(gap(100), ASSUMED_PART_HEIGHT_MM),
  connectors: EnclosureRequirements.fields.connectors,
});

/** Loom's reference names end in "-<first 16 hex of sourceHash>.glb" (PcbPreviewService.ts). */
export const referenceHashPrefix = (path: string): string | null =>
  /-([0-9a-f]{16})\.glb$/i.exec(path)?.[1]?.toLowerCase() ?? null;

export type PcbReferenceMetadata = typeof PcbReferenceMetadata.Type;
export type EnclosureRequirements = typeof EnclosureRequirements.Type;
export type EnclosureRequirementsPatch = typeof EnclosureRequirementsPatch.Type;
export type EnclosureFinding = typeof EnclosureFinding.Type;
export type EnclosureReport = typeof EnclosureReport.Type;
export type EnclosureStarterParams = typeof EnclosureStarterParams.Type;
export const EnclosureStarterParamsInput = Schema.Struct(
  Object.fromEntries(
    Object.entries(EnclosureStarterParams.fields).map(([key, value]) => [
      key,
      Schema.optional(value),
    ]),
  ) as {
    [K in keyof typeof EnclosureStarterParams.fields]: Schema.optional<
      (typeof EnclosureStarterParams.fields)[K]
    >;
  },
);
