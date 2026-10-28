import { useAtomValue } from "@effect/atom-react";
import { agentReceiptFacts, createAgentReceiptsAtoms } from "@t3tools/client-runtime/fork";
import type { EnvironmentId, NodeId, ThreadId } from "@t3tools/contracts";
import { type AgentReceipt, AgentReceiptError } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { ChevronRightIcon } from "lucide-react";
import type { Atom } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { connectionAtomRuntime } from "~/connection/runtime";
import { cn } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { failureOf, valueOf } from "../code-graph/parts";

const receipts = createAgentReceiptsAtoms(connectionAtomRuntime);
const FILES_SHOWN = 12;
const isReceiptError = Schema.is(AgentReceiptError);

/** The receipt is written just after the sub-agent finishes, so a new finish asks again. */
function useRefreshOn(atom: Atom.Atom<unknown>, key: string | null) {
  const seen = useRef(key);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes the receipt atom in the app registry when the sub-agent's finish key changes
  useEffect(() => {
    if (key === seen.current) return;
    seen.current = key;
    appAtomRegistry.refresh(atom);
  }, [atom, key]);
}

/** A finished sub-agent's receipt under its row: what changed, what failed, the full result. */
export function SubagentReceipt(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly subagentId: NodeId;
  readonly finishedAt: string;
  readonly cwd: string | undefined;
}) {
  const listAtom = receipts.list({
    environmentId: props.environmentId,
    input: { threadId: props.threadId },
  });
  useRefreshOn(listAtom, props.finishedAt);
  const summary =
    valueOf(useAtomValue(listAtom))?.find((entry) => entry.subjectId === props.subagentId) ?? null;
  const [expanded, setExpanded] = useState(false);
  const facts = summary === null ? null : agentReceiptFacts(summary);
  return (
    <div className="pb-1 pl-9 pr-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          if (!expanded && summary === null) appAtomRegistry.refresh(listAtom);
          setExpanded((open) => !open);
        }}
        className="flex max-w-full items-center gap-1 rounded-sm text-2xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
        />
        <span className="truncate">
          Receipt
          {facts === null ? null : (
            <span className={cn(summary?.failedCommands ? "text-destructive" : undefined)}>
              {` · ${facts}`}
            </span>
          )}
        </span>
      </button>
      {expanded ? <ReceiptDetail {...props} /> : null}
    </div>
  );
}

function ReceiptDetail(props: Parameters<typeof SubagentReceipt>[0]) {
  const result = useAtomValue(
    receipts.get({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, subjectId: props.subagentId },
    }),
  );
  const receipt = valueOf(result);
  if (receipt === null) {
    const error = result._tag === "Failure" ? Cause.squash(result.cause) : null;
    return (
      <p className="mt-1 text-2xs text-muted-foreground">
        {error === null
          ? "Loading the receipt…"
          : isReceiptError(error) && error.reason === "not-found"
            ? "No receipt yet."
            : failureOf(result)}
      </p>
    );
  }
  return <ReceiptBody receipt={receipt} cwd={props.cwd} />;
}

function ReceiptBody({ receipt, cwd }: { receipt: AgentReceipt; cwd: string | undefined }) {
  const files = receipt.files.slice(0, FILES_SHOWN);
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2 text-xs">
      {receipt.commands.failed.length > 0 ? (
        <pre className="overflow-x-auto whitespace-pre font-mono text-2xs text-destructive">
          {receipt.commands.failed
            .map((command) => `exit ${command.exitCode ?? "?"} · ${command.input}`)
            .join("\n")}
        </pre>
      ) : null}
      {files.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-muted-foreground">
          {files.map((file) => (
            <li key={file.path} className="truncate font-mono text-2xs">
              {file.path}
            </li>
          ))}
          {receipt.files.length > files.length ? (
            <li className="text-2xs">{`and ${receipt.files.length - files.length} more`}</li>
          ) : null}
        </ul>
      ) : null}
      <div className="max-h-80 overflow-auto">
        {receipt.result.text.trim().length === 0 ? (
          <p className="text-muted-foreground">No result was recorded.</p>
        ) : (
          <ChatMarkdown text={receipt.result.text} cwd={cwd} />
        )}
      </div>
    </div>
  );
}
