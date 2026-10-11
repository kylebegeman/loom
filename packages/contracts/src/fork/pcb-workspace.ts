import { EnclosureStarterParamsInput } from "./pcb-enclosure.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { SignedFile } from "./model-preview-3d.ts";
import { ModelCamera, ModelPoint, ModelProjection, ModelSection } from "./model-workspace.ts";
import { CheckpointId, PositiveInt, RunId, NonNegativeInt, ThreadId } from "../baseSchemas.ts";
const text = (max = 200) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const finite = Schema.Number.check(Schema.isFinite());
const list = <S extends Schema.Top>(item: S, max: number) =>
  Schema.Array(item).check(Schema.isMaxLength(max));
export const PcbPoint = Schema.Struct({ x: finite, y: finite });
export type PcbPoint = typeof PcbPoint.Type;
export const PcbFindingSource = Schema.Literals(["erc", "drc", "fab", "review"]);
export const PcbFindingSeverity = Schema.Literals(["error", "warning", "info"]);
/** One finding on a drawing, in millimetres. */
export const PcbFinding = Schema.Struct({
  id: Schema.String,
  source: PcbFindingSource,
  severity: PcbFindingSeverity,
  message: Schema.String,
  sheet: Schema.optional(Schema.String),
  layer: Schema.optional(Schema.String),
  pointMm: PcbPoint,
});
export type PcbFinding = typeof PcbFinding.Type;
export const PcbLocation = Schema.Struct({
  x: finite,
  y: finite,
  sheet: Schema.optional(text(1024)),
});
export const PcbPin = Schema.Struct({
  type: Schema.optional(text(64)),
  baseName: Schema.optional(text(200)),
  number: text(),
  name: Schema.String,
  net: Schema.String,
  pcb: Schema.optional(PcbLocation),
  schematic: Schema.optional(PcbLocation),
});
export const PcbComponent = Schema.Struct({
  id: text(),
  reference: text(),
  value: Schema.String,
  footprint: Schema.String,
  symbol: Schema.optional(text(400)),
  pcb: Schema.optional(PcbLocation),
  schematic: Schema.optional(PcbLocation),
  side: Schema.optional(Schema.Literals(["front", "back"])),
  rotation: Schema.optional(finite),
  heightMm: Schema.optional(finite),
  heightSource: Schema.optional(Schema.Literals(["glb", "circuit-json"])),
  pins: list(PcbPin, 2048),
});
export type PcbComponent = typeof PcbComponent.Type;
export const PcbBounds = Schema.Struct({ x: finite, y: finite, width: finite, height: finite });
export type PcbBounds = typeof PcbBounds.Type;
const mm = Schema.NullOr(finite);
export const PcbBoardStats = Schema.Struct({
  size: Schema.NullOr(Schema.Struct({ width: finite, height: finite })),
  areaMm2: mm,
  areaSource: Schema.Literals(["outline", "bounds", "none"]),
  copperLayers: Schema.Int,
  components: Schema.Struct({ front: Schema.Int, back: Schema.Int }),
  holes: Schema.Struct({ plated: Schema.Int, nonPlated: Schema.Int }),
  vias: Schema.Struct({ through: Schema.Int, blindOrMicro: Schema.Int }),
  measured: Schema.Struct({ drill: mm, track: mm, annularRing: mm, viaDiameter: mm }),
  rules: Schema.NullOr(
    Schema.Struct({
      clearance: mm,
      track: mm,
      drill: mm,
      viaDiameter: mm,
      annularRing: mm,
      holeClearance: mm,
      edgeClearance: mm,
    }),
  ),
  tallest: Schema.NullOr(
    Schema.Struct({
      heightMm: finite,
      side: Schema.Literals(["front", "back"]),
      reference: Schema.NullOr(text()),
      source: Schema.Literals(["glb", "circuit-json"]),
    }),
  ),
  heights: Schema.Literals(["measured", "needs-3d", "no-models", "unsupported"]),
});
export type PcbBoardStats = typeof PcbBoardStats.Type;
export const PcbInspection = Schema.Struct({
  sourceHash: text(),
  components: list(PcbComponent, 5000),
  nets: list(
    Schema.Struct({
      name: text(),
      members: list(Schema.Struct({ reference: text(), pin: text() }), 10000),
    }),
    5000,
  ),
  layers: list(text(), 64),
  layerLabels: Schema.optional(Schema.Record(text(), text())),
  bounds: Schema.NullOr(PcbBounds),
  thickness: finite,
  mountingHoles: list(
    Schema.Struct({
      x: finite,
      y: finite,
      diameter: finite,
      slotLength: finite,
      plated: Schema.optional(Schema.Boolean),
      footprint: Schema.optional(Schema.String),
    }),
    500,
  ),
  warnings: list(Schema.String, 100),
  stats: Schema.optional(PcbBoardStats),
});
export type PcbInspection = typeof PcbInspection.Type;
export const PcbInspectInput = Schema.Struct({ threadId: ThreadId, designId: text(1024) });
export type PcbInspectInput = typeof PcbInspectInput.Type;
export const PcbCamera = Schema.Struct({
  x: finite,
  y: finite,
  scale: finite.check(Schema.isBetween({ minimum: 0.001, maximum: 10000 })),
});
export const PcbLayerState = Schema.Struct({
  name: text(),
  visible: Schema.Boolean,
  opacity: finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
});
export type PcbLayerState = typeof PcbLayerState.Type;
export const PcbSavedView = Schema.Struct({
  id: text(),
  name: text(),
  view: Schema.Literals(["pcb", "schematic"]),
  sheet: Schema.String,
  camera: PcbCamera,
  layers: list(PcbLayerState, 64),
  sourceHash: Schema.String,
});
export const PcbMeasurement = Schema.Struct({
  id: text(),
  kind: Schema.Literals(["distance", "angle"]),
  view: Schema.Literals(["pcb", "schematic"]),
  sheet: Schema.String,
  points: list(PcbPoint, 3).check(Schema.isMinLength(2)),
  sourceHash: text(),
});
export type PcbMeasurement = typeof PcbMeasurement.Type;
export const PcbAnnotation = Schema.Struct({
  id: text(),
  text: text(2000),
  view: Schema.Literals(["pcb", "schematic"]),
  sheet: Schema.String,
  point: PcbPoint,
  sourceHash: text(),
});
export const PcbSimulationSetup = Schema.Struct({
  id: text(),
  name: text(),
  analysis: Schema.Literals(["op", "tran", "ac"]),
  probes: list(text(), 24),
  step: finite.check(Schema.isGreaterThan(0)),
  stop: finite.check(Schema.isGreaterThan(0)),
  startFrequency: finite.check(Schema.isGreaterThan(0)),
  stopFrequency: finite.check(Schema.isGreaterThan(0)),
  points: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 10000 })),
  netlistPath: Schema.String.check(Schema.isMaxLength(1024)),
  sweep: Schema.NullOr(
    Schema.Struct({ parameter: text(100), values: list(finite, 12).check(Schema.isMinLength(1)) }),
  ),
});
export type PcbSimulationSetup = typeof PcbSimulationSetup.Type;
const nullable = <S extends Schema.Top>(s: S) =>
  Schema.NullOr(s).pipe(Schema.withDecodingDefault(Effect.succeed(null)));
