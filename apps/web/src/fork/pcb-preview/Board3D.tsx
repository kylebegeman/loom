import {
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import type { CheckpointId, ScopedThreadRef } from "@t3tools/contracts";
import { Box3, Vector3, Raycaster, type Object3D } from "three";
import type {
  PcbInspection,
  PcbPoint,
  ModelPoint,
  Pcb3dMeasurement,
  Pcb3dLayers,
} from "@t3tools/contracts/fork";
import {
  classifyBoard,
  availableLayers,
  defaultBoardDisplay,
  type BoardParts,
  type Board3dDisplay,
  type Board3dLayer,
} from "./board3dParts";
import { partHeights, heightAt, heightOfPart, boardFrame } from "./heights";
import { Board3DTools, type Board3dTool } from "./Board3DTools";
import { SectionStrip } from "../model-preview-3d/WorkspaceTools";
import { shownIn } from "../model-preview-3d/viewer/createViewer";
import { ShortcutHelp, SHORTCUTS_3D } from "./WorkspaceChrome";
import { useLengthUnit } from "./preferences";
import { formatLength } from "./length";
import { modelUrl } from "../model-preview-3d/state";
import { pcb } from "./state";
import { asyncValue, asyncError } from "./usePcbPreview";
import { createViewer, type ModelViewer } from "../model-preview-3d/viewer/createViewer";
import { loadModel, disposeModel } from "../model-preview-3d/viewer/load";
import type { View } from "../model-preview-3d/viewer/views";
import { VIEW_LABELS } from "../model-preview-3d/WorkspaceTools";
import {
  BoxIcon,
  ChevronDownIcon,
  MinusIcon,
  PlusIcon,
  ScanIcon,
  ScrollTextIcon,
} from "lucide-react";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { ToolButton } from "./ToolButton";
import { OperationStatus } from "./OperationStatus";
import styles from "./workspace.module.css";
const applyDisplay = (created: ModelViewer, parts: BoardParts, next: Board3dDisplay) => {
  created.setProjection(next.projection);
  created.setSection(next.section);
  for (const [layer, nodes] of Object.entries(parts.groups))
    for (const node of nodes) node.visible = !next.hidden.has(layer as Board3dLayer);
  created.invalidate();
};

export type Pcb3dHandle = Pick<ModelViewer, "fit" | "zoom" | "setView" | "snapshot" | "restore"> & {
  refresh: () => void;
  capture: () => Promise<Blob>;
  isReady: () => boolean;
  isLoading: () => boolean;
  state: () => {
    tool3d: Board3dTool;
    layers3d: Pcb3dLayers;
    measurements3d: readonly Pcb3dMeasurement[];
    heights: ReturnType<typeof partHeights>;
    sectionCaps: ReturnType<ModelViewer["sectionCapsStatus"]>;
    snap3d: ReturnType<ModelViewer["snapStatus"]>;
  };
  chooseTool: (tool: Board3dTool) => void;
  clearMeasurements: () => void;
  measure: (points: readonly ModelPoint[], snap?: boolean) => Promise<Pcb3dMeasurement>;
  height: (input: {
    reference?: string | undefined;
    point?: PcbPoint | undefined;
    points?: readonly ModelPoint[] | undefined;
    side?: "front" | "back" | undefined;
  }) => Pcb3dMeasurement;
  displayLayers: (patch: Partial<Record<Board3dLayer, boolean | undefined>>) => void;
};
export function Board3D({
  threadRef,
  designId,
  sourceHash,
  checkpointId,
  handle,
  onCancel,
  onBuilt,
  children,
  display = defaultBoardDisplay(),
  onDisplay,
  inspection,
  onSelect,
  readOnly = false,
}: {
  display?: Board3dDisplay;
  onDisplay?: (display: Board3dDisplay) => void;
  inspection?: PcbInspection | null;
  onSelect?: (reference: string | null) => void;
  readOnly?: boolean;
  threadRef: ScopedThreadRef;
  designId: string;
  sourceHash: string | null;
  checkpointId?: CheckpointId | undefined;
  handle: React.Ref<Pcb3dHandle>;
  onCancel: () => void;
  /** The host has cached this revision, so Inspect can read component heights. */
  onBuilt?: (sourceHash: string) => void;
  /** Workspace status cards that share the 3D overlay stack. */
  children?: React.ReactNode;
}) {
  const unit = useLengthUnit();
  const [tool, setTool] = useState<Board3dTool>("none"),
    [measurements, setMeasurements] = useState<readonly Pcb3dMeasurement[]>([]),
    [pending, setPending] = useState<{
      point: ModelPoint;
      snap: NonNullable<Pcb3dMeasurement["snaps"]>[0];
    } | null>(null),
    [geometry, setGeometry] = useState<{ parts: BoardParts; box: Box3 } | null>(null),
    [snap, setSnap] = useState<ReturnType<ModelViewer["snapStatus"]>>("idle"),
    [caps, setCaps] = useState<ReturnType<ModelViewer["sectionCapsStatus"]>>("none");
  const loadedModel = useRef<Object3D | null>(null);
  const inputs = useEffectEvent(() => ({ display, inspection, onSelect, readOnly }));
  const heights = useMemo(() => (geometry ? partHeights(geometry.parts) : null), [geometry]);
  const append = useCallback((measurement: Pcb3dMeasurement) => {
    setMeasurements((current) => [...current, measurement].slice(-20));
    return measurement;
  }, []);
  const chooseTool = (next: Board3dTool) => {
    if (readOnly && next !== "none") throw new Error("These tools work on the current version.");
    if (next === "height" && !heights)
      throw new Error("Heights need the board body in the 3D export.");
    setTool(next);
    setPending(null);
  };
  const [retry, setRetry] = useState(0);
  const result = useAtomValue(
    pcb.asset.resultAtom({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        designId,
        checkpointId,
        format: "glb",
        transport: "url",
        force: retry > 0,
        revision: `${checkpointId ?? sourceHash ?? "initial"}:${retry}`,
      },
    }),
  );
  const asset = asyncValue(result),
    host = useRef<HTMLDivElement>(null),
    viewer = useRef<ModelViewer | null>(null);
  const notified = useRef<typeof asset>(null);
  const notifyBuilt = useEffectEvent((hash: string) => onBuilt?.(hash));
  useEffect(() => {
    if (!asset?.file || result.waiting || notified.current === asset) return;
    notified.current = asset;
    notifyBuilt(asset.sourceHash);
  }, [asset, result.waiting]);
  const [loaded, setLoaded] = useState<typeof asset>(null);
  const [failure, setFailure] = useState<{ asset: typeof asset; message: string } | null>(null),
    [camera, setCamera] = useState<View | null>("iso");
  const error = failure?.asset === asset ? failure.message : null;
  const retainedCamera = useRef<ReturnType<ModelViewer["snapshot"]> | null>(null);
  const clear = useCallback(() => {
    if (viewer.current) retainedCamera.current = viewer.current.snapshot();
    viewer.current?.dispose();
    viewer.current = null;
    loadedModel.current = null;
  }, []);
  useEffect(() => {
    if (!host.current || !asset) return;
    const abort = new AbortController();
    void Promise.resolve()
      .then(async () => {
        if (abort.signal.aborted || !host.current) return;
        if (!asset.file)
          throw new Error(
            "The board exporter did not return a model file. Update the Loom server.",
          );
        const modelSource = modelUrl(threadRef.environmentId, asset.file.relativeUrl);
        const previousCamera = retainedCamera.current;
        const created = createViewer(host.current);
        viewer.current = created;
        created.setGrid(false);
        created.setAxes(false);
        created.onNavigate(() => setCamera(null));
        const model = await loadModel(modelSource, "glb", abort.signal, () => undefined);
        if (abort.signal.aborted || viewer.current !== created) {
          disposeModel(model);
          return;
        }
        created.setModel(model, false);
        loadedModel.current = model;
        const parts = classifyBoard(
          model,
          new Set(inputs().inspection?.components.map((part) => part.reference) ?? []),
        );
        setGeometry({ parts, box: new Box3().setFromObject(model, true) });
        setMeasurements([]);
        setPending(null);
        setTool("none");
        created.onSnapStatus(setSnap);
        created.onSectionCapsStatus(setCaps);
        created.onObjectPick((object) => {
          if (!object || inputs().readOnly) return;
          const part = parts.components.find((part) => {
            for (let node: Object3D | null = object; node; node = node.parent)
              if (node === part.node) return true;
            return false;
          });
          if (part?.reference) inputs().onSelect?.(part.reference);
        });
        if (previousCamera) created.restore(previousCamera);
        applyDisplay(created, parts, inputs().display);
        setLoaded(asset);
        setFailure(null);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) {
          clear();
          setFailure({
            asset,
            message: cause instanceof Error ? cause.message : "The 3D board could not load.",
          });
        }
      });
    return () => {
      abort.abort();
      clear();
    };
  }, [asset, clear, threadRef.environmentId]);
  const loading =
    result.waiting || result._tag === "Initial" || (!!asset && loaded !== asset && !error);
  const ready = !!asset && loaded === asset && !loading && !error && !asyncError(result);
  useEffect(() => {
    if (ready) viewer.current?.setLengthFormat((mm) => formatLength(mm, unit));
  }, [ready, unit]);
  useEffect(() => {
    if (ready && viewer.current && geometry) applyDisplay(viewer.current, geometry.parts, display);
  }, [display, ready, geometry]);
  useEffect(() => {
    if (!ready || !viewer.current) return;
    const created = viewer.current;
    created.setPickMode(tool === "none" || readOnly ? null : "measure", (points, kind = "free") => {
      const point = points[0];
      if (!point) return;
      if (tool === "height") {
        const measurement = geometry && heightAt(geometry.parts, point);
        if (measurement) append(measurement);
      } else if (pending) {
        append({
          kind: "distance",
          start: pending.point,
          end: point,
          lengthMm: new Vector3(...pending.point).distanceTo(new Vector3(...point)),
          snaps: [pending.snap, kind],
        });
        setPending(null);
      } else setPending({ point, snap: kind });
    });
    return () => created.setPickMode(null, null);
  }, [ready, tool, pending, geometry, readOnly, append]);
  useEffect(() => {
    if (!ready || !viewer.current) return;
    viewer.current.setOverlays(
      measurements.map((measurement, index) => ({
        id: String(index),
        name: measurement.kind === "height" ? "Height" : "Distance",
        sourceRevision: asset?.sourceHash ?? "",
        kind: "distance",
        start: measurement.start,
        end: measurement.end,
        visible: true,
      })),
      [],
      pending?.point ?? null,
    );
  }, [measurements, pending, ready, asset]);
  const height = (input: {
    reference?: string | undefined;
    point?: PcbPoint | undefined;
    points?: readonly ModelPoint[] | undefined;
    side?: "front" | "back" | undefined;
  }) => {
    if (!ready || !geometry || !loadedModel.current)
      throw new Error("Open a loaded 3D board for this action.");
    if (readOnly) throw new Error("These tools work on the current version.");
    let measurement = input.reference
      ? heightOfPart(geometry.parts, input.reference)
      : input.points?.[0]
        ? heightAt(geometry.parts, input.points[0])
        : null;
    if (input.point && inspection) {
      const frame = boardFrame(geometry.parts, inspection);
      if (!frame) throw new Error("Could not map board coordinates into this 3D export.");
      const [x, y] = frame.toModel(input.point),
        back = input.side === "back",
        box = geometry.box;
      const ray = new Raycaster(
        new Vector3(x, y, back ? box.min.z - 1 : box.max.z + 1),
        new Vector3(0, 0, back ? 1 : -1),
      );
      const hit = ray
        .intersectObject(loadedModel.current, true)
        .find(
          (hit) =>
            shownIn(hit.object, loadedModel.current) &&
            (!display.section.enabled ||
              (display.section.flipped ? -1 : 1) *
                (hit.point[display.section.axis] - display.section.offset) >=
                0),
        );
      if (hit) measurement = heightAt(geometry.parts, hit.point.toArray());
    }
    if (!measurement)
      throw new Error(
        input.reference
          ? "No component model with that reference."
          : "Provide a point on visible geometry or a component reference. Heights need the board body in the export.",
      );
    if (measurement.reference) onSelect?.(measurement.reference);
    return append(measurement);
  };
  useImperativeHandle(handle, () => {
    const get = () => {
      if (!viewer.current || !ready) throw new Error("Wait for the 3D board to load.");
      return viewer.current;
    };
    return {
      refresh: () => {
        setFailure(null);
        setRetry((n) => n + 1);
      },
      isReady: () => ready,
      isLoading: () => loading,
      state: () => {
        const available = geometry && availableLayers(geometry.parts);
        return {
          tool3d: tool,
          measurements3d: measurements,
          heights,
          sectionCaps: caps,
          snap3d: snap,
          layers3d: Object.fromEntries(
            (
              [
                "board",
                "soldermask",
                "copper",
                "silkscreen",
                "topComponents",
                "bottomComponents",
              ] as const
            ).map((layer) => [
              layer,
              !available?.[layer] ? "unavailable" : display.hidden.has(layer) ? "hidden" : "shown",
            ]),
          ) as Pcb3dLayers,
        };
      },
      chooseTool: (next) => {
        get();
        chooseTool(next);
      },
      clearMeasurements: () => {
        get();
        setMeasurements([]);
        setPending(null);
      },
      displayLayers: (patch) => {
        get();
        const available = geometry && availableLayers(geometry.parts),
          hidden = new Set(display.hidden);
        for (const [layer, shown] of Object.entries(patch)) {
          if (shown === undefined) continue;
          if (!available?.[layer as Board3dLayer])
            throw new Error(
              `This 3D board has no separate ${layer} layer.${geometry?.parts.kind === "tscircuit" ? " tscircuit draws copper and silkscreen on the board." : ""}`,
            );
          if (shown) hidden.delete(layer as Board3dLayer);
          else hidden.add(layer as Board3dLayer);
        }
        onDisplay?.({ ...display, hidden });
      },
      height,
      measure: async (points, snapping = true) => {
        const created = get();
        if (readOnly) throw new Error("These tools work on the current version.");
        if (points.length !== 2) throw new Error("Provide two 3D points.");
        const start = snapping
          ? await created.snapPointDetailed(points[0]!)
          : { point: points[0]!, kind: "free" as const };
        const end = snapping
          ? await created.snapPointDetailed(points[1]!)
          : { point: points[1]!, kind: "free" as const };
        if (viewer.current !== created || loaded !== asset)
          throw new Error("The 3D board changed while measuring.");
        return append({
          kind: "distance",
          start: start.point,
          end: end.point,
          lengthMm: new Vector3(...start.point).distanceTo(new Vector3(...end.point)),
          snaps: [start.kind, end.kind],
        });
      },
      fit: () => get().fit(),
      zoom: (factor) => get().zoom(factor),
      setView: (view) => {
        get().setView(view);
        setCamera(view);
      },
      snapshot: () => get().snapshot(),
      restore: (next) => {
        get().restore(next);
        onDisplay?.({ ...display, projection: next.projection, section: next.section });
        setCamera(null);
      },
      capture: () => get().capture(false),
    };
  });
  const busy = loading || !!error || !!asyncError(result);
  return (
    <div className={styles.board3d}>
      <div ref={host} className={styles.threeHost} />
      <div className={`${styles.shelf} ${styles.shelfTopLeft}`}>
        <Menu>
          <MenuTrigger
            render={<button className={styles.tool} aria-label="Camera views" disabled={!ready} />}
          >
            <BoxIcon />
            <span>{camera ? VIEW_LABELS[camera] : "Custom view"}</span>
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuGroup>
              <MenuGroupLabel>Camera</MenuGroupLabel>
              {(["iso", "top", "front", "right"] as const).map((view) => (
                <MenuItem
                  key={view}
                  onClick={() => {
                    viewer.current?.setView(view);
                    setCamera(view);
                  }}
                >
                  {VIEW_LABELS[view]}
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </div>
      <Board3DTools
        ready={ready}
        readOnly={readOnly}
        display={display}
        onDisplay={(next) => onDisplay?.(next)}
        parts={ready ? (geometry?.parts ?? null) : null}
        heights={ready ? heights : null}
        tool={tool}
        onTool={chooseTool}
        measurements={measurements}
        pending={!!pending}
        snap={snap}
        onClear={() => {
          setMeasurements([]);
          setPending(null);
        }}
        onHeight={(reference) => height({ reference })}
      />
      {ready && geometry && display.section.enabled && (
        <SectionStrip
          section={display.section}
          removeKey={null}
          lengthUnit={unit}
          bounds={{
            min: geometry.box.min[display.section.axis],
            max: geometry.box.max[display.section.axis],
          }}
          capsState={caps}
          onChange={(section) => onDisplay?.({ ...display, section })}
          onRemove={() =>
            onDisplay?.({ ...display, section: { ...display.section, enabled: false } })
          }
        />
      )}
      <div className={styles.overlayStack}>
        {children}
        {loading && (
          <OperationStatus
            label={asset && !result.waiting ? "Loading board geometry" : "Exporting 3D board"}
            onCancel={onCancel}
            detail="Components need their installed CAD models. The exporter uses the saved board."
          />
        )}
        {(error || asyncError(result)) && (
          <div className={styles.notice} data-tone="error" role="alert">
            <strong>3D board unavailable</strong>
            <p>{error ?? asyncError(result)}</p>
            <button
              className={styles.secondaryButton}
              onClick={() => {
                setFailure(null);
                setRetry((n) => n + 1);
              }}
            >
              Retry 3D export
            </button>
          </div>
        )}
      </div>
      <div
        className={`${styles.shelf} ${styles.navShelf}`}
        role="toolbar"
        aria-label="3D board navigation"
      >
        <ToolButton label="Zoom out" disabled={busy} onClick={() => viewer.current?.zoom(1.2)}>
          <MinusIcon />
        </ToolButton>
        <ToolButton label="Zoom in" disabled={busy} onClick={() => viewer.current?.zoom(1 / 1.2)}>
          <PlusIcon />
        </ToolButton>
        <ToolButton
          label="Fit board"
          disabled={busy}
          onClick={() => {
            viewer.current?.fit();
            setCamera("iso");
          }}
        >
          <ScanIcon />
        </ToolButton>
        <ShortcutHelp rows={SHORTCUTS_3D} />
        {asset?.log && (
          <>
            <span className={styles.divider} />
            <Popover>
              <PopoverTrigger
                render={<button className={styles.tool} aria-label="3D export log" />}
              >
                <ScrollTextIcon />
              </PopoverTrigger>
              <PopoverPopup side="top" width="lg">
                <PopoverTitle>3D export log</PopoverTitle>
                <pre className={styles.logText}>{asset.log}</pre>
              </PopoverPopup>
            </Popover>
          </>
        )}
      </div>
    </div>
  );
}
