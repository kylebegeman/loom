import { useAtomValue } from "@effect/atom-react";
import {
  computerConnectionNextStep,
  directoryComputersView,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { DIRECTORY_FEATURE } from "@t3tools/contracts/fork";
import { useEnvironment, type EnvironmentPresentation } from "~/state/environments";
import { directoryComputers } from "../directory-computers/state";
import { useLibraryAuthorityId } from "../project-library/state";

/** Why a computer is failing to connect and what fixes it, using the Library's computer list. */
export function useComputerNextStep(environment: EnvironmentPresentation) {
  const libraryId = useLibraryAuthorityId();
  const library = useEnvironment(libraryId);
  const supported = library?.serverConfig
    ? supportsLoomFeature(library.serverConfig.environment.capabilities, DIRECTORY_FEATURE)
    : null;
  const live = useAtomValue(directoryComputers.listing(supported === false ? null : libraryId));
  const stored = useAtomValue(directoryComputers.stored(libraryId));
  const view = directoryComputersView({
    authorityEnvironmentId: libraryId,
    supportsDirectory: supported,
    libraryConnection: library?.connection ?? null,
    live,
    stored,
    saved: [],
    now: 0,
  });
  return computerConnectionNextStep({
    label: environment.label,
    entry: environment.entry,
    connection: environment.connection,
    listing: view.listing.listing,
  });
}
