import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { projectedSubagentsToRuntime } from "@t3tools/client-runtime/state/subagentRuntime";
import { deriveThreadCheckpointSummaries } from "@t3tools/client-runtime/state/thread-checkpoints";
import {
  deriveLatestThreadRun,
  deriveThreadActivityRun,
  deriveThreadRuntime,
  presentPendingBackgroundWork,
} from "@t3tools/client-runtime/state/thread-execution";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import { useMemo } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { deriveLatestContextWindowSnapshot } from "~/lib/contextWindow";
import { deriveProviderInstanceEntries } from "~/providerInstances";
import {
  deriveActivePlanState,
  derivePendingApprovals,
  derivePendingUserInputs,
  findLatestProposedPlan,
  isLatestRunSettled,
} from "~/session-logic";
import {
  resolveThreadDetailRef,
  useProject,
  useServerConfigs,
  useThreadProjection,
  useThreadShell,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useKnownTerminalSessions } from "~/state/terminalSessions";
import { vcsEnvironment } from "~/state/vcs";
import type { InspectorGitState, InspectorInputs, InspectorProvider } from "./model";

/**
 * Gathers the inspector inputs from the same atoms and derivations ChatView uses, so the
 * active thread's subscriptions and git status query are shared rather than duplicated.
 */
