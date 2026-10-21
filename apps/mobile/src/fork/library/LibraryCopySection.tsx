import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_FILE_LIFECYCLE_FEATURE,
  type LibraryCopyStatus,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { uuidv4 } from "../../lib/uuid";
import { LibraryCopyHealth } from "./LibraryCopyHealth";
import { LibraryFolderStorage } from "./LibraryFolderStorage";
import { LibraryTemporaryResources } from "./LibraryTemporaryResources";
import { LibraryCopyProfileSetup } from "./LibraryProfileReadiness";
import { library, useLoomFeature } from "./libraryState";
import { loadLibraryRecovery } from "./rpc/libraryAssets";

export function LibraryCopySection(props: {
  project: LibraryProject;
  copy: LibraryWorkingCopy;
  /** When the Library last heard from the copy's computer. */
  lastSeenAt: string | undefined;
  authorityEnvironmentId: EnvironmentId;
  authorityReady: boolean;
  computerLabel: string;
  onChanged: () => void;
  onReuseFolder: () => void;
}) {
  const { presentation } = useEnvironmentPresentation(props.copy.environmentId);
  const connected =
    presentation?.entry.enabled === true && presentation.connection.phase === "connected";
  const permitted = useAtomValue(
      (props.copy.ownership === "borrowed"
        ? library.unregisterCopy
        : library.releaseCopy
      ).permissionAtom(props.copy.environmentId),
    ),
    canRegister = useAtomValue(library.registerCopy.permissionAtom(props.authorityEnvironmentId));
  const supportsFileLifecycle = useLoomFeature(
    props.copy.environmentId,
    LIBRARY_FILE_LIFECYCLE_FEATURE,
  );
  const canSetRetention = useAtomValue(
    library.setCopyRetention.permissionAtom(props.copy.environmentId),
  );
  const setRetention = useAtomCommand(library.setCopyRetention, { reportFailure: false });
  const inspect = useAtomQueryRunner(library.copyStatus, { refresh: true, reportFailure: false });
  const release = useAtomCommand(library.releaseCopy, { reportFailure: false }),
    unregister = useAtomCommand(library.unregisterCopy, { reportFailure: false }),
    register = useAtomCommand(library.registerCopy, { reportFailure: false });
  const [review, setReview] = useState<LibraryCopyStatus | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [recoveryProgress, setRecoveryProgress] = useState<string | null>(null);
  const [folderPending, setFolderPending] = useState(false);
  const folderBusy = useRef(false);
  const onFolderPending = useCallback((value: boolean) => {
    folderBusy.current = value;
    setFolderPending(value);
  }, []);
  const recoveryController = useRef<AbortController | null>(null);
  useEffect(() => () => recoveryController.current?.abort(), []);
  const [retainedCopy, setRetainedCopy] = useState<LibraryWorkingCopy | null>(null);
  const [retentionAttempt, setRetentionAttempt] = useState<{
    keepOnComputer: boolean;
    copy: LibraryWorkingCopy | null;
    requestId: string;
    authorityId: EnvironmentId;
  } | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [removedCopy, setRemovedCopy] = useState<LibraryWorkingCopy | null>(null),
    [removalRegistered, setRemovalRegistered] = useState(false);
  const released = useRef<LibraryWorkingCopy | null>(null),
    requestId = useRef(uuidv4()),
    busy = useRef(false);
  const copy =
    removedCopy ??
    (retainedCopy && retainedCopy.updatedAt >= props.copy.updatedAt ? retainedCopy : props.copy);
  const borrowed = copy.ownership === "borrowed";
  const removed = copy.registered === false || copy.state === "released";
  const keepOnComputer = borrowed || copy.keepOnComputer !== false;
  const allowed =
    connected &&
    props.authorityReady &&
    permitted &&
    canRegister &&
    !removed &&
    retentionAttempt === null &&
    (borrowed || !supportsFileLifecycle || !keepOnComputer);
  async function saveRetention(keepOnComputer: boolean) {
    if (
      busy.current ||
      folderBusy.current ||
      recoveryController.current ||
      !connected ||
      !props.authorityReady ||
      !canRegister ||
      !canSetRetention ||
      !supportsFileLifecycle ||
      borrowed ||
      removed
    )
      return;
    busy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    setReview(null);
    let attempt = retentionAttempt ?? {
      keepOnComputer,
      copy: null,
      requestId: uuidv4(),
      authorityId: props.authorityEnvironmentId,
    };
    setRetentionAttempt(attempt);
    try {
      if (attempt.authorityId !== props.authorityEnvironmentId)
        throw new Error("Reconnect the library used for this setting before retrying.");
      if (!attempt.copy) {
        const result = await setRetention({
          environmentId: copy.environmentId,
          input: { workingCopyId: copy.id, keepOnComputer: attempt.keepOnComputer },
        });
        if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
        attempt = { ...attempt, copy: result.value };
        setRetentionAttempt(attempt);
        setRetainedCopy(result.value);
      }
      const result = await register({
        environmentId: props.authorityEnvironmentId,
        input: { requestId: attempt.requestId, copy: attempt.copy! },
      });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      setRetentionAttempt(null);
      setNotice(
        keepOnComputer
          ? "Files will stay on this computer."
          : "Files can be removed after a safety review. Your project and conversations stay saved.",
      );
      props.onChanged();
    } catch (cause) {
      setError(
        (attempt.copy
          ? "The setting changed on this computer; it still needs saving to your library. "
          : "") +
          (cause instanceof Error ? cause.message : "The Keep files setting could not be saved."),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function remove() {
    if (
      busy.current ||
      folderBusy.current ||
      recoveryController.current ||
      (!released.current && !allowed) ||
      !props.authorityReady ||
      !canRegister
    )
      return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (!released.current) {
        if (!review?.reviewToken || review.blockers.length)
          throw new Error(review?.blockers[0] ?? "Review these files before removing them.");
        const result = await (borrowed ? unregister : release)({
          environmentId: props.copy.environmentId,
          input: {
            requestId: requestId.current,
            workingCopyId: props.copy.id,
            reviewToken: review.reviewToken,
          },
        });
        if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
        released.current = result.value;
        setRemovedCopy(result.value);
      }
      const result = await register({
        environmentId: props.authorityEnvironmentId,
        input: { requestId: `${requestId.current}:register`, copy: released.current },
      });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      setRemovalRegistered(true);
      setReview(null);
      setNotice(
        borrowed
          ? "Loom stopped using this folder. Its files and existing conversations stay in place."
          : "Files removed from this computer. Your project and conversations remain saved.",
      );
      props.onChanged();
    } catch (cause) {
      setError(
        (released.current
          ? borrowed
            ? "Loom stopped using the folder; its library status still needs saving. "
            : "Files were removed; their library status still needs saving. "
          : "") + (cause instanceof Error ? cause.message : "The files could not be removed."),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function saveRecovery() {
    if (
      busy.current ||
      folderBusy.current ||
      recoveryController.current ||
      !props.authorityReady ||
      !copy.recovery
    )
      return;
    const controller = new AbortController();
    recoveryController.current = controller;
    setRecoveryProgress("Preparing recovery download…");
    setError(null);
    try {
      const Sharing = await import("expo-sharing");
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("Saving files is unavailable on this device.");
      if (controller.signal.aborted) return;
      setRecoveryProgress("Downloading recovery archive…");
      const file = await loadLibraryRecovery({
        authorityEnvironmentId: props.authorityEnvironmentId,
        copy,
        signal: controller.signal,
        onProgress: (bytes) =>
          setRecoveryProgress(`Downloaded ${Math.ceil(bytes / 1024 ** 2).toLocaleString()} MiB…`),
      });
      if (!file) return;
      try {
        setRecoveryProgress("Opening save or share…");
        await file.share(controller.signal);
      } finally {
        file.dispose();
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "The recovery archive could not be saved.",
        );
    } finally {
      recoveryController.current = null;
      setRecoveryProgress(null);
    }
  }
  return (
    <SettingsSection title={props.computerLabel}>
      {borrowed && copy.registered !== false ? (
        <LibraryFolderStorage
          copy={copy}
          canAct={props.authorityReady && !pending && recoveryProgress === null}
          onChanged={props.onChanged}
          onPending={onFolderPending}
        />
      ) : null}
      {!borrowed && !removed && supportsFileLifecycle ? (
        <SettingsSwitchRow
          label="Keep files on this computer"
          subtitle="Loom frees space once all work is finished and safely saved. Your project and conversations stay available."
          value={keepOnComputer}
          disabled={
            !connected ||
            !props.authorityReady ||
            !canSetRetention ||
            !canRegister ||
            pending ||
            recoveryProgress !== null ||
            retentionAttempt !== null
          }
          onValueChange={(value) => void saveRetention(value)}
        />
      ) : null}
      <View className="gap-3 p-4">
        <Text selectable className="text-sm text-foreground">
          {copy.rootPath}
        </Text>
        <Text className="text-xs text-foreground-muted">
          {borrowed && !removed
            ? ""
            : removed
              ? borrowed
                ? "Folder kept on this computer"
                : "Files removed"
              : copy.state === "ready"
                ? keepOnComputer
                  ? "Kept on this computer"
                  : "Temporary files"
                : copy.state === "missing"
                  ? "Folder not found"
                  : copy.state === "preparing"
                    ? "Preparing files"
                    : "Files need attention"}
          {borrowed && !removed ? "" : " · "}
          {copy.repositories.length}{" "}
          {copy.repositories.length === 1 ? "repository" : "repositories"}
        </Text>
        {!connected && !removed ? (
          <Text className="text-sm text-foreground-muted">
            Reconnect this computer to inspect its files.
          </Text>
        ) : null}
        {!borrowed && !removed ? (
          <LibraryCopyHealth
            project={props.project}
            copy={copy}
            connected={connected}
            computerLabel={props.computerLabel}
            authorityEnvironmentId={props.authorityEnvironmentId}
            lastSeenAt={props.lastSeenAt}
          />
        ) : null}
        <LibraryTemporaryResources copy={copy} connected={connected} />
        {connected && !removed && copy.state === "ready" ? (
          <View className="gap-2">
            <Button
              label={showSetup ? "Hide optional setup" : "Optional setup"}
              tone="text"
              disabled={pending || folderPending}
              onPress={() => setShowSetup((value) => !value)}
            />
            {showSetup ? <LibraryCopyProfileSetup project={props.project} copy={copy} /> : null}
          </View>
        ) : null}
        {!removed && (borrowed || !supportsFileLifecycle || !keepOnComputer) ? (
          <Button
            label={
              pending
                ? "Reviewing…"
                : borrowed
                  ? "Stop using this folder"
                  : "Remove files from this computer"
            }
            tone="text"
            disabled={!allowed || pending || folderPending || recoveryProgress !== null}
            onPress={() => {
              if (busy.current || folderBusy.current || recoveryController.current) return;
              busy.current = true;
              setPending(true);
              setError(null);
              setNotice(null);
              void inspect({
                environmentId: props.copy.environmentId,
                input: { workingCopyId: props.copy.id },
              })
                .then((result) => {
                  if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
                  if (result.value.copy.id !== props.copy.id)
                    throw new Error("The files changed. Review them again.");
                  setReview(result.value);
                })
                .catch((cause) =>
                  setError(
                    cause instanceof Error ? cause.message : "The files could not be reviewed.",
                  ),
                )
                .finally(() => {
                  busy.current = false;
                  setPending(false);
                });
            }}
          />
        ) : null}
        {review ? (
          <View className="gap-3 rounded-xl bg-subtle p-3">
            <Text className="text-sm text-foreground">
              {borrowed
                ? "Stop using this folder? Its files and conversations stay in place. You can use it again later."
                : `Remove this folder and its contents from ${props.computerLabel}? Every repository must be safe and unused. Your project and conversations stay saved. ${supportsFileLifecycle ? "Saved files are restored when you reopen a conversation." : "You can download saved files from this project."}`}
            </Text>
            <Text selectable className="text-xs text-foreground">
              {review.copy.rootPath}
            </Text>
            {review.blockers.map((blocker) => (
              <Text key={blocker} className="text-sm text-warning-foreground">
                {blocker}
              </Text>
            ))}
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={borrowed ? "Stop using folder" : "Remove files"}
                tone="danger"
                disabled={
                  !allowed ||
                  pending ||
                  folderPending ||
                  recoveryProgress !== null ||
                  review.blockers.length > 0 ||
                  !review.reviewToken
                }
                onPress={() => {
                  void remove();
                }}
              />
              <Button
                label="Cancel"
                tone="text"
                disabled={pending || folderPending}
                onPress={() => setReview(null)}
              />
            </View>
          </View>
        ) : null}
        {removedCopy && !removalRegistered && error ? (
          <Button
            label="Save file status"
            disabled={pending || !props.authorityReady || !canRegister}
            onPress={() => {
              void remove();
            }}
          />
        ) : null}
        {retentionAttempt !== null && error ? (
          <Button
            label="Retry saving Keep files setting"
            disabled={
              pending || !connected || !props.authorityReady || !canRegister || !canSetRetention
            }
            onPress={() => void saveRetention(retentionAttempt.keepOnComputer)}
          />
        ) : null}
        {!borrowed && removed && copy.recovery ? (
          <Text className="text-sm text-foreground-muted">
            Reopen a conversation to restore its saved files on this computer.
          </Text>
        ) : null}
        {borrowed && removed ? (
          <Button
            label="Use folder again"
            tone="text"
            disabled={!connected || !props.authorityReady || recoveryProgress !== null || pending}
            onPress={props.onReuseFolder}
          />
        ) : null}
        {copy.recovery ? (
          <View className="gap-2">
            <Text className="text-sm text-foreground-muted">
              Saved files · {Math.ceil(copy.recovery.byteLength / 1024 ** 2).toLocaleString()} MiB
            </Text>
            <Button
              label={recoveryProgress ?? "Download saved files"}
              disabled={
                !props.authorityReady || pending || folderPending || recoveryProgress !== null
              }
              onPress={() => {
                void saveRecovery();
              }}
            />
            {recoveryProgress ? (
              <Button
                label="Cancel download"
                tone="text"
                onPress={() => recoveryController.current?.abort()}
              />
            ) : null}
          </View>
        ) : null}
        {error ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
            {notice}
          </Text>
        ) : null}
      </View>
    </SettingsSection>
  );
}
