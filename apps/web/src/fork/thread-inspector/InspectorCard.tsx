import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  BotIcon,
  FileDiffIcon,
  FolderTreeIcon,
  GaugeIcon,
  GitBranchIcon,
  HistoryIcon,
  ListChecksIcon,
  PanelTopIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useMemo } from "react";

import { DiffStatLabel } from "~/components/chat/DiffStatLabel";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Skeleton } from "~/components/ui/skeleton";
import { shortcutLabelForCommand } from "~/keybindings";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useInspectorActions } from "./actions";
import { InspectorHero } from "./InspectorHero";
import { deriveInspectorModel, plural, type InspectorAction, type InspectorModel } from "./model";
import {
  InspectorAttentionRow,
  InspectorNote,
  InspectorProgressBar,
  InspectorRow,
  inspectorToneText,
  PullRequestStateIcon,
} from "./parts";
import { FORK_INSPECTOR_SECTIONS } from "./sections";
import { useInspectorInputs } from "./useInspectorInputs";

const CARD_ATTENTION_LIMIT = 3;
const CARD_TERMINAL_LIMIT = 3;

/**
 * The glance: the hero, what needs you, then one line per area. A line that has somewhere
 * to go (the diff, the agents panel, a terminal) is a button; the card closes after it.
 * Mounted only while the popover is open, so a closed card subscribes to nothing.
 */
