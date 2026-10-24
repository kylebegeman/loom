import { Tabs } from "@base-ui/react/tabs";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export type LibraryTab<V extends string> = {
  readonly value: V;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly count?: number | undefined;
  /** Draws the count as a warning, for views holding work that waits on someone. */
  readonly urgent?: boolean;
};

/**
 * A Library page's views as tabs. One indicator slides to the chosen tab rather than each tab
 * lighting up on its own, so the switch reads as movement. Arrow keys move focus and Enter opens
 * a view, since each one is a navigation that should not fire on every key press.
 *
 * `pill` suits a page with a few large views. `underline` is the quieter strip for pages with many
 * views or a toolbar under them: it runs the full width on a hairline, so it never reads as a
 * second control stacked on the first.
 */
export function LibraryTabs<V extends string>({
  label,
  tabs,
  selected,
  onSelect,
  variant = "pill",
  actions,
  children,
}: {
  readonly label: string;
  readonly tabs: readonly LibraryTab<V>[];
  readonly selected: V;
  readonly onSelect: (value: V) => void;
  readonly variant?: "pill" | "underline";
  /** Controls at the far end of an underline strip, such as a filter for the open view. */
  readonly actions?: ReactNode;
  /** The selected view, shown in the one panel the tabs control. */
  readonly children: ReactNode;
}) {
  const underline = variant === "underline";
  return (
    <Tabs.Root
      value={selected}
      onValueChange={(next) => {
        const tab = tabs.find((entry) => entry.value === next);
        if (tab) onSelect(tab.value);
      }}
      className={cn("flex min-w-0 flex-col", underline ? "gap-5" : "gap-8")}
    >
      {underline ? (
        <div className="flex min-w-0 items-end gap-3 border-b border-border">
          <div className="-mb-px min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
            <Tabs.List aria-label={label} className="relative flex w-fit items-center gap-5">
              <Tabs.Indicator className="absolute bottom-0 left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-full bg-foreground transition-[translate,width] duration-300 ease-drawer motion-reduce:transition-none" />
              {tabs.map(({ value, label: tabLabel, count, urgent }) => (
                <Tabs.Tab
                  key={value}
                  value={value}
                  className="inline-flex h-10 shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-sm text-sm text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-active:font-medium data-active:text-foreground"
                >
                  {tabLabel}
                  {count ? (
                    <span
                      className={cn(
                        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1.5 text-2xs font-medium tabular-nums",
                        urgent
                          ? "bg-warning/16 text-warning-foreground"
                          : "bg-muted text-muted-foreground dark:bg-accent",
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-1.5 pb-1.5">{actions}</div>
          ) : null}
        </div>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
          <Tabs.List
            aria-label={label}
            className="relative isolate flex w-fit items-center gap-0.5 rounded-full bg-muted p-1 dark:bg-accent"
          >
            <Tabs.Indicator className="absolute top-1/2 left-0 -z-10 h-(--active-tab-height) w-(--active-tab-width) -translate-y-1/2 translate-x-(--active-tab-left) overflow-hidden rounded-full bg-card shadow-sm ring-1 ring-border transition-[translate,width] duration-300 ease-drawer motion-reduce:transition-none">
              <span aria-hidden className="absolute inset-0 bg-(--project-color)/10" />
            </Tabs.Indicator>
            {tabs.map(({ value, label: tabLabel, icon: Icon, count }) => (
              <Tabs.Tab
                key={value}
                value={value}
                className="group/tab inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium text-muted-foreground outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-active:text-foreground"
              >
                <Icon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground/70 transition-colors duration-200 group-hover/tab:text-foreground/70 group-data-active/tab:text-(--project-color)"
                />
                {tabLabel}
                {count ? (
                  <span className="font-normal tabular-nums text-muted-foreground">({count})</span>
                ) : null}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </div>
      )}
      {/* Keyed so each view plays its entrance once as it opens. */}
      <Tabs.Panel
        key={selected}
        value={selected}
        className="min-w-0 animate-library-view-in outline-none motion-reduce:animate-none"
      >
        {children}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
