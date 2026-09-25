/**
 * Inspector primitives shared by the card, the panel and the packet sections registered in
 * FORK_INSPECTOR_SECTIONS, so every section reads the same on both surfaces.
 *
 * Tones map to theme tokens only, so app themes recolor the inspector with everything else.
 * Static dots; the elapsed time is a 1 Hz DOM write that stops while the document is hidden;
 * a progress bar moves only when its value changes.
 */
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  MessageCircleQuestionIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { formatWorkingDurationLabel } from "~/components/Sidebar.logic";
import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
} from "~/components/ui/anchoredCopyToast";
import { Button } from "~/components/ui/button";
import { MiddleTruncate } from "~/components/ui/middle-truncate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import type { InspectorAttentionItem, InspectorPullRequest, InspectorTone } from "./model";

const TONE_TEXT: Record<InspectorTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  info: "text-info-foreground",
  warning: "text-warning-foreground",
  accent: "text-primary",
  danger: "text-destructive-foreground",
  success: "text-success-foreground",
};

const TONE_FILL: Record<InspectorTone, string> = {
  default: "bg-muted-foreground/60",
  muted: "bg-muted-foreground/40",
  info: "bg-info",
  warning: "bg-warning",
  accent: "bg-primary",
  danger: "bg-destructive",
  success: "bg-success",
};

export const inspectorToneText = (tone: InspectorTone = "default") => TONE_TEXT[tone];

export function InspectorStatusDot({
  tone = "default",
  size = "sm",
}: {
  tone?: InspectorTone | undefined;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 rounded-full",
        size === "md" ? "size-2" : "size-1.5",
        TONE_FILL[tone],
      )}
    />
  );
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

