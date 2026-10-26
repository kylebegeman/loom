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

/** Browses folders on the chosen computer, starting in its Projects folder; typing still works. */
export function LibraryFolderPicker(props: {
  environmentId: EnvironmentId;
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
          if (!resolved.ok) return;
          const trimmed = resolved.path.replace(/[\\/]+$/, "");
          props.onChoose(trimmed === "" || /^[a-z]:$/i.test(trimmed) ? resolved.path : trimmed);
        }}
      />
      <FolderBrowser
        environment={environment}
        navigateToBrowsePath={navigateToBrowsePath}
        pathInput={pathInput}
        setPathInput={setPathInput}
      />
    </View>
  );
}
