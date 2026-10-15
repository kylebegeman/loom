import { useAtomValue } from "@effect/atom-react";
import {
  createProjectCheckoutAtoms,
  projectWorkingCopyActionBlocker,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { connectionAtomRuntime } from "../../connection/runtime";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentServerConfig } from "../../state/entities";
import { environmentPresentations, useEnvironmentPresentation } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";

const checkout = createProjectCheckoutAtoms(connectionAtomRuntime);
type Props = {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly computerLabel: string;
  readonly canClone: boolean;
  readonly onClone: () => void;
};

/** Removing or restoring files always targets the selected working copy. */
export function ProjectWorkingCopySection(props: Props) {
  const config = useEnvironmentServerConfig(props.environmentId);
  const { presentation } = useEnvironmentPresentation(props.environmentId);
  const connected =
    presentation?.entry.enabled === true && presentation.connection.phase === "connected";
  const supported = supportsLoomFeature(
    config?.environment.capabilities,
    "project-checkout-actions",
  );
  const canRead = useEnvironmentScope(props.environmentId, AuthOrchestrationReadScope);
  const canRelease = useAtomValue(checkout.release.permissionAtom(props.environmentId));
  const canRestore = useAtomValue(checkout.restore.permissionAtom(props.environmentId));
  return (
    <WorkingCopyActions
      key={`${props.environmentId}:${props.projectId}:${props.workspaceRoot}:${connected}:${supported}:${canRead}:${canRelease}:${canRestore}`}
      {...props}
      connected={connected}
      configReady={config != null}
      supported={supported}
      canRead={canRead}
      canRelease={canRelease}
      canRestore={canRestore}
    />
  );
}

