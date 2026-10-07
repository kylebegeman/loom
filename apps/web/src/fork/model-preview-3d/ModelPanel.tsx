import styles from "./workspace.module.css";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  BoxIcon,
  CheckIcon,
  FileCode2Icon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  XIcon,
  RulerIcon,
  MessageSquarePlusIcon,
} from "lucide-react";
import {
  type ModelEntry,
  type ModelPreviewSettings,
  type ScadRenderResult,
} from "@t3tools/contracts/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "~/components/ui/menu";
import { useRightPanelStore } from "~/rightPanelStore";
import { forkPanelSurface } from "../panels/registry";
import type { ForkPanelProps } from "../panels/types";
import { models, modelUrl, runModelCommand } from "./state";
import { OperationStatus, type OperationProgress } from "./OperationStatus";
import { ScadFile, type ScadSession } from "./ScadCustomizer";
import { useModelEditing } from "./useModelEditing";
import { ToolsInspector, ViewsInspector, ReviewInspector } from "./EditingInspector";
import { VariantsInspector } from "./VariantsInspector";
import type { ModelCamera } from "@t3tools/contracts/fork";
import { ModelPicker } from "./ModelPicker";
import { InspectorHeader, GeometryInspector, RenderLog, type InspectorTab } from "./ModelInspector";
import { resolveBuildVolume, fitsBuildVolume } from "./buildPlate";
import { captureToComposer } from "./capture";
import { type ModelViewer, type NavigationMode } from "./viewer/createViewer";
import type { View } from "./viewer/views";
import type { meshStats } from "./viewer/load";
import { onModelAction } from "./actions";
import { ModelTool, ViewTools, DisplayTools, NavigationTools, CaptureMenu } from "./WorkspaceTools";

