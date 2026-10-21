import { Tabs } from "@base-ui/react/tabs";
import {
  FolderGit2Icon,
  HistoryIcon,
  LayoutDashboardIcon,
  MessagesSquareIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { PROJECT_VIEW_LABELS, type ProjectViewName } from "./projectViews";

const VIEW_ICONS: Record<ProjectViewName, LucideIcon> = {
  overview: LayoutDashboardIcon,
  conversations: MessagesSquareIcon,
  timeline: HistoryIcon,
  computers: FolderGit2Icon,
  repositories: FolderGit2Icon,
  setup: SlidersHorizontalIcon,
};

/**
 * The project page's views as tabs. One pill slides to the chosen tab rather than each tab
 * lighting up on its own, so the switch reads as movement. Arrow keys move focus and Enter opens
 * a view, since each one is a navigation that should not fire on every key press.
 */
export function ProjectTabs({
  views,
  selected,
  count,
  onSelect,
  children,
}: {
  readonly views: readonly ProjectViewName[];
  readonly selected: ProjectViewName;
  readonly count: (view: ProjectViewName) => number;
  readonly onSelect: (view: ProjectViewName) => void;
  /** The selected view, shown in the one panel the tabs control. */
  readonly children: ReactNode;
}) {
  return (
    <Tabs.Root
      value={selected}
      onValueChange={(next) => {
        const view = views.find((entry) => entry === next);
        if (view) onSelect(view);
      }}
      className="flex min-w-0 flex-col gap-8"
    >
      <div className="-mx-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
        <Tabs.List
          aria-label="Project views"
          className="relative isolate flex w-fit items-center gap-0.5 rounded-full bg-muted p-1 dark:bg-accent"
        >
          <Tabs.Indicator className="absolute top-1/2 left-0 -z-10 h-(--active-tab-height) w-(--active-tab-width) -translate-y-1/2 translate-x-(--active-tab-left) overflow-hidden rounded-full bg-card shadow-sm ring-1 ring-border transition-[translate,width] duration-300 ease-drawer motion-reduce:transition-none">
            <span aria-hidden className="absolute inset-0 bg-(--project-color)/10" />
          </Tabs.Indicator>
          {views.map((view) => {
            const Icon = VIEW_ICONS[view];
            const n = count(view);
            return (
              <Tabs.Tab
                key={view}
                value={view}
                className="group/tab inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium text-muted-foreground outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-active:text-foreground"
              >
                <Icon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground/70 transition-colors duration-200 group-hover/tab:text-foreground/70 group-data-active/tab:text-(--project-color)"
                />
                {PROJECT_VIEW_LABELS[view]}
                {n ? (
                  <span className="font-normal tabular-nums text-muted-foreground">({n})</span>
                ) : null}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
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
