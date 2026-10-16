import { libraryProjectColor, libraryProjectInitials } from "@t3tools/client-runtime/fork";
import type { LibraryProject, LibraryProjectColor } from "@t3tools/contracts/fork";
import { View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { useAppearancePreferences } from "../../features/settings/appearance/AppearancePreferencesProvider";

/** Readable text color for each named project color, per appearance. */
const LIBRARY_PROJECT_COLOR_VALUES: Record<
  LibraryProjectColor,
  { readonly light: string; readonly dark: string }
> = {
  plum: { light: "#8a4bb5", dark: "#c9a2ec" },
  red: { light: "#c8423c", dark: "#f28b82" },
  orange: { light: "#c2620f", dark: "#f5a25d" },
  gold: { light: "#a07a00", dark: "#e3c35a" },
  green: { light: "#2e8a53", dark: "#72cf96" },
  teal: { light: "#16848a", dark: "#5fcfcf" },
  blue: { light: "#3a67d0", dark: "#93b3f7" },
  slate: { light: "#667286", dark: "#aab5c6" },
};

/** Hex alpha suffix for tile backgrounds, about 14% opacity. */
const TILE_ALPHA = "24";

/** Resolves a named project color for the current light or dark appearance. */
export function useLibraryProjectColorValue() {
  const { themeAppearance } = useAppearancePreferences();
  return (color: LibraryProjectColor) => LIBRARY_PROJECT_COLOR_VALUES[color][themeAppearance];
}

/** A rounded-square monogram tinted with the project's saved or automatic color. */
export function LibraryProjectTile({
  project,
}: {
  project: Pick<LibraryProject, "id" | "title" | "color">;
}) {
  const color = useLibraryProjectColorValue()(libraryProjectColor(project));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="size-9 items-center justify-center rounded-lg"
      style={{ backgroundColor: `${color}${TILE_ALPHA}` }}
    >
      <Text className="text-sm font-t3-medium" style={{ color }}>
        {libraryProjectInitials(project.title)}
      </Text>
    </View>
  );
}
