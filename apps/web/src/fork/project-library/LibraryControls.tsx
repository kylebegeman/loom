import type { ReactNode, Ref } from "react";
import { SearchIcon, XIcon, type LucideIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
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
  inputRef,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly label: string;
  readonly inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <InputGroup shape="pill" className="w-full sm:w-72">
      <InputGroupAddon>
        <SearchIcon aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
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
  icon,
  count,
  action,
  children,
}: {
  readonly title: string;
  readonly icon?: LucideIcon;
  readonly count?: number | undefined;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <LibraryHeading title={title} icon={icon} count={count} size="section" />
        {action}
      </div>
      {children}
    </section>
  );
}

/** A heading led by the project-tinted icon its stretch is about, with its count in parentheses. */
function LibraryHeading({
  title,
  icon: Icon,
  count,
  size,
}: {
  readonly title: string;
  readonly icon: LucideIcon | undefined;
  readonly count: number | undefined;
  readonly size: "section" | "panel";
}) {
  return (
    <h2
      className={cn(
        "flex min-w-0 items-center gap-2.5 font-semibold tracking-tight",
        size === "section" ? "text-base" : "text-sm",
      )}
    >
      {Icon ? (
        <span
          aria-hidden
          className={cn(
            "inline-flex shrink-0 items-center justify-center bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16",
            size === "section" ? "size-7 rounded-lg" : "size-6 rounded-md",
          )}
        >
          <Icon className={size === "section" ? "size-3.5" : "size-3"} />
        </span>
      ) : null}
      <span className="truncate">{title}</span>
      {count ? (
        <span className="text-xs font-normal tabular-nums text-muted-foreground">({count})</span>
      ) : null}
    </h2>
  );
}

/**
 * One titled card in the project page's side rail. The body sets its own padding, so lists run edge to
 * edge under the header while prose keeps the card's inset.
 */
export function LibraryPanel({
  title,
  icon,
  count,
  action,
  children,
}: {
  readonly title: string;
  readonly icon?: LucideIcon;
  readonly count?: number | undefined;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs/5"
    >
      <div className="flex min-h-12 items-center justify-between gap-3 py-2 ps-3 pe-2">
        <LibraryHeading title={title} icon={icon} count={count} size="panel" />
        {action}
      </div>
      {children}
    </section>
  );
}

/** A row inside a section: no rule between rows, a soft fill on hover that bleeds past the text. */
export const LIBRARY_ROW =
  "-mx-2.5 rounded-lg px-2.5 transition-colors duration-150 hover:bg-accent/50";