export const PCB_SWEEP_LIMIT = 8;
export const PCB_VARIANT_LIMIT = 24;
export const PcbVariantStats = Schema.Struct({
  widthMm: finite,
  heightMm: finite,
  components: NonNegativeInt,
  errors: NonNegativeInt,
  warnings: NonNegativeInt,
  board: Schema.Record(text(60), finite)
    .check(Schema.isMaxProperties(40))
    .pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type PcbVariantStats = typeof PcbVariantStats.Type;
export const PcbVariant = Schema.Struct({
  id: text(),
  name: text(),
  values: Schema.Record(
    text(100),
    Schema.Union([finite, Schema.String.check(Schema.isMaxLength(2000)), Schema.Boolean]),
  ).check(Schema.isMaxProperties(100)),
  sourceHash: text(),
  origin: Schema.Literals(["user", "agent"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("user" as const)),
  ),
  thumbnail: nullable(Schema.String.check(Schema.isMaxLength(24000))),
  renderedRevision: nullable(text()),
  render: nullable(Schema.Struct({ renderKey: text(), sheetId: text(240) })),
  stats: nullable(PcbVariantStats),
  error: nullable(text(2000)),
});
export type PcbVariant = typeof PcbVariant.Type;
export const PcbProposedVariants = list(
  Schema.Struct({ name: text(100), values: PcbVariant.fields.values }),
  PCB_SWEEP_LIMIT,
).check(Schema.isMinLength(1));
export const PcbRequestAnchor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("component"), reference: text() }),
  Schema.Struct({ kind: Schema.Literal("net"), name: text() }),
  Schema.Struct({ kind: Schema.Literal("area"), box: PcbBounds }),
]);
export type PcbRequestAnchor = typeof PcbRequestAnchor.Type;
export const PcbRequestStatus = Schema.Literals(["open", "review", "accepted"]);
export const PcbChangeRequestDraft = Schema.Struct({
  id: text(),
  title: text(120),
  request: text(4000),
  anchor: PcbRequestAnchor,
  view: Schema.Literals(["pcb", "schematic"]),
  sheet: Schema.String,
  point: PcbPoint,
  sourceHash: text(),
  referenceImage: nullable(Schema.String.check(Schema.isMaxLength(24000))),
});
export type PcbChangeRequestDraft = typeof PcbChangeRequestDraft.Type;
export const PcbChangeRequest = Schema.Struct({
  ...PcbChangeRequestDraft.fields,
  createdAt: text(40),
  status: PcbRequestStatus.pipe(Schema.withDecodingDefault(Effect.succeed("open" as const))),
  baseRef: nullable(text(200)),
  sentAt: nullable(text(40)),
  response: nullable(text(2000)),
  reviewRevision: nullable(text()),
  resolvedRevision: nullable(text()),
  resolvedRef: nullable(text(200)),
  resolvedAt: nullable(text(40)),
});
export type PcbChangeRequest = typeof PcbChangeRequest.Type;
export const PcbChangeRequestOperation = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("create"),
    request: PcbChangeRequestDraft,
    sent: Schema.Boolean,
  }),
  Schema.Struct({
    op: Schema.Literal("convert-note"),
    noteId: text(),
    request: PcbChangeRequestDraft,
  }),
  Schema.Struct({
    op: Schema.Literal("edit"),
    id: text(),
    title: Schema.optional(text(120)),
    request: Schema.optional(text(4000)),
  }),
  Schema.Struct({
    op: Schema.Literal("status"),
    id: text(),
    status: PcbRequestStatus,
    response: Schema.optional(Schema.NullOr(text(2000))),
  }),
  Schema.Struct({ op: Schema.Literal("sent"), ids: list(text(), 10).check(Schema.isMinLength(1)) }),
  Schema.Struct({ op: Schema.Literal("remove"), id: text() }),
]);
export type PcbChangeRequestOperation = typeof PcbChangeRequestOperation.Type;
export const PcbChangeRequestInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  expectedVersion: Schema.Int,
  operation: PcbChangeRequestOperation,
});
export type PcbChangeRequestInput = typeof PcbChangeRequestInput.Type;
const layerSet = Schema.Struct({ id: text(), name: text(), layers: list(PcbLayerState, 64) });
// Saved files outlive releases: a collection added later decodes as empty in older files.
const collection = <S extends Schema.Top>(item: S, max: number) =>
  list(item, max).pipe(Schema.withDecodingDefault(Effect.succeed([])));
