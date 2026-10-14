import { useAtomValue } from "@effect/atom-react";
import { createProjectCheckoutAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ListChoiceRow } from "../../components/ListChoiceRow";
import { MaterialButton } from "../../components/MaterialButton";
import { connectionAtomRuntime } from "../../connection/runtime";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentServerConfig } from "../../state/entities";
import { environmentPresentations, useEnvironmentPresentation } from "../../state/presentation";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";

const checkout = createProjectCheckoutAtoms(connectionAtomRuntime);
type Retention = ProjectCheckoutPreview["retention"];
type Props = {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly computerLabel: string;
};

const retentionLabels: Record<Retention, string> = {
  keep: "Keep on this computer",
  "release-on-settle": "Release when settled",
  inherit: "Use computer's default",
};

/** A review belongs to one checkout, even when the settings filter changes hosts. */
export function ProjectCheckoutSection(props: Props) {
  const config = useEnvironmentServerConfig(props.environmentId);
  const { presentation } = useEnvironmentPresentation(props.environmentId);
  const connected =
    presentation?.entry.enabled === true && presentation.connection.phase === "connected";
  const computerConnected = () => {
    const current = appAtomRegistry.get(
      environmentPresentations.presentationAtom(props.environmentId),
    );
    return current?.entry.enabled === true && current.connection.phase === "connected";
  };
  const supported = supportsLoomFeature(
    config?.environment.capabilities,
    "project-checkout-management",
  );
  const canRead = useEnvironmentScope(props.environmentId, AuthOrchestrationReadScope);
  const canAdopt = useAtomValue(checkout.adopt.permissionAtom(props.environmentId));
  const canSetRetention = useAtomValue(checkout.setRetention.permissionAtom(props.environmentId));
  return (
    <ProjectCheckoutReview
      // Any loss of access invalidates the old confirmation and in-flight review.
      key={`${props.environmentId}:${props.projectId}:${props.workspaceRoot}:${supported}:${canRead}:${canAdopt}:${canSetRetention}:${connected}`}
      {...props}
      connected={connected}
      computerConnected={computerConnected}
      configReady={config != null}
      supported={supported}
      canRead={canRead}
      canAdopt={canAdopt}
      canSetRetention={canSetRetention}
    />
  );
}

