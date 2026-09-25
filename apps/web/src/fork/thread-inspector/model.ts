import type { PendingApproval, PendingUserInput } from "@t3tools/client-runtime/pending-requests";
import type { AgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  OrchestrationCheckpointSummary,
  OrchestrationLatestTurn,
  OrchestrationSession,
  ProviderInteractionMode,
  ProviderRequestKind,
  RuntimeMode,
  ThreadId,
  ThreadLinkedPullRequest,
  TurnId,
  VcsStatusResult,
} from "@t3tools/contracts";

import { runtimeModeConfig } from "~/components/chat/runtimeModeConfig";
import { PULL_REQUEST_STATE_PRESENTATION } from "~/components/pullRequest/pullRequestIcons";
import { resolveWorkingStartedAt } from "~/components/Sidebar.logic";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import type { ActivePlanState, LatestProposedPlanState } from "~/session-logic";

export type InspectorGitState =
  /** No workspace to ask about (no project yet). */
  | { readonly state: "none" }
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly message: string }
  | { readonly state: "ready"; readonly status: VcsStatusResult };

export interface InspectorInputs {
  readonly thread: {
    readonly isDraft: boolean;
    readonly session: OrchestrationSession | null;
    readonly latestTurn: OrchestrationLatestTurn | null;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly planProgress: {
      readonly step: string;
      readonly completedSteps: number;
      readonly totalSteps: number;
    } | null;
    readonly backgroundLiveness: "working" | "monitoring" | null;
    readonly linkedPullRequest: ThreadLinkedPullRequest | null;
  };
  readonly projectName: string | null;
  /** "Codex · GPT-5.5" */
  readonly providerLabel: string | null;
  readonly supportsPullRequests: boolean;
  readonly git: InspectorGitState;
  readonly lastCheckpoint: OrchestrationCheckpointSummary | null;
  readonly activePlan: ActivePlanState | null;
  readonly proposedPlan: LatestProposedPlanState | null;
  readonly approvals: ReadonlyArray<PendingApproval>;
  readonly userInputs: ReadonlyArray<PendingUserInput>;
  readonly agents: AgentPanelModel;
  readonly runningTerminalIds: ReadonlyArray<string>;
  readonly contextWindow: ContextWindowSnapshot | null;
}

export type InspectorAction =
  | { readonly kind: "open-diff" }
  | { readonly kind: "open-turn-diff"; readonly turnId: TurnId }
  | { readonly kind: "open-agents" }
  | { readonly kind: "open-pull-request"; readonly pullRequest: ThreadLinkedPullRequest }
  | { readonly kind: "open-terminal"; readonly terminalId: string }
  | { readonly kind: "focus-composer" }
  | { readonly kind: "open-thread"; readonly threadId: ThreadId }
  | { readonly kind: "copy"; readonly text: string; readonly label: string };

/** Mapped to lucide icons in the view. */
export type InspectorIconName =
  | "status"
  | "provider"
  | "mode"
  | "project"
  | "branch"
  | "sync"
  | "worktree"
  | "pull-request"
  | "git"
  | "changes"
  | "file"
  | "turn"
  | "step-pending"
  | "step-active"
  | "step-done"
  | "plan"
  | "approval"
  | "question"
  | "agents"
  | "terminal"
  | "context"
  | "empty";

/** Status tones: info is Working, warning an approval or a filling context window, input a question. */
export type InspectorTone =
  | "default"
  | "muted"
  | "info"
  | "warning"
  | "input"
  | "danger"
  | "success";

export interface InspectorRow {
  readonly id: string;
  readonly icon: InspectorIconName;
  /** What the row is about, when the label alone does not say (read by screen readers). */
  readonly name?: string;
  /** Primary text; the tone colors it. */
  readonly label: string;
  /** Secondary, muted text. */
  readonly value?: string;
  /** Longer text for a tooltip (an error, a full path). */
  readonly detail?: string;
  readonly tone?: InspectorTone;
  readonly diff?: { readonly additions: number; readonly deletions: number };
  /** ISO start of a running interval; the view shows the elapsed time. */
  readonly since?: string;
  readonly action?: { readonly label: string; readonly action: InspectorAction };
}

