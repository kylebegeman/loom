import { useCheckoutThreads } from "./useCheckoutThreads";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { View } from "react-native";
import type { VcsStatusResult } from "@t3tools/contracts";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import {
  buildGitRecoveryPrompt,
  gitOperationLabel,
  landedBranch,
} from "@t3tools/client-runtime/state/vcs";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { CHECKOUT_RELEASE_FEATURE } from "@t3tools/contracts/fork";
import * as Dialog from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { AppText } from "../../components/ui/AppText";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment, vcsActionManager } from "../../state/vcs";
import { useThreadSelection } from "../../state/use-thread-selection";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentServerConfig } from "../../state/entities";
import { appendComposerDraftText } from "../../state/use-composer-drafts";
import { scopedThreadKey } from "../../lib/scopedEntities";
import {
  useReleaseThreadCheckout,
  useThreadListActions,
} from "../../features/home/useThreadListActions";
import { useSelectWorkspaceDetail } from "../../features/workspace/useSelectWorkspaceDetail";

export function useGitRecoveryPrompt() {
  const { selectedThread } = useThreadSelection();
  const selectDetail = useSelectWorkspaceDetail();
  return (status: VcsStatusResult) => {
    if (!selectedThread) return;
    appendComposerDraftText(
      scopedThreadKey(selectedThread.environmentId, selectedThread.id),
      buildGitRecoveryPrompt(status),
    );
    selectDetail({
      name: "Thread",
      params: { environmentId: selectedThread.environmentId, threadId: selectedThread.id },
    });
  };
}

export function GitRecovery({ status }: { status: VcsStatusResult | null }) {
  const { selectedThread } = useThreadSelection();
  const { selectedThreadCwd, selectedThreadWorktreePath } = useSelectedThreadWorktree();
  const resolve = useAtomCommand(vcsEnvironment.resolveOperation, { reportFailure: false });
  const refresh = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const ask = useGitRecoveryPrompt();
  const { settleThread } = useThreadListActions();
  const releaseCheckout = useReleaseThreadCheckout();
  const checkoutReleaseSupported = supportsLoomFeature(
    useEnvironmentServerConfig(selectedThread?.environmentId ?? null)?.environment.capabilities,
    CHECKOUT_RELEASE_FEATURE,
  );
  const canWrite = useAtomValue(
    vcsEnvironment.resolveOperation.permissionAtom(selectedThread?.environmentId ?? null),
  );
  const canSettle = useEnvironmentScope(
    selectedThread?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const [running, setRunning] = useState(false);
  const label = gitOperationLabel(status);
  const landed = landedBranch(status, selectedThreadWorktreePath !== null);
  const actionState = useAtomValue(
    vcsActionManager.stateAtom({
      environmentId: selectedThread?.environmentId ?? null,
      cwd: selectedThreadCwd,
    }),
  );
  const checkout = useCheckoutThreads();
  const busy =
    checkout.busy ||
    running ||
    actionState.isRunning ||
    selectedThread?.runtime?.activeRunId != null;
  const confirm = (resolution: "continue" | "abort") => {
    if (
      !selectedThread ||
      !selectedThreadCwd ||
      !status?.operation ||
      !status.headSha ||
      busy ||
      !canWrite
    )
      return;
    const target = {
      environmentId: selectedThread.environmentId,
      input: {
        cwd: selectedThreadCwd,
        operation: status.operation,
        expectedHead: status.headSha,
        resolution,
      },
    };
    Dialog.confirm({
      title: `${resolution === "continue" ? "Continue" : "Abort"} ${status.operation}?`,
      message:
        resolution === "abort"
          ? "Git will restore the checkout to before this operation. Conflict resolution edits may be discarded."
          : "Git will use the files you already staged. Repository hooks or rebase steps may run.",
      confirmText: `${resolution === "continue" ? "Continue" : "Abort"} ${status.operation}`,
      destructive: resolution === "abort",
      onConfirm: () => {
        void (async () => {
          setRunning(true);
          const result = await resolve(target);
          setRunning(false);
          await refresh({ environmentId: target.environmentId, input: { cwd: target.input.cwd } });
          if (result._tag === "Failure") {
            const error = squashAtomCommandFailure(result);
            Dialog.alert(
              "Git operation stopped",
              error instanceof Error ? error.message : "Refresh status and try again.",
            );
          }
        })();
      },
    });
  };
  const release = async (thread: NonNullable<typeof selectedThread>) => {
    if (!(await releaseCheckout(thread)) || !selectedThreadCwd) return;
    await refresh({ environmentId: thread.environmentId, input: { cwd: selectedThreadCwd } });
  };
  if (!label && !landed) return null;
  return (
    <View className="gap-2 rounded-xl border border-border bg-card p-3">
      <AppText>{label ?? `Landed on ${landed}`}</AppText>
      {label && status ? (
        <>
          {(status.unmergedPaths ?? []).map((file) => (
            <AppText key={file}>{file}</AppText>
          ))}
          <Button label="Ask the agent to resolve" tone="secondary" onPress={() => ask(status)} />
          {checkout.busy && <AppText>Wait for conversations using this folder to finish.</AppText>}
          {status.operation && (
            <View className="flex-row flex-wrap gap-2">
              <Button
                label="Continue"
                disabled={!canWrite || busy || (status.unmergedCount ?? 0) > 0}
                onPress={() => confirm("continue")}
              />
              <Button label="Abort" disabled={!canWrite || busy} onPress={() => confirm("abort")} />
            </View>
          )}
        </>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          <Button
            label="Settle"
            disabled={!selectedThread || !canSettle || busy}
            onPress={() => {
              if (selectedThread) void settleThread(selectedThread);
            }}
          />
          {checkoutReleaseSupported && (
            <Button
              label="Release checkout"
              tone="secondary"
              disabled={!selectedThread || !canSettle || busy}
              onPress={() => {
                if (selectedThread) void release(selectedThread);
              }}
            />
          )}
        </View>
      )}
    </View>
  );
}
