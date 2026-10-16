import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";

export function LibraryDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly actions: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>{children}</DialogPanel>
        <DialogFooter variant="bare">{actions}</DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function LibraryField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

export function LibraryErrorNotice({
  error,
  onRetry,
}: {
  readonly error: string | null;
  readonly onRetry?: () => void;
}) {
  return error ? (
    <div role="alert" className="flex flex-wrap items-center gap-3 py-2 text-sm text-destructive">
      <p>{error}</p>
      {onRetry ? (
        <Button size="xs" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  ) : null;
}

/**
 * One titled stretch of a project page. No box around it: the heading and the rows carry the
 * structure, and rows answer hover on their own.
 */
export function LibrarySection({
  title,
  count,
  action,
  children,
}: {
  readonly title: string;
  readonly count?: number | undefined;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold tracking-tight">
          {title}
          {count ? (
            <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
          ) : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A row inside a section: no rule between rows, a soft fill on hover that bleeds past the text. */
export const LIBRARY_ROW =
  "-mx-2.5 rounded-lg px-2.5 transition-colors duration-150 hover:bg-accent/50";
