import { Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";

/** Project work stays in the library; settings provide configuration and storage entry points. */
export function ProjectSettingsLanding() {
  const { groups, selectScope, search } = useSettingsScope();
  const choices = search.machine
    ? groups.filter((group) =>
        group.memberProjects.some((member) => member.environmentId === search.machine),
      )
    : groups;
  return (
    <SettingsPageContainer>
      <SettingsSection id="project-overview" title="Projects" hideTitle>
        <SettingsRow
          title="Working files"
          description="Choose whether each project's working files stay on a computer after you settle work."
          control={
            <Button
              size="sm"
              variant="outline"
              render={
                <Link
                  to="/settings/project-files"
                  search={{ project: undefined, machine: undefined, checkout: undefined }}
                />
              }
            >
              Manage working files
            </Button>
          }
        />
        <SettingsRow
          title="Computer folder settings"
          description={
            choices.length === 0
              ? search.machine
                ? "No projects on this computer. Choose another computer above."
                : "Register a working folder to configure its local actions."
              : "Choose a computer folder to configure its icon and local actions."
          }
          control={
            <Select<string>
              items={choices.map((group) => ({
                value: group.projectKey,
                label: group.displayName,
              }))}
              value={null}
              onValueChange={(value) => {
                if (value) selectScope({ ...search, project: value, checkout: undefined });
              }}
            >
              <SelectTrigger size="sm" disabled={choices.length === 0} aria-label="Choose a folder">
                <SelectValue placeholder="Choose a folder" />
              </SelectTrigger>
              <SelectPopup>
                {choices.map((group) => (
                  <SelectItem key={group.projectKey} value={group.projectKey}>
                    {group.displayName}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
