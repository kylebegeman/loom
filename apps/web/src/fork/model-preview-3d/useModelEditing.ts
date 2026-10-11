import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  ModelAnnotation,
  ModelMeasurement,
  ModelOrientation,
  ModelQuaternion,
  ModelPoint,
  ModelSection,
} from "@t3tools/contracts/fork";
import { normalizeQuaternion } from "@t3tools/contracts/fork";
import type { Vector3 } from "three";
import { createWallMeasurement } from "./wallMeasurement";
import { orientationRequest } from "./orientationRequest";
import type { FaceOrientation } from "./viewer/orientation";
import { useComposerDraftStore } from "~/composerDraftStore";
import { randomUUID } from "~/lib/utils";
import type { CircleFit } from "./viewer/snap";
import type { ModelViewer, OverlayAnnotation } from "./viewer/createViewer";
import type { ScadSession } from "./ScadCustomizer";
import { attachModelImage } from "./capture";
import { captureFileName, copyImage, saveImage, type ExportAction } from "./captureExport";
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
    caps: true,
  });
  const [picking, setPicking] = useState<"measure" | "annotate" | "lay-flat" | null>(null);
  const [measureMode, updateMeasureMode] = useState<"distance" | "hole">("distance");
  const [pendingPoint, setPendingPoint] = useState<ModelPoint | null>(null);
  const [pendingCamera, setPendingCamera] = useState<ModelAnnotation["camera"] | null>(null);
  const [pendingRegion, setPendingRegion] = useState<ModelPoint[] | null>(null);
  const [relink, setRelink] = useState<ModelAnnotation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orientationMessage, setOrientationMessage] = useState<string | null>(null);
  const [orientationOverride, setOrientationOverride] = useState<{
    value: ModelOrientation | null;
    before: string;
  } | null>(null);
  const storedOrientation = workspace.data.orientation;
  const latestStoredOrientation = useRef(storedOrientation);
  useEffect(() => {
    latestStoredOrientation.current = storedOrientation;
  }, [storedOrientation]);
  const storedKey = JSON.stringify(storedOrientation);
  const overrideActive = orientationOverride && storedKey === orientationOverride.before;
  const orientation = overrideActive ? orientationOverride.value : storedOrientation;
  // A server-confirmed pose or a newer client edit ends the optimistic override.
  if (
    orientationOverride &&
    (!overrideActive || storedKey === JSON.stringify(orientationOverride.value))
  )
    setOrientationOverride(null);
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
    // Pins carry their position in the full request list, which includes older revisions.
    const items: OverlayAnnotation[] = workspace.data.annotations.flatMap((item, index) =>
      item.sourceRevision === sourceRevision ? [{ ...item, number: index + 1 }] : [],
    );
    const camera = pendingCamera;
    if (pendingRegion && camera)
      items.push({
        number: workspace.data.annotations.length + 1,
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
    updateMeasureMode("distance");
    setError(null);
    setOrientationMessage(null);
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
  const setMeasureMode = useCallback((mode: "distance" | "hole") => {
    updateMeasureMode(mode);
    setPendingPoint(null);
    setError(null);
  }, []);
  const mutate = workspace.mutate;
  /** Apply immediately, then let the persisted workspace stream become authoritative. */
  const saveOrientation = useCallback(
    async (item: ModelOrientation | null) =>
      (await perform("Saving orientation", async () => {
        if (!workspace.canEdit || !workspace.ready || !viewer.current) return false;
        const value = item && { ...item, quaternion: normalizeQuaternion(item.quaternion) };
        const before = JSON.stringify(latestStoredOrientation.current);
        setOrientationOverride({ value, before });
        viewer.current.setOrientation(value?.quaternion ?? null);
        try {
          const saved = await mutate({ kind: "orientation", item: value });
          if (!saved) {
            setOrientationOverride(null);
            viewer.current?.setOrientation(latestStoredOrientation.current?.quaternion ?? null);
            return false;
          }
          return true;
        } catch (cause) {
          setOrientationOverride(null);
          viewer.current?.setOrientation(latestStoredOrientation.current?.quaternion ?? null);
          throw cause;
        }
      })) ?? false,
    [perform, workspace.canEdit, workspace.ready, viewer, mutate],
  );
  const faceOrientationAt = useCallback(
    async (point: ModelPoint): Promise<FaceOrientation | null> => {
      if (!workspace.canEdit || !workspace.ready || !sourceRevision || !viewer.current) return null;
      const result = viewer.current.faceOrientationAt(point);
      if (!result) {
        setError("No face at that point.");
        return null;
      }
      const old = normalizeQuaternion(orientation?.quaternion ?? [0, 0, 0, 1]);
      const next = normalizeQuaternion(result.quaternion);
      const dot = old.reduce((total, value, axis) => total + value * next[axis]!, 0);
      if (Math.abs(dot) >= 1 - 1e-10) {
        setError(null);
        setOrientationMessage("Already resting on that face");
        return result;
      }
      if (!(await saveOrientation({ quaternion: result.quaternion, sourceRevision }))) return null;
      setOrientationMessage(
        result.floats
          ? "This face cannot touch the bed; the part rests on other points."
          : `Resting on a face of ${result.areaMm2.toFixed(1)} mm².`,
      );
      return result;
    },
    [workspace.canEdit, workspace.ready, sourceRevision, viewer, orientation, saveOrientation],
  );
  const autoOrient = useCallback(async (): Promise<ModelQuaternion | null> => {
    const quaternion = viewer.current?.autoOrientation();
    if (!quaternion) {
      setError("No stable face found.");
      return null;
    }
    if (!(await saveOrientation({ quaternion, sourceRevision }))) return null;
    setOrientationMessage("Laid flat on the largest side.");
    return quaternion;
  }, [viewer, saveOrientation, sourceRevision]);
  const resetOrientation = useCallback(async () => {
    const saved = await saveOrientation(null);
    if (saved) setOrientationMessage("Orientation reset.");
    return saved;
  }, [saveOrientation]);
  const prepareOrientationRequest = useCallback(
    async (format: string, partCentre: Vector3, orientedMinZ: number) =>
      perform("Preparing rotation request", async () => {
        if (!orientation) return false;
        const store = useComposerDraftStore.getState();
        const previous = store.getComposerDraft(threadRef)?.prompt ?? "";
        const request = orientationRequest(path, format, orientation, partCentre, orientedMinZ);
        store.setPrompt(threadRef, previous ? `${previous}\n\n${request}` : request);
        return true;
      }),
    [orientation, threadRef, path, perform],
  );
  const measurementCount = workspace.data.measurements.length;
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Geometry replacement invalidates unfinished surface picks.
  useEffect(() => cancel, [sourceRevision, cancel]);
  const onPick = useCallback(
    async (points: ModelPoint[]): Promise<false | { measurement: ModelMeasurement | null }> => {
      if (!sourceRevision || !points.length) return false;
      if (picking === "lay-flat")
        return (await faceOrientationAt(points[0]!)) ? { measurement: null } : false;
      if (picking === "measure") {
        if (!pendingPoint) {
          setPendingPoint(points[0]!);
          return { measurement: null };
        }
        const measurement: ModelMeasurement = {
          id: randomUUID(),
          kind: "distance",
          name: `Distance ${measurementCount + 1}`,
          sourceRevision,
          start: pendingPoint,
          end: points[0]!,
          visible: true,
        };
        const saved = await mutate({ kind: "measurement", item: measurement });
        if (!saved) return false;
        setPendingPoint(null);
        return { measurement };
      } else if (picking === "annotate") {
        setPendingCamera(viewer.current?.snapshot() ?? null);
        setPendingRegion(points);
        setPicking(null);
        return { measurement: null };
      }
      return false;
    },
    [sourceRevision, picking, pendingPoint, mutate, measurementCount, viewer, faceOrientationAt],
  );
  const circleCount = workspace.data.measurements.filter((item) => item.kind === "circle").length;
  const onCircle = useCallback(
    async (fit: CircleFit | null): Promise<false | { measurement: ModelMeasurement }> => {
      if (!fit) {
        setError("Click the rim of the hole");
        return false;
      }
      if (!sourceRevision || picking !== "measure") return false;
      const normal = fit.normal;
      const axis: ModelPoint = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const projection = axis[0] * normal[0] + axis[1] * normal[1] + axis[2] * normal[2];
      const direction = axis.map((value, i) => value - projection * normal[i]!) as [
        number,
        number,
        number,
      ];
      const size = Math.hypot(...direction);
      const start = fit.center.map(
        (value, i) => value - ((direction[i]! / size) * fit.diameter) / 2,
      ) as [number, number, number];
      const end = fit.center.map(
        (value, i) => value + ((direction[i]! / size) * fit.diameter) / 2,
      ) as [number, number, number];
      const measurement: ModelMeasurement = {
        id: randomUUID(),
        kind: "circle",
        name: `Hole ${circleCount + 1}`,
        sourceRevision,
        start,
        end,
        visible: true,
        circle: {
          center: fit.center,
          normal: fit.normal,
          diameter: fit.diameter,
          sides: fit.sides,
        },
      };
      if (!(await mutate({ kind: "measurement", item: measurement }))) return false;
      setError(null);
      setPendingPoint(null);
      return { measurement };
    },
    [sourceRevision, picking, circleCount, mutate],
  );
  const wallCount = workspace.data.measurements.filter((item) =>
    /^Wall \d+$/.test(item.name),
  ).length;
  const onWall = useCallback(
    async (
      start: ModelPoint,
      end: ModelPoint,
    ): Promise<false | { measurement: ModelMeasurement }> => {
      if (!sourceRevision || !workspace.canEdit) return false;
      const measurement = createWallMeasurement(
        start,
        end,
        sourceRevision,
        randomUUID(),
        wallCount,
      );
      if (!(await mutate({ kind: "measurement", item: measurement }))) return false;
      setError(null);
      setPendingPoint(null);
      return { measurement };
    },
    [sourceRevision, workspace.canEdit, mutate, wallCount],
  );
  const markedCapture = async (annotation: ModelAnnotation) => {
    if (!viewer.current) throw new Error("Load the model before capturing it.");
    const original = viewer.current.snapshot();
    const position = workspace.data.annotations.findIndex((item) => item.id === annotation.id);
    const number = position < 0 ? workspace.data.annotations.length + 1 : position + 1;
    try {
      viewer.current.restore(annotation.camera);
      if (annotation.sourceRevision !== sourceRevision) viewer.current.refit();
      viewer.current.setOverlays(
        [],
        annotation.sourceRevision === sourceRevision ? [{ ...annotation, number }] : [],
        null,
      );
      return viewer.current.capture(false);
    } finally {
      viewer.current.restore(original);
      viewer.current.setOverlays(measurements, annotations, pendingPoint);
    }
  };
  /** Saves the pending region and resolves with the saved annotation, or null. */
  const addAnnotation = async (name: string, request: string) =>
    (await perform("Saving marked annotation", async () => {
      if (!pendingRegion || !viewer.current) return null;
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
      const item = {
        ...annotation,
        referenceImage: await thumbnail(await markedCapture(annotation)),
      };
      const saved = await workspace.mutate({ kind: "annotation", item });
      if (!saved) return null;
      cancel();
      return item;
    })) ?? null;
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
  const renderViews = (ids: readonly string[], includeMeasurements: boolean): Promise<Blob> => {
    if (!viewer.current) throw new Error("Load the model before capturing it.");
    const views = ids.flatMap((id) => workspace.data.views.filter((view) => view.id === id));
    if (!views.length) throw new Error("Save a view before capturing a sheet.");
    viewer.current.setOverlays(includeMeasurements ? measurements : [], annotations, null);
    try {
      return captureNamedViews(
        viewer.current,
        views,
        `${path} · ${sourceRevision.slice(0, 12)}`,
        sourceRevision,
      );
    } finally {
      viewer.current.setOverlays(measurements, annotations, pendingPoint);
    }
  };
  const captureViews = async (
    ids: readonly string[],
    includeMeasurements: boolean,
    name: string,
  ) => {
    await perform("Capturing named views", async () => {
      if (!viewer.current) return;
      await attachModelImage(await renderViews(ids, includeMeasurements), threadRef, `${name}.png`);
    });
  };
  const exportViews = (
    ids: readonly string[],
    includeMeasurements: boolean,
    name: string,
    action: ExportAction,
  ) =>
    perform(action === "copy" ? "Copying model image" : "Saving model image", async () => {
      try {
        const image = renderViews(ids, includeMeasurements);
        if (action === "copy") await copyImage(image);
        else saveImage(await image, captureFileName(path, name, new Date()));
        return { ok: true } as const;
      } catch (cause) {
        return {
          ok: false,
          title: action === "copy" ? "Image could not be copied" : "PNG could not be saved",
          message: cause instanceof Error ? cause.message : String(cause),
        } as const;
      }
    });
  const review = async (annotation: ModelAnnotation) =>
    (await perform("Capturing current model for review", async () => {
      return thumbnail(await markedCapture(annotation));
    })) ?? "";
  const reselect = (annotation: ModelAnnotation) => {
    choose("annotate");
    setRelink(annotation);
  };
  /** Pick the pending region again while keeping the request being written. */
  const movePin = () => setPicking("annotate");
  /** Leaves the picking tool but keeps a request that is being written. */
  const stopPicking = () => {
    if (!pendingRegion) return cancel();
    setPicking(null);
    setPendingPoint(null);
  };
  return {
    ...workspace,
    operation,
    perform,
    orientation,
    orientationMessage,
    saveOrientation,
    faceOrientationAt,
    autoOrient,
    resetOrientation,
    prepareOrientationRequest,
    section,
    setSection,
    picking,
    measureMode,
    setMeasureMode,
    choose,
    pendingPoint,
    pendingRegion,
    measurements,
    annotations,
    onPick,
    onCircle,
    onWall,
    cancel,
    addAnnotation,
    prepareRequest,
    captureViews,
    exportViews,
    review,
    captureAnnotation: (annotation: ModelAnnotation) =>
      perform("Capturing marked annotation", () => markedCapture(annotation)),
    reselect,
    relink,
    movePin,
    stopPicking,
    error: error ?? workspace.error,
  };
}
