import type { ReactNode } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
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

/** The pill search field the Library lists share. Escape clears it before it leaves the field. */
export function LibrarySearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly label: string;
}) {
  return (
    <InputGroup shape="pill" className="w-full sm:w-72">
      <InputGroupAddon>
        <SearchIcon aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        size="sm"
        placeholder={placeholder}
        aria-label={label}
      />
      {value ? (
        <InputGroupAddon align="inline-end">
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-label="Clear search"
            onClick={() => onChange("")}
          >
            <XIcon />
          </Button>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
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

/**
 * One titled card in the project page's side rail. The body sets its own padding, so lists run edge to
 * edge under the header while prose keeps the card's inset.
 */
export function LibraryPanel({
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
    <section aria-label={title} className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex min-h-10 items-center justify-between gap-3 py-1.5 ps-3.5 pe-2">
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
