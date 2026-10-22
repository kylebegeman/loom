import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "~/lib/utils";

export function LoomSettingsContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("min-w-0 px-3 py-4 sm:px-4", className)}>{children}</div>;
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
    <div className="flex min-w-0 flex-col gap-2">
      <div className="text-sm font-medium text-foreground">{label}</div>
      {children}
      {description ? (
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export function LoomSettingsActions({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>;
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
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-border/60 p-3 sm:p-4">
      {title || description ? (
        <div className="space-y-1">
          {title ? <h3 className="text-sm font-medium text-foreground">{title}</h3> : null}
          {description ? (
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
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
    <details className="group/loom-settings-details min-w-0 rounded-lg border border-border/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground group-open/loom-settings-details:rotate-90"
        />
        {title}
      </summary>
      <div className="flex min-w-0 flex-col gap-4 px-3 pb-4 sm:px-4">{children}</div>
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
  return (
    <div
      role={role}
      className={cn(
        "min-w-0 rounded-lg bg-muted/40 px-3 py-3 text-sm leading-relaxed wrap-anywhere",
        role === "alert" ? "text-destructive-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}