export function InspectorCard({
  threadRef,
  onActionDone,
  onOpenPanel,
}: {
  threadRef: ScopedThreadRef;
  onActionDone: (action: InspectorAction) => void;
  onOpenPanel: () => void;
}) {
  const inputs = useInspectorInputs(threadRef);
  const model = useMemo(() => deriveInspectorModel(inputs), [inputs]);
  const runAction = useInspectorActions(threadRef, onActionDone);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const panelShortcut = shortcutLabelForCommand(keybindings, "loom.thread-inspector.toggle");
  const hiddenAttention = model.attention.length - CARD_ATTENTION_LIMIT;
  return (
    <div className="flex flex-col">
      <div className="px-3 pt-3 pb-2">
        <InspectorHero model={model} size="card" onAction={runAction} />
      </div>
      {model.attention.length > 0 ? (
        <div className="flex flex-col gap-1 px-1.5 pb-1.5">
          {model.attention.slice(0, CARD_ATTENTION_LIMIT).map((item) => (
            <InspectorAttentionRow key={item.id} item={item} />
          ))}
          {hiddenAttention > 0 ? (
            <InspectorNote>{hiddenAttention} more in the chat</InspectorNote>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col px-1.5 pb-1.5">
        <GlanceRows model={model} onAction={runAction} />
        {FORK_INSPECTOR_SECTIONS.map(({ id, Component }) => (
          <Component key={id} threadRef={threadRef} surface="card" />
        ))}
      </div>
      <div className="border-t border-border/60 p-1">
        <Button size="xs" variant="ghost" className="w-full justify-between" onClick={onOpenPanel}>
          <span className="flex items-center gap-1.5">
            <PanelTopIcon aria-hidden />
            Open inspector panel
          </span>
          {panelShortcut ? <Kbd>{panelShortcut}</Kbd> : null}
        </Button>
      </div>
    </div>
  );
}

function GlanceRows({
  model,
  onAction,
}: {
  model: InspectorModel;
  onAction: (action: InspectorAction) => void;
}) {
  const remote = model.workspace.find((entry) => entry.id === "remote");
  const { pullRequest, changes, plan, agents, context } = model;
  const pullRequestAction = pullRequest?.action ?? null;
  const lastTurn = changes?.lastTurn ?? null;
  const proposedThreadId = plan.proposed?.threadId ?? null;
  return (
    <>
      {model.workspace.map((entry) =>
        entry.id === "project" || entry.id === "remote" ? null : (
          <InspectorRow
            key={entry.id}
            icon={entry.id === "worktree" ? <FolderTreeIcon /> : <GitBranchIcon />}
            label={entry.short ?? entry.value}
            mono={entry.mono ?? false}
            middle={entry.mono ?? false}
            tone={entry.tone}
            value={entry.id === "branch" ? remote?.value : undefined}
            tooltip={`${entry.name}: ${entry.value}`}
            tooltipVariant={entry.mono ? "code" : "default"}
          />
        ),
      )}
      {pullRequest ? (
        <InspectorRow
          icon={<PullRequestStateIcon glyph={pullRequest.glyph} tone={pullRequest.tone} />}
          label={`#${pullRequest.number}`}
          mono
          value={pullRequest.title ?? undefined}
          trailing={
            <span className={cn("shrink-0 text-2xs", inspectorToneText(pullRequest.tone))}>
              {pullRequest.state}
            </span>
          }
          onClick={pullRequestAction ? () => onAction(pullRequestAction) : undefined}
        />
      ) : null}
      {changes?.state === "loading" ? (
        <InspectorRow
          icon={<FileDiffIcon />}
          label="Changes"
          value={<Skeleton className="h-2.5 w-16" />}
        />
      ) : changes && changes.files.length > 0 ? (
        <InspectorRow
          icon={<FileDiffIcon />}
          label="Changes"
          value={plural(changes.files.length, "file")}
          trailing={
            <DiffStatLabel
              additions={changes.additions}
              deletions={changes.deletions}
              layout="inline"
              className="shrink-0 text-2xs"
            />
          }
          onClick={() => onAction({ kind: "open-diff" })}
        />
      ) : lastTurn ? (
        <InspectorRow
          icon={<HistoryIcon />}
          label="Last turn"
          value={plural(lastTurn.fileCount, "file")}
          trailing={
            <DiffStatLabel
              additions={lastTurn.additions}
              deletions={lastTurn.deletions}
              layout="inline"
              className="shrink-0 text-2xs"
            />
          }
          onClick={() => onAction({ kind: "open-turn-diff", turnId: lastTurn.turnId })}
        />
      ) : changes ? (
        <InspectorRow icon={<FileDiffIcon />} label="Changes" value="No uncommitted changes" />
      ) : null}
      {plan.steps.length > 0 ? (
        <InspectorRow
          icon={<ListChecksIcon />}
          label="Plan"
          value={[`${plan.completed} of ${plan.steps.length}`, plan.current]
            .filter((part) => part !== null)
            .join(" · ")}
        />
      ) : plan.proposed ? (
        <InspectorRow
          icon={<ListChecksIcon />}
          label="Plan"
          tone={plan.proposed.implemented ? "default" : "accent"}
          value={plan.proposed.implemented ? "Implemented" : "Ready to review"}
          onClick={
            proposedThreadId
              ? () => onAction({ kind: "open-thread", threadId: proposedThreadId })
              : undefined
          }
        />
      ) : null}
      {agents.hasAgents ? (
        <InspectorRow
          icon={<BotIcon />}
          label="Agents"
          value={agents.summary ?? undefined}
          onClick={() => onAction({ kind: "open-agents" })}
        />
      ) : null}
      {model.terminals.slice(0, CARD_TERMINAL_LIMIT).map((terminal) => (
        <InspectorRow
          key={terminal.id}
          icon={<SquareTerminalIcon />}
          label={terminal.label}
          value="running"
          onClick={() => onAction({ kind: "open-terminal", terminalId: terminal.id })}
        />
      ))}
      {context ? (
        <InspectorRow
          icon={<GaugeIcon />}
          label="Context"
          tone={context.tone === "default" ? "default" : context.tone}
          value={
            context.percentage !== null && context.maxTokens !== null
              ? `${Math.round(context.percentage)}% · ${formatContextWindowTokens(context.usedTokens)} of ${formatContextWindowTokens(context.maxTokens)}`
              : `${formatContextWindowTokens(context.usedTokens)} tokens`
          }
          trailing={
            context.percentage !== null ? (
              <InspectorProgressBar
                value={context.percentage}
                tone={context.tone}
                label="Context window usage"
                className="w-10"
              />
            ) : null
          }
        />
      ) : null}
    </>
  );
}
