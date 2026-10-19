import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";

import { appAtomRegistry } from "../../state/atom-registry";
import { projectEnvironmentPresentation } from "../../state/environments";
import { environmentPresentations } from "../../state/presentation";
import { previewComputers, type PreviewComputer } from "./previewLinksLogic";
import { previewLinks } from "./state";

/** Connected computers whose server shares preview links. */
export function readPreviewComputers(): ReadonlyArray<PreviewComputer> {
  const presentations = appAtomRegistry.get(environmentPresentations.presentationsAtom);
  return previewComputers(
    [...presentations].map(([environmentId, presentation]) =>
      projectEnvironmentPresentation(environmentId, presentation),
    ),
  );
}

/**
 * A fresh entry link for any URL on a preview host, or null when no connected computer serves it.
 * The URL does not say which computer that is, and a computer that does not own the host refuses,
 * so ask each in turn.
 */
export async function requestPreviewEntryUrl(url: string): Promise<string | null> {
  for (const { environmentId } of readPreviewComputers()) {
    const result = await runAtomCommand(
      appAtomRegistry,
      previewLinks.open,
      { environmentId, input: { link: url } },
      { reportFailure: false },
    );
    if (result._tag === "Success") return result.value.url;
  }
  return null;
}
