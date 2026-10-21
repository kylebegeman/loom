import { EnvironmentId } from "@t3tools/contracts";
import { FolderProjectSettings } from "../../fork/project-library/FolderProjectSettings";
import { LayersIcon } from "lucide-react";

import { Button } from "../ui/button";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel";
import { useSettingsScope } from "./SettingsScopeContext";
import { ProjectSettingsLanding } from "../../fork/project-home/ProjectSettingsLanding"; // fork: project-home
import { SettingsPageContainer } from "./settingsLayout";
import { ALL_ENVIRONMENTS_VALUE, selectEnvironmentAxis } from "./settingsScopeAxis";

export function ProjectsSettings() {
  const { search: value, scope, groups, selectScope } = useSettingsScope();
  const unavailable =
    scope.kind === "unavailable" ? (
      <SettingsPageContainer>
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">{scope.message}</p>
          {value.machine || value.checkout ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => selectScope(selectEnvironmentAxis(value, ALL_ENVIRONMENTS_VALUE))}
            >
              <LayersIcon />
              Show all environments
            </Button>
          ) : null}
        </div>
      </SettingsPageContainer>
    ) : null;
  // Keep the panel mounted so it can follow members when regrouping changes the project key.
  const projectScope =
    scope.kind === "project" ||
    scope.kind === "checkout" ||
    (scope.kind === "unavailable" &&
      (scope.reason === "project-missing" || scope.reason === "checkout-missing"));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {value.project && projectScope ? (
        <FolderProjectSettings
          members={
            groups
              .find((group) => group.projectKey === value.project)
              ?.memberProjects.filter(
                (member) =>
                  (!value.machine || member.environmentId === value.machine) &&
                  (!value.checkout || member.physicalProjectKey === value.checkout),
              ) ?? []
          }
          explicitFolder={!!value.checkout}
        >
          {(projectId) => (
            <ProjectSettingsPanel
              showFileControls={projectId === null}
              projectKey={value.project!}
              environmentId={value.machine ? EnvironmentId.make(value.machine) : null}
              checkoutKey={value.checkout ?? null}
              unavailable={unavailable}
            />
          )}
        </FolderProjectSettings>
      ) : unavailable ? (
        unavailable
      ) : (
        <ProjectSettingsLanding />
      )}
    </div>
  );
}