/** A saved workspace. Saves use `PcbWorkspaceInput`, so leaving a collection out fails instead of erasing it. */
export const PcbWorkspace = Schema.Struct({
  version: Schema.Int,
  views: collection(PcbSavedView, 30),
  layerSets: collection(layerSet, 20),
  measurements: collection(PcbMeasurement, 100),
  annotations: collection(PcbAnnotation, 100),
  simulations: collection(PcbSimulationSetup, 20),
  variants: collection(PcbVariant, 24),
  requests: collection(PcbChangeRequest, 30),
});
export const PcbWorkspaceInput = Schema.Struct({
  version: Schema.Int,
  views: list(PcbSavedView, 30),
  layerSets: list(layerSet, 20),
  measurements: list(PcbMeasurement, 100),
  annotations: list(PcbAnnotation, 100),
  simulations: list(PcbSimulationSetup, 20),
  variants: list(PcbVariant, 24),
  requests: Schema.optional(list(PcbChangeRequest, 30)),
});
export type PcbWorkspace = typeof PcbWorkspace.Type;
export const PcbWorkspaceUpdate = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  expectedVersion: Schema.Int,
  workspace: PcbWorkspaceInput,
});
export type PcbWorkspaceUpdate = typeof PcbWorkspaceUpdate.Type;
export const PcbAssetInput = Schema.Struct({
  checkpointId: Schema.optional(CheckpointId),
  threadId: ThreadId,
  designId: text(1024),
  format: Schema.Literals(["glb", "circuit-json", "spice"]),
  transport: Schema.optional(Schema.Literals(["url", "inline"])),
  force: Schema.optional(Schema.Boolean),
});
export type PcbAssetInput = typeof PcbAssetInput.Type;
export const PcbAsset = Schema.Struct({
  file: Schema.optional(SignedFile),
  format: Schema.Literals(["glb", "circuit-json", "spice"]),
  data: Schema.String,
  sourceHash: text(),
  log: Schema.String,
});
export type PcbAsset = typeof PcbAsset.Type;
export const PcbCompareInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  from: text(200),
  to: Schema.String.check(Schema.isMaxLength(200)),
});
export type PcbCompareInput = typeof PcbCompareInput.Type;
export const PcbChangeField = Schema.Literals([
  "value",
  "footprint",
  "pcb",
  "schematic",
  "orientation",
  "pins",
  "nets",
]);
const locationChange = Schema.Struct({
  from: Schema.optional(PcbLocation),
  to: Schema.optional(PcbLocation),
});
export const PcbComponentChange = Schema.Struct({
  kind: Schema.Literals(["added", "removed", "moved", "changed"]),
  reference: text(),
  value: Schema.String,
  fields: list(PcbChangeField, 7),
  pcb: Schema.optional(locationChange),
  schematic: Schema.optional(locationChange),
});
export type PcbComponentChange = typeof PcbComponentChange.Type;
export const PcbNetChange = Schema.Struct({
  name: text(),
  kind: Schema.Literals(["added", "removed", "changed"]),
  joined: list(Schema.Struct({ reference: text(), pin: text() }), 50),
  left: list(Schema.Struct({ reference: text(), pin: text() }), 50),
});
export type PcbNetChange = typeof PcbNetChange.Type;
export const PcbChangeRegion = PcbBounds;
export type PcbChangeRegion = typeof PcbChangeRegion.Type;
export const PcbChangeState = Schema.Struct({
  shown: Schema.Boolean,
  fromSourceHash: text(),
  toSourceHash: text(),
  components: list(PcbComponentChange, 200),
  nets: list(PcbNetChange, 200),
  regions: list(PcbChangeRegion, 50),
  drawing: Schema.Literals(["pending", "ready", "unavailable"]),
  truncated: Schema.Boolean,
});
export type PcbChangeState = typeof PcbChangeState.Type;
export const PcbComparison = Schema.Struct({
  from: text(),
  to: text(),
  before: PcbInspection,
  after: PcbInspection,
  changes: list(
    Schema.Struct({
      kind: Schema.Literals(["added", "removed", "changed"]),
      reference: text(),
      detail: Schema.String,
    }),
    10000,
  ),
  beforeSvg: Schema.NullOr(Schema.String),
  afterSvg: Schema.NullOr(Schema.String),
  log: Schema.String,
});
export type PcbComparison = typeof PcbComparison.Type;
export const PCB_HISTORY_PAGE_MAX = 50;

