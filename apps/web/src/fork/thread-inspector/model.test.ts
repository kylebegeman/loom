import {
  emptyAgentPanelModel,
  type AgentPanelModel,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  ApprovalRequestId,
  CheckpointRef,
  OrchestrationProposedPlanId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type OrchestrationSession,
  type VcsStatusResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveInspectorModel, INSPECTOR_AGENT_ROW_LIMIT, type InspectorInputs } from "./model";

const TURN = TurnId.make("turn-1");

const session = (status: OrchestrationSession["status"], lastError: string | null = null) =>
  ({
    threadId: ThreadId.make("thread-1"),
    status,
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: status === "running" ? TURN : null,
    lastError,
    updatedAt: "2026-09-25T10:00:00.000Z",
  }) satisfies OrchestrationSession;

const gitStatus = (overrides: Partial<VcsStatusResult> = {}): VcsStatusResult => ({
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "feature/inspector",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
  ...overrides,
});

function inputs(overrides: Partial<InspectorInputs> = {}): InspectorInputs {
  return {
    thread: {
      isDraft: false,
      session: session("ready"),
      latestTurn: null,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "feature/inspector",
      worktreePath: null,
      planProgress: null,
      backgroundLiveness: null,
      linkedPullRequest: null,
    },
    projectName: "loom",
    provider: {
      displayName: "Codex",
      model: "GPT-5.5",
      driverKind: ProviderDriverKind.make("codex"),
    },
    supportsPullRequests: true,
    git: { state: "ready", status: gitStatus() },
    lastCheckpoint: null,
    activePlan: null,
    proposedPlan: null,
    approvals: [],
    userInputs: [],
    agents: emptyAgentPanelModel(),
    runningTerminals: [],
    contextWindow: null,
    ...overrides,
  };
}

const withThread = (thread: Partial<InspectorInputs["thread"]>) => ({
  thread: { ...inputs().thread, ...thread },
});

const approval = {
  requestId: ApprovalRequestId.make("approval-1"),
  requestKind: "command",
  createdAt: "2026-09-25T10:00:00.000Z",
  detail: "rm -rf dist",
} as const;

const question = {
  requestId: ApprovalRequestId.make("input-1"),
  createdAt: "2026-09-25T10:00:00.000Z",
  dismissible: false,
  questions: [{ id: "q", header: "Scope", question: "Which package?", options: [] }],
};

const proposedPlan = (implementedAt: string | null, implementationThreadId: ThreadId | null) => ({
  id: OrchestrationProposedPlanId.make("plan-1"),
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:00:00.000Z",
  turnId: TURN,
  planMarkdown: "# Plan",
  implementedAt,
  implementationThreadId,
});

const agent = (id: string, status: RuntimeSubagent["status"]): RuntimeSubagent => ({
  id,
  kind: "subagent",
  title: `Agent ${id}`,
  role: null,
  model: null,
  effort: null,
  status,
  activationCount: 1,
  usage: null,
  progress: status === "running" ? "Reading files" : null,
  lastToolName: null,
  result: status === "completed" ? "Done" : null,
  error: null,
  outputFile: null,
  parentAgentId: null,
  agentIndex: null,
  phaseIndex: null,
  phaseTitle: null,
  attempt: null,
  workflowName: null,
  phases: [],
  runHandles: null,
  recentActivity: [],
  firstSeenAt: "2026-09-25T10:00:00.000Z",
  startedAt: "2026-09-25T10:00:00.000Z",
  completedAt: status === "completed" ? "2026-09-25T10:01:00.000Z" : null,
  updatedAt: "2026-09-25T10:00:00.000Z",
});

const agentsModel = (directAgents: ReadonlyArray<RuntimeSubagent>): AgentPanelModel => {
  const live = directAgents.filter((candidate) => candidate.status === "running").length;
  const settled = directAgents.filter((candidate) => candidate.status === "completed").length;
  return {
    ...emptyAgentPanelModel(),
    directAgents,
    hasAgents: directAgents.length > 0,
    runningCount: live,
    settledCount: settled,
    liveCount: live,
  };
};