export function useInspectorInputs(threadRef: ScopedThreadRef): InspectorInputs {
  const draft = useComposerDraftStore((store) => store.getDraftSessionByRef(threadRef));
  const thread = useThreadShell(threadRef);
  const detailRef = resolveThreadDetailRef(threadRef, {
    shellExists: thread !== null,
    waitForShell: draft !== null,
  });
  const projection = useThreadProjection(detailRef)?.projection ?? null;
  const visibleTurnItems = useThreadVisibleTurnItems(detailRef);
  const projectId = thread?.projectId ?? draft?.projectId ?? null;
  const project = useProject(
    projectId === null ? null : scopeProjectRef(threadRef.environmentId, projectId),
  );
  const serverConfig = useServerConfigs().get(threadRef.environmentId) ?? null;

  const worktreePath = thread?.worktreePath ?? draft?.worktreePath ?? null;
  const gitCwd = thread === null ? null : (worktreePath ?? project?.workspaceRoot ?? null);
  const gitQuery = useEnvironmentQuery(
    gitCwd === null
      ? null
      : vcsEnvironment.status({ environmentId: threadRef.environmentId, input: { cwd: gitCwd } }),
  );
  const git = useMemo((): InspectorGitState => {
    if (gitCwd === null) return { state: "none" };
    if (gitQuery.data) return { state: "ready", status: gitQuery.data };
    if (gitQuery.error) return { state: "error", message: gitQuery.error };
    return { state: "loading" };
  }, [gitCwd, gitQuery.data, gitQuery.error]);

  const derived = useMemo(() => {
    if (projection === null) {
      return {
        runtime: thread?.runtime ?? null,
        latestRun: thread?.latestRun ?? null,
        activityRun: thread?.latestRun ?? null,
        approvals: [],
        userInputs: [],
        agents: [],
        lastCheckpoint: null,
      };
    }
    const pending = derivePendingThreadRequests(projection);
    return {
      runtime: deriveThreadRuntime(projection),
      latestRun: deriveLatestThreadRun(projection),
      activityRun: deriveThreadActivityRun(projection),
      approvals: derivePendingApprovals(pending.approvals),
      userInputs: derivePendingUserInputs(pending.userInputs),
      agents: projectedSubagentsToRuntime(projection.subagents),
      lastCheckpoint: deriveThreadCheckpointSummaries(projection).at(-1) ?? null,
    };
  }, [projection, thread?.latestRun, thread?.runtime]);
  const { runtime, latestRun, activityRun } = derived;
  const activityRunSettled = isLatestRunSettled(activityRun, runtime);
  const activePlan = useMemo(
    () => deriveActivePlanState(projection, activityRun?.runId),
    [activityRun?.runId, projection],
  );
  // Step progress for the running turn's own plan only, as ChatView's composer shows it.
  const planProgress = useMemo(() => {
    if (activityRunSettled || !activePlan || activePlan.runId !== (activityRun?.runId ?? null)) {
      return null;
    }
    const totalSteps = activePlan.steps.length;
    if (totalSteps === 0) return null;
    const step =
      activePlan.steps.find((candidate) => candidate.status === "inProgress")?.step ??
      activePlan.steps.find((candidate) => candidate.status === "pending")?.step ??
      activePlan.steps.at(-1)!.step;
    const completedSteps = activePlan.steps.filter((c) => c.status === "completed").length;
    return { step, completedSteps, totalSteps };
  }, [activityRun?.runId, activityRunSettled, activePlan]);
  const contextWindow = useMemo(() => {
    const liveUsage = projection?.providerTurns.findLast(
      (turn) => turn.tokenUsage !== undefined,
    )?.tokenUsage;
    return deriveLatestContextWindowSnapshot(
      visibleTurnItems,
      liveUsage ?? null,
      projection?.providerThreads.find(
        (candidate) => candidate.id === projection.thread.activeProviderThreadId,
      ),
    );
  }, [projection, visibleTurnItems]);
  const latestRunSettled = isLatestRunSettled(latestRun, runtime);
  const latestRunId = latestRun?.runId ?? null;
  const proposedPlan = useMemo(
    () => (latestRunSettled ? findLatestProposedPlan(projection, latestRunId) : null),
    [latestRunId, latestRunSettled, projection],
  );
  const terminalSessions = useKnownTerminalSessions({
    environmentId: threadRef.environmentId,
    threadId: thread === null ? null : threadRef.threadId,
  });
  const runningTerminals = useMemo(
    () =>
      (terminalSessions ?? [])
        .filter((candidate) => candidate.state.hasRunningSubprocess)
        .map((candidate) => ({
          id: candidate.target.terminalId,
          label: resolveTerminalSessionLabel(candidate.target.terminalId, candidate.state.summary),
        })),
    [terminalSessions],
  );

  const providers = serverConfig?.providers;
  const modelSelection = thread?.modelSelection ?? null;
  const providerInstanceId = runtime?.providerInstanceId ?? modelSelection?.instanceId ?? null;
  const provider = useMemo((): InspectorProvider | null => {
    if (!providers || !modelSelection || providerInstanceId === null) return null;
    const entry = deriveProviderInstanceEntries(providers).find(
      (candidate) => candidate.instanceId === providerInstanceId,
    );
    const model =
      entry?.models.find((candidate) => candidate.slug === modelSelection.model)?.name ??
      modelSelection.model;
    return {
      displayName: entry?.displayName ?? modelSelection.instanceId,
      model,
      driverKind: entry?.driverKind ?? null,
    };
  }, [modelSelection, providerInstanceId, providers]);

  const isDraft = thread === null;
  const runtimeMode = thread?.runtimeMode ?? draft?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode =
    thread?.interactionMode ?? draft?.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE;
  const branch = thread?.branch ?? draft?.branch ?? null;
  const pendingBackgroundTasks = thread?.pendingBackgroundTasks;
  const backgroundLiveness = useMemo(() => {
    const work = presentPendingBackgroundWork(pendingBackgroundTasks ?? []);
    return work === null ? null : work.waiting ? ("working" as const) : ("monitoring" as const);
  }, [pendingBackgroundTasks]);
  const linkedPullRequest = thread?.linkedPullRequest ?? thread?.branchPullRequest ?? null;
  const projectName = project?.title ?? null;
  const supportsPullRequests = serverConfig?.environment.capabilities.pullRequests === true;
  return useMemo(
    () => ({
      thread: {
        isDraft,
        runtime,
        latestRun,
        runtimeMode,
        interactionMode,
        branch,
        worktreePath,
        planProgress,
        backgroundLiveness,
        linkedPullRequest,
      },
      projectName,
      provider,
      supportsPullRequests,
      git,
      lastCheckpoint: derived.lastCheckpoint,
      activePlan,
      proposedPlan,
      approvals: derived.approvals,
      userInputs: derived.userInputs,
      agents: derived.agents,
      runningTerminals,
      contextWindow,
    }),
    [
      activePlan,
      backgroundLiveness,
      branch,
      contextWindow,
      derived,
      git,
      interactionMode,
      isDraft,
      latestRun,
      linkedPullRequest,
      planProgress,
      projectName,
      proposedPlan,
      provider,
      runningTerminals,
      runtime,
      runtimeMode,
      supportsPullRequests,
      worktreePath,
    ],
  );
}
