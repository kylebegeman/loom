import { CheckIcon, CopyIcon } from "lucide-react";
import type { BotFinding, BotRun, BotVerdict } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

const location = (finding: BotFinding) =>
  finding.path === undefined
    ? null
    : `${finding.path}${finding.line === undefined ? "" : `:${finding.line}`}`;

function FindingLocation({ value }: { readonly value: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "location" });
  return (
    <span className="flex min-w-0 items-center gap-1">
      <code className="truncate text-xs text-muted-foreground">{value}</code>
      <Button
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
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
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
  return (
    <div className="grid gap-2 text-sm">
      <p className="whitespace-pre-wrap">{verdict.summary}</p>
      {verdict.findings.length > 0 ? (
        <ul className="grid gap-2">
          {verdict.findings.map((finding, index) => {
            const where = location(finding);
            return (
              <li
                // oxlint-disable-next-line react/no-array-index-key -- Findings have no identity and never reorder.
                key={index}
                className="grid gap-1 rounded-md border border-border p-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{finding.title}</span>
                  {where === null ? null : <FindingLocation value={where} />}
                </div>
                {finding.detail === "" ? null : (
                  <p className="whitespace-pre-wrap text-muted-foreground">{finding.detail}</p>
                )}
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
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Raw reply</summary>
          <div className="mt-2">
            <RawReply run={run} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
