import { useCallback, useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  ModelAnnotation,
  ModelMeasurement,
  ModelOrientation,
  ModelQuaternion,
  ModelPoint,
  ModelSection,
  ModelWorkspaceOperation,
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
import { same } from "./undoHistory";
import { listPatch, samePin, withPending, type UndoSlice } from "./undoSlice";
import { useUndoHistory } from "./useUndoHistory";

/** An undo or redo save the workspace stream has not shown yet; a null item is a removal. */
type PendingSave<T> = { item: T | null; saved: boolean };

/** Remembers an undo save until the stream shows it, and forgets it at once if it fails. */
function trackSave<T>(
  pending: Map<string, PendingSave<T>>,
  id: string,
  item: T | null,
  save: Promise<unknown>,
) {
  const entry: PendingSave<T> = { item, saved: false };
  pending.set(id, entry);
  void save.then((saved) => {
    if (pending.get(id) !== entry) return;
    if (saved) entry.saved = true;
    else pending.delete(id);
  });
}

// The two capture helpers live at module level because React Compiler cannot lower try/finally.
function captureAnnotation(
  viewer: ModelViewer,
  annotation: ModelAnnotation,
  number: number,
  sourceRevision: string,
  restoreOverlays: () => void,
) {
  const original = viewer.snapshot();
  try {
    viewer.restore(annotation.camera);
    if (annotation.sourceRevision !== sourceRevision) viewer.refit();
    viewer.setOverlays(
      [],
      annotation.sourceRevision === sourceRevision ? [{ ...annotation, number }] : [],
      null,
    );
    return viewer.capture(false);
  } finally {
    viewer.restore(original);
    restoreOverlays();
  }
}

function captureViewSheet(
  viewer: ModelViewer,
  views: Parameters<typeof captureNamedViews>[1],
  footer: string,
  revision: string,
  restoreOverlays: () => void,
) {
  try {
    return captureNamedViews(viewer, views, footer, revision);
  } finally {
    restoreOverlays();
  }
}

/**
 * Drops saves the stream now shows. A save confirmed earlier is dropped on the stream's next
 * update even when the item differs, since that update already carries any later change.
 */
function forgetShown<T extends { id: string }>(
  pending: Map<string, PendingSave<T>>,
  live: readonly T[],
  equal: (a: T | undefined, b: T | undefined) => boolean,
) {
  for (const [id, entry] of pending)
    if (
      entry.saved ||
      equal(
        live.find((item) => item.id === id),
        entry.item ?? undefined,
      )
    )
      pending.delete(id);
}

export function useModelEditing(
  threadRef: ScopedThreadRef,
  path: string,
  viewer: React.RefObject<ModelViewer | null>,
  sourceRevision: string,
  session: ScadSession | null,
  /** `undo` keeps a panel-wide undo history for this file; the assembly view leaves it off. */
  options: { undo?: boolean } = {},
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
  // Undo is kept per file revision: the source for CAD files, whose renders change with
  // parameters, and the mesh itself otherwise.
  const contentRevision = session?.data.sourceRevision ?? sourceRevision;
  const undoScope =
    options.undo && contentRevision
      ? `${threadRef.environmentId}:${threadRef.threadId}:${path}@${contentRevision}`
      : "";
  const parameters = session?.parameters ?? null;
  const undoSlice = useMemo<UndoSlice>(
    () => ({
      measurements: workspace.data.measurements,
      annotations: workspace.data.annotations,
      section,
      orientation,
      parameters,
    }),
    [workspace.data.measurements, workspace.data.annotations, section, orientation, parameters],
  );
  const applyUndo = useRef<(fields: Partial<UndoSlice>, from: Partial<UndoSlice>) => boolean>(
    () => false,
  );
  const history = useUndoHistory({
    scope: undoScope,
    slice: undoSlice,
    ready: workspace.ready,
    apply: (fields, from) => applyUndo.current(fields, from),
  });
  const { recordOperation, recordValue } = history;
  const [operation, setOperation] = useState<string | null>(null);
  const operationActive = useRef(false);
  const perform = useCallback(async <T>(label: string, task: () => Promise<T>) => {
    if (operationActive.current) return undefined;
    operationActive.current = true;
    setOperation(label);
    setError(null);
    // The async wrapper routes a synchronous throw from task into the catch.
    return (async () => task())()
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        return undefined;
      })
      .finally(() => {
        operationActive.current = false;
        setOperation(null);
      });
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
        resolvedIn: null,
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
  /** The context menu's measure: the distance tool with this point as its first pick. */
  const measureFrom = useCallback(
    (point: ModelPoint) => {
      choose("measure");
      setPendingPoint(point);
    },
    [choose],
  );
  /** The context menu's pin: a one-point region awaiting its request, like a tool pick. */
  const pinAt = useCallback(
    (point: ModelPoint) => {
      cancel();
      setPendingCamera(viewer.current?.snapshot() ?? null);
      setPendingRegion([point]);
    },
    [cancel, viewer],
  );
  const setMeasureMode = useCallback((mode: "distance" | "hole") => {
    updateMeasureMode(mode);
    setPendingPoint(null);
    setError(null);
  }, []);
  const saveQuietly = workspace.mutate;
  /**
   * Saves a workspace edit and, once saved, records it for undo. Edits sharing a `group` undo as
   * one step.
   */
  const mutate = useCallback(
    async (operation: ModelWorkspaceOperation, options: { group?: string } = {}) => {
      const saved = await saveQuietly(operation);
      if (saved) recordOperation(operation, options.group);
      return saved;
    },
    [saveQuietly, recordOperation],
  );
  /** Changes the section plane and records it; rapid slider changes merge into one step. */
  const editSection = useCallback(
    (next: ModelSection) => {
      recordValue("section", section, next);
      setSection(next);
    },
    [recordValue, section],
  );
  const shownOrientation = useRef(orientation);
  useLayoutEffect(() => {
    shownOrientation.current = orientation;
  });
  /** Apply immediately, then let the persisted workspace stream become authoritative. */
  const saveOrientation = useCallback(
    async (item: ModelOrientation | null, record = true) =>
      (await perform("Saving orientation", async () => {
        if (!workspace.canEdit || !workspace.ready || !viewer.current) return false;
        const value = item && { ...item, quaternion: normalizeQuaternion(item.quaternion) };
        const shown = shownOrientation.current;
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
          if (record) recordValue("orientation", shown, value);
          return true;
        } catch (cause) {
          setOrientationOverride(null);
          viewer.current?.setOrientation(latestStoredOrientation.current?.quaternion ?? null);
          throw cause;
        }
      })) ?? false,
    [perform, workspace.canEdit, workspace.ready, viewer, mutate, recordValue],
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
    const current = viewer.current;
    if (!current) throw new Error("Load the model before capturing it.");
    const position = workspace.data.annotations.findIndex((item) => item.id === annotation.id);
    const number = position < 0 ? workspace.data.annotations.length + 1 : position + 1;
    return captureAnnotation(current, annotation, number, sourceRevision, () =>
      current.setOverlays(measurements, annotations, pendingPoint),
    );
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
        resolvedIn: null,
        camera: pendingCamera ?? viewer.current.snapshot(),
        parameters: session?.applied ?? {},
        referenceImage: null,
      };
      const item = {
        ...annotation,
        referenceImage: await thumbnail(await markedCapture(annotation)),
      };
      const saved = await mutate({ kind: "annotation", item });
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
      await mutate({ kind: "annotation", item: { ...annotation, status: "review" } });
      return true;
    });
  };
  const renderViews = (ids: readonly string[], includeMeasurements: boolean): Promise<Blob> => {
    const current = viewer.current;
    if (!current) throw new Error("Load the model before capturing it.");
    const views = ids.flatMap((id) => workspace.data.views.filter((view) => view.id === id));
    if (!views.length) throw new Error("Save a view before capturing a sheet.");
    current.setOverlays(includeMeasurements ? measurements : [], annotations, null);
    return captureViewSheet(
      current,
      views,
      `${path} · ${sourceRevision.slice(0, 12)}`,
      sourceRevision,
      () => current.setOverlays(measurements, annotations, pendingPoint),
    );
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
  const restorePin = async (item: ModelAnnotation) => {
    const saved = await saveQuietly({ kind: "annotation", item });
    if (saved || !item.referenceImage) return saved;
    // Deleting a pin deletes its reference image, so a pin brought back keeps its request only.
    return saveQuietly({ kind: "annotation", item: { ...item, referenceImage: null } });
  };
  // Undo saves are not awaited, so a quick second undo would otherwise compare against a stream
  // that has not caught up and read the first undo's own write as an edit made elsewhere.
  const pendingUndo = useRef({
    measurements: new Map<string, PendingSave<ModelMeasurement>>(),
    annotations: new Map<string, PendingSave<ModelAnnotation>>(),
  });
  useEffect(() => {
    forgetShown(pendingUndo.current.measurements, workspace.data.measurements, same);
    forgetShown(pendingUndo.current.annotations, workspace.data.annotations, samePin);
  }, [workspace.data.measurements, workspace.data.annotations]);
  /** Restores undone fields where nothing else has changed them since. */
  useLayoutEffect(() => {
    applyUndo.current = (fields, from) => {
      // A half-made measurement would mix points from two states.
      setPendingPoint(null);
      let applied = false;
      const pending = pendingUndo.current;
      if (fields.measurements && from.measurements) {
        const patch = listPatch(
          withPending(workspace.data.measurements, pending.measurements),
          from.measurements,
          fields.measurements,
        );
        for (const item of patch.upserts)
          trackSave(
            pending.measurements,
            item.id,
            item,
            saveQuietly({ kind: "measurement", item }),
          );
        for (const id of patch.removes)
          trackSave(
            pending.measurements,
            id,
            null,
            saveQuietly({ kind: "remove", collection: "measurements", id }),
          );
        applied = applied || patch.upserts.length + patch.removes.length + patch.settled > 0;
      }
      if (fields.annotations && from.annotations) {
        const patch = listPatch(
          withPending(workspace.data.annotations, pending.annotations),
          from.annotations,
          fields.annotations,
          samePin,
        );
        for (const item of patch.upserts)
          trackSave(pending.annotations, item.id, item, restorePin(item));
        for (const id of patch.removes)
          trackSave(
            pending.annotations,
            id,
            null,
            saveQuietly({ kind: "remove", collection: "annotations", id }),
          );
        applied = applied || patch.upserts.length + patch.removes.length + patch.settled > 0;
      }
      if (fields.section) {
        setSection(fields.section);
        applied = true;
      }
      if (
        fields.orientation !== undefined &&
        same(shownOrientation.current, from.orientation ?? null)
      ) {
        void saveOrientation(fields.orientation, false);
        applied = true;
      }
      if (fields.parameters && session && same(session.parameters, from.parameters)) {
        session.restoreParameters(fields.parameters);
        applied = true;
      }
      return applied;
    };
  });
  return {
    ...workspace,
    mutate,
    undo: history,
    editSection,
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
    measureFrom,
    pinAt,
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
