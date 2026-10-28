import { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { LIBRARY_DELETED_FEATURE } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import * as Dialog from "../../components/ui/Dialog";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { environmentPresentations } from "../../state/presentation";
import { library } from "./libraryState";
import { libraryRetentionDays } from "./libraryDeleted";

export function confirmLibraryThreadDeletion(
  thread: EnvironmentThreadShell,
  onDelete: () => Promise<boolean>,
): boolean {
  const preferences = appAtomRegistry.get(mobilePreferencesAtom);
  const selected = AsyncResult.isSuccess(preferences)
    ? preferences.value["loom.library.authorityEnvironmentId"]
    : null;
  if (!selected) return false;
  const environmentId = EnvironmentId.make(selected);
  const presentation = appAtomRegistry.get(
    environmentPresentations.presentationAtom(environmentId),
  );
  const connected =
    presentation?.entry.enabled === true && presentation.connection.phase === "connected";
  const supported = supportsLoomFeature(
    presentation?.serverConfig?.environment.capabilities,
    LIBRARY_DELETED_FEATURE,
  );
  const confirm = (notice: string) =>
    Dialog.confirm({
      title: "Delete thread?",
      message: `“${thread.title}” will be deleted from this computer, including local terminal history.${notice ? ` ${notice}` : ""}`,
      confirmText: "Delete",
      destructive: true,
      onConfirm: () => {
        void onDelete();
      },
    });
  void (async () => {
    let saved: boolean | null = null;
    let retentionDays: number | null = null;
    if (
      connected &&
      supportsLoomFeature(presentation?.serverConfig?.environment.capabilities, "project-library")
    ) {
      const lookup = await executeAtomQuery(
        appAtomRegistry,
        library.lookupThread({
          environmentId,
          input: { sourceEnvironmentId: thread.environmentId, threadId: thread.id },
        }),
        { refresh: true, reportFailure: false, reportDefect: false },
      );
      if (lookup._tag === "Success") saved = lookup.value !== null;
      if (saved && supported) {
        const retention = await executeAtomQuery(
          appAtomRegistry,
          library.deletedPreferences({ environmentId, input: {} }),
          { refresh: true, reportFailure: false, reportDefect: false },
        );
        retentionDays = libraryRetentionDays(
          saved,
          supported,
          retention._tag === "Success" ? retention.value : null,
        );
      }
    }
    const notice =
      retentionDays !== null
        ? `Kept in your Library's Recently deleted for ${retentionDays} ${retentionDays === 1 ? "day" : "days"}.`
        : saved === true
          ? "Its saved history remains in your Library."
          : saved === null
            ? "The Library copy could not be checked. Saved history may remain there."
            : "";
    confirm(notice);
  })().catch(() =>
    confirm("The Library copy could not be checked. Saved history may remain there."),
  );
  return true;
}
