import { expect, it } from "vite-plus/test";
import { filterSettingsSections } from "../../features/settings/settings-search";

it("finds existing mobile settings from their Loom feature names", () => {
  const sections = [
    {
      rows: [
        { id: "SettingsEnvironments", label: "Computers" },
        { id: "SettingsNotifications", label: "Notifications" },
        { id: "SettingsPreviewLinks", label: "Previews" },
      ],
    },
  ];
  for (const [query, id] of [
    ["library computers", "SettingsEnvironments"],
    ["library push", "SettingsNotifications"],
    ["published pages", "SettingsPreviewLinks"],
  ]) {
    expect(
      filterSettingsSections(sections, query!).flatMap((section) =>
        section.rows.map((row) => row.id),
      ),
    ).toEqual([id]);
  }
});