export const PcbHistoryInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  /** Exclusive upper bound on the turn number; omit or null for the newest page. */
  cursor: Schema.optional(Schema.NullOr(PositiveInt)),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: PCB_HISTORY_PAGE_MAX })),
  ),
});
export type PcbHistoryInput = typeof PcbHistoryInput.Type;

export const PcbHistoryVersion = Schema.Struct({
  checkpointId: CheckpointId,
  /** Null for the thread's starting state. */
  runId: Schema.NullOr(RunId),
  /** The chat's turn number (appRunOrdinal); 0 is the thread's start. */
  turn: NonNegativeInt,
  capturedAt: Schema.DateTimeUtc,
  /** The checkpoint ref. loom.pcb-preview.compare accepts it as from or to. */
  ref: text(200),
  /** Whether the design's entry file exists at this version. */
  present: Schema.Boolean,
  /** Whether the version has a board and a schematic, from ls-tree of the stem group. */
  views: Schema.Struct({ pcb: Schema.Boolean, schematic: Schema.Boolean }),
  /** Hash over path and blob id of today's design set at this version; null if absent. */
  contentKey: Schema.NullOr(Schema.String),
  /** Workspace-relative paths of today's set that this turn changed. Empty for the start. */
  changed: list(Schema.String, 20),
});
export type PcbHistoryVersion = typeof PcbHistoryVersion.Type;

