import { useAtomValue } from "@effect/atom-react";
import {
  computersBelowCompatibilityFloor,
  directoryComputersView,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { DIRECTORY_FEATURE } from "@t3tools/contracts/fork";
import { directoryComputers } from "../directory-computers/state";
import { useLibraryAuthority } from "../project-library/state";

export function CompatibilityNotice() {
  const authority = useLibraryAuthority();
  const config = authority.environment?.serverConfig;
  const supportsDirectory =
    config == null ? null : supportsLoomFeature(config.environment.capabilities, DIRECTORY_FEATURE);
  const live = useAtomValue(
    directoryComputers.listing(supportsDirectory === false ? null : authority.authorityId),
  );
  const stored = useAtomValue(directoryComputers.stored(authority.authorityId));
  const view = directoryComputersView({
    authorityEnvironmentId: authority.authorityId,
    supportsDirectory,
    libraryConnection: authority.environment?.connection ?? null,
    live,
    stored,
    saved: authority.environments,
    now: 0,
  });
  const computers = computersBelowCompatibilityFloor({
    listing: view.listing.listing,
    saved: authority.environments.map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      loomFeatures: environment.serverConfig?.environment.capabilities.loomFeatures,
    })),
  });
  if (computers.length === 0) return null;
  return (
    <div role="status" className="space-y-2 px-3 py-3 text-sm sm:px-4">
      {computers.map((computer) => (
        <p key={computer.environmentId}>
          {computer.label} is older than this Loom supports.{" "}
          <a className="underline" href="#fleet-updates">
            Update
          </a>
        </p>
      ))}
    </div>
  );
}
