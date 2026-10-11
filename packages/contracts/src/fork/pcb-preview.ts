import {
  PcbReviewInput,
  PcbReviewResult,
  PcbLatestReviewResult,
  PcbReviewSettings,
  PcbReviewSettingsUpdate,
} from "./pcb-review.ts";
import * as Fab from "./pcb-fab.ts";
import { PcbPinMapInput, PcbPinMapResult } from "./pcb-pin-map.ts";
import * as W from "./pcb-workspace.ts";
import { PcbPrintInput, PcbPrintResult } from "./pcb-print.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  CheckpointId,
  RunId,
  PositiveInt,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";

export const PCB_PREVIEW_WS_METHODS = {
  fabPackage: "loom.pcb-preview.fabPackage",
  fabPackages: "loom.pcb-preview.fabPackages",
  fabPackageZip: "loom.pcb-preview.fabPackageZip",
  deleteFabPackage: "loom.pcb-preview.deleteFabPackage",
  fabCapabilities: "loom.pcb-preview.fabCapabilities",
  updateFabCapabilities: "loom.pcb-preview.updateFabCapabilities",
  fabCheck: "loom.pcb-preview.fabCheck",
  latestFabCheck: "loom.pcb-preview.latestFabCheck",

  turnDesigns: "loom.pcb-preview.turnDesigns",
  turnDesignEvents: "loom.pcb-preview.turnDesignEvents",
  review: "loom.pcb-preview.review",
  latestReview: "loom.pcb-preview.latestReview",
  pinMap: "loom.pcb-preview.pinMap",
  reuseHardware: "loom.pcb-preview.reuseHardware",
  status: "loom.pcb-preview.status",
  exportReference: "loom.pcb-preview.exportReference",
  workspaceUpdates: "loom.pcb-preview.workspaceUpdates",
  panelEvents: "loom.pcb-preview.panelEvents",
  editorEvents: "loom.pcb-preview.editorEvents",
  editorAction: "loom.pcb-preview.editorAction",
  completeEditorAction: "loom.pcb-preview.completeEditorAction",

  inspect: "loom.pcb-preview.inspect",
  workspace: "loom.pcb-preview.workspace",
  updateWorkspace: "loom.pcb-preview.updateWorkspace",
  changeRequest: "loom.pcb-preview.changeRequest",
  asset: "loom.pcb-preview.asset",
  compare: "loom.pcb-preview.compare",
  revisions: "loom.pcb-preview.revisions",
  parameters: "loom.pcb-preview.parameters",
  applyParameters: "loom.pcb-preview.applyParameters",
  simulate: "loom.pcb-preview.simulate",
  library: "loom.pcb-preview.library",
  updateLibrary: "loom.pcb-preview.updateLibrary",

  listDesigns: "loom.pcb-preview.listDesigns",
  render: "loom.pcb-preview.render",
  readSheet: "loom.pcb-preview.readSheet",
  projectSettings: "loom.pcb-preview.projectSettings",
  updateProjectSettings: "loom.pcb-preview.updateProjectSettings",
  checkEvents: "loom.pcb-preview.checkEvents",
  check: "loom.pcb-preview.check",
  print: "loom.pcb-preview.print",
  watch: "loom.pcb-preview.watch",
  latestChecks: "loom.pcb-preview.latestChecks",
} as const;

export const PcbTurnDesign = Schema.Struct({
  designId: TrimmedNonEmptyString,
  kind: Schema.Literals(["kicad", "tscircuit"]),
  name: Schema.String,
  reason: Schema.Literals(["written", "dependency"]),
  via: Schema.NullOr(Schema.String),
});
export type PcbTurnDesign = typeof PcbTurnDesign.Type;
export const PcbTurnDesigns = Schema.Struct({
  runId: Schema.NullOr(RunId),
  checkpointId: Schema.NullOr(CheckpointId),
  turn: Schema.NullOr(PositiveInt),
  designs: Schema.Array(PcbTurnDesign).check(Schema.isMaxLength(20)),
  truncated: Schema.Boolean,
});
export type PcbTurnDesigns = typeof PcbTurnDesigns.Type;
export const PcbTurnDesignsInput = Schema.Struct({
  threadId: ThreadId,
  runId: Schema.NullOr(RunId),
});
export type PcbTurnDesignsInput = typeof PcbTurnDesignsInput.Type;

