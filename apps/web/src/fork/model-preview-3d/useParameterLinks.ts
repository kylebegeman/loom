import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { modelFormatOf, type ScadParameter } from "@t3tools/contracts/fork";
import { parameterRange } from "./nameScrub";
import { models, modelUrl, runModelCommand } from "./state";
import {
  linkParameter,
  MAX_LINKED_PARAMETERS,
  type ParameterLink,
  type Perturbation,
} from "./viewer/linking";
import { disposeModel, loadModel } from "./viewer/load";
import { buildTopology, type Topology } from "./viewer/snap";
import { modelPositions } from "./viewer/snapTopology";

export type LinkResult = { name: string } & (ParameterLink | { status: "failed"; error: string });
/** Which base regions each analyzed parameter moves. */
export type Linking = { base: Topology; parameters: LinkResult[] };
export type LinkJob = { done: number; total: number };
/** Renders the part with these values and resolves with its triangles in model space. */
export type LinkRender = (
  values: Readonly<Record<string, string>>,
  signal: AbortSignal,
) => Promise<Float32Array>;

/** Topologies are built on the main thread, so the analysis stops at this size. */
const LINK_TRIANGLE_LIMIT = 200_000;
/** Finished analyses kept for returning to earlier values. */
const LINK_CACHE = 8;
/** Analysis renders run as their own job, so they never cancel the preview. */
export const LINK_VARIANT_ID = "loom-link";
const NO_ROOM = "Its range leaves no room for a step.";
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Analyses are kept per source revision and parameter values. */
export const linkKey = (sourceRevision: string, values: Readonly<Record<string, string>>) =>
  JSON.stringify([
    sourceRevision,
    Object.keys(values)
      .toSorted()
      .map((name) => [name, values[name]]),
  ]);

/** Number parameters a step can move: no option list and a numeric value. */
export const linkableParameters = (
  parameters: readonly ScadParameter[],
  values: Readonly<Record<string, string>>,
) =>
  parameters.filter(
    (parameter) =>
      parameter.kind === "number" &&
      !parameter.options?.length &&
      Number.isFinite(Number(values[parameter.name] ?? parameter.defaultValue)),
  );

/** One step up and one down from the current value, where the range allows. */
export function linkNudges(
  parameter: ScadParameter,
  values: Readonly<Record<string, string>>,
): { delta: number; values: Record<string, string> }[] {
  const value = Number(values[parameter.name] ?? parameter.defaultValue),
    { min, max, step } = parameterRange(parameter);
  if (!Number.isFinite(value) || !(step > 0)) return [];
  return [step, -step].flatMap((delta) => {
    const next = Number((value + delta).toFixed(10));
    return (max !== null && next > max) || (min !== null && next < min)
      ? []
      : [{ delta, values: { ...values, [parameter.name]: String(next) } }];
  });
}

/** Renders through the panel's model path (OpenSCAD or Python CAD) and reads the mesh. */
export function modelLinkRender(threadRef: ScopedThreadRef, path: string): LinkRender {
  return async (values, signal) => {
    const file = { threadId: threadRef.threadId, path };
    const cancel = () =>
      void runModelCommand(models.cancelVariant, {
        environmentId: threadRef.environmentId,
        input: { file, variantId: LINK_VARIANT_ID },
      }).catch(() => undefined);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await runModelCommand(
        modelFormatOf(path) === "build123d" ? models.renderModel : models.render,
        {
          environmentId: threadRef.environmentId,
          input: { file, overrides: values, parameterSet: null, variantId: LINK_VARIANT_ID },
        },
      );
      signal.throwIfAborted();
      if (result.status !== "ok" || !result.mesh || !result.meshFormat)
        throw new Error(
          result.log.find((line) => line.level === "error")?.text ?? "The render was cancelled.",
        );
      const model = await loadModel(
        modelUrl(threadRef.environmentId, result.mesh.relativeUrl),
        result.meshFormat,
        signal,
        () => undefined,
      );
      try {
        return modelPositions(model);
      } finally {
        disposeModel(model);
      }
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  };
}

