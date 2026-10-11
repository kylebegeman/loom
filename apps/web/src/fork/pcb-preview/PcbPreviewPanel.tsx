import { usePcbHistory } from "./usePcbHistory";
import { HistoryStrip } from "./HistoryStrip";
import { RestoreDesignDialog } from "./RestoreDesignDialog";
import { historyChips, stepChip, viewingLabel } from "./history";
import { onPcbAction } from "./actions";
import { CheckpointId, type CheckpointId as CheckpointIdType } from "@t3tools/contracts";
import type { PcbHistoryVersion } from "@t3tools/contracts/fork";
import { FabricationTab, type FabOutputPreview } from "./FabricationTab";
import { GerberPreview } from "./GerberPreview";
import { RequestPins } from "./RequestPins";
import { RequestForm, RequestsTab } from "./RequestsTab";
import { anchorPoint, describeAnchor, requestPrompt } from "./requests";
import { thumbnail } from "../model-preview-3d/viewer/captureSheet";
import { onRequestPcbChange } from "./requestCommands";
import type {
  PcbBounds,
  PcbChangeRequest,
  PcbChangeRequestDraft,
  PcbRequestAnchor,
} from "@t3tools/contracts/fork";
import { useChangeHighlights } from "./useChangeHighlights";
import { ChangeHighlights } from "./ChangeHighlights";
import { ChangesChip } from "./ChangesChip";
import type { PcbEditorEvent } from "@t3tools/contracts/fork";
import { randomUUID } from "~/lib/utils";
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useEffectEvent,
  lazy,
  Suspense,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  HistoryIcon,
  CheckIcon,
  ChevronDownIcon,
  CircuitBoardIcon,
  Columns2Icon,
  FileTextIcon,
  FolderSearchIcon,
  LayersIcon,
  MousePointer2Icon,
  MessageSquarePlusIcon,
  RulerIcon,
  ShieldCheckIcon,
  StickyNoteIcon,
  TriangleRightIcon,
  XIcon,
} from "lucide-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  PCB_LAYER_PRESETS,
  resolveLayerPreset,
  type PcbDesign,
  type PcbListDesignsResult,
  type PcbView,
  type PcbLayerPreset,
  type PcbLayerState,
  type PcbPoint,
  type PcbViolation,
  type PcbCheckKind,
  type PcbFinding,
} from "@t3tools/contracts/fork";
import { useServerConfigs } from "~/state/entities";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import type { ForkPanelProps } from "../panels/types";
import { runModelCommand as runPcbCommand } from "../model-preview-3d/state";
import { pcb } from "./state";
import { usePcbPreview, asyncValue, asyncError } from "./usePcbPreview";
import { usePcbPreferences, projectPreferenceKey, useLengthUnit } from "./preferences";
import { unitName } from "./length";
import {
  matchLayerSet,
  reconcileLayerChoice,
  reconcileSaved,
  sameVisibility,
  resolveEditorLayers,
} from "./layers";
import { initialView, reconcileLayers } from "./usePcbPreview.logic";
import { electronicsDesignUrl } from "./summary";
import { ToolButton } from "./ToolButton";
import {
  InspectorFrame,
  InspectorRail,
  ToolPanel,
  inspectorTabs,
  isInspectorTab,
  type InspectorTab,
} from "./Inspector";
import {
  CanvasState,
  CaptureMenu,
  DesignMenu,
  ExportDialog,
  ShortcutHelp,
  SurfaceSwitch,
  WorkspaceMenu,
  type Surface,
  type CaptureExportAction,
} from "./WorkspaceChrome";
import { usePcbWorkbench } from "./usePcbWorkbench";
import { LayerSheet } from "./LayerSheet";
import { CheckMarkers } from "./CheckMarkers";
import {
  checkFindings,
  reviewFindings,
  orderFindings,
  stepFinding,
  hitFinding,
  snapshotFinding,
} from "./findings";
import { DrawingOverlays } from "./Overlays";
import { snapPoint } from "./geometry";
import { attachModelImage, captureBase64 } from "../model-preview-3d/capture";
import {
  canCopyImages,
  captureFileName,
  copyImage,
  saveImage,
} from "../model-preview-3d/captureExport";
import { TrueScalePrintDialog } from "./TrueScalePrintDialog";
import { useComposerDraftStore } from "~/composerDraftStore";
import { appendSummary, checkSummary } from "./summary";
import { defaultBoardDisplay } from "./board3dParts";
import type { Pcb3dMeasurement } from "@t3tools/contracts/fork";
import type { Pcb3dHandle } from "./Board3D";
import type { PcbViewportHandle } from "./SvgViewport";
const Board3D = lazy(() => import("./Board3D").then((m) => ({ default: m.Board3D })));
import { SvgViewport } from "./SvgViewport";
import { PinMapDialog } from "./PinMapDialog";
import { ChecksSection } from "./ChecksSection";
import { OperationStatus } from "./OperationStatus";
import styles from "./workspace.module.css";

type Tool = "select" | "distance" | "angle" | "annotate" | "request";
const TOOLS = [
  { id: "select", label: "Select", key: "V", icon: MousePointer2Icon },
  { id: "distance", label: "Distance", key: "M", icon: RulerIcon },
  { id: "angle", label: "Angle", key: "A", icon: TriangleRightIcon },
  { id: "request", label: "Request", key: "R", icon: MessageSquarePlusIcon },
  { id: "annotate", label: "Note", key: "N", icon: StickyNoteIcon },
] as const;
const PRESET_LABELS: Record<PcbLayerPreset, string> = {
  front: "Front copper",
  back: "Back copper",
  all: "All copper",
};
type Notice = { tone: "info" | "error"; text: string; persistent?: boolean };

