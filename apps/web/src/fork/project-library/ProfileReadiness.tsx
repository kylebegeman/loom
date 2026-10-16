import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_PROFILE_READINESS_FEATURE,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  libraryProfileDifferenceText,
  libraryToolCheckText,
  libraryToolCheckTone,
  supportsLoomFeature,
  type LibraryToolCheckTone,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CheckIcon, CircleHelpIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryErrorNotice } from "./LibraryControls";
import { projectLibrary, useLibraryPermission } from "./state";

const TONE_ICONS: Record<LibraryToolCheckTone, typeof CheckIcon> = {
  ok: CheckIcon,
  problem: XIcon,
  unknown: CircleHelpIcon,
};

/** Whether a computer checks profiles itself. Older computers show nothing. */
function useSupportsReadiness(environmentId: EnvironmentId) {
  const { environments } = useEnvironments();
  return supportsLoomFeature(
    environments.find((entry) => entry.environmentId === environmentId)?.serverConfig?.environment
      .capabilities,
    LIBRARY_PROFILE_READINESS_FEATURE,
  );
}

/**
 * The project's required tools as checked on one computer, plus the secret names to set there.
 * Renders nothing when the project requires nothing or the computer cannot check.
 */
export function ProfileReadiness({
  environmentId,
  project,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: LibraryProject;
}) {
  const supported = useSupportsReadiness(environmentId);
  const required =
    (project.profile?.requiredTools?.length ?? 0) + (project.profile?.secretNames?.length ?? 0) > 0;
  return supported && required ? (
    <ReadinessChecklist environmentId={environmentId} project={project} />
  ) : null;
}

function ReadinessChecklist({
  environmentId,
  project,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: LibraryProject;
}) {
  const readiness = useEnvironmentQuery(
    projectLibrary.profileReadiness({
      environmentId,
      input: { projectId: project.id, profile: project.profile ?? {} },
    }),
  );
  const data = readiness.data;
  if (data === null)
    return readiness.error ? (
      <p className="text-xs text-muted-foreground">Could not check required tools.</p>
    ) : readiness.isPending ? (
      <p role="status" className="text-xs text-muted-foreground">
        Checking required tools...
      </p>
    ) : null;
  return (
    <div className="space-y-0.5 text-xs">
      {data.checks.length > 0 ? (
        <ul aria-label="Required tools" className="flex flex-wrap gap-x-3 gap-y-0.5">
          {data.checks.map((check) => {
            const tone = libraryToolCheckTone(check);
            const Icon = TONE_ICONS[tone];
            return (
              <li
                key={check.id}
                className={cn(
                  "flex items-center gap-1",
                  tone === "ok" ? "text-muted-foreground" : "text-warning-foreground",
                )}
              >
                <Icon
                  aria-hidden
                  className={cn("size-3 shrink-0", tone === "ok" && "text-success-foreground")}
                />
                {libraryToolCheckText(check)}
              </li>
            );
          })}
        </ul>
      ) : null}
      {data.secrets.length > 0 ? (
        <p className="text-muted-foreground">
          Set {data.secrets.length === 1 ? "this secret" : "these secrets"} on this computer:{" "}
          {data.secrets.map((secret) => secret.name).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A copy's readiness, and where its local settings differ from the project's setup with a way
 * to replace them. Local settings change only when someone chooses to apply the setup.
 */
export function CopyProfileSetup({
  project,
  copy,
}: {
  readonly project: LibraryProject;
  readonly copy: LibraryWorkingCopy;
}) {
  const supported = useSupportsReadiness(copy.environmentId);
  if (!supported) return null;
  return (
    <>
      <ProfileReadiness environmentId={copy.environmentId} project={project} />
      {project.profile?.scripts?.length || project.profile?.defaultModelSelection ? (
        <SettingsDifferences project={project} copy={copy} />
      ) : null}
    </>
  );
}

function SettingsDifferences({
  project,
  copy,
}: {
  readonly project: LibraryProject;
  readonly copy: LibraryWorkingCopy;
}) {
  const settings = useEnvironmentQuery(
    projectLibrary.profileSettings({
      environmentId: copy.environmentId,
      input: { workingCopyId: copy.id, profile: project.profile ?? {} },
    }),
  );
  const apply = useAtomCommand(projectLibrary.applyProfile, { reportFailure: false });
  const canApply = useLibraryPermission(projectLibrary.applyProfile, copy.environmentId);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = settings.data;
  if (data === null || data.reviewToken === null || data.projects.length === 0) return null;
  const reviewToken = data.reviewToken;
  const named = data.projects.length > 1;
  const applySetup = async () => {
    setApplying(true);
    setError(null);
    const result = await apply({
      environmentId: copy.environmentId,
      input: { workingCopyId: copy.id, profile: project.profile ?? {}, reviewToken },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not use the project setup.");
    }
    setApplying(false);
    settings.refresh();
  };
  return (
    <div className="space-y-1 text-xs">
      <p className="text-muted-foreground">This copy has its own settings:</p>
      <ul className="space-y-0.5 text-muted-foreground">
        {data.projects.flatMap((local) =>
          local.differences.map((difference) => (
            <li key={`${local.localProjectId}:${difference.field}`}>
              {named ? <span className="text-foreground">{local.title} · </span> : null}
              {libraryProfileDifferenceText(difference)}
            </li>
          )),
        )}
      </ul>
      {canApply ? (
        <Button
          shape="pill"
          size="xs"
          variant="outline"
          disabled={applying}
          onClick={() => void applySetup()}
        >
          {applying ? "Applying..." : "Use the project setup"}
        </Button>
      ) : null}
      <LibraryErrorNotice error={error} />
    </div>
  );
}
