import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  activeBed,
  fitBed,
  normalizeQuaternion,
  type ModelFormat,
  type ModelOrientation,
  type ModelPreviewSettings,
  type PrintCheckReport,
} from "@t3tools/contracts/fork";
import { randomUUID } from "~/lib/utils";
import type { ScadSession } from "./ScadCustomizer";
import { models, runModelCommand } from "./state";

export type PrintCheckInput = {
  threadRef: ScopedThreadRef;
  path: string;
  format: ModelFormat;
  geometryRevision: string;
  session: Pick<ScadSession, "applied" | "setName"> | null;
  settings: ModelPreviewSettings;
  orientation: ModelOrientation | null;
  active: boolean;
  enabled: boolean;
  allowLarge: boolean;
};
/** Bed changes reuse host geometry results; only analysis inputs identify a geometry check. */
export function printCheckRequestKey(input: PrintCheckInput) {
  return JSON.stringify([
    input.geometryRevision,
    input.format,
    input.orientation ? normalizeQuaternion(input.orientation.quaternion) : null,
    input.format === "scad"
      ? Object.entries(input.session?.applied ?? {}).sort(([a], [b]) => a.localeCompare(b))
      : [],
    input.format === "scad" ? (input.session?.setName ?? null) : null,
    input.settings.nozzleDiameterMm,
    input.settings.overhangAngleDegrees,
    input.settings.firstLayerHeightMm,
  ]);
}
export function isReportStale(report: PrintCheckReport, input: PrintCheckInput) {
  const bed = activeBed(input.settings.buildPlate);
  const { fit } = fitBed(report.summary.sizeMm, bed);
  return (
    report.geometryRevision !== input.geometryRevision ||
    JSON.stringify(report.orientation ? normalizeQuaternion(report.orientation) : null) !==
      JSON.stringify(
        input.orientation ? normalizeQuaternion(input.orientation.quaternion) : null,
      ) ||
    (report.settings.nozzleSource === "setting" &&
      report.settings.nozzleMm !== input.settings.nozzleDiameterMm) ||
    report.settings.overhangAngleDegrees !== input.settings.overhangAngleDegrees ||
    report.settings.firstLayerMm !== input.settings.firstLayerHeightMm ||
    report.bed.id !== bed.id ||
    report.bed.label !== bed.label ||
    report.bed.fit !== fit.status ||
    JSON.stringify(report.bed.overMm) !==
      JSON.stringify(fit.status === "too-big" ? fit.overMm : null)
  );
}

function leaseKey(input: PrintCheckInput) {
  const bed = activeBed(input.settings.buildPlate);
  return JSON.stringify([
    [input.threadRef.environmentId, input.threadRef.threadId, input.path],
    printCheckRequestKey(input),
    [bed.id, bed.label, bed.volumeMm],
    input.allowLarge,
    input.active,
    input.enabled,
  ]);
}

/** Cancels each panel lease independently while the host can retain a shared agent check. */
export function usePrintCheck(input: PrintCheckInput) {
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  }, [input]);
  const scope = JSON.stringify([
    input.threadRef.environmentId,
    input.threadRef.threadId,
    input.path,
  ]);
  const key = printCheckRequestKey(input);
  const requestKey = leaseKey(input);
  const [result, setResult] = useState<{
    scope: string;
    key: string;
    report: PrintCheckReport;
  } | null>(null);
  const [operation, setOperation] = useState<{ key: string; startedAt: number } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const generation = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<{ threadRef: ScopedThreadRef; path: string; id: string } | null>(null);
  const stopRequest = useCallback(() => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
    const previous = request.current;
    request.current = null;
    generation.current++;
    if (previous)
      void runModelCommand(models.cancelPrintCheck, {
        environmentId: previous.threadRef.environmentId,
        input: {
          file: { threadId: previous.threadRef.threadId, path: previous.path },
          requestId: previous.id,
        },
      }).catch(() => {
        /* A disconnected host may have already released this lease. */
      });
  }, []);
  const cancel = useCallback(() => {
    stopRequest();
    setOperation(null);
  }, [stopRequest]);
  const run = useCallback(
    async (force = true) => {
      const current = latest.current;
      if (!current.enabled || !current.geometryRevision || current.format === "step") return;
      stopRequest();
      const ownGeneration = generation.current;
      const id = randomUUID();
      const ownScope = JSON.stringify([
        current.threadRef.environmentId,
        current.threadRef.threadId,
        current.path,
      ]);
      const ownKey = printCheckRequestKey(current);
      request.current = { threadRef: current.threadRef, path: current.path, id };
      setOperation({ key: leaseKey(current), startedAt: Date.now() });
      setFailure(null);
      try {
        const response = await runModelCommand(models.checkPrint, {
          environmentId: current.threadRef.environmentId,
          input: {
            file: { threadId: current.threadRef.threadId, path: current.path },
            requestId: id,
            force,
            allowLarge: current.allowLarge,
            ...(current.format === "scad"
              ? {
                  overrides: current.session?.applied ?? {},
                  parameterSet: current.session?.setName ?? null,
                }
              : {}),
          },
        });
        if (generation.current === ownGeneration && response.report)
          setResult({ scope: ownScope, key: ownKey, report: response.report });
      } catch (cause) {
        if (generation.current === ownGeneration)
          setFailure({
            scope: ownScope,
            message: cause instanceof Error ? cause.message : String(cause),
          });
      } finally {
        if (generation.current === ownGeneration) {
          request.current = null;
          setOperation(null);
        }
      }
    },
    [stopRequest],
  );
  useEffect(() => {
    stopRequest();
    if (input.active && input.enabled && input.geometryRevision && input.format !== "step")
      debounce.current = setTimeout(() => {
        debounce.current = null;
        if (requestKey === leaseKey(latest.current)) void run(false);
      }, 800);
    return stopRequest;
  }, [
    requestKey,
    input.active,
    input.enabled,
    input.geometryRevision,
    input.format,
    run,
    stopRequest,
  ]);
  const report = result?.scope === scope ? result.report : null;
  const running = operation?.key === requestKey;
  const stale = report !== null && (result?.key !== key || isReportStale(report, input));
  return {
    report,
    running,
    startedAt: running ? operation.startedAt : null,
    error: failure?.scope === scope ? failure.message : null,
    stale,
    run,
    cancel,
  };
}