/** A thin bar; `value` is 0 to 100. Width is layout, so the parent may size it. */
export function InspectorProgressBar({
  value,
  tone = "default",
  label,
  className,
}: {
  value: number;
  tone?: InspectorTone;
  label: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn("h-1 w-full shrink-0 overflow-hidden rounded-full bg-muted/60", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
          TONE_FILL[tone],
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Inline text that truncates at the end, or in the middle for paths and branch names. */
export function InspectorText({
  value,
  mono = false,
  middle = false,
  wrap = false,
  tone = "default",
  showTitle = true,
  className,
}: {
  value: string;
  mono?: boolean;
  middle?: boolean;
  /** Up to two lines instead of one; plan steps and questions need the room. */
  wrap?: boolean;
  tone?: InspectorTone | undefined;
  /** The full value on hover for a middle-truncated path. Off where a tooltip carries it. */
  showTitle?: boolean;
  className?: string;
}) {
  const shared = cn("min-w-0", mono && "font-mono text-2xs", TONE_TEXT[tone], className);
  if (middle) {
    return (
      <span className={cn("flex", shared)}>
        <MiddleTruncate value={value} showTitle={showTitle} />
      </span>
    );
  }
  return <span className={cn(wrap ? "line-clamp-2" : "truncate", shared)}>{value}</span>;
}

/**
 * One line: an icon slot, a label, a muted value, then trailing content. With `onClick` the
 * row is a button that ends in a chevron; trailing content must then be static.
 */
export function InspectorRow({
  icon,
  label,
  value,
  tone,
  mono = false,
  middle = false,
  wrap = false,
  trailing,
  onClick,
  tooltip,
  tooltipVariant = "default",
}: {
  icon?: ReactNode;
  label: string;
  value?: ReactNode;
  tone?: InspectorTone | undefined;
  mono?: boolean;
  middle?: boolean;
  wrap?: boolean;
  trailing?: ReactNode;
  onClick?: (() => void) | undefined;
  /** Hover text when the label alone does not say it. */
  tooltip?: string | undefined;
  tooltipVariant?: "default" | "code";
}) {
  const text = (
    <span className={cn("flex min-w-0 flex-1 gap-1.5", wrap ? "items-start" : "items-baseline")}>
      <InspectorText
        value={label}
        mono={mono}
        middle={middle}
        wrap={wrap}
        tone={tone}
        showTitle={!tooltip}
        className="shrink-[0.25]"
      />
      {value ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{value}</span>
      ) : null}
    </span>
  );
  const content = (
    <>
      {icon ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground *:size-3.5">
          {icon}
        </span>
      ) : null}
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex min-w-0 flex-1" />}>{text}</TooltipTrigger>
          <TooltipPopup side="top" variant={tooltipVariant}>
            {tooltip}
          </TooltipPopup>
        </Tooltip>
      ) : (
        text
      )}
      {trailing}
      {onClick ? (
        <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" />
      ) : null}
    </>
  );
  const className = cn(
    "flex min-h-6 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs",
    wrap ? "py-1" : "py-0.5",
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          className,
          "hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

/** A name and value pair for the panel's Workspace block. Trailing holds a tool. */
export function InspectorField({
  name,
  children,
  trailing,
}: {
  name: string;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-6 items-center gap-2 px-1.5 text-xs">
      <span className="w-14 shrink-0 text-2xs text-muted-foreground">{name}</span>
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
      {trailing}
    </div>
  );
}

export function InspectorNote({ children }: { children: ReactNode }) {
  return <p className="px-1.5 py-0.5 text-2xs text-muted-foreground">{children}</p>;
}

/** A titled group. Packet sections use it so they match the built-in ones. */
export function InspectorSection({
  title,
  summary,
  action,
  children,
}: {
  title: string;
  /** Right-aligned digest, such as a count or a percentage. */
  summary?: ReactNode;
  /** One tool for the whole section, such as opening the panel that owns the data. */
  action?: { readonly label: string; readonly onClick: () => void } | undefined;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <div className="flex min-h-6 items-center gap-2 px-1.5">
        <h3 className="shrink-0 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <span className="flex-1" />
        {summary ? (
          <span className="min-w-0 truncate text-2xs tabular-nums text-muted-foreground/80">
            {summary}
          </span>
        ) : null}
        {action ? (
          <Button size="micro" variant="ghost" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function InspectorCopyButton({ value, label }: { value: string; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onCopy: () => showAnchoredCopySuccessToast(ref),
    onError: (error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            size="icon-micro"
            variant="ghost-muted"
            aria-label={label}
            onClick={() => copyToClipboard(value, undefined)}
          />
        }
      >
        {isCopied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
      </TooltipTrigger>
      <TooltipPopup>{isCopied ? "Copied" : label}</TooltipPopup>
    </Tooltip>
  );
}

/** An approval or a question waiting on the user, tinted by kind. */
export function InspectorAttentionRow({ item }: { item: InspectorAttentionItem }) {
  const approval = item.kind === "approval";
  const Icon = approval ? ShieldAlertIcon : MessageCircleQuestionIcon;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1.5 text-xs",
        approval ? "bg-warning/8 dark:bg-warning/16" : "bg-primary/8 dark:bg-primary/16",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-px size-3.5 shrink-0",
          approval ? "text-warning-foreground" : "text-primary",
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{item.label}</span>
        {item.detail ? (
          <span
            className={cn(
              "line-clamp-2 text-muted-foreground",
              item.mono && "font-mono text-2xs wrap-anywhere",
            )}
          >
            {item.detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}

const PULL_REQUEST_GLYPHS: Record<
  InspectorPullRequest["glyph"],
  typeof PullRequestGlyph.pullRequest
> = {
  open: PullRequestGlyph.pullRequest,
  draft: PullRequestGlyph.draft,
  closed: PullRequestGlyph.closed,
  merged: PullRequestGlyph.merged,
};

export function PullRequestStateIcon({
  glyph,
  tone,
}: Pick<InspectorPullRequest, "glyph" | "tone">) {
  const Icon = PULL_REQUEST_GLYPHS[glyph];
  return <Icon aria-hidden className={TONE_TEXT[tone]} />;
}
