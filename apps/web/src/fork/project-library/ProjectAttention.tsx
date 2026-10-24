import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryThreadSummary, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import {
  libraryAttentionTone,
  libraryProjectAttention,
  type LibraryWorkflowTone,
} from "@t3tools/client-runtime/fork";
import { ArrowRightIcon, BellDotIcon, FolderIcon, MessageSquareIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LIBRARY_ROW, LibrarySection } from "./LibraryControls";
import { ComputerLabel, PathLabel } from "./ProjectIdentity";

const MAX_ITEMS = 6;

const TILE_TONES: Record<LibraryWorkflowTone, string> = {
  neutral: "bg-muted text-muted-foreground dark:bg-accent",
  active: "bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16",
  success: "bg-success/12 text-success-foreground",
  warning: "bg-warning/14 text-warning-foreground",
  danger: "bg-destructive/10 text-destructive-foreground dark:bg-destructive/16",
};

/**
 * What in this project is asking for a person, from saved observations. Silent when nothing is:
 * the latest conversation already leads the overview, so a resume suggestion would only repeat it.
 */
export function ProjectAttention({
  threads,
  copies,
  hostLabel,
  onFiles,
}: {
  readonly threads: readonly LibraryThreadSummary[];
  readonly copies: readonly LibraryWorkingCopy[];
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly onFiles: () => void;
}) {
  const items = libraryProjectAttention(threads, copies).filter((item) => item.kind !== "resume");
  if (!items.length) return null;
  const hidden = items.length - MAX_ITEMS;
  return (
    <LibrarySection title="Needs attention" icon={BellDotIcon} count={items.length}>
      <ul className="flex flex-col gap-0.5">
        {items.slice(0, MAX_ITEMS).map((item) => {
          const Icon = item.kind === "files" ? FolderIcon : MessageSquareIcon;
          return (
            <li
              key={`${item.kind}:${item.id}`}
              className={cn(LIBRARY_ROW, "flex min-w-0 items-center gap-3 py-2")}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
                  TILE_TONES[libraryAttentionTone(item)],
                )}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                {item.kind === "files" ? (
                  <PathLabel path={item.title} className="-ms-1.5 max-w-full" />
                ) : (
                  <p className="truncate text-sm font-medium">
                    {item.title.trim() || "Untitled conversation"}
                  </p>
                )}
                <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  <span className="text-foreground/80">{item.detail}</span>
                  <span aria-hidden>·</span>
                  <ComputerLabel
                    environmentId={item.environmentId}
                    label={hostLabel(item.environmentId)}
                  />
                  <span aria-hidden>·</span>
                  {/* Saved observations say when they were seen, so they never pass for live. */}
                  <time dateTime={item.checkedAt} className="tabular-nums">
                    seen {formatRelativeTimeLabel(item.checkedAt)}
                  </time>
                </p>
              </div>
              {item.kind === "files" ? (
                <Button shape="pill" size="xs" variant="outline" onClick={onFiles}>
                  Review files
                </Button>
              ) : (
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  render={
                    <Link
                      to="/library/conversations/$conversationId"
                      params={{ conversationId: item.id }}
                    />
                  }
                >
                  Open
                  <ArrowRightIcon />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <p className="text-xs tabular-nums text-muted-foreground">
          {hidden} more {hidden === 1 ? "item" : "items"} after these are handled.
        </p>
      ) : null}
    </LibrarySection>
  );
}