export type InspectorSectionId =
  | "status"
  | "workspace"
  | "changes"
  | "plan"
  | "attention"
  | "agents"
  | "terminals"
  | "context";

export interface InspectorSectionModel {
  readonly id: InspectorSectionId;
  readonly title: string;
  readonly rows: ReadonlyArray<InspectorRow>;
  /** One line for a collapsed section in the compact density. */
  readonly summary: string;
  readonly summaryTone: InspectorTone;
  /** Always expanded in the compact density. */
  readonly essential: boolean;
}

export interface InspectorModel {
  readonly sections: ReadonlyArray<InspectorSectionModel>;
  /** Drives the header button dot. */
  readonly needsAttention: boolean;
}

export const INSPECTOR_TOP_FILE_COUNT = 5;
export const INSPECTOR_PLAN_STEP_LIMIT = 8;

const REQUEST_KIND_LABELS: Record<ProviderRequestKind, string> = {
  command: "Run a command",
  "file-read": "Read a file",
  "file-change": "Change files",
  "mcp-elicitation": "Tool request",
  permission: "Permission",
};

const RESPOND = {
  label: "Respond",
  action: { kind: "focus-composer" },
} as const satisfies InspectorRow["action"];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function statusRow(inputs: InspectorInputs): InspectorRow {
  const { thread } = inputs;
  const base = { id: "state", icon: "status" } as const;
  if (thread.isDraft) {
    return {
      ...base,
      label: "Draft",
      value: "Send a message to start this thread.",
      tone: "muted",
    };
  }
  if (inputs.approvals.length > 0) {
    return { ...base, label: "Needs approval", tone: "warning", action: RESPOND };
  }
  if (inputs.userInputs.length > 0) {
    return { ...base, label: "Needs input", tone: "input", action: RESPOND };
  }
  const session = thread.session;
  if (session?.status === "error" || thread.latestTurn?.state === "error") {
    return {
      ...base,
      label: "Error",
      tone: "danger",
      ...(session?.lastError ? { value: session.lastError, detail: session.lastError } : {}),
    };
  }
  if (session?.status === "running" || session?.status === "starting") {
    const since = resolveWorkingStartedAt({ latestTurn: thread.latestTurn, session });
    const progress = thread.planProgress;
    return {
      ...base,
      label: session.status === "starting" ? "Connecting" : "Working",
      tone: "info",
      ...(progress
        ? {
            value: `${progress.step} (${progress.completedSteps}/${progress.totalSteps})`,
            detail: progress.step,
          }
        : {}),
      ...(since ? { since } : {}),
    };
  }
  if (thread.backgroundLiveness === "working") {
    return { ...base, label: "Working", value: "Background agents", tone: "info" };
  }
  if (thread.backgroundLiveness === "monitoring") {
    return { ...base, label: "Monitoring", tone: "info" };
  }
  if (session?.status === "interrupted" || thread.latestTurn?.state === "interrupted") {
    return { ...base, label: "Interrupted", tone: "muted" };
  }
  return { ...base, label: "Ready" };
}

function statusSection(inputs: InspectorInputs): InspectorSectionModel {
  const row = statusRow(inputs);
  const rows: InspectorRow[] = [row];
  if (!inputs.thread.isDraft) {
    if (inputs.providerLabel) {
      rows.push({ id: "provider", icon: "provider", name: "Model", label: inputs.providerLabel });
    }
    const runtime =
      runtimeModeConfig[inputs.thread.runtimeMode]?.label ?? inputs.thread.runtimeMode;
    const interaction = inputs.thread.interactionMode === "plan" ? "Plan mode" : "Default mode";
    rows.push({ id: "mode", icon: "mode", name: "Mode", label: `${runtime} · ${interaction}` });
  }
  return {
    id: "status",
    title: "Status",
    rows,
    summary: row.value ? `${row.label} · ${row.value}` : row.label,
    summaryTone: row.tone ?? "default",
    essential: true,
  };
}

