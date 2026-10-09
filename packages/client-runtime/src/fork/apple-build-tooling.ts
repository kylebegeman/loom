import type { EnvironmentId } from "@t3tools/contracts";
import { APPLE_BUILD_TOOLING_WS_METHODS as M, type AppleLogChunk } from "@t3tools/contracts/fork";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { runStream } from "../rpc/client.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
  runStreamInEnvironment,
} from "../state/runtime.ts";

/** The log view keeps this many trailing lines; the full log stays on the server. */
export const APPLE_LOG_VIEW_LINES = 2_000;

export interface AppleLogView {
  readonly text: string;
  /** Earlier lines were dropped to stay within APPLE_LOG_VIEW_LINES. */
  readonly truncated: boolean;
  readonly done: boolean;
}

export const EMPTY_APPLE_LOG: AppleLogView = { text: "", truncated: false, done: false };

/** Appends one streamed chunk and drops leading lines beyond the cap. */
export function appendAppleLog(
  view: AppleLogView,
  chunk: AppleLogChunk,
  maxLines = APPLE_LOG_VIEW_LINES,
): AppleLogView {
  let text = view.text + chunk.text;
  let truncated = view.truncated;
  let newlines = 0;
  // A trailing newline ends the last line rather than starting another.
  const last = text.endsWith("\n") ? text.length - 2 : text.length - 1;
  for (let index = last; index >= 0; index--) {
    if (text.charCodeAt(index) !== 10) continue;
    if (++newlines === maxLines) {
      text = text.slice(index + 1);
      truncated = true;
      break;
    }
  }
  return { text, truncated, done: chunk.done };
}

/** Apple build runs, toolchain and settings for one environment. */
export function createAppleBuildToolingAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  /** One-shot: replays the log from the start, follows it live and ends with the run. */
  const logFamily = Atom.family((key: string) => {
    const [environmentId, runId] = JSON.parse(key) as [EnvironmentId, string];
    return runtime
      .atom(
        runStreamInEnvironment(environmentId, runStream(M.tailLog, { runId, fromOffset: 0 })).pipe(
          Stream.scan(
            () => EMPTY_APPLE_LOG,
            (view, chunk) => appendAppleLog(view, chunk),
          ),
        ),
      )
      .pipe(Atom.setIdleTTL(0), Atom.withLabel(`loom:apple-log:${key}`));
  });
  return {
    log: (target: { readonly environmentId: EnvironmentId; readonly runId: string }) =>
      logFamily(JSON.stringify([target.environmentId, target.runId])),
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:apple-status",
      tag: M.status,
      staleTimeMs: 0,
    }),
    inspect: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:apple-inspect",
      tag: M.inspect,
    }),
    destinations: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:apple-destinations",
      tag: M.destinations,
      staleTimeMs: 0,
    }),
    xcodegen: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:apple-xcodegen",
      tag: M.xcodegen,
      staleTimeMs: 0,
    }),
    readiness: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:apple-readiness",
      tag: M.readiness,
      staleTimeMs: 0,
    }),
    run: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:apple-run",
      tag: M.getRun,
      staleTimeMs: 0,
    }),
    settings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:apple-settings",
      tag: M.getSettings,
      staleTimeMs: 0,
    }),
    runs: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:apple-runs",
      tag: M.watchRuns,
    }),
    start: createEnvironmentRpcCommand(runtime, { label: "loom:apple-start", tag: M.start }),
    cancel: createEnvironmentRpcCommand(runtime, { label: "loom:apple-cancel", tag: M.cancel }),
    updateSettings: createEnvironmentRpcCommand(runtime, {
      label: "loom:apple-settings-update",
      tag: M.updateSettings,
    }),
    clearHistory: createEnvironmentRpcCommand(runtime, {
      label: "loom:apple-clear-history",
      tag: M.clearHistory,
    }),
    openResultBundle: createEnvironmentRpcCommand(runtime, {
      label: "loom:apple-open-result",
      tag: M.openResultBundle,
    }),
  };
}
