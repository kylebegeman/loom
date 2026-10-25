import { useAtomValue } from "@effect/atom-react";
import { ListRow } from "../../components/ui/ListRow";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadSelection } from "../../state/use-thread-selection";
import { serverEnvironment } from "../../state/server";

export function DefaultBranchPreference() {
  const { selectedThreadProject: project, selectedEnvironmentRuntime } = useThreadSelection();
  const overrides = project
    ? selectedEnvironmentRuntime?.serverConfig?.settings.projectSettingsOverrides[project.id]
    : undefined;
  const canUpdate = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(project?.environmentId ?? null),
  );
  const update = useAtomCommand(serverEnvironment.updateSettings);
  if (!project || !overrides?.skipDefaultBranchConfirmation || !canUpdate) return null;
  return (
    <ListRow
      label="Ask before default branch actions"
      onPress={() => {
        void update({
          environmentId: project.environmentId,
          input: {
            patch: {
              projectSettingsOverrides: {
                [project.id]: { ...overrides, skipDefaultBranchConfirmation: false },
              },
            },
          },
        });
      }}
    />
  );
}