export const PcbToolStatus = Schema.Struct({
  found: Schema.Boolean,
  path: Schema.optional(TrimmedNonEmptyString),
  version: Schema.optional(TrimmedNonEmptyString),
  /** "tool-too-old" when found but below the supported version. */
  problem: Schema.optional(Schema.Literals(["not-found", "tool-too-old", "version-failed"])),
});
export type PcbToolStatus = typeof PcbToolStatus.Type;

export const PcbPreviewStatus = Schema.Struct({
  kicad: PcbToolStatus,
  ngspice: Schema.optional(PcbToolStatus),
  /** Global tsci only; a project-local tsci is reported per design by listDesigns. */
  tscircuit: PcbToolStatus,
  checkedAt: IsoDateTime,
});
export type PcbPreviewStatus = typeof PcbPreviewStatus.Type;

export const PcbDesignKind = Schema.Literals(["kicad", "tscircuit"]);
export type PcbDesignKind = typeof PcbDesignKind.Type;
export const PcbView = Schema.Literals(["schematic", "pcb"]);
export type PcbView = typeof PcbView.Type;
export const PcbLayerPreset = Schema.Literals(["front", "back", "all"]);
export type PcbLayerPreset = typeof PcbLayerPreset.Type;

export const PcbDesign = Schema.Struct({
  id: TrimmedNonEmptyString, // workspace-relative entry path
  /** Absolute entry path on the environment host; used only for the Electronics deep link. */
  absolutePath: TrimmedNonEmptyString,
  kind: PcbDesignKind,
  name: TrimmedNonEmptyString,
  schematicPath: Schema.optional(TrimmedNonEmptyString),
  boardPath: Schema.optional(TrimmedNonEmptyString),
  toolAvailable: Schema.Boolean,
  toolStatus: PcbToolStatus,
});
export type PcbDesign = typeof PcbDesign.Type;

export const PcbListDesignsInput = Schema.Struct({ threadId: ThreadId });
export type PcbListDesignsInput = typeof PcbListDesignsInput.Type;
export const PcbListDesignsResult = Schema.Struct({
  designs: Schema.Array(PcbDesign),
  projectId: ProjectId,
  workspaceKey: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
});
export type PcbListDesignsResult = typeof PcbListDesignsResult.Type;

export const PcbRenderInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
  view: PcbView,
  layers: Schema.optional(PcbLayerPreset), // pcb only; default "front"
  layerNames: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(64))),
  force: Schema.optional(Schema.Boolean), // explicit refresh bypasses a completed render cache
});
export type PcbRenderInput = typeof PcbRenderInput.Type;

export const PcbSheet = Schema.Struct({
  id: TrimmedNonEmptyString, // file name inside the render, e.g. "board-power.svg"
  label: TrimmedNonEmptyString,
  bytes: NonNegativeInt,
  tooLarge: Schema.Boolean,
  layer: Schema.optional(Schema.String),
  frame: Schema.optional(W.PcbBounds),
});
export type PcbSheet = typeof PcbSheet.Type;

export const PcbRenderResult = Schema.Struct({
  renderKey: TrimmedNonEmptyString, // sha256 hex, also the cache directory name
  sourceHash: TrimmedNonEmptyString,
  outcome: Schema.Literals(["ok", "failed", "timed-out", "cancelled"]),
  sheets: Schema.Array(PcbSheet),
  exitCode: Schema.optional(Schema.Int),
  log: Schema.String, // last 40 lines of stdout+stderr, capped at 8 KiB
  toolVersion: Schema.optional(TrimmedNonEmptyString),
  renderedAt: IsoDateTime,
  cached: Schema.Boolean,
});
export type PcbRenderResult = typeof PcbRenderResult.Type;

