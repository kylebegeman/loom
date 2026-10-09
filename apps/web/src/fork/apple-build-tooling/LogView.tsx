import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Alert, Muted, failureOf, valueOf } from "./parts";
import { apple } from "./state";

/**
 * The run's log: replayed from the start, then followed while the run goes. The stream
 * stops when this unmounts (panel hidden or another run chosen) or the run ends.
 */
export function LogView({ environmentId, runId }: { environmentId: EnvironmentId; runId: string }) {
  const result = useAtomValue(apple.log({ environmentId, runId }));
  const view = valueOf(result);
  const failure = failureOf(result);
  const scroller = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  const text = view?.text;
  useEffect(() => {
    const element = scroller.current;
    if (text !== undefined && element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [text]);
  if (failure) return <Alert>{failure}</Alert>;
  if (!view || (view.text === "" && !view.done)) return <Muted>Waiting for output...</Muted>;
  return (
    <div className="flex flex-col gap-1">
      {view.truncated && <Muted>Showing the last 2,000 lines.</Muted>}
      <pre
        ref={scroller}
        aria-label="Run log"
        className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-2 font-mono text-xs"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
      >
        {view.text === "" ? "The log is empty." : view.text}
      </pre>
    </div>
  );
}