describe("deriveInspectorModel status", () => {
  it("ranks approval over input over error over working over interrupted over ready", () => {
    const running = withThread({ session: session("running") });
    const errored = withThread({ session: session("error", "Provider crashed") });
    const status = (overrides: Partial<InspectorInputs>) =>
      deriveInspectorModel(inputs(overrides)).status;

    expect(status({ ...errored, approvals: [approval], userInputs: [question] })).toMatchObject({
      label: "Needs approval",
      tone: "warning",
      detail: "Command approval",
      respond: true,
    });
    expect(status({ ...errored, userInputs: [question] })).toMatchObject({
      label: "Needs input",
      tone: "accent",
      detail: "Which package?",
      respond: true,
    });
    expect(status(errored)).toMatchObject({
      label: "Error",
      detail: "Provider crashed",
      tone: "danger",
    });
    expect(status(running).label).toBe("Working");
    expect(status(withThread({ session: session("interrupted") })).label).toBe("Interrupted");
    expect(status({})).toMatchObject({ label: "Ready", tone: "success", respond: false });
  });

  it("shows the plan step, its counts and the turn start while working", () => {
    const model = deriveInspectorModel(
      inputs(
        withThread({
          session: session("running"),
          latestTurn: {
            turnId: TURN,
            state: "running",
            requestedAt: "2026-09-25T09:59:58.000Z",
            startedAt: "2026-09-25T10:00:00.000Z",
            completedAt: null,
            assistantMessageId: null,
          },
          planProgress: { step: "Write tests", completedSteps: 2, totalSteps: 5 },
        }),
      ),
    );
    expect(model.status).toEqual({
      label: "Working",
      tone: "info",
      detail: "Write tests",
      since: "2026-09-25T10:00:00.000Z",
      progress: { completed: 2, total: 5 },
      respond: false,
    });
  });

  it("reports a ready plan in plan mode ahead of background work", () => {
    const model = deriveInspectorModel(
      inputs({
        ...withThread({ interactionMode: "plan", backgroundLiveness: "working" }),
        proposedPlan: proposedPlan(null, null),
      }),
    );
    expect(model.status).toMatchObject({ label: "Plan ready", tone: "accent" });
    expect(model.facts.map((fact) => fact.label)).toEqual(["GPT-5.5", "Full access", "Plan mode"]);
    expect(model.facts[0]).toMatchObject({
      id: "model",
      title: "Codex · GPT-5.5",
      driverKind: "codex",
    });
  });
});

describe("deriveInspectorModel workspace and pull request", () => {
  it("drops Changes and explains why outside a git repository", () => {
    const model = deriveInspectorModel(
      inputs({ git: { state: "ready", status: gitStatus({ isRepo: false, refName: null }) } }),
    );
    expect(model.changes).toBeNull();
    expect(model.workspace.map((entry) => [entry.id, entry.value])).toEqual([
      ["project", "loom"],
      ["git", "Not a git repository"],
    ]);
  });

  it("offers the branch and worktree path to copy, with a short worktree name", () => {
    const model = deriveInspectorModel(
      inputs({
        ...withThread({ worktreePath: "/Users/kyle/Developer/active/loom-l04/" }),
        git: { state: "ready", status: gitStatus({ aheadCount: 2, behindCount: 1 }) },
      }),
    );
    expect(model.workspace).toEqual([
      { id: "project", name: "Project", value: "loom" },
      {
        id: "branch",
        name: "Branch",
        value: "feature/inspector",
        mono: true,
        copy: "feature/inspector",
      },
      { id: "remote", name: "Remote", value: "2 ahead · 1 behind" },
      {
        id: "worktree",
        name: "Worktree",
        value: "/Users/kyle/Developer/active/loom-l04/",
        short: "loom-l04",
        mono: true,
        copy: "/Users/kyle/Developer/active/loom-l04/",
      },
    ]);
  });

  it("opens a linked pull request and only describes one known from git", () => {
    const pr = {
      number: 12,
      title: "Add the inspector",
      url: "https://example.test/pr/12",
      baseRef: "main",
      headRef: "feature/inspector",
      state: "open",
      isDraft: true,
    } as const;
    const linked = {
      projectId: ProjectId.make("project-1"),
      repository: "kylebegeman/loom",
      number: 12,
      url: pr.url,
    } as const;
    const linkedModel = deriveInspectorModel(
      inputs({
        ...withThread({ linkedPullRequest: linked }),
        git: { state: "ready", status: gitStatus({ pr }) },
      }),
    );
    expect(linkedModel.pullRequest).toEqual({
      number: 12,
      state: "Draft",
      tone: "muted",
      glyph: "draft",
      title: "Add the inspector",
      action: { kind: "open-pull-request", pullRequest: linked },
    });
    const knownModel = deriveInspectorModel(
      inputs({ git: { state: "ready", status: gitStatus({ pr: { ...pr, state: "merged" } }) } }),
    );
    expect(knownModel.pullRequest).toMatchObject({
      state: "Merged",
      tone: "accent",
      glyph: "merged",
      action: null,
    });
  });
});

