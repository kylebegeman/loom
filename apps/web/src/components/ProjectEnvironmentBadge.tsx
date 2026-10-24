import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";

import type { SidebarProjectGroupMember } from "~/sidebarProjectGrouping"; // fork: no-project-first
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function ProjectEnvironmentBadge(props: {
  // fork: no-project-first: No project rows describe one computer without a project group.
  readonly group: {
    readonly memberProjects: ReadonlyArray<
      Pick<SidebarProjectGroupMember, "environmentId" | "environmentLabel">
    >;
  };
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly machineByEnvironmentId: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
}) {
  const remoteMembers = props.group.memberProjects
    .filter((member) => member.environmentId !== props.primaryEnvironmentId)
    .map((member) => ({ ...member, environmentLabel: member.environmentLabel ?? "Remote" }))
    .sort((a, b) => a.environmentLabel.localeCompare(b.environmentLabel));
  const first = remoteMembers[0];
  if (!first) return null;
  const labels = remoteMembers
    .map((member) => member.environmentLabel)
    .filter((label, index, all) => all.indexOf(label) === index)
    .join(", ");
  const alsoHere = remoteMembers.length < props.group.memberProjects.length;
  const description = `${alsoHere ? "Also on" : "On"} ${labels}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={description}
            className="ml-auto inline-flex shrink-0 items-center text-muted-foreground"
          />
        }
      >
        <EnvironmentMachineIcon
          aria-hidden
          kind={props.machineByEnvironmentId.get(first.environmentId) ?? "server"}
          className="size-3.5"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{description}</TooltipPopup>
    </Tooltip>
  );
}
