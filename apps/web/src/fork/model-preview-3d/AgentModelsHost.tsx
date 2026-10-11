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
      input: { threadId: threadRef.threadId },
    }),
  );
  const event = Option.getOrNull(AsyncResult.value(result));
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