export const PcbHistory = Schema.Struct({
  /** Newest first. The start, when listed, is last on the final page. */
  versions: list(PcbHistoryVersion, PCB_HISTORY_PAGE_MAX),
  nextCursor: Schema.NullOr(PositiveInt),
  /** The thread's latest ready turn number, for "turn 5 of 9". */
  latestTurn: Schema.NullOr(PositiveInt),
  current: Schema.Struct({ contentKey: Schema.NullOr(Schema.String) }),
  /** True while a run of the thread is not terminal. */
  threadRunning: Schema.Boolean,
  /** Why there can be no history; null when history is available. */
  unavailable: Schema.NullOr(Schema.Literals(["not-git"])),
});
export type PcbHistory = typeof PcbHistory.Type;

export const PcbHistoryRestoreInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  checkpointId: CheckpointId,
  /** Also write supporting files (libraries, tables, assets) that differ. */
  includeSupporting: Schema.Boolean,
  /** Also delete design files that exist today but not at the version. */
  removeAdded: Schema.Boolean,
  /** current.contentKey from the history the client showed. */
  expectedContentKey: Schema.NullOr(Schema.String),
  /** Return the plan without writing. */
  dryRun: Schema.optional(Schema.Boolean),
});
export type PcbHistoryRestoreInput = typeof PcbHistoryRestoreInput.Type;

export const PcbHistoryRestorePlan = Schema.Struct({
  /** Design files that differ from today, written by every restore. */
  design: list(Schema.String, 2000),
  /** Supporting files that differ; written only with includeSupporting. */
  supporting: list(Schema.String, 2000),
  /** Design files today that the version does not have; removed only with removeAdded. */
  added: list(Schema.String, 2000),
  /** KiCad lock files (~name.ext.lck) found beside design files. */
  editorLocks: list(Schema.String, 50),
});
export type PcbHistoryRestorePlan = typeof PcbHistoryRestorePlan.Type;

export const PcbHistoryRestoreResult = Schema.Struct({
  plan: PcbHistoryRestorePlan,
  /** Null for dry runs and when nothing differed. */
  undoId: Schema.NullOr(Schema.String),
  written: list(Schema.String, 4000),
  removed: list(Schema.String, 2000),
});
export type PcbHistoryRestoreResult = typeof PcbHistoryRestoreResult.Type;

export const PcbHistoryUndoInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  undoId: text(100),
});
export type PcbHistoryUndoInput = typeof PcbHistoryUndoInput.Type;