describe("deriveInspectorModel changes", () => {
  it("lists every file, largest change first, with the totals", () => {
    const sizes = [1, 40, 3, 25, 9, 12, 2];
    const files = sizes.map((size, index) => ({
      path: `src/file-${index}.ts`,
      insertions: size,
      deletions: 0,
    }));
    const model = deriveInspectorModel(
      inputs({
        git: {
          state: "ready",
          status: gitStatus({
            hasWorkingTreeChanges: true,
            workingTree: { files, insertions: 92, deletions: 4 },
          }),
        },
      }),
    );
    expect(model.changes).toMatchObject({ state: "ready", additions: 92, deletions: 4 });
    expect(model.changes?.files.map((file) => file.path)).toEqual([
      "src/file-1.ts",
      "src/file-3.ts",
      "src/file-5.ts",
      "src/file-4.ts",
      "src/file-2.ts",
      "src/file-6.ts",
      "src/file-0.ts",
    ]);
  });

  it("keeps the last turn only for a ready checkpoint with files", () => {
    const checkpoint = {
      turnId: TURN,
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("refs/t3/checkpoint-1"),
      status: "ready",
      files: [{ path: "a.ts", kind: "modified", additions: 3, deletions: 1 }],
      assistantMessageId: null,
      completedAt: "2026-09-25T10:00:00.000Z",
    } as const;
    const lastTurn = (lastCheckpoint: InspectorInputs["lastCheckpoint"]) =>
      deriveInspectorModel(inputs({ lastCheckpoint })).changes?.lastTurn;

    expect(lastTurn(checkpoint)).toEqual({
      turnId: TURN,
      fileCount: 1,
      additions: 3,
      deletions: 1,
    });
    expect(lastTurn({ ...checkpoint, status: "missing" })).toBeNull();
    expect(lastTurn({ ...checkpoint, files: [] })).toBeNull();
  });

  it("reports loading until the first git status", () => {
    expect(deriveInspectorModel(inputs({ git: { state: "loading" } })).changes).toMatchObject({
      state: "loading",
      files: [],
    });
  });
});

describe("deriveInspectorModel plan", () => {
  it("counts finished steps and names the one in progress", () => {
    const steps = [
      { step: "Read the code", status: "completed" as const },
      { step: "Write tests", status: "inProgress" as const },
      { step: "Ship", status: "pending" as const },
    ];
    const model = deriveInspectorModel(
      inputs({ activePlan: { createdAt: "2026-09-25T10:00:00.000Z", turnId: TURN, steps } }),
    );
    expect(model.plan).toEqual({ steps, completed: 1, current: "Write tests", proposed: null });
  });

  it("links a proposed plan to the thread that implemented it", () => {
    const implementationThreadId = ThreadId.make("thread-2");
    const model = deriveInspectorModel(
      inputs({ proposedPlan: proposedPlan("2026-09-25T11:00:00.000Z", implementationThreadId) }),
    );
    expect(model.plan.proposed).toEqual({ implemented: true, threadId: implementationThreadId });
  });
});

