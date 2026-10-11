import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  resolvePartPath,
  bedFitSummary,
  type ModelEditorEvent,
  type ModelCamera,
  type ModelProjection,
  type ModelPoint,
  type ModelSection,
  type AssemblyPart,
  type AssemblyPairResult,
  type ModelPreviewSettings,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useRightPanelStore } from "~/rightPanelStore";
import { AssemblyCanvas, type AssemblyPartStats } from "./AssemblyCanvas";
import { AssemblyInspector } from "./AssemblyInspector";
import { useAssembly, assemblySourceRevision } from "./useAssembly";
import { useAssemblyWorkspace, type AssemblyInspectorTab } from "./AssemblyWorkspace";
import { OperationStatus } from "./OperationStatus";
import { models, runModelCommand } from "./state";
import { forkPanelSurface } from "../panels/registry";
import { modelSurface } from "./agentModels";
import { resolvePlate } from "./buildPlate";
import {
  CaptureMenu,
  DisplayTools,
  NavigationTools,
  SectionStrip,
  ToolRail,
  ToolHint,
  ViewTools,
} from "./WorkspaceTools";
import { DisplayUnitsProvider, useDisplayUnitsSetting } from "./units";
import { BedPicker, useScaleReference } from "./BedPicker";
import { usePrinterLibrary } from "./printers";
import { attachModelImage, captureToComposer, captureBase64 } from "./capture";
import {
  canCopyImages,
  captureFileName,
  copyImage,
  saveImage,
  type ExportAction,
} from "./captureExport";
import { captureNamedViews } from "./viewer/captureSheet";
import { onModelAction } from "./actions";
import { nudgeFor } from "./viewer/keyboard";
import type { View } from "./viewer/views";
import type { SectionCapState } from "./viewer/sectionCaps";
import type { ModelViewer, NavigationMode } from "./viewer/createViewer";
import styles from "./workspace.module.css";
const idleEditor = Atom.make(AsyncResult.initial<typeof ModelEditorEvent.Type, never>());
const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
function AssemblyWatch({
  threadRef,
  path,
  onChange,
}: {
  threadRef: ScopedThreadRef;
  path: string;
  onChange: (path: string) => void;
}) {
  const result = useAtomValue(
      models.watch({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, path },
      }),
    ),
    event = result._tag === "Success" ? result.value : null,
    previous = useRef<{ revision: string | null } | null>(null);
  useEffect(() => {
    if (!event) return;
    if (
      previous.current &&
      (event.revision !== previous.current.revision || event.dependencyChanged)
    )
      onChange(path);
    previous.current = { revision: event.revision };
  }, [event, path, onChange]);
  return null;
}
export default function AssemblyPanel({
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
  const assembly = useAssembly(threadRef, path, visible),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [isolatedId, setIsolatedId] = useState<string | null>(null),
    [explode, setExplode] = useState(0),
    [preview, setPreview] = useState<AssemblyPart | null>(null),
    [errors, setErrors] = useState<Readonly<Record<string, string>>>({}),
    [partStats, setPartStats] = useState<AssemblyPartStats>({}),
    [viewerError, setViewerError] = useState<string | null>(null),
    [adding, setAdding] = useState(false),
    [search, setSearch] = useState(""),
    [navigationMode, setNavigationMode] = useState<NavigationMode>("orbit"),
    [size, setSize] = useState<readonly [number, number, number] | undefined>(undefined),
    [focusedPair, setFocusedPair] = useState<AssemblyPairResult | null>(null),
    [sourceEpochs, setSourceEpochs] = useState<Readonly<Record<string, number>>>({}),
    [allowLarge, setAllowLarge] = useState(false),
    [inspectorOpen, setInspectorOpen] = useState(true),
    [activeView, setActiveView] = useState<View | null>("iso"),
    [sectionCaps, setSectionCaps] = useState<SectionCapState>("none"),
    [bounds, setBounds] = useState<{ min: ModelPoint; max: ModelPoint } | null>(null),
    [partRevisions, setPartRevisions] = useState<Readonly<Record<string, string>>>({}),
    [display, setDisplay] = useState({
      wireframe: false,
      overhangs: false,
      grid: true,
      axes: false,
      projection: "perspective" as ModelProjection,
    });
  const latestSettings = useRef(settings);
  useLayoutEffect(() => {
    latestSettings.current = settings;
  }, [settings]);
  const readSettings = useCallback(() => latestSettings.current, []);
  const unitsControl = useDisplayUnitsSetting(threadRef.environmentId, settings, readSettings);
  const referenceControl = useScaleReference(threadRef.environmentId, settings, readSettings);
  const library = usePrinterLibrary(threadRef.environmentId);
  const plate = useMemo(
    () => resolvePlate(settings.buildPlate, library),
    [settings.buildPlate, library],
  );
  const updateSize = useCallback(
    (next: readonly [number, number, number]) =>
      setSize((previous) =>
        previous?.every((value, index) => value === next[index]) ? previous : next,
      ),
    [],
  );
  const selectPart = useCallback((id: string | null) => {
    setPreview(null);
    setSelectedId(id);
    setFocusedPair(null);
  }, []);
  const viewerRef = useRef<ModelViewer | null>(null),
    watchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshot = assembly.snapshot;
  const geometryRevision = useMemo(
    () => assemblySourceRevision(snapshot, sourceEpochs, partRevisions),
    [snapshot, sourceEpochs, partRevisions],
  );
  const loading =
    !!snapshot?.parts.some((part) => !part.error && !partStats[part.id]) ||
    Object.values(partStats).some((part) => part.loading);
  const recallDisplay = useCallback((camera: ModelCamera) => {
    setDisplay({
      wireframe: camera.wireframe,
      overhangs: camera.overhangs,
      grid: camera.gridVisible,
      axes: camera.axesVisible,
      projection: camera.projection,
    });
    setNavigationMode(camera.navigationMode);
    setActiveView(null);
  }, []);
  const workspace = useAssemblyWorkspace({
    threadRef,
    path,
    viewerRef,
    revision: geometryRevision,
    explode,
    snapshot,
    loading,
    onRecall: recallDisplay,
  });
  const { editing, setActiveViewId } = workspace;
  const { setSection } = editing;
  const updateBounds = useCallback((next: { min: ModelPoint; max: ModelPoint }) => {
    setBounds((previous) =>
      previous &&
      previous.min.every((value, i) => value === next.min[i]) &&
      previous.max.every((value, i) => value === next.max[i])
        ? previous
        : next,
    );
  }, []);
  const updatePartRevisions = useCallback((next: Readonly<Record<string, string>>) => {
    setPartRevisions((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
  }, []);
  const onNavigate = useCallback(() => {
    setActiveView(null);
    setActiveViewId(null);
  }, [setActiveViewId]);
  const onCamera = useCallback((camera: ModelCamera) => setSection(camera.section), [setSection]);
  const sectionBounds = (axis: ModelSection["axis"]) => ({
    min: bounds?.min[AXIS_INDEX[axis]] ?? 0,
    max: bounds?.max[AXIS_INDEX[axis]] ?? 100,
  });
  const changeSection = (section: ModelSection) => {
    const range = sectionBounds(section.axis);
    editing.setSection(
      section.axis === editing.section.axis
        ? section
        : { ...section, offset: (range.min + range.max) / 2 },
    );
  };
  const toggleSection = () => {
    if (workspace.disabled) return;
    const section = editing.section,
      range = sectionBounds(section.axis);
    editing.setSection({
      ...section,
      enabled: !section.enabled,
      ...(!section.enabled ? { offset: (range.min + range.max) / 2 } : {}),
    });
  };
  const setView = (view: View) => {
    viewerRef.current?.setView(view);
    setActiveView(view);
    workspace.setActiveViewId(null);
  };
  const capture = async (four: boolean, action?: ExportAction) => {
    if (!viewerRef.current || !size || loading || editing.operation) return;
    await editing.perform("Capturing assembly image", async () => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      if (!action) await captureToComposer(viewer, threadRef, path, four);
      else if (action === "copy") await copyImage(viewer.capture(four));
      else
        saveImage(
          await viewer.capture(four),
          captureFileName(path, four ? "four-views" : (activeView ?? "view"), new Date()),
        );
    });
  };
  const listingResult = useAtomValue(
      models.models({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      }),
    ),
    listing = Option.getOrNull(AsyncResult.value(listingResult));
  const { refresh: reload, canUndo, busy, revert, invalidate } = assembly;
  const refresh = useCallback(
    (changedPath: string) => {
      if (changedPath !== path) {
        setSourceEpochs((previous) => ({
          ...previous,
          [changedPath]: (previous[changedPath] ?? 0) + 1,
        }));
        invalidate();
      }
      if (watchTimer.current) clearTimeout(watchTimer.current);
      watchTimer.current = setTimeout(() => {
        watchTimer.current = null;
        void reload();
      }, 100);
    },
    [reload, path, invalidate],
  );
  useEffect(
    () => () => {
      if (watchTimer.current) clearTimeout(watchTimer.current);
    },
    [],
  );
  const focusEnclosure = useCallback(
    (finding: import("@t3tools/contracts/fork").EnclosureFinding) => {
      setExplode(0);
      setIsolatedId(null);
      setSelectedId(assembly.snapshot?.assembly.enclosure?.board ?? null);
      const p = finding.point;
      viewerRef.current?.frameBounds(
        p.map((v) => v - 5) as [number, number, number],
        p.map((v) => v + 5) as [number, number, number],
      );
    },
    [assembly.snapshot],
  );
  useEffect(() => {
    const findings =
      !explode && !assembly.stale ? (assembly.report?.enclosure?.findings ?? []) : [];
    viewerRef.current?.setFindings(
      findings
        .filter((f) => f.status !== "ok")
        .map((f) => ({
          id: f.id,
          message: `${f.label}: ${f.detail}`,
          severity:
            f.status === "interferes"
              ? ("fail" as const)
              : f.status === "tight"
                ? ("warn" as const)
                : ("info" as const),
          location: { point: f.point, normal: null, radiusMm: 5 },
        })),
      null,
      (pin) => {
        const finding = findings.find((f) => f.id === pin.id);
        if (finding) focusEnclosure(finding);
      },
    );
  }, [assembly.report, assembly.stale, explode, focusEnclosure]);
  const focusPair = useCallback((pair: AssemblyPairResult) => {
    setExplode(0);
    setIsolatedId(null);
    setSelectedId(pair.a);
    setFocusedPair(pair);
    const region = pair.regions[0];
    if (region)
      viewerRef.current?.frameBounds(
        region.point.map((value) => value - region.radiusMm) as [number, number, number],
        region.point.map((value) => value + region.radiusMm) as [number, number, number],
      );
    else viewerRef.current?.fit();
  }, []);
  useEffect(() => {
    viewerRef.current?.setAssemblyPins(
      !explode && !assembly.stale ? (focusedPair?.regions ?? []) : [],
      !explode && !assembly.stale ? (focusedPair?.closest ?? null) : null,
      explode ? [] : editing.measurements,
      explode ? [] : editing.annotations,
      explode ? null : editing.pendingPoint,
    );
  }, [
    focusedPair,
    explode,
    assembly.stale,
    editing.measurements,
    editing.annotations,
    editing.pendingPoint,
  ]);
  const editorEvents = useAtomValue(
    visible
      ? models.editorEvents({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, path },
        })
      : idleEditor,
  );
  const editorRequest = editorEvents._tag === "Success" ? editorEvents.value : null;
  const handledEditor = useRef<string | null>(null);
  const handleEditorRequest = useEffectEvent((request: typeof ModelEditorEvent.Type | null) => {
    if (!request || handledEditor.current === request.requestId) return;
    handledEditor.current = request.requestId;
    const execute = async () => {
      const command = request.command;
      const get = () => {
        if (!viewerRef.current || !size || loading)
          throw new Error("Wait for the assembly preview to load.");
        return viewerRef.current;
      };
      const workspaceResult = await workspace.handleEditorAction(command);
      let png: string | undefined;
      if (workspaceResult === null)
        switch (command.action) {
          case "fit":
            get().fit();
            setActiveView("iso");
            break;
          case "zoom":
            get().zoom(command.factor ?? 1);
            break;
          case "view":
            if (!["iso", "front", "top", "right"].includes(command.name ?? ""))
              throw new Error("Choose iso, front, top or right.");
            get();
            setView(command.name as View);
            break;
          case "camera":
            if (!command.camera) throw new Error("Provide a camera.");
            get().restore(command.camera);
            recallDisplay(command.camera);
            editing.setSection(command.camera.section);
            break;
          case "display":
            get();
            if (command.reference !== undefined) await referenceControl.save(command.reference);
            setDisplay((value) => ({
              ...value,
              ...(command.wireframe === undefined ? {} : { wireframe: command.wireframe }),
              ...(command.overhangs === undefined ? {} : { overhangs: command.overhangs }),
              ...(command.grid === undefined ? {} : { grid: command.grid }),
              ...(command.axes === undefined ? {} : { axes: command.axes }),
              ...(command.projection === undefined ? {} : { projection: command.projection }),
            }));
            break;
          case "navigation":
            if (command.name !== "orbit" && command.name !== "pan")
              throw new Error("Choose orbit or pan.");
            get();
            setNavigationMode(command.name);
            break;
          case "section":
            if (!command.section) throw new Error("Provide a section.");
            get();
            editing.setSection(command.section);
            break;
          case "inspector":
            setInspectorOpen(command.enabled ?? true);
            if (command.name) {
              if (!["parts", "fit", "markup", "views"].includes(command.name))
                throw new Error("Choose parts, fit, markup or views.");
              workspace.setInspectorTab(command.name as AssemblyInspectorTab);
            }
            break;
          case "refresh":
            await assembly.refresh();
            break;
          case "allow-large":
            setAllowLarge(command.enabled ?? true);
            break;
          case "explode":
            get();
            setExplode(command.enabled === false ? 0 : (command.factor ?? 1));
            break;
          case "isolate":
          case "select-part": {
            const part = snapshot?.assembly.parts.find(
              (part) => part.id === command.name || part.name === command.name,
            );
            const id = command.enabled === false || !command.name ? null : part?.id;
            if (id === undefined) throw new Error("Unknown assembly part.");
            if (command.action === "isolate") setIsolatedId(id);
            else selectPart(id);
            break;
          }
          case "capture": {
            let image: Promise<Blob>;
            const viewer = get();
            if (command.name) {
              const preset = editing.data.presets.find(
                (item) => item.id === command.name || item.name === command.name,
              );
              if (!preset) throw new Error("Unknown capture preset.");
              if (explode) throw new Error("Collapse the assembly before capturing saved views.");
              const views = preset.viewIds.flatMap((id) =>
                editing.data.views.filter((view) => view.id === id),
              );
              if (views.length !== preset.viewIds.length)
                throw new Error("A capture preset references a missing view.");
              viewer.setOverlays(
                preset.includeMeasurements ? editing.measurements : [],
                editing.annotations,
                null,
              );
              try {
                image = captureNamedViews(viewer, views, path, geometryRevision);
              } finally {
                viewer.setOverlays(editing.measurements, editing.annotations, editing.pendingPoint);
              }
            } else image = viewer.capture(command.four ?? false);
            const blob = await image;
            if (command.attachToDraft)
              await attachModelImage(blob, threadRef, `${path.split("/").at(-1)}-capture.png`);
            png = await captureBase64(blob);
            break;
          }
          case "snapshot":
            break;
          case "parameters":
          case "parameter-set":
          case "parameter-preview":
          case "parameter-history":
            throw new Error("Open the part's own file to change its parameters.");
          default:
            throw new Error("This editor action is unavailable for assemblies.");
        }
      return {
        message: "Assembly editor action completed.",
        ...workspaceResult,
        ...(png ? { png } : {}),
        ...(command.action === "snapshot"
          ? {
              ...(viewerRef.current && size && !loading
                ? { camera: viewerRef.current.snapshot() }
                : {}),
              sourceRevision: geometryRevision,
              state: {
                inspector: inspectorOpen ? workspace.inspectorTab : null,
                tool: explode ? null : editing.picking,
                measureMode: editing.measureMode,
                sectionCaps,
                pendingPoint: editing.pendingPoint,
                pendingRegion: editing.pendingRegion,
                loading,
                parameters: null,
                assembly: { selectedPartId: selectedId, isolatedPartId: isolatedId, explode },
                ...(size ? { fit: bedFitSummary(size, settings.buildPlate, { library }) } : {}),
              },
            }
          : {}),
      };
    };
    void execute()
      .then((result) =>
        runModelCommand(models.completeEditorAction, {
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, path, requestId: request.requestId, ...result },
        }),
      )
      .catch((cause) =>
        runModelCommand(models.completeEditorAction, {
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            path,
            requestId: request.requestId,
            message: cause instanceof Error ? cause.message : String(cause),
            error: true,
          },
        }).catch(() => {}),
      );
  });
  useEffect(() => {
    handleEditorRequest(editorRequest);
  }, [editorRequest]);
  const handlePaletteAction = useEffectEvent((action: import("./actions").ModelAction) => {
    if (action === "capture" || action === "capture-four") void capture(action === "capture-four");
    else if (action === "copy-view" || action === "save-view")
      void capture(false, action === "copy-view" ? "copy" : "save");
    else if (action === "toggle-explode") setExplode((value) => (value ? 0 : 1));
    else if (action === "rerender") void assembly.refresh();
    else if (action === "toggle-overhangs")
      setDisplay((value) => ({ ...value, overhangs: !value.overhangs }));
    else if (action === "toggle-units")
      unitsControl.setUnits(unitsControl.units === "mm" ? "in" : "mm");
    else if (action === "print-check") void assembly.check();
  });
  useEffect(() => {
    if (!visible) return;
    return onModelAction(
      threadRef,
      handlePaletteAction,
      () => viewerRef.current?.snapshot().overhangs ?? false,
    );
  }, [visible, threadRef]);
  if (!snapshot)
    return assembly.error ? (
      <div role="alert" className="p-3">
        <p>{assembly.error}</p>
        <Button onClick={() => void assembly.refresh()}>Retry</Button>
      </div>
    ) : (
      <OperationStatus label="Loading assembly" />
    );
  const sourcePaths = [
    ...new Set(snapshot.parts.flatMap((part) => (part.path ? [part.path] : []))),
  ];
  return (
    <DisplayUnitsProvider value={unitsControl}>
      <div
        className={styles["model-workspace"]}
        data-model-assembly
        tabIndex={-1}
        aria-label="3D assembly workspace"
        onKeyDown={(event) => {
          if (
            !visible ||
            event.defaultPrevented ||
            (event.target instanceof HTMLElement &&
              event.target.closest(
                'input,textarea,select,[contenteditable="true"],[role="menu"],[role="dialog"],[role="listbox"]',
              ))
          )
            return;
          const key = event.key.toLowerCase(),
            nudge = nudgeFor(event.key, event.shiftKey);
          if ((event.ctrlKey || event.metaKey) && key === "z" && canUndo && !busy)
            void revert().catch(() => {});
          else if (event.ctrlKey || event.metaKey || event.altKey) return;
          else if (key === "e") setExplode((value) => (value ? 0 : 1));
          else if (key === "f") viewerRef.current?.fit();
          else if (key === "escape") {
            editing.cancel();
            setExplode(0);
            setIsolatedId(null);
            setFocusedPair(null);
          } else if (key === "m" && !workspace.disabled) {
            workspace.startTool("measure");
            setInspectorOpen(true);
          } else if (key === "n" && !workspace.disabled) {
            workspace.startTool("annotate");
            setInspectorOpen(true);
          } else if (key === "s" && !workspace.disabled) toggleSection();
          else if (["1", "2", "3", "4"].includes(key))
            setView((["iso", "front", "top", "right"] as const)[Number(key) - 1]!);
          else if (key === "h") setNavigationMode("pan");
          else if (key === "o") setNavigationMode("orbit");
          else if (key === "i") setInspectorOpen((value) => !value);
          else if (key === "w") setDisplay((value) => ({ ...value, wireframe: !value.wireframe }));
          else if (key === "g") setDisplay((value) => ({ ...value, grid: !value.grid }));
          else if (key === "a") setDisplay((value) => ({ ...value, axes: !value.axes }));
          else if (key === "v") setDisplay((value) => ({ ...value, overhangs: !value.overhangs }));
          else if (key === "p")
            setDisplay((value) => ({
              ...value,
              projection: value.projection === "perspective" ? "orthographic" : "perspective",
            }));
          else if (key === "+" || key === "=") viewerRef.current?.zoom(1 / 1.2);
          else if (key === "-") viewerRef.current?.zoom(1.2);
          else if (nudge && viewerRef.current?.owns(event.target)) viewerRef.current.nudge(nudge);
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {visible &&
          [path, ...sourcePaths].map((source) => (
            <AssemblyWatch key={source} threadRef={threadRef} path={source} onChange={refresh} />
          ))}
        <div className={styles["model-document-bar"]}>
          <div className={styles["model-document-name"]}>
            <strong>{snapshot.assembly.name}</strong>
            <small>{path}</small>
          </div>
          <div className={styles["model-document-actions"]}>
            <CaptureMenu
              disabled={!size || loading || !editing.canEdit}
              capturing={editing.operation !== null}
              sheets={explode ? [] : editing.data.presets}
              canCopy={canCopyImages()}
              onCapture={(four) => void capture(four)}
              onExport={(action, four) => void capture(four, action)}
              onSheet={(preset) =>
                void editing.captureViews(preset.viewIds, preset.includeMeasurements, preset.name)
              }
            />
            <Button
              size="sm"
              variant="outline"
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen((value) => !value)}
            >
              Inspector
            </Button>
            <Button
              size="sm"
              disabled={assembly.readOnly || assembly.busy || snapshot.assembly.parts.length >= 32}
              onClick={() => setAdding((value) => !value)}
            >
              Add part
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-pressed={allowLarge}
              onClick={() => setAllowLarge((value) => !value)}
            >
              {allowLarge ? "Large parts allowed" : "Load large parts"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                useRightPanelStore
                  .getState()
                  .openSurface(threadRef, forkPanelSurface("model-preview-3d"))
              }
            >
              All models
            </Button>
          </div>
        </div>
        {(assembly.error || viewerError || editing.error) && (
          <p role="alert" className={styles["model-notice"]} data-tone="error">
            {assembly.error ?? viewerError ?? editing.error}
          </p>
        )}
        {adding && (
          <div className="flex flex-col gap-2 p-3">
            <Input
              type="search"
              aria-label="Find a model to add"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a model to add..."
            />
            {!listing && <OperationStatus label="Loading model files" />}
            {listing?.models
              .filter((model) => model.path.toLowerCase().includes(search.toLowerCase()))
              .map((model) => (
                <Button
                  key={model.path}
                  variant="outline"
                  disabled={assembly.busy}
                  onClick={() =>
                    void assembly
                      .apply([{ op: "add-part", path: model.path }])
                      .then(() => setAdding(false))
                      .catch(() => {})
                  }
                >
                  {model.path}
                </Button>
              ))}
            {listing && !listing.models.length && (
              <p>No model files are available in this workspace.</p>
            )}
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Close
            </Button>
          </div>
        )}
        <div className={styles["model-work-area"]} data-inspector-open={inspectorOpen}>
          <div className={styles["model-viewport"]}>
            <div className={styles["model-canvas"]}>
              <AssemblyCanvas
                threadRef={threadRef}
                snapshot={snapshot}
                visible={visible}
                plate={plate}
                selectedId={selectedId}
                isolatedId={isolatedId}
                explode={explode}
                preview={preview}
                viewerRef={viewerRef}
                onSelect={selectPart}
                onErrors={setErrors}
                onPartStats={setPartStats}
                onError={setViewerError}
                onSize={updateSize}
                sourceEpochs={sourceEpochs}
                allowLarge={allowLarge}
                workspace={workspace}
                display={display}
                navigationMode={navigationMode}
                reference={referenceControl.reference}
                onBounds={updateBounds}
                onPartRevisions={updatePartRevisions}
                onNavigate={onNavigate}
                onCamera={onCamera}
                onSectionCapsStatus={setSectionCaps}
              />
            </div>
            <ViewTools
              active={activeView}
              savedViews={editing.data.views}
              activeViewId={workspace.activeViewId}
              onView={setView}
              onSavedView={workspace.recallView}
              onSaveView={workspace.saveView}
              disabled={!size || loading || explode > 0}
            />
            <ToolRail
              tool={explode ? null : editing.picking}
              section={editing.section.enabled}
              disabled={workspace.disabled}
              layFlat={false}
              onTool={(tool) => {
                if (tool !== "lay-flat") {
                  workspace.startTool(tool);
                  setInspectorOpen(true);
                }
              }}
              onSection={toggleSection}
            />
            {editing.section.enabled && bounds && (
              <SectionStrip
                section={editing.section}
                bounds={sectionBounds(editing.section.axis)}
                onChange={changeSection}
                onRemove={toggleSection}
                capsState={sectionCaps}
                wireframe={display.wireframe}
              />
            )}
            {!explode && editing.picking && (
              <ToolHint onDone={editing.stopPicking}>
                {editing.picking === "annotate"
                  ? "Click the part you want changed"
                  : editing.measureMode === "hole"
                    ? "Click the rim or wall of the hole"
                    : editing.pendingPoint
                      ? "Click the second point"
                      : "Click the first point to measure from"}
              </ToolHint>
            )}
            <DisplayTools
              {...display}
              bed={
                <BedPicker
                  environmentId={threadRef.environmentId}
                  settings={settings}
                  referenceControl={referenceControl}
                />
              }
              orthographic={display.projection === "orthographic"}
              onOrthographic={(value) =>
                setDisplay((current) => ({
                  ...current,
                  projection: value ? "orthographic" : "perspective",
                }))
              }
              onWireframe={(value) => setDisplay((current) => ({ ...current, wireframe: value }))}
              onGrid={(value) => setDisplay((current) => ({ ...current, grid: value }))}
              onAxes={(value) => setDisplay((current) => ({ ...current, axes: value }))}
              onOverhangs={(value) => setDisplay((current) => ({ ...current, overhangs: value }))}
            />
            <NavigationTools
              mode={navigationMode}
              onMode={setNavigationMode}
              onFit={() => viewerRef.current?.fit()}
              onZoom={(factor) => viewerRef.current?.zoom(factor)}
              disabled={!size}
            />
            {!snapshot.assembly.parts.length && (
              <div className={styles["model-status-overlay"]}>
                <p>Add the first part to start placing this assembly.</p>
              </div>
            )}
          </div>
          {inspectorOpen && (
            <AssemblyInspector
              workspace={workspace}
              snapshot={snapshot}
              settings={settings}
              environmentId={threadRef.environmentId}
              {...(size ? { size } : {})}
              selectedId={selectedId}
              onSelect={selectPart}
              errors={errors}
              partStats={partStats}
              onApply={assembly.apply}
              onUndo={assembly.revert}
              canUndo={assembly.canUndo}
              busy={assembly.busy}
              readOnly={assembly.readOnly}
              report={assembly.report}
              checking={assembly.checking}
              canCheck={assembly.canCheck}
              canAlign={assembly.canAlign}
              stale={assembly.stale}
              onCheck={() => void assembly.check()}
              onCancelCheck={assembly.cancel}
              explode={explode}
              onExplode={setExplode}
              isolatedId={isolatedId}
              onIsolate={setIsolatedId}
              onFocusEnclosure={focusEnclosure}
              onFocusPair={focusPair}
              onPreview={setPreview}
              loadParameters={assembly.loadParameters}
              onOpenPart={(part) => {
                const source = resolvePartPath(path, part.path);
                if (source)
                  useRightPanelStore.getState().openSurface(threadRef, modelSurface(source));
              }}
            />
          )}
        </div>
        <div className={styles["model-status-bar"]}>
          <span>
            {snapshot.assembly.parts.length} parts
            {explode ? " · Exploded view, fit uses assembled placement" : ""}
          </span>
          <span>
            {assembly.busy
              ? "Saving..."
              : assembly.readOnly
                ? "Read-only assembly"
                : "All placement in millimeters"}
          </span>
        </div>
      </div>
    </DisplayUnitsProvider>
  );
}
