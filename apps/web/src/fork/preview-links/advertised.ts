import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { PREVIEW_LINKS_FEATURE } from "@t3tools/contracts/fork";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentSession } from "~/state/session";

/**
 * For the browser target resolver only. It reads the connection's bootstrap config rather than
 * the server state module, which would load the whole server atom graph into every module that
 * classifies a host (history, favicons) and break their narrow test mocks. Features are fixed
 * for a server run, so the bootstrap copy is current.
 */
export function environmentAdvertisesPreviewLinks(environmentId: EnvironmentId): boolean {
  return supportsLoomFeature(
    appAtomRegistry.get(environmentSession.initialConfigValueAtom(environmentId))?.environment
      .capabilities,
    PREVIEW_LINKS_FEATURE,
  );
}
