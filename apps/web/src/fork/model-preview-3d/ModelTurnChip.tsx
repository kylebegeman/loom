import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { RunId, ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { BoxIcon, XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useServerConfigs } from "~/state/entities";
import { models } from "./state";
import {
  MAX_AGENT_MODEL_TABS,
  mayAffectModels,
  modelTurnDismissalKey,
  openTurnModels,
  useDismissedModelTurns,
} from "./agentModels";

function ResolvedModelTurnChip({ threadRef, runId }: { threadRef: ScopedThreadRef; runId: RunId }) {
  const result = useAtomValue(
    models.turnModels({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, runId, include: ["build123d"] },
    }),
  );
  const loggedFailure = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- logs a failed turn model lookup to the console once
  useEffect(() => {
    if (result._tag === "Failure" && !loggedFailure.current) {
      loggedFailure.current = true;
      console.warn(
        "Loom could not find the models changed by this turn",
        Cause.squash(result.cause),
      );
    }
  }, [result]);
  const turn = Option.getOrNull(AsyncResult.value(result));
  if (result._tag === "Failure" || !turn?.models.length || turn.threadId !== threadRef.threadId)
    return null;
  const overflow = turn.models.length > MAX_AGENT_MODEL_TABS || turn.truncated;
  const label = overflow
    ? `Show ${turn.models.length} models`
    : turn.models.length === 1
      ? `Open ${turn.models[0]!.path.split("/").at(-1)}`
      : `Open ${turn.models.length} models`;
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              aria-label={label}
              onClick={() => openTurnModels(threadRef, turn)}
            />
          }
        >
          <BoxIcon className="size-3" />
          <span className="hidden @[24rem]/changed-files:inline">{label}</span>
        </TooltipTrigger>
        <TooltipPopup side="top">
          <span className="whitespace-pre-line">
            {turn.models.map((model) => model.path).join("\n")}
            {turn.truncated ? "\nSome models may be omitted from this turn." : ""}
          </span>
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Hide for this turn"
              data-scroll-anchor-ignore
              onClick={() =>
                useDismissedModelTurns
                  .getState()
                  .dismiss(modelTurnDismissalKey(threadRef.environmentId, runId))
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
function ConfiguredModelTurnChip({
  threadRef,
  runId,
}: {
  threadRef: ScopedThreadRef;
  runId: RunId;
}) {
  const key = modelTurnDismissalKey(threadRef.environmentId, runId);
  const dismissed = useDismissedModelTurns((state) => state.keys.includes(key));
  const result = useAtomValue(
    models.settings({ environmentId: threadRef.environmentId, input: {} }),
  );
  const settings = Option.getOrNull(AsyncResult.value(result));
  return dismissed || !settings || settings.agentModels === "off" ? null : (
    <ResolvedModelTurnChip key={key} threadRef={threadRef} runId={runId} />
  );
}

/** Candidate-only query: changed code cards keep their existing diff path without an extra RPC. */
export function ModelTurnChip({
  threadRef,
  runId,
  files,
}: {
  threadRef: ScopedThreadRef;
  runId: RunId;
  files: readonly { path: string }[];
}) {
  const configs = useServerConfigs();
  if (!mayAffectModels(files.map((file) => file.path))) return null;
  const features = loomFeaturesOf(configs.get(threadRef.environmentId)?.environment.capabilities);
  if (!features.includes("model-preview-3d") || !features.includes("model-follow-agent"))
    return null;
  return <ConfiguredModelTurnChip threadRef={threadRef} runId={runId} />;
}
