import { useState } from "react";
import { FolderPlusIcon } from "lucide-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useConnectedEnvironmentIds } from "~/state/environments";
import { ProjectPreparationDialog } from "./ProjectPreparationDialog";

/** A new working copy is cloned from the actual origin of a connected copy. */
export function PrepareOnAnotherComputerButton({
  projects,
}: {
  readonly projects: readonly EnvironmentProject[];
}) {
  const connectedIds = useConnectedEnvironmentIds();
  const [preparing, setPreparing] = useState(false);
  const source = projects.find((project) => connectedIds.includes(project.environmentId));
  const button = (
    <Button size="xs" variant="outline" disabled={!source} onClick={() => setPreparing(true)}>
      <FolderPlusIcon aria-hidden="true" />
      Prepare on another computer
    </Button>
  );
  return (
    <>
      {source ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger render={<span />}>{button}</TooltipTrigger>
          <TooltipPopup side="top">Reconnect one of this project's computers first.</TooltipPopup>
        </Tooltip>
      )}
      {preparing && source ? (
        <ProjectPreparationDialog sourceProject={source} onClose={() => setPreparing(false)} />
      ) : null}
    </>
  );
}
