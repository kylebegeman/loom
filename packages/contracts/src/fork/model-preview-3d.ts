import * as Editor from "./model-editor.ts";
import { ModelWorkspace, ModelWorkspaceOperation } from "./model-workspace.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { ThreadId } from "../baseSchemas.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";

export const MODEL_PREVIEW_3D_WS_METHODS = {
  editorAction: "loom.model-preview-3d.editorAction",
  editorEvents: "loom.model-preview-3d.editorEvents",
  panelEvents: "loom.model-preview-3d.panelEvents",
  completeEditorAction: "loom.model-preview-3d.completeEditorAction",
  workspace: "loom.model-preview-3d.workspace",
  updateWorkspace: "loom.model-preview-3d.updateWorkspace",
  cancelVariant: "loom.model-preview-3d.cancelVariant",
  status: "loom.model-preview-3d.status",
  listModels: "loom.model-preview-3d.listModels",
  fileUrl: "loom.model-preview-3d.fileUrl",
  watch: "loom.model-preview-3d.watch",
  parameters: "loom.model-preview-3d.parameters",
  renderScad: "loom.model-preview-3d.renderScad",
  saveParameterSet: "loom.model-preview-3d.saveParameterSet",
  getSettings: "loom.model-preview-3d.getSettings",
  updateSettings: "loom.model-preview-3d.updateSettings",
  clearCache: "loom.model-preview-3d.clearCache",
} as const;

/** 3MF core units normalized to Loom's millimetres. */
export const THREE_MF_UNIT_MM = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
} as const;

export const ModelFormat = Schema.Literals(["stl", "3mf", "obj", "glb", "gltf", "scad", "step"]);

export const ModelFileRef = Schema.Struct({
  threadId: ThreadId,
  /** Workspace-relative path. */
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
});

export const ModelEntry = Schema.Struct({
  path: Schema.String,
  format: ModelFormat,
  sizeBytes: Schema.Number,
  modifiedAt: Schema.String,
});

export const OpenScadInfo = Schema.Struct({
  path: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String), // "2026.09.22" or "2021.01"
  isSnapshot: Schema.Boolean,
  supportsManifold: Schema.Boolean, // snapshot >= 2024.09.28
  supportsColors: Schema.Boolean,
  supportsSummary: Schema.Boolean, // --summary / --summary-file
});

export const ModelPreviewStatus = Schema.Struct({
  openscad: OpenScadInfo,
  maxFileBytes: Schema.Number,
});

export const SignedFile = Schema.Struct({
  /** Relative to the environment's HTTP base URL; resolve with resolveAssetUrl. */
  relativeUrl: Schema.String,
  expiresAt: Schema.Number,
  sizeBytes: Schema.Number,
  modifiedAt: Schema.String,
  /** Changes whenever the bytes change; used as the viewer's cache key. */
  revision: Schema.String,
});

export const ModelWatchEvent = Schema.Struct({
  path: Schema.String,
  revision: Schema.NullOr(Schema.String), // null when the file disappeared
  /** For .scad: true when an included file changed, not the file itself. */
  dependencyChanged: Schema.Boolean,
});

export const ScadParameter = Schema.Struct({
  name: Schema.String,
  group: Schema.String, // the /* [Tab] */ group, "" for none
  description: Schema.NullOr(Schema.String),
  kind: Schema.Literals(["number", "string", "boolean", "vector"]),
  defaultValue: Schema.String, // OpenSCAD literal as written
  range: Schema.NullOr(
    Schema.Struct({ min: Schema.Number, max: Schema.Number, step: Schema.NullOr(Schema.Number) }),
  ),
  options: Schema.NullOr(
    Schema.Array(Schema.Struct({ value: Schema.String, label: Schema.String })),
  ),
});

export const ScadParameters = Schema.Struct({
  sourceRevision: Schema.String,
  parameters: Schema.Array(ScadParameter),
  setValues: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
  sets: Schema.Array(Schema.String), // names in the customizer JSON sidecar
  lastUsed: Schema.Record(Schema.String, Schema.String), // name -> OpenSCAD literal
  lastUsedSet: Schema.NullOr(Schema.String),
});

