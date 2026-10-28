import { StackActions, useNavigation } from "@react-navigation/native";
import { View } from "react-native";
import type { AppSymbolName } from "../../components/ui/AppSymbol";
import { ListRow } from "../../components/ui/ListRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { LibraryPage } from "./LibraryPage";

/** How a new project starts. The form leads with the part each choice needs. */
export type LibraryCreateStart = "empty" | "folder" | "repository";

const CHOICES: ReadonlyArray<{
  readonly start: LibraryCreateStart;
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly description: string;
}> = [
  {
    start: "empty",
    icon: "plus",
    label: "Empty project",
    description: "Start with a name. Add repositories, links or folders now or later.",
  },
  {
    start: "folder",
    icon: "folder.badge.plus",
    label: "Existing folder",
    description: "Use files already on a connected computer. They stay where they are.",
  },
  {
    start: "repository",
    icon: "arrow.triangle.branch",
    label: "Git repository",
    description: "Paste a Git URL. Loom clones it onto a computer when you start work.",
  },
];

export function LibraryNewProjectChoices() {
  const navigation = useNavigation();
  return (
    <LibraryPage title="New project" back>
      <SettingsSection>
        {CHOICES.map((choice, index) => (
          <View
            key={choice.start}
            className={index > 0 ? "border-t border-border-subtle" : undefined}
          >
            <ListRow
              icon={choice.icon}
              label={choice.label}
              description={choice.description}
              // Replaced rather than pushed: saving replaces the form too, so Back from the new
              // project returns to where New project was opened instead of to this choice.
              onPress={() =>
                navigation.dispatch(StackActions.replace("LibraryCreate", { start: choice.start }))
              }
            />
          </View>
        ))}
      </SettingsSection>
    </LibraryPage>
  );
}
