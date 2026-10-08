import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ModelAnnotation, ModelPoint, ModelSection } from "@t3tools/contracts/fork";
import { useComposerDraftStore } from "~/composerDraftStore";
import { randomUUID } from "~/lib/utils";
import type { ModelViewer } from "./viewer/createViewer";
import type { ScadSession } from "./ScadCustomizer";
import { attachModelImage } from "./capture";
import { useModelWorkspace } from "./useModelWorkspace";
import { captureNamedViews, thumbnail } from "./viewer/captureSheet";

export function useModelEditing(
  threadRef: ScopedThreadRef,
  path: string,
  viewer: React.RefObject<ModelViewer | null>,
  sourceRevision: string,
  session: ScadSession | null,
) {
  const workspace = useModelWorkspace(threadRef, path);
  const [section, setSection] = useState<ModelSection>({
    enabled: false,
    axis: "z",
    offset: 0,
    flipped: false,
  });
  const [picking, setPicking] = useState<"measure" | "annotate" | null>(null);
  const [pendingPoint, setPendingPoint] = useState<ModelPoint | null>(null);
  const [pendingCamera, setPendingCamera] = useState<ModelAnnotation["camera"] | null>(null);
  const [pendingRegion, setPendingRegion] = useState<ModelPoint[] | null>(null);
  const [relink, setRelink] = useState<ModelAnnotation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const operationActive = useRef(false);
  const perform = useCallback(async <T>(label: string, task: () => Promise<T>) => {
    if (operationActive.current) return undefined;
    operationActive.current = true;
    setOperation(label);
    setError(null);
    try {
      return await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    } finally {
      operationActive.current = false;
      setOperation(null);
    }
  }, []);
  const measurements = useMemo(
    () => workspace.data.measurements.filter((item) => item.sourceRevision === sourceRevision),
    [workspace.data.measurements, sourceRevision],
  );
  const annotations = useMemo(() => {
    const items = workspace.data.annotations.filter(
      (item) => item.sourceRevision === sourceRevision,
    );
    const camera = pendingCamera;
    if (pendingRegion && camera)
      items.push({
        id: "pending-region",
        name: "Selected region",
        sourceRevision,
        points: pendingRegion,
        status: "open",
        request: "Pending request",
        reviewedRevision: null,
        camera,
        parameters: {},
        referenceImage: null,
      });
    return items;
  }, [workspace.data.annotations, sourceRevision, pendingRegion, pendingCamera]);
  const cancel = useCallback(() => {
    setPicking(null);
    setPendingPoint(null);
    setPendingRegion(null);
    setRelink(null);
  }, []);
  const choose = useCallback(
    (mode: typeof picking) => {
      cancel();
      setPicking(mode);
    },
    [cancel],
  );
  const mutate = workspace.mutate;
  const measurementCount = workspace.data.measurements.length;
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Geometry replacement invalidates unfinished surface picks.
  useEffect(() => cancel, [sourceRevision, cancel]);
  const onPick = useCallback(
    async (points: ModelPoint[]) => {
      if (!sourceRevision || !points.length) return false;
      if (picking === "measure") {
        if (!pendingPoint) setPendingPoint(points[0]!);
        else {
          const saved = await mutate({
            kind: "measurement",
            item: {
              id: randomUUID(),
              name: `Distance ${measurementCount + 1}`,
              sourceRevision,
              start: pendingPoint,
              end: points[0]!,
              visible: true,
            },
          });
          if (!saved) return false;
          setPendingPoint(null);
        }
        return true;
      } else if (picking === "annotate") {
        setPendingCamera(viewer.current?.snapshot() ?? null);
        setPendingRegion(points);
        setPicking(null);
        return true;
      }
      return false;
    },
    [sourceRevision, picking, pendingPoint, mutate, measurementCount, viewer],
  );
  const markedCapture = async (annotation: ModelAnnotation) => {
    if (!viewer.current) throw new Error("Load the model before capturing it.");
    const original = viewer.current.snapshot();
    try {
      viewer.current.restore(annotation.camera);
      if (annotation.sourceRevision !== sourceRevision) viewer.current.refit();
      viewer.current.setOverlays(
        [],
        annotation.sourceRevision === sourceRevision ? [{ ...annotation, status: "open" }] : [],
        null,
      );
      return viewer.current.capture(false);
    } finally {
      viewer.current.restore(original);
      viewer.current.setOverlays(measurements, annotations, pendingPoint);
    }
  };
  const addAnnotation = async (name: string, request: string) =>
    !!(await perform("Saving marked annotation", async () => {
      if (!pendingRegion || !viewer.current) return false;
      if (session && session.appliedRevision !== sourceRevision)
        throw new Error(
          "Wait for the current preview to finish loading before saving this annotation.",
        );
      const annotation: ModelAnnotation = {
        id: relink?.id ?? randomUUID(),
        name,
        request,
        sourceRevision,
        points: pendingRegion,
        status: "open",
        reviewedRevision: null,
        camera: pendingCamera ?? viewer.current.snapshot(),
        parameters: session?.applied ?? {},
        referenceImage: null,
      };
      const referenceImage = await thumbnail(await markedCapture(annotation));
      const saved = await workspace.mutate({
        kind: "annotation",
        item: { ...annotation, referenceImage },
      });
      if (saved) cancel();
      return !!saved;
    }));
  const prepareRequest = async (annotation: ModelAnnotation) => {
    return await perform("Preparing agent request", async () => {
      await attachModelImage(
        await markedCapture(annotation),
        threadRef,
        `${annotation.name}-marked.png`,
      );
      const store = useComposerDraftStore.getState();
      const context = `Model change request: ${annotation.name}\nFile: ${path}\nRendered geometry revision: ${annotation.sourceRevision}\nRegion (mm): ${JSON.stringify(annotation.points)}\nApplied parameters: ${JSON.stringify(annotation.parameters)}\n\n${annotation.request}\n\nUse the attached marked view and preserve unrelated geometry. Explain the change so I can review the result in Loom.`;
      const previous = store.getComposerDraft(threadRef)?.prompt ?? "";
      store.setPrompt(threadRef, previous ? `${previous}\n\n${context}` : context);
      await workspace.mutate({ kind: "annotation", item: { ...annotation, status: "review" } });
      return true;
    });
  };
  const captureViews = async (
    ids: readonly string[],
    includeMeasurements: boolean,
    name: string,
  ) => {
    await perform("Capturing named views", async () => {
      if (!viewer.current) return;
      const views = ids.flatMap((id) => workspace.data.views.filter((view) => view.id === id));
      if (!views.length) throw new Error("Save a view before capturing a sheet.");
      viewer.current.setOverlays(includeMeasurements ? measurements : [], annotations, null);
      let capture: Promise<Blob>;
      try {
        capture = captureNamedViews(
          viewer.current,
          views,
          `${path} · ${sourceRevision.slice(0, 12)}`,
          sourceRevision,
        );
      } finally {
        viewer.current.setOverlays(measurements, annotations, pendingPoint);
      }
      await attachModelImage(await capture, threadRef, `${name}.png`);
    });
  };
  const review = async (annotation: ModelAnnotation) =>
    (await perform("Capturing current model for review", async () => {
      return thumbnail(await markedCapture(annotation));
    })) ?? "";
  const reselect = (annotation: ModelAnnotation) => {
    choose("annotate");
    setRelink(annotation);
  };
  return {
    ...workspace,
    operation,
    perform,
    section,
    setSection,
    picking,
    choose,
    pendingPoint,
    pendingRegion,
    measurements,
    annotations,
    onPick,
    cancel,
    addAnnotation,
    prepareRequest,
    captureViews,
    review,
    captureAnnotation: (annotation: ModelAnnotation) =>
      perform("Capturing marked annotation", () => markedCapture(annotation)),
    reselect,
    error: error ?? workspace.error,
  };
}
