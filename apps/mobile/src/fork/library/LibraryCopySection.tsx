import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryCopyStatus, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { uuidv4 } from "../../lib/uuid";
import { library } from "./libraryState";
import { loadLibraryRecovery } from "./rpc/libraryAssets";

export function LibraryCopySection(props: {
  copy: LibraryWorkingCopy;
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
  const inspect = useAtomQueryRunner(library.copyStatus, { refresh: true, reportFailure: false });
  const release = useAtomCommand(library.releaseCopy, { reportFailure: false }),
    unregister = useAtomCommand(library.unregisterCopy, { reportFailure: false }),
    register = useAtomCommand(library.registerCopy, { reportFailure: false });
  const [review, setReview] = useState<LibraryCopyStatus | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [recoveryProgress, setRecoveryProgress] = useState<string | null>(null);
  const recoveryController = useRef<AbortController | null>(null);
  useEffect(() => () => recoveryController.current?.abort(), []);
  const [removedCopy, setRemovedCopy] = useState<LibraryWorkingCopy | null>(null),
    [removalRegistered, setRemovalRegistered] = useState(false);
  const released = useRef<LibraryWorkingCopy | null>(null),
    requestId = useRef(uuidv4()),
    busy = useRef(false);
  const copy = removedCopy ?? props.copy;
  const borrowed = copy.ownership === "borrowed";
  const removed = copy.registered === false || copy.state === "released";
  const allowed = connected && props.authorityReady && permitted && canRegister && !removed;
  async function remove() {
    if (
      busy.current ||
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
          throw new Error(review?.blockers[0] ?? "Review this copy before removing it.");
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
          ? "Working copy unregistered. Files and existing conversation bindings stay in place."
          : "Working copy removed. Project resources and history remain saved.",
      );
      props.onChanged();
    } catch (cause) {
      setError(
        (released.current
          ? borrowed
            ? "The copy was unregistered; its library status still needs saving. "
            : "Files were removed; their library status still needs saving. "
          : "") +
          (cause instanceof Error ? cause.message : "The working copy could not be removed."),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function saveRecovery() {
    if (busy.current || recoveryController.current || !props.authorityReady || !copy.recovery)
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
      <View className="gap-3 p-4">
        <Text selectable className="text-sm text-foreground">
          {copy.rootPath}
        </Text>
        <Text className="text-xs text-foreground-muted">
          {copy.registered === false ? "Unregistered" : copy.state} · {copy.repositories.length}{" "}
          repositories · {borrowed ? "Existing files, kept in place" : "Loom-owned working copy"}
        </Text>
        {!connected && !removed ? (
          <Text className="text-sm text-foreground-muted">
            Reconnect this computer to inspect its files.
          </Text>
        ) : null}
        {borrowed ? (
          <Text className="text-sm text-foreground-muted">
            These files belong to you. Loom uses them without taking permission to delete them.
          </Text>
        ) : null}
        {!removed ? (
          <Button
            label={pending ? "Reviewing…" : borrowed ? "Review unregister" : "Review removal"}
            tone="text"
            disabled={!allowed || pending || recoveryProgress !== null}
            onPress={() => {
              if (busy.current || recoveryController.current) return;
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
                    throw new Error("The working copy changed. Review it again.");
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
                ? "Unregister this working copy? Its files and existing conversations stay in place. New conversations will review this folder as a new copy."
                : `Remove this exact parent folder from ${props.computerLabel}? Every included repository must be safe and unused. Conversations and resources remain saved.`}
            </Text>
            {review.blockers.map((blocker) => (
              <Text key={blocker} className="text-sm text-warning-foreground">
                {blocker}
              </Text>
            ))}
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={borrowed ? "Confirm unregister" : "Confirm removal"}
                tone="danger"
                disabled={
                  !allowed ||
                  pending ||
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
                disabled={pending}
                onPress={() => setReview(null)}
              />
            </View>
          </View>
        ) : null}
        {removedCopy && !removalRegistered && error ? (
          <Button
            label="Save removed copy status"
            disabled={pending || !props.authorityReady || !canRegister}
            onPress={() => {
              void remove();
            }}
          />
        ) : null}
        {borrowed && removed ? (
          <Button
            label="Use folder again"
            tone="text"
            disabled={!props.authorityReady || recoveryProgress !== null || pending}
            onPress={props.onReuseFolder}
          />
        ) : null}
        {copy.recovery ? (
          <View className="gap-2">
            <Text className="text-sm text-foreground-muted">
              Verified recovery archive ·{" "}
              {Math.ceil(copy.recovery.byteLength / 1024 ** 2).toLocaleString()} MiB
            </Text>
            <Text selectable className="text-xs text-foreground-muted">
              SHA-256: {copy.recovery.sha256}
            </Text>
            <Button
              label={recoveryProgress ?? "Save recovery archive"}
              disabled={!props.authorityReady || pending || recoveryProgress !== null}
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
