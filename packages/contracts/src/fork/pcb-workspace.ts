import * as Schema from "effect/Schema";
import { SignedFile } from "./model-preview-3d.ts";
import { ModelCamera } from "./model-workspace.ts";
import { ThreadId } from "../baseSchemas.ts";
const text = (max = 200) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const finite = Schema.Number.check(Schema.isFinite());
const list = <S extends Schema.Top>(item: S, max: number) =>
  Schema.Array(item).check(Schema.isMaxLength(max));
export const PcbPoint = Schema.Struct({ x: finite, y: finite });
export type PcbPoint = typeof PcbPoint.Type;
export const PcbLocation = Schema.Struct({
  x: finite,
  y: finite,
  sheet: Schema.optional(text(1024)),
});
export const PcbPin = Schema.Struct({
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
  pcb: Schema.optional(PcbLocation),
  schematic: Schema.optional(PcbLocation),
  pins: list(PcbPin, 2048),
});
export type PcbComponent = typeof PcbComponent.Type;
export const PcbBounds = Schema.Struct({ x: finite, y: finite, width: finite, height: finite });
export type PcbBounds = typeof PcbBounds.Type;
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
    Schema.Struct({ x: finite, y: finite, diameter: finite, slotLength: finite }),
    500,
  ),
  warnings: list(Schema.String, 100),
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
export const PcbVariant = Schema.Struct({
  id: text(),
  name: text(),
  values: Schema.Record(
    text(100),
    Schema.Union([finite, Schema.String.check(Schema.isMaxLength(2000)), Schema.Boolean]),
  ).check(Schema.isMaxProperties(100)),
  sourceHash: text(),
});
export const PcbWorkspace = Schema.Struct({
  version: Schema.Int,
  views: list(PcbSavedView, 30),
  layerSets: list(Schema.Struct({ id: text(), name: text(), layers: list(PcbLayerState, 64) }), 20),
  measurements: list(PcbMeasurement, 100),
  annotations: list(PcbAnnotation, 100),
  simulations: list(PcbSimulationSetup, 20),
  variants: list(PcbVariant, 24),
});
export type PcbWorkspace = typeof PcbWorkspace.Type;
export const PcbWorkspaceUpdate = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  expectedVersion: Schema.Int,
  workspace: PcbWorkspace,
});
export type PcbWorkspaceUpdate = typeof PcbWorkspaceUpdate.Type;
export const PcbAssetInput = Schema.Struct({
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
  path: text(4096),
  metadataPath: text(4096),
  sourceHash: text(),
  targetThreadId: ThreadId,
});
export type PcbReferenceResult = typeof PcbReferenceResult.Type;
export const PcbEditorAction = Schema.Struct({
  action: Schema.Literals([
    "refresh",
    "cancel",
    "checks",
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
    "load-view",
    "camera",
    "snapshot",
    "sheet",
    "open",
    "close",
    "maximize",
  ]),
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
  attachToDraft: Schema.optional(Schema.Boolean),
  name: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))),
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
  message: Schema.String,
  path: Schema.optional(Schema.String),
  state: Schema.optional(
    Schema.Struct({
      view: Schema.Literals(["pcb", "schematic"]),
      sheet: Schema.String,
      three: Schema.Boolean,
      linked: Schema.Boolean,
      selected: Schema.NullOr(Schema.String),
      net: Schema.NullOr(Schema.String),
      camera: Schema.NullOr(ModelCamera),
      drawingCamera: Schema.NullOr(PcbCamera),
      layers: list(PcbLayerState, 64),
      sourceHash: Schema.optional(Schema.String),
      tool: Schema.optional(Schema.Literals(["select", "distance", "angle", "annotate"])),
      dock: Schema.optional(Schema.NullOr(Schema.String)),
      loading: Schema.optional(Schema.Boolean),
    }),
  ),
});
export type PcbEditorResult = typeof PcbEditorResult.Type;
export const PcbCompleteEditorInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  requestId: text(),
  message: Schema.String,
  error: Schema.optional(Schema.Boolean),
  state: PcbEditorResult.fields.state,
  png: Schema.optional(Schema.String.check(Schema.isMaxLength(12 * 1024 * 1024))),
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
