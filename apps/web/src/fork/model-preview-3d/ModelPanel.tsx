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
  useRef,
  useState,
} from "react";
import { Link } from "@tanstack/react-router";
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
  type ModelEntry,
  type ModelPreviewSettings,
  type ModelSavedView,
  type ModelSection,
  type ScadRenderResult,
} from "@t3tools/contracts/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
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
import { resolveBuildVolume, fitsBuildVolume } from "./buildPlate";
import { changedParameters } from "./params";
import { captureNamedViews, thumbnail } from "./viewer/captureSheet";
import { attachModelImage, captureToComposer, captureBase64 } from "./capture";
import { type ModelViewer, type NavigationMode } from "./viewer/createViewer";
import type { View } from "./viewer/views";
import type { meshStats } from "./viewer/load";
import { onModelAction } from "./actions";
import {
  CaptureMenu,
  DisplayTools,
  ModelTool,
  NavigationTools,
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
  const file = useMemo(() => ({ threadId: threadRef.threadId, path }), [threadRef.threadId, path]);
  const format = (
    /\.(stp|step)$/i.test(path) ? "step" : path.split(".").at(-1)?.toLowerCase()
  ) as ModelEntry["format"];
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
    [captureError, setCaptureError] = useState<string | null>(null),
    [release, setRelease] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(format === "scad"),
    [inspectorExpanded, setInspectorExpanded] = useState(false),
    [inspectorTab, setInspectorTab] = useState<InspectorTab>(
      defaultInspectorTab(format === "scad"),
    ),
    [activeView, setActiveView] = useState<View | null>("iso"),
    [activeViewId, setActiveViewId] = useState<string | null>(null),
    [navigationMode, setNavigationMode] = useState<NavigationMode>("orbit"),
    [display, setDisplay] = useState({ wireframe: false, grid: true, axes: false });
  const [variantActivity, setVariantActivity] = useState<OperationProgress | null>(null);
  const [session, setSession] = useState<ScadSession | null>(null);
  const [geometryRevision, setGeometryRevision] = useState("");
  const editing = useModelEditing(threadRef, path, viewer, geometryRevision, session);
  const perform = editing.perform;
  const { copyToClipboard } = useCopyToClipboard();
  const recall = (camera: ModelCamera, refit: boolean) => {
    setDisplay({ wireframe: camera.wireframe, grid: camera.gridVisible, axes: camera.axesVisible });
    setNavigationMode(camera.navigationMode);
    editing.setSection(camera.section);
    viewer.current?.restore(camera);
    if (refit) viewer.current?.refit();
    setActiveView(null);
    setActiveViewId(null);
  };
  const recallView = (view: ModelSavedView) => {
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
  const openTab = (tab: InspectorTab) => {
    setInspectorTab(tab);
    setInspectorOpen(true);
  };
  const showLog = () => openTab("part");
  useEffect(() => {
    if (!success) return;
    const timeout = setTimeout(() => setSuccess(null), 5000);
    return () => clearTimeout(timeout);
  }, [success]);
  const resolving = format !== "scad" && resolvedKey !== JSON.stringify([revision, allowLarge]);
  const loadingFile = pending || refreshing || resolving || progress !== null;
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
          if (!viewer.current || !stats || loadingFile)
            throw new Error("Wait for the 3D model to load.");
          return viewer.current;
        };
        let png: string | undefined;
        switch (c.action) {
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
            setDisplay((d) => ({
              ...d,
              ...(c.wireframe === undefined ? {} : { wireframe: c.wireframe }),
              ...(c.grid === undefined ? {} : { grid: c.grid }),
              ...(c.axes === undefined ? {} : { axes: c.axes }),
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
          case "tool":
            if (!["select", "measure", "annotate"].includes(c.name ?? ""))
              throw new Error("Choose select, measure or annotate.");
            get();
            editing.choose(c.name === "select" ? null : (c.name as "measure" | "annotate"));
            break;
          case "inspector": {
            if (c.enabled === false) {
              setInspectorOpen(false);
              break;
            }
            const tab = resolveInspectorTab(c.name, format === "scad");
            if (!tab)
              throw new Error(
                `Choose one of these inspector tabs: ${(format === "scad" ? ["customize", "variants"] : []).concat("markup", "views", "part").join(", ")}.`,
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
              throw new Error("Open a SCAD model and provide customizer values.");
            session.promote(c.values, c.name ?? "Agent preview");
            break;
          }
          case "parameter-history": {
            if (!session) throw new Error("Open a SCAD model first.");
            const index =
              c.index ??
              session.historyCursor + (c.name === "undo" ? -1 : c.name === "redo" ? 1 : 0);
            if (index < 0 || index >= session.historyLabels.length)
              throw new Error("No parameter history at that position.");
            session.moveHistory(index);
            break;
          }
          case "parameter-set": {
            if (!session) throw new Error("Open a SCAD model first.");
            const name = c.name || null;
            if (name && !session.data.sets.includes(name))
              throw new Error("Unknown parameter set.");
            session.chooseSet(name);
            break;
          }
          case "parameter-preview":
            if (!session) throw new Error("Open a SCAD model first.");
            if (c.enabled !== undefined) session.setAutomatic(c.enabled);
            else session.apply();
            break;
          case "cancel-tool":
            editing.cancel();
            break;
          case "allow-large":
            setAllowLarge(c.enabled ?? true);
            break;
          case "pick":
            get();
            if (!editing.canEdit || !editing.ready || !c.points)
              throw new Error("Provide model points and wait for editable workspace data.");
            if (!(await editing.onPick([...c.points])))
              throw new Error("Choose a picking tool first, or check the workspace save error.");
            break;
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
          message: "3D editor action completed.",
          ...(png ? { png } : {}),
          ...(c.action === "snapshot"
            ? {
                ...(viewer.current && stats && !progress
                  ? { camera: viewer.current.snapshot() }
                  : {}),
                sourceRevision: geometryRevision,
                state: {
                  inspector: inspectorOpen ? inspectorTab : null,
                  tool: editing.picking,
                  pendingPoint: editing.pendingPoint,
                  pendingRegion: editing.pendingRegion,
                  loading: loadingFile || (!stats && !error),
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
  const volume = useMemo(() => resolveBuildVolume(settings.buildPlate), [settings.buildPlate]);
  const watched = useAtomValue(
    models.watch({ environmentId: threadRef.environmentId, input: file }),
  );
  // Printer, agent and Fabrication settings do not change the mesh, so they skip the reload.
  const loadKey = JSON.stringify([
    settings.openscadPath,
    settings.backend,
    settings.renderTimeoutSeconds,
    settings.renderColors,
    settings.maxFileMegabytes,
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
    const timeout = setTimeout(() => setRelease(true), 60000);
    return () => clearTimeout(timeout);
  }, [visible]);
  const onMesh = useCallback((url: string, meshFormat: "stl" | "3mf", meshRevision: string) => {
    setMesh({ url, format: meshFormat, revision: meshRevision });
    setError(null);
  }, []);
  const onError = useCallback((message: string) => setError(message), []);
  const onStats = useCallback(
    (value: ReturnType<typeof meshStats>) => {
      setStats(value);
      setGeometryRevision(mesh?.revision ?? "");
      setError(null);
    },
    [mesh?.revision],
  );
  const onPending = useCallback((value: boolean) => {
    setPending(value);
  }, []);
  const onResult = useCallback((value: ScadRenderResult) => {
    setRender(value);
    if (value.status === "error")
      setError(value.log.find((line) => line.level === "error")?.text ?? "Render failed.");
  }, []);
  useEffect(() => {
    if (format === "scad" || format === "step") return;
    let active = true;
    void runModelCommand(models.fileUrl, {
      environmentId: threadRef.environmentId,
      input: { ...file, allowLarge },
    })
      .then((signed) => {
        if (active) {
          setMesh({
            url: modelUrl(threadRef.environmentId, signed.relativeUrl),
            format,
            revision: signed.revision,
          });
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
  }, [file, threadRef.environmentId, format, revision, allowLarge]);
  const busy = loadingFile || (!stats && !error && !watchError);
  const captureBusy = capturing || editing.operation !== null;
  const editDisabled = !editing.canEdit || !stats || busy || captureBusy;
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
    const section = editing.section;
    if (section.enabled) editing.setSection({ ...section, enabled: false });
    else if (stats)
      editing.setSection({ ...section, enabled: true, offset: centred(section.axis) });
  };
  const startTool = (tool: PickTool) => {
    if (editing.picking === tool) editing.stopPicking();
    else {
      editing.choose(tool);
      openTab("markup");
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
  };
  const capture = useCallback(
    async (four: boolean) => {
      if (!viewer.current || !stats || busy) {
        setCaptureError("Wait for the model preview to finish loading before capturing it.");
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
          setCaptureError(failureMessage(cause));
        } finally {
          setCapturing(false);
        }
      });
    },
    [threadRef, path, perform, stats, busy],
  );
  useEffect(() => {
    if (!visible) return;
    return onModelAction(threadRef, (action) => {
      if (action === "rerender") setRevision((value) => value + 1);
      else void capture(action === "capture-four");
    });
  }, [visible, threadRef, capture]);
  const displayedError =
    watchError ??
    error ??
    (render?.status === "error"
      ? (render.log.find((line) => line.level === "error")?.text ?? "Render failed.")
      : null);
  const picker = () =>
    useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface("model-preview-3d"));
  if (format === "step")
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
          <p>STEP files are not previewed here. STEP import is planned in the Fabrication app.</p>
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
  const oversized = stats && !fitsBuildVolume(stats.size, volume);
  const unapplied =
    session && !session.automatic && session.hasUnapplied
      ? changedParameters(session.data.parameters, session.values, session.applied).length
      : 0;
  const openRequests = openRequestCount(editing.data.annotations, geometryRevision);
  const badges: Partial<Record<InspectorTab, InspectorBadge>> = {};
  if (unapplied) badges.customize = { tone: "warning", count: unapplied };
  if (openRequests) badges.markup = { tone: "primary", count: openRequests };
  if (oversized || issues) badges.part = { tone: "warning", count: null };
  const hint =
    editing.picking === "measure"
      ? editing.pendingPoint
        ? "Click the second point"
        : "Click the first point to measure from"
      : editing.picking === "annotate"
        ? "Click the part you want changed"
        : null;
  return (
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
        if (key === "escape" && (editing.picking || editing.pendingRegion)) {
          if (editing.picking) editing.stopPicking();
          else editing.cancel();
        } else if (key === "m" && !editDisabled) startTool("measure");
        else if (key === "n" && !editDisabled) startTool("annotate");
        else if (key === "s" && !editDisabled) toggleSection();
        else if (["1", "2", "3", "4"].includes(key) && stats)
          setView((["iso", "front", "top", "right"] as const)[Number(key) - 1]!);
        else if (key === "f" && stats) fit();
        else if (key === "h") setNavigationMode("pan");
        else if (key === "o") setNavigationMode("orbit");
        else if (key === "i") setInspectorOpen((value) => !value);
        else if (key === "w") setDisplay((value) => ({ ...value, wireframe: !value.wireframe }));
        else if (key === "g") setDisplay((value) => ({ ...value, grid: !value.grid }));
        else if (key === "a") setDisplay((value) => ({ ...value, axes: !value.axes }));
        else if ((key === "+" || key === "=") && stats) viewer.current?.zoom(1 / 1.2);
        else if (key === "-" && stats) viewer.current?.zoom(1.2);
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className={styles["model-document-bar"]}>
        {format === "scad" ? (
          <FileCode2Icon className="size-5 shrink-0 text-muted-foreground" />
        ) : (
          <BoxIcon className="size-5 shrink-0 text-muted-foreground" />
        )}
        <div className={styles["model-document-name"]}>
          <strong>{path.split("/").at(-1)}</strong>
          <small>
            {path.includes("/")
              ? path.slice(0, path.lastIndexOf("/"))
              : format === "scad"
                ? "OpenSCAD source"
                : `${format.toUpperCase()} model`}
          </small>
        </div>
        <div className={styles["model-document-actions"]}>
          <CaptureMenu
            disabled={editDisabled}
            capturing={captureBusy}
            sheets={editing.data.presets}
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
              {mesh && (visible || !release) && (
                <ViewerCanvas
                  url={mesh.url}
                  format={mesh.format}
                  volume={volume}
                  visible={visible}
                  viewerRef={viewer}
                  savedViewRef={savedView}
                  onStats={onStats}
                  onError={onError}
                  onProgress={setProgress}
                  navigationMode={navigationMode}
                  display={display}
                  onNavigate={onNavigate}
                  section={editing.section}
                  measurements={editing.measurements}
                  annotations={editing.annotations}
                  pendingPoint={editing.pendingPoint}
                  pickMode={busy ? null : editing.picking}
                  onPick={editing.onPick}
                />
              )}
            </Suspense>
          </div>
          {!mesh && !displayedError && (
            <div className={styles["model-loading"]}>
              <BoxIcon />
              <p>{pending ? "Preparing your part..." : "Loading model..."}</p>
            </div>
          )}
          <ViewTools
            active={activeView}
            savedViews={editing.data.views}
            activeViewId={activeViewId}
            onView={setView}
            onSavedView={recallView}
            onSaveView={saveView}
            disabled={!stats}
          />
          <ToolRail
            tool={editing.picking}
            section={editing.section.enabled}
            disabled={editDisabled}
            onTool={startTool}
            onSection={toggleSection}
          />
          {editing.section.enabled && stats && (
            <SectionStrip
              section={editing.section}
              bounds={sectionBounds(editing.section.axis)}
              onChange={changeSection}
              onRemove={toggleSection}
            />
          )}
          {hint && <ToolHint onDone={editing.stopPicking}>{hint}</ToolHint>}
          <DisplayTools
            {...display}
            onWireframe={(wireframe) => setDisplay((value) => ({ ...value, wireframe }))}
            onGrid={(grid) => setDisplay((value) => ({ ...value, grid }))}
            onAxes={(axes) => setDisplay((value) => ({ ...value, axes }))}
          />
          <NavigationTools
            mode={navigationMode}
            onMode={setNavigationMode}
            onFit={fit}
            onZoom={(factor) => viewer.current?.zoom(factor)}
            disabled={!stats}
          />
          <div className={styles["model-status-overlay"]}>
            {displayedError && (
              <div className={styles["model-notice"]} role="alert" data-tone="error">
                <strong className="font-medium">
                  {stats ? "Preview is out of date" : "Unable to preview this model"}
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
                    onClick={() => setRevision((value) => value + 1)}
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
                  <strong className="font-medium">Capture could not be attached</strong>
                  <ModelTool label="Dismiss capture error" onClick={() => setCaptureError(null)}>
                    <XIcon />
                  </ModelTool>
                </div>
                <p>{captureError}</p>
              </div>
            )}
            {busy && (
              <OperationStatus
                label={
                  refreshing
                    ? "Refreshing model parameters"
                    : pending
                      ? "Rendering with OpenSCAD"
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
              <div className={styles["model-floating"] + " w-fit gap-2 pl-3 text-xs"} role="status">
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
            scad={format === "scad"}
            badges={badges}
            expanded={inspectorExpanded}
            onExpand={() => setInspectorExpanded((value) => !value)}
          />
          <div className={styles["model-inspector-content"]}>
            {format === "scad" && (
              <div
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
                  onError={onError}
                />
              </div>
            )}
            {format === "scad" && (
              <fieldset
                role="tabpanel"
                aria-labelledby="model-tab-variants"
                disabled={!editing.canEdit}
                className={styles["model-inspector-tab-panel"]}
                hidden={inspectorTab !== "variants"}
              >
                <VariantsInspector
                  data={editing.data}
                  mutate={editing.mutate}
                  session={session}
                  threadRef={threadRef}
                  path={path}
                  volume={volume}
                  onActivity={setVariantActivity}
                />
              </fieldset>
            )}
            <fieldset
              role="tabpanel"
              aria-labelledby="model-tab-markup"
              disabled={!editing.canEdit}
              className={styles["model-inspector-tab-panel"]}
              hidden={inspectorTab !== "markup"}
            >
              <MarkupSection
                data={editing.data}
                mutate={editing.mutate}
                sourceRevision={geometryRevision}
                picking={editing.picking}
                pendingRegion={editing.pendingRegion}
                relink={editing.relink}
                busy={editing.operation !== null}
                disabled={editDisabled}
                actions={markupActions}
              />
            </fieldset>
            <fieldset
              role="tabpanel"
              aria-labelledby="model-tab-views"
              disabled={!editing.canEdit}
              className={styles["model-inspector-tab-panel"]}
              hidden={inspectorTab !== "views"}
            >
              <ViewsSection
                data={editing.data}
                mutate={editing.mutate}
                sourceRevision={geometryRevision}
                visible={visible && inspectorOpen && inspectorTab === "views"}
                activeViewId={activeViewId}
                disabled={editDisabled}
                onSave={saveView}
                onRecall={recallView}
                onUpdate={updateView}
                onCapture={editing.captureViews}
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
                stats={stats}
                settings={settings}
                volume={volume}
                render={render}
                format={format}
                path={path}
              />
            </div>
          </div>
        </aside>
      </div>
      <div className={styles["model-status-bar"]}>
        <span>
          {stats
            ? `${stats.size.map((value) => value.toFixed(1)).join(" × ")} mm`
            : "Dimensions in millimetres"}
        </span>
        {stats && (
          <span className={styles["model-triangle-count"]}>
            {stats.triangles.toLocaleString()} triangles
          </span>
        )}
        {oversized && (
          <button className={styles["model-status-warning"]} onClick={() => openTab("part")}>
            <TriangleAlertIcon />
            Larger than the build plate
          </button>
        )}
        <span
          className={styles["model-render-state"]}
          data-busy={busy}
          data-error={!!displayedError}
        >
          <span className={styles["model-state-dot"]} />
          {displayedError ? (stats ? "Stale" : "Error") : busy ? "Updating" : "Ready"}
        </span>
      </div>
    </div>
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
