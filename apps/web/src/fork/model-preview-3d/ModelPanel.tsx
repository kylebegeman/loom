import styles from "./workspace.module.css";
import { Atom } from "effect/reactivity";
import type { ModelEditorEvent } from "@t3tools/contracts/fork";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "@tanstack/react-router";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useAgentModelMarks } from "./agentModelMarks";
import { useServerConfigs } from "~/state/entities";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import {
  BoxIcon,
  CheckIcon,
  FileCode2Icon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  PanelRightIcon,
  Settings2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import {
  bedFitSummary,
  modelFormatOf,
  isSourceFormat,
  OVERHANG_ANGLE,
  type ModelProjection,
  type ModelMeasurement,
  type ModelEntry,
  type ModelPreviewSettings,
  type ModelSavedView,
  type ModelSection,
  type ScadRenderResult,
  type ModelWall,
  type PrintFinding,
  type PrintCheckReport,
  type ModelHistoryVersionResult,
  type ModelHistory,
} from "@t3tools/contracts/fork";
import type { CheckpointId, ScopedThreadRef } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "~/components/ui/menu";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { randomUUID } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { forkPanelSurface } from "../panels/registry";
import type { ForkPanelProps } from "../panels/types";
import { models, modelUrl, runModelCommand } from "./state";
import { OperationStatus, type OperationProgress } from "./OperationStatus";
import { ScadFile, type ScadSession } from "./ScadCustomizer";
import { useModelEditing } from "./useModelEditing";
import { usePrintCheck } from "./usePrintCheck";
import type { SectionCapState } from "./viewer/sectionCaps";
import { MarkupSection, openRequestCount, type MarkupActions } from "./MarkupSection";
import { ViewsSection } from "./ViewsSection";
import { VariantsInspector } from "./VariantsInspector";
import type { ModelCamera } from "@t3tools/contracts/fork";
import { ModelPicker } from "./ModelPicker";
import {
  InspectorTabs,
  PartSection,
  defaultInspectorTab,
  resolveInspectorTab,
  type InspectorBadge,
  type InspectorTab,
} from "./ModelInspector";
import { fitPlate, resolvePlate } from "./buildPlate";
import { OverhangLegend } from "./OverhangLegend";
import { useOverhangAngleSetting } from "./overhangSettings";
import { BedPicker, useScaleReference } from "./BedPicker";
import { Segmented } from "./controls";
import { GHOST_TRIANGLE_LIMIT } from "./viewer/ghost";
import { previousGeometry, type PreviewGeometry } from "./previousModel";
import {
  DisplayUnitsProvider,
  formatLength,
  formatLengths,
  unitName,
  useDisplayUnitsSetting,
} from "./units";
import {
  canCopyImages,
  captureFileName,
  copyImage,
  saveImage,
  type ExportAction,
} from "./captureExport";
import { toastManager } from "~/components/ui/toast";
import { changedParameters } from "./params";
import { captureNamedViews, thumbnail } from "./viewer/captureSheet";
import { attachModelImage, captureToComposer, captureBase64 } from "./capture";
import { type ModelViewer, type NavigationMode } from "./viewer/createViewer";
import type { View } from "./viewer/views";
import { loadModel, disposeModel, meshStats } from "./viewer/load";
import { Group, type Object3D } from "three";
import { useModelHistory } from "./useModelHistory";
import { HistoryControls } from "./HistoryControls";
import { HistoryStrip } from "./HistoryStrip";
import { RestoreVersionDialog } from "./RestoreVersionDialog";
import { historyChips, sizeDelta, stepChip, viewingLabel } from "./history";
import { usePrinterLibrary } from "./printers";
import { ExportStep } from "./ExportStep";
import { useSlicing } from "./useSlicing";
import { LayerSlider } from "./LayerSlider";
import AssemblyPanel from "./AssemblyPanel";
import { onModelAction } from "./actions";
import { nudgeFor } from "./viewer/keyboard";
import { announcement, type AnnounceInput } from "./announce";
import { buildPlateLabel } from "./buildPlate";
import {
  CaptureMenu,
  DisplayTools,
  ModelTool,
  NavigationTools,
  PreviousChip,
  SectionStrip,
  ToolHint,
  ToolRail,
  ViewTools,
  type PickTool,
} from "./WorkspaceTools";

export { ModelPicker } from "./ModelPicker";
const idleEditor = Atom.make(AsyncResult.initial<typeof ModelEditorEvent.Type, never>());
const ViewerCanvas = lazy(() => import("./viewer/ViewerCanvas"));
const failureMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

function ModelFile({
  threadRef,
  path,
  visible,
  settings,
}: {
  threadRef: ScopedThreadRef;
  path: string;
  visible: boolean;
  settings: ModelPreviewSettings;
}) {
  const agentMark = useAgentModelMarks((state) => state.marks[scopedThreadKey(threadRef)]?.[path]);
  useEffect(() => {
    if (visible && agentMark) useAgentModelMarks.getState().clear(scopedThreadKey(threadRef), path);
  }, [visible, agentMark, threadRef, path]);
  const latestSettings = useRef(settings);
  const readSettings = useCallback(() => latestSettings.current, []);
  const unitsControl = useDisplayUnitsSetting(threadRef.environmentId, settings, readSettings);
  const referenceControl = useScaleReference(threadRef.environmentId, settings, readSettings);
  const angleControl = useOverhangAngleSetting(threadRef.environmentId, settings, readSettings);
  const configs = useServerConfigs();
  const features = loomFeaturesOf(configs.get(threadRef.environmentId)?.environment.capabilities);
  const adjustableOverhangs = features.includes("model-overhangs");
  const supportsOrientation = features.includes("model-lay-flat");
  const supportsCaps = features.includes("model-section-caps");
  const supportsPrintCheck = features.includes("model-print-check");
  const supportsHistory = features.includes("model-history");
  const supportsPython = features.includes("model-python-cad");
  const supportsSlicing = features.includes("model-slicer");
  const library = usePrinterLibrary(threadRef.environmentId);
  const displaySettings = useMemo(
    () => ({
      ...settings,
      displayUnits: unitsControl.units,
      scaleReference: referenceControl.reference,
      overhangAngleDegrees: angleControl.angle,
    }),
    [settings, unitsControl.units, referenceControl.reference, angleControl.angle],
  );
  useLayoutEffect(() => {
    latestSettings.current = displaySettings;
  }, [displaySettings]);
  const units = unitsControl.units;
  const file = useMemo(() => ({ threadId: threadRef.threadId, path }), [threadRef.threadId, path]);
  const format = modelFormatOf(path) ?? "stl";
  const sourceFormat = isSourceFormat(format);
  const pythonFormat = format === "build123d" || format === "step";
  const pythonUnavailable = pythonFormat && !supportsPython;
  const savedView = useRef<ReturnType<ModelViewer["snapshot"]> | null>(null);
  const viewer = useRef<ModelViewer | null>(null),
    [revision, setRevision] = useState(0),
    [mesh, setMesh] = useState<{
      url: string;
      format: ModelEntry["format"];
      revision: string;
    } | null>(null),
    [stats, setStats] = useState<ReturnType<typeof meshStats> | null>(null),
    [error, setError] = useState<string | null>(null),
    [progress, setProgress] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [resolvedKey, setResolvedKey] = useState<string | null>(null),
    [render, setRender] = useState<ScadRenderResult | null>(null),
    [allowLarge, setAllowLarge] = useState(false),
    [tooLarge, setTooLarge] = useState(false),
    [capturing, setCapturing] = useState(false),
    [success, setSuccess] = useState<string | null>(null),
    [captureError, setCaptureError] = useState<{ title: string; message: string } | null>(null),
    [release, setRelease] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(sourceFormat),
    [inspectorExpanded, setInspectorExpanded] = useState(false),
    [inspectorTab, setInspectorTab] = useState<InspectorTab>(defaultInspectorTab(sourceFormat)),
    [activeView, setActiveView] = useState<View | null>("iso"),
    [activeViewId, setActiveViewId] = useState<string | null>(null),
    [navigationMode, setNavigationMode] = useState<NavigationMode>("orbit"),
    [display, setDisplay] = useState({
      findings: true,
      wireframe: false,
      overhangs: false,
      grid: true,
      axes: false,
      projection: "perspective" as ModelProjection,
    });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<{
    checkpointId: CheckpointId;
    turn: number;
    status: "loading" | "ready" | "error" | "absent";
    mesh: typeof mesh;
    stats: ReturnType<typeof meshStats> | null;
    result: ModelHistoryVersionResult | null;
    error: string | null;
  } | null>(null);
  const viewingHistory = viewing !== null;
  const historyViewingRef = useRef(viewingHistory);
  const liveMeshRevision = useRef(mesh?.revision ?? "");
  useLayoutEffect(() => {
    historyViewingRef.current = viewingHistory;
    liveMeshRevision.current = mesh?.revision ?? "";
  }, [viewingHistory, mesh?.revision]);
  const [comparing, setComparing] = useState<CheckpointId | "now" | null>(null);
  const [compareGeometry, setCompareGeometry] = useState<{
    model: Object3D;
    stats: ReturnType<typeof meshStats>;
  } | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [undo, setUndo] = useState<{ id: string; busy: boolean; error: string | null } | null>(
    null,
  );
  const historyRequest = useRef(0);
  const canRestore = useAtomValue(models.historyRestore.permissionAtom(threadRef.environmentId));
  const canUndo = useAtomValue(models.historyUndo.permissionAtom(threadRef.environmentId));
  const canExportStep = useAtomValue(models.exportStep.permissionAtom(threadRef.environmentId));
  const canRenderModel = useAtomValue(models.renderModel.permissionAtom(threadRef.environmentId));
  const canRenderFormat = format !== "build123d" || canRenderModel;
  const canRender = useAtomValue(models.render.permissionAtom(threadRef.environmentId));
  const [variantActivity, setVariantActivity] = useState<OperationProgress | null>(null);
  const [session, setSession] = useState<ScadSession | null>(null);
  const [geometryRevision, setGeometryRevision] = useState("");
  const [previous, setPrevious] = useState<PreviewGeometry | null>(null);
  const [previousShown, setPreviousShown] = useState(false);
  const [previousTooLarge, setPreviousTooLarge] = useState(false);
  const [changed, setChanged] = useState<"chip" | "dismissed" | null>(null);
  const [snapStatus, setSnapStatus] = useState<ReturnType<ModelViewer["snapStatus"]>>("idle");
  const [sectionCaps, setSectionCaps] = useState<SectionCapState>("none");
  const [selection, setSelection] = useState<{ report: PrintCheckReport; id: string } | null>(null);
  const [printRunRequest, setPrintRunRequest] = useState(0);
  const loadedGeometry = useRef<PreviewGeometry | null>(null);
  const reloadCause = useRef<"watch" | null>(null);
  const lastWatchedRevision = useRef<string | null>(null);
  const showPrevious = (shown: boolean) => {
    if (!previous || !viewer.current?.hasPrevious()) return;
    viewer.current.showPrevious(shown);
    setPreviousShown(shown);
  };
  const togglePrevious = () => showPrevious(!previousShown);
  const editing = useModelEditing(threadRef, path, viewer, geometryRevision, session);
  const slicing = useSlicing({
    threadRef,
    path,
    format,
    geometryRevision,
    session,
    settings: displaySettings,
    orientation: editing.orientation,
    active: !viewing && visible && inspectorOpen && inspectorTab === "part",
    enabled: !viewing && supportsSlicing && visible && canRenderFormat,
  });
  const layersShown = slicing.shown && !viewing;
  const showLayers = (enabled?: boolean) =>
    void slicing
      .toggleLayers(enabled)
      .catch((cause: unknown) => toastManager.add({ type: "error", title: failureMessage(cause) }));
  const printCheck = usePrintCheck({
    threadRef,
    path,
    format,
    geometryRevision,
    session,
    settings: displaySettings,
    orientation: editing.orientation,
    active: visible && inspectorOpen && inspectorTab === "part",
    enabled: supportsPrintCheck && visible && viewing === null && canRenderFormat,
    allowLarge,
  });
  const selectedFindingId =
    selection?.report === printCheck.report && !printCheck.stale ? selection.id : null;
  const runPrintCheck = printCheck.run;
  useEffect(() => {
    if (printRunRequest) void runPrintCheck();
  }, [printRunRequest, runPrintCheck]);
  const selectFinding = (finding: PrintFinding) => {
    if (printCheck.stale || !finding.location || !printCheck.report) return;
    const selected = selectedFindingId === finding.id ? null : finding.id;
    setSelection(selected ? { report: printCheck.report, id: selected } : null);
    if (selected) {
      setDisplay((value) => ({ ...value, findings: true }));
      viewer.current?.frameFinding(finding);
    }
  };
  const { measureMode, setMeasureMode, setSection: setModelSection } = editing;
  useEffect(() => {
    if (snapStatus === "off" && measureMode === "hole") setMeasureMode("distance");
  }, [snapStatus, measureMode, setMeasureMode]);
  const perform = editing.perform;
  const { copyToClipboard } = useCopyToClipboard();
  const recall = (camera: ModelCamera, refit: boolean) => {
    setDisplay({
      findings: display.findings,
      wireframe: camera.wireframe,
      overhangs: camera.overhangs,
      grid: camera.gridVisible,
      axes: camera.axesVisible,
      projection: camera.projection,
    });
    setNavigationMode(camera.navigationMode);
    editing.setSection(camera.section);
    viewer.current?.restore(camera);
    if (refit) viewer.current?.refit();
    setActiveView(null);
    setActiveViewId(null);
  };
  const recallView = (view: ModelSavedView) => {
    if (viewing) return;
    recall(view.camera, view.sourceRevision !== geometryRevision);
    setActiveViewId(view.id);
  };
  const onNavigate = useCallback(() => {
    setActiveView(null);
    setActiveViewId(null);
  }, []);
  const setView = (view: View) => {
    viewer.current?.setView(view);
    setActiveView(view);
    setActiveViewId(null);
  };
  const fit = () => {
    viewer.current?.fit();
    setActiveView("iso");
    setActiveViewId(null);
  };
  const openTab = useCallback((tab: InspectorTab) => {
    setInspectorTab(tab);
    setInspectorOpen(true);
  }, []);
  const showLog = () => openTab("part");
  useEffect(() => {
    if (!success) return;
    const timeout = setTimeout(() => setSuccess(null), 5000);
    return () => clearTimeout(timeout);
  }, [success]);
  const resolving = !sourceFormat && resolvedKey !== JSON.stringify([revision, allowLarge]);
  const loadingFile = viewing
    ? viewing.status === "loading" || progress !== null
    : pending || refreshing || resolving || progress !== null;
  const plate = useMemo(
    () => resolvePlate(settings.buildPlate, library),
    [settings.buildPlate, library],
  );
  const volume = plate.volume;
  const watched = useAtomValue(
    models.watch({ environmentId: threadRef.environmentId, input: file }),
  );
  const watchedRevision = watched._tag === "Success" ? watched.value.revision : null;
  const history = useModelHistory({
    threadRef,
    path,
    active: supportsHistory && visible && (historyOpen || viewing !== null),
    liveRevision: watchedRevision,
    selected: viewing?.checkpointId ?? null,
  });
  const viewHistory = async (id: CheckpointId | "now", turnHint?: number) => {
    if (id !== "now" && !canRenderFormat)
      throw new Error("Terminal permission is required to preview Python CAD history.");
    const request = ++historyRequest.current;
    setHistoryOpen(true);
    setComparing(null);
    setRestoreOpen(false);
    editing.stopPicking();
    showPrevious(false);
    slicing.hideLayers();
    if (id === "now") {
      setViewing(null);
      void runModelCommand(models.historyCancel, {
        environmentId: threadRef.environmentId,
        input: { file },
      }).catch(() => undefined);
      return;
    }
    let version = history.pages
      .flatMap((page) => page.versions)
      .find((version) => version.checkpointId === id);
    if (!version) {
      let cursor: number | null = null;
      do {
        const page: ModelHistory = await runModelCommand(models.history, {
          environmentId: threadRef.environmentId,
          input: { file, ...(cursor === null ? {} : { cursor }) },
        });
        if (historyRequest.current !== request) return;
        history.includePage(page);
        version = page.versions.find((candidate) => candidate.checkpointId === id);
        cursor = page.nextCursor;
      } while (!version && cursor !== null);
      if (!version)
        throw new Error("This version is no longer available. The thread was rolled back.");
    }
    const turn = version?.turn ?? turnHint ?? 0;
    setViewing({
      checkpointId: id,
      turn,
      status: version?.present === false ? "absent" : "loading",
      mesh: version?.present === false ? null : (viewing?.mesh ?? mesh),
      stats: version?.present === false ? null : (viewing?.stats ?? stats),
      result: null,
      error: null,
    });
    if (version?.present === false) return;
    try {
      const result = await runModelCommand(models.historyVersion, {
        environmentId: threadRef.environmentId,
        input: { file, checkpointId: id, allowLarge },
      });
      if (historyRequest.current !== request || result.status === "cancelled") return;
      const signed = result.mesh;
      setViewing({
        checkpointId: id,
        turn,
        status: result.status === "ok" && signed && result.meshFormat ? "ready" : "error",
        mesh:
          signed && result.meshFormat
            ? {
                url: modelUrl(threadRef.environmentId, signed.relativeUrl),
                format: result.meshFormat,
                revision: signed.revision,
              }
            : null,
        stats: null,
        result,
        error:
          result.status === "error"
            ? (result.render?.log.find((line) => line.level === "error")?.text ??
              "Could not render this version.")
            : null,
      });
    } catch (cause: unknown) {
      if (historyRequest.current === request)
        setViewing({
          checkpointId: id,
          turn,
          status: "error",
          mesh: null,
          stats: null,
          result: null,
          error: failureMessage(cause),
        });
    }
  };
  const closeHistory = () => {
    historyRequest.current++;
    setHistoryOpen(false);
    setViewing(null);
    setComparing(null);
    setRestoreOpen(false);
    void runModelCommand(models.historyCancel, {
      environmentId: threadRef.environmentId,
      input: { file },
    }).catch(() => undefined);
  };
  const stepHistory = (direction: -1 | 1) => {
    setHistoryOpen(true);
    if (history.pages.length === 0) {
      void runModelCommand(models.history, {
        environmentId: threadRef.environmentId,
        input: { file },
      })
        .then((page) => {
          const target = stepChip(historyChips([page]), "now", direction);
          if (target)
            return viewHistory(
              target,
              target === "now"
                ? undefined
                : page.versions.find((version) => version.checkpointId === target)?.turn,
            );
        })
        .catch((cause: unknown) => setCompareError(failureMessage(cause)));
      return;
    }
    const target = stepChip(history.chips, viewing?.checkpointId ?? "now", direction);
    if (target)
      void viewHistory(target).catch((cause: unknown) => setCompareError(failureMessage(cause)));
    else if (direction === -1 && history.pages.at(-1)?.nextCursor) history.loadEarlier();
  };
  const liveCompareMesh = comparing === "now" ? mesh : null;
  useEffect(() => {
    if (!comparing || !canRenderFormat) return;
    const controller = new AbortController();
    let loaded: Object3D | null = null;
    let active = true;
    const load = async () => {
      const result =
        comparing === "now"
          ? null
          : await runModelCommand(models.historyVersion, {
              environmentId: threadRef.environmentId,
              input: { file, checkpointId: comparing, allowLarge },
            });
      if (!active) return;
      const selected =
        result?.mesh && result.meshFormat
          ? {
              url: modelUrl(threadRef.environmentId, result.mesh.relativeUrl),
              format: result.meshFormat,
            }
          : comparing === "now"
            ? liveCompareMesh
            : null;
      if (!selected) throw new Error("This version has no preview to compare.");
      const object = await loadModel(
        selected.url,
        selected.format,
        controller.signal,
        () => undefined,
      );
      if (!active) {
        disposeModel(object);
        return;
      }
      loaded = object;
      const group = new Group();
      group.add(object);
      if (editing.orientation) group.quaternion.fromArray([...editing.orientation.quaternion]);
      const comparisonStats = meshStats(group);
      group.remove(object);
      setCompareGeometry({ model: object, stats: comparisonStats });
      setCompareError(null);
    };
    void load().catch((cause: unknown) => {
      if (active) setCompareError(failureMessage(cause));
    });
    return () => {
      active = false;
      controller.abort();
      viewer.current?.setCompareModel(null);
      if (loaded) disposeModel(loaded);
      queueMicrotask(() => setCompareGeometry((value) => (value?.model === loaded ? null : value)));
    };
  }, [
    comparing,
    file,
    threadRef.environmentId,
    liveCompareMesh,
    allowLarge,
    editing.orientation,
    canRenderFormat,
  ]);
  useEffect(
    () => () => {
      if (!supportsHistory) return;
      historyRequest.current++;
      void runModelCommand(models.historyCancel, {
        environmentId: threadRef.environmentId,
        input: { file },
      }).catch(() => undefined);
    },
    [file, threadRef.environmentId, supportsHistory],
  );
  const shownMesh = viewing ? viewing.mesh : mesh;
  const shownStats = viewing ? viewing.stats : stats;
  const shownRender = viewing ? (viewing.result?.render ?? null) : render;
  const comparison =
    shownStats && compareGeometry ? sizeDelta(shownStats, compareGeometry.stats) : null;

  const editorEvents = useAtomValue(
    visible
      ? models.editorEvents({ environmentId: threadRef.environmentId, input: file })
      : idleEditor,
  );
  const editorRequest = editorEvents._tag === "Success" ? editorEvents.value : null,
    handledEditor = useRef<string | null>(null);
  const handleEditorRequest = useEffectEvent(
    (editorRequest: typeof ModelEditorEvent.Type | null) => {
      if (!editorRequest || handledEditor.current === editorRequest.requestId) return;
      handledEditor.current = editorRequest.requestId;
      const execute = async () => {
        const c = editorRequest.command;
        const get = () => {
          if (!viewer.current || !(viewing ? viewing.stats : stats) || loadingFile)
            throw new Error("Wait for the 3D model to load.");
          return viewer.current;
        };
        if (
          viewing &&
          ![
            "fit",
            "zoom",
            "view",
            "display",
            "navigation",
            "inspector",
            "turn-history",
            "turn-compare",
            "snapshot",
            "refresh",
            "allow-large",
          ].includes(c.action)
        )
          throw new Error("Return to Now before editing or capturing this model.");
        let png: string | undefined;
        let measurement: ModelMeasurement | undefined;
        let wall: ModelWall | undefined;
        switch (c.action) {
          case "turn-history":
            if (!supportsHistory) throw new Error("This host does not support model history.");
            if (c.enabled === false) closeHistory();
            else if (c.name)
              await viewHistory(c.name === "current" ? "now" : (c.name as CheckpointId));
            else setHistoryOpen(true);
            break;
          case "turn-compare":
            if (c.enabled !== false && !canRenderFormat)
              throw new Error("Terminal permission is required to compare Python CAD history.");
            if (c.enabled !== false && !c.name)
              throw new Error("Provide a checkpoint id or current.");
            if (!supportsHistory) throw new Error("This host does not support model history.");
            setHistoryOpen(true);
            setComparing(
              c.enabled === false ? null : c.name === "current" ? "now" : (c.name as CheckpointId),
            );
            break;
          case "layers": {
            if (!supportsSlicing) throw new Error("This host does not support slicing.");
            if (!canRenderFormat)
              throw new Error("Terminal permission is required to slice this model.");
            if (c.enabled === false) {
              slicing.hideLayers();
              break;
            }
            const data = await slicing.toggleLayers(true);
            if (!data) throw new Error("The layer preview was cancelled.");
            if (c.layer !== undefined) {
              if (c.layer >= data.layers.length) throw new Error("No layer at that position.");
              slicing.setLayer(c.layer);
            }
            break;
          }
          case "fit":
            get().fit();
            break;
          case "zoom":
            get().zoom(c.factor ?? 1);
            break;
          case "view":
            if (!["iso", "front", "top", "right"].includes(c.name ?? ""))
              throw new Error("Choose iso, front, top or right.");
            setView(c.name as View);
            break;
          case "camera":
            if (!c.camera) throw new Error("Provide a camera.");
            get();
            recall(c.camera, false);
            break;
          case "display":
            get();
            if (c.overhangs !== undefined) get().setOverhangs(c.overhangs);
            if (c.findings !== undefined)
              setDisplay((value) => ({ ...value, findings: c.findings! }));
            if (c.previous !== undefined) {
              if (!previous || !get().hasPrevious()) throw new Error("No previous version yet.");
              showPrevious(c.previous);
            }
            if (c.reference !== undefined) {
              if (!referenceControl.canSave)
                throw new Error("This connection cannot change model settings.");
              await referenceControl.save(c.reference);
              get().setReference(c.reference);
            }
            setDisplay((d) => ({
              ...d,
              ...(c.wireframe === undefined ? {} : { wireframe: c.wireframe }),
              ...(c.overhangs === undefined ? {} : { overhangs: c.overhangs }),
              ...(c.grid === undefined ? {} : { grid: c.grid }),
              ...(c.axes === undefined ? {} : { axes: c.axes }),
              ...(c.projection === undefined ? {} : { projection: c.projection }),
            }));
            break;
          case "navigation":
            if (c.name !== "pan" && c.name !== "orbit") throw new Error("Choose pan or orbit.");
            get();
            setNavigationMode(c.name);
            break;
          case "section":
            if (!c.section) throw new Error("Provide a section.");
            get();
            editing.setSection(c.section);
            break;
          case "orientation": {
            const current = get();
            if (!supportsOrientation) throw new Error("This host does not support lay flat.");
            if (c.name === "reset") {
              if (!(await editing.resetOrientation()))
                throw new Error("Orientation could not be reset.");
            } else if (c.name === "auto") {
              if (!(await editing.autoOrient())) throw new Error("No stable face found.");
            } else if (c.name === "face" && c.points?.length === 1) {
              if (!(await editing.faceOrientationAt(c.points[0]!)))
                throw new Error("No face at that point.");
            } else if (c.name === "bake")
              await editing.prepareOrientationRequest(
                format,
                current.authoredCentre(),
                current.orientedMinZ(),
              );
            else throw new Error("Choose auto, reset, bake, or face with one model-space point.");
            break;
          }
          case "wall-thickness": {
            if (!c.points || c.points.length !== 1)
              throw new Error("Provide one point on the filled cut.");
            const current = get();
            if (!editing.section.enabled) throw new Error("Enable a section first.");
            if (current.sectionCapsStatus() === "open-mesh")
              throw new Error("Caps need a closed mesh.");
            wall = current.wallThicknessAt(c.points[0]!) ?? undefined;
            if (!wall) throw new Error("That point is not inside the cut.");
            break;
          }
          case "tool":
            if (
              ![
                "select",
                "measure",
                "annotate",
                ...(supportsOrientation ? ["lay-flat"] : []),
              ].includes(c.name ?? "")
            )
              throw new Error("Choose select, measure, annotate or lay-flat.");
            get();
            editing.choose(c.name === "select" ? null : (c.name as PickTool));
            if (c.name === "measure") {
              if (c.measure === "hole" && stats && stats.triangles > GHOST_TRIANGLE_LIMIT)
                throw new Error("Hole measurement is unavailable for models over 1M triangles.");
              editing.setMeasureMode(c.measure ?? "distance");
            }
            break;
          case "inspector": {
            if (c.enabled === false) {
              setInspectorOpen(false);
              break;
            }
            const tab = resolveInspectorTab(c.name, sourceFormat);
            if (!tab)
              throw new Error(
                `Choose one of these inspector tabs: ${(sourceFormat ? ["customize", "variants"] : []).concat("markup", "views", "part").join(", ")}.`,
              );
            openTab(tab);
            break;
          }
          case "refresh":
            setRevision((r) => r + 1);
            break;
          case "load-view": {
            const saved = editing.data.views.find((v) => v.id === c.name || v.name === c.name);
            if (!saved) throw new Error("Unknown saved view.");
            get();
            recallView(saved);
            break;
          }
          case "parameters": {
            if (!session || !c.values)
              throw new Error("Open a source model and provide customizer values.");
            session.promote(c.values, c.name ?? "Agent preview");
            break;
          }
          case "parameter-history": {
            if (!session) throw new Error("Open a source model first.");
            const index =
              c.index ??
              session.historyCursor + (c.name === "undo" ? -1 : c.name === "redo" ? 1 : 0);
            if (index < 0 || index >= session.historyLabels.length)
              throw new Error("No parameter history at that position.");
            session.moveHistory(index);
            break;
          }
          case "parameter-set": {
            if (!session) throw new Error("Open a source model first.");
            const name = c.name || null;
            if (name && !session.data.sets.includes(name))
              throw new Error("Unknown parameter set.");
            session.chooseSet(name);
            break;
          }
          case "parameter-preview":
            if (!session) throw new Error("Open a source model first.");
            if (c.enabled !== undefined) session.setAutomatic(c.enabled);
            else session.apply();
            break;
          case "cancel-tool":
            editing.cancel();
            break;
          case "allow-large":
            setAllowLarge(c.enabled ?? true);
            break;
          case "pick": {
            const current = get();
            if (!editing.canEdit || !editing.ready || !c.points)
              throw new Error("Provide model points and wait for editable workspace data.");
            let picked;
            if (editing.picking === "measure" && editing.measureMode === "hole") {
              if (c.points.length !== 1) throw new Error("Provide one point near the hole rim.");
              const fit = await current.circleNear(c.points[0]!, c.snapRadius ?? 1);
              if (!fit)
                throw new Error(`No circular edge within ${c.snapRadius ?? 1} mm of that point.`);
              picked = await editing.onCircle(fit);
            } else {
              const points = c.snap
                ? await Promise.all(
                    c.points.map((point) => current.snapPoint(point, c.snapRadius ?? 1)),
                  )
                : [...c.points];
              picked = await editing.onPick(points);
            }
            if (!picked)
              throw new Error("Choose a picking tool first, or check the workspace save error.");
            measurement = picked.measurement ?? undefined;
            break;
          }
          case "save-annotation":
            get();
            if (!editing.canEdit || !editing.ready || !c.request?.trim())
              throw new Error(
                "Provide an annotation request and wait for editable workspace data.",
              );
            if (
              !(await editing.addAnnotation(c.name?.trim() || "Selected region", c.request.trim()))
            )
              throw new Error("Pick a region first, or check the annotation save error.");
            break;
          case "capture-annotation": {
            const annotation = editing.data.annotations.find(
              (a) => a.id === c.name || a.name === c.name,
            );
            if (!annotation) throw new Error("Unknown annotation.");
            get();
            const blob = await editing.captureAnnotation(annotation);
            if (!blob)
              throw new Error(
                "The annotation capture could not be prepared. Check the editor error.",
              );
            if (c.attachToDraft)
              await attachModelImage(blob, threadRef, `${annotation.name}-marked.png`);
            png = await captureBase64(blob);
            break;
          }
          case "prepare-request":
          case "reselect-annotation": {
            const annotation = editing.data.annotations.find(
              (a) => a.id === c.name || a.name === c.name,
            );
            if (!annotation) throw new Error("Unknown annotation.");
            get();
            if (c.action === "reselect-annotation") editing.reselect(annotation);
            else if (!(await editing.prepareRequest(annotation)))
              throw new Error(
                "The annotation request could not be prepared. Check the editor error.",
              );
            break;
          }
          case "capture": {
            let capture: Promise<Blob>;
            if (c.name) {
              const preset = editing.data.presets.find((p) => p.id === c.name || p.name === c.name);
              if (!preset) throw new Error("Unknown capture preset.");
              const views = preset.viewIds.flatMap((id) =>
                editing.data.views.filter((v) => v.id === id),
              );
              if (views.length !== preset.viewIds.length)
                throw new Error("A capture preset references a missing view.");
              const measurements = editing.data.measurements.filter(
                (m) => m.sourceRevision === geometryRevision,
              );
              const annotations = editing.data.annotations.filter(
                (a) => a.sourceRevision === geometryRevision,
              );
              get().setOverlays(preset.includeMeasurements ? measurements : [], annotations, null);
              try {
                capture = captureNamedViews(get(), views, path, geometryRevision);
              } finally {
                get().setOverlays(measurements, annotations, editing.pendingPoint);
              }
            } else capture = get().capture(c.four ?? false);
            const blob = await capture;
            if (c.attachToDraft)
              await attachModelImage(blob, threadRef, `${path.split("/").at(-1)}-capture.png`);
            png = await captureBase64(blob);
            break;
          }
          case "snapshot":
            break;
          case "open":
          case "close":
          case "maximize":
            throw new Error("Use the panel action host.");
        }
        return {
          message: wall
            ? `${formatLength(wall.thicknessMm, units)} wall at that point.`
            : "3D editor action completed.",
          ...(png ? { png } : {}),
          ...(measurement ? { measurement } : {}),
          ...(wall ? { wall } : {}),
          ...(c.action === "snapshot"
            ? {
                ...(viewer.current && shownStats && !progress
                  ? { camera: viewer.current.snapshot() }
                  : {}),
                sourceRevision: geometryRevision,
                state: {
                  inspector: inspectorOpen ? inspectorTab : null,
                  tool: editing.picking,
                  measureMode: editing.measureMode,
                  orientation: editing.orientation,
                  sectionCaps,
                  ...(supportsSlicing
                    ? {
                        layers: {
                          shown: layersShown,
                          index: slicing.layer,
                          count: slicing.layers?.layers.length ?? 0,
                          zMm: slicing.layers?.layers[slicing.layer]?.z ?? null,
                        },
                      }
                    : {}),
                  ...(supportsHistory
                    ? {
                        turnHistory: {
                          open: historyOpen,
                          viewing: viewing?.checkpointId ?? null,
                          viewingTurn: viewing?.turn ?? null,
                          comparing: comparing === "now" ? null : comparing,
                          latestTurn: history.latestTurn,
                        },
                      }
                    : {}),
                  ...(previous && viewer.current?.hasPrevious()
                    ? {
                        previous: {
                          shown: previousShown,
                          size: previous.size,
                          sourceRevision: previous.revision,
                        },
                      }
                    : {}),
                  pendingPoint: editing.pendingPoint,
                  pendingRegion: editing.pendingRegion,
                  loading: loadingFile || (!shownStats && !(viewing ? viewing.error : error)),
                  ...(shownStats
                    ? { fit: bedFitSummary(shownStats.size, settings.buildPlate, { library }) }
                    : {}),
                  parameters: session
                    ? {
                        values: session.values,
                        applied: session.applied,
                        setName: session.setName,
                        automatic: session.automatic,
                        hasUnapplied: session.hasUnapplied,
                        historyCursor: session.historyCursor,
                        history: session.historyLabels,
                      }
                    : null,
                },
              }
            : {}),
        };
      };
      void execute()
        .then((result) =>
          runModelCommand(models.completeEditorAction, {
            environmentId: threadRef.environmentId,
            input: {
              threadId: threadRef.threadId,
              path,
              requestId: editorRequest.requestId,
              ...result,
            },
          }),
        )
        .catch((error) =>
          runModelCommand(models.completeEditorAction, {
            environmentId: threadRef.environmentId,
            input: {
              threadId: threadRef.threadId,
              path,
              requestId: editorRequest.requestId,
              message: error instanceof Error ? error.message : "Editor action failed.",
              error: true,
            },
          }).catch(() => undefined),
        );
    },
  );
  useEffect(() => {
    handleEditorRequest(editorRequest);
  }, [editorRequest]);
  useLayoutEffect(() => {
    if (
      watchedRevision !== null &&
      lastWatchedRevision.current !== null &&
      watchedRevision !== lastWatchedRevision.current
    ) {
      reloadCause.current = "watch";
      setChanged(null);
    }
    if (watchedRevision !== null) lastWatchedRevision.current = watchedRevision;
  }, [watchedRevision]);
  // Printer, agent and Fabrication settings do not change the mesh, so they skip the reload.
  const loadKey = JSON.stringify([
    settings.openscadPath,
    settings.backend,
    settings.renderTimeoutSeconds,
    settings.renderColors,
    settings.maxFileMegabytes,
    settings.pythonPath,
  ]);
  const [seen, setSeen] = useState<{ watched: typeof watched | null; loadKey: string | null }>({
    watched: null,
    loadKey: null,
  });
  if (seen.watched !== watched || seen.loadKey !== loadKey) {
    setSeen({ watched, loadKey });
    setRevision((value) => value + 1);
  }
  const watchError =
    watched._tag === "Failure"
      ? `Live reload stopped: ${failureMessage(Cause.squash(watched.cause))}`
      : watched._tag === "Success" && watched.value.revision === null
        ? "The file was deleted or moved."
        : null;
  if (visible && release) {
    setRelease(false);
    setMesh(null);
    setRevision((value) => value + 1);
  }
  useEffect(() => {
    if (visible) return;
    const timeout = setTimeout(() => {
      setRelease(true);
      setPrevious(null);
      setPreviousShown(false);
      setChanged(null);
      loadedGeometry.current = null;
      reloadCause.current = null;
    }, 60000);
    return () => clearTimeout(timeout);
  }, [visible]);
  const onMesh = useCallback(
    (url: string, meshFormat: ModelEntry["format"], meshRevision: string) => {
      if (loadedGeometry.current?.revision === meshRevision) {
        viewer.current?.clearPrevious();
        setPrevious(null);
        setPreviousShown(false);
        setChanged(null);
        reloadCause.current = null;
      }
      setMesh({ url, format: meshFormat, revision: meshRevision });
      setError(null);
    },
    [],
  );
  const onOriented = useCallback(
    (value: ReturnType<typeof meshStats>) => {
      if (historyViewingRef.current) {
        setViewing((current) => (current ? { ...current, stats: value } : current));
        return;
      }
      setStats(value);
      // The renderer recentres only when the quaternion changes. Preserve restored cut offsets
      // when a workspace update carries the same pose or a model reload keeps its camera.
      const nextSection = viewer.current?.snapshot().section;
      if (nextSection) setModelSection(nextSection);
    },
    [setModelSection],
  );
  const onLiveError = useCallback((message: string) => setError(message), []);
  const onError = useCallback((message: string) => {
    if (historyViewingRef.current)
      setViewing((current) =>
        current ? { ...current, status: "error", error: message } : current,
      );
    else setError(message);
  }, []);
  const onStats = useCallback((value: ReturnType<typeof meshStats>) => {
    if (historyViewingRef.current) {
      setViewing((current) => (current ? { ...current, stats: value } : current));
      return;
    }
    const nextRevision = liveMeshRevision.current;
    const retained = previousGeometry(
      loadedGeometry.current,
      nextRevision,
      viewer.current?.hasPrevious() ?? false,
    );
    if (!retained) {
      viewer.current?.clearPrevious();
      setPreviousShown(false);
    }
    setPrevious(retained);
    setPreviousTooLarge(
      !retained && (loadedGeometry.current?.triangles ?? value.triangles) > GHOST_TRIANGLE_LIMIT,
    );
    setChanged(retained && reloadCause.current === "watch" ? "chip" : null);
    reloadCause.current = null;
    loadedGeometry.current = {
      revision: nextRevision,
      size: value.size,
      triangles: value.triangles,
    };
    setStats(value);
    setGeometryRevision(nextRevision);
    setError(null);
  }, []);
  const onProgress = useCallback((value: string | null) => {
    setProgress(value);
    if (value !== null) setChanged(null);
  }, []);
  const onPending = useCallback((value: boolean) => {
    setPending(value);
  }, []);
  const onResult = useCallback((value: ScadRenderResult) => {
    setRender(value);
    if (value.status === "error")
      setError(value.log.find((line) => line.level === "error")?.text ?? "Render failed.");
  }, []);
  useEffect(() => {
    if (sourceFormat) return;
    if (format === "step") {
      if (!supportsPython) return;
      if (!canRender) {
        queueMicrotask(() => {
          setError("This connection does not permit previewing STEP files.");
          setResolvedKey(JSON.stringify([revision, allowLarge]));
        });
        return;
      }
      let active = true;
      queueMicrotask(() => {
        if (active) setPending(true);
      });
      void runModelCommand(models.render, {
        environmentId: threadRef.environmentId,
        input: { file, overrides: {}, parameterSet: null, revision },
      })
        .then((result) => {
          if (active) {
            onResult(result);
            if (result.mesh && result.meshFormat)
              onMesh(
                modelUrl(threadRef.environmentId, result.mesh.relativeUrl),
                result.meshFormat,
                result.mesh.revision,
              );
          }
        })
        .catch((cause: unknown) => {
          if (active) setError(failureMessage(cause));
        })
        .finally(() => {
          if (active) {
            setPending(false);
            setResolvedKey(JSON.stringify([revision, allowLarge]));
          }
        });
      return () => {
        active = false;
      };
    }
    let active = true;
    void runModelCommand(models.fileUrl, {
      environmentId: threadRef.environmentId,
      input: { ...file, allowLarge },
    })
      .then((signed) => {
        if (active) {
          onMesh(modelUrl(threadRef.environmentId, signed.relativeUrl), format, signed.revision);
          setError(null);
          setTooLarge(false);
        }
      })
      .catch((cause) => {
        if (active) {
          setError(failureMessage(cause));
          setTooLarge(
            typeof cause === "object" &&
              cause !== null &&
              "reason" in cause &&
              cause.reason === "too-large",
          );
        }
      })
      .finally(() => {
        if (active) setResolvedKey(JSON.stringify([revision, allowLarge]));
      });
    return () => {
      active = false;
    };
  }, [
    file,
    threadRef.environmentId,
    format,
    sourceFormat,
    supportsPython,
    canRender,
    revision,
    allowLarge,
    onMesh,
    onResult,
  ]);
  const busy =
    !pythonUnavailable &&
    (loadingFile ||
      (!shownStats &&
        !(viewing ? viewing.error || viewing.status === "absent" : error || watchError)));
  const captureBusy = capturing || editing.operation !== null;
  const editDisabled =
    viewing !== null || layersShown || !editing.canEdit || !stats || busy || captureBusy;
  const viewThumbnail = useCallback(
    async (view: ModelSavedView) => {
      const current = viewer.current;
      if (!current || !stats || busy) return null;
      const original = current.snapshot();
      let blob: Promise<Blob>;
      try {
        current.restore(view.camera);
        if (view.sourceRevision !== geometryRevision) current.refit();
        blob = current.capture(false);
      } finally {
        current.restore(original);
      }
      return thumbnail(await blob);
    },
    // oxlint-disable-next-line react/memo-dependencies -- The revision decides whether a saved view refits; the rule misses its use inside try.
    [stats, busy, geometryRevision],
  );
  const saveView = () => {
    if (editDisabled) return;
    const camera = viewer.current?.snapshot();
    if (!camera || !geometryRevision) return;
    const names = new Set(editing.data.views.map((view) => view.name));
    let index = editing.data.views.length + 1;
    while (names.has(`View ${index}`)) index++;
    const id = randomUUID();
    openTab("views");
    void editing
      .mutate({
        kind: "view",
        item: { id, name: `View ${index}`, sourceRevision: geometryRevision, camera },
      })
      .then((saved) => {
        if (!saved) return;
        setActiveView(null);
        setActiveViewId(id);
      });
  };
  const updateView = (view: ModelSavedView) => {
    const camera = viewer.current?.snapshot();
    if (!camera || !geometryRevision) return;
    void editing
      .mutate({ kind: "view", item: { ...view, camera, sourceRevision: geometryRevision } })
      .then((saved) => saved && setActiveViewId(view.id));
  };
  const sectionBounds = (axis: ModelSection["axis"]) =>
    stats
      ? {
          min: stats.box.min.getComponent(AXIS_INDEX[axis]),
          max: stats.box.max.getComponent(AXIS_INDEX[axis]),
        }
      : { min: 0, max: 100 };
  const centred = (axis: ModelSection["axis"]) => {
    const { min, max } = sectionBounds(axis);
    return Math.round(min + max) / 2;
  };
  const changeSection = (next: ModelSection) =>
    editing.setSection(
      next.axis === editing.section.axis ? next : { ...next, offset: centred(next.axis) },
    );
  const toggleSection = () => {
    if (viewing) return;
    const section = editing.section;
    if (section.enabled) editing.setSection({ ...section, enabled: false });
    else if (stats)
      editing.setSection({ ...section, enabled: true, offset: centred(section.axis) });
  };
  const startTool = (tool: PickTool, measureMode?: "distance" | "hole") => {
    if (editDisabled) return;
    if (editing.picking === tool && measureMode === undefined) editing.stopPicking();
    else {
      editing.choose(tool);
      if (tool === "measure" && measureMode) editing.setMeasureMode(measureMode);
      openTab(tool === "lay-flat" ? "part" : "markup");
    }
  };
  const markupActions: MarkupActions = {
    onTool: startTool,
    onMovePin: editing.movePin,
    onDiscard: editing.cancel,
    onSave: async (name, request, addToComposer) => {
      const saved = await editing.addAnnotation(name, request);
      if (saved && addToComposer) await editing.prepareRequest(saved);
      return !!saved;
    },
    onRequest: editing.prepareRequest,
    onReselect: editing.reselect,
    onReview: editing.review,
    onShow: (annotation) =>
      recall(annotation.camera, annotation.sourceRevision !== geometryRevision),
    onCopy: (text) => copyToClipboard(text),
    onViewTurn: (resolved) => void viewHistory(resolved.checkpointId, resolved.turn),
  };
  const capture = useCallback(
    async (four: boolean) => {
      if (viewingHistory || !viewer.current || !stats || busy) {
        setCaptureError({
          title: "Capture could not be attached",
          message: "Wait for the model preview to finish loading before capturing it.",
        });
        return;
      }
      await perform("Capturing and attaching model image", async () => {
        if (!viewer.current) return;
        setCapturing(true);
        setSuccess(null);
        setCaptureError(null);
        try {
          await captureToComposer(viewer.current, threadRef, path, four);
          setSuccess("Capture attached to the composer.");
        } catch (cause) {
          setCaptureError({
            title: "Capture could not be attached",
            message: failureMessage(cause),
          });
        } finally {
          setCapturing(false);
        }
      });
    },
    [threadRef, path, perform, stats, busy, viewingHistory],
  );
  const exportCapture = useCallback(
    async (four: boolean, action: ExportAction) => {
      const title = action === "copy" ? "Image could not be copied" : "PNG could not be saved";
      if (viewingHistory || !viewer.current || !stats || busy) {
        setCaptureError({
          title,
          message: "Wait for the model preview to finish loading before capturing it.",
        });
        return;
      }
      await perform(action === "copy" ? "Copying model image" : "Saving model image", async () => {
        if (!viewer.current) return;
        setCapturing(true);
        setSuccess(null);
        setCaptureError(null);
        try {
          const label = four
            ? "four-views"
            : (activeView ??
              editing.data.views.find((view) => view.id === activeViewId)?.name ??
              "view");
          const image = viewer.current.capture(four);
          if (action === "copy") await copyImage(image);
          else saveImage(await image, captureFileName(path, label, new Date()));
          setSuccess(action === "copy" ? "Image copied." : "Download started.");
        } catch (cause) {
          setCaptureError({ title, message: failureMessage(cause) });
        } finally {
          setCapturing(false);
        }
      });
    },
    [path, perform, stats, busy, activeView, activeViewId, editing.data.views, viewingHistory],
  );
  const exportViews = async (
    ids: readonly string[],
    includeMeasurements: boolean,
    name: string,
    action: ExportAction,
  ) => {
    if (viewing || !viewer.current || !stats || busy) {
      setCaptureError({
        title: action === "copy" ? "Image could not be copied" : "PNG could not be saved",
        message: "Wait for the model preview to finish loading before capturing it.",
      });
      return;
    }
    setSuccess(null);
    setCaptureError(null);
    const result = await editing.exportViews(ids, includeMeasurements, name, action);
    if (result?.ok) setSuccess(action === "copy" ? "Image copied." : "Download started.");
    else if (result) setCaptureError({ title: result.title, message: result.message });
  };
  useEffect(() => {
    if (!visible) return;
    return onModelAction(
      threadRef,
      (action) => {
        if (action === "toggle-history" && supportsHistory) {
          if (historyOpen) closeHistory();
          else setHistoryOpen(true);
        } else if (action === "history-earlier" && supportsHistory) stepHistory(-1);
        else if (action === "history-later" && supportsHistory) stepHistory(1);
        else if (action === "toggle-layers" && supportsSlicing && !viewing) showLayers();
        else if (
          viewing &&
          [
            "auto-lay-flat",
            "reset-orientation",
            "print-check",
            "copy-view",
            "save-view",
            "capture",
            "capture-four",
          ].includes(action)
        )
          return;
        else if (action === "auto-lay-flat" && supportsOrientation) void editing.autoOrient();
        else if (action === "reset-orientation" && supportsOrientation)
          void editing.resetOrientation();
        else if (action === "print-check" && supportsPrintCheck) {
          openTab("part");
          setPrintRunRequest((value) => value + 1);
        } else if (action === "toggle-previous") togglePrevious();
        else if (action === "toggle-overhangs")
          setDisplay((value) => ({ ...value, overhangs: !value.overhangs }));
        else if (action === "rerender") setRevision((value) => value + 1);
        else if (action === "toggle-units") {
          if (!unitsControl.canSave) return;
          const next = unitsControl.units === "mm" ? "in" : "mm";
          unitsControl.setUnits(next);
          toastManager.add({ type: "success", title: `Lengths in ${unitName(next)}` });
        } else if (action === "copy-view" || action === "save-view") {
          void exportCapture(false, action === "copy-view" ? "copy" : "save");
        } else void capture(action === "capture-four");
      },
      () => display.overhangs,
      () => !!editing.orientation,
    );
  }, [
    visible,
    threadRef,
    capture,
    exportCapture,
    unitsControl,
    display.overhangs,
    togglePrevious,
    supportsOrientation,
    supportsPrintCheck,
    supportsHistory,
    historyOpen,
    viewing,
    closeHistory,
    stepHistory,
    supportsSlicing,
    showLayers,
    editing,
    openTab,
  ]);
  const displayedError = viewing
    ? viewing.error
    : pythonUnavailable
      ? "Update this host to preview Python CAD files."
      : (watchError ??
        error ??
        (render?.status === "error"
          ? (render.log.find((line) => line.level === "error")?.text ?? "Render failed.")
          : null));
  const picker = () =>
    useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface("model-preview-3d"));
  const announcePrevious = useRef<AnnounceInput | null>(null);
  const [announced, setAnnounced] = useState<{ id: number; text: string } | null>(null);
  const announceHint =
    editing.picking === "measure"
      ? editing.measureMode === "hole"
        ? "Click the rim or wall of the hole"
        : editing.pendingPoint
          ? "Click the second point"
          : "Click the first point to measure from"
      : editing.picking === "annotate"
        ? "Click the part you want changed"
        : editing.picking === "lay-flat"
          ? (editing.orientationMessage ?? "Click the face to rest on the bed")
          : null;
  const announceFit = stats ? fitPlate(stats.size, plate).fit.status === "fits" : null;
  const bedLabel = buildPlateLabel(settings.buildPlate);
  useEffect(() => {
    if (!visible) return;
    const next: AnnounceInput = {
      file: path.split("/").at(-1) ?? path,
      geometryRevision,
      stats,
      fits: announceFit,
      bedLabel,
      stale: !!displayedError && !!stats,
      hint: announceHint,
      tool: editing.picking,
      navigationMode,
      view: activeView,
      projection: display.projection,
      success,
      formatSize: (size) => formatLengths(size, units),
    };
    const text = announcement(announcePrevious.current, next);
    announcePrevious.current = next;
    if (text) setAnnounced((current) => ({ id: (current?.id ?? 0) + 1, text }));
  }, [
    visible,
    path,
    geometryRevision,
    stats,
    announceFit,
    bedLabel,
    displayedError,
    announceHint,
    editing.picking,
    navigationMode,
    activeView,
    display.projection,
    success,
    units,
  ]);
  if (format === "step" && !supportsPython)
    return (
      <div className={styles["model-library"]}>
        <div className={styles["model-document-bar"]}>
          <div className={styles["model-document-name"]}>
            <strong>{path.split("/").at(-1)}</strong>
            <small>STEP file</small>
          </div>
          <ModelTool label="Choose another model" onClick={picker}>
            <FolderOpenIcon />
          </ModelTool>
        </div>
        <div className={styles["model-empty"] + " h-full"}>
          <BoxIcon />
          <strong>Open this part in Fabrication</strong>
          <p>Update this host to preview STEP files, or open this part in Fabrication.</p>
          {settings.fabricationUrl && (
            <Button render={<a href={settings.fabricationUrl} target="_blank" rel="noreferrer" />}>
              Open in Fabrication
            </Button>
          )}
          <Button variant="outline" onClick={picker}>
            Choose another file
          </Button>
        </div>
      </div>
    );
  const issues =
    render?.log.filter((line) => line.level === "error" || line.level === "warning").length ?? 0;
  const plateFit = shownStats ? fitPlate(shownStats.size, plate).fit.status : "fits";
  const unapplied =
    session && !session.automatic && session.hasUnapplied
      ? changedParameters(session.data.parameters, session.values, session.applied).length
      : 0;
  const openRequests = openRequestCount(editing.data.annotations, geometryRevision);
  const badges: Partial<Record<InspectorTab, InspectorBadge>> = {};
  if (unapplied) badges.customize = { tone: "warning", count: unapplied };
  if (openRequests) badges.markup = { tone: "primary", count: openRequests };
  if (
    plateFit !== "fits" ||
    issues ||
    (printCheck.report && !printCheck.stale && printCheck.report.verdict !== "ready")
  )
    badges.part = { tone: "warning", count: null };
  const hint =
    editing.picking === "measure"
      ? editing.measureMode === "hole"
        ? "Click the rim or wall of the hole"
        : editing.pendingPoint
          ? "Click the second point"
          : "Click the first point to measure from"
      : editing.picking === "annotate"
        ? "Click the part you want changed"
        : editing.picking === "lay-flat"
          ? (editing.orientationMessage ?? "Click the face to rest on the bed")
          : null;
  return (
    <DisplayUnitsProvider value={unitsControl}>
      <div
        className={styles["model-workspace"]}
        tabIndex={-1}
        aria-label="3D model workspace"
        onKeyDown={(event) => {
          const typing =
            event.target instanceof HTMLElement &&
            event.target.closest("input, textarea, select, [contenteditable=true]");
          if (
            visible &&
            session &&
            !viewing &&
            !typing &&
            !event.defaultPrevented &&
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "z"
          ) {
            const index = session.historyCursor + (event.shiftKey ? 1 : -1);
            if (index >= 0 && index < session.historyLabels.length) session.moveHistory(index);
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (
            visible &&
            supportsHistory &&
            !typing &&
            !event.defaultPrevented &&
            !event.metaKey &&
            !event.ctrlKey &&
            (event.key === "[" || event.key === "]")
          ) {
            stepHistory(event.key === "[" ? -1 : 1);
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (
            !visible ||
            event.defaultPrevented ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            (event.target instanceof HTMLElement &&
              event.target.closest(
                "input, textarea, select, [contenteditable=true], [role=menu], [role=dialog], [role=listbox]",
              ))
          )
            return;
          const key = event.key.toLowerCase();
          const nudge = nudgeFor(event.key, event.shiftKey);
          if (key === "escape" && (editing.picking || editing.pendingRegion)) {
            if (editing.picking) editing.stopPicking();
            else editing.cancel();
          } else if (key === "escape" && selectedFindingId) setSelection(null);
          else if (key === "l" && supportsOrientation && !editDisabled) startTool("lay-flat");
          else if (key === "m" && !editDisabled) startTool("measure");
          else if (key === "n" && !editDisabled) startTool("annotate");
          else if (key === "s" && !editDisabled) toggleSection();
          else if (["1", "2", "3", "4"].includes(key) && shownStats)
            setView((["iso", "front", "top", "right"] as const)[Number(key) - 1]!);
          else if (key === "f" && shownStats) fit();
          else if (key === "h") setNavigationMode("pan");
          else if (key === "o") setNavigationMode("orbit");
          else if (key === "y" && supportsSlicing && !viewing) showLayers();
          else if (key === "t" && supportsHistory) {
            if (historyOpen) closeHistory();
            else setHistoryOpen(true);
          } else if (key === "i") setInspectorOpen((value) => !value);
          else if (key === "w") setDisplay((value) => ({ ...value, wireframe: !value.wireframe }));
          else if (key === "p")
            setDisplay((value) => ({
              ...value,
              projection: value.projection === "perspective" ? "orthographic" : "perspective",
            }));
          else if (key === "g") setDisplay((value) => ({ ...value, grid: !value.grid }));
          else if (key === "a") setDisplay((value) => ({ ...value, axes: !value.axes }));
          else if (key === "v") setDisplay((value) => ({ ...value, overhangs: !value.overhangs }));
          else if (key === "d" && previous) togglePrevious();
          else if ((key === "+" || key === "=") && stats) viewer.current?.zoom(1 / 1.2);
          else if (key === "-" && stats) viewer.current?.zoom(1.2);
          else if (stats && nudge && viewer.current?.owns(event.target))
            viewer.current.nudge(nudge);
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announced && <span key={announced.id}>{announced.text}</span>}
        </div>
        <div className={styles["model-document-bar"]}>
          {sourceFormat ? (
            <FileCode2Icon className="size-5 shrink-0 text-muted-foreground" />
          ) : (
            <BoxIcon className="size-5 shrink-0 text-muted-foreground" />
          )}
          <div className={styles["model-document-name"]}>
            <strong>{path.split("/").at(-1)}</strong>
            <small>
              {path.includes("/")
                ? path.slice(0, path.lastIndexOf("/"))
                : sourceFormat
                  ? format === "build123d"
                    ? "Python CAD source"
                    : "OpenSCAD source"
                  : `${format.toUpperCase()} model`}
            </small>
          </div>
          <div className={styles["model-document-actions"]}>
            {supportsHistory && (
              <HistoryControls
                open={historyOpen}
                onToggle={() => (historyOpen ? closeHistory() : setHistoryOpen(true))}
              />
            )}
            <CaptureMenu
              disabled={editDisabled}
              capturing={captureBusy}
              sheets={editing.data.presets}
              canCopy={canCopyImages()}
              onExport={(action, four) => void exportCapture(four, action)}
              onCapture={(four) => void capture(four)}
              onSheet={(sheet) =>
                void editing.captureViews(sheet.viewIds, sheet.includeMeasurements, sheet.name)
              }
            />
            <ModelTool
              label={inspectorOpen ? "Hide inspector" : "Show inspector"}
              kbd="I"
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen((value) => !value)}
            >
              <PanelRightIcon />
            </ModelTool>
            <Menu>
              <MenuTrigger
                render={<button className={styles["model-tool"]} aria-label="Model actions" />}
              >
                <MoreHorizontalIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={picker}>
                  <FolderOpenIcon />
                  Open another file
                </MenuItem>
                <MenuItem onClick={() => setRevision((value) => value + 1)}>
                  <RefreshCwIcon />
                  Reload from disk
                </MenuItem>
                <MenuSeparator />
                <MenuItem render={<Link to="/settings/loom" />}>
                  <Settings2Icon />
                  Printer and preview settings
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>
        <div
          className={styles["model-work-area"]}
          data-inspector-open={inspectorOpen}
          data-inspector-expanded={inspectorExpanded}
        >
          <div className={styles["model-viewport"]}>
            <div className={styles["model-canvas"]}>
              <Suspense
                fallback={
                  <div className={styles["model-loading"]}>
                    <BoxIcon />
                    Preparing viewer...
                  </div>
                }
              >
                {shownMesh && (visible || !release) && (
                  <ViewerCanvas
                    label={path.split("/").at(-1) ?? path}
                    url={shownMesh.url}
                    format={shownMesh.format}
                    plate={plate}
                    visible={visible}
                    viewerRef={viewer}
                    savedViewRef={savedView}
                    onStats={onStats}
                    orientation={supportsOrientation ? editing.orientation : null}
                    onOriented={onOriented}
                    closedHint={shownRender?.summary?.manifold ?? null}
                    onSectionCapsStatus={setSectionCaps}
                    {...(!editDisabled ? { onWall: editing.onWall } : {})}
                    findings={
                      !viewing && display.findings && !printCheck.stale
                        ? (printCheck.report?.findings ?? [])
                        : []
                    }
                    selectedFindingId={selectedFindingId}
                    onFinding={selectFinding}
                    onError={onError}
                    onProgress={onProgress}
                    sourceRevision={shownMesh.revision}
                    keepPrevious={!viewing}
                    compareModel={compareGeometry?.model ?? null}
                    layers={layersShown ? slicing.layers : null}
                    layer={slicing.layer}
                    previousShown={previousShown}
                    navigationMode={navigationMode}
                    display={display}
                    reference={referenceControl.reference}
                    overhangAngleDegrees={
                      adjustableOverhangs ? angleControl.angle : OVERHANG_ANGLE.default
                    }
                    onNavigate={onNavigate}
                    section={supportsCaps ? editing.section : { ...editing.section, caps: false }}
                    measurements={viewing ? [] : editing.measurements}
                    annotations={viewing ? [] : editing.annotations}
                    pendingPoint={viewing ? null : editing.pendingPoint}
                    pickMode={editDisabled ? null : editing.picking}
                    onPick={editing.onPick}
                    measureMode={editing.measureMode}
                    onCircle={editing.onCircle}
                    onSnapStatus={setSnapStatus}
                  />
                )}
              </Suspense>
            </div>
            {!shownMesh && !displayedError && viewing?.status !== "absent" && (
              <div className={styles["model-loading"]}>
                <BoxIcon />
                <p>{pending ? "Preparing your part..." : "Loading model..."}</p>
              </div>
            )}
            {viewing?.status === "absent" && (
              <div className={styles["model-loading"]}>
                <BoxIcon />
                <p>This model did not exist after turn {viewing.turn}.</p>
              </div>
            )}
            <ViewTools
              active={activeView}
              savedViews={viewing ? [] : editing.data.views}
              activeViewId={activeViewId}
              onView={setView}
              onSavedView={recallView}
              onSaveView={saveView}
              disabled={!shownStats}
            />
            <ToolRail
              tool={editing.picking}
              layFlat={supportsOrientation}
              section={editing.section.enabled}
              disabled={editDisabled}
              onTool={startTool}
              onSection={toggleSection}
            />
            {layersShown && slicing.layers && (
              <div className="absolute inset-x-4 bottom-20 z-10">
                <LayerSlider
                  layer={slicing.layer}
                  count={slicing.layers.layers.length}
                  zMm={slicing.layers.layers[slicing.layer]?.z ?? 0}
                  onChange={slicing.setLayer}
                  onClose={slicing.hideLayers}
                />
              </div>
            )}
            {!viewing && !layersShown && editing.section.enabled && stats && (
              <SectionStrip
                section={editing.section}
                {...(supportsCaps ? { capsState: sectionCaps } : {})}
                wireframe={display.wireframe}
                bounds={sectionBounds(editing.section.axis)}
                onChange={changeSection}
                onRemove={toggleSection}
              />
            )}
            {!viewing && hint && (
              <ToolHint onDone={editing.stopPicking}>
                {editing.picking === "measure" && (
                  <Segmented
                    label="Measure mode"
                    value={editing.measureMode}
                    options={[
                      { value: "distance", label: "Distance" },
                      ...(snapStatus === "off" ? [] : [{ value: "hole" as const, label: "Hole" }]),
                    ]}
                    onChange={editing.setMeasureMode}
                  />
                )}
                <span>{hint}</span>
                {editing.picking === "measure" && snapStatus === "building" && (
                  <span>Preparing snapping...</span>
                )}
                {editing.picking === "measure" && snapStatus === "off" && (
                  <span>Snapping is off for models over 1M triangles.</span>
                )}
                {editing.picking === "measure" && snapStatus === "failed" && (
                  <span>Snapping is unavailable for this model.</span>
                )}
              </ToolHint>
            )}
            {!viewing && changed === "chip" && previous && (
              <PreviousChip
                shown={previousShown}
                onToggle={togglePrevious}
                onDismiss={() => setChanged("dismissed")}
              />
            )}
            <DisplayTools
              onFindings={(findings) => setDisplay((value) => ({ ...value, findings }))}
              bed={
                <BedPicker
                  environmentId={threadRef.environmentId}
                  settings={displaySettings}
                  referenceControl={referenceControl}
                />
              }
              previous={{
                available: !viewing && previous !== null,
                shown: previousShown,
                note: previous
                  ? null
                  : previousTooLarge
                    ? "Previous versions are not kept for models over 1M triangles."
                    : "No previous version yet.",
                onChange: showPrevious,
              }}
              {...display}
              {...(supportsPrintCheck ? { findings: display.findings } : { findings: undefined })}
              orthographic={display.projection === "orthographic"}
              onOrthographic={(orthographic) =>
                setDisplay((value) => ({
                  ...value,
                  projection: orthographic ? "orthographic" : "perspective",
                }))
              }
              onWireframe={(wireframe) => setDisplay((value) => ({ ...value, wireframe }))}
              onGrid={(grid) => setDisplay((value) => ({ ...value, grid }))}
              onAxes={(axes) => setDisplay((value) => ({ ...value, axes }))}
              onOverhangs={(overhangs) => setDisplay((value) => ({ ...value, overhangs }))}
              overhangLegend={
                display.overhangs && stats ? (
                  <OverhangLegend
                    viewerRef={viewer}
                    sourceRevision={geometryRevision}
                    angleControl={angleControl}
                    adjustable={adjustableOverhangs}
                    wireframe={display.wireframe}
                    onHide={() => setDisplay((value) => ({ ...value, overhangs: false }))}
                  />
                ) : undefined
              }
            />
            <NavigationTools
              mode={navigationMode}
              onMode={setNavigationMode}
              onFit={fit}
              onZoom={(factor) => viewer.current?.zoom(factor)}
              disabled={!shownStats}
            />
            <div className={styles["model-status-overlay"]}>
              {compareError && (
                <div className={styles["model-notice"]} role="alert">
                  {compareError}
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setComparing(null);
                      setCompareError(null);
                    }}
                  >
                    Stop comparing
                  </Button>
                </div>
              )}
              {displayedError && (
                <div className={styles["model-notice"]} role="alert" data-tone="error">
                  <strong className="font-medium">
                    {shownStats ? "Preview is out of date" : "Unable to preview this model"}
                  </strong>
                  <p className="mt-1 wrap-anywhere">{displayedError}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tooLarge && (
                      <Button size="sm" variant="outline" onClick={() => setAllowLarge(true)}>
                        Load anyway
                      </Button>
                    )}
                    {format === "scad" && render && (
                      <Button size="sm" variant="outline" onClick={showLog}>
                        View render log
                      </Button>
                    )}
                    {pythonFormat && (
                      <Button size="sm" variant="outline" render={<Link to="/settings/loom" />}>
                        Python CAD setup
                      </Button>
                    )}
                    {settings.fabricationUrl && pythonFormat && (
                      <Button
                        size="sm"
                        variant="outline"
                        render={
                          <a href={settings.fabricationUrl} target="_blank" rel="noreferrer" />
                        }
                      >
                        Open in Fabrication
                      </Button>
                    )}
                    {displayedError.includes("OpenSCAD") && (
                      <Button
                        size="sm"
                        variant="outline"
                        render={
                          <a
                            href="https://openscad.org/downloads.html#snapshots"
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        Get OpenSCAD
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        viewing
                          ? void viewHistory(viewing.checkpointId, viewing.turn)
                          : setRevision((value) => value + 1)
                      }
                    >
                      Try again
                    </Button>
                  </div>
                </div>
              )}
              {editing.error && (
                <div className={styles["model-notice"]} data-tone="error" role="alert">
                  {editing.error}
                </div>
              )}
              {captureError && (
                <div className={styles["model-notice"]} role="alert" data-tone="error">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="font-medium">{captureError.title}</strong>
                    <ModelTool label="Dismiss capture error" onClick={() => setCaptureError(null)}>
                      <XIcon />
                    </ModelTool>
                  </div>
                  <p>{captureError.message}</p>
                </div>
              )}
              {busy && (
                <OperationStatus
                  label={
                    refreshing
                      ? "Refreshing model parameters"
                      : pending
                        ? pythonFormat
                          ? "Rendering Python CAD"
                          : "Rendering with OpenSCAD"
                        : "Loading model"
                  }
                  detail={
                    progress ??
                    (refreshing
                      ? "Reading source and saved sets."
                      : "Your current preview stays visible while the new geometry is prepared.")
                  }
                />
              )}
              {variantActivity && (!inspectorOpen || inspectorTab !== "variants") && (
                <OperationStatus {...variantActivity} />
              )}
              {editing.operation && (
                <OperationStatus
                  label={editing.operation}
                  detail="Preparing the image and saving your work."
                />
              )}
              {editing.pendingSaves > 0 && (
                <OperationStatus
                  label="Saving model workspace"
                  detail={`${editing.pendingSaves} pending change${editing.pendingSaves === 1 ? "" : "s"}.`}
                />
              )}
              {!editing.ready && !editing.error && (
                <OperationStatus label="Loading model workspace" />
              )}
              {success && (
                <div className={styles["model-floating"] + " w-fit gap-2 pl-3 text-xs"}>
                  <CheckIcon className="size-3.5" />
                  {success}
                  <ModelTool label="Dismiss capture message" onClick={() => setSuccess(null)}>
                    <XIcon />
                  </ModelTool>
                </div>
              )}
            </div>
          </div>
          <aside
            className={styles["model-inspector"]}
            hidden={!inspectorOpen}
            aria-label="Model inspector"
          >
            <InspectorTabs
              active={inspectorTab}
              onTab={setInspectorTab}
              onClose={() => {
                setInspectorOpen(false);
                viewer.current?.focus();
              }}
              scad={sourceFormat}
              badges={badges}
              expanded={inspectorExpanded}
              onExpand={() => setInspectorExpanded((value) => !value)}
            />
            <div className={styles["model-inspector-content"]}>
              {sourceFormat && !pythonUnavailable && (
                <fieldset
                  disabled={viewing !== null}
                  role="tabpanel"
                  aria-labelledby="model-tab-customize"
                  className={styles["model-inspector-tab-panel"]}
                  hidden={inspectorTab !== "customize"}
                >
                  <ScadFile
                    threadRef={threadRef}
                    path={path}
                    revision={revision}
                    pending={pending}
                    onSession={setSession}
                    onMesh={onMesh}
                    onResult={onResult}
                    onPending={onPending}
                    onRefreshing={setRefreshing}
                    onError={onLiveError}
                  />
                </fieldset>
              )}
              {sourceFormat && !pythonUnavailable && (
                <fieldset
                  role="tabpanel"
                  aria-labelledby="model-tab-variants"
                  disabled={viewing !== null || !editing.canEdit}
                  className={styles["model-inspector-tab-panel"]}
                  hidden={inspectorTab !== "variants"}
                >
                  <VariantsInspector
                    data={editing.data}
                    mutate={editing.mutate}
                    session={session}
                    threadRef={threadRef}
                    path={path}
                    plate={plate}
                    onActivity={setVariantActivity}
                    settings={displaySettings}
                    active={!viewing && visible && inspectorOpen && inspectorTab === "variants"}
                    slicingEnabled={supportsSlicing && !viewing && canRenderFormat}
                  />
                </fieldset>
              )}
              <div
                role="tabpanel"
                aria-labelledby="model-tab-markup"
                className={styles["model-inspector-tab-panel"]}
                hidden={inspectorTab !== "markup"}
              >
                <MarkupSection
                  data={{ ...editing.data, orientation: editing.orientation }}
                  mutate={editing.mutate}
                  sourceRevision={geometryRevision}
                  picking={editing.picking}
                  pendingRegion={editing.pendingRegion}
                  relink={editing.relink}
                  busy={editing.operation !== null}
                  disabled={editDisabled}
                  actions={markupActions}
                  {...(supportsPrintCheck && !viewing && canRenderFormat ? { printCheck } : {})}
                  findingsShown={display.findings}
                  onFindings={(findings) => setDisplay((value) => ({ ...value, findings }))}
                  selectedFindingId={selectedFindingId}
                  onFinding={selectFinding}
                />
              </div>
              <fieldset
                role="tabpanel"
                aria-labelledby="model-tab-views"
                disabled={viewing !== null || !editing.canEdit}
                className={styles["model-inspector-tab-panel"]}
                hidden={inspectorTab !== "views"}
              >
                <ViewsSection
                  data={editing.data}
                  mutate={editing.mutate}
                  sourceRevision={geometryRevision}
                  visible={!viewing && visible && inspectorOpen && inspectorTab === "views"}
                  activeViewId={activeViewId}
                  disabled={editDisabled}
                  onSave={saveView}
                  onRecall={recallView}
                  onUpdate={updateView}
                  onCapture={editing.captureViews}
                  onExport={exportViews}
                  canCopy={canCopyImages()}
                  onThumbnail={viewThumbnail}
                />
              </fieldset>
              <div
                role="tabpanel"
                aria-labelledby="model-tab-part"
                className={styles["model-inspector-tab-panel"]}
                hidden={inspectorTab !== "part"}
              >
                <PartSection
                  environmentId={threadRef.environmentId}
                  threadRef={threadRef}
                  {...(supportsSlicing && !viewing && canRenderFormat ? { slicing } : {})}
                  stats={shownStats}
                  previousSize={previous?.size ?? null}
                  {...(supportsPrintCheck && !viewing && canRenderFormat ? { printCheck } : {})}
                  selectedFindingId={selectedFindingId}
                  onFinding={selectFinding}
                  {...(supportsOrientation
                    ? {
                        orientation: {
                          value: editing.orientation,
                          sourceRevision: geometryRevision,
                          disabled: editDisabled,
                          picking: editing.picking === "lay-flat",
                          onFace: () => startTool("lay-flat"),
                          onAuto: () => void editing.autoOrient(),
                          onReset: () => void editing.resetOrientation(),
                          onBake: () => {
                            const current = viewer.current;
                            if (current)
                              void editing.prepareOrientationRequest(
                                format,
                                current.authoredCentre(),
                                current.orientedMinZ(),
                              );
                          },
                        },
                      }
                    : {})}
                  settings={displaySettings}
                  volume={volume}
                  render={shownRender}
                  format={format}
                  path={path}
                />
                {format === "build123d" && (
                  <ExportStep
                    canExport={canExportStep && !viewing && !busy}
                    filename={path.split("/").at(-1) ?? path}
                    urlOf={(relative) => modelUrl(threadRef.environmentId, relative)}
                    onExport={() =>
                      runModelCommand(models.exportStep, {
                        environmentId: threadRef.environmentId,
                        input: {
                          file,
                          overrides: session?.applied ?? {},
                          parameterSet: session?.setName ?? null,
                        },
                      })
                    }
                  />
                )}
              </div>
            </div>
          </aside>
        </div>
        {historyOpen && (
          <HistoryStrip
            chips={history.chips}
            viewing={viewing?.checkpointId ?? null}
            comparing={comparing}
            hasEarlier={
              history.pages.at(-1)?.nextCursor !== null &&
              history.pages.at(-1)?.nextCursor !== undefined
            }
            loading={history.status === "loading" || viewing?.status === "loading"}
            error={history.error}
            unavailable={history.unavailable}
            canRestore={canRestore && viewing?.status === "ready"}
            canPreview={canRenderFormat}
            onEarlier={history.loadEarlier}
            onView={(id) =>
              void viewHistory(id).catch((cause: unknown) => setCompareError(failureMessage(cause)))
            }
            onCompare={setComparing}
            onRestore={() => setRestoreOpen(true)}
            onClose={closeHistory}
          />
        )}
        {undo && (
          <div className="flex items-center gap-2 px-3 py-1 text-xs" role="status">
            <span>{undo.error ?? "Version restored."}</span>
            <Button
              size="xs"
              variant="ghost"
              disabled={!canUndo || undo.busy}
              onClick={() => {
                setUndo({ ...undo, busy: true });
                void runModelCommand(models.historyUndo, {
                  environmentId: threadRef.environmentId,
                  input: { file, undoId: undo.id },
                })
                  .then(() => {
                    setUndo(null);
                    setRevision((value) => value + 1);
                    history.refresh();
                  })
                  .catch((cause: unknown) =>
                    setUndo({ ...undo, busy: false, error: failureMessage(cause) }),
                  );
              }}
            >
              {undo.busy ? "Undoing…" : "Undo"}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Dismiss restore notice"
              disabled={undo.busy}
              onClick={() => setUndo(null)}
            >
              <XIcon />
            </Button>
          </div>
        )}
        {viewing && (
          <RestoreVersionDialog
            key={viewing.checkpointId}
            open={restoreOpen}
            label={viewing.turn === 0 ? "the start" : `turn ${viewing.turn}`}
            differingIncludes={viewing.result?.differingIncludes ?? []}
            threadRunning={history.threadRunning}
            onClose={() => setRestoreOpen(false)}
            onRestore={async (includeDependencies) => {
              if (!canRestore) throw new Error("This connection cannot restore models.");
              const restored = await runModelCommand(models.historyRestore, {
                environmentId: threadRef.environmentId,
                input: {
                  file,
                  checkpointId: viewing.checkpointId,
                  includeDependencies,
                  expectedContentKey: history.current?.contentKey ?? null,
                },
              });
              historyRequest.current++;
              setViewing(null);
              setComparing(null);
              setUndo({ id: restored.undoId, busy: false, error: null });
              setRevision((value) => value + 1);
              history.refresh();
            }}
          />
        )}
        <div className={styles["model-status-bar"]}>
          <span>
            {shownStats
              ? formatLengths(shownStats.size, units)
              : `Dimensions in ${unitName(units)}`}
          </span>
          {shownStats && (
            <span className={styles["model-triangle-count"]}>
              {shownStats.triangles.toLocaleString()} triangles
            </span>
          )}
          {viewing && <span>{viewingLabel(viewing.turn, history.latestTurn)}</span>}
          {comparison && (
            <span>
              Compare Δ {formatLengths(comparison.size, units)},{" "}
              {comparison.triangles > 0 ? "+" : ""}
              {comparison.triangles.toLocaleString()} triangles
            </span>
          )}
          {!viewing && editing.orientation && (
            <button className={styles["model-status-warning"]} onClick={() => openTab("part")}>
              Laid flat
            </button>
          )}
          {plateFit !== "fits" && (
            <button className={styles["model-status-warning"]} onClick={() => openTab("part")}>
              <TriangleAlertIcon />
              {plateFit === "fits-rotated" ? "Fits if rotated 90°" : "Larger than the bed"}
            </button>
          )}
          <span
            className={styles["model-render-state"]}
            data-busy={busy}
            data-error={!!displayedError}
          >
            <span className={styles["model-state-dot"]} />
            {displayedError ? (shownStats ? "Stale" : "Error") : busy ? "Updating" : "Ready"}
          </span>
        </div>
      </div>
    </DisplayUnitsProvider>
  );
}

export default function ModelPanel({ surface, threadRef, visible }: ForkPanelProps) {
  const result = useAtomValue(
    models.settings({ environmentId: threadRef.environmentId, input: {} }),
  );
  const settings = Option.getOrNull(AsyncResult.value(result));
  if (!surface.resourceId) return <ModelPicker threadRef={threadRef} />;
  if (result._tag === "Failure")
    return (
      <p role="alert" className="p-3">
        {failureMessage(Cause.squash(result.cause))}
      </p>
    );
  if (!settings) return <OperationStatus label="Loading model settings" />;
  if (surface.resourceId.endsWith(".loom-assembly.json"))
    return (
      <AssemblyPanel
        key={`${threadRef.environmentId}:${threadRef.threadId}:${surface.resourceId}`}
        threadRef={threadRef}
        path={surface.resourceId}
        visible={visible}
        settings={settings}
      />
    );
  return (
    <ModelFile
      key={`${threadRef.environmentId}:${threadRef.threadId}:${surface.resourceId}`}
      threadRef={threadRef}
      path={surface.resourceId}
      visible={visible}
      settings={settings}
    />
  );
}
