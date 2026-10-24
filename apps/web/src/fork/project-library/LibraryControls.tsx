import type { ReactNode, Ref } from "react";
import { SearchIcon, XIcon, type LucideIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { LibraryWorkflowTone } from "@t3tools/client-runtime/fork";
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
        <Button shape="pill" size="xs" variant="outline" onClick={onRetry}>
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
  className,
  children,
}: {
  readonly title: string;
  readonly icon?: LucideIcon;
  readonly count?: number | undefined;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 flex-col gap-3", className)}>
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

const STATE_PILL: Record<LibraryWorkflowTone, string> = {
  neutral: "bg-muted text-muted-foreground dark:bg-accent",
  active: "bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16",
  success: "bg-success/12 text-success-foreground",
  warning: "bg-warning/14 text-warning-foreground",
  danger: "bg-destructive/10 text-destructive-foreground dark:bg-destructive/16",
};

const STATE_DOT: Record<LibraryWorkflowTone, string> = {
  neutral: "bg-muted-foreground/45",
  active: "bg-(--project-color)",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

/** The one pill every Library state uses, so Ready, Active and Failed read alike everywhere. */
export function LibraryStateBadge({
  tone,
  icon: Icon,
  children,
}: {
  readonly tone: LibraryWorkflowTone;
  readonly icon?: LucideIcon | undefined;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-2xs font-medium",
        STATE_PILL[tone],
      )}
    >
      {Icon ? (
        <Icon aria-hidden className="-ms-0.5 size-3" />
      ) : (
        <span aria-hidden className={cn("size-1.5 rounded-full", STATE_DOT[tone])} />
      )}
      {children}
    </span>
  );
}

/** The state's color alone, for rows and tiles too small for a pill. Always paired with a label. */
export function LibraryStateDot({
  tone,
  className,
}: {
  readonly tone: LibraryWorkflowTone;
  readonly className?: string;
}) {
  return (
    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STATE_DOT[tone], className)} />
  );
}

/**
 * A surface drawn with its outline alone, for grouping that should not compete with the page's
 * one filled hero.
 */
export const LIBRARY_OUTLINE = "rounded-xl border border-border";

/**
 * One headline number in a row of figures, divided by hairlines rather than boxed. Large values
 * keep proportional figures, which read tighter at this size; the detail says what it covers.
 * Place inside a `dl`.
 */
export function LibraryFigure({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-border not-first:border-s not-first:ps-5">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl leading-tight font-semibold tracking-tight">{value}</dd>
      {detail ? <dd className="truncate text-xs text-muted-foreground">{detail}</dd> : null}
    </div>
  );
}

/** A quiet line about the page's circumstances, such as an offline server or a missing update. */
export function LibraryNotice({
  icon: Icon,
  tone = "neutral",
  action,
  children,
}: {
  readonly icon: LucideIcon;
  readonly tone?: "neutral" | "warning" | "danger";
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-4 py-3 text-sm",
        tone === "neutral" && "bg-muted/50 text-muted-foreground dark:bg-accent/50",
        tone === "warning" && "bg-warning/10 text-warning-foreground",
        tone === "danger" && "bg-destructive/8 text-destructive-foreground",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** What an empty Library page shows: what will live here, and the one way to start. */
export function LibraryEmpty({
  icon: Icon,
  title,
  children,
  action,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="relative isolate flex flex-col items-center gap-3.5 overflow-hidden rounded-xl border border-dashed border-border px-6 py-10 text-center"
    >
      <span
        aria-hidden
        className="inline-flex size-10 items-center justify-center rounded-xl bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16"
      >
        <Icon className="size-5" />
      </span>
      <div className="max-w-md space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
      {action}
    </section>
  );
}

/** A row inside a section: no rule between rows, a soft fill on hover that bleeds past the text. */
export const LIBRARY_ROW =
  "-mx-2.5 rounded-lg px-2.5 transition-colors duration-150 hover:bg-accent/50";

/**
 * The heading over one group in a Library collection: its name, its count, and an optional hint
 * that drops out on narrow screens. `marker` leads it, such as a color dot or a state dot.
 */
export function LibraryGroupHeading({
  title,
  count,
  hint,
  marker,
  action,
}: {
  readonly title: string;
  readonly count?: number | undefined;
  readonly hint?: string | undefined;
  readonly marker?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-2">
      {marker}
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {count === undefined ? null : (
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
      {hint ? (
        <p className="ms-1 hidden min-w-0 truncate text-xs text-muted-foreground/75 sm:block">
          {hint}
        </p>
      ) : null}
      {action ? <div className="ms-auto flex shrink-0 items-center gap-1.5">{action}</div> : null}
    </div>
  );
}

/** A chosen filter beside the Filters menu; pressing it removes the filter. */
export function LibraryFilterChip({
  label,
  removeLabel,
  marker,
  onRemove,
}: {
  readonly label: ReactNode;
  /** What pressing it does, such as "Stop showing only failed runs". */
  readonly removeLabel: string;
  readonly marker?: ReactNode;
  readonly onRemove: () => void;
}) {
  return (
    <Button shape="pill" size="xs" variant="secondary" aria-label={removeLabel} onClick={onRemove}>
      {marker}
      {label}
      <XIcon aria-hidden />
    </Button>
  );
}

/**
 * Settings or facts as a spec sheet: one hairline row per entry, label left, value right. For
 * asides and sheets, where a table would be too heavy and prose too loose.
 */
export function LibrarySpecSheet({
  label,
  rows,
}: {
  readonly label: string;
  readonly rows: readonly { readonly label: string; readonly value: ReactNode }[];
}) {
  return (
    <dl aria-label={label} className="flex flex-col divide-y divide-border text-xs">
      {rows.map((row) => (
        <div key={row.label} className="flex min-w-0 items-baseline justify-between gap-4 py-1.5">
          <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 text-end font-medium wrap-anywhere">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
