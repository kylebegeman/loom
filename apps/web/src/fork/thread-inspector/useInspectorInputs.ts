import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type OrchestrationThreadActivity,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import { useMemo } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { deriveLatestContextWindowSnapshot } from "~/lib/contextWindow";
import { deriveProviderInstanceEntries } from "~/providerInstances";
import {
  derivePhase,
  deriveActivePlanState,
  findLatestProposedPlan,
  isLatestTurnSettled,
} from "~/session-logic";
import { useProject, useServerConfigs, useThread, useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useKnownTerminalSessions } from "~/state/terminalSessions";
import { vcsEnvironment } from "~/state/vcs";
import type { InspectorGitState, InspectorInputs, InspectorProvider } from "./model";

const EMPTY_ACTIVITIES: ReadonlyArray<OrchestrationThreadActivity> = [];

/**
 * Gathers the inspector inputs from the same atoms and derivations ChatView uses, so the
 * active thread's subscriptions and git status query are shared rather than duplicated.
 */
export function useInspectorInputs(threadRef: ScopedThreadRef): InspectorInputs {
  const draft = useComposerDraftStore((store) => store.getDraftSessionByRef(threadRef));
  const thread = useThread(threadRef, { waitForShell: draft !== null });
  // Live-turn flags ride on the shell only; the same atom useThread already reads.
  const shell = useThreadShell(threadRef);
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

  const activities = thread?.activities ?? EMPTY_ACTIVITIES;
  const session = thread?.session ?? null;
  const latestTurn = thread?.latestTurn ?? null;
  const latestTurnId = latestTurn?.turnId;
  const sessionLive = derivePhase(session) !== "disconnected";
  const pending = useMemo(() => derivePendingRequests(activities), [activities]);
  const agents = useMemo(
    () => deriveAgentPanelModel({ agents: foldSubagentActivities(activities, { sessionLive }) }),
    [activities, sessionLive],
  );
  const activePlan = useMemo(
    () => deriveActivePlanState(activities, latestTurnId),
    [activities, latestTurnId],
  );
  const contextWindow = useMemo(() => deriveLatestContextWindowSnapshot(activities), [activities]);
  const latestTurnSettled = isLatestTurnSettled(latestTurn, session);
  const proposedPlans = thread?.proposedPlans;
  const proposedPlan = useMemo(
    () =>
      latestTurnSettled && proposedPlans
        ? findLatestProposedPlan(proposedPlans, latestTurnId ?? null)
        : null,
    [latestTurnId, latestTurnSettled, proposedPlans],
  );
  const terminalSessions = useKnownTerminalSessions({
    environmentId: threadRef.environmentId,
    threadId: thread === null ? null : threadRef.threadId,
  });
  const runningTerminals = useMemo(
    () =>
      terminalSessions
        .filter((candidate) => candidate.state.hasRunningSubprocess)
        .map((candidate) => ({
          id: candidate.target.terminalId,
          label: resolveTerminalSessionLabel(candidate.target.terminalId, candidate.state.summary),
        })),
    [terminalSessions],
  );

  const providers = serverConfig?.providers;
  const modelSelection = thread?.modelSelection ?? null;
  const providerInstanceId = session?.providerInstanceId ?? modelSelection?.instanceId ?? null;
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
  const planProgress = shell?.planProgress ?? null;
  const backgroundLiveness = shell?.backgroundLiveness ?? null;
  const linkedPullRequest = thread?.linkedPullRequest ?? thread?.branchPullRequest ?? null;
  const projectName = project?.title ?? null;
  const supportsPullRequests = serverConfig?.environment.capabilities.pullRequests === true;
  const lastCheckpoint = thread?.checkpoints.at(-1) ?? null;
  return useMemo(
    () => ({
      thread: {
        isDraft,
        session,
        latestTurn,
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
      lastCheckpoint,
      activePlan,
      proposedPlan,
      approvals: pending.approvals,
      userInputs: pending.userInputs,
      agents,
      runningTerminals,
      contextWindow,
    }),
    [
      activePlan,
      agents,
      backgroundLiveness,
      branch,
      contextWindow,
      git,
      interactionMode,
      isDraft,
      lastCheckpoint,
      latestTurn,
      linkedPullRequest,
      pending,
      planProgress,
      projectName,
      proposedPlan,
      provider,
      runningTerminals,
      runtimeMode,
      session,
      supportsPullRequests,
      worktreePath,
    ],
  );
}
