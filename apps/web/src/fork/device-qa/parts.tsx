import { useEffect, useState, type ReactNode } from "react";
import { CheckIcon, CircleCheckIcon, CopyIcon } from "lucide-react";
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
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t px-4 py-4 first:border-t-0">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="min-w-0 font-medium text-sm">{title}</h2>
          {description && (
            <p className="text-muted-foreground text-xs tabular-nums">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Facts about an item, such as its device, size and time, set apart by spacing. */
export function Meta({ items }: { items: ReadonlyArray<ReactNode> }) {
  const shown = items.filter((item) => item !== null && item !== false && item !== "");
  if (shown.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-muted-foreground text-xs tabular-nums">
      {shown.map((item, position) => (
        // oxlint-disable-next-line react/no-array-index-key -- A fixed, ordered list of facts.
        <span key={position} className="min-w-0 truncate">
          {item}
        </span>
      ))}
    </span>
  );
}

/** What an empty list holds, and the way to fill it. */
export function EmptyNote({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center">
      <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </div>
      <p className="font-medium text-sm">{title}</p>
      <p className="max-w-72 text-balance text-muted-foreground text-xs">{children}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** A finished action's outcome. */
export function Done({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2 text-sm">
      <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success-foreground" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function CopyButton({
  value,
  label,
  variant = "outline",
}: {
  value: string;
  label: string;
  variant?: "outline" | "ghost";
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <Button size="xs" variant={variant} onClick={() => copyToClipboard(value)}>
      {isCopied ? <CheckIcon /> : <CopyIcon />}
      {isCopied ? "Copied" : label}
    </Button>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="whitespace-pre-wrap break-words rounded-md bg-destructive/8 px-2.5 py-2 text-destructive-foreground text-xs dark:bg-destructive/16"
    >
      {children}
    </p>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-xs leading-relaxed">{children}</p>;
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

export function formatSeconds(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export const formatElapsed = (startedAt: string, finishedAt: string | null, now: number) =>
  formatSeconds(
    ((finishedAt === null ? now : Date.parse(finishedAt)) - Date.parse(startedAt)) / 1000,
  );

export function formatBytes(bytes: number) {
  if (bytes < 1e6) return `${Math.max(bytes === 0 ? 0 : 1, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** Re-renders once a second while `active`, for elapsed times; idle otherwise. */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
