import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { RefreshCwIcon } from "lucide-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { AppleContainer, AppleXcodegenReport } from "@t3tools/contracts/fork";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { Alert, Muted, Section, failureOf, valueOf } from "./parts";
import { apple } from "./state";

const STATE: Record<
  AppleXcodegenReport["state"],
  { label: string; variant: "success" | "warning" | "error" | "outline" }
> = {
  "in-sync": { label: "In sync", variant: "success" },
  "out-of-date": { label: "Out of date", variant: "warning" },
  "not-generated": { label: "Not generated", variant: "outline" },
  invalid: { label: "Spec invalid", variant: "error" },
  "xcodegen-missing": { label: "xcodegen not installed", variant: "outline" },
};

const lineClass = (line: string) =>
  line.startsWith("+") && !line.startsWith("+++")
    ? "text-success-foreground"
    : line.startsWith("-") && !line.startsWith("---")
      ? "text-destructive-foreground"
      : line.startsWith("@@")
        ? "text-muted-foreground"
        : undefined;

/** Lines keyed by their offset in the diff, which repeated lines do not share. */
const diffLines = (diff: string) => {
  let offset = 0;
  return diff.split("\n").map((line) => {
    const start = offset;
    offset += line.length + 1;
    return { line, start };
  });
};

function Diff({ diff, truncated }: { diff: string; truncated: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
        {diffLines(diff).map(({ line, start }) => (
          <div key={start} className={cn("whitespace-pre", lineClass(line))}>
            {line || " "}
          </div>
        ))}
      </pre>
      {truncated && <Muted>The diff is cut at 200 KB.</Muted>}
    </div>
  );
}

export function XcodegenCard({
  environmentId,
  threadId,
  container,
  canGenerate,
  onGenerate,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  container: AppleContainer;
  canGenerate: boolean;
  onGenerate: () => void;
}) {
  const atom = apple.xcodegen({
    environmentId,
    input: { workspace: { threadId }, spec: container.path },
  });
  const result = useAtomValue(atom);
  const report = valueOf(result);
  const [showDiff, setShowDiff] = useState(false);
  return (
    <Section
      title="XcodeGen"
      actions={
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Check XcodeGen again"
          onClick={() => appAtomRegistry.refresh(atom)}
        >
          <RefreshCwIcon />
        </Button>
      }
    >
      {failureOf(result) && <Alert>{failureOf(result)}</Alert>}
      {!report && !failureOf(result) && (
        <Muted>Comparing {container.path} with the project...</Muted>
      )}
      {report && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={STATE[report.state].variant}>{STATE[report.state].label}</Badge>
            <span className="text-muted-foreground">{report.spec}</span>
          </div>
          {report.error && (
            <pre className="whitespace-pre-wrap break-words text-destructive-foreground text-xs">
              {report.error}
            </pre>
          )}
          {report.changedSchemes.length > 0 && (
            <Muted>Shared schemes that change: {report.changedSchemes.join(", ")}.</Muted>
          )}
          <div className="flex flex-wrap gap-1">
            {report.state !== "xcodegen-missing" && report.state !== "invalid" && (
              <Button
                size="xs"
                variant={report.state === "in-sync" ? "outline" : "default"}
                disabled={!canGenerate}
                onClick={onGenerate}
              >
                Generate
              </Button>
            )}
            {report.diff && (
              <Button size="xs" variant="outline" onClick={() => setShowDiff((open) => !open)}>
                {showDiff ? "Hide diff" : "Show project.pbxproj diff"}
              </Button>
            )}
          </div>
          {showDiff && report.diff && <Diff diff={report.diff} truncated={report.diffTruncated} />}
          {report.state === "xcodegen-missing" && (
            <Muted>Install it with: brew install xcodegen</Muted>
          )}
        </div>
      )}
    </Section>
  );
}
