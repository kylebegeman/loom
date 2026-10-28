import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentAuthorizationError, EnvironmentId } from "@t3tools/contracts";
import { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { library } from "./libraryState";

const FileChangeAttempt = Schema.Struct({
  authorityId: EnvironmentId,
  requestId: Schema.String,
  keepOnComputer: Schema.NullOr(Schema.Boolean),
  copy: Schema.NullOr(LibraryWorkingCopy),
});
type FileChangeAttempt = typeof FileChangeAttempt.Type;
const decodeAttempt = Schema.decodeSync(Schema.fromJsonString(FileChangeAttempt));
const encodeAttempt = Schema.encodeSync(Schema.fromJsonString(FileChangeAttempt));
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);
function readAttempt(serialized: string | undefined) {
  if (!serialized) return null;
  try {
    return decodeAttempt(serialized);
  } catch {
    return false;
  }
}
type Props = {
  readonly copy: LibraryWorkingCopy;
  readonly connected: boolean;
  readonly supported: boolean;
  readonly canAct: boolean;
  readonly authorityEnvironmentId: EnvironmentId;
  readonly onChanged: (copy: LibraryWorkingCopy) => void;
  readonly onPending: (pending: boolean) => void;
};

export function LibraryManagedFileControls(props: Props) {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const attemptKey = JSON.stringify([props.copy.environmentId, props.copy.id]);
  if (!AsyncResult.isSuccess(preferences))
    return <Text className="px-4 py-3 text-sm text-foreground-muted">Loading file controls…</Text>;
  const saved = readAttempt(preferences.value.loomLibraryFileChanges?.[attemptKey]);
  if (saved === false)
    return (
      <Text className="px-4 py-3 text-sm text-danger-foreground">
        The saved file change could not be read. Keep it for recovery before trying another change.
      </Text>
    );
  return <FileControls key={attemptKey} {...props} attemptKey={attemptKey} saved={saved} />;
}

function FileControls({
  copy,
  connected,
  supported,
  canAct,
  authorityEnvironmentId,
  onChanged,
  onPending,
  attemptKey,
  saved,
}: Props & { readonly attemptKey: string; readonly saved: FileChangeAttempt | null }) {
  const canRetain = useAtomValue(library.setCopyRetention.permissionAtom(copy.environmentId));
  const canReopen = useAtomValue(library.reopenCopy.permissionAtom(copy.environmentId));
  const canRegister = useAtomValue(library.registerCopy.permissionAtom(authorityEnvironmentId));
  const retain = useAtomCommand(library.setCopyRetention, { reportFailure: false });
  const reopen = useAtomCommand(library.reopenCopy, { reportFailure: false });
  const register = useAtomCommand(library.registerCopy, { reportFailure: false });
  const savePreferences = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const [attempt, setAttempt] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changing = useRef(false);
  const current = attempt?.copy && attempt.copy.updatedAt >= copy.updatedAt ? attempt.copy : copy;
  const recoverable =
    current.state === "released" ||
    current.registered === false ||
    ((current.state === "missing" || current.state === "failed") && current.recovery !== undefined);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports pending file work to the parent and clears it on unmount
  useEffect(() => {
    onPending(busy || attempt !== null);
    return () => onPending(false);
  }, [busy, attempt, onPending]);
  const saveAttempt = async (next: FileChangeAttempt | null) => {
    const serialized = next === null ? null : encodeAttempt(next);
    if (serialized && serialized.length > 256 * 1024)
      throw new Error("This file change is too large to save safely on this device.");
    if (next !== null) setAttempt(next);
    await savePreferences({
      transform: (preferences) => {
        const changes = { ...preferences.loomLibraryFileChanges };
        if (serialized === null) delete changes[attemptKey];
        else changes[attemptKey] = serialized;
        return { loomLibraryFileChanges: changes };
      },
    });
    if (next === null) setAttempt(null);
  };
  const allowed =
    canAct &&
    canRegister &&
    ((attempt?.copy !== null && attempt?.copy !== undefined) || (connected && supported)) &&
    (attempt === null || attempt.authorityId === authorityEnvironmentId);
  async function change(keepOnComputer: boolean | null) {
    if (
      changing.current ||
      !allowed ||
      (!attempt?.copy &&
        ((attempt?.keepOnComputer ?? keepOnComputer) === null ? !canReopen : !canRetain))
    )
      return;
    changing.current = true;
    setBusy(true);
    setError(null);
    let pending = attempt ?? {
      authorityId: authorityEnvironmentId,
      requestId: uuidv4(),
      keepOnComputer,
      copy: null,
    };
    const applyChange = async () => {
      await saveAttempt(pending);
      if (!pending.copy) {
        const result =
          pending.keepOnComputer === null
            ? await reopen({
                environmentId: copy.environmentId,
                input: { workingCopyId: copy.id, requestId: pending.requestId },
              })
            : await retain({
                environmentId: copy.environmentId,
                input: { workingCopyId: copy.id, keepOnComputer: pending.keepOnComputer },
              });
        if (AsyncResult.isFailure(result)) {
          const cause = squashAtomCommandFailure(result);
          if (isAuthorizationError(cause)) await saveAttempt(null);
          throw cause;
        }
        if (
          result.value.id !== copy.id ||
          result.value.environmentId !== copy.environmentId ||
          result.value.rootPath !== copy.rootPath
        )
          throw new Error(
            "The returned files do not match this computer's folder. Refresh before retrying.",
          );
        pending = { ...pending, copy: result.value };
        await saveAttempt(pending);
      }
      const published = await register({
        environmentId: pending.authorityId,
        input: { requestId: pending.requestId + ":publish", copy: pending.copy! },
      });
      if (AsyncResult.isFailure(published)) throw squashAtomCommandFailure(published);
      await saveAttempt(null);
      onChanged(published.value);
    };
    try {
      await applyChange();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The file change could not be saved. Try again.",
      );
    }
    changing.current = false;
    setBusy(false);
  }
  return (
    <View className="gap-3 p-4">
      {recoverable ? (
        <Button
          label={busy ? "Restoring files…" : "Restore files"}
          disabled={!allowed || !canReopen || busy || attempt !== null || !current.recovery}
          onPress={() => void change(null)}
        />
      ) : (
        <SettingsSwitchRow
          label="Keep files on this computer"
          subtitle="Loom frees space once all work is finished and safely saved. Your project and conversations stay available."
          value={current.keepOnComputer !== false}
          disabled={!allowed || !canRetain || busy || attempt !== null}
          onValueChange={(value) => void change(value)}
        />
      )}
      {attempt !== null && !busy ? (
        <Button
          label={
            attempt.copy
              ? "Retry saving file status"
              : attempt.keepOnComputer === null
                ? "Retry restoring files"
                : "Retry saving Keep files setting"
          }
          disabled={
            !allowed ||
            (!attempt.copy && (attempt.keepOnComputer === null ? !canReopen : !canRetain))
          }
          onPress={() => void change(attempt.keepOnComputer)}
        />
      ) : null}
      {!connected ? (
        <Text className="text-sm text-foreground-muted">
          Connect this computer to change or restore its files.
        </Text>
      ) : !supported ? (
        <Text className="text-sm text-foreground-muted">
          Update Loom on this computer to manage its files.
        </Text>
      ) : null}
      {attempt && attempt.authorityId !== authorityEnvironmentId ? (
        <Text className="text-sm text-foreground-muted">
          Reconnect the library used for this file change to finish saving it.
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
