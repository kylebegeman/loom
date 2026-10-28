import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  activeBed,
  type ModelOrientation,
  type ModelPreviewSettings,
  type SliceInput,
  type SliceResult,
  type PrinterLibrary,
} from "@t3tools/contracts/fork";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { models, modelUrl } from "./state";
import { decodeLayers, type LayerData } from "./viewer/layers";
import type { ScadSession } from "./ScadCustomizer";
import { usePrinterLibrary } from "./printers";

/** The query lease owns cancellation all the way through the RPC and host process. */
export function startSliceRequest(
  environmentId: ScopedThreadRef["environmentId"],
  input: SliceInput,
) {
  const atom = models.slice.resultAtom({ environmentId, input });
  let unsubscribe: (() => void) | null = null,
    unmount: (() => void) | null = null,
    done = false;
  let fail!: (cause: Error) => void;
  const cleanup = () => {
    unsubscribe?.();
    unmount?.();
    unsubscribe = unmount = null;
  };
  const promise = new Promise<SliceResult>((resolve, reject) => {
    fail = reject;
    appAtomRegistry.refresh(atom);
    unmount = appAtomRegistry.mount(atom);
    const initial = appAtomRegistry.get(atom);
    const inspect = (result: typeof initial) => {
      if (done || result.waiting || result._tag === "Initial") return;
      done = true;
      if (result._tag === "Failure") reject(Cause.squash(result.cause));
      else resolve(result.value);
      cleanup();
    };
    unsubscribe = appAtomRegistry.subscribe(atom, inspect);
    inspect(appAtomRegistry.get(atom));
    if (done) cleanup();
  });
  return {
    promise,
    cancel: () => {
      if (done) return;
      done = true;
      cleanup();
      fail(new Error("Slicing was cancelled."));
    },
  };
}
export type SlicingInput = {
  threadRef: ScopedThreadRef;
  path: string;
  format: string;
  geometryRevision: string;
  session: Pick<ScadSession, "applied" | "setName"> | null;
  settings: ModelPreviewSettings;
  orientation: ModelOrientation | null;
  active: boolean;
  enabled: boolean;
};
export function slicingRequestKey(input: SlicingInput, bedId: string, library?: PrinterLibrary) {
  return JSON.stringify([
    input.threadRef.environmentId,
    input.threadRef.threadId,
    input.path,
    input.format,
    input.geometryRevision,
    input.orientation?.quaternion ?? null,
    Object.entries(input.session?.applied ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    input.session?.setName ?? null,
    bedId,
    input.settings.slicer.mappings[bedId],
    input.settings.slicer.paths,
    input.settings.slicer.currency,
    library?.materials,
    library?.printers.find((printer) => printer.id === bedId)?.defaultMaterialId,
  ]);
}
export function useSlicing(input: SlicingInput) {
  const canRun = useAtomValue(models.slice.permissionAtom(input.threadRef.environmentId));
  const library = usePrinterLibrary(input.threadRef.environmentId);
  const bedId = activeBed(input.settings.buildPlate, { library }).id;
  const scope = JSON.stringify([
    input.threadRef.environmentId,
    input.threadRef.threadId,
    input.path,
  ]);
  const key = slicingRequestKey(input, bedId, library);
  const latest = useRef({ input, key, scope, bedId });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest input, key, scope and bed in a ref for async slicing callbacks
  useLayoutEffect(() => {
    latest.current = { input, key, scope, bedId };
  });
  const [saved, setSaved] = useState<{ scope: string; key: string; result: SliceResult } | null>(
    null,
  );
  const [running, setRunning] = useState(false),
    [error, setError] = useState<string | null>(null),
    [layers, setLayers] = useState<LayerData | null>(null),
    [layer, setLayer] = useState(0);
  const lease = useRef<ReturnType<typeof startSliceRequest> | null>(null),
    generation = useRef(0),
    fetching = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    generation.current++;
    lease.current?.cancel();
    lease.current = null;
    fetching.current?.abort();
    fetching.current = null;
    setRunning(false);
  }, []);
  const run = useCallback(
    async (cachedOnly = false) => {
      const current = latest.current;
      if (
        !current.input.enabled ||
        !canRun ||
        !["scad", "stl", "3mf", "obj", "build123d", "step"].includes(current.input.format)
      )
        return null;
      cancel();
      const own = generation.current;
      if (!cachedOnly) {
        setRunning(true);
        setError(null);
      }
      const request = startSliceRequest(current.input.threadRef.environmentId, {
        file: { threadId: current.input.threadRef.threadId, path: current.input.path },
        overrides: current.input.session?.applied ?? {},
        parameterSet: current.input.session?.setName ?? null,
        bedId: current.bedId,
        cachedOnly,
      });
      lease.current = request;
      return request.promise
        .then((result) => {
          if (generation.current === own && result.status !== "none") {
            setSaved({ scope: current.scope, key: current.key, result });
            if (result.status === "error") setError(result.warnings[0] ?? "Slicing failed.");
          }
          return result.status === "ok" ? result : null;
        })
        .catch((cause: unknown) => {
          if (generation.current === own && !cachedOnly)
            setError(cause instanceof Error ? cause.message : String(cause));
          return null;
        })
        .finally(() => {
          if (generation.current === own) {
            lease.current = null;
            setRunning(false);
          }
        });
    },
    [canRun, cancel],
  );
  /* oxlint-disable react/set-state-in-effect, react/exhaustive-effect-dependencies -- Input changes release RPC and fetch leases before looking up cached toolpaths. */
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases slicing rpc and fetch leases on input changes and looks up cached toolpaths from the server
  useEffect(() => {
    cancel();
    setLayers(null);
    setError(null);
    if (input.active && input.enabled && input.geometryRevision && canRun) void run(true);
    return cancel;
  }, [key, input.active, input.enabled, input.geometryRevision, canRun, cancel, run]);
  /* oxlint-enable react/set-state-in-effect, react/exhaustive-effect-dependencies */
  const result = saved?.scope === scope ? saved.result : null;
  const stale = result !== null && saved?.key !== key;
  const hideLayers = useCallback(() => {
    fetching.current?.abort();
    fetching.current = null;
    setLayers(null);
  }, []);
  const toggleLayers = useCallback(
    async (enabled?: boolean) => {
      if (enabled === false || (enabled === undefined && layers)) {
        hideLayers();
        return null;
      }
      const current = latest.current,
        sliced = result?.status === "ok" && !stale ? result : await run();
      if (!sliced?.layers || latest.current.key !== current.key)
        throw new Error("Estimate print before showing layers.");
      const controller = new AbortController();
      fetching.current?.abort();
      fetching.current = controller;
      const layerFile = sliced.layers.file;
      // The async wrapper keeps the cleanup when modelUrl throws synchronously.
      return (async () => {
        const response = await fetch(
          modelUrl(current.input.threadRef.environmentId, layerFile.relativeUrl),
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("The layer file could not be loaded.");
        const data = decodeLayers(await response.arrayBuffer());
        if (!controller.signal.aborted && latest.current.key === current.key) {
          setLayers(data);
          setLayer(Math.max(0, data.layers.length - 1));
          return data;
        }
        return null;
      })().finally(() => {
        if (fetching.current === controller) fetching.current = null;
      });
    },
    [hideLayers, layers, result, stale, run],
  );
  return {
    result,
    stale,
    running,
    error,
    canRun,
    run,
    cancel,
    layers,
    layer,
    setLayer,
    hideLayers,
    toggleLayers,
    shown: layers !== null,
  };
}
export type SlicingControl = ReturnType<typeof useSlicing>;
