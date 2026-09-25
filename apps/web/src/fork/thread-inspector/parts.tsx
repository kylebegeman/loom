/**
 * Inspector section and row primitives, shared by the built-in sections and by packets that
 * register in FORK_INSPECTOR_SECTIONS so every section reads the same.
 *
 * Rows are one line: icon, primary label (toned), muted value, then a trailing elapsed time,
 * diff stat or action. Static dots only; the elapsed time is a 1 Hz DOM write that stops while
 * the document is hidden.
 */
import {
  ArrowUpDownIcon,
  BotIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  CpuIcon,
  FileDiffIcon,
  FileIcon,
  FolderIcon,
  FolderTreeIcon,
  GaugeIcon,
  GitBranchIcon,
  HistoryIcon,
  ListChecksIcon,
  MessageCircleQuestionIcon,
  ShieldAlertIcon,
  SlidersHorizontalIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useRef } from "react";

import { DiffStatLabel } from "~/components/chat/DiffStatLabel";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { formatWorkingDurationLabel } from "~/components/Sidebar.logic";
import { Button } from "~/components/ui/button";
import { MiddleTruncate } from "~/components/ui/middle-truncate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { InspectorAction, InspectorIconName, InspectorRow, InspectorTone } from "./model";

const ICONS: Record<
  Exclude<InspectorIconName, "status" | "empty">,
  ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  provider: CpuIcon,
  mode: SlidersHorizontalIcon,
  project: FolderIcon,
  branch: GitBranchIcon,
  sync: ArrowUpDownIcon,
  worktree: FolderTreeIcon,
  "pull-request": PullRequestGlyph.pullRequest,
  git: GitBranchIcon,
  changes: FileDiffIcon,
  file: FileIcon,
  turn: HistoryIcon,
  "step-pending": CircleIcon,
  "step-active": CircleDotIcon,
  "step-done": CircleCheckIcon,
  plan: ListChecksIcon,
  approval: ShieldAlertIcon,
  question: MessageCircleQuestionIcon,
  agents: BotIcon,
  terminal: SquareTerminalIcon,
  context: GaugeIcon,
};

/** Labels that keep both ends visible when cut: paths and branch names. */
const MIDDLE_TRUNCATED_ICONS = new Set<InspectorIconName>(["branch", "worktree", "file"]);

/** Theme tokens only, so app themes recolor the inspector with everything else. */
const TONE_TEXT: Record<InspectorTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  info: "text-info-foreground",
  warning: "text-warning-foreground",
  input: "text-primary",
  danger: "text-destructive-foreground",
  success: "text-success-foreground",
};

const TONE_DOT: Record<InspectorTone, string> = {
  default: "bg-muted-foreground/60",
  muted: "bg-muted-foreground/40",
  info: "bg-info",
  warning: "bg-warning",
  input: "bg-primary",
  danger: "bg-destructive",
  success: "bg-success",
};

export const inspectorToneText = (tone: InspectorTone = "default") => TONE_TEXT[tone];

export function InspectorStatusDot({ tone = "default" }: { tone?: InspectorTone | undefined }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />;
}

/** Elapsed time since `since`, written straight to the DOM once a second while visible. */
export function InspectorElapsed({ since }: { since: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const start = Date.parse(since);
    if (Number.isNaN(start)) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const write = () => {
      if (textRef.current)
        textRef.current.textContent = formatWorkingDurationLabel(Date.now() - start);
    };
    const sync = () => {
      if (document.visibilityState === "visible") {
        write();
        timer ??= setInterval(write, 1000);
      } else if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      if (timer !== null) clearInterval(timer);
    };
  }, [since]);
  return (
    <span
      ref={textRef}
      className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground"
    />
  );
}

function RowIcon({ row }: { row: InspectorRow }) {
  if (row.icon === "status") {
    return (
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        <InspectorStatusDot tone={row.tone} />
      </span>
    );
  }
  if (row.icon === "empty") return <span aria-hidden className="size-3.5 shrink-0" />;
  const Icon = ICONS[row.icon];
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-3.5 shrink-0",
        row.icon === "step-active" ? TONE_TEXT.info : "text-muted-foreground",
      )}
    />
  );
}

export function InspectorRowView({
  row,
  onAction,
}: {
  row: InspectorRow;
  onAction: (action: InspectorAction) => void;
}) {
  const toneClass = TONE_TEXT[row.tone ?? "default"];
  const text = (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      {row.name ? <span className="sr-only">{row.name}: </span> : null}
      {MIDDLE_TRUNCATED_ICONS.has(row.icon) ? (
        <span className={cn("flex min-w-0 shrink-[0.25]", toneClass)}>
          <MiddleTruncate value={row.label} showTitle={false} />
        </span>
      ) : (
        <span className={cn("min-w-0 shrink-[0.25] truncate", toneClass)}>{row.label}</span>
      )}
      {row.value ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.value}</span>
      ) : null}
    </span>
  );
  return (
    <div className="flex min-h-6 items-center gap-2 rounded-md px-1.5 py-0.5 text-xs">
      <RowIcon row={row} />
      {row.detail || row.name ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex min-w-0 flex-1" />}>{text}</TooltipTrigger>
          <TooltipPopup
            side="top"
            variant={MIDDLE_TRUNCATED_ICONS.has(row.icon) ? "code" : "default"}
          >
            {row.detail ?? row.name}
          </TooltipPopup>
        </Tooltip>
      ) : (
        text
      )}
      {row.since ? <InspectorElapsed since={row.since} /> : null}
      {row.diff ? (
        <DiffStatLabel
          additions={row.diff.additions}
          deletions={row.diff.deletions}
          layout="inline"
          className="shrink-0 text-2xs"
        />
      ) : null}
      {row.action ? (
        <Button
          size="micro"
          variant="ghost"
          className="shrink-0"
          onClick={() => row.action && onAction(row.action.action)}
        >
          {row.action.label}
        </Button>
      ) : null}
    </div>
  );
}

export function InspectorSectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-1.5 pb-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

/** A titled group of rows. Packet sections use it so they match the built-in ones. */
export function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <InspectorSectionTitle>{title}</InspectorSectionTitle>
      {children}
    </section>
  );
}

/** A section folded to one line in the compact density; a click shows its rows. */
export function InspectorCollapsedSection({
  title,
  summary,
  tone,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  tone: InspectorTone;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-6 w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-xs hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-90")}
        />
        <span className="shrink-0 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <span className={cn("ml-auto min-w-0 truncate", TONE_TEXT[tone])}>{summary}</span>
      </button>
      {open ? children : null}
    </section>
  );
}
