import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  HistoryIcon,
  ListChecksIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useMemo } from "react";

import { formatContextWindowCompactionMessage } from "~/components/chat/ContextWindowMeter.logic";
import { DiffStatLabel } from "~/components/chat/DiffStatLabel";
import { PierreEntryIcon } from "~/components/chat/PierreEntryIcon";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Skeleton } from "~/components/ui/skeleton";
import { useTheme } from "~/hooks/useTheme";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import type { ForkPanelProps } from "../panels/types";
import { useInspectorActions } from "./actions";
import { InspectorHero } from "./InspectorHero";
import {
  deriveInspectorModel,
  plural,
  type InspectorAction,
  type InspectorAgentStatus,
  type InspectorAgents,
  type InspectorChanges,
  type InspectorContext,
  type InspectorModel,
  type InspectorPlan,
  type InspectorTerminal,
  type InspectorTone,
} from "./model";
import {
  InspectorAttentionRow,
  InspectorCopyButton,
  InspectorElapsed,
  InspectorField,
  InspectorNote,
  InspectorProgressBar,
  InspectorRow,
  InspectorSection,
  InspectorStatusDot,
  InspectorText,
  inspectorToneText,
  PullRequestStateIcon,
} from "./parts";
import { FORK_INSPECTOR_SECTIONS } from "./sections";
import { useInspectorInputs } from "./useInspectorInputs";

/** The diff panel lists everything; the inspector shows the biggest changes. */
const PANEL_FILE_ROW_LIMIT = 8;

const AGENT_TONE: Record<InspectorAgentStatus, InspectorTone> = {
  working: "info",
  idle: "muted",
  completed: "success",
  failed: "danger",
  stopped: "muted",
};

/**
 * The workbench: the hero, then every area as a section with its tools (copy, open the
 * diff, the agents panel, a terminal, the implementing thread). ChatView mounts it only
 * while it is the active tab of a present right panel, so a hidden tab derives nothing.
 * It keeps rendering through the close animation, like upstream's panels.
 */
