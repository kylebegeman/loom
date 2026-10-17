import { useAtomValue } from "@effect/atom-react";
import {
  libraryProfileDifferenceText,
  libraryToolCheckText,
  libraryToolCheckTone,
  supportsLoomFeature,
  type LibraryToolCheckTone,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
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
import { library } from "./libraryState";

const TONE_SYMBOLS: Record<LibraryToolCheckTone, AppSymbolName> = {
  ok: "checkmark.circle",
  problem: "xmark.circle.fill",
  unknown: "exclamationmark.circle",
};

/**
 * A copy's readiness on its computer, and where its local settings differ from the project's
 * setup with a way to replace them. Local settings change only when someone chooses to apply the
 * setup. Computers that cannot check profiles show nothing.
 */
export function LibraryCopyProfileSetup(props: {
  project: LibraryProject;
  copy: LibraryWorkingCopy;
}) {
  const config = useEnvironmentServerConfig(props.copy.environmentId);
  const supported = supportsLoomFeature(
    config?.environment.capabilities,
    LIBRARY_PROFILE_READINESS_FEATURE,
  );
  const profile = props.project.profile;
  if (!supported) return null;
  const required = (profile?.requiredTools?.length ?? 0) + (profile?.secretNames?.length ?? 0) > 0;
  return (
    <>
      {required ? <ReadinessChecklist project={props.project} copy={props.copy} /> : null}
      {profile?.scripts?.length || profile?.defaultModelSelection ? (
        <SettingsDifferences project={props.project} copy={props.copy} />
      ) : null}
    </>
  );
}

function ReadinessChecklist(props: { project: LibraryProject; copy: LibraryWorkingCopy }) {
  const readiness = useEnvironmentQuery(
    library.profileReadiness({
      environmentId: props.copy.environmentId,
      input: { projectId: props.project.id, profile: props.project.profile ?? {} },
    }),
  );
  const data = readiness.data;
  if (data === null)
    return readiness.error ? (
      <Text className="text-xs text-foreground-muted">Could not check required tools.</Text>
    ) : readiness.isPending ? (
      <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
        Checking required tools…
      </Text>
    ) : null;
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
  const apply = useAtomCommand(library.applyProfile, { reportFailure: false });
  const canApply = useAtomValue(library.applyProfile.permissionAtom(copy.environmentId));
  const [applying, setApplying] = useState(false),
    [error, setError] = useState<string | null>(null);
  const data = settings.data;
  if (data === null || data.reviewToken === null || data.projects.length === 0) return null;
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
    </View>
  );
}
