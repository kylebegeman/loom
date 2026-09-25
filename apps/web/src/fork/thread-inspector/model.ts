/**
 * The inspector's read model: one pure derivation over state the web app already holds,
 * rendered two ways. The card shows a glance (status, what needs you, where, one line per
 * area); the panel shows everything with tools. Both read this model, so a value can never
 * differ between them.
 */
import type { PendingApproval, PendingUserInput } from "@t3tools/client-runtime/pending-requests";
import type {
  AgentPanelModel,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  OrchestrationCheckpointSummary,
  OrchestrationLatestTurn,
  OrchestrationSession,
  ProviderDriverKind,
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
import type { ContextWindowSnapshot } from "~/lib/contextWindow";
import type { ActivePlanState, LatestProposedPlanState } from "~/session-logic";

export type InspectorGitState =
  /** No workspace to ask about (no project yet). */
  | { readonly state: "none" }
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly message: string }
  | { readonly state: "ready"; readonly status: VcsStatusResult };

export interface InspectorProvider {
  readonly displayName: string;
  readonly model: string;
  readonly driverKind: ProviderDriverKind | null;
}

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
  readonly provider: InspectorProvider | null;
  readonly supportsPullRequests: boolean;
  readonly git: InspectorGitState;
  readonly lastCheckpoint: OrchestrationCheckpointSummary | null;
  readonly activePlan: ActivePlanState | null;
  readonly proposedPlan: LatestProposedPlanState | null;
  readonly approvals: ReadonlyArray<PendingApproval>;
  readonly userInputs: ReadonlyArray<PendingUserInput>;
  readonly agents: AgentPanelModel;
  readonly runningTerminals: ReadonlyArray<InspectorTerminal>;
  readonly contextWindow: ContextWindowSnapshot | null;
}

export type InspectorAction =
  | { readonly kind: "open-diff" }
  | { readonly kind: "open-turn-diff"; readonly turnId: TurnId }
  | { readonly kind: "open-agents" }
  | { readonly kind: "open-pull-request"; readonly pullRequest: ThreadLinkedPullRequest }
  | { readonly kind: "open-terminal"; readonly terminalId: string }
  | { readonly kind: "focus-composer" }
  | { readonly kind: "open-thread"; readonly threadId: ThreadId };

/**
 * Tones map to theme tokens: info is work in progress, warning an approval or a filling
 * context window, accent a decision waiting on the user (a question, a ready plan).
 */
export type InspectorTone =
  | "default"
  | "muted"
  | "info"
  | "warning"
  | "accent"
  | "danger"
  | "success";

export interface InspectorStatus {
  readonly label: string;
  readonly tone: InspectorTone;
  /** The current plan step, the error message, or the draft hint. */
  readonly detail: string | null;
  /** ISO start of the running turn; the view shows the elapsed time. */
  readonly since: string | null;
  /** Plan steps done so far while working. */
  readonly progress: { readonly completed: number; readonly total: number } | null;
  /** Something waits on the user; both surfaces offer Respond. */
  readonly respond: boolean;
}

/** A hero chip: the model (with its provider glyph), the runtime mode, plan mode. */
export interface InspectorFact {
  readonly id: "model" | "runtime" | "interaction";
  readonly label: string;
  /** Spoken and shown on hover when the label alone does not say it. */
  readonly title: string;
  readonly driverKind?: ProviderDriverKind;
}

export interface InspectorAttentionItem {
  readonly id: string;
  readonly kind: "approval" | "question";
  readonly label: string;
  readonly detail: string | null;
  /** Commands and paths read as code; questions and app prompts as prose. */
  readonly mono: boolean;
}

export interface InspectorWorkspaceEntry {
  readonly id: "project" | "git" | "branch" | "remote" | "worktree";
  readonly name: string;
  readonly value: string;
  /** A shorter form for the card (a worktree's folder name). */
  readonly short?: string;
  readonly tone?: InspectorTone;
  readonly mono?: boolean;
  /** Text the panel offers to copy. */
  readonly copy?: string;
}

export type InspectorPullRequestGlyph = keyof typeof PULL_REQUEST_STATE_PRESENTATION;

export interface InspectorPullRequest {
  readonly number: number;
  readonly state: string;
  readonly tone: InspectorTone;
  readonly glyph: InspectorPullRequestGlyph;
  readonly title: string | null;
  readonly action: InspectorAction | null;
}

