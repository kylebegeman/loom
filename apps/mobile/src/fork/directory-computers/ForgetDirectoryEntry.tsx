import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  createDirectoryForgetCommand,
  createDirectoryComputersAtoms,
  directoryForgetConfirmation,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import { DIRECTORY_FEATURE, type DirectoryForgetRequest } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";

const forgetCommand = createDirectoryForgetCommand(connectionAtomRuntime);
const directory = createDirectoryComputersAtoms(connectionAtomRuntime);

export function ForgetDirectoryEntry({
  request,
  label,
  title = "Forget in your Library",
}: {
  readonly request: DirectoryForgetRequest;
  readonly label: string;
  readonly title?: string;
}) {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const chosen = AsyncResult.isSuccess(preferences)
    ? preferences.value["loom.library.authorityEnvironmentId"]
    : null;
  const libraryId = chosen ? EnvironmentId.make(chosen) : null;
  const config = useEnvironmentServerConfig(libraryId);
  const { presentation } = useEnvironmentPresentation(libraryId);
  const allowed = useAtomValue(forgetCommand.permissionAtom(libraryId));
  const forget = useAtomCommand(forgetCommand, { reportFailure: false });
  const refresh = useAtomRefresh(directory.listing(libraryId));
  const [pending, setPending] = useState(false);
  if (
    !allowed ||
    !libraryId ||
    !supportsLoomFeature(config?.environment.capabilities, DIRECTORY_FEATURE)
  )
    return null;
  const run = async () => {
    setPending(true);
    const result = await forget({ environmentId: libraryId, input: request });
    setPending(false);
    if (result._tag === "Success") refresh();
    else {
      const error = Option.getOrNull(Cause.findErrorOption(result.cause));
      Dialog.alert(
        `Could not forget ${label}`,
        error instanceof Error
          ? error.message
          : "Your Library could not forget this entry. Try again.",
      );
    }
  };
  return (
    <ListActionRow
      icon="trash"
      label={pending ? "Forgetting..." : title}
      disabled={pending || presentation?.connection.phase !== "connected"}
      onPress={() =>
        Dialog.confirm({
          title: `Forget ${label}?`,
          message: directoryForgetConfirmation(label),
          confirmText: "Forget",
          destructive: true,
          onConfirm: () => void run(),
        })
      }
    />
  );
}
