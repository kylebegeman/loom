import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { looksLikePreviewLinkUrl } from "@t3tools/contracts/fork";

import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { appAtomRegistry } from "../../state/atom-registry";
import { projectEnvironmentPresentation } from "../../state/environments";
import { environmentPresentations } from "../../state/presentation";
import { previewComputers, previewOpenCandidates } from "./previewLinksLogic";
import { previewLinks } from "./state";

/**
 * Agents only ever post a preview's canonical link, which opens nowhere until the browser has
 * entered from Loom. Returns false for any other URL so the caller opens it as usual.
 */
export function openPreviewLinkFromMessage(url: string, environmentId: EnvironmentId): boolean {
  if (!looksLikePreviewLinkUrl(url)) return false;
  void openPreviewLink(url, environmentId);
  return true;
}

async function openPreviewLink(url: string, preferred: EnvironmentId): Promise<void> {
  const presentations = appAtomRegistry.get(environmentPresentations.presentationsAtom);
  const computers = previewComputers(
    [...presentations].map(([environmentId, presentation]) =>
      projectEnvironmentPresentation(environmentId, presentation),
    ),
  );
  // The URL does not say which computer serves it; a computer that does not own the host
  // refuses, so ask each in turn.
  for (const environmentId of previewOpenCandidates(computers, preferred)) {
    const result = await runAtomCommand(
      appAtomRegistry,
      previewLinks.open,
      { environmentId, input: { link: url } },
      { reportFailure: false },
    );
    if (result._tag === "Success") {
      await tryOpenExternalUrl(result.value.url, "markdown-link");
      return;
    }
  }
  await tryOpenExternalUrl(url, "markdown-link");
}