export const PcbReadSheetInput = Schema.Struct({
  threadId: ThreadId,
  renderKey: TrimmedNonEmptyString,
  sheetId: TrimmedNonEmptyString,
});
export type PcbReadSheetInput = typeof PcbReadSheetInput.Type;
export const PcbReadSheetResult = Schema.Struct({ svg: Schema.String });
export type PcbReadSheetResult = typeof PcbReadSheetResult.Type;

export const PcbCheckKind = Schema.Literals(["erc", "drc"]);
export type PcbCheckKind = typeof PcbCheckKind.Type;
export const PcbViolationItem = Schema.Struct({
  description: Schema.String,
  uuid: Schema.optional(Schema.String),
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
});
export type PcbViolationItem = typeof PcbViolationItem.Type;
export const PcbViolation = Schema.Struct({
  id: Schema.optional(Schema.String),
  sheetId: Schema.optional(Schema.String),
  type: Schema.String,
  description: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
  excluded: Schema.Boolean,
  sheet: Schema.optional(Schema.String), // ERC only
  group: Schema.Literals(["violation", "unconnected", "parity"]),
  items: Schema.Array(PcbViolationItem),
});
export type PcbViolation = typeof PcbViolation.Type;
export const PcbCheckInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
  kind: PcbCheckKind,
});
export type PcbCheckInput = typeof PcbCheckInput.Type;
export const PcbCheckCounts = Schema.Struct({
  errors: NonNegativeInt,
  warnings: NonNegativeInt,
  excluded: NonNegativeInt,
});
export type PcbCheckCounts = typeof PcbCheckCounts.Type;

export const PcbCheckTrigger = Schema.Literals(["manual", "auto"]);
export type PcbCheckTrigger = typeof PcbCheckTrigger.Type;
export const PcbCheckDelta = Schema.Struct({
  previousRanAt: IsoDateTime,
  previousSourceHash: TrimmedNonEmptyString,
  newCount: NonNegativeInt,
  resolvedCount: NonNegativeInt,
  added: Schema.Array(TrimmedNonEmptyString),
  resolved: Schema.Array(
    Schema.Struct({ id: TrimmedNonEmptyString, type: Schema.String, description: Schema.String }),
  ),
  approximate: Schema.Boolean,
});
export type PcbCheckDelta = typeof PcbCheckDelta.Type;
export const PcbAutoCheckKind = Schema.Literals(["erc", "drc", "review"]);
export type PcbAutoCheckKind = typeof PcbAutoCheckKind.Type;
export const PcbAutoChecks = Schema.Struct({
  review: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  erc: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  drc: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export const PcbProjectSettings = Schema.Struct({
  review: PcbReviewSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  autoChecks: PcbAutoChecks.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type PcbProjectSettings = typeof PcbProjectSettings.Type;
export const PcbProjectSettingsInput = Schema.Struct({ threadId: ThreadId });
export type PcbProjectSettingsInput = typeof PcbProjectSettingsInput.Type;
export const PcbUpdateProjectSettingsInput = Schema.Struct({
  threadId: ThreadId,
  review: Schema.optional(PcbReviewSettingsUpdate),
  autoChecks: Schema.optional(
    Schema.Struct({
      review: Schema.optional(Schema.Boolean),
      erc: Schema.optional(Schema.Boolean),
      drc: Schema.optional(Schema.Boolean),
    }),
  ),
});
export type PcbUpdateProjectSettingsInput = typeof PcbUpdateProjectSettingsInput.Type;
export const PcbCheckEventsInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
});
export type PcbCheckEventsInput = typeof PcbCheckEventsInput.Type;
export const PcbCheckActivity = Schema.Struct({
  running: Schema.NullOr(
    Schema.Struct({
      kind: PcbAutoCheckKind,
      trigger: PcbCheckTrigger,
      sourceHash: TrimmedNonEmptyString,
    }),
  ),
  paused: Schema.Array(
    Schema.Struct({
      kind: PcbAutoCheckKind,
      reason: Schema.Literals(["slow", "failed"]),
      durationMs: Schema.optional(NonNegativeInt),
    }),
  ),
  ranAt: Schema.Struct({
    review: Schema.optional(IsoDateTime),
    erc: Schema.optional(IsoDateTime),
    drc: Schema.optional(IsoDateTime),
  }),
});
export type PcbCheckActivity = typeof PcbCheckActivity.Type;

export const PcbCheckResult = Schema.Struct({
  trigger: Schema.optional(PcbCheckTrigger),
  durationMs: Schema.optional(NonNegativeInt),
  delta: Schema.optional(PcbCheckDelta),
  counts: PcbCheckCounts,
  kind: PcbCheckKind,
  outcome: Schema.Literals(["clean", "violations", "failed", "timed-out"]),
  sourceHash: TrimmedNonEmptyString,
  violations: Schema.Array(PcbViolation), // capped at 500, sorted errors first
  truncated: Schema.Boolean,
  coordinateUnits: Schema.optional(Schema.String),
  pointsInMm: Schema.optional(Schema.Boolean),
  kicadVersion: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Int),
  log: Schema.String,
  ranAt: IsoDateTime,
});
export type PcbCheckResult = typeof PcbCheckResult.Type;

export const PcbWatchInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
});
export type PcbWatchInput = typeof PcbWatchInput.Type;
/** First element is the current hash; then one element per debounced change. */
export const PcbWatchEvent = Schema.Struct({ sourceHash: TrimmedNonEmptyString });
export type PcbWatchEvent = typeof PcbWatchEvent.Type;

