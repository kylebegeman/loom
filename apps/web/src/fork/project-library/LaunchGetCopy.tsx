import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { ProfileReadiness } from "./ProfileReadiness";

/**
 * The get-a-copy step of a new conversation, for a computer without a copy that covers the scope.
 * Either choice opens copy preparation, and the conversation starts once the copy is saved.
 */
export function LaunchGetCopy({
  environmentId,
  project,
  hostLabel,
  firstCopy,
  disabled,
  onGetCopy,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: LibraryProject;
  readonly hostLabel: string;
  /** The project has no usable copy on any computer yet. */
  readonly firstCopy: boolean;
  readonly disabled: boolean;
  readonly onGetCopy: (strategy: "clone" | "reuse") => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {firstCopy
          ? `This project has no copy yet. Get one on ${hostLabel} and the conversation starts when it is ready.`
          : `${hostLabel} has no copy of this project yet. The conversation starts when the copy is ready.`}
      </p>
      <ProfileReadiness environmentId={environmentId} project={project} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled} onClick={() => onGetCopy("clone")}>
          Get a copy on {hostLabel}
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onGetCopy("reuse")}>
          Use a folder you already have
        </Button>
      </div>
    </div>
  );
}
