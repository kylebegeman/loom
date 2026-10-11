import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useServerConfigs } from "~/state/entities";
import { useRouteThread } from "../routeThread";
import { usePcbPreferences } from "./preferences";
import { pcb } from "./state";
import { asyncValue } from "./usePcbPreview";
import { applyAgentDesigns } from "./agentDesigns";
function StreamHost({ threadRef, mode }: { threadRef: ScopedThreadRef; mode: "offer" | "open" }) {
  const result = useAtomValue(
    pcb.turnDesignEvents({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const event = asyncValue(result),
    handled = useRef(new Set<string>()),
    warned = useRef(false);
  useEffect(() => {
    if (!event?.checkpointId || handled.current.has(event.checkpointId)) return;
    handled.current.add(event.checkpointId);
    if (handled.current.size > 200) handled.current.delete(handled.current.values().next().value!);
    applyAgentDesigns(threadRef, event, mode);
  }, [event, threadRef, mode]);
  useEffect(() => {
    if (result._tag === "Failure" && !warned.current) {
      warned.current = true;
      console.warn("Loom could not follow this thread's PCB changes.");
    }
  }, [result]);
  return null;
}
export function AgentDesignsHost() {
  const route = useRouteThread(),
    configs = useServerConfigs(),
    mode = usePcbPreferences((s) => s.agentDesigns);
  if (
    !route ||
    route.isDraft ||
    mode === "off" ||
    !loomFeaturesOf(configs.get(route.threadRef.environmentId)?.environment.capabilities).includes(
      "pcb-preview",
    )
  )
    return null;
  return (
    <StreamHost
      key={`${route.threadRef.environmentId}:${route.threadRef.threadId}`}
      threadRef={route.threadRef}
      mode={mode}
    />
  );
}
