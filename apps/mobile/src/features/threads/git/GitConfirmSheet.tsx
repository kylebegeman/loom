// fork: source-control-cockpit
import { useCheckoutThreads } from "../../../fork/source-control-cockpit/useCheckoutThreads";
import { AuthSettingsWriteScope, EnvironmentId } from "@t3tools/contracts";
import { useAtomCommand } from "../../../state/use-atom-command";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentScope } from "../../../state/session";
import { Switch } from "react-native";
import { AppText as Text } from "../../../components/ui/AppText"; // fork: source-control-cockpit
import { resolveDefaultBranchActionDialogCopy } from "@t3tools/client-runtime/state/vcs";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { resolveAutoFeatureBranchName } from "@t3tools/shared/git";
import * as Arr from "effect/Array";
import * as Result from "effect/Result";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react"; // fork: source-control-cockpit
import { View } from "react-native";

import { SheetHeader } from "../../../components/ui/SheetHeader";
import { FitSheet } from "../../../components/ui/FitSheet";
import { SheetIntro } from "../../../components/ui/SheetIntro";
import { useSelectedThreadGitActions } from "../../../state/use-selected-thread-git-actions";
import { useSelectedThreadGitState } from "../../../state/use-selected-thread-git-state";
import { useThreadSelection } from "../../../state/use-thread-selection";
import { SheetActionButton } from "./gitSheetComponents";

type GitConfirmSheetProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly confirmAction?: string;
  readonly branchName?: string;
  readonly includesCommit?: string;
  readonly commitMessage?: string;
  readonly filePaths?: string;
}>;

export function GitConfirmSheet(props: GitConfirmSheetProps) {
  const navigation = useNavigation();
  const gitState = useSelectedThreadGitState();
  const gitActions = useSelectedThreadGitActions();
  const { canWriteSourceControl, canChangeThreadBranch } = gitActions;
  // fork: source-control-cockpit -- the remember toggle merges into the runtime's project overrides
  const { selectedThreadProject, selectedEnvironmentRuntime } = useThreadSelection();
  const terminology = sourceControlClients.get(
    selectedThreadProject?.repositoryIdentity?.provider,
  ).changeRequest;

  const params = props.route.params;
  // fork: source-control-cockpit
  const [remember, setRemember] = useState(false);
  const { otherCount } = useCheckoutThreads();
  const canRemember = useEnvironmentScope(
    EnvironmentId.make(params.environmentId),
    AuthSettingsWriteScope,
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings);
  const rememberChoice = async () => {
    if (!remember || !canRemember || !selectedThreadProject) return true;
    const projectId = selectedThreadProject.id;
    const previous =
      selectedEnvironmentRuntime?.serverConfig?.settings.projectSettingsOverrides[projectId];
    const result = await updateSettings({
      environmentId: EnvironmentId.make(params.environmentId),
      input: {
        patch: {
          projectSettingsOverrides: {
            [projectId]: { ...previous, skipDefaultBranchConfirmation: true },
          },
        },
      },
    });
    return result._tag === "Success";
  };

  const confirmAction = params.confirmAction as
    | "push"
    | "create_pr"
    | "commit_push"
    | "commit_push_pr"
    | undefined;
  const branchName = params.branchName ?? "";
  const includesCommit = params.includesCommit === "true";
  const environmentId = params.environmentId ?? "";
  const threadId = params.threadId ?? "";

  const copy = useMemo(
    () =>
      confirmAction
        ? resolveDefaultBranchActionDialogCopy({
            action: confirmAction,
            branchName,
            includesCommit,
            terminology,
          })
        : null,
    [branchName, confirmAction, includesCommit, terminology],
  );

  const continuePendingAction = async () => {
    if (!canWriteSourceControl || !confirmAction) return;
    if (!(await rememberChoice())) return; // fork: source-control-cockpit
    navigation.dispatch(StackActions.replace("Thread", { environmentId, threadId }));
    await gitActions.onRunSelectedThreadGitAction({
      action: confirmAction,
      ...(params.commitMessage ? { commitMessage: params.commitMessage } : {}),
      ...(params.filePaths ? { filePaths: params.filePaths.split(",") } : {}),
    });
  };

  const movePendingActionToFeatureBranch = useCallback(async () => {
    if (!canChangeThreadBranch || !confirmAction) return;
    navigation.dispatch(StackActions.replace("Thread", { environmentId, threadId }));

    if (includesCommit) {
      await gitActions.onRunSelectedThreadGitAction({
        action: confirmAction,
        featureBranch: true,
        ...(params.commitMessage ? { commitMessage: params.commitMessage } : {}),
        ...(params.filePaths ? { filePaths: params.filePaths.split(",") } : {}),
      });
      return;
    }

    const branches =
      gitState.selectedThreadBranches.length > 0
        ? gitState.selectedThreadBranches
        : await gitActions.refreshSelectedThreadBranches();
    if (branches === null) return;
    const newBranchName = resolveAutoFeatureBranchName(
      Arr.filterMap(branches, (branch) =>
        branch.isRemote ? Result.failVoid : Result.succeed(branch.name),
      ),
    );
    const created = await gitActions.onCreateSelectedThreadBranch(newBranchName);
    if (created === null) return;
    await gitActions.onRunSelectedThreadGitAction({ action: confirmAction });
  }, [
    canChangeThreadBranch,
    confirmAction,
    gitActions,
    gitState.selectedThreadBranches,
    includesCommit,
    params,
    navigation,
    environmentId,
    threadId,
  ]);

  return (
    <FitSheet
      header={<SheetHeader title="Confirm action" onClose={() => navigation.goBack()} />}
      showsVerticalScrollIndicator={false}
    >
      <SheetIntro
        eyebrow="Confirm"
        title={copy?.title ?? "Run action on default branch?"}
        description={
          `${copy?.description ?? "Choose how to continue."} Checking out a feature branch switches this folder for every conversation using it.` /* fork: source-control-cockpit */
        }
      />

      {/* fork: source-control-cockpit */}
      {canRemember && selectedThreadProject && (
        <View className="flex-row items-center justify-between gap-2">
          <Text>Don't ask again for this project</Text>
          <Switch
            accessibilityLabel="Don't ask again for this project"
            value={remember}
            onValueChange={setRemember}
          />
        </View>
      )}

      <View className="gap-3">
        <SheetActionButton
          icon="arrow.right.circle"
          label={copy?.continueLabel ?? "Continue"}
          tone="primary" // fork: source-control-cockpit
          disabled={!canWriteSourceControl}
          onPress={() => void continuePendingAction()}
        />
        <SheetActionButton
          icon="arrow.branch"
          label={
            otherCount > 0
              ? `Feature branch (switches ${otherCount} other conversation${otherCount === 1 ? "" : "s"})`
              : "Feature branch (switches this folder)"
          } // fork: source-control-cockpit
          disabled={!canChangeThreadBranch}
          tone="secondary" // fork: source-control-cockpit
          onPress={() => void movePendingActionToFeatureBranch()}
        />
      </View>
    </FitSheet>
  );
}