export const PcbRevisions = list(Schema.Struct({ ref: text(), label: Schema.String }), 100);
export const PcbParameter = Schema.Struct({
  key: text(100),
  label: text(),
  description: Schema.String,
  type: Schema.Literals(["number", "string", "boolean"]),
  default: Schema.Union([finite, Schema.String, Schema.Boolean]),
  min: Schema.optional(finite),
  max: Schema.optional(finite),
  step: Schema.optional(finite),
  unit: Schema.optional(Schema.String),
  choices: Schema.optional(list(Schema.Union([finite, Schema.String]), 100)),
});
export type PcbParameter = typeof PcbParameter.Type;
export const PcbParameters = Schema.Struct({
  sourceHash: text(),
  schemaPath: Schema.String,
  source: Schema.String,
  parameters: list(PcbParameter, 100),
  values: Schema.optional(
    Schema.Record(text(100), Schema.Union([finite, Schema.String, Schema.Boolean])),
  ),
});
export type PcbParameters = typeof PcbParameters.Type;
export const PcbApplyParametersInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  expectedSourceHash: text(),
  values: Schema.Record(
    text(100),
    Schema.Union([finite, Schema.String.check(Schema.isMaxLength(2000)), Schema.Boolean]),
  ).check(Schema.isMaxProperties(100)),
  preview: Schema.Boolean,
});
export type PcbApplyParametersInput = typeof PcbApplyParametersInput.Type;
export const PcbApplyParametersResult = Schema.Struct({
  source: Schema.String,
  previous: Schema.String,
  sourceHash: text(),
  applied: Schema.Boolean,
});
export type PcbApplyParametersResult = typeof PcbApplyParametersResult.Type;
export const PcbSimulateInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  setup: PcbSimulationSetup,
});
export type PcbSimulateInput = typeof PcbSimulateInput.Type;
export const PcbSimulationResult = Schema.Struct({
  sourceHash: text(),
  netlistHash: text(),
  outcome: Schema.Literals(["ok", "failed", "timed-out"]),
  log: Schema.String,
  runs: list(
    Schema.Struct({
      label: Schema.String,
      x: list(finite, 10000),
      series: list(
        Schema.Struct({
          name: text(),
          unit: Schema.String,
          values: list(finite, 10000),
          imaginary: Schema.optional(list(finite, 10000)),
        }),
        24,
      ),
    }),
    12,
  ),
  ranAt: Schema.String,
});
export type PcbSimulationResult = typeof PcbSimulationResult.Type;
export const PcbHardware = Schema.Struct({
  id: text(),
  name: text(),
  category: text(),
  description: Schema.String.check(Schema.isMaxLength(4000)),
  manufacturer: Schema.String,
  owned: Schema.Boolean,
  quantity: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10000 })),
  tags: list(text(), 30),
  documentationUrl: Schema.String,
  purchaseUrl: Schema.String,
  license: Schema.String,
  sourceUrl: Schema.String,
  notes: Schema.String.check(Schema.isMaxLength(4000)),
  width: Schema.NullOr(finite),
  height: Schema.NullOr(finite),
  mountingHoles: list(PcbPoint, 30),
  assets: list(
    Schema.Struct({
      kind: Schema.Literals(["schematic", "pcb", "3d", "datasheet", "pinout"]),
      path: text(1024),
      workspaceRoot: text(4096),
    }),
    20,
  ),
});
export type PcbHardware = typeof PcbHardware.Type;
export const PcbHardwareLibrary = Schema.Struct({
  version: Schema.Int,
  items: list(PcbHardware, 300),
});
export type PcbHardwareLibrary = typeof PcbHardwareLibrary.Type;
export const PcbLibraryUpdate = Schema.Struct({
  expectedVersion: Schema.Int,
  library: PcbHardwareLibrary,
});
export type PcbLibraryUpdate = typeof PcbLibraryUpdate.Type;
export const PcbReferenceInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  targetThreadId: Schema.optional(ThreadId),
});
export type PcbReferenceInput = typeof PcbReferenceInput.Type;
export const PcbReferenceResult = Schema.Struct({
  relativePath: Schema.optional(text(4096)),
  path: text(4096),
  metadataPath: text(4096),
  sourceHash: text(),
  targetThreadId: ThreadId,
});
export type PcbReferenceResult = typeof PcbReferenceResult.Type;
const layer3dState = Schema.Literals(["shown", "hidden", "unavailable"]);
/** Display state of the 3D board's part groups. */
export const Pcb3dLayers = Schema.Struct({
  board: layer3dState,
  soldermask: layer3dState,
  copper: layer3dState,
  silkscreen: layer3dState,
  topComponents: layer3dState,
  bottomComponents: layer3dState,
});
export type Pcb3dLayers = typeof Pcb3dLayers.Type;
/** Editor input: only the groups to change. */
export const Pcb3dLayersPatch = Schema.Struct({
  board: Schema.optional(Schema.Boolean),
  soldermask: Schema.optional(Schema.Boolean),
  copper: Schema.optional(Schema.Boolean),
  silkscreen: Schema.optional(Schema.Boolean),
  topComponents: Schema.optional(Schema.Boolean),
  bottomComponents: Schema.optional(Schema.Boolean),
});
export const Pcb3dSide = Schema.Literals(["front", "back"]);
export const Pcb3dSnap = Schema.Literals(["vertex", "midpoint", "edge", "face", "free"]);
/** A distance between two points, or a height (start on the board face, end at the point). */
export const Pcb3dMeasurement = Schema.Struct({
  kind: Schema.Literals(["distance", "height"]),
  start: ModelPoint,
  end: ModelPoint,
  lengthMm: finite,
  snaps: Schema.optional(Schema.Tuple([Pcb3dSnap, Pcb3dSnap])),
  side: Schema.optional(Pcb3dSide),
  reference: Schema.optional(text()),
});
export type Pcb3dMeasurement = typeof Pcb3dMeasurement.Type;
const extreme = Schema.NullOr(
  Schema.Struct({ heightMm: finite, reference: Schema.NullOr(text()) }),
);
export const Pcb3dHeights = Schema.Struct({
  boardThicknessMm: finite,
  /** Highest point of any part above the board's top face. */
  above: extreme,
  /** Lowest point of any part below the board's bottom face, leads included. */
  below: extreme,
  parts: list(
    Schema.Struct({ reference: text(), side: Pcb3dSide, aboveMm: finite, belowMm: finite }),
    100,
  ),
  partCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type Pcb3dHeights = typeof Pcb3dHeights.Type;

export const PcbEditorAction = Schema.Struct({
  requestId: Schema.optional(text()),
  action: Schema.Literals([
    "render-variants",
    "refresh",
    "cancel",
    "checks",
    "finding",
    "markers",
    "changes",
    "prepare-summary",
    "trust",
    "pick",
    "fit",
    "zoom",
    "pan",
    "view",
    "select",
    "net",
    "focus",
    "layers",
    "split",
    "3d",
    "capture",
    "back",
    "forward",
    "tool",
    "open-tools",
    "turn-history",
    "turn-compare",
    "load-view",
    "camera",
    "snapshot",
    "sheet",
    "open",
    "close",
    "maximize",
    "display",
    "section",
    "measure",
    "height",
  ]),
  ids: Schema.optional(list(text(100), PCB_VARIANT_LIMIT)),
  camera: Schema.optional(ModelCamera),
  cameraView: Schema.optional(Schema.Literals(["iso", "top", "front", "right"])),
  view: Schema.optional(Schema.Literals(["pcb", "schematic"])),
  reference: Schema.optional(Schema.String),
  pin: Schema.optional(Schema.String),
  net: Schema.optional(Schema.String),
  point: Schema.optional(PcbPoint),
  factor: Schema.optional(finite.check(Schema.isBetween({ minimum: 0.01, maximum: 100 }))),
  enabled: Schema.optional(Schema.Boolean),
  layers: Schema.optional(list(PcbLayerState, 64)),
  full: Schema.optional(Schema.Boolean),
  format: Schema.optional(Schema.Literals(["png", "svg"])),
  scale: Schema.optional(Schema.Literals([1, 2])),
  attachToDraft: Schema.optional(Schema.Boolean),
  name: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))),
  projection: Schema.optional(ModelProjection),
  section: Schema.optional(ModelSection),
  layers3d: Schema.optional(Pcb3dLayersPatch),
  points: Schema.optional(
    Schema.Array(ModelPoint).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  ),
  snap: Schema.optional(Schema.Boolean),
  side: Schema.optional(Pcb3dSide),
});
export type PcbEditorAction = typeof PcbEditorAction.Type;
export const PcbEditorInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  command: PcbEditorAction,
});
export type PcbEditorInput = typeof PcbEditorInput.Type;
export const PcbEditorEvent = Schema.Struct({
  requestId: text(),
  designId: text(1024),
  command: PcbEditorAction,
});
export type PcbEditorEvent = typeof PcbEditorEvent.Type;
export const PcbEditorResult = Schema.Struct({
  measurement3d: Schema.optional(Pcb3dMeasurement),
  message: Schema.String,
  path: Schema.optional(Schema.String),
  state: Schema.optional(
    Schema.Struct({
      tool3d: Schema.optional(Schema.Literals(["none", "distance", "height"])),
      layers3d: Schema.optional(Pcb3dLayers),
      measurements3d: Schema.optional(list(Pcb3dMeasurement, 20)),
      heights: Schema.optional(Schema.NullOr(Pcb3dHeights)),
      sectionCaps: Schema.optional(
        Schema.Literals(["filled", "partial", "off", "open-mesh", "none", "checking"]),
      ),
      snap3d: Schema.optional(Schema.Literals(["idle", "building", "ready", "off", "failed"])),
      turnHistory: Schema.optional(
        Schema.Struct({
          open: Schema.Boolean,
          checkpointId: Schema.NullOr(CheckpointId),
          turn: Schema.NullOr(NonNegativeInt),
          latestTurn: Schema.NullOr(PositiveInt),
        }),
      ),
      view: Schema.Literals(["pcb", "schematic"]),
      sheet: Schema.String,
      three: Schema.Boolean,
      linked: Schema.Boolean,
      selected: Schema.NullOr(Schema.String),
      net: Schema.NullOr(Schema.String),
      camera: Schema.NullOr(ModelCamera),
      drawingCamera: Schema.NullOr(PcbCamera),
      layers: list(PcbLayerState, 64),
      layerPreset: Schema.optional(Schema.String),
      sourceHash: Schema.optional(Schema.String),
      tool: Schema.optional(
        Schema.Literals(["select", "distance", "angle", "annotate", "request"]),
      ),
      dock: Schema.optional(Schema.NullOr(Schema.String)),
      findings: Schema.optional(
        Schema.Struct({
          visible: Schema.Boolean,
          showExcluded: Schema.Boolean,
          active: Schema.NullOr(Schema.String),
          total: NonNegativeInt,
          items: list(PcbFinding, 50),
        }),
      ),
      changes: Schema.optional(Schema.NullOr(PcbChangeState)),
      loading: Schema.optional(Schema.Boolean),
    }),
  ),
});
export type PcbEditorResult = typeof PcbEditorResult.Type;
export const PcbCompleteEditorInput = Schema.Struct({
  measurement3d: Schema.optional(Pcb3dMeasurement),
  threadId: ThreadId,
  designId: text(1024),
  requestId: text(),
  message: Schema.String,
  error: Schema.optional(Schema.Boolean),
  state: PcbEditorResult.fields.state,
  png: Schema.optional(Schema.String.check(Schema.isMaxLength(12 * 1024 * 1024))),
  svg: Schema.optional(Schema.String.check(Schema.isMaxLength(8 * 1024 * 1024))),
});
export type PcbCompleteEditorInput = typeof PcbCompleteEditorInput.Type;

