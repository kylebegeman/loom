import { resolveFilesystemReadAccess } from "@t3tools/client-runtime/state/filesystem";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { View } from "react-native";

import { Button } from "../../components/ui/Button";
import {
  FolderBrowser,
  platformFromOs,
  useBrowsePathInput,
} from "../../features/projects/AddProjectScreen";
import { useServerConfigs } from "../../state/entities";
import { filesystemEnvironment } from "../../state/filesystem";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSession } from "../../state/session";
import { FolderBrowseField, useFolderFilter } from "./FolderBrowseField";
import { folderPickerStart } from "./folderPickerLogic";

/** A folder the picker has listed, so it exists and its path is the computer's own. */
export interface BrowsedFolder {
  readonly path: string;
  /** Folder names inside it, hidden ones included. */
  readonly names: readonly string[];
}

/** Whether this device may list folders on the computer, the same check FolderBrowser makes. */
export function useFolderReadAccess(environmentId: EnvironmentId | null) {
  const session = useEnvironmentQuery(
    environmentId === null ? null : environmentSession.sessionStateAtom(environmentId),
  );
  const environment = useEnvironmentPresentation(environmentId);
  return resolveFilesystemReadAccess({
    isCatalogReady: environment.isReady,
    connection: environment.presentation?.connection ?? null,
    session: session.data,
    sessionError: session.error,
  });
}

/** Browses one computer's folders, from the first usable `start` path or its Projects folder. */
export function FolderPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly start?: ReadonlyArray<string | null | undefined>;
  readonly showHidden?: boolean;
  /** Receives the listed current folder, or null while filtering, moving or loading. */
  readonly children: (folder: BrowsedFolder | null) => ReactNode;
}) {
  const config = useServerConfigs().get(props.environmentId);
  const platform = platformFromOs(config?.environment.platform.os ?? null);
  const environment = {
    environmentId: props.environmentId,
    platform,
    baseDirectory: folderPickerStart(
      [
        ...(props.start ?? []),
        config?.folders?.projects,
        config?.newProjectsRoot,
        config?.settings.addProjectBaseDirectory,
      ],
      platform,
    ),
  };
  const { isBrowseNavigating, navigateToBrowsePath, pathInput, setPathInput } =
    useBrowsePathInput(environment);
  const filter = useFolderFilter({ pathInput, setPathInput, navigateToBrowsePath }, platform);
  const access = useFolderReadAccess(props.environmentId);
  // FolderBrowser makes the same request, so this shares its listing.
  const listing = useEnvironmentQuery(
    access.canReadFiles && filter.folder !== ""
      ? filesystemEnvironment.browse({
          environmentId: props.environmentId,
          input: { partialPath: filter.folder },
        })
      : null,
  );
  const listed = listing.isSuccess ? listing.data : null;
  const folder =
    listed && filter.value === "" && !isBrowseNavigating
      ? { path: listed.parentPath, names: listed.entries.map((entry) => entry.name) }
      : null;
  return (
    <View className="gap-3">
      <FolderBrowseField path={listed?.parentPath ?? filter.folder} filter={filter} />
      {props.children(folder)}
      {listing.error ? <Button label="Try again" tone="text" onPress={listing.refresh} /> : null}
      <FolderBrowser
        environment={environment}
        navigateToBrowsePath={filter.navigateToBrowsePath}
        pathInput={filter.browsePath}
        setPathInput={setPathInput}
        showHidden={props.showHidden}
      />
    </View>
  );
}
