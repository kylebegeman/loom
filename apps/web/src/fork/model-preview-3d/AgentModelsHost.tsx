import { useEffect } from "react";
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { AgentModelsMode } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useServerConfigs } from "~/state/entities";
import { useRouteThread } from "../routeThread";
import { models } from "./state";
import { applyAgentModels } from "./agentModels";
import { useAgentModelMarks } from "./agentModelMarks";

const handledCheckpoints = new Map<string, Set<string>>();
function AgentModelsStream({
  threadRef,
  mode,
}: {
  threadRef: ScopedThreadRef;
  mode: AgentModelsMode;
}) {
  const result = useAtomValue(
    models.turnModelEvents({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, include: ["build123d"] },
    }),
  );
  const event = Option.getOrNull(AsyncResult.value(result));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens agent-changed models in the right panel store once per new checkpoint from the server stream
  useEffect(() => {
    if (!event?.checkpointId || event.threadId !== threadRef.threadId) return;
    const key = scopedThreadKey(threadRef);
    const handled = handledCheckpoints.get(key) ?? new Set<string>();
    if (handled.has(event.checkpointId)) return;
    handled.add(event.checkpointId);
    // Bound session bookkeeping while keeping repeated subscription values idempotent.
    if (handled.size > 200) handled.delete(handled.values().next().value!);
    handledCheckpoints.set(key, handled);
    applyAgentModels(threadRef, event, mode);
  }, [event, mode, threadRef]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- logs a failed model change subscription to the console
  useEffect(() => {
    if (result._tag === "Failure")
      console.warn("Loom could not follow this thread's model changes", Cause.squash(result.cause));
  }, [result]);
  return null;
}
function ConfiguredAgentModelsHost({ threadRef }: { threadRef: ScopedThreadRef }) {
  const result = useAtomValue(
    models.settings({ environmentId: threadRef.environmentId, input: {} }),
  );
  const settings = Option.getOrNull(AsyncResult.value(result));
  const mode = settings?.agentModels;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears this thread's agent model marks in the store when agent models are turned off
  useEffect(() => {
    if (mode === "off") useAgentModelMarks.getState().clear(scopedThreadKey(threadRef));
  }, [mode, threadRef]);
  return mode && mode !== "off" ? <AgentModelsStream threadRef={threadRef} mode={mode} /> : null;
}

/** One scoped stream for the current persisted thread, mounted through the existing fork root host. */
export function AgentModelsHost() {
  const route = useRouteThread();
  const configs = useServerConfigs();
  if (!route || route.isDraft) return null;
  const features = loomFeaturesOf(
    configs.get(route.threadRef.environmentId)?.environment.capabilities,
  );
  if (!features.includes("model-preview-3d") || !features.includes("model-follow-agent"))
    return null;
  return (
    <ConfiguredAgentModelsHost key={scopedThreadKey(route.threadRef)} threadRef={route.threadRef} />
  );
}