function ProjectCheckoutReview({
  environmentId,
  projectId,
  workspaceRoot,
  computerLabel,
  configReady,
  connected,
  computerConnected,
  supported,
  canRead,
  canAdopt,
  canSetRetention,
}: Props & {
  readonly configReady: boolean;
  readonly connected: boolean;
  readonly computerConnected: () => boolean;
  readonly supported: boolean;
  readonly canRead: boolean;
  readonly canAdopt: boolean;
  readonly canSetRetention: boolean;
}) {
  const reviewFolder = useAtomQueryRunner(checkout.preview, {
    reportFailure: false,
    refresh: true,
  });
  const adopt = useAtomCommand(checkout.adopt, { reportFailure: false });
  const setRetention = useAtomCommand(checkout.setRetention, { reportFailure: false });
  const [preview, setPreview] = useState<ProjectCheckoutPreview | null>(null);
  const [retention, setChoice] = useState<Retention>("keep");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<"review" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const generation = useRef(0);
  const managed = preview?.ownershipSource != null;
  const allowed = managed ? canSetRetention : canAdopt;
  const ready = connected && supported && canRead;
  const token = preview?.reviewToken;
  const canChange = ready && allowed && token != null && preview?.state !== "blocked";
  const changed = !managed || retention !== preview?.retention;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  function stillCurrent(request: number) {
    return mounted.current && request === generation.current;
  }

  async function review() {
    if (
      busy.current ||
      !mounted.current ||
      !ready ||
      !computerConnected() ||
      !readEnvironmentScope(environmentId, AuthOrchestrationReadScope)
    )
      return;
    busy.current = true;
    const request = ++generation.current;
    setPending("review");
    setPreview(null);
    setConfirming(false);
    setError(null);
    setNotice(null);
    try {
      const result = await reviewFolder({ environmentId, input: { projectId } });
      if (!stillCurrent(request)) return;
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      if (result.value.projectId !== projectId)
        throw new Error("The project changed. Review the folder again.");
      setPreview(result.value);
      setChoice(result.value.ownershipSource == null ? "keep" : result.value.retention);
    } catch (cause) {
      if (stillCurrent(request))
        setError(
          cause instanceof Error ? cause.message : "The folder could not be reviewed. Try again.",
        );
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  async function save() {
    if (
      busy.current ||
      !mounted.current ||
      !confirming ||
      !canChange ||
      !changed ||
      !preview ||
      !token ||
      !computerConnected() ||
      !appAtomRegistry.get(
        (managed ? checkout.setRetention : checkout.adopt).permissionAtom(environmentId),
      )
    )
      return;
    busy.current = true;
    const request = ++generation.current;
    setPending("save");
    setError(null);
    setNotice(null);
    try {
      const result = managed
        ? await setRetention({ environmentId, input: { projectId, reviewToken: token, retention } })
        : await adopt({
            environmentId,
            input: {
              projectId,
              reviewToken: token,
              retention: retention === "release-on-settle" ? retention : "keep",
            },
          });
      if (!stillCurrent(request)) return;
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      setPreview(result.value);
      setChoice(result.value.retention);
      setConfirming(false);
      setNotice(managed ? "Checkout storage preference saved." : "Loom now manages this checkout.");
    } catch (cause) {
      if (!stillCurrent(request)) return;
      // Failed or stale reviews must be refreshed before another mutation.
      setPreview(null);
      setConfirming(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "The storage preference could not be saved. Review the folder and try again.",
      );
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  return (
    <SettingsSection
      title={`Project storage · ${computerLabel}`}
      footer="This manages the project's main folder. Worktree cleanup has separate settings. Loom releases only published, idle checkouts after checking local files and active work. Starting work in a released project restores its files and setup."
    >
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">
          {!connected
            ? "Reconnect this computer to review and manage project storage."
            : !configReady
              ? "Loading this computer's capabilities…"
              : !supported
                ? "Update Loom on this computer to review and manage project storage."
                : !canRead
                  ? "Project read permission is required to review this folder."
                  : !allowed
                    ? "Settings permission is required to manage project storage."
                    : preview?.state === "released"
                      ? "This checkout has been released. Your project and conversations remain in Loom."
                      : managed
                        ? "Loom manages this checkout. Choose when its working files should stay on this computer."
                        : "Review this existing folder before letting Loom manage its working files."}
        </Text>
        <Text selectable className="text-sm leading-normal text-foreground-muted">
          {preview?.workspaceRoot ?? workspaceRoot}
        </Text>
        {preview ? (
          <>
            {preview.branch ? (
              <Text className="text-sm text-foreground-muted">Branch: {preview.branch}</Text>
            ) : null}
            <Text className="text-sm text-foreground-muted">
              {preview.state === "released"
                ? "Working files are currently released."
                : `${preview.localFiles.trackedChanges} changed, ${preview.localFiles.untrackedFiles} new and ${preview.localFiles.ignoredFiles} ignored files${preview.localFiles.truncated ? " (partial count)" : ""}.`}
            </Text>
            {[...new Set(preview.blockers)].map((blocker) => (
              <Text key={blocker} className="text-sm text-foreground-muted">
                {blocker}
              </Text>
            ))}
            {preview.state === "blocked" || token == null ? (
              <Text className="text-sm text-foreground-muted">
                Resolve the issues above, then review this folder again.
              </Text>
            ) : null}
          </>
        ) : null}
        {confirming ? (
          <View className="gap-3">
            <Text className="text-base font-t3-medium text-foreground">
              {managed ? "Confirm storage preference" : "Let Loom manage this folder?"}
            </Text>
            <Text className="text-sm text-foreground-muted">{retentionLabels[retention]}</Text>
            <Text className="text-sm text-foreground-muted">
              {retention === "release-on-settle"
                ? "An already settled checkout can be released as soon as it passes safety checks. Unpublished changes and local-only files keep it on disk."
                : retention === "keep"
                  ? preview?.state === "released"
                    ? "Loom will restore this project's main folder now and keep it on this computer. Project setup runs when you next start agent work."
                    : "This checkout stays on this computer until you change its preference."
                  : "This checkout follows this computer's release settings, including already settled eligible work."}
            </Text>
            <Text className="text-sm text-foreground-muted">
              Your project name and conversations stay in Loom. The folder keeps its current path.
              Keep permanent application data and configuration outside disposable project storage.
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <MaterialButton
                label={
                  pending === "save"
                    ? "Saving…"
                    : managed
                      ? "Confirm preference"
                      : "Confirm management"
                }
                tone="primary"
                disabled={!canChange || pending !== null}
                onPress={() => {
                  void save();
                }}
              />
              <MaterialButton
                label="Back to review"
                disabled={pending !== null}
                onPress={() => setConfirming(false)}
              />
            </View>
          </View>
        ) : preview && canChange ? (
          <>
            <ListChoiceRow
              label={retentionLabels.keep}
              description="Keep the checkout available locally, even after settling."
              selected={retention === "keep"}
              disabled={pending !== null}
              onPress={() => setChoice("keep")}
            />
            <ListChoiceRow
              label={retentionLabels["release-on-settle"]}
              description="Release safe working files after settling. Restore them when you return."
              selected={retention === "release-on-settle"}
              disabled={pending !== null}
              onPress={() => setChoice("release-on-settle")}
            />
            {managed ? (
              <ListChoiceRow
                label={retentionLabels.inherit}
                description="Follow this computer's project release settings."
                selected={retention === "inherit"}
                disabled={pending !== null}
                onPress={() => setChoice("inherit")}
              />
            ) : null}
            <MaterialButton
              label={managed ? "Review preference change" : "Review management"}
              tone="primary"
              disabled={!changed || pending !== null}
              onPress={() => setConfirming(true)}
            />
          </>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
            {notice}
          </Text>
        ) : null}
        {error ? (
          <Text selectable accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
        {!confirming ? (
          <View className="flex-row flex-wrap gap-2">
            <MaterialButton
              label={
                pending === "review"
                  ? "Reviewing…"
                  : preview
                    ? "Review folder again"
                    : error
                      ? "Retry folder review"
                      : "Review folder"
              }
              disabled={!ready || pending !== null}
              onPress={() => {
                void review();
              }}
            />
            {preview ? (
              <MaterialButton
                label="Cancel review"
                disabled={pending !== null}
                onPress={() => {
                  setPreview(null);
                  setNotice(null);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}
