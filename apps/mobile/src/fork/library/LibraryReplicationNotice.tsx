import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { LibraryError, type LibraryThreadSummary } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { libraryHistoryFreshness } from "./libraryArchive";
import { library, refreshLibraryWork } from "./libraryState";

export function LibraryReplicationNotice(props: {
  summary: LibraryThreadSummary;
  sourceConnected: boolean;
  authorityEnvironmentId: EnvironmentId;
  onRefresh: () => void;
}) {
  const status = useEnvironmentQuery(
    props.sourceConnected
      ? library.replicationStatus({ environmentId: props.summary.environmentId, input: {} })
      : null,
  );
  const canFlush = useAtomValue(library.flushHistory.permissionAtom(props.summary.environmentId));
  const flush = useAtomCommand(library.flushHistory, { reportFailure: false });
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const freshness = libraryHistoryFreshness(props.summary, props.sourceConnected, status.data);
  async function upload() {
    if (busy.current || !canFlush || !props.sourceConnected) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await flush({ environmentId: props.summary.environmentId, input: {} });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      appAtomRegistry.refresh(
        library.replicationStatus({ environmentId: props.summary.environmentId, input: {} }),
      );
      refreshLibraryWork(props.authorityEnvironmentId, props.summary.projectId);
      props.onRefresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "History could not finish uploading. Retry when both computers are connected.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <View className="gap-2">
      <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
        {freshness.detail}
      </Text>
      {status.data?.lastFailure ? (
        <Text className="text-sm text-warning-foreground">
          Upload needs attention: {new LibraryError({ reason: status.data.lastFailure }).message}
        </Text>
      ) : null}
      {status.error || error ? (
        <Text className="text-sm text-danger-foreground">{error ?? status.error}</Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Reload saved history"
          tone="text"
          disabled={pending}
          onPress={props.onRefresh}
        />
        {props.sourceConnected ? (
          <Button
            label={
              pending
                ? "Uploading history…"
                : freshness.state === "pending"
                  ? "Upload pending history"
                  : "Check uploads"
            }
            tone="text"
            disabled={!canFlush || pending || status.data?.enabled === false}
            onPress={() => {
              void upload();
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