export interface InspectorChangedFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface InspectorChanges {
  readonly state: "loading" | "ready";
  /** Every uncommitted file, largest change first. */
  readonly files: ReadonlyArray<InspectorChangedFile>;
  readonly additions: number;
  readonly deletions: number;
  readonly lastTurn: {
    readonly turnId: TurnId;
    readonly fileCount: number;
    readonly additions: number;
    readonly deletions: number;
  } | null;
}

export interface InspectorPlanStep {
  readonly step: string;
  readonly status: "pending" | "inProgress" | "completed";
}

export interface InspectorPlan {
  readonly steps: ReadonlyArray<InspectorPlanStep>;
  readonly completed: number;
  /** The step in progress. */
  readonly current: string | null;
  readonly proposed: { readonly implemented: boolean; readonly threadId: ThreadId | null } | null;
}

export type InspectorAgentStatus = "working" | "idle" | "completed" | "failed" | "stopped";

export interface InspectorAgent {
  readonly id: string;
  readonly title: string;
  readonly status: InspectorAgentStatus;
  readonly activity: string | null;
  /** ISO start of the current activation while working. */
  readonly since: string | null;
}

export interface InspectorAgents {
  readonly hasAgents: boolean;
  /** Every listed agent, so the views can say how many rows they left out. */
  readonly total: number;
  readonly working: number;
  readonly idle: number;
  readonly finished: number;
  /** "2 working · 1 finished", or null without agents. */
  readonly summary: string | null;
  /** Working agents first, at most INSPECTOR_AGENT_ROW_LIMIT. */
  readonly rows: ReadonlyArray<InspectorAgent>;
}

export interface InspectorTerminal {
  readonly id: string;
  readonly label: string;
}

export interface InspectorContext {
  readonly usedTokens: number;
  readonly maxTokens: number | null;
  readonly percentage: number | null;
  readonly tone: InspectorTone;
  readonly totalProcessedTokens: number | null;
  readonly compactsAutomatically: boolean;
  readonly autoCompactThreshold: number | null;
}

export interface InspectorModel {
  readonly isDraft: boolean;
  readonly status: InspectorStatus;
  readonly facts: ReadonlyArray<InspectorFact>;
  readonly attention: ReadonlyArray<InspectorAttentionItem>;
  readonly workspace: ReadonlyArray<InspectorWorkspaceEntry>;
  readonly pullRequest: InspectorPullRequest | null;
  /** Null outside a git repository. */
  readonly changes: InspectorChanges | null;
  readonly plan: InspectorPlan;
  readonly agents: InspectorAgents;
  readonly terminals: ReadonlyArray<InspectorTerminal>;
  readonly context: InspectorContext | null;
  /** Drives the header button dot. */
  readonly needsAttention: boolean;
}

export const INSPECTOR_AGENT_ROW_LIMIT = 5;
export const CONTEXT_WARNING_PERCENTAGE = 75;
export const CONTEXT_DANGER_PERCENTAGE = 90;

const APPROVAL_LABELS: Record<ProviderRequestKind, string> = {
  command: "Command approval",
  "file-read": "File read approval",
  "file-change": "File change approval",
  "mcp-elicitation": "App access approval",
  permission: "App permission approval",
};

