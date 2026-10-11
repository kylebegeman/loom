import { sha256 } from "@noble/hashes/sha2";
import { Vector3 } from "three";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  type AssemblyReadResult,
  type AssemblyPart,
  type ModelFormat,
  type ModelCamera,
  type ModelProjection,
  type ModelPoint,
  type ScaleReference,
} from "@t3tools/contracts/fork";
import { createViewer, type ModelViewer } from "./viewer/createViewer";
import { createAssemblyScene } from "./viewer/assembly";
import { disposeModel, loadModel, meshStats } from "./viewer/load";
import { models, modelUrl, runModelCommand } from "./state";
import type { Plate } from "./buildPlate";
import type { AssemblyWorkspaceControl } from "./AssemblyWorkspace";
import { formatLength, useDisplayUnits } from "./units";
import type { SectionCapState } from "./viewer/sectionCaps";
const failure = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
export type AssemblyPartStats = Readonly<
  Record<string, { triangles: number | null; loading: boolean }>
>;
export function assemblyDisplayVariant(path: string, id: string) {
  const digest = sha256(new TextEncoder().encode(path));
  return `asm-${Array.from(digest.subarray(0, 4), (value) => value.toString(16).padStart(2, "0")).join("")}-${id}`;
}
export function AssemblyCanvas(props: {
  threadRef: ScopedThreadRef;
  snapshot: AssemblyReadResult;
  visible: boolean;
  plate: Plate;
  selectedId: string | null;
  isolatedId: string | null;
  explode: number;
  preview: AssemblyPart | null;
  viewerRef: React.RefObject<ModelViewer | null>;
  onSelect: (id: string | null) => void;
  onErrors: (errors: Readonly<Record<string, string>>) => void;
  onPartStats: (stats: AssemblyPartStats) => void;
  onError: (message: string) => void;
  onSize: (size: readonly [number, number, number]) => void;
  sourceEpochs: Readonly<Record<string, number>>;
  allowLarge: boolean;
  workspace: AssemblyWorkspaceControl;
  display: {
    wireframe: boolean;
    grid: boolean;
    axes: boolean;
    overhangs: boolean;
    projection: ModelProjection;
  };
  navigationMode: "orbit" | "pan";
  reference: ScaleReference;
  onBounds: (bounds: { min: ModelPoint; max: ModelPoint }) => void;
  onPartRevisions: (revisions: Readonly<Record<string, string>>) => void;
  onNavigate: () => void;
  onCamera: (camera: ModelCamera) => void;
  onSectionCapsStatus: (status: SectionCapState) => void;
}) {
  const { viewerRef } = props;
  const units = useDisplayUnits();
  const canTerminal = useAtomValue(
    models.renderModel.permissionAtom(props.threadRef.environmentId),
  );
  const canScad = useAtomValue(models.render.permissionAtom(props.threadRef.environmentId));
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props),
    scene = useRef<ReturnType<typeof createAssemblyScene> | null>(null),
    loaded = useRef(new Map<string, string>()),
    loadedTriangles = useRef(new Map<string, number>()),
    loadedRevisions = useRef(new Map<string, string>()),
    attached = useRef(false),
    first = useRef(true);
  useEffect(() => {
    latest.current = props;
  }, [props]);
  useEffect(() => {
    if (!host.current) return;
    try {
      const viewer = createViewer(host.current);
      viewerRef.current = viewer;
      scene.current = createAssemblyScene();
      viewer.onObjectPick((object) => {
        let node = object;
        while (node) {
          if (typeof node.userData.assemblyPartId === "string") {
            latest.current.onSelect(node.userData.assemblyPartId);
            return;
          }
          node = node.parent;
        }
        latest.current.onSelect(null);
      });
    } catch (cause) {
      latest.current.onError(failure(cause));
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
      viewerRef.current?.dispose();
      viewerRef.current = null;
      loaded.current.clear();
      loadedTriangles.current.clear();
      loadedRevisions.current.clear();
      attached.current = false;
      first.current = true;
    };
  }, [viewerRef]);
  useEffect(() => {
    viewerRef.current?.setVisible(props.visible);
    viewerRef.current?.setBed(
      [props.plate.volume[0], props.plate.volume[1]],
      props.plate.pattern,
      [],
      props.plate.shape,
    );
  }, [viewerRef, props.visible, props.plate]);
  useEffect(() => {
    const current = scene.current;
    if (!current) return;
    const bounds = current.update(props.snapshot.assembly.parts, {
      selectedId: props.selectedId,
      isolatedId: props.isolatedId,
      explode: props.explode,
      preview: props.preview,
    });
    if (bounds) {
      latest.current.onSize(bounds.getSize(new Vector3()).toArray());
      latest.current.onBounds({ min: bounds.min.toArray(), max: bounds.max.toArray() });
    }
    if (attached.current && current.count() > 0) viewerRef.current?.refreshModel();
  }, [
    props.snapshot.assembly.parts,
    props.selectedId,
    props.isolatedId,
    props.explode,
    props.preview,
    viewerRef,
  ]);
  const editing = props.workspace.editing;
  useEffect(() => {
    viewerRef.current?.setLengthFormat((mm) => formatLength(mm, units));
  }, [viewerRef, units]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.setNavigationMode(props.navigationMode);
    viewer.setWireframe(props.display.wireframe);
    viewer.setGrid(props.display.grid);
    viewer.setAxes(props.display.axes);
    viewer.setProjection(props.display.projection);
    viewer.setOverhangs(props.display.overhangs);
    viewer.setReference(props.reference);
  }, [viewerRef, props.navigationMode, props.display, props.reference]);
  useEffect(() => {
    viewerRef.current?.setSection(editing.section);
  }, [viewerRef, editing.section]);
  useEffect(() => {
    viewerRef.current?.setPickMode(
      props.workspace.disabled ? null : editing.picking,
      editing.onPick,
      editing.onCircle,
    );
    return () => viewerRef.current?.setPickMode(null, null);
  }, [viewerRef, props.workspace.disabled, editing.picking, editing.onPick, editing.onCircle]);
  useEffect(() => {
    viewerRef.current?.setMeasureMode(editing.measureMode);
  }, [viewerRef, editing.measureMode]);
  useEffect(() => {
    const viewer = viewerRef.current;
    viewer?.onCameraChange(props.onCamera);
    viewer?.onNavigate(props.onNavigate);
    viewer?.onSectionCapsStatus(props.onSectionCapsStatus);
    viewer?.onWallMeasure(props.workspace.disabled ? null : editing.onWall);
    return () => {
      viewer?.onCameraChange(null);
      viewer?.onNavigate(null);
      viewer?.onSectionCapsStatus(null);
      viewer?.onWallMeasure(null);
    };
  }, [
    viewerRef,
    props.onCamera,
    props.onNavigate,
    props.onSectionCapsStatus,
    props.workspace.disabled,
    editing.onWall,
  ]);
  useEffect(() => {
    const current = scene.current,
      viewer = viewerRef.current;
    if (!current || !viewer || !props.visible) return;
    const abort = new AbortController(),
      snapshot = props.snapshot,
      errors: Record<string, string> = {},
      stats: Record<string, { triangles: number | null; loading: boolean }> = {},
      rendering = new Map<string, { path: string; variantId: string }>();
    const wanted = new Set(snapshot.assembly.parts.map((part) => part.id));
    for (const id of loaded.current.keys())
      if (!wanted.has(id)) {
        current.remove(id);
        loaded.current.delete(id);
        loadedTriangles.current.delete(id);
        loadedRevisions.current.delete(id);
      }
    let index = 0;
    const sync = () => {
      if (abort.signal.aborted || !scene.current) return;
      const options = latest.current;
      const bounds = current.update(options.snapshot.assembly.parts, {
        selectedId: options.selectedId,
        isolatedId: options.isolatedId,
        explode: options.explode,
        preview: options.preview,
      });
      if (bounds) {
        options.onSize(bounds.getSize(new Vector3()).toArray());
        options.onBounds({ min: bounds.min.toArray(), max: bounds.max.toArray() });
      }
      if (current.count() > 0) {
        if (!attached.current) {
          viewer.setModel(current.object, false);
          attached.current = true;
        } else viewer.refreshModel();
        if (first.current) {
          viewer.fit();
          first.current = false;
        }
      }
      options.onErrors({ ...errors });
      options.onPartStats({ ...stats });
      options.onPartRevisions(Object.fromEntries(loadedRevisions.current));
    };
    const load = async (part: AssemblyPart) => {
      const info = snapshot.parts.find((p) => p.id === part.id),
        signature = JSON.stringify([
          part.path,
          part.parameters,
          part.parameterSet,
          info?.revision,
          props.sourceEpochs[info?.path ?? part.path] ?? 0,
          props.allowLarge,
        ]);
      if (info?.error || !info?.path || !info.format) {
        current.remove(part.id);
        loaded.current.delete(part.id);
        loadedTriangles.current.delete(part.id);
        loadedRevisions.current.delete(part.id);
        errors[part.id] = info?.error ?? "This part is unavailable.";
        stats[part.id] = { triangles: null, loading: false };
        sync();
        return;
      }
      if (loaded.current.get(part.id) === signature) {
        stats[part.id] = {
          triangles: loadedTriangles.current.get(part.id) ?? null,
          loading: false,
        };
        sync();
        return;
      }
      stats[part.id] = { triangles: null, loading: true };
      sync();
      try {
        const file = { threadId: props.threadRef.threadId, path: info.path };
        let url: string,
          geometryRevision: string,
          format: ModelFormat = info.format;
        if (format === "scad" || format === "build123d" || format === "step") {
          if (format !== "build123d" && !canScad)
            throw new Error("This connection does not permit rendering this part.");
          if (format === "build123d" && !canTerminal)
            throw new Error("This connection does not permit running Python CAD.");
          const variantId = await assemblyDisplayVariant(snapshot.path, part.id);
          if (abort.signal.aborted) return;
          rendering.set(part.id, { path: file.path, variantId });
          const rendered = await runModelCommand(
            format === "build123d" ? models.renderModel : models.render,
            {
              environmentId: props.threadRef.environmentId,
              input: {
                file,
                overrides: part.parameters,
                parameterSet: part.parameterSet,
                variantId,
              },
            },
          );
          rendering.delete(part.id);
          if (rendered.status !== "ok" || !rendered.mesh || !rendered.meshFormat)
            throw new Error(
              rendered.log.find((entry) => entry.level === "error")?.text ??
                "Could not render this part.",
            );
          url = modelUrl(props.threadRef.environmentId, rendered.mesh.relativeUrl);
          format = rendered.meshFormat;
          geometryRevision = rendered.mesh.revision;
        } else {
          const signed = await runModelCommand(models.fileUrl, {
            environmentId: props.threadRef.environmentId,
            input: { ...file, allowLarge: props.allowLarge },
          });
          url = modelUrl(props.threadRef.environmentId, signed.relativeUrl);
          geometryRevision = signed.revision;
        }
        if (abort.signal.aborted) return;
        const model = await loadModel(url, format, abort.signal, () => {});
        if (abort.signal.aborted) {
          disposeModel(model);
          return;
        }
        const triangles = meshStats(model).triangles;
        current.set(part.id, model, props.allowLarge);
        loadedTriangles.current.set(part.id, triangles);
        loaded.current.set(part.id, signature);
        loadedRevisions.current.set(part.id, geometryRevision);
        stats[part.id] = { triangles, loading: false };
        delete errors[part.id];
        sync();
      } catch (cause) {
        if (!abort.signal.aborted) {
          errors[part.id] = failure(cause);
          stats[part.id] = { triangles: null, loading: false };
          sync();
        }
      }
    };
    const worker = async () => {
      while (index < snapshot.assembly.parts.length && !abort.signal.aborted) {
        const part = snapshot.assembly.parts[index++]!;
        await load(part);
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, snapshot.assembly.parts.length) }, worker));
    return () => {
      abort.abort();
      for (const { path, variantId } of rendering.values())
        void runModelCommand(models.cancelVariant, {
          environmentId: props.threadRef.environmentId,
          input: { file: { threadId: props.threadRef.threadId, path }, variantId },
        }).catch(() => {});
    };
  }, [
    props.snapshot,
    canTerminal,
    canScad,
    props.sourceEpochs,
    props.allowLarge,
    props.visible,
    props.threadRef.environmentId,
    props.threadRef.threadId,
    viewerRef,
  ]);
  return (
    <div
      ref={host}
      className="h-full min-h-64 w-full"
      aria-label={`${props.snapshot.assembly.name} assembly viewport`}
    />
  );
}
