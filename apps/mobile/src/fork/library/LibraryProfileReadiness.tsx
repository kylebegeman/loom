import { useAtomValue } from "@effect/atom-react";
import {
  libraryProfileDifferenceText,
  libraryToolCheckText,
  libraryToolCheckTone,
  supportsLoomFeature,
  type LibraryToolCheckTone,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_PROFILE_READINESS_FEATURE,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { View } from "react-native";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { LibraryReadFailure } from "./LibraryCopyHealth";
import { library, useRefreshOnRefocus } from "./libraryState";

const TONE_SYMBOLS: Record<LibraryToolCheckTone, AppSymbolName> = {
  ok: "checkmark.circle",
  problem: "xmark.circle.fill",
  unknown: "exclamationmark.circle",
};

function useSupportsReadiness(environmentId: EnvironmentId) {
  return supportsLoomFeature(
    useEnvironmentServerConfig(environmentId)?.environment.capabilities,
    LIBRARY_PROFILE_READINESS_FEATURE,
  );
}

const requiresSomething = (project: LibraryProject) =>
  (project.profile?.requiredTools?.length ?? 0) + (project.profile?.secretNames?.length ?? 0) > 0;

/**
 * The project's required tools as checked on one computer, plus the secret names to set there.
 * Shows nothing when the project requires nothing or the computer cannot check.
 */
export function LibraryProfileReadiness(props: {
  environmentId: EnvironmentId;
  project: LibraryProject;
}) {
  const supported = useSupportsReadiness(props.environmentId);
  return supported && requiresSomething(props.project) ? (
    <ReadinessChecklist environmentId={props.environmentId} project={props.project} />
  ) : null;
}

/**
 * A copy's readiness on its computer, and where its local settings differ from the project's
 * setup with a way to replace them. Local settings change only when someone chooses to apply the
 * setup. Computers that cannot check profiles show nothing.
 */
export function LibraryCopyProfileSetup(props: {
  project: LibraryProject;
  copy: LibraryWorkingCopy;
}) {
  const supported = useSupportsReadiness(props.copy.environmentId);
  const profile = props.project.profile;
  if (!supported) return null;
  return (
    <>
      {requiresSomething(props.project) ? (
        <ReadinessChecklist environmentId={props.copy.environmentId} project={props.project} />
      ) : null}
      {profile?.scripts?.length || profile?.defaultModelSelection ? (
        <SettingsDifferences project={props.project} copy={props.copy} />
      ) : null}
    </>
  );
}

function ReadinessChecklist(props: { environmentId: EnvironmentId; project: LibraryProject }) {
  const readiness = useEnvironmentQuery(
    library.profileReadiness({
      environmentId: props.environmentId,
      input: { projectId: props.project.id, profile: props.project.profile ?? {} },
    }),
  );
  useRefreshOnRefocus(readiness.refresh);
  const data = readiness.data;
  const failure = readiness.error ? (
    <LibraryReadFailure
      message="Could not check required tools."
      retrying={readiness.isPending}
      onRetry={readiness.refresh}
    />
  ) : null;
  if (data === null)
    return (
      failure ??
      (readiness.isPending ? (
        <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
          Checking required tools…
        </Text>
      ) : null)
    );
  return (
    <View className="gap-1.5">
      {data.checks.length > 0 ? (
        <View accessibilityLabel="Required tools" className="gap-1">
          {data.checks.map((check) => {
            const tone = libraryToolCheckTone(check);
            return (
              <View key={check.id} className="flex-row items-center gap-2">
                <SymbolView
                  name={TONE_SYMBOLS[tone]}
                  size={14}
                  tintColorClassName={
                    tone === "ok" ? "accent-icon-muted" : "accent-warning-foreground"
                  }
                />
                <Text
                  className={cn(
                    "min-w-0 shrink text-xs",
                    tone === "ok" ? "text-foreground-muted" : "text-warning-foreground",
                  )}
                >
                  {libraryToolCheckText(check)}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {data.secrets.length > 0 ? (
        <Text className="text-xs text-foreground-muted">
          Set {data.secrets.length === 1 ? "this secret" : "these secrets"} on this computer:{" "}
          {data.secrets.map((secret) => secret.name).join(", ")}
        </Text>
      ) : null}
      {failure}
    </View>
  );
}

function SettingsDifferences(props: { project: LibraryProject; copy: LibraryWorkingCopy }) {
  const { copy } = props;
  const settings = useEnvironmentQuery(
    library.profileSettings({
      environmentId: copy.environmentId,
      input: { workingCopyId: copy.id, profile: props.project.profile ?? {} },
    }),
  );
  useRefreshOnRefocus(settings.refresh);
  const apply = useAtomCommand(library.applyProfile, { reportFailure: false });
  const canApply = useAtomValue(library.applyProfile.permissionAtom(copy.environmentId));
  const [applying, setApplying] = useState(false),
    [error, setError] = useState<string | null>(null);
  const data = settings.data;
  // Hiding a failed comparison would read the same as settings that already match.
  const failure = settings.error ? (
    <LibraryReadFailure
      message="Could not compare this copy's settings with the project setup."
      retrying={settings.isPending}
      onRetry={settings.refresh}
    />
  ) : null;
  if (data === null || data.reviewToken === null || data.projects.length === 0) return failure;
  const reviewToken = data.reviewToken;
  const named = data.projects.length > 1;
  async function applySetup() {
    setApplying(true);
    setError(null);
    const result = await apply({
      environmentId: copy.environmentId,
      input: { workingCopyId: copy.id, profile: props.project.profile ?? {}, reviewToken },
    });
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not use the project setup.");
    }
    setApplying(false);
    settings.refresh();
  }
  return (
    <View className="gap-1.5">
      <Text className="text-xs text-foreground-muted">This copy has its own settings:</Text>
      {data.projects.flatMap((local) =>
        local.differences.map((difference) => (
          <Text
            key={`${local.localProjectId}:${difference.field}`}
            className="text-xs text-foreground-muted"
          >
            {named ? <Text className="text-xs text-foreground">{local.title} · </Text> : null}
            {libraryProfileDifferenceText(difference)}
          </Text>
        )),
      )}
      {canApply ? (
        <Button
          label={applying ? "Applying…" : "Use the project setup"}
          tone="text"
          disabled={applying}
          onPress={() => void applySetup()}
        />
      ) : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" className="text-xs text-danger-foreground">
          {error}
        </Text>
      ) : null}
      {failure}
    </View>
  );
}
