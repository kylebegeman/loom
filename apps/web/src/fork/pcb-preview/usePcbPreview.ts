import { useAtomValue } from "@effect/atom-react";
import { useMemo, useState } from "react";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  PcbDesign,
  PcbView,
  PcbLayerPreset,
  PcbRenderResult,
  PcbReadSheetResult,
  PcbCheckKind,
  PcbCheckResult,
} from "@t3tools/contracts/fork";
import { pcb } from "./state";
import { previewAction } from "./usePcbPreview.logic";

const idleRender = Atom.make(AsyncResult.initial<PcbRenderResult, never>());
const idleSheet = Atom.make(AsyncResult.initial<PcbReadSheetResult, never>());
const idleChecks = Atom.make(AsyncResult.success<readonly PcbCheckResult[]>([]));
const idleCheck = Atom.make(AsyncResult.initial<PcbCheckResult, never>());
export const asyncValue = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  Option.getOrNull(AsyncResult.value(result));
export const asyncError = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  result._tag === "Failure" ? errorMessage(Cause.squash(result.cause)) : null;
export const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The preview operation failed. Try again.";

/** Mount only for the visible design. Unmount cancels commands, reads and the watch. */
export function usePcbPreview(
  threadRef: ScopedThreadRef,
  design: PcbDesign,
  view: PcbView,
  layers: PcbLayerPreset,
  trusted: boolean,
  layerNames?: readonly string[],
  visible = true,
) {
  const { environmentId, threadId } = threadRef;
  const canRender = useAtomValue(pcb.render.permissionAtom(environmentId));
  const canCheck = useAtomValue(pcb.check.permissionAtom(environmentId));
  const watched = useAtomValue(
    pcb.watch({ environmentId, input: { threadId, designId: design.id } }),
  );
  const sourceHash = watched._tag === "Failure" ? null : (asyncValue(watched)?.sourceHash ?? null);
  const [revision, setRevision] = useState(0),
    [cancelledKey, setCancelledKey] = useState<string | null>(null),
    [forceKey, setForceKey] = useState<string | null>(null);
  const requestKey = JSON.stringify([design.id, sourceHash, view, layers, revision, layerNames]);
  if (forceKey !== null && forceKey !== requestKey) setForceKey(null);
  const allowed =
    previewAction({
      visible,
      design,
      trusted,
      canRender,
      sourceHash,
      view,
      manual: revision > 0,
      watchFailed: asyncError(watched) !== null,
    }) === "render";
  const renderState = useAtomValue(
    allowed && cancelledKey !== requestKey
      ? pcb.render.resultAtom({
          environmentId,
          input: {
            threadId,
            designId: design.id,
            view,
            layers,
            ...(layerNames ? { layerNames } : {}),
            revision: requestKey,
            force: forceKey === requestKey,
          },
        })
      : idleRender,
  );
  const render = asyncValue(renderState);
  const [good, setGood] = useState<{
    result: PcbRenderResult;
    requestKey: string;
    view: PcbView;
    layers: PcbLayerPreset;
  } | null>(null);
  if (!renderState.waiting && render?.outcome === "ok" && good?.result !== render)
    setGood({ result: render, requestKey, view, layers });
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const sheet =
    good?.result.sheets.find((s) => s.id === selectedSheet) ?? good?.result.sheets[0] ?? null;
  const sheetState = useAtomValue(
    visible && good && sheet && !sheet.tooLarge
      ? pcb.readSheet.resultAtom({
          environmentId,
          input: {
            threadId,
            renderKey: good.result.renderKey,
            sheetId: sheet.id,
            revision: good.requestKey,
          },
        })
      : idleSheet,
  );
  const [display, setDisplay] = useState<{
    svg: string;
    label: string;
    sourceHash: string;
    renderKey: string;
    sheetId: string;
    view: PcbView;
    layers: PcbLayerPreset;
    result: PcbRenderResult;
    requestKey: string;
  } | null>(null);
  const svg = asyncValue(sheetState)?.svg;
  if (
    svg &&
    !sheetState.waiting &&
    sheetState._tag === "Success" &&
    sheet &&
    good &&
    (display?.renderKey !== good.result.renderKey ||
      display.sheetId !== sheet.id ||
      display.svg !== svg ||
      display.view !== good.view ||
      display.layers !== good.layers ||
      display.requestKey !== good.requestKey)
  )
    setDisplay({
      svg,
      label: sheet.label,
      sourceHash: good.result.sourceHash,
      renderKey: good.result.renderKey,
      sheetId: sheet.id,
      view: good.view,
      layers: good.layers,
      result: good.result,
      requestKey: good.requestKey,
    });
  const latestState = useAtomValue(
    design.kind === "kicad"
      ? pcb.latestChecks({ environmentId, input: { threadId, designId: design.id } })
      : idleChecks,
  );
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkRevision, setCheckRevision] = useState(0);
  const [job, setJob] = useState<{ kind: PcbCheckKind; revision: number } | null>(null);
  const checkState = useAtomValue(
    job && canCheck && design.toolAvailable
      ? pcb.check.resultAtom({ environmentId, input: { threadId, designId: design.id, ...job } })
      : idleCheck,
  );
  const checked = asyncValue(checkState);
  const [finishedChecks, setFinishedChecks] = useState<
    Partial<Record<PcbCheckKind, PcbCheckResult>>
  >({});
  if (checked && finishedChecks[checked.kind] !== checked)
    setFinishedChecks((current) => ({ ...current, [checked.kind]: checked }));
  const results = useMemo(() => {
    const values: Partial<Record<PcbCheckKind, PcbCheckResult>> = { ...finishedChecks };
    for (const result of asyncValue(latestState) ?? []) {
      const local = values[result.kind];
      if (!local || result.ranAt > local.ranAt) values[result.kind] = result;
    }
    return values;
  }, [latestState, finishedChecks]);
  // A completed job does not re-run when the inspector opens or its controls change.
  if (job && (!canCheck || !design.toolAvailable)) setJob(null);
  if (job && !checkState.waiting && checkState._tag !== "Initial") {
    setCheckError(asyncError(checkState));
    setJob(null);
  }
  return {
    canRender,
    canCheck: canCheck && design.toolAvailable,
    sourceHash,
    requestKey,
    checkRevision,
    render,
    renderState,
    good,
    display,
    sheet,
    sheetState,
    selectedSheet: sheet?.id ?? "",
    selectSheet: setSelectedSheet,
    rendering: Boolean(
      allowed &&
      cancelledKey !== requestKey &&
      (renderState.waiting || renderState._tag === "Initial"),
    ),
    loadingSheet: Boolean(
      visible &&
      good &&
      sheet &&
      !sheet.tooLarge &&
      (sheetState.waiting || sheetState._tag === "Initial"),
    ),
    watchError: asyncError(watched),
    watching: !sourceHash && asyncError(watched) === null,
    error: asyncError(renderState),
    sheetError: asyncError(sheetState),
    checks: results,
    checksLoading: latestState.waiting || latestState._tag === "Initial",
    checksError: asyncError(latestState),
    checkError,
    checking: job?.kind ?? null,
    runCheck: (kind: PcbCheckKind) => {
      setCheckError(null);
      setCheckRevision((r) => r + 1);
      setJob({ kind, revision: checkRevision + 1 });
    },
    cancelCheck: () => {
      setCheckError(null);
      setJob(null);
    },
    refresh: () => {
      setCancelledKey(null);
      const next = revision + 1;
      setForceKey(JSON.stringify([design.id, sourceHash, view, layers, next, layerNames]));
      setRevision(next);
    },
    cancelRender: () => setCancelledKey(requestKey),
    cancelled: cancelledKey === requestKey,
  };
}
