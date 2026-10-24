import { useState } from "react";
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import type { BotFinding, BotRun, BotVerdict } from "@t3tools/contracts/fork";
import { BOT_VERDICT_STATES } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { LIBRARY_OUTLINE, LibraryStateDot } from "../project-library/LibraryControls";

const location = (finding: BotFinding) =>
  finding.path === undefined
    ? null
    : `${finding.path}${finding.line === undefined ? "" : `:${finding.line}`}`;

/** Findings carry no id and may repeat, so a key is their content plus which repeat it is. */
const keyedFindings = (findings: ReadonlyArray<BotFinding>) => {
  const seen = new Map<string, number>();
  return findings.map((finding) => {
    const content = `${finding.title}\u0000${location(finding) ?? ""}\u0000${finding.detail}`;
    const repeat = seen.get(content) ?? 0;
    seen.set(content, repeat + 1);
    return { finding, key: `${content}\u0000${repeat}` };
  });
};

function FindingLocation({ value }: { readonly value: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "location" });
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <code className="truncate font-mono text-2xs text-muted-foreground">{value}</code>
      <Button
        shape="pill"
        size="icon-xs"
        variant="ghost"
        aria-label={isCopied ? "Copied" : `Copy ${value}`}
        onClick={() => copyToClipboard(value)}
      >
        {isCopied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </span>
  );
}

// A detail can run to thousands of characters; past a few lines it folds so fifty findings scan.
const LONG_DETAIL_CHARS = 320;
const LONG_DETAIL_LINES = 4;

function FindingDetail({ detail }: { readonly detail: string }) {
  const [open, setOpen] = useState(false);
  const long = detail.length > LONG_DETAIL_CHARS || detail.split("\n").length > LONG_DETAIL_LINES;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <p
        className={cn(
          "whitespace-pre-wrap text-muted-foreground wrap-anywhere",
          long && !open && "line-clamp-4",
        )}
      >
        {detail}
      </p>
      {long ? (
        <Button
          shape="pill"
          size="micro"
          variant="ghost-muted"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show all"}
        </Button>
      ) : null}
    </div>
  );
}

/** A verdict's findings as one outlined list, each weighed by the verdict it explains. */
export function BotFindings({ verdict }: { readonly verdict: BotVerdict }) {
  if (verdict.findings.length === 0 && !verdict.findingsTruncated) return null;
  // Findings have no severity of their own; they weigh what the verdict they explain weighs.
  const tone = verdict.verdict === "pass" ? "neutral" : BOT_VERDICT_STATES[verdict.verdict].tone;
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      {verdict.findings.length > 0 ? (
        <ul
          aria-label="Findings"
          className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border")}
        >
          {keyedFindings(verdict.findings).map(({ finding, key }) => {
            const where = location(finding);
            return (
              <li key={key} className="flex min-w-0 gap-2.5 px-3 py-2.5">
                <LibraryStateDot tone={tone} className="mt-1.5" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <span className="min-w-0 font-medium wrap-anywhere">{finding.title}</span>
                    {where === null ? null : <FindingLocation value={where} />}
                  </div>
                  {finding.detail === "" ? null : <FindingDetail detail={finding.detail} />}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {verdict.findingsTruncated ? (
        <p className="text-xs text-muted-foreground">
          The bot reported more findings than are kept. Open the thread for the rest.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A run's reply as written. `bounded` caps its height with its own scroll, for lists; a sheet that
 * scrolls on its own shows it whole.
 */
export function RawReply({
  run,
  bounded = true,
}: {
  readonly run: BotRun;
  readonly bounded?: boolean;
}) {
  return (
    <pre
      className={cn(
        "rounded-xl bg-muted/50 px-3.5 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere dark:bg-accent/50",
        bounded && "max-h-96 overflow-auto",
      )}
    >
      {run.result ?? "The bot gave no reply."}
      {run.resultTruncated ? "\n\n[Reply shortened. Open the thread for the full text.]" : ""}
    </pre>
  );
}

/** The reply behind a run, folded when a verdict already says what it found. */
export function RunReply({
  run,
  defaultOpen,
}: {
  readonly run: BotRun;
  readonly defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "reply" });
  const reply = run.result;
  if (!reply) return null;
  return (
    <section aria-label="Reply" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button
          shape="pill"
          size="xs"
          variant="ghost-muted"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRightIcon
            className={cn("transition-transform duration-150", open && "rotate-90")}
          />
          {run.verdict?.source === "invalid" ? "Reply, not a verdict" : "Reply"}
        </Button>
        <Button
          shape="pill"
          size="xs"
          variant="ghost-muted"
          aria-label={isCopied ? "Copied" : "Copy reply"}
          onClick={() => copyToClipboard(reply)}
        >
          {isCopied ? <CheckIcon /> : <CopyIcon />}
          {isCopied ? "Copied" : "Copy"}
        </Button>
      </div>
      {open ? <RawReply run={run} bounded={false} /> : null}
    </section>
  );
}
