import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type {
  AppleContainer,
  AppleReadinessReport,
  AppleReadinessSeverity,
} from "@t3tools/contracts/fork";
import { Atom, AsyncResult } from "effect/reactivity";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { Alert, Muted, Section, failureOf, valueOf } from "./parts";
import { apple } from "./state";

const SEVERITY: Record<
  AppleReadinessSeverity,
  { label: string; variant: "success" | "warning" | "error" | "outline" }
> = {
  pass: { label: "Pass", variant: "success" },
  warning: { label: "Check", variant: "warning" },
  fail: { label: "Fail", variant: "error" },
  unknown: { label: "Unknown", variant: "outline" },
};

const idle = Atom.make(AsyncResult.initial<AppleReadinessReport, never>());

/** Runs only when asked: the checklist reads build settings, which takes a few seconds. */
export function ReadinessCard({
  environmentId,
  threadId,
  container,
  scheme,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  container: AppleContainer;
  scheme: string;
}) {
  const [requested, setRequested] = useState(false);
  const atom = apple.readiness({
    environmentId,
    input: { workspace: { threadId }, container, scheme },
  });
  const result = useAtomValue(requested ? atom : idle);
  const report = valueOf(result);
  return (
    <Section
      title="Release readiness"
      actions={
        <Button
          size="xs"
          variant="outline"
          onClick={() => (requested ? appAtomRegistry.refresh(atom) : setRequested(true))}
        >
          {requested ? "Check again" : "Check"}
        </Button>
      }
    >
      {!requested && (
        <Muted>Checks {scheme} before a release: signing, version, icon, privacy and more.</Muted>
      )}
      {requested && !report && !failureOf(result) && <Muted>Reading build settings...</Muted>}
      {failureOf(result) && <Alert>{failureOf(result)}</Alert>}
      {report && (
        <ul className="flex flex-col gap-1.5">
          {report.checks.map((check) => (
            <li key={check.code} className="flex items-start gap-2 text-sm">
              <Badge variant={SEVERITY[check.severity].variant}>
                {SEVERITY[check.severity].label}
              </Badge>
              <span className="min-w-0">
                <span>{check.title}</span>
                <span className="block break-words text-muted-foreground text-xs">
                  {check.message}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
