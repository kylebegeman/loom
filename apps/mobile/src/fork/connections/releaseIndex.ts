import { createReleaseIndexAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { type MirroredReleaseIndex, RELEASE_INDEX_FEATURE } from "@t3tools/contracts/fork";
import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";

const releaseIndex = createReleaseIndexAtoms(connectionAtomRuntime);

/**
 * The releases this environment's Library mirrors, or `null` to read GitHub: an older server, one
 * without a Library, or one too outdated to connect cannot answer.
 */
export async function readEnvironmentReleaseIndex(
  environmentId: EnvironmentId,
  signal: AbortSignal,
): Promise<MirroredReleaseIndex | null> {
  const presentation = appAtomRegistry
    .get(environmentPresentations.presentationsAtom)
    .get(environmentId);
  if (
    presentation?.connection.phase !== "connected" ||
    !supportsLoomFeature(presentation.serverConfig?.environment.capabilities, RELEASE_INDEX_FEATURE)
  )
    return null;
  const result = await executeAtomQuery(
    appAtomRegistry,
    releaseIndex({ environmentId, input: {} }),
    { refresh: true, signal, reportFailure: false },
  );
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}