export function DesignWorkspace({
  threadRef,
  design,
  listing,
  listingBusy,
  listingError,
  preferenceKey,
  onSelect,
  onDiscover,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  listing: PcbListDesignsResult;
  listingBusy: boolean;
  listingError: string | null;
  preferenceKey: string;
  onSelect: (id: string) => void;
  onDiscover: () => void;
  onClose: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<PcbHistoryVersion | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<PcbHistoryVersion | null>(null);
  const [historyUndo, setHistoryUndo] = useState<{ id: string; label: string } | null>(null);
  const [compareInitial, setCompareInitial] = useState<{ from: string; to: string; key: string }>();
  const canRestore = useAtomValue(pcb.historyRestore.permissionAtom(threadRef.environmentId));
  const saved = usePcbPreferences((s) => s.selections[preferenceKey]);
  const unit = useLengthUnit();
  const setLengthUnit = usePcbPreferences((s) => s.setLengthUnit);
  const hiddenLayerPresets = usePcbPreferences((s) => s.hiddenLayerPresets);
  const checkMarkers = usePcbPreferences((s) => s.checkMarkers);
  const setCheckMarkers = usePcbPreferences((s) => s.setCheckMarkers);
  const [activeFinding, setActiveFinding] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [findingStatus, setFindingStatus] = useState("");
  const pngScale = usePcbPreferences((s) => s.pngScale);
  const setPngScale = usePcbPreferences((s) => s.setPngScale);
  const printPermission = useAtomValue(pcb.print.permissionAtom(threadRef.environmentId));
  const canBuild3d = useAtomValue(pcb.asset.permissionAtom(threadRef.environmentId));
  const canReadInspection = useAtomValue(pcb.inspect.permissionAtom(threadRef.environmentId));
  const [view, setView] = useState<PcbView>(() => initialView(design, saved?.view));
  const [layers, setLayers] = useState<PcbLayerPreset>(
    design.kind === "tscircuit" ? "front" : (saved?.layers ?? "front"),
  );
  const trusted = usePcbPreferences((s) => s.trusted.includes(preferenceKey));
  const executionAllowed = design.kind !== "tscircuit" || trusted;
  const trust = usePcbPreferences((s) => s.trust),
    remember = usePcbPreferences((s) => s.select);
  const electronicsBase = usePcbPreferences((s) => s.electronicsUrl);
  const electronics = electronicsDesignUrl(electronicsBase, design.absolutePath);
  const [customLayers, setCustomLayers] = useState<readonly PcbLayerState[] | null>(null),
    [tab, setTab] = useState<InspectorTab | null>(null),
    [expanded, setExpanded] = useState(false),
    [three, setThree] = useState(false),
    [outputs, setOutputs] = useState<FabOutputPreview | null>(null),
    [linked, setLinked] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [net, setNet] = useState<string | null>(null),
    [mode, setMode] = useState<Tool>("select"),
    [points, setPoints] = useState<readonly PcbPoint[]>([]),
    [note, setNote] = useState(""),
    [notice, setNotice] = useState<Notice | null>(null),
    [captureBusy, setCaptureBusy] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [printOpen, setPrintOpen] = useState(false),
    [exportBusy, setExportBusy] = useState(false),
    [measuringHeights, setMeasuringHeights] = useState(false);
  const [display3d, setDisplay3d] = useState(defaultBoardDisplay);
  const [pinMapFor, setPinMapFor] = useState<string | null>(null);
  const [requestForm, setRequestForm] = useState<{
    id: string;
    anchor: PcbRequestAnchor;
    view: PcbView;
    sheet: string;
    point: PcbPoint;
    initialText?: string;
    noteId?: string;
  } | null>(null);
  const [pendingRequest, setPendingRequest] = useState<PcbChangeRequest | null>(null);
  const [captureOnly, setCaptureOnly] = useState<readonly string[] | null>(null);
  const drawingWaiter = useRef<{
    view: PcbView;
    sheet: string;
    ids: readonly string[];
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const lastTab = useRef<InspectorTab>("Inspect");
  const board3d = useRef<Pcb3dHandle | null>(null);
  const viewport = useRef<PcbViewportHandle | null>(null),
    linkedViewport = useRef<PcbViewportHandle | null>(null),
    restoreView = useRef<{ sheet: string; camera: { x: number; y: number; scale: number } } | null>(
      null,
    );
  useEffect(() => {
    if (notice?.tone !== "info" || notice.persistent) return;
    const timeout = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const tabs = inspectorTabs(design);
  const openTab = (next: InspectorTab | null) => {
    if (next) lastTab.current = next;
    else setExpanded(false);
    setTab(next);
  };
  const layerNames =
    design.kind === "kicad" && view === "pcb" && customLayers
      ? customLayers.map((l) => l.name)
      : undefined;
  const preview = usePcbPreview(
    threadRef,
    design,
    view,
    layers,
    trusted,
    layerNames,
    !three && (!viewing || viewing.present),
    viewing?.checkpointId,
  );
  const history = usePcbHistory({
    threadRef,
    path: design.id,
    active: historyOpen || !!viewing,
    liveRevision: preview.sourceHash,
    selected: viewing?.checkpointId ?? null,
  });
  const showHistoryVersion = (id: CheckpointIdType | "now", version?: PcbHistoryVersion) => {
    if (viewport.current && preview.display)
      restoreView.current = { sheet: preview.display.sheetId, camera: viewport.current.snapshot() };
    setMode("select");
    setPoints([]);
    setLinked(false);
    setOutputs(null);
    setSelected(null);
    setNet(null);
    setActiveFinding(null);
    setViewing(
      id === "now"
        ? null
        : (version ??
            history.pages
              .flatMap((page) => page.versions)
              .find((version) => version.checkpointId === id) ??
            null),
    );
    setHistoryOpen(true);
  };
  const closeHistory = () => {
    showHistoryVersion("now");
    setHistoryOpen(false);
  };
  const toggleHistory = () => {
    if (historyOpen) closeHistory();
    else setHistoryOpen(true);
  };
  const stepHistory = async (direction: -1 | 1) => {
    setHistoryOpen(true);
    let pages = [...history.pages];
    if (!pages.length) {
      const page = await runPcbCommand(pcb.history, {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, designId: design.id },
      });
      history.includePage(page);
      pages = [page];
    }
    const next = stepChip(
      historyChips(pages, viewing?.checkpointId ?? null),
      viewing?.checkpointId ?? "now",
      direction,
    );
    if (next)
      showHistoryVersion(
        next,
        next === "now"
          ? undefined
          : pages.flatMap((page) => page.versions).find((version) => version.checkpointId === next),
      );
    else if (direction === -1 && pages.at(-1)?.nextCursor) history.loadEarlier();
  };
  const compareVersion = () => {
    if (viewing?.present) {
      setCompareInitial({ from: viewing.ref, to: "", key: randomUUID() });
      openTab("Compare");
    }
  };
  const historyAction = useEffectEvent((action: import("./actions").PcbAction) => {
    if (action === "history") toggleHistory();
    else
      void stepHistory(action === "history-previous" ? -1 : 1).catch((error) =>
        setNotice({
          tone: "error",
          text: error instanceof Error ? error.message : "Could not load history.",
        }),
      );
  });
  useEffect(() => onPcbAction(threadRef, historyAction), [threadRef]);
  const refreshPreview = () => {
    if (three) board3d.current?.refresh();
    else preview.refresh();
  };
  const workbench = usePcbWorkbench(
    threadRef,
    design.id,
    preview.sourceHash,
    design.toolAvailable && (design.kind === "kicad" || trusted),
  );
  const changes = useChangeHighlights({
    key: `${threadRef.environmentId}:${threadRef.threadId}:${design.id}`,
    inspection: workbench.inspection,
    display: preview.display,
    customLayers,
    suspended: three || !!viewing,
  });
  if (workbench.inspection && design.kind === "kicad") {
    const reconciled = reconcileLayerChoice(customLayers, workbench.inspection.layers, layers);
    if (reconciled !== customLayers) setCustomLayers(reconciled);
  }
  const activeLayerSet =
    design.kind === "kicad"
      ? matchLayerSet(customLayers, workbench.inspection?.layers ?? [], workbench.data.layerSets)
      : null;
  const customLayerLabel =
    activeLayerSet?.name ?? `${customLayers?.filter((layer) => layer.visible).length ?? 0} layers`;
  const supportsGlb =
    design.kind !== "kicad" || Number(design.toolStatus.version?.match(/^\d+/)?.[0] ?? 0) >= 10;
  const canMeasureHeights =
    supportsGlb &&
    !!design.boardPath &&
    design.toolAvailable &&
    executionAllowed &&
    canBuild3d &&
    canReadInspection;
  const measureDisabledReason = !design.boardPath
    ? "This design has no board"
    : !executionAllowed
      ? "Allow circuit code rendering to measure component heights"
      : !design.toolAvailable
        ? "Install this design's CAD tool on the environment host"
        : !supportsGlb
          ? "KiCad 10 or newer is required to measure component heights"
          : !canBuild3d || !canReadInspection
            ? "Rendering permission is required to measure component heights"
            : undefined;
  const refreshInspection = () =>
    appAtomRegistry.refresh(
      pcb.inspect.resultAtom({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          designId: design.id,
          revision: preview.sourceHash ?? "initial",
        },
      }),
    );
  const measureHeights = async () => {
    if (!canMeasureHeights)
      throw new Error(measureDisabledReason ?? "Component heights cannot be measured.");
    if (measuringHeights) return;
    setMeasuringHeights(true);
    try {
      await runPcbCommand(pcb.asset, {
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          designId: design.id,
          format: "glb",
          transport: "url",
        },
      });
      refreshInspection();
    } finally {
      setMeasuringHeights(false);
    }
  };
  const draftBoardStats = (text: string) => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(
      threadRef,
      appendSummary(store.getComposerDraft(threadRef)?.prompt ?? "", text),
    );
    setNotice({ tone: "info", text: "Board stats added to your draft." });
  };
  const drawingCurrent =
    !!preview.display &&
    preview.display.view === view &&
    preview.display.sheetId === preview.selectedSheet &&
    (viewing
      ? preview.display.requestKey === preview.requestKey
      : !preview.sourceHash || preview.display.sourceHash === preview.sourceHash) &&
    !preview.rendering &&
    !preview.loadingSheet;
  const canMark = !viewing && workbench.canEdit && workbench.ready;
  const pendingFocus = useRef<{ point: PcbPoint; view: PcbView; sheet?: string } | null>(null);
  const focusPoint = (target: PcbView, point: PcbPoint, sheet?: string) => {
    setThree(false);
    setView(target);
    if (
      target === preview.display?.view &&
      viewport.current?.isReady() &&
      (!sheet || sheet === preview.display?.sheetId)
    )
      viewport.current?.focus(point);
    else {
      pendingFocus.current = { point, view: target, ...(sheet ? { sheet } : {}) };
      if (sheet && target === "schematic") {
        const candidate = preview.good?.result.sheets.find(
          (s) => s.id === sheet || s.label === sheet,
        );
        preview.selectSheet(candidate?.id ?? sheet);
      }
    }
  };
  const allFindings = useMemo(
    () => [
      ...checkFindings(preview.checks.erc, "erc", { showExcluded }),
      ...checkFindings(preview.checks.drc, "drc", { showExcluded }),
      ...reviewFindings(preview.review, view, { showExcluded }),
      ...checkFindings(preview.fabCheck, "fab", { showExcluded }),
    ],
    [preview.checks, preview.review, preview.fabCheck, view, showExcluded],
  );
  const surfaceFindings = useMemo(
    () =>
      orderFindings(
        allFindings.filter(
          (f) =>
            f.source === "review" ||
            (f.source === "fab" && view === "pcb") ||
            f.source === (view === "schematic" ? "erc" : "drc"),
        ),
        view === "schematic"
          ? preview.good?.view === "schematic"
            ? preview.good.result.sheets.map((s) => s.id)
            : [...new Set(allFindings.flatMap((f) => (f.sheet ? [f.sheet] : [])))]
          : [],
      ),
    [allFindings, view, preview.good],
  );
  const drawingFindings = useMemo(
    () => surfaceFindings.filter((f) => view === "pcb" || f.sheet === preview.display?.sheetId),
    [surfaceFindings, view, preview.display?.sheetId],
  );
  const excludedFindingIds = useMemo(
    () => new Set(drawingFindings.filter((f) => f.excluded).map((f) => f.id)),
    [drawingFindings],
  );
  const activePoints = useMemo(
    () => drawingFindings.find((f) => f.id === activeFinding)?.otherPoints ?? [],
    [drawingFindings, activeFinding],
  );
  const markerReport = preview.checks[view === "schematic" ? "erc" : "drc"];
  const markersStale =
    (!!markerReport && markerReport.sourceHash !== preview.display?.sourceHash) ||
    (!!preview.review && preview.review.sourceHash !== preview.display?.sourceHash) ||
    (view === "pcb" &&
      !!preview.fabCheck &&
      preview.fabCheck.sourceHash !== preview.display?.sourceHash);
  const visibleActiveFinding = surfaceFindings.some((f) => f.id === activeFinding)
    ? activeFinding
    : null;
  const goToFinding = (finding: PcbFinding) => {
    setActiveFinding(finding.id);
    openTab("Checks");
    focusPoint(
      finding.source === "review" ? view : finding.source === "erc" ? "schematic" : "pcb",
      finding.pointMm,
      finding.sheet,
    );
  };
  const stepFindings = (direction: 1 | -1) => {
    const next = stepFinding(surfaceFindings, activeFinding, direction);
    if (!next) {
      const hasFindings = markerReport?.violations.some((v) => showExcluded || !v.excluded);
      const text = hasFindings
        ? "These findings have no position on the drawing."
        : "No findings on this drawing.";
      setNotice({ tone: "info", text });
      return;
    }
    setCheckMarkers(true);
    goToFinding(next.finding);
    setFindingStatus(
      next.wrapped
        ? direction === 1
          ? "Back to the first finding"
          : "Back to the last finding"
        : `Finding ${next.index + 1} of ${surfaceFindings.length}`,
    );
  };
  const activateViolation = (kind: PcbCheckKind, violation: PcbViolation) => {
    const report = preview.checks[kind];
    const index = report?.violations.indexOf(violation) ?? -1;
    setActiveFinding(violation.id ?? `${kind}-${index}`);
    setFindingStatus("");
  };
  const selectComponent = (reference: string | null) => {
    setSelected(reference);
    setNet(null);
    if (!reference) return;
    const c = workbench.inspection?.components.find((c) => c.reference === reference),
      p = view === "pcb" ? c?.pcb : c?.schematic;
    if (p) {
      if (view === "schematic" && p.sheet && p.sheet !== preview.selectedSheet) {
        pendingFocus.current = { point: p, view, sheet: p.sheet };
        preview.selectSheet(p.sheet);
      } else viewport.current?.focus(p);
    }
    const other = view === "pcb" ? c?.schematic : c?.pcb;
    if (other) linkedViewport.current?.focus(other);
  };
  const selectNet = (name: string | null) => {
    setSelected(null);
    setNet(name);
  };
  const selectPin = (reference: string, number: string) => {
    const component = workbench.inspection?.components.find((c) => c.reference === reference),
      pin = component?.pins.find((p) => p.number === number);
    if (!pin) throw new Error("Unknown component pin.");
    selectComponent(reference);
    setNet(pin.net || null);
    const point = view === "pcb" ? pin.pcb : pin.schematic;
    if (point) {
      if (view === "schematic" && point.sheet && point.sheet !== preview.selectedSheet) {
        pendingFocus.current = { point, view, sheet: point.sheet };
        preview.selectSheet(point.sheet);
      } else viewport.current?.focus(point);
    }
    const other = view === "pcb" ? pin.schematic : pin.pcb;
    if (other) linkedViewport.current?.focus(other);
  };
  const beginRequest = (
    anchor: PcbRequestAnchor,
    targetView = view,
    sheet = preview.selectedSheet,
    initialText?: string,
    noteId?: string,
  ) => {
    const point = anchorPoint(anchor, workbench.inspection, targetView, sheet);
    if (!point) {
      setNotice({ tone: "error", text: "That component or net is no longer on this drawing." });
      return;
    }
    setRequestForm({
      id: randomUUID(),
      anchor,
      view: targetView,
      sheet,
      point,
      ...(initialText ? { initialText } : {}),
      ...(noteId ? { noteId } : {}),
    });
    openTab("Requests");
    setExpanded(false);
    setMode("select");
  };
  const startRequest = () => {
    if (!canMark || !workbench.canRequest || !drawingCurrent) {
      setNotice({
        tone: "error",
        text: "Wait for workspace write permission and the current drawing before requesting a change.",
      });
      return;
    }
    if (selected) beginRequest({ kind: "component", reference: selected });
    else if (net) beginRequest({ kind: "net", name: net });
    else {
      setRequestForm(null);
      setMode("request");
      setPoints([]);
    }
  };
  const notifyDrawing = () => {
    const waiter = drawingWaiter.current;
    if (
      waiter &&
      preview.display?.view === waiter.view &&
      (waiter.view === "pcb" || preview.display.sheetId === waiter.sheet) &&
      drawingCurrent &&
      viewport.current?.isReady() &&
      JSON.stringify(captureOnly) === JSON.stringify(waiter.ids)
    ) {
      drawingWaiter.current = null;
      waiter.resolve();
    }
  };
  useLayoutEffect(() => {
    notifyDrawing();
  });
  useEffect(
    () => () => {
      drawingWaiter.current?.reject(new Error("The PCB drawing closed before capture."));
      drawingWaiter.current = null;
    },
    [],
  );
  const requestCommand = useEffectEvent(() => startRequest());
  useEffect(() => onRequestPcbChange(threadRef, () => requestCommand()), [threadRef]);
  const waitForDrawing = (targetView: PcbView, sheet: string, ids: readonly string[]) =>
    new Promise<void>((resolve, reject) => {
      if (drawingWaiter.current) {
        reject(new Error("Another request capture is in progress."));
        return;
      }
      const timeout = setTimeout(() => {
        drawingWaiter.current = null;
        reject(new Error("The requested drawing did not become ready for capture."));
      }, 180000);
      drawingWaiter.current = {
        view: targetView,
        sheet,
        ids,
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      setThree(false);
      setView(targetView);
      if (targetView === "schematic") preview.selectSheet(sheet);
      setCaptureOnly(ids);
    });
  const focusRequest = (r: PcbChangeRequest) => {
    const point = anchorPoint(r.anchor, workbench.inspection, r.view, r.sheet);
    if (!point) {
      setNotice({ tone: "info", text: `${describeAnchor(r.anchor)} is no longer in the design.` });
      return;
    }
    setSelected(r.anchor.kind === "component" ? r.anchor.reference : null);
    setNet(r.anchor.kind === "net" ? r.anchor.name : null);
    focusPoint(r.view, point, r.sheet);
  };
  const withRequestDrawing = async <A,>(
    r: PcbChangeRequest,
    capture: (handle: PcbViewportHandle) => Promise<A>,
  ) => {
    const original = {
      view,
      sheet: preview.selectedSheet,
      camera: viewport.current?.snapshot(),
      three,
    };
    try {
      await waitForDrawing(r.view, r.sheet, [r.id]);
      return await capture(viewport.current!);
    } finally {
      setCaptureOnly(null);
      setView(original.view);
      if (original.view === "schematic") preview.selectSheet(original.sheet);
      setThree(original.three);
      if (original.camera) restoreView.current = { sheet: original.sheet, camera: original.camera };
    }
  };
  const captureRequest = (r: PcbChangeRequest) =>
    withRequestDrawing(r, (handle) => handle.capture(true));
  const addRequestsToDraft = async (ids: readonly string[], requests = workbench.data.requests) => {
    const chosen = ids
      .map((id) => requests.find((r) => r.id === id))
      .filter((r): r is PcbChangeRequest => !!r);
    if (!chosen.length || chosen.length > 10)
      throw new Error("Choose between one and ten requests.");
    if (captureBusy) throw new Error("Another capture is in progress.");
    const original = {
      view,
      sheet: preview.selectedSheet,
      camera: viewport.current?.snapshot(),
      three,
    };
    setCaptureBusy(true);
    try {
      const groups = new Map<string, PcbChangeRequest[]>();
      for (const r of chosen) {
        if (!anchorPoint(r.anchor, workbench.inspection, r.view, r.sheet)) {
          if (!r.referenceImage)
            throw new Error(
              `${describeAnchor(r.anchor)} is no longer in the design and has no reference capture.`,
            );
          const blob = await (await fetch(r.referenceImage)).blob();
          await attachModelImage(blob, threadRef, `${design.name}-request.png`);
          continue;
        }
        const key = JSON.stringify([r.view, r.sheet]);
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      for (const group of groups.values()) {
        await waitForDrawing(
          group[0]!.view,
          group[0]!.sheet,
          chosen.map((r) => r.id),
        );
        await attachModelImage(
          await viewport.current!.capture(true),
          threadRef,
          `${design.name}-${group[0]!.view}-requests.png`,
        );
      }
      const store = useComposerDraftStore.getState();
      store.setPrompt(
        threadRef,
        appendSummary(
          store.getComposerDraft(threadRef)?.prompt ?? "",
          requestPrompt(chosen, design.id, preview.sourceHash ?? "unknown"),
        ),
      );
      await workbench.changeRequest({ op: "sent", ids: chosen.map((r) => r.id) });
    } finally {
      setCaptureBusy(false);
      setCaptureOnly(null);
      setView(original.view);
      if (original.view === "schematic") preview.selectSheet(original.sheet);
      setThree(original.three);
      if (original.camera) restoreView.current = { sheet: original.sheet, camera: original.camera };
    }
  };
  const saveRequest = async (title: string, text: string, add: boolean) => {
    if (!requestForm || !preview.sourceHash)
      throw new Error("Choose a request anchor on the current drawing.");
    const draft: PcbChangeRequestDraft = {
      id: requestForm.id,
      title,
      request: text,
      anchor: requestForm.anchor,
      view: requestForm.view,
      sheet: requestForm.sheet,
      point: requestForm.point,
      sourceHash: preview.sourceHash,
      referenceImage: null,
    };
    const pending: PcbChangeRequest = {
      ...draft,
      createdAt: "",
      status: "open",
      baseRef: null,
      sentAt: null,
      response: null,
      reviewRevision: null,
      resolvedRevision: null,
      resolvedRef: null,
      resolvedAt: null,
    };
    setPendingRequest(pending);
    try {
      const image = await captureRequest(pending);
      const savedDraft = { ...draft, referenceImage: await thumbnail(image, 24000) };
      const result = await workbench.changeRequest(
        requestForm.noteId
          ? { op: "convert-note", noteId: requestForm.noteId, request: savedDraft }
          : { op: "create", request: savedDraft, sent: false },
      );
      setRequestForm(null);
      setPendingRequest(null);
      if (add) await addRequestsToDraft([draft.id], result.requests);
    } catch (cause) {
      setNotice({
        tone: "error",
        text: cause instanceof Error ? cause.message : "The request could not be saved.",
      });
      throw cause;
    } finally {
      setPendingRequest(null);
    }
  };
  const chooseTool = (next: Tool) => {
    if (next === "request") {
      startRequest();
      return;
    }
    setMode(next);
    setPoints([]);
  };
  const pick = async (point: PcbPoint, snap: boolean) => {
    if (!drawingCurrent || !viewport.current?.isReady()) {
      setNotice({ tone: "info", text: "Wait for the current drawing to load before picking." });
      return false;
    }
    const candidates =
      workbench.inspection?.components.flatMap((c) =>
        c.pins.flatMap((p) => (p.pcb ? [p.pcb] : [])),
      ) ?? [];
    const p = view === "pcb" && snap ? snapPoint(point, candidates, 1) : point;
    if (mode === "select") {
      const finding = checkMarkers
        ? hitFinding(drawingFindings, point, viewport.current.unitsPerPixel())
        : null;
      if (finding) {
        goToFinding(finding);
        setFindingStatus("");
        return true;
      }
      setActiveFinding(null);
      const nearest = workbench.inspection?.components
        .filter((c) => (view === "pcb" ? c.pcb : c.schematic?.sheet === preview.selectedSheet))
        .toSorted((a, b) => {
          const pa = view === "pcb" ? a.pcb : a.schematic,
            pb = view === "pcb" ? b.pcb : b.schematic;
          return (
            Math.hypot((pa?.x ?? 1e9) - p.x, (pa?.y ?? 1e9) - p.y) -
            Math.hypot((pb?.x ?? 1e9) - p.x, (pb?.y ?? 1e9) - p.y)
          );
        })[0];
      if (nearest) selectComponent(nearest.reference);
      return !!nearest;
    }
    if (mode === "request") {
      beginRequest({ kind: "area", box: { x: p.x - 1, y: p.y - 1, width: 2, height: 2 } });
      return true;
    }
    if (mode === "annotate") {
      if (!note.trim()) {
        setNotice({ tone: "info", text: "Write the note first, then click where it belongs." });
        return false;
      }
      const saved = await workbench
        .mutate((d) => ({
          ...d,
          annotations: [
            ...d.annotations,
            {
              id: randomUUID(),
              text: note.trim(),
              point: p,
              view,
              sheet: preview.selectedSheet,
              sourceHash: preview.display!.sourceHash,
            },
          ],
        }))
        .then(
          () => true,
          () => false,
        );
      if (!saved) return false;
      setMode("select");
      setNote("");
      return true;
    }
    const next = [...points, p];
    if (next.length === (mode === "angle" ? 3 : 2)) {
      const saved = await workbench
        .mutate((d) => ({
          ...d,
          measurements: [
            ...d.measurements,
            {
              id: randomUUID(),
              kind: mode,
              points: next,
              view,
              sheet: preview.selectedSheet,
              sourceHash: preview.display!.sourceHash,
            },
          ],
        }))
        .then(
          () => true,
          () => false,
        );
      if (!saved) return false;
      setPoints([]);
      setMode("select");
    } else setPoints(next);
    return true;
  };
  const capture = async (full: boolean) => {
    if (captureBusy) return;
    setCaptureBusy(true);
    setNotice(null);
    try {
      const store = useComposerDraftStore.getState();
      if (three) {
        if (!board3d.current) throw new Error("Wait for the 3D board to load.");
        await attachModelImage(await board3d.current.capture(), threadRef, `${design.name}-3d.png`);
        store.setPrompt(
          threadRef,
          appendSummary(
            store.getComposerDraft(threadRef)?.prompt ?? "",
            `PCB 3D capture: ${design.id}\nSource revision: ${preview.sourceHash ?? "unknown"}`,
          ),
        );
      } else {
        if (!viewport.current || !preview.display)
          throw new Error("Wait for the drawing to load before capturing.");
        await attachModelImage(
          await viewport.current.capture(full),
          threadRef,
          `${design.name}-${view}.png`,
        );
        const context = `PCB capture: ${design.id}\nView: ${preview.display.view}; sheet: ${preview.display.sheetId}\nSource revision: ${preview.display.sourceHash}\nSelected component: ${selected ?? "none"}; net: ${net ?? "none"}\nLayers: ${
          customLayers
            ?.filter((l) => l.visible)
            .map((l) => l.name)
            .join(", ") ?? layers
        }\nPinned measurements and annotations are included.`;
        store.setPrompt(
          threadRef,
          appendSummary(store.getComposerDraft(threadRef)?.prompt ?? "", context),
        );
      }
      setNotice({ tone: "info", text: "Capture attached to your draft." });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Capture failed." });
    } finally {
      setCaptureBusy(false);
    }
  };

  const exportCapture = async (full: boolean, action: CaptureExportAction) => {
    if (captureBusy) return;
    setCaptureBusy(true);
    setNotice(null);
    try {
      const format = action === "svg" ? "svg" : "png";
      const surfaceLabel = three ? "3d" : view === "pcb" ? "board" : "schematic";
      const sheetLabel =
        !three && view === "schematic" && (preview.display?.result.sheets.length ?? 0) > 1
          ? preview.display?.result.sheets.find((sheet) => sheet.id === preview.selectedSheet)
              ?.label
          : null;
      const label = sheetLabel ? `${surfaceLabel}-${sheetLabel}` : surfaceLabel;
      const fileName = captureFileName(
        design.id.replace(/\.circuit\.tsx$/, ".tsx"),
        label,
        new Date(),
        format,
      );
      if (format === "svg") {
        if (three) throw new Error("SVG export is available for 2D drawings.");
        if (!viewport.current) throw new Error("Wait for the drawing to load before capturing.");
        saveImage(
          new Blob([await viewport.current.exportSvg(full)], { type: "image/svg+xml" }),
          fileName,
        );
        setNotice({ tone: "info", text: "Download started." });
      } else {
        const result = three
          ? {
              image: board3d.current
                ? board3d.current.capture()
                : Promise.reject(new Error("Wait for the 3D board to load.")),
              reduced: false,
            }
          : viewport.current?.exportPng(full, pngScale);
        if (!result) throw new Error("Wait for the drawing to load before capturing.");
        // Clipboard permission belongs to the initiating gesture, before rendering awaits.
        if (action === "copy") await copyImage(result.image);
        else saveImage(await result.image, fileName);
        setNotice({
          tone: "info",
          text: `${action === "copy" ? "Image copied." : "Download started."}${result.reduced ? " Size reduced to the browser canvas limit." : ""}`,
        });
      }
    } catch (cause) {
      setNotice({
        tone: "error",
        text: cause instanceof Error ? cause.message : "Capture export failed.",
      });
    } finally {
      setCaptureBusy(false);
    }
  };

  const editorEvents = useAtomValue(
    pcb.editorEvents({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, designId: design.id },
    }),
  );
  const request = asyncValue(editorEvents),
    handledRequest = useRef<string | null>(null);
  const handleEditorRequest = useEffectEvent((request: PcbEditorEvent | null) => {
    if (!request || handledRequest.current === request.requestId) return;
    handledRequest.current = request.requestId;
    const execute = async () => {
      const c = request.command;
      let png: string | undefined;
      let svg: string | undefined;
      let measurement3d: Pcb3dMeasurement | undefined;
      let settledChanges: ReturnType<typeof changes.state> | undefined;
      const drawing = () => {
        if (!viewport.current?.isReady() || !preview.display || three)
          throw new Error("Open a loaded 2D drawing for this action.");
        return viewport.current;
      };
      const model = () => {
        if (!board3d.current?.isReady() || !three)
          throw new Error("Open a loaded 3D board for this action.");
        return board3d.current;
      };
      if (
        viewing &&
        [
          "capture",
          "tool",
          "measure",
          "height",
          "select",
          "net",
          "load-view",
          "finding",
          "markers",
          "changes",
        ].includes(c.action)
      )
        throw new Error("These tools work on the current version.");
      switch (c.action) {
        case "turn-history": {
          if (c.enabled === false) closeHistory();
          else if (!c.name) {
            if (c.enabled === true) setHistoryOpen(true);
            else toggleHistory();
          } else if (c.name === "current") showHistoryVersion("now");
          else {
            const id = CheckpointId.make(c.name);
            let pages = [...history.pages];
            let version = pages
              .flatMap((page) => page.versions)
              .find((version) => version.checkpointId === id);
            let cursor: number | null = null;
            while (!version) {
              const page: import("@t3tools/contracts/fork").PcbHistory = await runPcbCommand(
                pcb.history,
                {
                  environmentId: threadRef.environmentId,
                  input: { threadId: threadRef.threadId, designId: design.id, cursor },
                },
              );
              history.includePage(page);
              pages.push(page);
              version = page.versions.find((version) => version.checkpointId === id);
              if (!page.nextCursor) break;
              cursor = page.nextCursor;
            }
            if (!version) throw new Error("Turn not found. List versions with loom_pcb_history.");
            showHistoryVersion(id, version);
          }
          break;
        }
        case "turn-compare": {
          if (!viewing) throw new Error("View a version with turn-history first.");
          const target =
            c.name && c.name !== "current"
              ? history.pages
                  .flatMap((page) => page.versions)
                  .find((version) => version.checkpointId === c.name)
              : null;
          if (c.name && c.name !== "current" && !target)
            throw new Error("Turn not found. List versions with loom_pcb_history.");
          setCompareInitial({ from: viewing.ref, to: target?.ref ?? "", key: randomUUID() });
          openTab("Compare");
          break;
        }
        case "refresh":
          if (three) model().refresh();
          else preview.refresh();
          break;
        case "cancel":
          preview.cancelRender();
          preview.cancelCheck();
          setThree(false);
          setMode("select");
          setPoints([]);
          break;
        case "checks":
          if (c.enabled === false) {
            if (tab === "Checks") openTab(null);
          } else if (!tabs.includes("Checks"))
            throw new Error("ERC and DRC are available for KiCad designs.");
          else openTab("Checks");
          break;
        case "finding": {
          drawing();
          if (c.name === "next" || c.name === "previous") stepFindings(c.name === "next" ? 1 : -1);
          else {
            const finding = allFindings.find((f) => f.id === c.name);
            if (!finding)
              throw new Error("No finding with that id. Read the snapshot for current ids.");
            setCheckMarkers(true);
            goToFinding(finding);
            setFindingStatus("");
          }
          break;
        }
        case "changes":
          drawing();
          if (!changes.pair) throw new Error("This design has not changed since it was opened.");
          changes.show(c.enabled ?? true);
          if (c.enabled !== false) settledChanges = await changes.drawingSettled();
          break;
        case "markers":
          setCheckMarkers(c.enabled ?? !checkMarkers);
          break;
        case "trust":
          trust(preferenceKey, c.enabled ?? false);
          break;
        case "pick":
          drawing();
          if (!c.point || (mode !== "select" && (!workbench.canEdit || !workbench.ready)))
            throw new Error(
              "Provide a drawing point and wait for editable workspace data before saving marks.",
            );
          if (!(await pick(c.point, c.enabled ?? true)))
            throw new Error(
              "The drawing pick could not be completed. Check the note or workspace save error.",
            );
          break;
        case "prepare-summary": {
          if (c.name !== "erc" && c.name !== "drc") throw new Error("Choose erc or drc.");
          const report = preview.checks[c.name];
          if (!report) throw new Error("Run the selected check before preparing its summary.");
          const store = useComposerDraftStore.getState();
          store.setPrompt(
            threadRef,
            appendSummary(
              store.getComposerDraft(threadRef)?.prompt ?? "",
              checkSummary(design, report, report.sourceHash !== preview.sourceHash),
            ),
          );
          break;
        }
        case "fit":
          if (three) model().fit();
          else drawing().fit();
          break;
        case "zoom":
          if (three) model().zoom(1 / (c.factor ?? 1));
          else drawing().zoom(c.factor ?? 1);
          break;
        case "pan":
          drawing().pan(c.point ?? { x: 0, y: 0 });
          break;
        case "back":
          drawing().back();
          break;
        case "forward":
          drawing().forward();
          break;
        case "focus":
          if (c.requestId) {
            const r = workbench.data.requests.find((r) => r.id === c.requestId);
            if (!r) throw new Error("Unknown change request.");
            focusRequest(r);
            break;
          }
          if (!c.point) throw new Error("Provide a point to focus.");
          drawing().focus(c.point);
          break;
        case "snapshot":
          break;
        case "display": {
          const viewer = model();
          if (c.layers3d) viewer.displayLayers(c.layers3d);
          if (c.projection) setDisplay3d((current) => ({ ...current, projection: c.projection! }));
          break;
        }
        case "section":
          model();
          if (c.section) setDisplay3d((current) => ({ ...current, section: c.section! }));
          else
            setDisplay3d((current) => ({
              ...current,
              section: { ...current.section, enabled: c.enabled ?? !current.section.enabled },
            }));
          break;
        case "measure":
          if (c.enabled === false) model().clearMeasurements();
          else if (c.points) measurement3d = await model().measure(c.points, c.snap ?? true);
          else model().chooseTool("distance");
          break;
        case "height":
          if (c.reference || c.point || c.points) measurement3d = model().height(c);
          else model().chooseTool("height");
          break;
        case "camera":
          if (c.camera) model().restore(c.camera);
          else if (c.cameraView) model().setView(c.cameraView);
          else throw new Error("Provide a 3D camera or cameraView.");
          break;
        case "sheet":
          if (!preview.good?.result.sheets.some((s) => s.id === c.name))
            throw new Error("Choose an available sheet.");
          preview.selectSheet(c.name ?? "");
          break;
        case "open":
        case "close":
        case "maximize":
          throw new Error("Use the panel action host for this action.");
        case "view":
          if (c.view) {
            if (!(c.view === "pcb" ? design.boardPath : design.schematicPath))
              throw new Error("The selected drawing is unavailable for this design.");
            setView(c.view);
            setThree(false);
          }
          break;
        case "select":
          if (
            c.reference &&
            !workbench.inspection?.components.some((v) => v.reference === c.reference)
          )
            throw new Error("Unknown component reference.");
          if (c.reference && c.pin) selectPin(c.reference, c.pin);
          else selectComponent(c.reference ?? null);
          break;
        case "net":
          if (c.net && !workbench.inspection?.nets.some((v) => v.name === c.net))
            throw new Error("Unknown net.");
          selectNet(c.net ?? null);
          break;
        case "layers": {
          const next = resolveEditorLayers(
            c,
            workbench.inspection?.layers ?? [],
            workbench.data.layerSets,
          );
          if (next !== undefined) setCustomLayers(next);
          break;
        }
        case "split":
          if (c.enabled !== false && (!design.boardPath || !design.schematicPath))
            throw new Error("Linked drawings require both a board and schematic.");
          setLinked(c.enabled ?? true);
          setThree(false);
          break;
        case "3d":
          if (c.enabled !== false && !design.boardPath)
            throw new Error("This design has no board to render in 3D.");
          if (c.enabled !== false && !executionAllowed)
            throw new Error("Allow circuit code rendering before opening 3D.");
          setThree(c.enabled ?? true);
          setLinked(false);
          break;
        case "tool":
          if (three) {
            if (c.name !== "select" && c.name !== "distance" && c.name !== "height")
              throw new Error("Choose select, distance or height in 3D.");
            model().chooseTool(c.name === "select" ? "none" : c.name);
            break;
          }
          if (TOOLS.some((t) => t.id === c.name)) {
            chooseTool(c.name as Tool);
            if (c.text !== undefined) setNote(c.text);
          } else throw new Error("Choose select, distance, angle, annotate or request.");
          break;
        case "open-tools":
          if (c.enabled === false) openTab(null);
          else if (!isInspectorTab(c.name)) throw new Error("Unknown tool dock.");
          else if (!tabs.includes(c.name))
            throw new Error(`${c.name} is unavailable for this design.`);
          else openTab(c.name);
          break;
        case "load-view": {
          const saved = workbench.data.views.find((v) => v.id === c.name || v.name === c.name);
          if (!saved) throw new Error("The named view is unavailable.");
          if (!(saved.view === "pcb" ? design.boardPath : design.schematicPath))
            throw new Error("The saved drawing is unavailable for this design.");
          setView(saved.view);
          setThree(false);
          setCustomLayers(reconcileSaved(saved.layers, workbench.inspection?.layers ?? []));
          preview.selectSheet(saved.sheet);
          restoreView.current = { sheet: saved.sheet, camera: saved.camera };
          viewport.current?.restore(saved.camera);
          break;
        }
        case "capture": {
          if (captureBusy) throw new Error("Another capture is in progress.");
          if (c.format === "svg" && (three || c.attachToDraft))
            throw new Error(
              three
                ? "SVG capture is available for 2D drawings."
                : "SVG captures cannot be attached as draft images.",
            );
          setCaptureBusy(true);
          try {
            if (c.requestId) {
              const r = workbench.data.requests.find((r) => r.id === c.requestId);
              if (!r) throw new Error("Unknown change request.");
              if (c.format === "svg")
                svg = await withRequestDrawing(r, (handle) => handle.exportSvg(c.full ?? true));
              else {
                const blob = await captureRequest(r);
                if (c.attachToDraft)
                  await attachModelImage(blob, threadRef, `${design.name}-request.png`);
                png = await captureBase64(blob);
              }
            } else if (c.format === "svg") svg = await drawing().exportSvg(c.full ?? false);
            else {
              const blob = three
                ? await model().capture()
                : c.scale
                  ? await drawing().exportPng(c.full ?? false, c.scale).image
                  : await drawing().capture(c.full ?? false);
              if (c.attachToDraft)
                await attachModelImage(
                  blob,
                  threadRef,
                  `${design.name}-${three ? "3d" : view}.png`,
                );
              png = await captureBase64(blob);
            }
          } finally {
            setCaptureBusy(false);
          }
          break;
        }

        default: {
          // A newer server can send an action this client does not know yet.
          const unknown: never = c.action;
          throw new Error(`This client does not support the "${String(unknown)}" editor action.`);
        }
      }
      return {
        png,
        svg,
        measurement3d,
        state:
          c.action === "snapshot" || c.action === "changes"
            ? {
                turnHistory: {
                  open: historyOpen,
                  checkpointId: viewing?.checkpointId ?? null,
                  turn: viewing?.turn ?? null,
                  latestTurn: history.latestTurn,
                },
                view,
                sheet: preview.selectedSheet,
                three,
                linked,
                selected,
                net,
                camera: three && board3d.current?.isReady() ? model().snapshot() : null,
                ...(three && board3d.current?.isReady() ? model().state() : {}),
                drawingCamera: !three && viewport.current ? viewport.current.snapshot() : null,
                layers: customLayers ?? [],
                ...(activeLayerSet
                  ? {
                      layerPreset:
                        activeLayerSet.kind === "built-in"
                          ? activeLayerSet.id
                          : activeLayerSet.name,
                    }
                  : {}),
                sourceHash: preview.sourceHash ?? "",
                changes: settledChanges
                  ? { ...settledChanges, shown: c.enabled ?? true }
                  : changes.state(),
                findings: {
                  visible: checkMarkers && !three && preview.display?.view === view,
                  showExcluded,
                  active: !three ? visibleActiveFinding : null,
                  total: three ? 0 : surfaceFindings.length,
                  items: three ? [] : surfaceFindings.slice(0, 50).map(snapshotFinding),
                },
                tool: mode,
                dock: tab,
                loading:
                  preview.rendering ||
                  !!preview.checking ||
                  captureBusy ||
                  measuringHeights ||
                  workbench.pending > 0 ||
                  (three && (!board3d.current || board3d.current.isLoading())),
              }
            : undefined,
      };
    };
    void execute()
      .then(({ png, svg, state, measurement3d }) =>
        runPcbCommand(pcb.completeEditorAction, {
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            designId: design.id,
            requestId: request.requestId,
            message: "Editor action completed.",
            ...(state ? { state } : {}),
            ...(png ? { png } : {}),
            ...(svg ? { svg } : {}),
            ...(measurement3d ? { measurement3d } : {}),
          },
        }),
      )
      .catch((cause) =>
        runPcbCommand(pcb.completeEditorAction, {
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            designId: design.id,
            requestId: request.requestId,
            message: cause instanceof Error ? cause.message : "Editor action failed.",
            error: true,
          },
        }).catch(() => undefined),
      );
  });
  useEffect(() => {
    handleEditorRequest(request);
  }, [request]);
  const exportBoard = async (targetThreadId: string) => {
    if (exportBusy) return false;
    setExportBusy(true);
    setNotice(null);
    try {
      const reference = await runPcbCommand(pcb.exportReference, {
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          designId: design.id,
          ...(targetThreadId
            ? { targetThreadId: targetThreadId as typeof threadRef.threadId }
            : {}),
        },
      });
      const store = useComposerDraftStore.getState();
      store.setPrompt(
        threadRef,
        appendSummary(
          store.getComposerDraft(threadRef)?.prompt ?? "",
          `Board reference for enclosure design:\n3D model: ${reference.path}\nMechanical metadata: ${reference.metadataPath}\nSource revision: ${reference.sourceHash}\nDestination thread: ${reference.targetThreadId}\nUse this board model as a reference for the enclosure, with space for connectors, fasteners and component clearance.`,
        ),
      );
      setNotice({ tone: "info", text: `Board reference saved to ${reference.path}` });
      setExportOpen(false);
      return true;
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Board export failed." });
      setExportOpen(false);
      return false;
    } finally {
      setExportBusy(false);
    }
  };
  const chooseView = (next: PcbView) => {
    setOutputs(null);
    setView(next);
    setThree(false);
    setPoints([]);
    remember(preferenceKey, { designId: design.id, view: next, layers });
  };
  const chooseLayers = (next: PcbLayerPreset) => {
    setLayers(next);
    setCustomLayers(null);
    remember(preferenceKey, { designId: design.id, view, layers: next });
  };
  const surfaces: Record<Surface, boolean> = {
    schematic: !!design.schematicPath,
    pcb: !!design.boardPath,
    "3d": !!design.boardPath && preview.canRender && executionAllowed,
  };
  const chooseSurface = (next: Surface) => {
    setOutputs(null);
    if (!surfaces[next]) return;
    if (next === "3d") {
      setThree(true);
      setLinked(false);
      setMode("select");
      setPoints([]);
    } else chooseView(next);
  };
  const failures =
    preview.render && preview.render.outcome !== "ok" && preview.render.outcome !== "cancelled"
      ? preview.render
      : null;
  const checkBadge = Object.values(preview.checks).reduce(
    (badge, result) =>
      result.sourceHash === preview.sourceHash
        ? {
            count: badge.count + result.counts.errors + result.counts.warnings,
            tone: result.counts.errors ? ("error" as const) : badge.tone,
          }
        : badge,
    { count: 0, tone: "warning" as "error" | "warning" },
  );
  const blocked =
    !design.schematicPath && !design.boardPath
      ? "no-drawing"
      : !design.toolAvailable
        ? "no-tool"
        : design.kind === "tscircuit" && !trusted
          ? "untrusted"
          : null;
  const stale =
    !!preview.display &&
    (!!failures || !!preview.error || !!preview.sheetError || !!preview.sheet?.tooLarge);
  const busy =
    preview.rendering || preview.loadingSheet || preview.watching || workbench.inspecting;
  const state = blocked
    ? "idle"
    : (failures || preview.error) && !preview.display
      ? "error"
      : stale
        ? "stale"
        : busy
          ? "busy"
          : "ready";
  const sheets = preview.good?.view === "schematic" ? preview.good.result.sheets : [];
  const sheetIndex = sheets.findIndex((s) => s.id === preview.selectedSheet);
  const surface: Surface = three ? "3d" : view;
  const toggleTools = () => openTab(tab ? null : lastTab.current);
  const cancelTool = () => {
    setMode("select");
    setPoints([]);
  };
  const statusCards = (
    <>
      {listingError && (
        <div className={styles.notice} data-tone="error" role="alert">
          <strong>Design search failed</strong>
          <p>{listingError}</p>
        </div>
      )}
      {listingBusy && <OperationStatus label="Refreshing design list" />}
      {!three && mode !== "select" && (
        <div className={styles.toolHint} role="status">
          <div>
            <strong>
              {mode === "annotate"
                ? "Place a note"
                : `${mode === "angle" ? "Angle" : "Distance"} · point ${points.length + 1} of ${mode === "angle" ? 3 : 2}`}
            </strong>
            <span>
              {mode === "annotate"
                ? "Write the note, then click where it belongs."
                : mode === "request"
                  ? "Drag an area to request a change, or click for a small area."
                  : mode === "angle"
                    ? "The middle point is the vertex. Alt skips pad snapping."
                    : "Click two points. Alt skips pad snapping."}
            </span>
          </div>
          {mode === "annotate" && (
            <input
              aria-label="Drawing note"
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  cancelTool();
                }
              }}
              placeholder="Describe the change or area"
            />
          )}
          <button className={styles.secondaryButton} onClick={cancelTool}>
            Cancel
          </button>
        </div>
      )}
      {!blocked && !preview.canRender && (
        <div className={styles.notice} data-tone="warning" role="alert">
          This connection needs permission to run terminal commands to build previews.
        </div>
      )}
      {preview.watchError && (
        <div className={styles.notice} data-tone="warning" role="alert">
          <p>{preview.watchError}</p>
          <button className={styles.secondaryButton} onClick={refreshPreview}>
            Rebuild now
          </button>
        </div>
      )}
      {!three && preview.rendering && (
        <OperationStatus
          key={preview.requestKey}
          label={
            viewing
              ? `Loading ${viewing.turn ? `turn ${viewing.turn}` : "the start"}...`
              : view === "schematic"
                ? "Building schematic"
                : "Building board"
          }
          detail={
            design.kind === "tscircuit"
              ? "Evaluating circuit code and routing the board."
              : "Exporting the saved design with KiCad."
          }
          onCancel={preview.cancelRender}
        />
      )}
      {!three && preview.watching && !preview.rendering && (
        <OperationStatus label="Preparing live preview" />
      )}
      {!three && preview.loadingSheet && !preview.rendering && (
        <OperationStatus label="Loading drawing" />
      )}
      {!three && preview.error && (
        <div className={styles.notice} data-tone="error" role="alert">
          <strong>{preview.display ? "Preview is out of date" : "Preview failed"}</strong>
          <p>{preview.error}</p>
          <button className={styles.secondaryButton} onClick={refreshPreview}>
            Retry
          </button>
        </div>
      )}
      {!three && failures && (
        <div className={styles.notice} data-tone="error" role="alert">
          <strong>
            {failures.outcome === "timed-out" ? "Preview timed out" : "Preview failed"}
            {failures.exitCode !== undefined ? ` (exit ${failures.exitCode})` : ""}
          </strong>
          {preview.display && <p>Showing the last good drawing.</p>}
          <details className={styles.disclosure} open={!preview.display}>
            <summary>Build log</summary>
            <pre>{failures.log || "The tool did not produce a preview."}</pre>
          </details>
          <button className={styles.secondaryButton} onClick={refreshPreview}>
            Retry
          </button>
        </div>
      )}
      {!three && preview.sheetError && (
        <div className={styles.notice} data-tone="error" role="alert">
          <p>{preview.sheetError}</p>
          <button className={styles.secondaryButton} onClick={refreshPreview}>
            Retry
          </button>
        </div>
      )}
      {!three && preview.sheet?.tooLarge && (
        <div className={styles.notice} data-tone="warning" role="alert">
          This sheet is too large to preview here ({(preview.sheet.bytes / 1024 / 1024).toFixed(1)}{" "}
          MiB). Open it in its editor.
        </div>
      )}
      {workbench.error && (
        <div className={styles.notice} data-tone="error" role="alert">
          {workbench.error}
        </div>
      )}
      {workbench.inspectionError && (
        <div className={styles.notice} data-tone="warning" role="alert">
          {workbench.inspectionError}
        </div>
      )}
      {(captureBusy || workbench.pending > 0) && (
        <OperationStatus label={captureBusy ? "Capturing" : "Saving PCB tools"} />
      )}
      {notice && (
        <div
          className={styles.notice}
          data-tone={notice.tone === "error" ? "error" : undefined}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          <div className={styles.noticeRow}>
            {notice.tone === "info" && <CheckIcon aria-hidden="true" />}
            <p>{notice.text}</p>
            {historyUndo && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  const undo = historyUndo;
                  setHistoryUndo(null);
                  void runPcbCommand(pcb.historyUndo, {
                    environmentId: threadRef.environmentId,
                    input: { threadId: threadRef.threadId, designId: design.id, undoId: undo.id },
                  })
                    .then(() => {
                      history.refresh();
                      setNotice({ tone: "info", text: "Restore undone." });
                    })
                    .catch((error) =>
                      setNotice({
                        tone: "error",
                        text: error instanceof Error ? error.message : "Undo failed.",
                      }),
                    );
                }}
              >
                Undo
              </Button>
            )}
            <ToolButton label="Dismiss" onClick={() => setNotice(null)}>
              <XIcon />
            </ToolButton>
          </div>
        </div>
      )}
    </>
  );
  const contextShelf = (
    <div className={`${styles.shelf} ${styles.shelfTopLeft}`}>
      {view === "schematic" ? (
        sheets.length > 1 ? (
          <Menu>
            <MenuTrigger render={<button className={styles.tool} aria-label="Schematic sheet" />}>
              <FileTextIcon />
              <span className={styles.shelfLabel}>
                {sheetIndex + 1}. {sheets[sheetIndex]?.label ?? "Sheet"}
              </span>
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuGroup>
                <MenuGroupLabel>Sheets</MenuGroupLabel>
                {sheets.map((s, i) => (
                  <MenuItem key={s.id} onClick={() => preview.selectSheet(s.id)}>
                    {s.id === preview.selectedSheet ? (
                      <CheckIcon />
                    ) : (
                      <span className="size-4" aria-hidden="true" />
                    )}
                    {i + 1}. {s.label}
                  </MenuItem>
                ))}
              </MenuGroup>
            </MenuPopup>
          </Menu>
        ) : (
          <span className={styles.shelfStatic}>
            <FileTextIcon aria-hidden="true" />
            {sheets[0]?.label ?? "Schematic"}
          </span>
        )
      ) : design.kind === "kicad" ? (
        <Menu>
          <MenuTrigger render={<button className={styles.tool} aria-label="Board layers" />}>
            <LayersIcon />
            <span className={styles.shelfLabel}>
              {customLayers && workbench.inspection ? customLayerLabel : PRESET_LABELS[layers]}
            </span>
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuGroup>
              <MenuGroupLabel>Copper</MenuGroupLabel>
              {(["front", "back", "all"] as const).map((preset) => (
                <MenuItem key={preset} onClick={() => chooseLayers(preset)}>
                  {(
                    customLayers
                      ? sameVisibility(
                          customLayers,
                          reconcileLayers(null, workbench.inspection?.layers ?? [], preset),
                        )
                      : layers === preset
                  ) ? (
                    <CheckIcon />
                  ) : (
                    <span className="size-4" aria-hidden="true" />
                  )}
                  {PRESET_LABELS[preset]}
                </MenuItem>
              ))}
            </MenuGroup>
            {workbench.inspection?.layers.length ? (
              <MenuGroup>
                <MenuGroupLabel>Presets</MenuGroupLabel>
                {PCB_LAYER_PRESETS.filter((preset) => !hiddenLayerPresets.includes(preset.id)).map(
                  (preset) => {
                    const resolved = resolveLayerPreset(preset, workbench.inspection!.layers);
                    return (
                      <MenuItem
                        key={preset.id}
                        disabled={!resolved}
                        aria-description={
                          resolved ? undefined : "This board has none of these layers"
                        }
                        onClick={() => resolved && setCustomLayers(resolved)}
                      >
                        {activeLayerSet?.kind === "built-in" && activeLayerSet.id === preset.id ? (
                          <CheckIcon />
                        ) : (
                          <span className="size-4" aria-hidden="true" />
                        )}
                        {preset.name}
                      </MenuItem>
                    );
                  },
                )}
              </MenuGroup>
            ) : null}
            <MenuSeparator />
            <MenuItem onClick={() => openTab("Layers")}>
              <LayersIcon />
              Layer controls…
            </MenuItem>
          </MenuPopup>
        </Menu>
      ) : (
        <span className={styles.shelfStatic}>
          <LayersIcon aria-hidden="true" />
          Top
        </span>
      )}
      {design.schematicPath && design.boardPath && (
        <>
          <span className={styles.divider} />
          <ToolButton
            label="Linked schematic and board"
            hint={linked ? "Close linked drawing" : "Show schematic and board side by side"}
            aria-pressed={linked}
            onClick={() => setLinked((v) => !v)}
          >
            <Columns2Icon />
          </ToolButton>
        </>
      )}
    </div>
  );
  const toolShelf = (
    <div
      className={`${styles.shelf} ${styles.toolShelf}`}
      role="toolbar"
      aria-label="Drawing tools"
    >
      {TOOLS.map(({ id, label, key, icon: Icon }) => (
        <ToolButton
          key={id}
          side="right"
          label={label}
          hint={`${label} (${key})`}
          aria-pressed={mode === id}
          disabled={id !== "select" && !canMark}
          onClick={() => chooseTool(mode === id ? "select" : id)}
        >
          <Icon />
        </ToolButton>
      ))}
    </div>
  );
  const primaryDrawing =
    viewing && !viewing.present ? (
      <CanvasState
        icon={<HistoryIcon />}
        title="Design not created yet"
      >{`${design.name} did not exist after turn ${viewing.turn}.`}</CanvasState>
    ) : preview.display ? (
      <SvgViewport
        key={`${preview.display.view}:${preview.display.layers}:${preview.display.sheetId}`}
        svg={preview.display.svg}
        label={preview.display.label}
        busy={preview.rendering || preview.loadingSheet}
        kind={preview.display.view}
        handle={viewport}
        extra={<ShortcutHelp />}
        onReady={() => {
          notifyDrawing();
          if (restoreView.current && preview.display?.sheetId === restoreView.current.sheet) {
            viewport.current?.restore(restoreView.current.camera);
            restoreView.current = null;
          } else if (
            pendingFocus.current &&
            preview.display?.view === pendingFocus.current.view &&
            (!pendingFocus.current.sheet || preview.display?.sheetId === pendingFocus.current.sheet)
          ) {
            viewport.current?.focus(pendingFocus.current.point);
            pendingFocus.current = null;
          }
        }}
        onBox={
          mode === "request" && canMark
            ? (box: PcbBounds) => beginRequest({ kind: "area", box })
            : undefined
        }
        onPick={
          !viewing &&
          drawingCurrent &&
          (mode === "select" || (workbench.canEdit && workbench.ready && workbench.pending === 0))
            ? pick
            : undefined
        }
        layered={preview.display.view === "pcb" && !!preview.display.result.sheets[0]?.layer}
        overlays={
          !viewing && (
            <>
              {changes.shown &&
                changes.pair &&
                changes.pair.after.sourceHash === preview.display.sourceHash && (
                  <ChangeHighlights
                    set={changes.set}
                    regions={changes.regions}
                    view={view}
                    sheet={preview.selectedSheet}
                    before={changes.pair.before.inspection}
                    after={changes.pair.after}
                  />
                )}
              <RequestPins
                requests={
                  pendingRequest
                    ? [...workbench.data.requests, pendingRequest]
                    : workbench.data.requests
                }
                inspection={workbench.inspection}
                view={view}
                sheet={preview.selectedSheet}
                only={captureOnly}
              />
              <DrawingOverlays
                data={workbench.data}
                sourceHash={preview.display.sourceHash}
                view={preview.display.view}
                sheet={preview.display.sheetId}
                selected={selected}
                net={net}
                components={
                  workbench.inspection?.sourceHash === preview.display.sourceHash
                    ? workbench.inspection.components
                    : []
                }
                pending={points}
                unit={unit}
              />
              {checkMarkers && preview.display.view === view && (
                <CheckMarkers
                  addedIds={markerReport?.delta?.added}
                  findings={drawingFindings}
                  activeId={visibleActiveFinding}
                  activePoints={activePoints}
                  stale={markersStale}
                  excludedIds={excludedFindingIds}
                />
              )}
            </>
          )
        }
      >
        {preview.display.view === "pcb" &&
          preview.display.result.sheets[0]?.layer &&
          preview.display.result.sheets.map((sheet) => (
            <LayerSheet
              key={sheet.id}
              threadRef={threadRef}
              renderKey={preview.display!.renderKey}
              sheetId={sheet.id}
              revision={preview.display!.requestKey}
              onSvg={changes.onSvg}
              opacity={
                customLayers?.find((l) => l.name === sheet.layer)?.visible
                  ? customLayers.find((l) => l.name === sheet.layer)!.opacity
                  : 0
              }
            />
          ))}
      </SvgViewport>
    ) : !preview.rendering && !preview.loadingSheet && !preview.watching ? (
      <CanvasState
        icon={<CircuitBoardIcon />}
        title={preview.cancelled ? "Preview cancelled" : "No preview yet"}
        actions={
          <Button size="sm" onClick={refreshPreview} disabled={!preview.canRender}>
            Build preview
          </Button>
        }
      >
        <p>Build a drawing of the saved design.</p>
      </CanvasState>
    ) : (
      <div className={styles.placeholder} aria-hidden="true">
        <CircuitBoardIcon />
      </div>
    );
  return (
    <div
      className={styles.workspace}
      // Opts the workspace out of chat type-to-focus so its single-key shortcuts work.
      data-loom-canvas
      tabIndex={-1}
      aria-label="PCB workspace"
      onKeyDown={(event) => {
        if (
          !event.defaultPrevented &&
          !event.metaKey &&
          !event.ctrlKey &&
          !(
            event.target instanceof HTMLElement &&
            event.target.closest(
              "input, textarea, select, [contenteditable=true], [role=menu], [role=dialog]",
            )
          ) &&
          (event.key === "[" || event.key === "]")
        ) {
          event.preventDefault();
          event.stopPropagation();
          void stepHistory(event.key === "[" ? -1 : 1).catch((error) =>
            setNotice({
              tone: "error",
              text: error instanceof Error ? error.message : "Could not load history.",
            }),
          );
          return;
        }
        if (
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
        const drawingTools = !three && !blocked && !viewing;
        if (key === "escape" && mode !== "select") cancelTool();
        else if (key === "escape" && activeFinding) {
          setActiveFinding(null);
          setFindingStatus("");
        } else if (
          key === "escape" &&
          three &&
          board3d.current?.isReady() &&
          board3d.current.state().tool3d !== "none"
        )
          board3d.current.chooseTool("none");
        else if (key === "escape" && tab) openTab(null);
        else if (key === "1" && surfaces.schematic) chooseSurface("schematic");
        else if (key === "2" && surfaces.pcb) chooseSurface("pcb");
        else if (key === "3" && surfaces["3d"]) chooseSurface("3d");
        else if (key === "i") toggleTools();
        else if (key === "t") toggleHistory();
        else if (key === "." && drawingTools) stepFindings(1);
        else if (key === "," && drawingTools) stepFindings(-1);
        else if (key === "c" && drawingTools) setCheckMarkers(!checkMarkers);
        else if (key === "v" && drawingTools) chooseTool("select");
        else if (key === "p" && three && board3d.current?.isReady())
          setDisplay3d((current) => ({
            ...current,
            projection: current.projection === "perspective" ? "orthographic" : "perspective",
          }));
        else if (key === "m" && three && !viewing && board3d.current?.isReady())
          board3d.current.chooseTool(
            board3d.current.state().tool3d === "none" ? "distance" : "none",
          );
        else if (key === "m" && drawingTools && canMark) chooseTool("distance");
        else if (key === "a" && drawingTools && canMark) chooseTool("angle");
        else if (key === "d" && drawingTools && changes.pair) changes.show(!changes.shown);
        else if (key === "r" && drawingTools && canMark) startRequest();
        else if (key === "n" && drawingTools && canMark) chooseTool("annotate");
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <header className={styles.docBar}>
        <DesignMenu design={design} listing={listing} onSelect={onSelect} onDiscover={onDiscover} />
        <div className={styles.docActions}>
          <ToolButton
            label="History"
            hint="History (T)"
            aria-pressed={historyOpen}
            onClick={toggleHistory}
          >
            <HistoryIcon />
          </ToolButton>
          {changes.chip && (
            <ChangesChip changes={changes} onComponent={selectComponent} onNet={selectNet} />
          )}
          {!blocked && (
            <SurfaceSwitch active={surface} available={surfaces} onChoose={chooseSurface} />
          )}
          <CaptureMenu
            three={three}
            disabled={!!viewing || !!blocked || (three ? false : !drawingCurrent)}
            busy={captureBusy}
            canCopy={canCopyImages()}
            scale={pngScale}
            onScale={setPngScale}
            onExport={(full, action) => void exportCapture(full, action)}
            onCapture={(full) => void capture(full)}
          />
          <WorkspaceMenu
            canRefresh={!blocked && preview.canRender}
            electronicsUrl={electronics}
            canExport={
              !viewing &&
              !!design.boardPath &&
              executionAllowed &&
              preview.canRender &&
              design.toolAvailable
            }
            canPrint={!viewing && !!design.boardPath && executionAllowed && printPermission}
            trusted={design.kind === "tscircuit" && trusted}
            onRefresh={refreshPreview}
            onExport={() => setExportOpen(true)}
            onPrint={() => setPrintOpen(true)}
            onFabrication={() => openTab("Fabrication")}
            onRevokeTrust={() => {
              trust(preferenceKey, false);
              setThree(false);
            }}
          />
        </div>
      </header>
      <div className={styles.body} data-tools={!!tab} data-expanded={!!tab && expanded}>
        <main className={styles.canvas} aria-label="Drawing">
          {blocked === "no-drawing" ? (
            <CanvasState
              icon={<CircuitBoardIcon />}
              title="No drawing files yet"
              actions={
                <Button variant="outline" size="sm" onClick={onDiscover}>
                  Find designs again
                </Button>
              }
            >
              <p>
                This KiCad project has no matching schematic or board. Add a drawing beside the
                project file, then find designs again.
              </p>
            </CanvasState>
          ) : blocked === "no-tool" ? (
            <CanvasState
              icon={<CircuitBoardIcon />}
              title={
                design.toolStatus.problem === "tool-too-old"
                  ? `KiCad ${design.toolStatus.version} is too old`
                  : design.kind === "kicad"
                    ? "KiCad is needed"
                    : "tscircuit is needed"
              }
              actions={
                <>
                  <Button
                    size="sm"
                    render={
                      <a
                        href={
                          design.kind === "kicad"
                            ? "https://www.kicad.org/download/"
                            : "https://docs.tscircuit.com/intro/installation"
                        }
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    Install instructions
                  </Button>
                  <Button variant="outline" size="sm" onClick={onDiscover}>
                    Check again
                  </Button>
                </>
              }
            >
              <p>
                {design.kind === "kicad"
                  ? "Install KiCad 9 or newer on the environment host to render this design."
                  : "Install tscircuit and Bun on the environment host, or add tscircuit to this project."}
              </p>
            </CanvasState>
          ) : blocked === "untrusted" ? (
            <CanvasState
              icon={<ShieldCheckIcon />}
              title="Render this project's circuit code?"
              actions={
                <>
                  <Button onClick={() => trust(preferenceKey, true)} disabled={!preview.canRender}>
                    Render
                  </Button>
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                </>
              }
            >
              <p>
                Previewing runs this project's TypeScript with tsci on the selected environment.
                Allow it only for a project you trust. Your choice is saved for this project on this
                device.
              </p>
            </CanvasState>
          ) : outputs ? (
            <GerberPreview
              threadRef={threadRef}
              design={design}
              output={outputs}
              onClose={() => setOutputs(null)}
            />
          ) : three ? (
            <Suspense fallback={<OperationStatus label="Opening 3D viewer" />}>
              <Board3D
                threadRef={threadRef}
                designId={design.id}
                checkpointId={viewing?.checkpointId}
                sourceHash={preview.sourceHash}
                handle={board3d}
                display={display3d}
                onDisplay={setDisplay3d}
                inspection={workbench.inspection}
                onSelect={selectComponent}
                readOnly={!!viewing}
                onCancel={() => setThree(false)}
                onBuilt={(hash) => {
                  if (hash === preview.sourceHash || !preview.sourceHash) refreshInspection();
                }}
              >
                {statusCards}
              </Board3D>
            </Suspense>
          ) : (
            <div className={styles.panes} data-linked={linked}>
              <div className={styles.pane}>
                {primaryDrawing}
                {contextShelf}
                {toolShelf}
              </div>
              {linked && !viewing && (
                <LinkedDrawing
                  captureOnly={captureOnly}
                  changes={changes}
                  threadRef={threadRef}
                  design={design}
                  view={view === "pcb" ? "schematic" : "pcb"}
                  trusted={trusted}
                  selected={selected}
                  net={net}
                  workbench={workbench}
                  handle={linkedViewport}
                />
              )}
            </div>
          )}
          {!three && !outputs && <div className={styles.overlayStack}>{statusCards}</div>}
        </main>
        {tab && (
          <InspectorFrame
            tab={tab}
            expanded={expanded}
            onExpand={() => setExpanded((v) => !v)}
            onClose={() => openTab(null)}
          >
            {viewing &&
            [
              "Inspect",
              "Checks",
              "Simulate",
              "Parameters",
              "Fabrication",
              "Requests",
              "Library",
            ].includes(tab) ? (
              <p className="p-4 text-sm">These tools work on the current version.</p>
            ) : tab === "Fabrication" ? (
              <FabricationTab
                threadRef={threadRef}
                design={design}
                sourceHash={preview.sourceHash}
                executionAllowed={executionAllowed}
                onPreview={(value) => {
                  setThree(false);
                  setOutputs(value);
                  setMode("select");
                }}
              />
            ) : tab === "Checks" ? (
              <ChecksSection
                boardStats={workbench.inspection?.stats}
                fabResult={preview.fabCheck}
                fabCatalog={preview.fabCatalog}
                fabId={preview.fabId}
                onFabId={preview.setFabId}
                fabLoading={preview.fabLoading}
                fabError={preview.fabError}
                onFabRefresh={preview.refreshFab}
                onFabLocate={(point) => focusPoint("pcb", point)}
                review={preview.review}
                reviewLoading={preview.reviewLoading}
                reviewError={preview.reviewError}
                onReviewRefresh={preview.refreshReview}
                onReviewLocate={(surface, point, sheet) => focusPoint(surface, point, sheet)}
                threadRef={threadRef}
                design={design}
                activity={preview.activity}
                results={preview.checks}
                jobRevision={preview.checkRevision}
                sourceHash={preview.sourceHash}
                drawingSourceHash={preview.display?.sourceHash}
                showExcluded={showExcluded}
                onShowExcluded={setShowExcluded}
                activeId={activeFinding}
                onActivate={activateViolation}
                markers={checkMarkers}
                onMarkers={setCheckMarkers}
                findingStatus={findingStatus}
                orderedFindings={surfaceFindings}
                canCheck={preview.canCheck}
                checking={
                  preview.checking ??
                  (preview.activity?.running?.kind === "review"
                    ? null
                    : preview.activity?.running?.kind) ??
                  null
                }
                error={preview.checkError ?? preview.checksError}
                loading={preview.checksLoading}
                onRun={preview.runCheck}
                canCancel={preview.checking !== null}
                onCancel={preview.cancelCheck}
                onLocate={(kind, point, sheet) =>
                  focusPoint(kind === "drc" ? "pcb" : "schematic", point, sheet)
                }
              />
            ) : (
              <ToolPanel
                compareInitial={compareInitial}
                key={tab}
                tab={tab}
                requestPanel={
                  <RequestsTab
                    data={workbench.data}
                    ready={workbench.ready}
                    sourceHash={preview.sourceHash}
                    canSave={
                      workbench.canRequest &&
                      workbench.ready &&
                      workbench.pending === 0 &&
                      !captureBusy
                    }
                    executionAllowed={executionAllowed}
                    threadRef={threadRef}
                    designId={design.id}
                    onOperation={workbench.changeRequest}
                    onDraft={addRequestsToDraft}
                    onFocus={focusRequest}
                    onCapture={captureRequest}
                    form={
                      requestForm ? (
                        <RequestForm
                          key={requestForm.id}
                          anchor={describeAnchor(requestForm.anchor)}
                          initialText={requestForm.initialText}
                          canSave={canMark && workbench.canRequest}
                          onSave={saveRequest}
                          onCancel={() => setRequestForm(null)}
                        />
                      ) : undefined
                    }
                  />
                }
                onConvertNote={(id) => {
                  const n = workbench.data.annotations.find((n) => n.id === id);
                  if (n)
                    beginRequest(
                      {
                        kind: "area",
                        box: { x: n.point.x - 1, y: n.point.y - 1, width: 2, height: 2 },
                      },
                      n.view,
                      n.sheet,
                      n.text,
                      n.id,
                    );
                }}
                threadRef={threadRef}
                design={design}
                inspection={workbench.inspection}
                executionAllowed={executionAllowed}
                canMeasure={canMeasureHeights}
                measureDisabledReason={measureDisabledReason}
                measuring={measuringHeights}
                onMeasure={measureHeights}
                onOpenChecks={tabs.includes("Checks") ? () => openTab("Checks") : undefined}
                onDraft={draftBoardStats}
                canSave={
                  !viewing && workbench.ready && workbench.canEdit && workbench.pending === 0
                }
                canSaveView={!viewing && !three && drawingCurrent}
                canMark={canMark && !blocked}
                data={workbench.data}
                view={view}
                sourceHash={preview.sourceHash}
                layers={customLayers ?? []}
                onPreset={chooseLayers}
                onTool={(next) => {
                  setThree(false);
                  setExpanded(false);
                  chooseTool(next);
                }}
                selected={selected}
                net={net}
                onPinMap={setPinMapFor}
                onSelect={selectComponent}
                onPin={(reference, pin) => {
                  try {
                    selectPin(reference, pin);
                  } catch {
                    selectComponent(reference);
                  }
                }}
                onNet={selectNet}
                onLayers={setCustomLayers}
                onShowBoard={() => chooseView("pcb")}
                onFocusMark={(target, sheet, point) => focusPoint(target, point, sheet)}
                mutate={workbench.mutate}
                onSaveView={async (name) => {
                  if (!drawingCurrent || !viewport.current?.isReady())
                    throw new Error("Wait for the current drawing before saving a view.");
                  const camera = viewport.current.snapshot();
                  await workbench.mutate((d) => ({
                    ...d,
                    views: [
                      ...d.views,
                      {
                        id: randomUUID(),
                        name,
                        view,
                        sheet: preview.selectedSheet,
                        camera,
                        layers: customLayers ?? [],
                        sourceHash: preview.sourceHash ?? "unknown",
                      },
                    ],
                  }));
                }}
                onLoadView={(id) => {
                  const saved = workbench.data.views.find((v) => v.id === id);
                  if (!saved) return;
                  if (!(saved.view === "pcb" ? design.boardPath : design.schematicPath)) {
                    setNotice({
                      tone: "error",
                      text: "The saved drawing is unavailable for this design.",
                    });
                    return;
                  }
                  chooseView(saved.view);
                  setCustomLayers(reconcileSaved(saved.layers, workbench.inspection?.layers ?? []));
                  preview.selectSheet(saved.sheet);
                  restoreView.current = { sheet: saved.sheet, camera: saved.camera };
                  if (preview.display?.sheetId === saved.sheet)
                    viewport.current?.restore(saved.camera);
                }}
              />
            )}
          </InspectorFrame>
        )}
        <InspectorRail
          tabs={tabs}
          active={tab}
          executionAllowed={executionAllowed}
          badges={{
            Checks: checkBadge,
            Requests: {
              count: workbench.data.requests.filter((r) => r.status === "review").length,
              tone: "warning",
            },
          }}
          onTab={openTab}
        />
      </div>
      {historyOpen && (
        <HistoryStrip
          chips={history.chips}
          viewing={viewing?.checkpointId ?? null}
          hasEarlier={!!history.pages.at(-1)?.nextCursor}
          loading={history.status === "loading"}
          error={history.error}
          unavailable={history.unavailable}
          canRestore={canRestore}
          onEarlier={history.loadEarlier}
          onView={showHistoryVersion}
          onCompare={compareVersion}
          onRestore={() => setRestoreTarget(viewing)}
          onClose={closeHistory}
        />
      )}
      {restoreTarget && (
        <RestoreDesignDialog
          threadRef={threadRef}
          designId={design.id}
          version={restoreTarget}
          contentKey={history.current?.contentKey ?? null}
          threadRunning={history.threadRunning}
          onClose={() => setRestoreTarget(null)}
          onConflict={history.refresh}
          onRestored={(result) => {
            const label = `Restored ${design.name} from ${restoreTarget.turn ? `turn ${restoreTarget.turn}` : "the start"}.`;
            setHistoryUndo(result.undoId ? { id: result.undoId, label } : null);
            setRestoreTarget(null);
            showHistoryVersion("now");
            history.refresh();
            setNotice({ tone: "info", text: label, persistent: true });
          }}
        />
      )}
      <footer className={styles.statusBar}>
        {viewing && (
          <>
            <span>{viewingLabel(viewing.turn, history.latestTurn)}</span>
            <button className={styles.statusChip} onClick={() => showHistoryVersion("now")}>
              Back to current
            </button>
          </>
        )}
        <span className={styles.state} data-state={state}>
          <span className={styles.stateDot} aria-hidden="true" />
          {state === "error"
            ? "Error"
            : state === "stale"
              ? "Out of date"
              : state === "busy"
                ? "Updating"
                : state === "idle"
                  ? "Idle"
                  : "Ready"}
        </span>
        <span className={styles.statusItem}>
          {three
            ? "3D board"
            : view === "schematic"
              ? sheets.length > 1
                ? `Sheet ${sheetIndex + 1} of ${sheets.length}`
                : "Schematic"
              : design.kind !== "kicad"
                ? "Board"
                : customLayers && workbench.inspection
                  ? customLayerLabel
                  : PRESET_LABELS[layers]}
        </span>
        {selected && (
          <button className={styles.statusChip} onClick={() => openTab("Inspect")}>
            {selected}
            {net ? ` · ${net}` : ""}
          </button>
        )}
        {!selected && net && (
          <button className={styles.statusChip} onClick={() => openTab("Inspect")}>
            {net}
          </button>
        )}
        <span className={styles.spacer} />
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                className={styles.statusChip}
                aria-label={`Display units: ${unitName(unit)}`}
              />
            }
          >
            {unit}
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuGroupLabel>Display units</MenuGroupLabel>
              {(["mm", "mil", "in"] as const).map((value) => (
                <MenuItem key={value} onClick={() => setLengthUnit(value)}>
                  {value === unit ? <CheckIcon /> : <span className="size-4" aria-hidden="true" />}
                  {unitName(value)} ({value})
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
        {preview.review && (
          <ToolButton
            label="Review findings"
            hint="Deterministic schematic review heuristics"
            className={styles.statusChip}
            data-tone={
              preview.review.sourceHash !== preview.sourceHash
                ? "stale"
                : preview.review.outcome === "clean"
                  ? "ok"
                  : "warning"
            }
            onClick={() => {
              setActiveFinding(preview.review?.findings[0]?.id ?? "review:status");
              openTab("Checks");
            }}
          >
            Review{" "}
            {preview.review.outcome === "clean"
              ? "clean"
              : preview.review.counts.errors +
                preview.review.counts.warnings +
                preview.review.counts.info}
          </ToolButton>
        )}
        {tabs.includes("Checks") &&
          (["erc", "drc"] as const).map((kind) => {
            const result = preview.checks[kind];
            const running = preview.activity?.running?.kind === kind;
            const paused = preview.activity?.paused.some((p) => p.kind === kind);
            if (!result && !running && !paused) return null;
            const issues = result ? result?.counts.errors + result.counts.warnings : 0;
            return (
              <ToolButton
                key={kind}
                label={`${kind.toUpperCase()} findings`}
                hint={
                  running
                    ? `${kind.toUpperCase()} is checking saved files.`
                    : paused
                      ? `Automatic ${kind.toUpperCase()} is paused. Open Checks for details.`
                      : `${kind.toUpperCase()}: ${issues} findings${result?.delta ? `, ${result.delta.newCount} new, ${result.delta.resolvedCount} resolved` : ""}. Ran ${result?.ranAt ?? ""}.`
                }
                className={styles.statusChip}
                data-tone={
                  result?.sourceHash !== preview.sourceHash
                    ? "stale"
                    : result?.counts.errors
                      ? "error"
                      : issues
                        ? "warning"
                        : "ok"
                }
                onClick={() => openTab("Checks")}
              >
                {kind.toUpperCase()}
                {running
                  ? ": checking"
                  : paused
                    ? ": paused"
                    : result?.delta &&
                        result.sourceHash === preview.sourceHash &&
                        (result.delta.newCount || result.delta.resolvedCount)
                      ? `: ${[result.delta.newCount ? `${result.delta.newCount} new` : "", result.delta.resolvedCount ? `${result.delta.resolvedCount} resolved` : ""].filter(Boolean).join(", ")}`
                      : ` ${result?.outcome === "clean" ? "clean" : issues || "!"}`}
              </ToolButton>
            );
          })}
        <span className={styles.statusItem}>
          {design.kind === "kicad" ? "KiCad" : "tscircuit"} {design.toolStatus.version ?? ""}
        </span>
        <span className={styles.statusItem} data-optional>
          {preview.cancelled ? "Paused" : preview.watchError ? "Manual refresh" : "Live"}
        </span>
      </footer>
      {pinMapFor && (
        <PinMapDialog
          key={pinMapFor}
          threadRef={threadRef}
          designId={design.id}
          reference={pinMapFor}
          inspection={workbench.inspection}
          onClose={() => setPinMapFor(null)}
        />
      )}
      <TrueScalePrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        threadRef={threadRef}
        design={design}
        inspection={workbench.inspection}
        currentSourceHash={preview.sourceHash}
        trusted={trusted}
        canPrint={!!design.boardPath && executionAllowed && printPermission}
      />
      <ExportDialog
        open={exportOpen}
        busy={exportBusy}
        onOpenChange={setExportOpen}
        onExport={exportBoard}
      />
    </div>
  );
}
function LinkedDrawing({
  threadRef,
  design,
  view,
  trusted,
  selected,
  net,
  workbench,
  handle,
  changes,
  captureOnly,
}: {
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  view: PcbView;
  trusted: boolean;
  selected: string | null;
  net: string | null;
  workbench: ReturnType<typeof usePcbWorkbench>;
  handle: React.RefObject<PcbViewportHandle | null>;
  changes: ReturnType<typeof useChangeHighlights>;
  captureOnly: readonly string[] | null;
}) {
  const unit = useLengthUnit();
  const preview = usePcbPreview(
    threadRef,
    design,
    view,
    "front",
    trusted,
    view === "pcb" && design.kind === "kicad"
      ? workbench.inspection?.layers.filter((l) =>
          ["F.Cu", "F.Silkscreen", "Edge.Cuts"].includes(l),
        )
      : undefined,
  );
  const component = workbench.inspection?.components.find((c) => c.reference === selected);
  const { display, selectedSheet, selectSheet } = preview;
  useEffect(() => {
    const p = view === "pcb" ? component?.pcb : component?.schematic;
    if (view === "schematic" && p?.sheet) selectSheet(p.sheet);
    if (p && display?.sheetId === selectedSheet) handle.current?.focus(p);
  }, [component, view, display?.sheetId, selectedSheet, selectSheet, handle]);
  return (
    <div className={styles.pane}>
      {preview.display && (
        <SvgViewport
          svg={preview.display.svg}
          label={`Linked ${view}`}
          kind={view}
          handle={handle}
          layered={view === "pcb" && design.kind === "kicad"}
          onReady={() => {
            const p = view === "pcb" ? component?.pcb : component?.schematic;
            if (p) handle.current?.focus(p);
          }}
          overlays={
            <>
              {changes.shown &&
                changes.pair &&
                changes.pair.after.sourceHash === preview.display.sourceHash && (
                  <ChangeHighlights
                    set={changes.set}
                    regions={[]}
                    view={view}
                    sheet={preview.selectedSheet}
                    before={changes.pair.before.inspection}
                    after={changes.pair.after}
                  />
                )}
              <RequestPins
                requests={workbench.data.requests}
                inspection={workbench.inspection}
                view={view}
                sheet={preview.selectedSheet}
                only={captureOnly}
              />
              <DrawingOverlays
                data={workbench.data}
                sourceHash={preview.display.sourceHash}
                view={view}
                sheet={preview.selectedSheet}
                selected={selected}
                net={net}
                components={workbench.inspection?.components ?? []}
                pending={[]}
                unit={unit}
              />
            </>
          }
        >
          {view === "pcb" &&
            design.kind === "kicad" &&
            preview.display.result.sheets.map((s) => (
              <LayerSheet
                key={s.id}
                threadRef={threadRef}
                renderKey={preview.display!.renderKey}
                sheetId={s.id}
                revision={preview.display!.requestKey}
                opacity={1}
              />
            ))}
        </SvgViewport>
      )}
      <span className={styles.paneLabel}>
        {view === "pcb" ? (
          <CircuitBoardIcon aria-hidden="true" />
        ) : (
          <FileTextIcon aria-hidden="true" />
        )}
        Linked {view === "pcb" ? "board" : "schematic"}
      </span>
      <div className={styles.paneStatus}>
        {preview.rendering && (
          <OperationStatus label={`Building linked ${view === "pcb" ? "board" : "schematic"}`} />
        )}
        {preview.error && (
          <div className={styles.notice} data-tone="error" role="alert">
            {preview.error}
          </div>
        )}
      </div>
    </div>
  );
}
function VisiblePanel({
  threadRef,
  onClose,
  initialDesign,
}: {
  threadRef: ScopedThreadRef;
  onClose: () => void;
  initialDesign?: string | undefined;
}) {
  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  };
  const result = useAtomValue(pcb.designs(target)),
    listing = asyncValue(result);
  const [choice, setChoice] = useState<string | null>(initialDesign ?? null);
  const preferences = usePcbPreferences((s) => s.selections);
  const remember = usePcbPreferences((s) => s.select);
  const key = listing ? projectPreferenceKey(threadRef.environmentId, listing.projectId) : "";
  const chosen =
    listing?.designs.find((d) => d.id === (choice ?? preferences[key]?.designId)) ??
    listing?.designs[0];
  const discover = () => {
    appAtomRegistry.refresh(pcb.status({ environmentId: threadRef.environmentId, input: {} }));
    appAtomRegistry.refresh(pcb.designs(target));
  };
  if (!listing)
    return (
      <div className={styles.root}>
        {result.waiting || result._tag === "Initial" ? (
          <CanvasState icon={<FolderSearchIcon />} title="Looking for boards">
            <p>Searching this thread's workspace for KiCad and tscircuit designs.</p>
          </CanvasState>
        ) : (
          <CanvasState
            icon={<FolderSearchIcon />}
            title="Design search failed"
            actions={
              <Button variant="outline" size="sm" onClick={discover}>
                Try again
              </Button>
            }
          >
            <p role="alert">{asyncError(result)}</p>
          </CanvasState>
        )}
      </div>
    );
  if (!chosen)
    return (
      <div className={styles.root}>
        <CanvasState
          icon={<CircuitBoardIcon />}
          title="No board designs yet"
          actions={
            <Button variant="outline" size="sm" onClick={discover}>
              Find designs again
            </Button>
          }
        >
          <p>
            Add a .kicad_pro, .kicad_sch, .kicad_pcb or *.circuit.tsx file, or ask the agent to
            create one.
          </p>
        </CanvasState>
      </div>
    );
  return (
    <div className={styles.root}>
      <DesignWorkspace
        key={`${listing.workspaceKey}:${chosen.id}`}
        threadRef={threadRef}
        design={chosen}
        listing={listing}
        listingBusy={result.waiting}
        listingError={asyncError(result) ?? null}
        preferenceKey={key}
        onClose={onClose}
        onDiscover={discover}
        onSelect={(id) => {
          setChoice(id);
          const d = listing.designs.find((d) => d.id === id);
          if (d)
            remember(key, {
              designId: id,
              view: initialView(d, preferences[key]?.view),
              layers: d.kind === "tscircuit" ? "front" : (preferences[key]?.layers ?? "front"),
            });
        }}
      />
    </div>
  );
}
export default function PcbPreviewPanel({ threadRef, visible, surface }: ForkPanelProps) {
  const configs = useServerConfigs();
  if (
    !loomFeaturesOf(configs.get(threadRef.environmentId)?.environment.capabilities).includes(
      "pcb-preview",
    )
  )
    return (
      <p className="p-4 text-sm text-muted-foreground">Needs a Loom server with PCB preview.</p>
    );
  return visible ? (
    <VisiblePanel
      key={`${threadRef.environmentId}:${threadRef.threadId}:${surface.resourceId ?? ""}`}
      threadRef={threadRef}
      initialDesign={surface.resourceId}
      onClose={() => useRightPanelStore.getState().closeSurface(threadRef, surface.id)}
    />
  ) : null;
}
