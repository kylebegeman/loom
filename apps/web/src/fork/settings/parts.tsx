import { Field as FieldPrimitive } from "@base-ui/react/field";
import { isValidElement, useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { ChevronRightIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "~/lib/utils";

export function LoomSettingsContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("min-w-0 py-4 first:pt-0 last:pb-0", className)}>{children}</div>;
}

export function LoomSettingsField({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <FieldPrimitive.Root className="flex min-w-0 flex-col gap-2.5">
      <FieldPrimitive.Label
        render={isValidElement(label) && label.type === "label" ? label : undefined}
        className="text-sm leading-snug font-medium text-foreground"
      >
        {isValidElement<{ children?: ReactNode }>(label) && label.type === "label"
          ? label.props.children
          : label}
      </FieldPrimitive.Label>
      {children}
      {description ? (
        <FieldPrimitive.Description className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          {description}
        </FieldPrimitive.Description>
      ) : null}
    </FieldPrimitive.Root>
  );
}

export function LoomSettingsActions({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-2.5">{children}</div>;
}

export function LoomSettingsPanel({
  title,
  description,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className="min-w-0 overflow-clip rounded-xl border border-border/70 bg-card"
    >
      {title || description ? (
        <header className="space-y-1.5 border-b border-border/60 px-4 py-4 sm:px-5">
          {title ? (
            <h3 id={titleId} className="text-sm leading-snug font-semibold text-foreground">
              {title}
            </h3>
          ) : null}
          {description ? (
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </header>
      ) : null}
      <div className="flex min-w-0 flex-col gap-5 p-4 sm:p-5 [&_[data-slot=settings-row]]:px-0">
        {children}
      </div>
    </section>
  );
}

export function LoomSettingsDetails({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group/loom-settings-details min-w-0 rounded-lg border border-border/60 bg-muted/15">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-lg px-4 py-3 text-sm font-medium outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground group-open/loom-settings-details:rotate-90"
        />
        <span className="min-w-0 flex-1">{title}</span>
      </summary>
      <div className="flex min-w-0 flex-col gap-4 border-t border-border/50 px-4 py-4">
        {children}
      </div>
    </details>
  );
}

export function LoomSettingsNotice({
  children,
  role,
}: {
  children: ReactNode;
  role?: ComponentPropsWithoutRef<"div">["role"];
}) {
  const Icon = role === "alert" ? TriangleAlertIcon : InfoIcon;
  return (
    <div
      role={role}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm leading-relaxed wrap-anywhere",
        role === "alert"
          ? "bg-destructive/8 text-destructive-foreground"
          : "bg-muted/45 text-muted-foreground",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
