import { libraryNewFolderPath } from "@t3tools/client-runtime/fork";
import { resolveAddProjectPath } from "@t3tools/client-runtime/operations/projects";
import type { EnvironmentId } from "@t3tools/contracts";
import { View } from "react-native";

import { AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import {
  FolderBrowser,
  platformFromOs,
  useBrowsePathInput,
} from "../../features/projects/AddProjectScreen";
import { useServerConfigs } from "../../state/entities";

/**
 * Browses folders on the chosen computer, starting in its Projects folder; typing still works.
 * With a project title it also offers a new folder for the project inside the browsed one.
 */
export function LibraryFolderPicker(props: {
  environmentId: EnvironmentId;
  projectTitle?: string;
  disabled: boolean;
  onChoose: (path: string) => void;
}) {
  const config = useServerConfigs().get(props.environmentId);
  const environment = {
    environmentId: props.environmentId,
    platform: platformFromOs(config?.environment.platform.os ?? null),
    baseDirectory:
      config?.folders?.projects ??
      config?.newProjectsRoot ??
      config?.settings.addProjectBaseDirectory ??
      null,
  };
  const { isBrowseNavigating, navigateToBrowsePath, pathInput, setPathInput } =
    useBrowsePathInput(environment);
  const resolved = resolveAddProjectPath({ rawPath: pathInput, platform: environment.platform });
  const trimmed = resolved.ok ? resolved.path.replace(/[\\/]+$/, "") : "";
  const chosen =
    resolved.ok && (trimmed === "" || /^[a-z]:$/i.test(trimmed)) ? resolved.path : trimmed;
  return (
    <View className="gap-2">
      <TextInput
        accessibilityLabel="Folder on selected computer"
        placeholder="Folder on this computer"
        value={pathInput}
        onChangeText={setPathInput}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!props.disabled}
        className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
      />
      <Button
        label="Use this folder"
        disabled={props.disabled || isBrowseNavigating || !resolved.ok}
        onPress={() => {
          if (resolved.ok) props.onChoose(chosen);
        }}
      />
      {props.projectTitle ? (
        <Button
          label="Download into a new folder here"
          tone="text"
          disabled={props.disabled || isBrowseNavigating || !resolved.ok}
          onPress={() => {
            if (resolved.ok && props.projectTitle)
              props.onChoose(libraryNewFolderPath(chosen, props.projectTitle));
          }}
        />
      ) : null}
      <FolderBrowser
        environment={environment}
        navigateToBrowsePath={navigateToBrowsePath}
        pathInput={pathInput}
        setPathInput={setPathInput}
      />
    </View>
  );
}