function syncValue(status: VcsStatusResult): string {
  if (!status.hasUpstream) return "No upstream branch";
  const parts = [
    status.aheadCount > 0 ? `${status.aheadCount} ahead` : null,
    status.behindCount > 0 ? `${status.behindCount} behind` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? "Up to date" : parts.join(" · ");
}

function workspaceSection(inputs: InspectorInputs): InspectorSectionModel {
  const { thread, git } = inputs;
  const rows: InspectorRow[] = [];
  if (inputs.projectName) {
    rows.push({ id: "project", icon: "project", name: "Project", label: inputs.projectName });
  }
  const branch = git.state === "ready" ? (git.status.refName ?? thread.branch) : thread.branch;
  if (git.state === "loading") {
    rows.push({ id: "git", icon: "git", name: "Git", label: "Checking...", tone: "muted" });
  } else if (git.state === "error") {
    rows.push({
      id: "git",
      icon: "git",
      name: "Git",
      label: "Git status unavailable",
      detail: git.message,
      tone: "danger",
    });
  } else if (git.state === "ready" && !git.status.isRepo) {
    rows.push({
      id: "git",
      icon: "git",
      name: "Git",
      label: "Not a git repository",
      tone: "muted",
    });
  }
  const isRepo = git.state !== "ready" || git.status.isRepo;
  if (isRepo && branch) {
    rows.push({ id: "branch", icon: "branch", name: "Branch", label: branch });
  }
  if (git.state === "ready" && git.status.isRepo) {
    rows.push({ id: "sync", icon: "sync", name: "Remote", label: syncValue(git.status) });
  }
  if (thread.worktreePath) {
    rows.push({
      id: "worktree",
      icon: "worktree",
      name: "Worktree",
      label: thread.worktreePath,
      detail: thread.worktreePath,
      action: {
        label: "Copy path",
        action: { kind: "copy", text: thread.worktreePath, label: "Worktree path" },
      },
    });
  }
  const pullRequest = inputs.supportsPullRequests ? thread.linkedPullRequest : null;
  const statusPr = git.state === "ready" ? git.status.pr : null;
  if (pullRequest) {
    const known = statusPr?.number === pullRequest.number ? statusPr : null;
    rows.push({
      id: "pull-request",
      icon: "pull-request",
      name: "Pull request",
      label: known
        ? `#${pullRequest.number} · ${pullRequestStateLabel(known)}`
        : `#${pullRequest.number}`,
      ...(known ? { value: known.title, detail: known.title } : {}),
      action: { label: "Open", action: { kind: "open-pull-request", pullRequest } },
    });
  } else if (statusPr) {
    rows.push({
      id: "pull-request",
      icon: "pull-request",
      name: "Pull request",
      label: `#${statusPr.number} · ${pullRequestStateLabel(statusPr)}`,
      value: statusPr.title,
      detail: statusPr.title,
    });
  }
  return {
    id: "workspace",
    title: "Workspace",
    rows,
    summary: branch ?? inputs.projectName ?? "No workspace",
    summaryTone: "default",
    essential: false,
  };
}

function pullRequestStateLabel(pr: NonNullable<VcsStatusResult["pr"]>): string {
  const state = pr.isDraft && pr.state === "open" ? "draft" : pr.state;
  return PULL_REQUEST_STATE_PRESENTATION[state].label;
}

function changesSection(inputs: InspectorInputs): InspectorSectionModel | null {
  const { git, lastCheckpoint } = inputs;
  if (git.state === "none" || git.state === "error") return null;
  if (git.state === "ready" && !git.status.isRepo) return null;
  const rows: InspectorRow[] = [];
  let summary = "Checking...";
  let summaryTone: InspectorTone = "muted";
  if (git.state === "loading") {
    rows.push({ id: "checking", icon: "changes", label: "Checking...", tone: "muted" });
  } else {
    const tree = git.status.workingTree;
    if (tree.files.length === 0) {
      rows.push({ id: "none", icon: "empty", label: "No changes", tone: "muted" });
      summary = "No changes";
    } else {
      const diff = { additions: tree.insertions, deletions: tree.deletions };
      rows.push({
        id: "working-tree",
        icon: "changes",
        label: plural(tree.files.length, "file"),
        diff,
        action: { label: "Review", action: { kind: "open-diff" } },
      });
      summary = `${plural(tree.files.length, "file")} +${tree.insertions} -${tree.deletions}`;
      summaryTone = "default";
      const top = tree.files
        .toSorted(
          (left, right) =>
            right.insertions + right.deletions - (left.insertions + left.deletions) ||
            left.path.localeCompare(right.path),
        )
        .slice(0, INSPECTOR_TOP_FILE_COUNT);
      for (const file of top) {
        rows.push({
          id: `file:${file.path}`,
          icon: "file",
          label: file.path,
          detail: file.path,
          diff: { additions: file.insertions, deletions: file.deletions },
        });
      }
    }
  }
  if (lastCheckpoint?.status === "ready" && lastCheckpoint.files.length > 0) {
    rows.push({
      id: "last-turn",
      icon: "turn",
      label: "Last turn",
      value: plural(lastCheckpoint.files.length, "file"),
      diff: lastCheckpoint.files.reduce(
        (total, file) => ({
          additions: total.additions + file.additions,
          deletions: total.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
      action: {
        label: "Last turn",
        action: { kind: "open-turn-diff", turnId: lastCheckpoint.turnId },
      },
    });
  }
  return { id: "changes", title: "Changes", rows, summary, summaryTone, essential: false };
}

function planSection(inputs: InspectorInputs): InspectorSectionModel {
  const { activePlan, proposedPlan } = inputs;
  const rows: InspectorRow[] = [];
  let summary = "No plan";
  if (activePlan && activePlan.steps.length > 0) {
    const done = activePlan.steps.filter((step) => step.status === "completed").length;
    summary = `${done}/${activePlan.steps.length} steps`;
    activePlan.steps.slice(0, INSPECTOR_PLAN_STEP_LIMIT).forEach((step, index) => {
      rows.push({
        id: `step:${index}`,
        icon:
          step.status === "completed"
            ? "step-done"
            : step.status === "inProgress"
              ? "step-active"
              : "step-pending",
        label: step.step,
        detail: step.step,
        tone:
          step.status === "completed" ? "muted" : step.status === "inProgress" ? "info" : "default",
      });
    });
    const hidden = activePlan.steps.length - INSPECTOR_PLAN_STEP_LIMIT;
    if (hidden > 0) {
      rows.push({ id: "more", icon: "empty", label: `and ${hidden} more`, tone: "muted" });
    }
  }
  if (proposedPlan) {
    const implemented = proposedPlan.implementedAt !== null;
    if (rows.length === 0) summary = implemented ? "Plan implemented" : "Plan ready";
    rows.push({
      id: "proposed",
      icon: "plan",
      label: "Proposed plan",
      value: implemented ? "Implemented" : "Ready",
      tone: implemented ? "muted" : "default",
      ...(proposedPlan.implementationThreadId
        ? {
            action: {
              label: "Open",
              action: { kind: "open-thread", threadId: proposedPlan.implementationThreadId },
            },
          }
        : {}),
    });
  }
  if (rows.length === 0) rows.push({ id: "none", icon: "empty", label: "No plan", tone: "muted" });
  return {
    id: "plan",
    title: "Plan",
    rows,
    summary,
    summaryTone: summary === "No plan" ? "muted" : "default",
    essential: false,
  };
}

function attentionSection(inputs: InspectorInputs): InspectorSectionModel {
  const rows: InspectorRow[] = [
    ...inputs.approvals.map((approval): InspectorRow => ({
      id: `approval:${approval.requestId}`,
      icon: "approval",
      label: REQUEST_KIND_LABELS[approval.requestKind] ?? "Approval",
      ...(approval.detail ? { value: approval.detail, detail: approval.detail } : {}),
      tone: "warning",
      action: RESPOND,
    })),
    ...inputs.userInputs.map((input): InspectorRow => {
      const question = input.questions[0]?.question;
      return {
        id: `input:${input.requestId}`,
        icon: "question",
        label: input.questions.length > 1 ? plural(input.questions.length, "question") : "Question",
        ...(question ? { value: question, detail: question } : {}),
        tone: "input",
        action: RESPOND,
      };
    }),
  ];
  const count = rows.length;
  if (count === 0) {
    rows.push({ id: "none", icon: "empty", label: "Nothing waiting on you", tone: "muted" });
  }
  return {
    id: "attention",
    title: "Attention",
    rows,
    summary: count === 0 ? "Nothing waiting on you" : `${count} waiting on you`,
    summaryTone: count === 0 ? "muted" : inputs.approvals.length > 0 ? "warning" : "input",
    essential: true,
  };
}

function agentsSection(inputs: InspectorInputs): InspectorSectionModel {
  const { agents } = inputs;
  if (!agents.hasAgents) {
    return {
      id: "agents",
      title: "Agents",
      rows: [{ id: "none", icon: "empty", label: "No subagents", tone: "muted" }],
      summary: "No subagents",
      summaryTone: "muted",
      essential: false,
    };
  }
  const working = agents.runningCount + agents.waitingCount;
  const value = [
    working > 0 ? `${working} working` : null,
    agents.idleCount > 0 ? `${agents.idleCount} idle` : null,
    agents.settledCount > 0 ? `${agents.settledCount} finished` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return {
    id: "agents",
    title: "Agents",
    rows: [
      {
        id: "summary",
        icon: "agents",
        label: "Subagents",
        value,
        tone: working > 0 ? "info" : "default",
        action: { label: "Open", action: { kind: "open-agents" } },
      },
    ],
    summary: value,
    summaryTone: working > 0 ? "info" : "default",
    essential: false,
  };
}

function terminalsSection(inputs: InspectorInputs): InspectorSectionModel {
  const [first] = inputs.runningTerminalIds;
  const count = inputs.runningTerminalIds.length;
  const label = count === 0 ? "No running terminals" : `${count} running`;
  return {
    id: "terminals",
    title: "Terminals",
    rows: [
      first === undefined
        ? { id: "none", icon: "empty", label, tone: "muted" }
        : {
            id: "running",
            icon: "terminal",
            label,
            action: { label: "Open", action: { kind: "open-terminal", terminalId: first } },
          },
    ],
    summary: label,
    summaryTone: count === 0 ? "muted" : "default",
    essential: false,
  };
}

function contextSection(inputs: InspectorInputs): InspectorSectionModel {
  const snapshot = inputs.contextWindow;
  const percentage = snapshot?.usedPercentage ?? null;
  const maxTokens = snapshot?.maxTokens ?? null;
  if (!snapshot || (percentage === null && maxTokens === null)) {
    const label = "No context data from this provider";
    return {
      id: "context",
      title: "Context",
      rows: [{ id: "none", icon: "empty", label, tone: "muted" }],
      summary: label,
      summaryTone: "muted",
      essential: false,
    };
  }
  const tokens =
    maxTokens === null
      ? `${formatContextWindowTokens(snapshot.usedTokens)} tokens`
      : `${formatContextWindowTokens(snapshot.usedTokens)} / ${formatContextWindowTokens(maxTokens)} tokens`;
  const tone: InspectorTone =
    percentage === null
      ? "default"
      : percentage >= 90
        ? "danger"
        : percentage >= 75
          ? "warning"
          : "default";
  const label = percentage === null ? "Used" : `${Math.round(percentage)}% used`;
  return {
    id: "context",
    title: "Context",
    rows: [{ id: "usage", icon: "context", label, value: tokens, tone }],
    summary: percentage === null ? tokens : label,
    summaryTone: tone,
    essential: false,
  };
}

export function deriveInspectorModel(inputs: InspectorInputs): InspectorModel {
  const needsAttention = inputs.approvals.length + inputs.userInputs.length > 0;
  if (inputs.thread.isDraft) {
    return { sections: [statusSection(inputs), workspaceSection(inputs)], needsAttention: false };
  }
  const changes = changesSection(inputs);
  return {
    sections: [
      statusSection(inputs),
      workspaceSection(inputs),
      ...(changes ? [changes] : []),
      planSection(inputs),
      attentionSection(inputs),
      agentsSection(inputs),
      terminalsSection(inputs),
      contextSection(inputs),
    ],
    needsAttention,
  };
}
