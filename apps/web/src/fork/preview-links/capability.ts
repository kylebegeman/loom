import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { PREVIEW_LINKS_FEATURE } from "@t3tools/contracts/fork";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentServerConfigsAtom } from "~/state/server";
import { readPreparedConnection } from "~/state/session";

// Read outside React, like readEnvironmentSupportsServerBrowser, so navigation helpers can ask
// without a hook.

/** Connected environments whose server can share and open preview links. */
export function readPreviewLinkEnvironments(): ReadonlyArray<EnvironmentId> {
  return [...appAtomRegistry.get(environmentServerConfigsAtom)]
    .filter(
      ([environmentId, config]) =>
        supportsLoomFeature(config.environment.capabilities, PREVIEW_LINKS_FEATURE) &&
        readPreparedConnection(environmentId) !== null,
    )
    .map(([environmentId]) => environmentId);
}

export function readEnvironmentLabel(environmentId: EnvironmentId): string {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.label ??
    "this computer"
  );
}
