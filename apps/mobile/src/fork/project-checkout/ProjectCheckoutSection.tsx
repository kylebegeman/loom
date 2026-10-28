import { useAtomValue } from "@effect/atom-react";
import {
  createProjectCheckoutAtoms,
  PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS,
  projectStorageRolloutStateLabel,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { Button } from "../../components/ui/Button";
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
  const retentionChoices = managed
    ? (["keep", "release-on-settle", "inherit"] as const)
    : (["keep", "release-on-settle"] as const);
  const allowed = managed ? canSetRetention : canAdopt;
  const ready = connected && supported && canRead;
  const token = preview?.reviewToken;
  const canChange = ready && allowed && token != null && preview?.state !== "blocked";
  const changed = !managed || retention !== preview?.retention;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks mount state and invalidates in-flight checkout requests on unmount
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
      setNotice(
        managed ? "Working file preference saved." : "Loom can now manage these working files.",
      );
    } catch (cause) {
      if (!stillCurrent(request)) return;
      // Failed or stale reviews must be refreshed before another mutation.
      setPreview(null);
      setConfirming(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "The file preference could not be saved. Review the files and try again.",
      );
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  return (
    <SettingsSection
      title={`Working files on ${computerLabel}`}
      footer="Loom keeps unpublished changes and local-only files here. If working files were removed, it restores them when work resumes. Additional worktrees have separate cleanup rules."
    >
      <View className="gap-3 px-4 py-3">
        <Text className="text-xs leading-normal text-foreground-muted">
          {!connected
            ? "Reconnect this computer to review its project files."
            : !configReady
              ? "Loading this computer's capabilities…"
              : !supported
                ? "Update Loom on this computer to review its project files."
                : !canRead
                  ? "Project read permission is required to review these files."
                  : !allowed
                    ? "Settings permission is required to manage these files."
                    : preview?.state === "released"
                      ? "These working files are no longer on this computer. Your project and conversations remain in Loom."
                      : managed
                        ? "Choose whether these working files stay on this computer. Your project and conversations stay in Loom."
                        : "These are the files you work on. Review their existing location before allowing Loom to manage them. Your project and conversations stay in Loom."}
        </Text>
        <View className="gap-1">
          <Text className="text-xs font-t3-medium text-foreground">Location</Text>
          <Text
            selectable
            numberOfLines={1}
            ellipsizeMode="middle"
            accessibilityLabel={preview?.workspaceRoot ?? workspaceRoot}
            className="text-xs text-foreground-muted"
          >
            {preview?.workspaceRoot ?? workspaceRoot}
          </Text>
        </View>
        {preview ? (
          <>
            <Text className="text-xs leading-normal text-foreground-muted">
              {projectStorageRolloutStateLabel(preview)}
            </Text>
            {preview.branch ? (
              <Text className="text-xs leading-normal text-foreground-muted">
                Branch: {preview.branch}
              </Text>
            ) : null}
            <Text className="text-xs leading-normal text-foreground-muted">
              {preview.state === "released"
                ? "Working files will be restored when you resume work."
                : `${preview.localFiles.trackedChanges} changed, ${preview.localFiles.untrackedFiles} new and ${preview.localFiles.ignoredFiles} ignored files${preview.localFiles.truncated ? " (partial count)" : ""}.`}
            </Text>
            {[...new Set(preview.blockers)].map((blocker) => (
              <Text key={blocker} className="text-xs leading-normal text-foreground-muted">
                {blocker}
              </Text>
            ))}
            {preview.state === "blocked" || token == null ? (
              <Text className="text-xs leading-normal text-foreground-muted">
                Resolve the issues above, then review this folder again.
              </Text>
            ) : null}
          </>
        ) : null}
        {confirming ? (
          <View className="gap-2">
            <Text className="text-sm font-t3-medium text-foreground">
              {managed ? "Confirm file preference" : "Allow Loom to manage these files?"}
            </Text>
            <Text selectable className="text-xs leading-normal text-foreground-muted">
              Location on {computerLabel}: {preview?.workspaceRoot ?? workspaceRoot}
            </Text>
            <Text className="text-sm font-t3-medium text-foreground">
              {PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[retention]}
            </Text>
            <Text className="text-xs leading-normal text-foreground-muted">
              {retention === "release-on-settle"
                ? "If work is already settled, Loom may remove this safe, published working copy as soon as safety checks pass. Unpublished changes and local-only files keep it here. Resume work to restore it."
                : retention === "keep"
                  ? preview?.state === "released"
                    ? "Loom will restore these working files now and keep them here. Project setup runs when you next start agent work."
                    : "These working files stay here until you change this preference."
                  : "These files follow this computer's default. Saving may free space for work that is already settled and passes safety checks."}
            </Text>
            <Text className="text-xs leading-normal text-foreground-muted">
              Your project and conversations stay in Loom. This location remains linked to the
              project. Keep permanent application data outside disposable working copies.
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={
                  pending === "save"
                    ? "Saving…"
                    : managed
                      ? "Save file preference"
                      : "Allow Loom to manage files"
                }
                tone="primary"
                disabled={!canChange || pending !== null}
                onPress={() => {
                  void save();
                }}
              />
              <Button
                label="Back to review"
                disabled={pending !== null}
                onPress={() => setConfirming(false)}
              />
            </View>
          </View>
        ) : preview && canChange ? (
          <>
            <Menu
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Working files preference for ${workspaceRoot} on ${computerLabel}. ${PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[retention]}`}
              title="Working files preference"
              actions={retentionChoices.map((choice) => ({
                id: choice,
                title: PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[choice],
                subtitle:
                  choice === "keep"
                    ? "Keep working files available here."
                    : choice === "release-on-settle"
                      ? "Remove a safe, published working copy after work settles."
                      : "Follow this computer's default for working files.",
                state: retention === choice ? ("on" as const) : ("off" as const),
                attributes: { disabled: pending !== null },
              }))}
              onPressAction={({ nativeEvent }) => {
                if (pending !== null) return;
                if (
                  nativeEvent.event === "keep" ||
                  nativeEvent.event === "release-on-settle" ||
                  (managed && nativeEvent.event === "inherit")
                )
                  setChoice(nativeEvent.event);
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Working files preference: ${PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[retention]}`}
                accessibilityState={{ disabled: pending !== null }}
                disabled={pending !== null}
                className="min-h-11 flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 active:opacity-70 disabled:opacity-40"
              >
                <Text className="text-xs text-foreground-muted">Working files</Text>
                <View className="flex-row items-center gap-2">
                  <Text className="text-sm text-primary-text">
                    {PROJECT_STORAGE_ROLLOUT_RETENTION_LABELS[retention]}
                  </Text>
                  <SymbolView
                    name="chevron.down"
                    size={12}
                    tintColorClassName="accent-primary-text"
                  />
                </View>
              </Pressable>
            </Menu>
            <Button
              label={managed ? "Review file preference" : "Review file management"}
              tone="primary"
              disabled={!changed || pending !== null}
              onPress={() => setConfirming(true)}
            />
          </>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
            {notice}
          </Text>
        ) : null}
        {error ? (
          <Text selectable accessibilityRole="alert" className="text-xs text-danger-foreground">
            {error}
          </Text>
        ) : null}
        {!confirming ? (
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={
                pending === "review"
                  ? "Reviewing…"
                  : preview
                    ? "Review files again"
                    : error
                      ? "Retry file review"
                      : "Review working files"
              }
              disabled={!ready || pending !== null}
              onPress={() => {
                void review();
              }}
            />
            {preview ? (
              <Button
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