function WorkingCopyActions(
  props: Props & {
    readonly connected: boolean;
    readonly configReady: boolean;
    readonly supported: boolean;
    readonly canRead: boolean;
    readonly canRelease: boolean;
    readonly canRestore: boolean;
  },
) {
  const ready = props.connected && props.supported && props.canRead;
  const query = useEnvironmentQuery(
    ready
      ? checkout.preview({
          environmentId: props.environmentId,
          input: { projectId: props.projectId },
        })
      : null,
  );
  const review = useAtomQueryRunner(checkout.preview, { refresh: true, reportFailure: false });
  const release = useAtomCommand(checkout.release, { reportFailure: false });
  const restore = useAtomCommand(checkout.restore, { reportFailure: false });
  const [confirmation, setConfirmation] = useState<{
    readonly action: "release" | "restore";
    readonly preview: ProjectCheckoutPreview;
  } | null>(null);
  const [pending, setPending] = useState<"review" | "release" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function allowed(action: "release" | "restore") {
    const current = appAtomRegistry.get(
      environmentPresentations.presentationAtom(props.environmentId),
    );
    return (
      mounted.current &&
      ready &&
      current?.entry.enabled === true &&
      current.connection.phase === "connected" &&
      readEnvironmentScope(props.environmentId, AuthOrchestrationReadScope) &&
      appAtomRegistry.get(checkout[action].permissionAtom(props.environmentId))
    );
  }

  async function reviewAction(action: "release" | "restore") {
    if (busy.current || !allowed(action)) return;
    busy.current = true;
    setPending("review");
    setConfirmation(null);
    setError(null);
    setNotice(null);
    try {
      const result = await review({
        environmentId: props.environmentId,
        input: { projectId: props.projectId },
      });
      if (!mounted.current || !allowed(action)) return;
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      if (
        result.value.projectId !== props.projectId ||
        result.value.workspaceRoot !== props.workspaceRoot
      )
        throw new Error(
          "The working copy changed. Open this project again to review its current location.",
        );
      const blocker = projectWorkingCopyActionBlocker(result.value, action);
      if (blocker) {
        setNotice(blocker);
        return;
      }
      setConfirmation({ action, preview: result.value });
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The working copy could not be reviewed. Try again.",
        );
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  async function confirmAction() {
    if (
      busy.current ||
      !confirmation ||
      !allowed(confirmation.action) ||
      !confirmation.preview.reviewToken
    )
      return;
    const { action, preview } = confirmation;
    if (projectWorkingCopyActionBlocker(preview, action)) return;
    busy.current = true;
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const target = {
        environmentId: props.environmentId,
        input: { projectId: props.projectId, reviewToken: preview.reviewToken! },
      };
      if (action === "release") {
        const result = await release(target);
        if (!mounted.current) return;
        if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
        if (result.value.outcome === "failed") setError(result.value.reason);
        else
          setNotice(
            result.value.outcome === "removed"
              ? "Working copy removed. Your project, resources, and conversations are saved."
              : result.value.reason,
          );
      } else {
        const result = await restore(target);
        if (!mounted.current) return;
        if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
        setNotice("Working copy restored. You can start a new task or continue a conversation.");
      }
      setConfirmation(null);
      query.refresh();
    } catch (cause) {
      if (mounted.current) {
        setConfirmation(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "The working copy could not be changed. Review it again.",
        );
        query.refresh();
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  const preview = query.data?.projectId === props.projectId ? query.data : null;
  const released = preview?.state === "released";
  return (
    <SettingsSection title="Use project">
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">
          {released
            ? `Restore a working copy on ${props.computerLabel} to continue work.`
            : `Work on ${props.computerLabel}, or clone this folder's repository to another connected computer.`}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {released ? (
            <MaterialButton
              label={pending === "restore" ? "Restoring…" : "Restore working copy"}
              tone="primary"
              disabled={!props.canRestore || pending !== null}
              onPress={() => {
                void reviewAction("restore");
              }}
            />
          ) : null}
          <MaterialButton
            label="Clone repository"
            tone={released ? "secondary" : "primary"}
            disabled={!props.canClone || pending !== null}
            onPress={props.onClone}
          />
          {ready && props.canRelease && !released ? (
            <MaterialButton
              label={pending === "review" ? "Reviewing…" : "Remove working copy"}
              tone="text"
              disabled={pending !== null || !query.isSuccess || query.isPending}
              onPress={() => {
                void reviewAction("release");
              }}
            />
          ) : null}
        </View>
        {!props.connected ? (
          <Text className="text-xs text-foreground-muted">
            Reconnect this computer to clone or manage its working copy.
          </Text>
        ) : !props.configReady ? (
          <Text className="text-xs text-foreground-muted">
            Loading this computer's capabilities…
          </Text>
        ) : !props.supported ? (
          <Text className="text-xs text-foreground-muted">
            Update Loom on this computer to remove or restore a working copy.
          </Text>
        ) : !props.canRead ? (
          <Text className="text-xs text-foreground-muted">
            Project read permission is required to review this working copy.
          </Text>
        ) : !props.canRelease || !props.canRestore ? (
          <Text className="text-xs text-foreground-muted">
            Project settings access is required to remove or restore working copies.
          </Text>
        ) : !query.data && !query.error ? (
          <Text className="text-xs text-foreground-muted">Checking working copy…</Text>
        ) : null}
        {confirmation ? (
          <View className="gap-3 rounded-xl bg-subtle p-3">
            <Text className="text-sm font-t3-medium text-foreground">
              {confirmation.action === "release"
                ? `Remove working copy from ${props.computerLabel}?`
                : `Restore working copy on ${props.computerLabel}?`}
            </Text>
            <Text selectable className="text-xs text-foreground-muted">
              {confirmation.preview.workspaceRoot}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {confirmation.action === "release"
                ? "Loom removes this reviewed folder after checking it is safe. Your project, resources, and conversations remain saved. You can restore the files later."
                : "Loom restores this saved working copy to its original location using this computer's Git credentials."}
            </Text>
            {confirmation.preview.blockers.map((blocker) => (
              <Text key={blocker} className="text-xs text-foreground-muted">
                {blocker}
              </Text>
            ))}
            <View className="flex-row flex-wrap gap-2">
              <MaterialButton
                label={
                  pending === confirmation.action
                    ? confirmation.action === "release"
                      ? "Removing…"
                      : "Restoring…"
                    : confirmation.action === "release"
                      ? "Confirm removal"
                      : "Confirm restore"
                }
                tone={confirmation.action === "release" ? "danger" : "primary"}
                disabled={pending !== null}
                onPress={() => {
                  void confirmAction();
                }}
              />
              <MaterialButton
                label="Cancel"
                tone="text"
                disabled={pending !== null}
                onPress={() => setConfirmation(null)}
              />
            </View>
          </View>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
            {notice}
          </Text>
        ) : null}
        {(error ?? query.error) ? (
          <>
            <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
              {error ?? query.error}
            </Text>
            {ready ? (
              <MaterialButton
                label="Retry working copy review"
                tone="text"
                disabled={pending !== null || query.isPending}
                onPress={() => {
                  setError(null);
                  query.refresh();
                }}
              />
            ) : null}
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}
