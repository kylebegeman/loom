import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
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
export type Pcb3dHandle = Pick<ModelViewer, "fit" | "zoom" | "setView" | "snapshot" | "restore"> & {
  refresh: () => void;
  capture: () => Promise<Blob>;
  isReady: () => boolean;
  isLoading: () => boolean;
};
export function Board3D({
  threadRef,
  designId,
  sourceHash,
  handle,
  onCancel,
  children,
}: {
  threadRef: ScopedThreadRef;
  designId: string;
  sourceHash: string | null;
  handle: React.Ref<Pcb3dHandle>;
  onCancel: () => void;
  /** Workspace status cards that share the 3D overlay stack. */
  children?: React.ReactNode;
}) {
  const [retry, setRetry] = useState(0);
  const result = useAtomValue(
    pcb.asset.resultAtom({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        designId,
        format: "glb",
        transport: "url",
        force: retry > 0,
        revision: `${sourceHash ?? "initial"}:${retry}`,
      },
    }),
  );
  const asset = asyncValue(result),
    host = useRef<HTMLDivElement>(null),
    viewer = useRef<ModelViewer | null>(null);
  const [loaded, setLoaded] = useState<typeof asset>(null);
  const [failure, setFailure] = useState<{ asset: typeof asset; message: string } | null>(null),
    [camera, setCamera] = useState<View | null>("iso");
  const error = failure?.asset === asset ? failure.message : null;
  const clear = useCallback(() => {
    viewer.current?.dispose();
    viewer.current = null;
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
      fit: () => get().fit(),
      zoom: (factor) => get().zoom(factor),
      setView: (view) => {
        get().setView(view);
        setCamera(view);
      },
      snapshot: () => get().snapshot(),
      restore: (next) => {
        get().restore(next);
        setCamera(null);
      },
      capture: () => get().capture(false),
    };
  }, [ready, loading]);
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
