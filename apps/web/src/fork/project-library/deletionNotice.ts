import type { ScopedThreadRef } from "@t3tools/contracts";
import { LIBRARY_DELETED_FEATURE } from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentServerConfigsAtom } from "~/state/server";
import { projectLibrary, readLibraryAuthorityId } from "./state";

export async function libraryThreadDeletionNotice(targets: readonly ScopedThreadRef[]) {
  const fallback =
    targets.length === 1
      ? "This deletes the conversation from this computer."
      : "This deletes these conversations from this computer.";
  const authorityId = readLibraryAuthorityId();
  if (!authorityId) return fallback;
  let saved = false;
  for (let offset = 0; offset < targets.length && !saved; offset += 8) {
    const results = await Promise.all(
      targets.slice(offset, offset + 8).map((target) =>
        executeAtomQuery(
          appAtomRegistry,
          projectLibrary.lookupThread({
            environmentId: authorityId,
            input: { sourceEnvironmentId: target.environmentId, threadId: target.threadId },
          }),
          { reportFailure: false, reportDefect: false, refresh: true },
        ),
      ),
    );
    saved = results.some((result) => result._tag === "Success" && result.value !== null);
  }
  if (!saved) return fallback;
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(authorityId);
  if (!supportsLoomFeature(config?.environment.capabilities, LIBRARY_DELETED_FEATURE))
    return "This deletes the conversation on this computer. Your Library keeps its saved copy.";
  const result = await executeAtomQuery(
    appAtomRegistry,
    projectLibrary.deletedPreferences({ environmentId: authorityId, input: {} }),
    { reportFailure: false, reportDefect: false, refresh: true },
  );
  return result._tag === "Success"
    ? targets.length === 1
      ? `Kept in your Library's Recently deleted for ${result.value.retentionDays} days.`
      : `Saved Library conversations are kept in Recently deleted for ${result.value.retentionDays} days. Other conversation history is deleted from this computer.`
    : "This deletes the conversation on this computer. Your Library keeps its saved copy until its retention period ends.";
}
