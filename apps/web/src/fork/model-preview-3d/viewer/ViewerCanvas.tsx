import type {
  ModelCamera,
  ModelPoint,
  ModelSection,
  ModelMeasurement,
  ModelAnnotation,
} from "@t3tools/contracts/fork";
import { useEffect, useRef } from "react";
import type { ModelFormat } from "@t3tools/contracts/fork";
import { createViewer, type ModelViewer, type NavigationMode } from "./createViewer";
import { disposeModel, loadModel, type meshStats } from "./load";
const EMPTY_MEASUREMENTS: readonly ModelMeasurement[] = [];
const EMPTY_ANNOTATIONS: readonly ModelAnnotation[] = [];
export default function ViewerCanvas({
  url,
  format,
  volume,
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
  onCamera,
  camera,
}: {
  section?: ModelSection;
  measurements?: readonly ModelMeasurement[];
  annotations?: readonly ModelAnnotation[];
  pendingPoint?: ModelPoint | null;
  pickMode?: "measure" | "annotate" | null;
  onPick?: (points: ModelPoint[]) => void;
  onCamera?: (camera: ModelCamera) => void;
  camera?: ModelCamera | null;
  url: string;
  format: ModelFormat;
  volume: readonly [number, number, number];
  visible: boolean;
  viewerRef: React.RefObject<ModelViewer | null>;
  savedViewRef: React.RefObject<ReturnType<ModelViewer["snapshot"]> | null>;
  onStats: (stats: ReturnType<typeof meshStats>) => void;
  onError: (message: string) => void;
  onProgress: (message: string | null) => void;
  navigationMode?: NavigationMode;
  display?: { wireframe: boolean; grid: boolean; axes: boolean };
  onNavigate?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    loaded = useRef(false);
  const options = useRef({
    navigationMode,
    display,
    section,
    measurements,
    annotations,
    pendingPoint,
    camera,
  });
  useEffect(() => {
    options.current = {
      navigationMode,
      display,
      section,
      measurements,
      annotations,
      pendingPoint,
      camera,
    };
  }, [navigationMode, display, section, measurements, annotations, pendingPoint, camera]);
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
    };
  }, [viewerRef, savedViewRef, onError]);
  useEffect(() => {
    viewerRef.current?.setBuildVolume(volume);
  }, [volume, viewerRef]);
  useEffect(() => {
    viewerRef.current?.setVisible(visible);
  }, [visible, viewerRef]);
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
        onStats(viewerRef.current.setModel(model, loaded.current || savedViewRef.current !== null));
        if (!loaded.current && savedViewRef.current)
          viewerRef.current.restore(savedViewRef.current);
        if (options.current.navigationMode)
          viewerRef.current.setNavigationMode(options.current.navigationMode);
        if (options.current.display) {
          viewerRef.current.setWireframe(options.current.display.wireframe);
          viewerRef.current.setGrid(options.current.display.grid);
          viewerRef.current.setAxes(options.current.display.axes);
        }
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
  }, [url, format, viewerRef, savedViewRef, onStats, onError, onProgress]);
  useEffect(() => {
    viewerRef.current?.onNavigate(onNavigate ?? null);
    return () => viewerRef.current?.onNavigate(null);
  }, [viewerRef, onNavigate]);
  useEffect(() => {
    if (navigationMode) viewerRef.current?.setNavigationMode(navigationMode);
  }, [viewerRef, navigationMode]);
  useEffect(() => {
    if (!display) return;
    viewerRef.current?.setWireframe(display.wireframe);
    viewerRef.current?.setGrid(display.grid);
    viewerRef.current?.setAxes(display.axes);
  }, [viewerRef, display]);
  useEffect(() => {
    if (section) viewerRef.current?.setSection(section);
  }, [viewerRef, section]);
  useEffect(() => {
    viewerRef.current?.setOverlays(measurements, annotations, pendingPoint);
  }, [viewerRef, measurements, annotations, pendingPoint]);
  useEffect(() => {
    viewerRef.current?.setPickMode(pickMode, onPick ?? null);
    return () => viewerRef.current?.setPickMode(null, null);
  }, [viewerRef, pickMode, onPick]);
  useEffect(() => {
    viewerRef.current?.onCameraChange(onCamera ?? null);
    return () => viewerRef.current?.onCameraChange(null);
  }, [viewerRef, onCamera]);
  useEffect(() => {
    if (camera) viewerRef.current?.restore(camera);
  }, [viewerRef, camera]);
  return <div ref={host} className="h-full min-h-64 w-full" />;
}