export class PcbPreviewError extends Schema.TaggedError<PcbPreviewError>()("PcbPreviewError", {
  reason: Schema.Literals([
    "thread-not-found",
    "workspace-missing",
    "design-not-found",
    "path-outside-workspace",
    "tool-missing",
    "tool-too-old",
    "render-not-found",
    "sheet-too-large",
    "invalid-report",
    "watch-failed",
    "io-failed",
    "source-limit",
    "unsupported-view",
    "cache-full",
    "conflict",
    "invalid-parameters",
    "simulation-unavailable",
  ]),
  message: Schema.String,
  exitCode: Schema.optional(Schema.Int),
  timedOut: Schema.optional(Schema.Boolean),
}) {}

export const PcbLatestChecksInput = Schema.Struct({
  ensureFresh: Schema.optional(Schema.Boolean),
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
});
export type PcbLatestChecksInput = typeof PcbLatestChecksInput.Type;
export const PcbLatestChecksResult = Schema.Array(PcbCheckResult);
export type PcbLatestChecksResult = typeof PcbLatestChecksResult.Type;

const errors = Schema.Union([PcbPreviewError, EnvironmentAuthorizationError]);

export const PcbPreviewRpcGroup = RpcGroup.make(
  Rpc.make(PCB_PREVIEW_WS_METHODS.print, {
    payload: PcbPrintInput,
    success: PcbPrintResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.reuseHardware, {
    payload: W.PcbReuseHardwareInput,
    success: W.PcbReuseHardwareResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.workspaceUpdates, {
    payload: W.PcbInspectInput,
    success: W.PcbWorkspace,
    error: errors,
    stream: true,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.panelEvents, {
    payload: Schema.Struct({ threadId: ThreadId }),
    success: W.PcbEditorEvent,
    error: errors,
    stream: true,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.editorEvents, {
    payload: W.PcbInspectInput,
    success: W.PcbEditorEvent,
    error: errors,
    stream: true,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.exportReference, {
    payload: W.PcbReferenceInput,
    success: W.PcbReferenceResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.editorAction, {
    payload: W.PcbEditorInput,
    success: W.PcbEditorResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.completeEditorAction, {
    payload: W.PcbCompleteEditorInput,
    success: W.PcbEditorResult,
    error: errors,
  }),

  Rpc.make(PCB_PREVIEW_WS_METHODS.inspect, {
    payload: W.PcbInspectInput,
    success: W.PcbInspection,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.workspace, {
    payload: W.PcbInspectInput,
    success: W.PcbWorkspace,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.changeRequest, {
    payload: W.PcbChangeRequestInput,
    success: W.PcbWorkspace,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.updateWorkspace, {
    payload: W.PcbWorkspaceUpdate,
    success: W.PcbWorkspace,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.asset, {
    payload: W.PcbAssetInput,
    success: W.PcbAsset,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.compare, {
    payload: W.PcbCompareInput,
    success: W.PcbComparison,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.revisions, {
    payload: W.PcbInspectInput,
    success: W.PcbRevisions,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.parameters, {
    payload: W.PcbInspectInput,
    success: W.PcbParameters,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.applyParameters, {
    payload: W.PcbApplyParametersInput,
    success: W.PcbApplyParametersResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.simulate, {
    payload: W.PcbSimulateInput,
    success: W.PcbSimulationResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.library, {
    payload: Schema.Struct({}),
    success: W.PcbHardwareLibrary,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.updateLibrary, {
    payload: W.PcbLibraryUpdate,
    success: W.PcbHardwareLibrary,
    error: errors,
  }),

  Rpc.make(PCB_PREVIEW_WS_METHODS.status, {
    payload: Schema.Struct({}),
    success: PcbPreviewStatus,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.listDesigns, {
    payload: PcbListDesignsInput,
    success: PcbListDesignsResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.render, {
    payload: PcbRenderInput,
    success: PcbRenderResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.readSheet, {
    payload: PcbReadSheetInput,
    success: PcbReadSheetResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.turnDesigns, {
    payload: PcbTurnDesignsInput,
    success: PcbTurnDesigns,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.turnDesignEvents, {
    payload: Schema.Struct({ threadId: ThreadId }),
    success: PcbTurnDesigns,
    error: errors,
    stream: true,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.fabPackage, {
    payload: Fab.PcbFabPackageInput,
    success: Fab.PcbFabPackageResult,
    error: Schema.Union([PcbPreviewError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.fabPackages, {
    payload: Fab.PcbFabPackagesInput,
    success: Schema.Array(Fab.PcbFabPackageSummary),
    error: Schema.Union([PcbPreviewError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.fabPackageZip, {
    payload: Fab.PcbFabPackageRef,
    success: Fab.PcbFabPackageZip,
    error: Schema.Union([PcbPreviewError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.deleteFabPackage, {
    payload: Fab.PcbFabPackageRef,
    success: Schema.Void,
    error: Schema.Union([PcbPreviewError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.fabCapabilities, {
    payload: Schema.Struct({}),
    success: Fab.PcbFabCatalog,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.updateFabCapabilities, {
    payload: Fab.PcbFabCapabilitiesUpdate,
    success: Fab.PcbFabCatalog,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.fabCheck, {
    payload: Fab.PcbFabCheckInput,
    success: Fab.PcbFabCheckResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.latestFabCheck, {
    payload: Fab.PcbFabCheckInput,
    success: Schema.NullOr(Fab.PcbFabCheckResult),
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.review, {
    payload: PcbReviewInput,
    success: PcbReviewResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.latestReview, {
    payload: PcbReviewInput,
    success: PcbLatestReviewResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.pinMap, {
    payload: PcbPinMapInput,
    success: PcbPinMapResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.projectSettings, {
    payload: PcbProjectSettingsInput,
    success: PcbProjectSettings,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.updateProjectSettings, {
    payload: PcbUpdateProjectSettingsInput,
    success: PcbProjectSettings,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.checkEvents, {
    payload: PcbCheckEventsInput,
    success: PcbCheckActivity,
    error: errors,
    stream: true,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.check, {
    payload: PcbCheckInput,
    success: PcbCheckResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.latestChecks, {
    payload: PcbLatestChecksInput,
    success: PcbLatestChecksResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.watch, {
    payload: PcbWatchInput,
    success: PcbWatchEvent,
    error: errors,
    stream: true,
  }),
);
