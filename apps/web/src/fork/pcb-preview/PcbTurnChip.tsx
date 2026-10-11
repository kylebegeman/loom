import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { CircuitBoardIcon, XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import { useServerConfigs } from "~/state/entities";
import type { ForkChangedFilesActionProps } from "../changedFiles/registry";
import { pcb } from "./state";
import { asyncValue } from "./usePcbPreview";
import { usePcbPreferences } from "./preferences";
import {
  designTurnDismissalKey,
  mayAffectDesigns,
  openDesigns,
  useDismissedDesignTurns,
} from "./agentDesigns";
function ResolvedChip({ threadRef, runId }: ForkChangedFilesActionProps) {
  const result = useAtomValue(
    pcb.turnDesigns({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, runId },
    }),
  );
  const warned = useRef(false);
  useEffect(() => {
    if (result._tag === "Failure" && !warned.current) {
      warned.current = true;
      console.warn("Loom could not find designs changed by this turn.");
    }
  }, [result]);
  const turn = asyncValue(result);
  if (result._tag === "Failure" || !turn?.designs.length) return null;
  const label =
    turn.designs.length === 1
      ? `Open ${turn.designs[0]!.name}`
      : `Open ${turn.designs.length} designs`;
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="xs"
              variant="ghost-muted"
              aria-label={label}
              onClick={() =>
                openDesigns(
                  threadRef,
                  turn.designs.map((d) => d.designId),
                  "focus",
                )
              }
            />
          }
        >
          <CircuitBoardIcon className="size-3" />
          <span className="hidden @[24rem]/changed-files:inline">{label}</span>
        </TooltipTrigger>
        <TooltipPopup side="top">
          <span className="whitespace-pre-line">
            {turn.designs.map((d) => `${d.name}${d.via ? ` (changed ${d.via})` : ""}`).join("\n")}
            {turn.truncated ? "\nSome designs may be omitted." : ""}
            {turn.designs.length > 8 ? "\nOpens the first 8 designs." : ""}
          </span>
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Hide PCB designs for this turn"
              data-scroll-anchor-ignore
              onClick={() =>
                useDismissedDesignTurns
                  .getState()
                  .dismiss(designTurnDismissalKey(threadRef.environmentId, runId))
              }
            />
          }
        >
          <XIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="top">Hide for this turn</TooltipPopup>
      </Tooltip>
    </>
  );
}
export function PcbTurnChip(props: ForkChangedFilesActionProps) {
  const configs = useServerConfigs(),
    mode = usePcbPreferences((s) => s.agentDesigns);
  const dismissed = useDismissedDesignTurns((s) =>
    s.keys.includes(designTurnDismissalKey(props.threadRef.environmentId, props.runId)),
  );
  if (
    mode === "off" ||
    dismissed ||
    !loomFeaturesOf(configs.get(props.threadRef.environmentId)?.environment.capabilities).includes(
      "pcb-preview",
    ) ||
    !mayAffectDesigns(props.files.map((f) => f.path))
  )
    return null;
  return <ResolvedChip {...props} />;
}
