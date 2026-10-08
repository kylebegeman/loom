import type { PcbEditorEvent } from "@t3tools/contracts/fork";
import { randomUUID } from "~/lib/utils";
import { useState, useRef, useEffect, useEffectEvent, lazy, Suspense } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  CheckIcon,
  ChevronDownIcon,
  CircuitBoardIcon,
  Columns2Icon,
  FileTextIcon,
  FolderSearchIcon,
  LayersIcon,
  MousePointer2Icon,
  RulerIcon,
  ShieldCheckIcon,
  StickyNoteIcon,
  TriangleRightIcon,
  XIcon,
} from "lucide-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  PcbDesign,
  PcbListDesignsResult,
  PcbView,
  PcbLayerPreset,
  PcbLayerState,
  PcbPoint,
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
import { usePcbPreferences, projectPreferenceKey } from "./preferences";
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
} from "./WorkspaceChrome";
import { usePcbWorkbench } from "./usePcbWorkbench";
import { LayerSheet } from "./LayerSheet";
import { DrawingOverlays } from "./Overlays";
import { snapPoint } from "./geometry";
import { attachModelImage, captureBase64 } from "../model-preview-3d/capture";
import { useComposerDraftStore } from "~/composerDraftStore";
import { appendSummary, checkSummary } from "./summary";
import type { Pcb3dHandle } from "./Board3D";
import type { PcbViewportHandle } from "./SvgViewport";
const Board3D = lazy(() => import("./Board3D").then((m) => ({ default: m.Board3D })));
import { SvgViewport } from "./SvgViewport";
import { ChecksView } from "./ChecksView";
import { OperationStatus } from "./OperationStatus";
import styles from "./workspace.module.css";

type Tool = "select" | "distance" | "angle" | "annotate";
const TOOLS = [
  { id: "select", label: "Select", key: "V", icon: MousePointer2Icon },
  { id: "distance", label: "Distance", key: "M", icon: RulerIcon },
  { id: "angle", label: "Angle", key: "A", icon: TriangleRightIcon },
  { id: "annotate", label: "Note", key: "N", icon: StickyNoteIcon },
] as const;
const PRESET_LABELS: Record<PcbLayerPreset, string> = {
  front: "Front copper",
  back: "Back copper",
  all: "All copper",
};
type Notice = { tone: "info" | "error"; text: string };