export const ScadRenderInput = Schema.Struct({
  variantId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
  file: ModelFileRef,
  /** name -> OpenSCAD literal; validated server-side. */
  overrides: Schema.Record(Schema.String, Schema.String),
  parameterSet: Schema.NullOr(Schema.String),
});

export const ScadRenderResult = Schema.Struct({
  status: Schema.Literals(["ok", "error", "cancelled"]),
  mesh: Schema.NullOr(SignedFile), // binary STL or 3MF
  meshFormat: Schema.NullOr(Schema.Literals(["stl", "3mf"])),
  cached: Schema.Boolean,
  durationMs: Schema.Number,
  log: Schema.Array(
    Schema.Struct({
      level: Schema.Literals(["echo", "warning", "error", "trace", "info"]),
      text: Schema.String,
    }),
  ),
  summary: Schema.NullOr(
    Schema.Struct({
      manifold: Schema.NullOr(Schema.Boolean),
      facets: Schema.NullOr(Schema.Int),
      vertices: Schema.NullOr(Schema.Int),
      boundingBox: Schema.NullOr(
        Schema.Struct({ min: Schema.Array(Schema.Number), max: Schema.Array(Schema.Number) }),
      ),
    }),
  ),
});

type BuildPlatePreset = {
  readonly label: string;
  readonly kind: "printer" | "surface";
  /** X, Y and Z in mm. A surface has no height limit, so its Z is null. */
  readonly volumeMm: readonly [number, number, number | null];
  readonly note: string | null;
};

/**
 * Beds offered in the viewport, settings and the Part tab, in menu order: printers, then flat
 * surfaces to compare a part against. To add one, add an entry with a stable id: the setting
 * schema, menus and fit checks all read this table. Printer volumes are vendor build volumes.
 */
export const BUILD_PLATE_PRESETS = {
  "bambu-h2d": {
    label: "Bambu Lab H2D",
    kind: "printer",
    volumeMm: [350, 320, 325],
    note: "Left nozzle: 325 × 320 × 320 mm. Right nozzle: 325 × 320 × 325 mm. Both nozzles: 300 × 320 × 320 mm.",
  },
  "bambu-h2c": {
    label: "Bambu Lab H2C",
    kind: "printer",
    volumeMm: [330, 320, 325],
    note: "Left nozzle: 325 × 320 × 320 mm. Right nozzle: 305 × 320 × 325 mm. Both nozzles: 300 × 320 × 320 mm.",
  },
  "bambu-x1-p1-a1": {
    label: "Bambu Lab X1, P1, A1",
    kind: "printer",
    volumeMm: [256, 256, 256],
    note: null,
  },
  "bambu-a1-mini": {
    label: "Bambu Lab A1 mini",
    kind: "printer",
    volumeMm: [180, 180, 180],
    note: null,
  },
  "anycubic-kobra-s1": {
    label: "Anycubic Kobra S1",
    kind: "printer",
    volumeMm: [250, 250, 250],
    note: null,
  },
  "prusa-core-one": {
    label: "Prusa CORE One",
    kind: "printer",
    volumeMm: [250, 220, 270],
    note: null,
  },
  "prusa-mk4s": { label: "Prusa MK4S", kind: "printer", volumeMm: [250, 210, 220], note: null },
  "prusa-mini": { label: "Prusa MINI+", kind: "printer", volumeMm: [180, 180, 180], note: null },
  "creality-k1-max": {
    label: "Creality K1 Max",
    kind: "printer",
    volumeMm: [300, 300, 300],
    note: null,
  },
  "creality-ender-3-v3": {
    label: "Creality Ender-3 V3",
    kind: "printer",
    volumeMm: [220, 220, 250],
    note: null,
  },
  "sheet-a4": { label: "A4 sheet", kind: "surface", volumeMm: [297, 210, null], note: null },
  "sheet-letter": {
    label: "US Letter sheet",
    kind: "surface",
    volumeMm: [279.4, 215.9, null],
    note: null,
  },
  "mat-12in": {
    label: "12 in square",
    kind: "surface",
    volumeMm: [304.8, 304.8, null],
    note: null,
  },
  "plane-1m": { label: "1 m square", kind: "surface", volumeMm: [1000, 1000, null], note: null },
} as const satisfies Record<string, BuildPlatePreset>;

