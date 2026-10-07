import { SettingsPageContainer, SettingsSection } from "~/components/settings/settingsLayout";
import { FORK_SETTINGS_SECTIONS } from "./registry";
export function LoomSettingsPage() {
  return (
    <SettingsPageContainer>
      {FORK_SETTINGS_SECTIONS.map(({ id, title, Component }) => (
        <SettingsSection key={id} id={`loom-${id}`} title={title}>
          <Component />
        </SettingsSection>
      ))}
    </SettingsPageContainer>
  );
}
