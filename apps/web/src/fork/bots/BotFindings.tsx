import { useState } from "react";
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import type { BotFinding, BotRun, BotVerdict } from "@t3tools/contracts/fork";
import { BOT_VERDICT_STATES } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { LibraryStateDot } from "../project-library/LibraryControls";

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

export function RawReply({ run }: { readonly run: BotRun }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-xl bg-muted/50 px-3.5 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere dark:bg-accent/50">
      {run.result ?? "The bot gave no reply."}
      {run.resultTruncated ? "\n\n[Reply shortened. Open the thread for the full text.]" : ""}
    </pre>
  );
}

/** A verdict's summary and findings, then the raw reply, open when it was not a verdict. */
export function BotFindings({
  run,
  verdict,
}: {
  readonly run: BotRun;
  readonly verdict: BotVerdict;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  // Findings have no severity of their own; they weigh what the verdict they explain weighs.
  const tone = verdict.verdict === "pass" ? "neutral" : BOT_VERDICT_STATES[verdict.verdict].tone;
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <p className="whitespace-pre-wrap text-foreground/90">{verdict.summary}</p>
      {verdict.findings.length > 0 ? (
        <ul aria-label="Findings" className="flex flex-col gap-2.5">
          {keyedFindings(verdict.findings).map(({ finding, key }) => {
            const where = location(finding);
            return (
              <li key={key} className="flex min-w-0 gap-2.5">
                <LibraryStateDot tone={tone} className="mt-1.5" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <span className="min-w-0 font-medium wrap-anywhere">{finding.title}</span>
                    {where === null ? null : <FindingLocation value={where} />}
                  </div>
                  {finding.detail === "" ? null : (
                    <p className="whitespace-pre-wrap text-muted-foreground wrap-anywhere">
                      {finding.detail}
                    </p>
                  )}
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
      {verdict.source === "invalid" ? (
        <RawReply run={run} />
      ) : run.result ? (
        <div className="flex flex-col items-start gap-2">
          <Button
            shape="pill"
            size="xs"
            variant="ghost-muted"
            aria-expanded={rawOpen}
            onClick={() => setRawOpen((on) => !on)}
          >
            <ChevronRightIcon
              className={cn("transition-transform duration-150", rawOpen && "rotate-90")}
            />
            Raw reply
          </Button>
          {rawOpen ? <RawReply run={run} /> : null}
        </div>
      ) : null}
    </div>
  );
}
