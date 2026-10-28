import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { directoryForgetConfirmation, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { DIRECTORY_FEATURE, type DirectoryForgetRequest } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { requestConfirmDialog } from "~/confirmDialog";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLibraryAuthority } from "../project-library/state";
import { directoryComputers, forgetDirectoryComputer } from "./state";

export function ForgetDirectoryEntry({
  request,
  label,
  title = "Forget",
}: {
  readonly request: DirectoryForgetRequest;
  readonly label: string;
  readonly title?: string;
}) {
  const authority = useLibraryAuthority();
  const libraryId = authority.authorityId;
  const permission = useAtomValue(forgetDirectoryComputer.permissionAtom(libraryId));
  const forget = useAtomCommand(forgetDirectoryComputer, { reportFailure: false });
  const refresh = useAtomRefresh(directoryComputers.listing(libraryId));
  const [pending, setPending] = useState(false);
  if (
    !libraryId ||
    permission !== true ||
    !supportsLoomFeature(
      authority.environment?.serverConfig?.environment.capabilities,
      DIRECTORY_FEATURE,
    )
  )
    return null;
  const onForget = async () => {
    if (
      (await requestConfirmDialog(directoryForgetConfirmation(label), {
        variant: "destructive",
      })) !== true
    )
      return;
    setPending(true);
    const result = await forget({ environmentId: libraryId, input: request });
    setPending(false);
    if (result._tag === "Success") {
      refresh();
      toastManager.add({ type: "success", title: `${label} forgotten from your Library` });
    } else {
      const error = Option.getOrNull(Cause.findErrorOption(result.cause));
      toastManager.add({
        type: "error",
        title: `Could not forget ${label}`,
        description:
          error instanceof Error
            ? error.message
            : "Your Library could not forget this entry. Try again.",
      });
    }
  };
  return (
    <Button
      size="xs"
      variant="ghost-muted"
      disabled={pending || authority.environment?.connection.phase !== "connected"}
      onClick={() => void onForget()}
    >
      {pending ? "Forgetting..." : title}
    </Button>
  );
}