const PULL_REQUEST_TONES: Record<keyof typeof PULL_REQUEST_STATE_PRESENTATION, InspectorTone> = {
  open: "success",
  draft: "muted",
  closed: "danger",
  merged: "accent",
};

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function deriveStatus(inputs: InspectorInputs): InspectorStatus {
  const { thread } = inputs;
  const base = { detail: null, since: null, progress: null, respond: false };
  if (thread.isDraft) {
    return {
      ...base,
      label: "Draft",
      tone: "muted",
      detail: "Send a message to start this thread.",
    };
  }
  if (inputs.approvals.length > 0) {
    const [first] = inputs.approvals;
    return {
      ...base,
      label: "Needs approval",
      tone: "warning",
      detail: first ? APPROVAL_LABELS[first.requestKind] : null,
      respond: true,
    };
  }
  if (inputs.userInputs.length > 0) {
    const question = inputs.userInputs[0]?.questions[0]?.question ?? null;
    return { ...base, label: "Needs input", tone: "accent", detail: question, respond: true };
  }
  const session = thread.session;
  if (session?.status === "error" || thread.latestTurn?.state === "error") {
    return { ...base, label: "Error", tone: "danger", detail: session?.lastError ?? null };
  }
  if (session?.status === "running" || session?.status === "starting") {
    const progress = thread.planProgress;
    return {
      ...base,
      label: session.status === "starting" ? "Connecting" : "Working",
      tone: "info",
      detail: progress?.step ?? null,
      since: resolveWorkingStartedAt({ latestTurn: thread.latestTurn, session }),
      progress: progress
        ? { completed: progress.completedSteps, total: progress.totalSteps }
        : null,
    };
  }
  if (
    thread.interactionMode === "plan" &&
    inputs.proposedPlan !== null &&
    inputs.proposedPlan.implementedAt === null
  ) {
    return { ...base, label: "Plan ready", tone: "accent", detail: "Review it in the chat." };
  }
  if (thread.backgroundLiveness === "working") {
    return { ...base, label: "Working", tone: "info", detail: "Background agents" };
  }
  if (thread.backgroundLiveness === "monitoring") {
    return { ...base, label: "Monitoring", tone: "info" };
  }
  if (session?.status === "interrupted" || thread.latestTurn?.state === "interrupted") {
    return { ...base, label: "Interrupted", tone: "muted" };
  }
  return { ...base, label: "Ready", tone: "success" };
}

function deriveFacts(inputs: InspectorInputs): ReadonlyArray<InspectorFact> {
  if (inputs.thread.isDraft) return [];
  const facts: InspectorFact[] = [];
  const provider = inputs.provider;
  if (provider) {
    facts.push({
      id: "model",
      label: provider.model,
      title: `${provider.displayName} · ${provider.model}`,
      ...(provider.driverKind ? { driverKind: provider.driverKind } : {}),
    });
  }
  const runtime = runtimeModeConfig[inputs.thread.runtimeMode];
  facts.push({
    id: "runtime",
    label: runtime?.label ?? inputs.thread.runtimeMode,
    title: runtime ? `${runtime.label}: ${runtime.description}` : inputs.thread.runtimeMode,
  });
  if (inputs.thread.interactionMode === "plan") {
    facts.push({ id: "interaction", label: "Plan mode", title: "Plan mode" });
  }
  return facts;
}

function deriveAttention(inputs: InspectorInputs): ReadonlyArray<InspectorAttentionItem> {
  return [
    ...inputs.approvals.map((approval): InspectorAttentionItem => ({
      id: `approval:${approval.requestId}`,
      kind: "approval",
      label: APPROVAL_LABELS[approval.requestKind] ?? "Approval",
      detail: approval.detail ?? approval.appName ?? null,
      mono: approval.requestKind !== "mcp-elicitation",
    })),
    ...inputs.userInputs.map((input): InspectorAttentionItem => {
      const count = input.questions.length;
      return {
        id: `input:${input.requestId}`,
        kind: "question",
        label: count > 1 ? plural(count, "question") : "Question",
        detail: input.questions[0]?.question ?? null,
        mono: false,
      };
    }),
  ];
}

