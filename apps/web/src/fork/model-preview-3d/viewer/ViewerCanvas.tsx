import type {
  ModelCamera,
  ScaleReference,
  ModelProjection,
  ModelPoint,
  ModelSection,
  ModelMeasurement,
  ModelAnnotation,
  ModelOrientation,
  PrintFinding,
} from "@t3tools/contracts/fork";
import { useEffect, useRef, useId } from "react";
import { singleZoneStrips, type ModelFormat } from "@t3tools/contracts/fork";
import { formatLength, useDisplayPrecision, useDisplayUnits } from "../units";
import type { Plate } from "../buildPlate";
import { createViewer, type ModelViewer, type NavigationMode } from "./createViewer";
import { disposeModel, loadModel, type meshStats } from "./load";
import type { CircleFit } from "./snap";
import type { ContextPick, SnapStatus } from "./createViewer";
import type { LayerData } from "./layers";
import type { Object3D } from "three";
import type { SectionCapState } from "./sectionCaps";
const EMPTY_MEASUREMENTS: readonly ModelMeasurement[] = [];
const EMPTY_ANNOTATIONS: readonly ModelAnnotation[] = [];
const EMPTY_FINDINGS: readonly PrintFinding[] = [];
export default function ViewerCanvas({
  label = "3D model",
  url,
  format,
  plate,
  visible,
  viewerRef,
  savedViewRef,
  onStats,
  onError,
  onProgress,
  navigationMode,
  display,
  onNavigate,
  section,
  measurements = EMPTY_MEASUREMENTS,
  annotations = EMPTY_ANNOTATIONS,
  pendingPoint = null,
  pickMode = null,
  onPick,
  measureMode = "distance",
  onCircle,
  onSnapStatus,
  onCamera,
  camera,
  reference = "none",
  overhangAngleDegrees = 45,
  keepPrevious = false,
  previousShown = false,
  sourceRevision,
  orientation = null,
  onOriented,
  closedHint = null,
  onSectionCapsStatus,
  onWall,
  findings = EMPTY_FINDINGS,
  selectedFindingId = null,
  onFinding,
  compareModel = null,
  layers = null,
  layer = 0,
  extents = false,
  onContextPick,
}: {
  /** A still right click, Control+click or held touch on the part. */
  onContextPick?: (pick: ContextPick) => void;
  /** Overall X, Y and Z dimensions of the posed part. Session only. */
  extents?: boolean;
  compareModel?: Object3D | null;
  layers?: LayerData | null;
  layer?: number;
  section?: ModelSection;
  measurements?: readonly ModelMeasurement[];
  annotations?: readonly ModelAnnotation[];
  pendingPoint?: ModelPoint | null;
  pickMode?: "measure" | "annotate" | "lay-flat" | null;
  onPick?: (points: ModelPoint[]) => void;
  measureMode?: "distance" | "hole";
  onCircle?: (circle: CircleFit | null) => void;
  onSnapStatus?: (status: SnapStatus) => void;
  onCamera?: (camera: ModelCamera) => void;
  camera?: ModelCamera | null;
  reference?: ScaleReference;
  overhangAngleDegrees?: number;
  keepPrevious?: boolean;
  previousShown?: boolean;
  sourceRevision?: string;
  orientation?: ModelOrientation | null;
  onOriented?: (stats: ReturnType<typeof meshStats>) => void;
  closedHint?: boolean | null;
  onSectionCapsStatus?: (status: SectionCapState) => void;
  onWall?: (start: ModelPoint, end: ModelPoint) => void;
  findings?: readonly PrintFinding[];
  selectedFindingId?: string | null;
  onFinding?: (finding: PrintFinding) => void;
  label?: string;
  url: string;
  format: ModelFormat;
  plate: Plate;
  visible: boolean;
  viewerRef: React.RefObject<ModelViewer | null>;
  savedViewRef: React.RefObject<ReturnType<ModelViewer["snapshot"]> | null>;
  onStats: (stats: ReturnType<typeof meshStats>) => void;
  onError: (message: string) => void;
  onProgress: (message: string | null) => void;
  navigationMode?: NavigationMode;
  display?: {
    wireframe: boolean;
    grid: boolean;
    axes: boolean;
    projection: ModelProjection;
    overhangs: boolean;
  };
  onNavigate?: () => void;
}) {
  const units = useDisplayUnits();
  const precision = useDisplayPrecision();
  const descriptionId = useId();
  const host = useRef<HTMLDivElement>(null),
    loaded = useRef(false),
    loadedRevision = useRef<string | undefined>(undefined);
  const options = useRef({
    navigationMode,
    display,
    section,
    measurements,
    annotations,
    pendingPoint,
    camera,
    reference,
    units,
    precision,
    overhangAngleDegrees,
    keepPrevious,
    previousShown,
    orientation,
    closedHint,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest viewer options in a ref so model loads apply current settings
  useEffect(() => {
    options.current = {
      navigationMode,
      display,
      section,
      measurements,
      annotations,
      pendingPoint,
      camera,
      reference,
      units,
      precision,
      overhangAngleDegrees,
      keepPrevious,
      previousShown,
      orientation,
      closedHint,
    };
  }, [
    navigationMode,
    display,
    section,
    measurements,
    annotations,
    pendingPoint,
    camera,
    reference,
    units,
    precision,
    overhangAngleDegrees,
    keepPrevious,
    previousShown,
    orientation,
    closedHint,
  ]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- creates the imperative webgl viewer on the host element and disposes it on unmount
  useEffect(() => {
    if (!host.current) return;
    try {
      viewerRef.current = createViewer(host.current);
    } catch (error) {
      onError(
        error instanceof Error && !error.message.includes("WebGL")
          ? error.message
          : "WebGL 2 is unavailable. Use a browser or device that supports it.",
      );
    }
    return () => {
      // Setup can be replayed before a mesh loads, including in React StrictMode.
      if (loaded.current && viewerRef.current) savedViewRef.current = viewerRef.current.snapshot();
      viewerRef.current?.dispose();
      viewerRef.current = null;
      loaded.current = false;
      loadedRevision.current = undefined;
    };
  }, [viewerRef, savedViewRef, onError]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the label and description into the imperative viewer
  useEffect(() => {
    viewerRef.current?.describe(label, descriptionId);
  }, [viewerRef, label, descriptionId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the keep previous setting into the imperative viewer
  useEffect(() => {
    viewerRef.current?.keepPrevious(keepPrevious);
  }, [keepPrevious, viewerRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes previous model visibility into the imperative viewer
  useEffect(() => {
    viewerRef.current?.showPrevious(previousShown);
  }, [previousShown, viewerRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the print bed into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setBed(
      [plate.volume[0], plate.volume[1]],
      plate.pattern,
      plate.showZones ? singleZoneStrips(plate.zones) : [],
      plate.shape,
    );
  }, [plate, viewerRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the comparison model into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setCompareModel(compareModel);
  }, [compareModel, viewerRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes slicing layers into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setLayers(layers);
  }, [layers, viewerRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the visible layer range into the imperative viewer
  useEffect(() => {
    viewerRef.current?.showLayersThrough(layer);
  }, [layer, viewerRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the overhang angle into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setOverhangAngle(overhangAngleDegrees);
  }, [overhangAngleDegrees, viewerRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the reference into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setReference(reference);
  }, [reference, viewerRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the length format into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setLengthFormat((mm) => formatLength(mm, units, { digits: 2, precision }));
  }, [units, precision, viewerRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes visibility into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setVisible(visible);
  }, [visible, viewerRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- downloads the model, loads it into the imperative viewer and aborts the download on change or unmount
  useEffect(() => {
    if (!viewerRef.current) return;
    const abort = new AbortController();
    onProgress("Downloading model...");
    void loadModel(url, format, abort.signal, (bytes, total) =>
      onProgress(
        bytes === total
          ? "Preparing mesh..."
          : `Downloading ${Math.round(bytes / 1024 / 1024)} MB${total ? ` of ${Math.round(total / 1024 / 1024)} MB` : ""}...`,
      ),
    )
      .then((model) => {
        if (abort.signal.aborted || !viewerRef.current) {
          disposeModel(model);
          return;
        }
        viewerRef.current.keepPrevious(options.current.keepPrevious);
        viewerRef.current.showPrevious(options.current.previousShown);
        viewerRef.current.setOrientation(options.current.orientation?.quaternion ?? null);
        viewerRef.current.setClosedHint(options.current.closedHint);
        const stats = viewerRef.current.setModel(
          model,
          loaded.current || savedViewRef.current !== null,
        );
        if (
          loaded.current &&
          sourceRevision !== undefined &&
          loadedRevision.current === sourceRevision
        )
          viewerRef.current.clearPrevious();
        loadedRevision.current = sourceRevision;
        onStats(stats);
        onOriented?.(stats);
        if (!loaded.current && savedViewRef.current)
          viewerRef.current.restore(savedViewRef.current);
        if (options.current.navigationMode)
          viewerRef.current.setNavigationMode(options.current.navigationMode);
        if (options.current.display) {
          viewerRef.current.setWireframe(options.current.display.wireframe);
          viewerRef.current.setGrid(options.current.display.grid);
          viewerRef.current.setAxes(options.current.display.axes);
          viewerRef.current.setProjection(options.current.display.projection);
          viewerRef.current.setOverhangs(options.current.display.overhangs);
        }
        viewerRef.current.setOverhangAngle(options.current.overhangAngleDegrees);
        viewerRef.current.setReference(options.current.reference);
        viewerRef.current.setLengthFormat((mm) =>
          formatLength(mm, options.current.units, {
            digits: 2,
            precision: options.current.precision,
          }),
        );
        if (options.current.section) viewerRef.current.setSection(options.current.section);
        if (options.current.camera) viewerRef.current.restore(options.current.camera);
        viewerRef.current.setOverlays(
          options.current.measurements,
          options.current.annotations,
          options.current.pendingPoint,
        );
        loaded.current = true;
        onProgress(null);
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          onProgress(null);
          onError(
            error instanceof Error
              ? error.message.includes("DRACOLoader")
                ? "Draco-compressed glTF is not supported. Export an uncompressed model."
                : error.message
              : "Could not load the model.",
          );
        }
      });
    return () => abort.abort();
  }, [
    url,
    format,
    sourceRevision,
    viewerRef,
    savedViewRef,
    onStats,
    onOriented,
    onError,
    onProgress,
  ]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the orientation into the imperative viewer and reports the oriented stats
  useEffect(() => {
    const stats = viewerRef.current?.setOrientation(orientation?.quaternion ?? null);
    if (loaded.current && stats) onOriented?.(stats);
  }, [viewerRef, orientation, onOriented]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the closed hint into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setClosedHint(closedHint);
  }, [viewerRef, closedHint]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the section caps status listener on the imperative viewer and removes it on cleanup
  useEffect(() => {
    viewerRef.current?.onSectionCapsStatus(onSectionCapsStatus ?? null);
    return () => viewerRef.current?.onSectionCapsStatus(null);
  }, [viewerRef, onSectionCapsStatus]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the wall measure listener on the imperative viewer and removes it on cleanup
  useEffect(() => {
    viewerRef.current?.onWallMeasure(onWall ?? null);
    return () => viewerRef.current?.onWallMeasure(null);
  }, [viewerRef, onWall]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes findings and the selected finding into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setFindings(findings, selectedFindingId, onFinding ?? null);
  }, [viewerRef, findings, selectedFindingId, onFinding]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the navigate listener on the imperative viewer and removes it on cleanup
  useEffect(() => {
    viewerRef.current?.onNavigate(onNavigate ?? null);
    return () => viewerRef.current?.onNavigate(null);
  }, [viewerRef, onNavigate]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the navigation mode into the imperative viewer
  useEffect(() => {
    if (navigationMode) viewerRef.current?.setNavigationMode(navigationMode);
  }, [viewerRef, navigationMode]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes display settings into the imperative viewer
  useEffect(() => {
    if (!display) return;
    viewerRef.current?.setWireframe(display.wireframe);
    viewerRef.current?.setGrid(display.grid);
    viewerRef.current?.setAxes(display.axes);
    viewerRef.current?.setProjection(display.projection);
    viewerRef.current?.setOverhangs(display.overhangs);
  }, [viewerRef, display]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the section into the imperative viewer
  useEffect(() => {
    if (section) viewerRef.current?.setSection(section);
  }, [viewerRef, section]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes extents into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setExtents(extents);
  }, [viewerRef, extents]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the context pick listener on the imperative viewer and removes it on cleanup
  useEffect(() => {
    viewerRef.current?.onContextPick(onContextPick ?? null);
    return () => viewerRef.current?.onContextPick(null);
  }, [viewerRef, onContextPick]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes measurement and annotation overlays into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setOverlays(measurements, annotations, pendingPoint);
  }, [viewerRef, measurements, annotations, pendingPoint]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sets the pick mode and handlers on the imperative viewer and clears them on cleanup
  useEffect(() => {
    viewerRef.current?.setPickMode(pickMode, onPick ?? null, onCircle ?? null);
    return () => viewerRef.current?.setPickMode(null, null);
  }, [viewerRef, pickMode, onPick, onCircle]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes the measure mode into the imperative viewer
  useEffect(() => {
    viewerRef.current?.setMeasureMode(measureMode);
  }, [viewerRef, measureMode]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the snap status listener on the imperative viewer and removes it on cleanup
  useEffect(() => {
    viewerRef.current?.onSnapStatus(onSnapStatus ?? null);
    return () => viewerRef.current?.onSnapStatus(null);
  }, [viewerRef, onSnapStatus]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the camera change listener on the imperative viewer and removes it on cleanup
  useEffect(() => {
    viewerRef.current?.onCameraChange(onCamera ?? null);
    return () => viewerRef.current?.onCameraChange(null);
  }, [viewerRef, onCamera]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores the requested camera in the imperative viewer
  useEffect(() => {
    if (camera) viewerRef.current?.restore(camera);
  }, [viewerRef, camera]);
  return (
    <>
      <span id={descriptionId} className="sr-only">
        Arrow keys orbit. Shift and arrow keys pan. Plus and minus zoom. F fits the model. 1 to 4
        choose a standard view. Drag to orbit, right or middle drag to pan, scroll to zoom.
      </span>
      <div ref={host} className="h-full min-h-64 w-full" />
    </>
  );
}