export const BuildPlatePresetId = Schema.Literals([
  ...(Object.keys(BUILD_PLATE_PRESETS) as (keyof typeof BUILD_PLATE_PRESETS)[]),
  "custom",
]);

/** The lines drawn on the bed: a 10 mm grid, a 1 in grid with quarter-inch lines, or only the outline. */
export const BuildPlatePattern = Schema.Literals(["grid-mm", "grid-inch", "plain"]);

export const BuildPlateSetting = Schema.Struct({
  preset: BuildPlatePresetId,
  /** Used only when preset is "custom"; each axis 10 to 2000 mm. */
  customMm: Schema.Tuple([
    Schema.Number.check(Schema.isBetween({ minimum: 10, maximum: 2000 })),
    Schema.Number.check(Schema.isBetween({ minimum: 10, maximum: 2000 })),
    Schema.Number.check(Schema.isBetween({ minimum: 10, maximum: 2000 })),
  ]),
  pattern: BuildPlatePattern.pipe(Schema.withDecodingDefault(Effect.succeed("grid-mm" as const))),
});

export const ModelPreviewSettings = Schema.Struct({
  openscadPath: Schema.NullOr(Schema.String),
  backend: Schema.Literals(["auto", "manifold", "cgal"]),
  renderTimeoutSeconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 600 })), // default 120
  renderColors: Schema.Boolean, // 3MF output with colors; default false (binary STL)
  maxFileMegabytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2048 })), // default 150
  buildPlate: BuildPlateSetting, // default H2D, custom 350 x 320 x 325, 10 mm grid
  fabricationUrl: Schema.NullOr(
    Schema.String.check(
      Schema.makeFilter(
        (value) => {
          try {
            return ["http:", "https:"].includes(new URL(value).protocol);
          } catch {
            return false;
          }
        },
        { message: "Use an http or https Fabrication URL." },
      ),
    ),
  ),
  agentToolEnabled: Schema.Boolean, // default true
});

export class ModelPreviewError extends Schema.TaggedError<ModelPreviewError>()(
  "ModelPreviewError",
  {
    reason: Schema.Literals([
      "workspace-not-found",
      "not-found",
      "invalid-path",
      "unsupported-format", // includes STEP, which stays with the Fabrication app
      "too-large",
      "openscad-missing",
      "invalid-parameter",
      "timeout",
      "command-failed",
    ]),
    message: Schema.String,
  },
) {}
export type ModelFormat = typeof ModelFormat.Type;
export type ModelFileRef = typeof ModelFileRef.Type;
export type ModelEntry = typeof ModelEntry.Type;
export type OpenScadInfo = typeof OpenScadInfo.Type;
export type ModelPreviewStatus = typeof ModelPreviewStatus.Type;
export type SignedFile = typeof SignedFile.Type;
export type ModelWatchEvent = typeof ModelWatchEvent.Type;
export type ScadParameter = typeof ScadParameter.Type;
export type ScadParameters = typeof ScadParameters.Type;
export type ScadRenderInput = typeof ScadRenderInput.Type;
export type ScadRenderResult = typeof ScadRenderResult.Type;
export type BuildPlatePresetId = typeof BuildPlatePresetId.Type;
export type BuildPlatePattern = typeof BuildPlatePattern.Type;
export type BuildPlateSetting = typeof BuildPlateSetting.Type;
export type ModelPreviewSettings = typeof ModelPreviewSettings.Type;

export const DEFAULT_MODEL_PREVIEW_SETTINGS: ModelPreviewSettings = {
  openscadPath: null,
  backend: "auto",
  renderTimeoutSeconds: 120,
  renderColors: false,
  maxFileMegabytes: 150,
  buildPlate: { preset: "bambu-h2d", customMm: [350, 320, 325], pattern: "grid-mm" },
  fabricationUrl: null,
  agentToolEnabled: true,
};
const rpc = <const Tag extends string, Payload extends Schema.Top, Success extends Schema.Top>(
  tag: Tag,
  payload: Payload,
  success: Success,
) =>
  Rpc.make(tag, {
    payload,
    success,
    error: Schema.Union([ModelPreviewError, EnvironmentAuthorizationError]),
  });