function syncValue(status: VcsStatusResult): string {
  if (!status.hasUpstream) return "No upstream branch";
  const parts = [
    status.aheadCount > 0 ? `${status.aheadCount} ahead` : null,
    status.behindCount > 0 ? `${status.behindCount} behind` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? "Up to date" : parts.join(" · ");
}

const lastPathSegment = (path: string) =>
  path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").at(-1) || path;

function deriveWorkspace(inputs: InspectorInputs): ReadonlyArray<InspectorWorkspaceEntry> {
  const { thread, git } = inputs;
  const entries: InspectorWorkspaceEntry[] = [];
  if (inputs.projectName) {
    entries.push({ id: "project", name: "Project", value: inputs.projectName });
  }
  if (git.state === "loading") {
    entries.push({ id: "git", name: "Git", value: "Checking...", tone: "muted" });
  } else if (git.state === "error") {
    entries.push({ id: "git", name: "Git", value: "Git status unavailable", tone: "danger" });
  } else if (git.state === "ready" && !git.status.isRepo) {
    entries.push({ id: "git", name: "Git", value: "Not a git repository", tone: "muted" });
  }
  const isRepo = git.state !== "ready" || git.status.isRepo;
  const branch = git.state === "ready" ? (git.status.refName ?? thread.branch) : thread.branch;
  if (isRepo && branch) {
    entries.push({ id: "branch", name: "Branch", value: branch, mono: true, copy: branch });
  }
  if (git.state === "ready" && git.status.isRepo) {
    entries.push({ id: "remote", name: "Remote", value: syncValue(git.status) });
  }
  if (thread.worktreePath) {
    entries.push({
      id: "worktree",
      name: "Worktree",
      value: thread.worktreePath,
      short: lastPathSegment(thread.worktreePath),
      mono: true,
      copy: thread.worktreePath,
    });
  }
  return entries;
}

function derivePullRequest(inputs: InspectorInputs): InspectorPullRequest | null {
  const linked = inputs.supportsPullRequests ? inputs.thread.linkedPullRequest : null;
  const known = inputs.git.state === "ready" ? inputs.git.status.pr : null;
  if (linked) {
    const status = known?.number === linked.number ? known : null;
    return {
      number: linked.number,
      state: status ? pullRequestStateLabel(status) : "Linked",
      tone: status ? pullRequestTone(status) : "default",
      glyph: status ? pullRequestStateKey(status) : "open",
      title: status?.title ?? null,
      action: { kind: "open-pull-request", pullRequest: linked },
    };
  }
  if (known) {
    return {
      number: known.number,
      state: pullRequestStateLabel(known),
      tone: pullRequestTone(known),
      glyph: pullRequestStateKey(known),
      title: known.title,
      action: null,
    };
  }
  return null;
}

type KnownPullRequest = NonNullable<VcsStatusResult["pr"]>;

const pullRequestStateKey = (pr: KnownPullRequest): InspectorPullRequestGlyph =>
  pr.isDraft && pr.state === "open" ? "draft" : pr.state;
const pullRequestStateLabel = (pr: KnownPullRequest) =>
  PULL_REQUEST_STATE_PRESENTATION[pullRequestStateKey(pr)].label;
const pullRequestTone = (pr: KnownPullRequest) => PULL_REQUEST_TONES[pullRequestStateKey(pr)];

function deriveChanges(inputs: InspectorInputs): InspectorChanges | null {
  const { git, lastCheckpoint } = inputs;
  if (git.state === "none" || git.state === "error") return null;
  if (git.state === "ready" && !git.status.isRepo) return null;
  const lastTurn =
    lastCheckpoint?.status === "ready" && lastCheckpoint.files.length > 0
      ? {
          turnId: lastCheckpoint.turnId,
          fileCount: lastCheckpoint.files.length,
          ...lastCheckpoint.files.reduce(
            (total, file) => ({
              additions: total.additions + file.additions,
              deletions: total.deletions + file.deletions,
            }),
            { additions: 0, deletions: 0 },
          ),
        }
      : null;
  if (git.state === "loading") {
    return { state: "loading", files: [], additions: 0, deletions: 0, lastTurn };
  }
  const tree = git.status.workingTree;
  return {
    state: "ready",
    files: tree.files
      .toSorted(
        (left, right) =>
          right.insertions + right.deletions - (left.insertions + left.deletions) ||
          left.path.localeCompare(right.path),
      )
      .map((file) => ({ path: file.path, additions: file.insertions, deletions: file.deletions })),
    additions: tree.insertions,
    deletions: tree.deletions,
    lastTurn,
  };
}

function derivePlan(inputs: InspectorInputs): InspectorPlan {
  const steps = inputs.activePlan?.steps ?? [];
  const proposed = inputs.proposedPlan;
  return {
    steps: steps.map((step) => ({ step: step.step, status: step.status })),
    completed: steps.filter((step) => step.status === "completed").length,
    current: steps.find((step) => step.status === "inProgress")?.step ?? null,
    proposed: proposed
      ? { implemented: proposed.implementedAt !== null, threadId: proposed.implementationThreadId }
      : null,
  };
}

const AGENT_STATUS: Record<RuntimeSubagent["status"], InspectorAgentStatus> = {
  pending: "working",
  running: "working",
  waiting: "working",
  idle: "idle",
  completed: "completed",
  failed: "failed",
  cancelled: "stopped",
  interrupted: "stopped",
};

/** Live rows lead with what is happening now; settled rows lead with the outcome. */
function agentActivity(agent: RuntimeSubagent): string | null {
  const tool = agent.lastToolName ? `▸ ${agent.lastToolName}` : null;
  return AGENT_STATUS[agent.status] === "working"
    ? (agent.progress ?? tool ?? agent.result ?? agent.error)
    : (agent.error ?? agent.result ?? agent.progress ?? tool);
}

function deriveAgents(inputs: InspectorInputs): InspectorAgents {
  const { agents } = inputs;
  if (!agents.hasAgents) {
    return NO_AGENTS;
  }
  const working = agents.runningCount + agents.waitingCount;
  const summary = [
    working > 0 ? `${working} working` : null,
    agents.idleCount > 0 ? `${agents.idleCount} idle` : null,
    agents.settledCount > 0 ? `${agents.settledCount} finished` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const members = [
    ...agents.directAgents,
    ...agents.workflows.flatMap((group) => {
      const listed = [...group.phases.flatMap((phase) => phase.members), ...group.unphasedMembers];
      return listed.length > 0 ? listed : [group.workflow];
    }),
  ];
  const rank = (agent: RuntimeSubagent) => (AGENT_STATUS[agent.status] === "working" ? 0 : 1);
  const rows = members
    .toSorted((left, right) => rank(left) - rank(right))
    .slice(0, INSPECTOR_AGENT_ROW_LIMIT)
    .map((agent): InspectorAgent => ({
      id: agent.id,
      title: agent.title,
      status: AGENT_STATUS[agent.status],
      activity: agentActivity(agent),
      since: AGENT_STATUS[agent.status] === "working" ? agent.startedAt : null,
    }));
  return {
    hasAgents: true,
    total: members.length,
    working,
    idle: agents.idleCount,
    finished: agents.settledCount,
    summary,
    rows,
  };
}

export function contextTone(percentage: number | null): InspectorTone {
  if (percentage === null) return "default";
  if (percentage >= CONTEXT_DANGER_PERCENTAGE) return "danger";
  if (percentage >= CONTEXT_WARNING_PERCENTAGE) return "warning";
  return "default";
}

function deriveContext(inputs: InspectorInputs): InspectorContext | null {
  const snapshot = inputs.contextWindow;
  if (!snapshot) return null;
  const maxTokens = snapshot.maxTokens ?? null;
  const percentage = snapshot.usedPercentage ?? null;
  if (maxTokens === null && percentage === null && snapshot.usedTokens === 0) return null;
  return {
    usedTokens: snapshot.usedTokens,
    maxTokens,
    percentage,
    tone: contextTone(percentage),
    totalProcessedTokens: snapshot.totalProcessedTokens ?? null,
    compactsAutomatically: snapshot.compactsAutomatically === true,
    autoCompactThreshold: snapshot.autoCompactThreshold ?? null,
  };
}

const EMPTY_PLAN: InspectorPlan = { steps: [], completed: 0, current: null, proposed: null };
const NO_AGENTS: InspectorAgents = {
  hasAgents: false,
  total: 0,
  working: 0,
  idle: 0,
  finished: 0,
  summary: null,
  rows: [],
};

export function deriveInspectorModel(inputs: InspectorInputs): InspectorModel {
  if (inputs.thread.isDraft) {
    return {
      isDraft: true,
      status: deriveStatus(inputs),
      facts: [],
      attention: [],
      workspace: deriveWorkspace(inputs),
      pullRequest: null,
      changes: null,
      plan: EMPTY_PLAN,
      agents: NO_AGENTS,
      terminals: [],
      context: null,
      needsAttention: false,
    };
  }
  return {
    isDraft: false,
    status: deriveStatus(inputs),
    facts: deriveFacts(inputs),
    attention: deriveAttention(inputs),
    workspace: deriveWorkspace(inputs),
    pullRequest: derivePullRequest(inputs),
    changes: deriveChanges(inputs),
    plan: derivePlan(inputs),
    agents: deriveAgents(inputs),
    terminals: inputs.runningTerminals,
    context: deriveContext(inputs),
    needsAttention: inputs.approvals.length + inputs.userInputs.length > 0,
  };
}
