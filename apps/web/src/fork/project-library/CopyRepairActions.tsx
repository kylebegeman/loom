import { useNavigate } from "@tanstack/react-router";
import type { LibraryCopyStatus, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { useEnvironmentQuery } from "~/state/query";
import { projectLibrary } from "./state";
import { projectViewSearch } from "./projectViews";

export function CopyRepairActions({
  copy,
  threads,
  blocker,
  onOpen,
}: {
  readonly copy: LibraryWorkingCopy;
  readonly threads?: LibraryCopyStatus["releaseBlockerThreads"];
  readonly blocker?: string;
  readonly onOpen: () => void;
}) {
  const navigate = useNavigate();
  const status = useEnvironmentQuery(
    threads === undefined
      ? projectLibrary.copyStatus({
          environmentId: copy.environmentId,
          input: { workingCopyId: copy.id },
        })
      : null,
  );
  const held = (threads ?? status.data?.releaseBlockerThreads ?? []).filter(
    (thread) => blocker === undefined || blocker.includes(thread.worktreePath),
  );
  return (
    <div className="flex flex-wrap gap-2">
      {held.length ? (
        held.map((thread) => (
          <Button
            key={thread.threadId}
            size="xs"
            variant="outline"
            onClick={() => {
              onOpen();
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId: copy.environmentId, threadId: thread.threadId },
              });
            }}
          >
            Open conversation: {thread.title}
          </Button>
        ))
      ) : (
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            onOpen();
            void navigate({
              to: "/library/$projectId",
              params: { projectId: copy.projectId },
              search: projectViewSearch("computers"),
            });
          }}
        >
          Open project files
        </Button>
      )}
    </div>
  );
}
