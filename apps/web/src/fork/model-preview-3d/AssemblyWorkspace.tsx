import { useCallback, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  AssemblyReadResult,
  ModelEditorAction,
  ModelCamera,
  ModelMeasurement,
  ModelSavedView,
  ModelWall,
} from "@t3tools/contracts/fork";
import { randomUUID } from "~/lib/utils";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { MarkupSection, type MarkupActions } from "./MarkupSection";
import { ViewsSection } from "./ViewsSection";
import { OperationStatus } from "./OperationStatus";
import { toastManager } from "~/components/ui/toast";
import { canCopyImages } from "./captureExport";
import { attachModelImage, captureBase64 } from "./capture";
import { thumbnail } from "./viewer/captureSheet";
import type { ModelViewer } from "./viewer/createViewer";
import { useModelEditing } from "./useModelEditing";

export type AssemblyInspectorTab = "parts" | "fit" | "markup" | "views";

/** Assembly markup uses assembled coordinates and the same persisted workspace as model markup. */
export function useAssemblyWorkspace(input: {
  threadRef: ScopedThreadRef;
  path: string;
  viewerRef: React.RefObject<ModelViewer | null>;
  revision: string;
  explode: number;
  snapshot: AssemblyReadResult | null;
  loading?: boolean;
  onRecall?: (camera: ModelCamera) => void;
}) {
  const { threadRef, path, viewerRef, revision, explode, snapshot } = input;
  const editing = useModelEditing(threadRef, path, viewerRef, revision, null);
  const [inspectorTab, setInspectorTab] = useState<AssemblyInspectorTab>("parts");
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const { copyToClipboard } = useCopyToClipboard();
  const disabled =
    input.loading ||
    !revision ||
    !editing.ready ||
    !editing.canEdit ||
    !!snapshot?.readOnly ||
    explode > 0 ||
    editing.operation !== null;
  const getViewer = () => {
    if (!viewerRef.current || !revision) throw new Error("Wait for the assembly preview to load.");
    return viewerRef.current;
  };
  const requireEditing = () => {
    getViewer();
    if (explode > 0) throw new Error("Collapse the exploded view to measure or annotate.");
    if (disabled) throw new Error("Wait for editable assembly workspace data.");
  };
  const recallView = (view: ModelSavedView) => {
    const viewer = getViewer();
    viewer.restore(view.camera);
    input.onRecall?.(view.camera);
    editing.setSection(view.camera.section);
    if (view.sourceRevision !== revision) viewer.refit();
    setActiveViewId(view.id);
  };
  const saveView = () => {
    if (disabled) return;
    const camera = viewerRef.current?.snapshot();
    if (!camera) return;
    const names = new Set(editing.data.views.map((view) => view.name));
    let index = editing.data.views.length + 1;
    while (names.has(`View ${index}`)) index++;
    const id = randomUUID();
    setInspectorTab("views");
    void editing
      .mutate({
        kind: "view",
        item: { id, name: `View ${index}`, sourceRevision: revision, camera },
      })
      .then((saved) => {
        if (saved) setActiveViewId(id);
      });
  };
  const updateView = (view: ModelSavedView) => {
    if (disabled) return;
    const camera = viewerRef.current?.snapshot();
    if (!camera) return;
    void editing
      .mutate({ kind: "view", item: { ...view, sourceRevision: revision, camera } })
      .then((saved) => {
        if (saved) setActiveViewId(view.id);
      });
  };
  const viewThumbnail = useCallback(
    async (view: ModelSavedView) => {
      if (disabled || !viewerRef.current) return null;
      const viewer = viewerRef.current,
        original = viewer.snapshot();
      let capture: Promise<Blob>;
      const refit = view.sourceRevision !== revision;
      try {
        viewer.restore(view.camera);
        if (refit) viewer.refit();
        capture = viewer.capture(false);
      } finally {
        viewer.restore(original);
      }
      return thumbnail(await capture);
    },
    // oxlint-disable-next-line react/memo-dependencies -- A revision change refits the saved camera before capturing its thumbnail.
    [disabled, viewerRef, revision],
  );
  const startTool = (mode: "measure" | "annotate", measure?: "distance" | "hole") => {
    if (disabled) return;
    if (editing.picking === mode && measure === undefined) editing.stopPicking();
    else {
      editing.choose(mode);
      if (mode === "measure") editing.setMeasureMode(measure ?? "distance");
      setInspectorTab("markup");
    }
  };
  const actions: MarkupActions = {
    onTool: startTool,
    onMovePin: editing.movePin,
    onDiscard: editing.cancel,
    onSave: async (name, request, addToComposer) => {
      requireEditing();
      const saved = await editing.addAnnotation(name, request);
      if (saved && addToComposer) await editing.prepareRequest(saved);
      return saved !== null;
    },
    onRequest: editing.prepareRequest,
    onReselect: editing.reselect,
    onReview: editing.review,
    onShow: (annotation) => {
      const viewer = getViewer();
      viewer.restore(annotation.camera);
      input.onRecall?.(annotation.camera);
      editing.setSection(annotation.camera.section);
      if (annotation.sourceRevision !== revision) viewer.refit();
      setActiveViewId(null);
    },
    onCopy: (text) => {
      void copyToClipboard(text);
    },
  };
  const exportViews: typeof editing.exportViews = async (...args) => {
    const result = await editing.exportViews(...args);
    if (result && !result.ok)
      toastManager.add({ type: "error", title: result.title, description: result.message });
    return result;
  };
  /** Returns null for viewport and assembly operations handled by AssemblyPanel. */
  const handleEditorAction = async (
    command: ModelEditorAction,
  ): Promise<{
    measurement?: ModelMeasurement;
    wall?: ModelWall;
    png?: string;
  } | null> => {
    const c = command;
    switch (c.action) {
      case "tool":
        if (c.name === "select") {
          editing.cancel();
          return {};
        }
        if (c.name !== "measure" && c.name !== "annotate")
          throw new Error("Choose select, measure or annotate.");
        requireEditing();
        editing.choose(c.name);
        editing.setMeasureMode(c.measure ?? "distance");
        setInspectorTab("markup");
        return {};
      case "cancel-tool":
        editing.cancel();
        return {};
      case "pick": {
        requireEditing();
        if (!c.points) throw new Error("Provide assembled model-space points.");
        const viewer = getViewer();
        let picked;
        if (editing.picking === "measure" && editing.measureMode === "hole") {
          if (c.points.length !== 1) throw new Error("Provide one point near the hole rim.");
          const circle = await viewer.circleNear(c.points[0]!, c.snapRadius ?? 1);
          if (!circle) throw new Error("No circular edge near that point.");
          picked = await editing.onCircle(circle);
        } else {
          const points = c.snap
            ? await Promise.all(c.points.map((point) => viewer.snapPoint(point, c.snapRadius ?? 1)))
            : [...c.points];
          picked = await editing.onPick(points);
        }
        if (!picked)
          throw new Error("Choose a picking tool first, or check the workspace save error.");
        return picked.measurement ? { measurement: picked.measurement } : {};
      }
      case "save-annotation":
        requireEditing();
        if (!c.request?.trim()) throw new Error("Provide an annotation request.");
        if (!(await editing.addAnnotation(c.name?.trim() || "Selected region", c.request.trim())))
          throw new Error("Pick a region first, or check the annotation save error.");
        return {};
      case "capture-annotation": {
        requireEditing();
        const annotation = editing.data.annotations.find(
          (item) => item.id === c.name || item.name === c.name,
        );
        if (!annotation) throw new Error("Unknown annotation.");
        const blob = await editing.captureAnnotation(annotation);
        if (!blob) throw new Error("The marked capture could not be prepared.");
        if (c.attachToDraft)
          await attachModelImage(blob, threadRef, `${annotation.name}-marked.png`);
        return { png: await captureBase64(blob) };
      }
      case "prepare-request":
      case "reselect-annotation": {
        requireEditing();
        const annotation = editing.data.annotations.find(
          (item) => item.id === c.name || item.name === c.name,
        );
        if (!annotation) throw new Error("Unknown annotation.");
        if (c.action === "reselect-annotation") {
          editing.reselect(annotation);
          setInspectorTab("markup");
        } else if (!(await editing.prepareRequest(annotation)))
          throw new Error("The change request could not be prepared.");
        return {};
      }
      case "load-view": {
        const view = editing.data.views.find((item) => item.id === c.name || item.name === c.name);
        if (!view) throw new Error("Unknown saved view.");
        recallView(view);
        return {};
      }
      case "wall-thickness": {
        requireEditing();
        if (c.points?.length !== 1) throw new Error("Provide one point on the filled cut.");
        const viewer = getViewer();
        if (!editing.section.enabled) throw new Error("Enable a section first.");
        const wall = viewer.wallThicknessAt(c.points[0]!);
        if (!wall) throw new Error("That point is not inside a closed cut.");
        return { wall };
      }
      default:
        return null;
    }
  };
  return {
    editing,
    disabled,
    canEdit: editing.canEdit && !snapshot?.readOnly,
    revision,
    inspectorTab,
    setInspectorTab,
    activeViewId,
    setActiveViewId,
    saveView,
    recallView,
    updateView,
    viewThumbnail,
    startTool,
    actions,
    exportViews,
    handleEditorAction,
  };
}
export type AssemblyWorkspaceControl = ReturnType<typeof useAssemblyWorkspace>;