export const PcbReuseHardwareInput = Schema.Struct({ threadId: ThreadId, itemId: text() });
export const PcbReuseHardwareResult = Schema.Struct({
  files: list(
    Schema.Struct({
      kind: Schema.Literals(["schematic", "pcb", "3d", "datasheet", "pinout"]),
      path: text(4096),
    }),
    20,
  ),
  directory: text(4096),
});

export const PcbEnclosureInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  /** Workspace-relative. Default: "<design dir>/<stem>-enclosure". */
  outputDir: Schema.optional(text(1024)),
  params: Schema.optional(EnclosureStarterParamsInput), // every field optional
  build123d: Schema.optional(Schema.Boolean),
  overwrite: Schema.optional(Schema.Boolean),
  preview: Schema.optional(Schema.Boolean),
});
export const PcbEnclosureResult = Schema.Struct({
  reference: Schema.NullOr(PcbReferenceResult), // null for preview
  assembly: Schema.NullOr(Schema.Struct({ path: text(4096), created: Schema.Boolean })),
  files: Schema.Array(
    Schema.Struct({
      path: text(4096), // workspace-relative
      language: Schema.Literals(["openscad", "build123d"]),
      written: Schema.Boolean,
      source: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_000_000))), // preview only
    }),
  ),
  plan: Schema.Struct({
    outerMm: Schema.Tuple([finite, finite, finite]),
    innerMm: Schema.Tuple([finite, finite, finite]),
    standoffs: Schema.Int,
    cutouts: Schema.Array(text(100)), // connector references
    partsAboveMm: finite,
    partsBelowMm: finite,
  }),
  warnings: Schema.Array(Schema.String),
});

export type PcbEnclosureInput = typeof PcbEnclosureInput.Type;
export type PcbEnclosureResult = typeof PcbEnclosureResult.Type;
