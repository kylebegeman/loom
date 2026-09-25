import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import {
  ApprovalRequestId,
  CheckpointRef,
  OrchestrationProposedPlanId,
  ThreadId,
  TurnId,
  type OrchestrationSession,
  type VcsStatusResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveInspectorModel,
  type InspectorInputs,
  type InspectorModel,
  type InspectorSectionId,
} from "./model";

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
    providerLabel: "Codex · GPT-5.5",
    supportsPullRequests: true,
    git: { state: "ready", status: gitStatus() },
    lastCheckpoint: null,
    activePlan: null,
    proposedPlan: null,
    approvals: [],
    userInputs: [],
    agents: emptyAgentPanelModel(),
    runningTerminalIds: [],
    contextWindow: null,
    ...overrides,
  };
}

const withThread = (thread: Partial<InspectorInputs["thread"]>) => ({
  thread: { ...inputs().thread, ...thread },
});

const section = (model: InspectorModel, id: InspectorSectionId) =>
  model.sections.find((candidate) => candidate.id === id);

const statusOf = (model: InspectorModel) => section(model, "status")?.rows[0];

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

describe("deriveInspectorModel status", () => {
  it("ranks approval over input over error over working over interrupted over ready", () => {
    const running = withThread({ session: session("running") });
    const errored = withThread({ session: session("error", "Provider crashed") });

    expect(
      statusOf(
        deriveInspectorModel(inputs({ ...errored, approvals: [approval], userInputs: [question] })),
      )?.label,
    ).toBe("Needs approval");
    expect(
      statusOf(deriveInspectorModel(inputs({ ...errored, userInputs: [question] })))?.label,
    ).toBe("Needs input");
    expect(statusOf(deriveInspectorModel(inputs(errored)))).toMatchObject({
      label: "Error",
      value: "Provider crashed",
      tone: "danger",
    });
    expect(statusOf(deriveInspectorModel(inputs(running)))?.label).toBe("Working");
    expect(
      statusOf(deriveInspectorModel(inputs(withThread({ session: session("interrupted") }))))
        ?.label,
    ).toBe("Interrupted");
    expect(statusOf(deriveInspectorModel(inputs()))?.label).toBe("Ready");
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
    expect(statusOf(model)).toMatchObject({
      label: "Working",
      value: "Write tests (2/5)",
      since: "2026-09-25T10:00:00.000Z",
      tone: "info",
    });
  });
});

describe("deriveInspectorModel changes", () => {
  it("hides Changes and says so in Workspace outside a git repository", () => {
    const model = deriveInspectorModel(
      inputs({ git: { state: "ready", status: gitStatus({ isRepo: false, refName: null }) } }),
    );
    expect(section(model, "changes")).toBeUndefined();
    expect(section(model, "workspace")?.rows.map((row) => row.label)).toContain(
      "Not a git repository",
    );
  });

  it("lists the five largest files after the totals", () => {
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
            workingTree: { files, insertions: 92, deletions: 0 },
          }),
        },
      }),
    );
    const rows = section(model, "changes")?.rows ?? [];
    expect(rows[0]).toMatchObject({
      label: "7 files",
      diff: { additions: 92, deletions: 0 },
      action: { action: { kind: "open-diff" } },
    });
    expect(rows.slice(1).map((row) => row.label)).toEqual([
      "src/file-1.ts",
      "src/file-3.ts",
      "src/file-5.ts",
      "src/file-4.ts",
      "src/file-2.ts",
    ]);
  });

  it("adds a last turn row only for a ready checkpoint with files", () => {
    const checkpoint = {
      turnId: TURN,
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("refs/t3/checkpoint-1"),
      status: "ready",
      files: [{ path: "a.ts", kind: "modified", additions: 3, deletions: 1 }],
      assistantMessageId: null,
      completedAt: "2026-09-25T10:00:00.000Z",
    } as const;
    const lastTurn = (model: InspectorModel) =>
      section(model, "changes")?.rows.find((row) => row.id === "last-turn");

    expect(lastTurn(deriveInspectorModel(inputs({ lastCheckpoint: checkpoint })))).toMatchObject({
      value: "1 file",
      diff: { additions: 3, deletions: 1 },
      action: { action: { kind: "open-turn-diff", turnId: TURN } },
    });
    expect(
      lastTurn(
        deriveInspectorModel(inputs({ lastCheckpoint: { ...checkpoint, status: "missing" } })),
      ),
    ).toBeUndefined();
    expect(
      lastTurn(deriveInspectorModel(inputs({ lastCheckpoint: { ...checkpoint, files: [] } }))),
    ).toBeUndefined();
  });
});

describe("deriveInspectorModel plan", () => {
  it("caps the steps and counts the rest", () => {
    const steps = Array.from({ length: 11 }, (_, index) => ({
      step: `Step ${index + 1}`,
      status: index < 3 ? ("completed" as const) : ("pending" as const),
    }));
    const model = deriveInspectorModel(
      inputs({ activePlan: { createdAt: "2026-09-25T10:00:00.000Z", turnId: TURN, steps } }),
    );
    const plan = section(model, "plan");
    expect(plan?.rows).toHaveLength(9);
    expect(plan?.rows.at(-1)?.label).toBe("and 3 more");
    expect(plan?.summary).toBe("3/11 steps");
  });

  it("links a proposed plan to the thread that implemented it", () => {
    const implementationThreadId = ThreadId.make("thread-2");
    const model = deriveInspectorModel(
      inputs({
        proposedPlan: {
          id: OrchestrationProposedPlanId.make("plan-1"),
          createdAt: "2026-09-25T10:00:00.000Z",
          updatedAt: "2026-09-25T10:00:00.000Z",
          turnId: TURN,
          planMarkdown: "# Plan",
          implementedAt: "2026-09-25T11:00:00.000Z",
          implementationThreadId,
        },
      }),
    );
    expect(section(model, "plan")?.rows).toEqual([
      expect.objectContaining({
        value: "Implemented",
        action: {
          label: "Open",
          action: { kind: "open-thread", threadId: implementationThreadId },
        },
      }),
    ]);
  });
});

describe("deriveInspectorModel attention and densities", () => {
  it("needs attention exactly when an approval or a question waits", () => {
    expect(deriveInspectorModel(inputs()).needsAttention).toBe(false);
    expect(deriveInspectorModel(inputs({ approvals: [approval] })).needsAttention).toBe(true);
    expect(deriveInspectorModel(inputs({ userInputs: [question] })).needsAttention).toBe(true);
    const attention = section(
      deriveInspectorModel(inputs({ approvals: [approval], userInputs: [question] })),
      "attention",
    );
    expect(attention?.rows.map((row) => [row.value, row.action?.action.kind])).toEqual([
      ["rm -rf dist", "focus-composer"],
      ["Which package?", "focus-composer"],
    ]);
  });

  it("marks only Status and Attention essential", () => {
    const essential = deriveInspectorModel(inputs())
      .sections.filter((candidate) => candidate.essential)
      .map((candidate) => candidate.id);
    expect(essential).toEqual(["status", "attention"]);
  });

  it("shows only Status and Workspace for a draft", () => {
    const model = deriveInspectorModel(
      inputs({ ...withThread({ isDraft: true, session: null }), approvals: [approval] }),
    );
    expect(model.sections.map((candidate) => candidate.id)).toEqual(["status", "workspace"]);
    expect(statusOf(model)?.value).toBe("Send a message to start this thread.");
    expect(model.needsAttention).toBe(false);
  });
});