export function AssemblyWorkspaceInspector({
  workspace,
  tab,
  active = true,
}: {
  workspace: AssemblyWorkspaceControl;
  tab: "markup" | "views";
  active?: boolean;
}) {
  const { editing, disabled } = workspace;
  return (
    <>
      {editing.error && (
        <p role="alert" className="px-3 py-2 text-xs text-warning">
          {editing.error}
        </p>
      )}
      {editing.operation && <OperationStatus label={editing.operation} />}
      {!editing.ready && !editing.error && <OperationStatus label="Loading assembly workspace" />}
      {tab === "markup" ? (
        <MarkupSection
          data={editing.data}
          mutate={editing.mutate}
          sourceRevision={workspace.revision}
          picking={editing.picking}
          pendingRegion={editing.pendingRegion}
          relink={editing.relink}
          busy={editing.operation !== null}
          disabled={disabled}
          actions={workspace.actions}
        />
      ) : (
        <fieldset disabled={disabled} className="min-w-0">
          <ViewsSection
            data={editing.data}
            mutate={editing.mutate}
            sourceRevision={workspace.revision}
            visible={active}
            activeViewId={workspace.activeViewId}
            disabled={disabled}
            onSave={workspace.saveView}
            onRecall={workspace.recallView}
            onUpdate={workspace.updateView}
            onCapture={editing.captureViews}
            onExport={workspace.exportViews}
            canCopy={canCopyImages()}
            onThumbnail={workspace.viewThumbnail}
          />
        </fieldset>
      )}
    </>
  );
}