function DesignWorkspace({
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
  const saved = usePcbPreferences((s) => s.selections[preferenceKey]);
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
    [linked, setLinked] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [net, setNet] = useState<string | null>(null),
    [mode, setMode] = useState<Tool>("select"),
    [points, setPoints] = useState<readonly PcbPoint[]>([]),
    [note, setNote] = useState(""),
    [notice, setNotice] = useState<Notice | null>(null),
    [captureBusy, setCaptureBusy] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [exportBusy, setExportBusy] = useState(false);
  const lastTab = useRef<InspectorTab>("Inspect");
  const board3d = useRef<Pcb3dHandle | null>(null);
  const viewport = useRef<PcbViewportHandle | null>(null),
    linkedViewport = useRef<PcbViewportHandle | null>(null),
    restoreView = useRef<{ sheet: string; camera: { x: number; y: number; scale: number } } | null>(
      null,
    );
  useEffect(() => {
    if (notice?.tone !== "info") return;
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
  const preview = usePcbPreview(threadRef, design, view, layers, trusted, layerNames, !three);
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
  if (workbench.inspection && design.kind === "kicad") {
    const reconciled = reconcileLayers(customLayers, workbench.inspection.layers, layers);
    if (reconciled !== customLayers) setCustomLayers(reconciled);
  }
  const drawingCurrent =
    !!preview.display &&
    preview.display.view === view &&
    preview.display.sheetId === preview.selectedSheet &&
    (!preview.sourceHash || preview.display.sourceHash === preview.sourceHash) &&
    !preview.rendering &&
    !preview.loadingSheet;
  const canMark = workbench.canEdit && workbench.ready;
  const pendingFocus = useRef<PcbPoint | null>(null);
  const focusPoint = (target: PcbView, point: PcbPoint, sheet?: string) => {
    setThree(false);
    setView(target);
    if (target === view && (!sheet || sheet === preview.selectedSheet))
      viewport.current?.focus(point);
    else {
      pendingFocus.current = point;
      if (sheet && target === "schematic") {
        const candidate = preview.good?.result.sheets.find(
          (s) => s.id === sheet || s.label === sheet,
        );
        if (candidate) preview.selectSheet(candidate.id);
      }
    }
  };
  const selectComponent = (reference: string | null) => {
    setSelected(reference);
    setNet(null);
    if (!reference) return;
    const c = workbench.inspection?.components.find((c) => c.reference === reference),
      p = view === "pcb" ? c?.pcb : c?.schematic;
    if (p) {
      if (view === "schematic" && p.sheet && p.sheet !== preview.selectedSheet) {
        pendingFocus.current = p;
        preview.selectSheet(p.sheet);
      } else viewport.current?.focus(p);
    }
    const other = view === "pcb" ? c?.schematic : c?.pcb;
    if (other) linkedViewport.current?.focus(other);
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
        pendingFocus.current = point;
        preview.selectSheet(point.sheet);
      } else viewport.current?.focus(point);
    }
    const other = view === "pcb" ? pin.schematic : pin.pcb;
    if (other) linkedViewport.current?.focus(other);
  };
  const chooseTool = (next: Tool) => {
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
      const drawing = () => {
        if (!viewport.current?.isReady() || !preview.display || three)
          throw new Error("Open a loaded 2D drawing for this action.");
        return viewport.current;
      };
      const model = () => {
        if (!board3d.current || !three) throw new Error("Open a loaded 3D board for this action.");
        return board3d.current;
      };
      switch (c.action) {
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
          if (!c.point) throw new Error("Provide a point to focus.");
          drawing().focus(c.point);
          break;
        case "snapshot":
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
          setNet(c.net ?? null);
          break;
        case "layers":
          if (c.layers?.some((l) => !workbench.inspection?.layers.includes(l.name)))
            throw new Error("Unknown layer.");
          if (c.layers) setCustomLayers(c.layers);
          break;
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
          if (TOOLS.some((t) => t.id === c.name)) {
            chooseTool(c.name as Tool);
            if (c.text !== undefined) setNote(c.text);
          } else throw new Error("Choose select, distance, angle or annotate.");
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
          setCustomLayers(saved.layers);
          preview.selectSheet(saved.sheet);
          restoreView.current = { sheet: saved.sheet, camera: saved.camera };
          viewport.current?.restore(saved.camera);
          break;
        }
        case "capture": {
          const blob = three ? await model().capture() : await drawing().capture(c.full ?? false);
          if (c.attachToDraft)
            await attachModelImage(blob, threadRef, `${design.name}-${three ? "3d" : view}.png`);
          png = await captureBase64(blob);
          break;
        }
      }
      return {
        png,
        state:
          c.action === "snapshot"
            ? {
                view,
                sheet: preview.selectedSheet,
                three,
                linked,
                selected,
                net,
                camera: three && board3d.current?.isReady() ? model().snapshot() : null,
                drawingCamera: !three && viewport.current ? viewport.current.snapshot() : null,
                layers: customLayers ?? [],
                sourceHash: preview.sourceHash ?? "",
                tool: mode,
                dock: tab,
                loading:
                  preview.rendering ||
                  !!preview.checking ||
                  captureBusy ||
                  workbench.pending > 0 ||
                  (three && (!board3d.current || board3d.current.isLoading())),
              }
            : undefined,
      };
    };
    void execute()
      .then(({ png, state }) =>
        runPcbCommand(pcb.completeEditorAction, {
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            designId: design.id,
            requestId: request.requestId,
            message: "Editor action completed.",
            ...(state ? { state } : {}),
            ...(png ? { png } : {}),
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
          label={view === "schematic" ? "Building schematic" : "Building board"}
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
              {customLayers && workbench.inspection
                ? `${customLayers.filter((l) => l.visible).length} layers`
                : PRESET_LABELS[layers]}
            </span>
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuGroup>
              <MenuGroupLabel>Copper</MenuGroupLabel>
              {(["front", "back", "all"] as const).map((preset) => (
                <MenuItem key={preset} onClick={() => chooseLayers(preset)}>
                  {layers === preset ? (
                    <CheckIcon />
                  ) : (
                    <span className="size-4" aria-hidden="true" />
                  )}
                  {PRESET_LABELS[preset]}
                </MenuItem>
              ))}
            </MenuGroup>
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
  const primaryDrawing = preview.display ? (
    <SvgViewport
      key={`${preview.display.view}:${preview.display.layers}:${preview.display.sheetId}`}
      svg={preview.display.svg}
      label={preview.display.label}
      busy={preview.rendering || preview.loadingSheet}
      kind={preview.display.view}
      handle={viewport}
      extra={<ShortcutHelp />}
      onReady={() => {
        if (restoreView.current && preview.display?.sheetId === restoreView.current.sheet) {
          viewport.current?.restore(restoreView.current.camera);
          restoreView.current = null;
        } else if (pendingFocus.current) {
          viewport.current?.focus(pendingFocus.current);
          pendingFocus.current = null;
        }
      }}
      onPick={
        drawingCurrent &&
        (mode === "select" || (workbench.canEdit && workbench.ready && workbench.pending === 0))
          ? pick
          : undefined
      }
      layered={preview.display.view === "pcb" && !!preview.display.result.sheets[0]?.layer}
      overlays={
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
        />
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
        const drawingTools = !three && !blocked;
        if (key === "escape" && mode !== "select") cancelTool();
        else if (key === "escape" && tab) openTab(null);
        else if (key === "1" && surfaces.schematic) chooseSurface("schematic");
        else if (key === "2" && surfaces.pcb) chooseSurface("pcb");
        else if (key === "3" && surfaces["3d"]) chooseSurface("3d");
        else if (key === "i") toggleTools();
        else if (key === "v" && drawingTools) chooseTool("select");
        else if (key === "m" && drawingTools && canMark) chooseTool("distance");
        else if (key === "a" && drawingTools && canMark) chooseTool("angle");
        else if (key === "n" && drawingTools && canMark) chooseTool("annotate");
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <header className={styles.docBar}>
        <DesignMenu design={design} listing={listing} onSelect={onSelect} onDiscover={onDiscover} />
        <div className={styles.docActions}>
          {!blocked && (
            <SurfaceSwitch active={surface} available={surfaces} onChoose={chooseSurface} />
          )}
          <CaptureMenu
            three={three}
            disabled={!!blocked || (three ? false : !drawingCurrent)}
            busy={captureBusy}
            onCapture={(full) => void capture(full)}
          />
          <WorkspaceMenu
            canRefresh={!blocked && preview.canRender}
            electronicsUrl={electronics}
            canExport={
              !!design.boardPath && executionAllowed && preview.canRender && design.toolAvailable
            }
            trusted={design.kind === "tscircuit" && trusted}
            onRefresh={refreshPreview}
            onExport={() => setExportOpen(true)}
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
          ) : three ? (
            <Suspense fallback={<OperationStatus label="Opening 3D viewer" />}>
              <Board3D
                threadRef={threadRef}
                designId={design.id}
                sourceHash={preview.sourceHash}
                handle={board3d}
                onCancel={() => setThree(false)}
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
              {linked && (
                <LinkedDrawing
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
          {!three && <div className={styles.overlayStack}>{statusCards}</div>}
        </main>
        {tab && (
          <InspectorFrame
            tab={tab}
            expanded={expanded}
            onExpand={() => setExpanded((v) => !v)}
            onClose={() => openTab(null)}
          >
            {tab === "Checks" ? (
              <ChecksView
                threadRef={threadRef}
                design={design}
                results={preview.checks}
                jobRevision={preview.checkRevision}
                sourceHash={preview.sourceHash}
                canCheck={preview.canCheck}
                checking={preview.checking}
                error={preview.checkError ?? preview.checksError}
                loading={preview.checksLoading}
                onRun={preview.runCheck}
                onCancel={preview.cancelCheck}
                onLocate={(kind, point, sheet) =>
                  focusPoint(kind === "drc" ? "pcb" : "schematic", point, sheet)
                }
              />
            ) : (
              <ToolPanel
                key={tab}
                tab={tab}
                threadRef={threadRef}
                design={design}
                inspection={workbench.inspection}
                executionAllowed={executionAllowed}
                canSave={workbench.ready && workbench.canEdit && workbench.pending === 0}
                canSaveView={!three && drawingCurrent}
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
                onSelect={selectComponent}
                onPin={(reference, pin) => {
                  try {
                    selectPin(reference, pin);
                  } catch {
                    selectComponent(reference);
                  }
                }}
                onNet={setNet}
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
                  setCustomLayers(saved.layers);
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
          badges={{ Checks: checkBadge }}
          onTab={openTab}
        />
      </div>
      <footer className={styles.statusBar}>
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
              : design.kind === "kicad"
                ? PRESET_LABELS[layers]
                : "Board"}
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
        {tabs.includes("Checks") &&
          (["erc", "drc"] as const).map((kind) => {
            const result = preview.checks[kind];
            if (!result) return null;
            const issues = result.counts.errors + result.counts.warnings;
            return (
              <button
                key={kind}
                className={styles.statusChip}
                data-tone={
                  result.sourceHash !== preview.sourceHash
                    ? "stale"
                    : result.counts.errors
                      ? "error"
                      : issues
                        ? "warning"
                        : "ok"
                }
                onClick={() => openTab("Checks")}
              >
                {kind.toUpperCase()} {result.outcome === "clean" ? "clean" : issues || "!"}
              </button>
            );
          })}
        <span className={styles.statusItem}>
          {design.kind === "kicad" ? "KiCad" : "tscircuit"} {design.toolStatus.version ?? ""}
        </span>
        <span className={styles.statusItem} data-optional>
          {preview.cancelled ? "Paused" : preview.watchError ? "Manual refresh" : "Live"}
        </span>
      </footer>
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
}: {
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  view: PcbView;
  trusted: boolean;
  selected: string | null;
  net: string | null;
  workbench: ReturnType<typeof usePcbWorkbench>;
  handle: React.RefObject<PcbViewportHandle | null>;
}) {
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
            <DrawingOverlays
              data={workbench.data}
              sourceHash={preview.display.sourceHash}
              view={view}
              sheet={preview.selectedSheet}
              selected={selected}
              net={net}
              components={workbench.inspection?.components ?? []}
              pending={[]}
            />
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
