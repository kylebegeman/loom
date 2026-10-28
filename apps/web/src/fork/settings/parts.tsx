import { Field as FieldPrimitive } from "@base-ui/react/field";
import {
  createContext,
  isValidElement,
  use,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { ChevronRightIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { SettingsGroup } from "~/components/settings/SettingsGroup";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";

// Rows sit flush with the padded body; consecutive rows keep upstream's hairline divider.
const SETTINGS_BODY_CLASS =
  "flex min-w-0 flex-col gap-4 px-3 py-4 sm:px-4 [&_[data-slot=settings-row]]:px-0 [&>[data-slot=settings-row]]:py-0 [&>[data-slot=settings-row]+[data-slot=settings-row]]:border-t [&>[data-slot=settings-row]+[data-slot=settings-row]]:border-border/50 [&>[data-slot=settings-row]+[data-slot=settings-row]]:pt-4";

// A fold inside a panel's card stays flat, so a card never sits inside a card.
const InSettingsPanel = createContext(false);

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
    <section aria-labelledby={title ? titleId : undefined} className="min-w-0 space-y-2.5">
      {title || description ? (
        <header className="space-y-1 px-3 sm:px-4">
          {title ? (
            <h3
              id={titleId}
              className="flex min-h-7 items-center text-sm font-semibold text-foreground"
            >
              {title}
            </h3>
          ) : null}
          {description ? (
            <p className="max-w-2xl text-xs leading-normal text-muted-foreground">{description}</p>
          ) : null}
        </header>
      ) : null}
      <SettingsGroup divided={false}>
        <div className={cn(SETTINGS_BODY_CLASS, "overflow-clip")}>
          <InSettingsPanel value>{children}</InSettingsPanel>
        </div>
      </SettingsGroup>
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
  const nested = use(InSettingsPanel);
  return (
    <Collapsible
      className="min-w-0"
      render={nested ? undefined : <SettingsGroup divided={false} className="min-w-0" />}
    >
      <CollapsibleTrigger
        className={cn(
          "group flex min-h-11 w-full min-w-0 items-center gap-2 text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          nested ? "rounded-md" : "rounded-xl px-3 py-2 data-panel-open:rounded-b-none sm:px-4",
        )}
      >
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 flex-1">{title}</span>
      </CollapsibleTrigger>
      {/* Kept mounted so drafts survive a fold and find-in-page can open it. */}
      <CollapsiblePanel hiddenUntilFound>
        <div
          className={cn(
            SETTINGS_BODY_CLASS,
            nested ? "px-0 pt-2 pb-0 sm:px-0" : "border-t border-border/50",
          )}
        >
          {children}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export function LoomSettingsNotice({
  children,
  role,
}: {
  children: ReactNode;
  role?: ComponentPropsWithoutRef<"div">["role"];
}) {
  const isAlert = role === "alert";
  const Icon = isAlert ? TriangleAlertIcon : InfoIcon;
  return (
    <Alert variant={isAlert ? "error" : "info"} role={role} controlAlignment="first-line">
      <Icon aria-hidden />
      <AlertDescription>
        <div className="min-w-0 leading-relaxed wrap-anywhere">{children}</div>
      </AlertDescription>
    </Alert>
  );
}
