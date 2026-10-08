import { useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { errorText } from "./state";

export const valueOf = <A, E>(result: AsyncResult.AsyncResult<A, E>): A | null =>
  Option.getOrNull(AsyncResult.value(result));

export const failureOf = <A, E>(result: AsyncResult.AsyncResult<A, E>): string | null =>
  result._tag === "Failure" ? errorText(Cause.squash(result.cause)) : null;

/** A titled block of the panel, separated by neutral borders only. */
export function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t px-3 py-3 first:border-t-0">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 className="font-medium text-sm">{title}</h2>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <Button size="xs" variant="outline" onClick={() => copyToClipboard(value)}>
      {isCopied ? <CheckIcon /> : <CopyIcon />}
      {isCopied ? "Copied" : label}
    </Button>
  );
}

/** A command for the user to run themselves; Loom never runs these. */
export function CopyCommand({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">
        {command}
      </code>
      <CopyButton value={command} label="Copy" />
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-destructive-foreground text-sm">
      {children}
    </p>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

/** Tracks one action at a time and reports its failure. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, act };
}

export function formatDuration(startedAt: string, finishedAt: string | null, now: number) {
  const end = finishedAt === null ? now : Date.parse(finishedAt);
  const seconds = Math.max(0, Math.round((end - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}
