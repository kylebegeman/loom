import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { SkillRegistryEntry } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "~/components/ui/alert-dialog";
import { skills, runSkillCommand, type SkillOperation } from "./state";

export function RemoveSkill({
  entry,
  environmentId,
  projectId,
  operation,
  onRemoved,
}: {
  entry: SkillRegistryEntry;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  operation: SkillOperation;
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const allowed = useAtomValue(skills.remove.permissionAtom(environmentId));
  if (!entry.install || !entry.currentHash) return null;
  return (
    <>
      <Button
        size="xs"
        variant="outline"
        disabled={!allowed || operation.pending !== null}
        onClick={() => setOpen(true)}
      >
        Move to trash
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Move {entry.name} to Loom's trash?</AlertDialogTitle>
            <AlertDialogDescription>
              Threads that use this skill will no longer find it. Loom keeps the complete folder in
              trash and shows its recovery path after removal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={operation.pending !== null}
            >
              Cancel
            </Button>
            <Button
              disabled={!allowed || operation.pending !== null}
              onClick={() =>
                void operation.run("Moving skill to trash", async () => {
                  const result = await runSkillCommand(skills.remove, {
                    environmentId,
                    input: { projectId, key: entry.key, expectedHash: entry.currentHash! },
                  });
                  setOpen(false);
                  operation.setNotice(
                    `Moved to ${result.trashPath}. Restore the folder from that path to recover it.`,
                  );
                  onRemoved();
                })
              }
            >
              Move to trash
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
