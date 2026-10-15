import { useLibraryAuthority } from "~/fork/project-library/state";
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
import { BrowseProjectsButton } from "./BrowseProjectsButton";

/** Project work stays in the library; settings provide configuration and storage entry points. */
export function ProjectSettingsLanding() {
  const library = useLibraryAuthority();
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
          title="Project library"
          description={
            library.authorityId
              ? "Edit your shared brief and resources, and browse project conversations."
              : "Browse projects and their threads."
          }
          control={<BrowseProjectsButton />}
        />
        <SettingsRow
          title="Files on computers"
          description="Choose whether each project's working files stay on a computer after you settle work."
          control={
            <Button size="sm" variant="outline" render={<Link to="/projects/storage" />}>
              Manage working files
            </Button>
          }
        />
        <SettingsRow
          title={library.authorityId ? "Local folder settings" : "Project settings"}
          description={
            choices.length === 0
              ? search.machine
                ? "No projects on this computer. Choose another computer above."
                : "Add a project to configure its name, icon and actions."
              : "Choose a project to configure its name, icon and actions."
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
              <SelectTrigger
                size="sm"
                disabled={choices.length === 0}
                aria-label={library.authorityId ? "Choose a local folder" : "Choose a project"}
              >
                <SelectValue
                  placeholder={library.authorityId ? "Choose a local folder" : "Choose a project"}
                />
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
