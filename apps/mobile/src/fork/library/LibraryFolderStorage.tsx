import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { createProjectCheckoutAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type ProjectId } from "@t3tools/contracts";
import { PROJECT_CHECKOUT_FEATURE, type LibraryWorkingCopy } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { connectionAtomRuntime } from "../../connection/runtime";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { useEnvironmentServerConfig } from "../../state/entities";
import { environmentPresentations, useEnvironmentPresentation } from "../../state/presentation";
import { useEnvironmentScope, readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { libraryFolderProjectId, libraryFolderStorageChange } from "./libraryStorageReview";
import { useRefreshOnRefocus } from "./libraryState";

const checkout = createProjectCheckoutAtoms(connectionAtomRuntime);
const failureMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Could not update these files. Check their status and try again.";
type Props = {
  copy: LibraryWorkingCopy;
  canAct: boolean;
  onChanged: () => void;
  onPending?: (pending: boolean) => void;
};

export function LibraryFolderStorage(props: Props) {
  const config = useEnvironmentServerConfig(props.copy.environmentId);
  const { presentation } = useEnvironmentPresentation(props.copy.environmentId);
  const canRead = useEnvironmentScope(props.copy.environmentId, AuthOrchestrationReadScope);
  const projectId = libraryFolderProjectId(props.copy);
  const canAdopt = useAtomValue(checkout.adopt.permissionAtom(props.copy.environmentId));
  const canSetRetention = useAtomValue(
    checkout.setRetention.permissionAtom(props.copy.environmentId),
  );
  const supported = supportsLoomFeature(config?.environment.capabilities, PROJECT_CHECKOUT_FEATURE);
  const connected =
    presentation?.entry.enabled === true && presentation.connection.phase === "connected";
  const reason = !connected
    ? "Connect this computer to check its files and restore them if needed."
    : !config
      ? "Loading this computer's capabilities…"
      : !supported
        ? "Update Loom on this computer to manage these files."
        : !canRead
          ? "This connection cannot check files on this computer."
          : !projectId
            ? "This folder cannot be managed here. Its files stay in place."
            : null;
  return reason || !projectId ? (
    <Text className="px-4 py-3 text-sm text-foreground-muted">{reason}</Text>
  ) : (
    <FolderStorage
      key={`${props.copy.id}:${props.copy.environmentId}:${projectId}:${props.copy.rootPath}:${props.canAct}:${canAdopt}:${canSetRetention}`}
      {...props}
      projectId={projectId}
    />
  );
}

function FolderStorage({
  copy,
  projectId,
  canAct,
  onChanged,
  onPending,
}: Props & { projectId: ProjectId }) {
  const registry = useContext(RegistryContext);
  const query = checkout.preview({ environmentId: copy.environmentId, input: { projectId } });
  const result = useAtomValue(query);
  const preview = result._tag === "Success" ? result.value : null;
  const adoptPermission = checkout.adopt.permissionAtom(copy.environmentId);
  const retentionPermission = checkout.setRetention.permissionAtom(copy.environmentId);
  const canAdopt = useAtomValue(adoptPermission),
    canSetRetention = useAtomValue(retentionPermission);
  const adopt = useAtomCommand(checkout.adopt, { reportFailure: false });
  const setRetention = useAtomCommand(checkout.setRetention, { reportFailure: false });
  const reviewFolder = useAtomQueryRunner(checkout.preview, {
    refresh: true,
    reportFailure: false,
  });
  const [confirming, setConfirming] = useState(false),
    [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [consentToken, setConsentToken] = useState<string | null>(null);
  const consent = useRef<string | null>(null),
    mounted = useRef(true),
    busy = useRef(false);
  const confirmingRef = useRef(false);
  const refresh = useCallback(() => {
    consent.current = null;
    setConsentToken(null);
    registry.refresh(query);
  }, [registry, query]);
  useRefreshOnRefocus(refresh);
  useEffect(() => {
    mounted.current = true;
    registry.refresh(query);
    return () => {
      mounted.current = false;
      consent.current = null;
      confirmingRef.current = false;
      onPending?.(false);
    };
  }, [registry, query, onPending]);
  const matches = preview?.projectId === projectId && preview.workspaceRoot === copy.rootPath;
  const external = preview?.state === "external" && preview.ownershipSource === null;
  const allowed = canAct && (external ? canAdopt : canSetRetention);
  const ready =
    matches &&
    result._tag === "Success" &&
    !result.waiting &&
    preview.reviewToken !== null &&
    preview.state !== "blocked";
  const liveAccess = () => {
    const current = registry.get(environmentPresentations.presentationAtom(copy.environmentId));
    return (
      current?.entry.enabled === true &&
      current.connection.phase === "connected" &&
      readEnvironmentScope(copy.environmentId, AuthOrchestrationReadScope)
    );
  };
  const close = () => {
    if (busy.current) return;
    consent.current = null;
    setConsentToken(null);
    confirmingRef.current = false;
    setConfirming(false);
  };
  async function beginConsent() {
    if (
      !mounted.current ||
      busy.current ||
      !canAct ||
      !liveAccess() ||
      !registry.get(adoptPermission)
    )
      return;
    busy.current = true;
    onPending?.(true);
    consent.current = null;
    setConsentToken(null);
    confirmingRef.current = true;
    setConfirming(true);
    setReviewing(true);
    setError(null);
    try {
      const reviewed = await reviewFolder({
        environmentId: copy.environmentId,
        input: { projectId },
      });
      if (!mounted.current || !confirmingRef.current) return;
      if (reviewed._tag !== "Success") throw squashAtomCommandFailure(reviewed);
      libraryFolderStorageChange(
        copy,
        projectId,
        reviewed.value,
        false,
        reviewed.value.reviewToken,
      );
      if (reviewed.value.ownershipSource === null) {
        consent.current = reviewed.value.reviewToken;
        setConsentToken(reviewed.value.reviewToken);
      }
    } catch (cause) {
      if (mounted.current) setError(failureMessage(cause));
    } finally {
      busy.current = false;
      if (mounted.current) {
        setReviewing(false);
        onPending?.(false);
      }
    }
  }
  async function save(keep: boolean) {
    if (!mounted.current || busy.current || !ready || !preview || !allowed || !liveAccess()) return;
    const current = registry.get(query);
    if (
      current._tag !== "Success" ||
      current.waiting ||
      current.value.reviewToken !== preview.reviewToken ||
      current.value.projectId !== projectId ||
      current.value.workspaceRoot !== copy.rootPath
    )
      return;
    if (
      !registry.get(external ? adoptPermission : retentionPermission) ||
      (external && !confirmingRef.current)
    )
      return;
    busy.current = true;
    onPending?.(true);
    setSaving(true);
    setError(null);
    try {
      const change = libraryFolderStorageChange(
        copy,
        projectId,
        current.value,
        keep,
        consent.current,
      );
      const saved = await (change.kind === "adopt" ? adopt : setRetention)({
        environmentId: copy.environmentId,
        input: change.input,
      });
      if (!mounted.current) return;
      if (saved._tag !== "Success") throw squashAtomCommandFailure(saved);
      consent.current = null;
      confirmingRef.current = false;
      setConfirming(false);
      refresh();
      onChanged();
    } catch (cause) {
      if (mounted.current) {
        consent.current = null;
        confirmingRef.current = false;
        setConfirming(false);
        setError(failureMessage(cause));
        refresh();
      }
    } finally {
      busy.current = false;
      if (mounted.current) {
        setSaving(false);
        onPending?.(false);
      }
    }
  }
  const queryError =
    result._tag === "Failure"
      ? failureMessage(Cause.squash(result.cause))
      : preview && !matches
        ? "The file location changed. Refresh the project before changing its files."
        : null;
  const pending = saving || reviewing || result.waiting || result._tag === "Initial";
  return (
    <View>
      {preview && matches ? (
        preview.state === "released" ? (
          <View className="gap-2 px-4 py-3">
            <Text className="text-sm text-foreground-muted">
              Files were removed from this computer. Your project and conversations stay available.
            </Text>
            <Button
              label={saving ? "Restoring…" : "Restore files"}
              disabled={pending || !ready || !allowed}
              onPress={() => void save(true)}
            />
          </View>
        ) : (
          <SettingsSwitchRow
            label="Keep files on this computer"
            value={preview.ownershipSource === null || preview.retention === "keep"}
            subtitle={
              preview.state === "blocked"
                ? "These files need attention before their storage setting can change."
                : external
                  ? "This folder stays in place until you allow Loom to manage its files."
                  : preview.retention === "keep"
                    ? "Files stay available until you change this setting."
                    : preview.retention === "inherit"
                      ? "Using this computer's default. Turn on to keep files here."
                      : "Loom frees space once all work is finished and safely saved. Your project and conversations stay available."
            }
            disabled={pending || !ready || !allowed || confirming}
            onValueChange={(keep) => {
              if (external && !keep) void beginConsent();
              else if (!external) void save(keep);
            }}
          />
        )
      ) : null}
      <View className="gap-2 px-4 py-3">
        {preview && matches
          ? preview.blockers.map((blocker) => (
              <Text key={blocker} className="text-xs text-foreground-muted">
                {blocker}
              </Text>
            ))
          : null}
        {!allowed ? (
          <Text className="text-xs text-foreground-muted">
            This connection needs permission to change files on this computer.
          </Text>
        ) : null}
        {confirming ? (
          <View className="gap-3 rounded-xl bg-subtle p-3">
            <Text className="text-sm font-t3-medium text-foreground">
              Let Loom free space here?
            </Text>
            <Text className="text-sm text-foreground-muted">
              Loom will manage this folder and may remove its files once all work is finished and
              safely saved. If work is already finished, cleanup can happen right away. Your project
              and conversations stay available.
            </Text>
            <Text selectable className="text-xs text-foreground">
              {copy.rootPath}
            </Text>
            <Text className="text-xs text-foreground-muted">
              Unpublished changes and local-only files keep this folder here. Restore files here or
              resume work to bring them back. Setup runs when work resumes.
            </Text>
            {preview && matches ? (
              <Text className="text-xs text-foreground-muted">
                {preview.localFiles.trackedChanges} tracked changes,{" "}
                {preview.localFiles.untrackedFiles} untracked files,{" "}
                {preview.localFiles.ignoredFiles} ignored files
                {preview.localFiles.truncated ? " (partial scan)" : ""}
              </Text>
            ) : null}
            <Button
              label={saving ? "Saving…" : "Allow Loom to manage files"}
              disabled={
                pending || !ready || !allowed || !external || consentToken !== preview?.reviewToken
              }
              onPress={() => void save(false)}
            />
            <Button label="Cancel" tone="text" disabled={saving || reviewing} onPress={close} />
          </View>
        ) : null}
        {pending ? (
          <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
            {saving ? "Saving file setting…" : "Checking files…"}
          </Text>
        ) : null}
        <Button
          label={confirming ? "Review files again" : "Check files"}
          tone="text"
          disabled={pending}
          onPress={() => {
            if (confirming) void beginConsent();
            else refresh();
          }}
        />
        {queryError || error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {queryError ?? error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