export const ModelPreview3dRpcGroup = RpcGroup.make(
  Rpc.make(MODEL_PREVIEW_3D_WS_METHODS.editorAction, {
    payload: Editor.ModelEditorInput,
    success: Editor.ModelEditorResult,
    error: Schema.Union([ModelPreviewError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(MODEL_PREVIEW_3D_WS_METHODS.completeEditorAction, {
    payload: Editor.ModelEditorComplete,
    success: Editor.ModelEditorResult,
    error: Schema.Union([ModelPreviewError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(MODEL_PREVIEW_3D_WS_METHODS.editorEvents, {
    payload: ModelFileRef,
    success: Editor.ModelEditorEvent,
    error: Schema.Union([ModelPreviewError, EnvironmentAuthorizationError]),
    stream: true,
  }),
  Rpc.make(MODEL_PREVIEW_3D_WS_METHODS.panelEvents, {
    payload: Schema.Struct({ threadId: ThreadId }),
    success: Editor.ModelEditorEvent,
    error: Schema.Union([ModelPreviewError, EnvironmentAuthorizationError]),
    stream: true,
  }),

  Rpc.make(MODEL_PREVIEW_3D_WS_METHODS.workspace, {
    payload: ModelFileRef,
    success: ModelWorkspace,
    error: Schema.Union([ModelPreviewError, EnvironmentAuthorizationError]),
    stream: true,
  }),
  rpc(
    MODEL_PREVIEW_3D_WS_METHODS.updateWorkspace,
    Schema.Struct({ file: ModelFileRef, operation: ModelWorkspaceOperation }),
    ModelWorkspace,
  ),
  rpc(
    MODEL_PREVIEW_3D_WS_METHODS.cancelVariant,
    Schema.Struct({ file: ModelFileRef, variantId: Schema.String }),
    Schema.Void,
  ),
  rpc(
    MODEL_PREVIEW_3D_WS_METHODS.status,
    Schema.Struct({ refresh: Schema.optional(Schema.Boolean) }),
    ModelPreviewStatus,
  ),
  rpc(
    MODEL_PREVIEW_3D_WS_METHODS.listModels,
    Schema.Struct({ threadId: ThreadId }),
    Schema.Struct({ models: Schema.Array(ModelEntry), truncated: Schema.Boolean }),
  ),
  rpc(
    MODEL_PREVIEW_3D_WS_METHODS.fileUrl,
    Schema.Struct({ ...ModelFileRef.fields, allowLarge: Schema.optional(Schema.Boolean) }),
    SignedFile,
  ),
  Rpc.make(MODEL_PREVIEW_3D_WS_METHODS.watch, {
    payload: ModelFileRef,
    success: ModelWatchEvent,
    error: Schema.Union([ModelPreviewError, EnvironmentAuthorizationError]),
    stream: true,
  }),
  rpc(MODEL_PREVIEW_3D_WS_METHODS.parameters, ModelFileRef, ScadParameters),
  rpc(MODEL_PREVIEW_3D_WS_METHODS.renderScad, ScadRenderInput, ScadRenderResult),
  rpc(
    MODEL_PREVIEW_3D_WS_METHODS.saveParameterSet,
    Schema.Struct({
      file: ModelFileRef,
      name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
      values: Schema.Record(Schema.String, Schema.String),
    }),
    ScadParameters,
  ),
  rpc(MODEL_PREVIEW_3D_WS_METHODS.getSettings, Schema.Struct({}), ModelPreviewSettings),
  rpc(MODEL_PREVIEW_3D_WS_METHODS.updateSettings, ModelPreviewSettings, ModelPreviewSettings),
  rpc(MODEL_PREVIEW_3D_WS_METHODS.clearCache, Schema.Struct({}), Schema.Void),
);