export { ModelPicker } from "./ModelPicker";
const ViewerCanvas = lazy(() => import("./viewer/ViewerCanvas"));
const failureMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
      format === "scad" ? "parameters" : "model",
    ),
    [activeView, setActiveView] = useState<View | null>("iso"),
    [navigationMode, setNavigationMode] = useState<NavigationMode>("orbit"),
    [display, setDisplay] = useState({ wireframe: false, grid: true, axes: false });
  const [variantActivity, setVariantActivity] = useState<OperationProgress | null>(null);
  const [session, setSession] = useState<ScadSession | null>(null);
  const [geometryRevision, setGeometryRevision] = useState("");
  const editing = useModelEditing(threadRef, path, viewer, geometryRevision, session);
  const perform = editing.perform;
  const recall = (camera: ModelCamera, refit: boolean) => {
    setDisplay({ wireframe: camera.wireframe, grid: camera.gridVisible, axes: camera.axesVisible });
    setNavigationMode(camera.navigationMode);
    editing.setSection(camera.section);
    viewer.current?.restore(camera);
    if (refit) viewer.current?.refit();
    setActiveView(null);
  };
  const onNavigate = useCallback(() => setActiveView(null), []);
  const setView = (view: View) => {
    viewer.current?.setView(view);
    setActiveView(view);
  };
  const fit = () => {
    viewer.current?.fit();
    setActiveView("iso");
  };
  const showLog = () => {
    setInspectorOpen(true);
    setInspectorTab("log");
  };
  useEffect(() => {
    if (!success) return;
    const timeout = setTimeout(() => setSuccess(null), 5000);
    return () => clearTimeout(timeout);
  }, [success]);
  const volume = useMemo(() => resolveBuildVolume(settings.buildPlate), [settings.buildPlate]);
  const watched = useAtomValue(
    models.watch({ environmentId: threadRef.environmentId, input: file }),
  );
  const [seen, setSeen] = useState<{
    watched: typeof watched | null;
    settings: ModelPreviewSettings | null;
  }>({ watched: null, settings: null });
  if (seen.watched !== watched || seen.settings !== settings) {
    setSeen({ watched, settings });
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
  const resolving = format !== "scad" && resolvedKey !== JSON.stringify([revision, allowLarge]);
  const busy =
    pending || refreshing || resolving || progress !== null || (!stats && !error && !watchError);
  const captureBusy = capturing || editing.operation !== null;
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
  return (
    <div
      className={styles["model-workspace"]}
      tabIndex={-1}
      aria-label="3D model workspace"
      onKeyDown={(event) => {
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
        if (key === "escape") editing.cancel();
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
            disabled={!stats || busy || captureBusy}
            capturing={captureBusy}
            onCapture={(four) => void capture(four)}
          />
          <ModelTool
            label="Toggle inspector (I)"
            aria-pressed={inspectorOpen}
            onClick={() => setInspectorOpen((value) => !value)}
          >
            <SlidersHorizontalIcon />
            <span className={styles["model-action-label"]}>Inspector</span>
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
                Choose model file
              </MenuItem>
              <MenuItem onClick={() => setRevision((value) => value + 1)}>
                <RefreshCwIcon />
                Refresh preview
              </MenuItem>
              <MenuSeparator />
              <MenuItem render={<Link to="/settings/loom" />}>
                <Settings2Icon />
                3D model settings
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
          <div className={styles["model-edit-tools"]}>
            <ModelTool
              label="Measure surfaces"
              disabled={!stats || busy || captureBusy}
              aria-pressed={editing.picking === "measure"}
              onClick={() => {
                editing.choose(editing.picking === "measure" ? null : "measure");
                setInspectorTab("tools");
                setInspectorOpen(true);
              }}
            >
              <RulerIcon />
            </ModelTool>
            <ModelTool
              label="Annotate model region"
              disabled={!stats || busy || captureBusy}
              aria-pressed={editing.picking === "annotate"}
              onClick={() => {
                editing.choose(editing.picking === "annotate" ? null : "annotate");
                setInspectorTab("review");
                setInspectorOpen(true);
              }}
            >
              <MessageSquarePlusIcon />
            </ModelTool>
          </div>
          <ViewTools active={activeView} onView={setView} disabled={!stats} />
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
            {editing.picking && (
              <div className={styles["model-floating"] + " px-3 py-2 text-xs"} role="status">
                {editing.picking === "measure"
                  ? editing.pendingPoint
                    ? "Pick the second surface point"
                    : "Pick the first surface point"
                  : "Click a surface or drag over a region"}{" "}
                · Escape cancels
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
          <InspectorHeader
            active={inspectorTab}
            onTab={setInspectorTab}
            onClose={() => {
              setInspectorOpen(false);
              viewer.current?.focus();
            }}
            scad={format === "scad"}
            errors={issues}
            expanded={inspectorExpanded}
            onExpand={() => setInspectorExpanded((value) => !value)}
          />
          <div className={styles["model-inspector-content"]}>
            <div className={styles["model-inspector-tab-panel"]} hidden={inspectorTab !== "tools"}>
              <ToolsInspector
                data={editing.data}
                mutate={editing.mutate}
                sourceRevision={geometryRevision}
                section={editing.section}
                onSection={editing.setSection}
                picking={editing.picking}
                onPicking={editing.choose}
                pendingPoint={editing.pendingPoint}
              />
            </div>
            <div className={styles["model-inspector-tab-panel"]} hidden={inspectorTab !== "views"}>
              <ViewsInspector
                data={editing.data}
                mutate={editing.mutate}
                sourceRevision={geometryRevision}
                camera={() => viewer.current?.snapshot() ?? null}
                onRecall={recall}
                onCapture={editing.captureViews}
                disabled={!stats || busy || captureBusy}
              />
            </div>
            {format === "scad" && (
              <div
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
              </div>
            )}
            <div className={styles["model-inspector-tab-panel"]} hidden={inspectorTab !== "review"}>
              <ReviewInspector
                data={editing.data}
                mutate={editing.mutate}
                sourceRevision={geometryRevision}
                pending={editing.pendingRegion}
                disabled={!stats || busy || captureBusy}
                onCancel={editing.cancel}
                onAdd={editing.addAnnotation}
                onRequest={editing.prepareRequest}
                onRelink={editing.reselect}
                onReview={editing.review}
              />
            </div>
            {format === "scad" && (
              <div
                className={styles["model-inspector-tab-panel"]}
                hidden={inspectorTab !== "parameters"}
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
            <div className={styles["model-inspector-tab-panel"]} hidden={inspectorTab !== "model"}>
              <GeometryInspector
                stats={stats}
                settings={settings}
                volume={volume}
                render={render}
                format={format}
              />
            </div>
            {format === "scad" && (
              <div className={styles["model-inspector-tab-panel"]} hidden={inspectorTab !== "log"}>
                <RenderLog render={render} />
              </div>
            )}
          </div>
        </aside>
      </div>
      <div className={styles["model-status-bar"]}>
        <span>
          {stats
            ? `${stats.size.map((value) => value.toFixed(2)).join(" × ")} mm`
            : "Dimensions in millimetres"}
        </span>
        {stats && (
          <span className={styles["model-triangle-count"]}>
            {stats.triangles.toLocaleString()} triangles
          </span>
        )}
        {oversized && (
          <button
            className="text-warning-foreground"
            onClick={() => {
              setInspectorOpen(true);
              setInspectorTab("model");
            }}
          >
            Exceeds build volume
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