export function ThreadInspectorPanel({ threadRef }: ForkPanelProps) {
  const inputs = useInspectorInputs(threadRef);
  const model = useMemo(() => deriveInspectorModel(inputs), [inputs]);
  const runAction = useInspectorActions(threadRef);
  const { resolvedTheme } = useTheme();
  const modelName = model.facts.find((fact) => fact.id === "model")?.label ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 px-3 pt-3 pb-2.5">
        <InspectorHero model={model} size="panel" onAction={runAction} />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          {model.attention.length > 0 ? (
            <InspectorSection
              title="Needs you"
              summary={model.attention.length > 1 ? String(model.attention.length) : undefined}
            >
              <div className="flex flex-col gap-1 px-0.5">
                {model.attention.map((item) => (
                  <InspectorAttentionRow key={item.id} item={item} />
                ))}
              </div>
            </InspectorSection>
          ) : null}
          <WorkspaceSection model={model} onAction={runAction} />
          {model.changes ? (
            <ChangesSection changes={model.changes} theme={resolvedTheme} onAction={runAction} />
          ) : null}
          {model.plan.steps.length > 0 || model.plan.proposed ? (
            <PlanSection plan={model.plan} onAction={runAction} />
          ) : null}
          {model.agents.hasAgents ? (
            <AgentsSection agents={model.agents} onAction={runAction} />
          ) : null}
          {model.terminals.length > 0 ? (
            <TerminalsSection terminals={model.terminals} onAction={runAction} />
          ) : null}
          {model.context ? <ContextSection context={model.context} modelName={modelName} /> : null}
          {FORK_INSPECTOR_SECTIONS.map(({ id, Component }) => (
            <Component key={id} threadRef={threadRef} surface="panel" />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function WorkspaceSection({
  model,
  onAction,
}: {
  model: InspectorModel;
  onAction: (action: InspectorAction) => void;
}) {
  const pullRequest = model.pullRequest;
  const pullRequestAction = pullRequest?.action ?? null;
  return (
    <InspectorSection title="Workspace">
      {model.workspace.map((entry) => (
        <InspectorField
          key={entry.id}
          name={entry.name}
          trailing={
            entry.copy ? (
              <InspectorCopyButton value={entry.copy} label={`Copy ${entry.name.toLowerCase()}`} />
            ) : null
          }
        >
          <InspectorText
            value={entry.value}
            mono={entry.mono ?? false}
            middle={entry.mono ?? false}
            tone={entry.tone}
          />
        </InspectorField>
      ))}
      {pullRequest ? (
        <InspectorField
          name="PR"
          trailing={
            pullRequestAction ? (
              <Button size="micro" variant="ghost" onClick={() => onAction(pullRequestAction)}>
                Open
              </Button>
            ) : null
          }
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="flex size-3.5 shrink-0 items-center justify-center *:size-3.5">
              <PullRequestStateIcon glyph={pullRequest.glyph} tone={pullRequest.tone} />
            </span>
            <span className="shrink-0 font-mono text-2xs">#{pullRequest.number}</span>
            <span className={cn("shrink-0 text-2xs", inspectorToneText(pullRequest.tone))}>
              {pullRequest.state}
            </span>
            {pullRequest.title ? (
              <span className="min-w-0 truncate text-muted-foreground">{pullRequest.title}</span>
            ) : null}
          </span>
        </InspectorField>
      ) : null}
    </InspectorSection>
  );
}

function ChangesSection({
  changes,
  theme,
  onAction,
}: {
  changes: InspectorChanges;
  theme: "light" | "dark";
  onAction: (action: InspectorAction) => void;
}) {
  const ready = changes.state === "ready";
  const files = changes.files;
  const hasFiles = ready && files.length > 0;
  const hidden = files.length - PANEL_FILE_ROW_LIMIT;
  const lastTurn = changes.lastTurn;
  const openDiff = () => onAction({ kind: "open-diff" });
  return (
    <InspectorSection
      title="Changes"
      summary={
        hasFiles ? (
          <span className="flex items-center gap-2">
            {plural(files.length, "file")}
            <DiffStatLabel
              additions={changes.additions}
              deletions={changes.deletions}
              layout="inline"
            />
          </span>
        ) : undefined
      }
      action={hasFiles ? { label: "Open diff", onClick: openDiff } : undefined}
    >
      {!ready ? (
        <div className="flex flex-col gap-2 px-1.5 py-1.5">
          <Skeleton className="h-2.5 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
          <Skeleton className="h-2.5 w-2/3" />
        </div>
      ) : files.length === 0 ? (
        <InspectorNote>No uncommitted changes</InspectorNote>
      ) : (
        <>
          {files.slice(0, PANEL_FILE_ROW_LIMIT).map((file) => (
            <InspectorRow
              key={file.path}
              icon={
                <PierreEntryIcon
                  pathValue={file.path}
                  kind="file"
                  theme={theme}
                  className="size-3.5"
                />
              }
              label={file.path}
              mono
              middle
              trailing={
                <DiffStatLabel
                  additions={file.additions}
                  deletions={file.deletions}
                  layout="inline"
                  className="shrink-0 text-2xs"
                />
              }
              onClick={openDiff}
              tooltip={file.path}
              tooltipVariant="code"
            />
          ))}
          {hidden > 0 ? <InspectorNote>{hidden} more in the diff panel</InspectorNote> : null}
        </>
      )}
      {lastTurn ? (
        <div className={cn(hasFiles && "mt-1 border-t border-border/40 pt-1")}>
          <InspectorRow
            icon={<HistoryIcon />}
            label="Last turn"
            value={plural(lastTurn.fileCount, "file")}
            trailing={
              <>
                <DiffStatLabel
                  additions={lastTurn.additions}
                  deletions={lastTurn.deletions}
                  layout="inline"
                  className="shrink-0 text-2xs"
                />
                <Button
                  size="micro"
                  variant="ghost"
                  onClick={() => onAction({ kind: "open-turn-diff", turnId: lastTurn.turnId })}
                >
                  Show
                </Button>
              </>
            }
          />
        </div>
      ) : null}
    </InspectorSection>
  );
}

function PlanSection({
  plan,
  onAction,
}: {
  plan: InspectorPlan;
  onAction: (action: InspectorAction) => void;
}) {
  const total = plan.steps.length;
  const proposed = plan.proposed;
  const proposedThreadId = proposed?.threadId ?? null;
  return (
    <InspectorSection
      title="Plan"
      summary={total > 0 ? `${plan.completed} of ${total}` : undefined}
    >
      {total > 0 ? (
        <div className="px-1.5 pt-0.5 pb-1">
          <InspectorProgressBar
            value={(plan.completed / total) * 100}
            tone="info"
            label="Plan progress"
          />
        </div>
      ) : null}
      {stepKeys(plan.steps).map(([key, step]) => {
        const Icon =
          step.status === "completed"
            ? CircleCheckIcon
            : step.status === "inProgress"
              ? CircleDotIcon
              : CircleIcon;
        return (
          <InspectorRow
            key={key}
            icon={
              <Icon
                className={cn(
                  step.status === "inProgress" && "text-info-foreground",
                  step.status === "completed" && "text-success-foreground",
                )}
              />
            }
            label={step.step}
            wrap
            tone={step.status === "completed" ? "muted" : "default"}
          />
        );
      })}
      {proposed ? (
        <InspectorRow
          icon={<ListChecksIcon />}
          label={proposed.implemented ? "Implemented" : "Plan ready"}
          tone={proposed.implemented ? "muted" : "accent"}
          value={
            proposed.implemented
              ? proposedThreadId
                ? "in another thread"
                : undefined
              : "Review it in the chat"
          }
          trailing={
            proposedThreadId ? (
              <Button
                size="micro"
                variant="ghost"
                onClick={() => onAction({ kind: "open-thread", threadId: proposedThreadId })}
              >
                Open thread
              </Button>
            ) : null
          }
        />
      ) : null}
    </InspectorSection>
  );
}

/** Steps keyed by their text; a repeated step gets its occurrence appended. */
function stepKeys(
  steps: InspectorPlan["steps"],
): ReadonlyArray<readonly [string, InspectorPlan["steps"][number]]> {
  const seen = new Map<string, number>();
  return steps.map((step) => {
    const count = (seen.get(step.step) ?? 0) + 1;
    seen.set(step.step, count);
    return [count === 1 ? step.step : `${step.step}#${count}`, step] as const;
  });
}

function AgentsSection({
  agents,
  onAction,
}: {
  agents: InspectorAgents;
  onAction: (action: InspectorAction) => void;
}) {
  const hidden = agents.total - agents.rows.length;
  return (
    <InspectorSection
      title="Agents"
      summary={agents.summary}
      action={{ label: "Agents panel", onClick: () => onAction({ kind: "open-agents" }) }}
    >
      {agents.rows.map((agent) => (
        <InspectorRow
          key={agent.id}
          icon={
            <span className="flex items-center justify-center">
              <InspectorStatusDot tone={AGENT_TONE[agent.status]} />
            </span>
          }
          label={agent.title}
          value={agent.activity ?? undefined}
          trailing={agent.since ? <InspectorElapsed since={agent.since} /> : null}
        />
      ))}
      {hidden > 0 ? <InspectorNote>{hidden} more in the agents panel</InspectorNote> : null}
    </InspectorSection>
  );
}

function TerminalsSection({
  terminals,
  onAction,
}: {
  terminals: ReadonlyArray<InspectorTerminal>;
  onAction: (action: InspectorAction) => void;
}) {
  return (
    <InspectorSection title="Terminals" summary={`${terminals.length} running`}>
      {terminals.map((terminal) => (
        <InspectorRow
          key={terminal.id}
          icon={<SquareTerminalIcon />}
          label={terminal.label}
          trailing={
            <Button
              size="micro"
              variant="ghost"
              onClick={() => onAction({ kind: "open-terminal", terminalId: terminal.id })}
            >
              Open
            </Button>
          }
        />
      ))}
    </InspectorSection>
  );
}

function ContextSection({
  context,
  modelName,
}: {
  context: InspectorContext;
  modelName: string | null;
}) {
  const percentage = context.percentage;
  const processed = context.totalProcessedTokens;
  return (
    <InspectorSection
      title="Context"
      summary={percentage !== null ? `${Math.round(percentage)}%` : undefined}
    >
      <div className="flex flex-col gap-1.5 px-1.5 py-1">
        {percentage !== null ? (
          <InspectorProgressBar
            value={percentage}
            tone={context.tone}
            label="Context window usage"
          />
        ) : null}
        <div className="flex items-center justify-between gap-3 text-2xs tabular-nums text-muted-foreground">
          <span className={cn(context.tone !== "default" && inspectorToneText(context.tone))}>
            {formatContextWindowTokens(context.usedTokens)}
            {context.maxTokens !== null
              ? ` of ${formatContextWindowTokens(context.maxTokens)}`
              : ""}{" "}
            tokens
          </span>
          {processed !== null && processed > 0 ? (
            <span>{formatContextWindowTokens(processed)} processed</span>
          ) : null}
        </div>
        {context.compactsAutomatically ? (
          <p className="text-2xs text-muted-foreground">
            {formatContextWindowCompactionMessage(modelName, context.autoCompactThreshold)}
          </p>
        ) : null}
      </div>
    </InspectorSection>
  );
}