describe("deriveInspectorModel attention, agents and context", () => {
  it("lists approvals as code and questions as prose, and flags attention", () => {
    expect(deriveInspectorModel(inputs()).needsAttention).toBe(false);
    const model = deriveInspectorModel(inputs({ approvals: [approval], userInputs: [question] }));
    expect(model.needsAttention).toBe(true);
    expect(model.attention).toEqual([
      {
        id: "approval:approval-1",
        kind: "approval",
        label: "Command approval",
        detail: "rm -rf dist",
        mono: true,
      },
      {
        id: "input:input-1",
        kind: "question",
        label: "Question",
        detail: "Which package?",
        mono: false,
      },
    ]);
  });

  it("summarizes agents and lists working ones first, capped", () => {
    const agents = [
      agent("a", "completed"),
      agent("b", "running"),
      agent("c", "completed"),
      agent("d", "running"),
      agent("e", "completed"),
      agent("f", "completed"),
      agent("g", "completed"),
    ];
    const model = deriveInspectorModel(inputs({ agents: agentsModel(agents) }));
    expect(model.agents).toMatchObject({
      hasAgents: true,
      total: 7,
      working: 2,
      finished: 5,
      summary: "2 working · 5 finished",
    });
    expect(model.agents.rows).toHaveLength(INSPECTOR_AGENT_ROW_LIMIT);
    expect(model.agents.rows.slice(0, 2)).toEqual([
      expect.objectContaining({
        id: "b",
        status: "working",
        activity: "Reading files",
        since: "2026-09-25T10:00:00.000Z",
      }),
      expect.objectContaining({ id: "d", status: "working" }),
    ]);
    expect(model.agents.rows[2]).toMatchObject({ id: "a", status: "completed", since: null });
  });

  it("tones the context window at 75 and 90 percent", () => {
    const snapshot = (usedPercentage: number) => ({
      usedTokens: usedPercentage * 1000,
      maxTokens: 100_000,
      usedPercentage,
      remainingTokens: null,
      remainingPercentage: null,
      totalProcessedTokens: null,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
      lastUsedTokens: null,
      lastInputTokens: null,
      lastCachedInputTokens: null,
      lastOutputTokens: null,
      lastReasoningOutputTokens: null,
      toolUses: null,
      durationMs: null,
      compactsAutomatically: true,
      autoCompactThreshold: 95_000,
      updatedAt: "2026-09-25T10:00:00.000Z",
    });
    const tone = (usedPercentage: number) =>
      deriveInspectorModel(inputs({ contextWindow: snapshot(usedPercentage) })).context?.tone;
    expect(tone(40)).toBe("default");
    expect(tone(75)).toBe("warning");
    expect(tone(90)).toBe("danger");
    expect(deriveInspectorModel(inputs({ contextWindow: snapshot(40) })).context).toMatchObject({
      usedTokens: 40_000,
      maxTokens: 100_000,
      compactsAutomatically: true,
      autoCompactThreshold: 95_000,
    });
    expect(deriveInspectorModel(inputs()).context).toBeNull();
  });

  it("shows only the status and workspace for a draft", () => {
    // A draft has no thread yet, so nothing asks git about a directory.
    const model = deriveInspectorModel(
      inputs({
        ...withThread({ isDraft: true, session: null }),
        git: { state: "none" },
        approvals: [approval],
      }),
    );
    expect(model).toMatchObject({
      isDraft: true,
      status: { label: "Draft", detail: "Send a message to start this thread." },
      facts: [],
      attention: [],
      changes: null,
      needsAttention: false,
    });
    expect(model.workspace.map((entry) => entry.id)).toEqual(["project", "branch"]);
  });
});
