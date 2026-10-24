import { Tabs } from "@base-ui/react/tabs";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type LibraryTab<V extends string> = {
  readonly value: V;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly count?: number | undefined;
  /** Draws the count as a warning, for views holding work that waits on someone. */
  readonly urgent?: boolean;
};

/**
 * A Library page's views as one pill of tabs. One indicator slides to the chosen tab rather than
 * each tab lighting up on its own, so the switch reads as movement. Arrow keys move focus and
 * Enter opens a view, since each one is a navigation that should not fire on every key press.
 *
 * Controls for the open view sit at the far end of the same row, so a view never stacks a second
 * bar of controls under the tabs.
 */
export function LibraryTabs<V extends string>({
  label,
  tabs,
  selected,
  onSelect,
  actions,
  children,
}: {
  readonly label: string;
  readonly tabs: readonly LibraryTab<V>[];
  readonly selected: V;
  readonly onSelect: (value: V) => void;
  /** Controls for the open view, such as its filter or its one way to add something. */
  readonly actions?: ReactNode;
  /** The selected view, shown in the one panel the tabs control. */
  readonly children: ReactNode;
}) {
  return (
    <Tabs.Root
      value={selected}
      onValueChange={(next) => {
        const tab = tabs.find((entry) => entry.value === next);
        if (tab) onSelect(tab.value);
      }}
      className="flex min-w-0 flex-col gap-6"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="-mx-1 min-w-0 max-w-full overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
          <Tabs.List
            aria-label={label}
            className="relative isolate flex w-fit items-center gap-0.5 rounded-full bg-muted p-1 dark:bg-accent"
          >
            <Tabs.Indicator className="absolute top-1/2 left-0 -z-10 h-(--active-tab-height) w-(--active-tab-width) -translate-y-1/2 translate-x-(--active-tab-left) overflow-hidden rounded-full bg-card shadow-sm ring-1 ring-border transition-[translate,width] duration-300 ease-drawer motion-reduce:transition-none">
              <span aria-hidden className="absolute inset-0 bg-(--project-color)/10" />
            </Tabs.Indicator>
            {tabs.map(({ value, label: tabLabel, icon: Icon, count, urgent }) => (
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
                  urgent ? (
                    <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-warning/16 px-1.5 text-2xs font-semibold tabular-nums text-warning-foreground">
                      {count}
                    </span>
                  ) : (
                    <span className="font-normal tabular-nums text-muted-foreground">
                      ({count})
                    </span>
                  )
                ) : null}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </div>
        {actions ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
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