/** Resolves null when the signal aborts mid-parameter; other failures reject. */
async function analyzeLinks(
  render: LinkRender,
  values: Readonly<Record<string, string>>,
  plans: readonly { name: string; nudges: ReturnType<typeof linkNudges> }[],
  signal: AbortSignal,
  progress: (done: number) => void,
): Promise<Linking | null> {
  let done = 0;
  const positions = await render(values, signal);
  signal.throwIfAborted();
  if (positions.length / 9 > LINK_TRIANGLE_LIMIT)
    throw new Error(
      `Parameter analysis works on parts up to ${LINK_TRIANGLE_LIMIT.toLocaleString("en-US")} triangles.`,
    );
  const base = buildTopology(positions, null),
    parameters: LinkResult[] = [];
  progress(++done);
  for (const plan of plans) {
    const perturbations: Perturbation[] = [];
    try {
      if (!plan.nudges.length) throw new Error(NO_ROOM);
      for (const nudge of plan.nudges) {
        const moved = await render(nudge.values, signal);
        signal.throwIfAborted();
        perturbations.push({ delta: nudge.delta, positions: moved });
        progress(++done);
      }
      parameters.push({ name: plan.name, ...linkParameter(base, perturbations) });
    } catch (cause) {
      if (signal.aborted) return null;
      done += plan.nudges.length - perturbations.length;
      progress(done);
      parameters.push({ name: plan.name, status: "failed", error: message(cause) });
    }
  }
  return { base, parameters };
}

/**
 * Renders the part at the analyzed values, then each chosen parameter one step either side, and
 * attributes the part's faces to the parameters that move them. A finished analysis is kept for
 * its key; a cancelled one is dropped, so no partial result passes for a whole one.
 */
export function useParameterLinks(render: LinkRender) {
  const [linkings, setLinkings] = useState<ReadonlyMap<string, Linking>>(() => new Map()),
    [job, setJob] = useState<LinkJob | null>(null),
    // A failure belongs to the values it ran on; other values have not failed.
    [error, setError] = useState<{ key: string; message: string } | null>(null),
    control = useRef<AbortController | null>(null),
    latestRender = useRef(render);
  useLayoutEffect(() => {
    latestRender.current = render;
  });
  useEffect(() => () => control.current?.abort(), []);

  const run = useCallback(
    async (input: {
      key: string;
      parameters: readonly ScadParameter[];
      values: Readonly<Record<string, string>>;
      names: readonly string[];
    }) => {
      control.current?.abort();
      const own = new AbortController();
      control.current = own;
      const plans = input.names.slice(0, MAX_LINKED_PARAMETERS).flatMap((name) => {
          const parameter = input.parameters.find((item) => item.name === name);
          return parameter ? [{ name, nudges: linkNudges(parameter, input.values) }] : [];
        }),
        total = 1 + plans.reduce((sum, plan) => sum + plan.nudges.length, 0);
      setError(null);
      setJob({ done: 0, total });
      await analyzeLinks(
        // Each render reads the latest renderer, as the panel can swap it mid-analysis.
        (values, signal) => latestRender.current(values, signal),
        input.values,
        plans,
        own.signal,
        (done) => setJob({ done, total }),
      )
        .then((linking) => {
          if (!linking) return;
          setLinkings((old) => {
            const next = new Map(old);
            next.delete(input.key);
            next.set(input.key, linking);
            for (const key of next.keys()) if (next.size > LINK_CACHE) next.delete(key);
            return next;
          });
        })
        .catch((cause: unknown) => {
          if (!own.signal.aborted) setError({ key: input.key, message: message(cause) });
        })
        .finally(() => {
          if (control.current === own) {
            control.current = null;
            setJob(null);
          }
        });
    },
    [],
  );

  const cancel = useCallback(() => {
    control.current?.abort();
    control.current = null;
    setJob(null);
  }, []);

  return {
    linkings,
    job,
    error,
    /** The analysis failure for these values, if their last run failed. */
    errorFor: (key: string | null) => (error && error.key === key ? error.message : null),
    run,
    cancel,
  };
}
