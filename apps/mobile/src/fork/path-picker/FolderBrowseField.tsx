import { getCloneDestinationPath } from "@t3tools/client-runtime/operations/projects";
import { getFilesystemBrowsePath } from "@t3tools/client-runtime/state/filesystem";
import { useState } from "react";
import { View } from "react-native";

import { AppTextInput } from "../../components/ui/AppText";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ListSection } from "../../components/ui/ListSection";
import { typedFolderFilter } from "./folderPickerLogic";

type NavigateToBrowsePath = (input: {
  readonly browseDirectoryPath: string;
  readonly selectedDirectoryName?: string;
}) => Promise<boolean>;

export interface FolderFilter {
  readonly folder: string;
  readonly value: string;
  /** What FolderBrowser lists: the folder, narrowed by the filter. */
  readonly browsePath: string;
  readonly onChange: (text: string) => void;
  readonly navigateToBrowsePath: NavigateToBrowsePath;
}

/**
 * Keeps filter text apart from the browse path, so typing never becomes the chosen path. A typed
 * full or relative path moves the browser instead, keeping a pinned clone folder name.
 */
export function useFolderFilter(
  browse: {
    readonly pathInput: string;
    readonly setPathInput: (path: string) => void;
    readonly navigateToBrowsePath: NavigateToBrowsePath;
  },
  platform: string,
  pinnedDirectoryName = "",
): FolderFilter {
  const [value, setValue] = useState("");
  const folder = getFilesystemBrowsePath(browse.pathInput, platform).directoryPath;
  return {
    folder,
    value,
    browsePath: `${folder}${value}`,
    onChange: (text) => {
      const typed = typedFolderFilter(folder, text, platform);
      if (typed.folder !== folder) {
        browse.setPathInput(getCloneDestinationPath(typed.folder, pinnedDirectoryName));
      }
      setValue(typed.filter);
    },
    navigateToBrowsePath: (input) => {
      setValue("");
      return browse.navigateToBrowsePath(input);
    },
  };
}

// Not SearchField: its appearance hooks pull native modules into AddProjectScreen's tests.
export function FolderBrowseField(props: { readonly path: string; readonly filter: FolderFilter }) {
  return (
    <View className="gap-2">
      <ListSection>
        <View accessible accessibilityLabel={`Folder, ${props.path || "none"}`}>
          <ListRowLayout icon="folder" label="Folder" description={props.path || "None"} />
        </View>
      </ListSection>
      <AppTextInput
        accessibilityLabel="Filter folders or enter a path"
        placeholder="Filter folders or enter a path"
        value={props.filter.value}
        onChangeText={props.filter.onChange}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="done"
      />
    </View>
  );
}
