import {
  FolderGit2Icon,
  HistoryIcon,
  GitBranchIcon,
  LayoutDashboardIcon,
  MessagesSquareIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { LibraryTabs } from "./LibraryTabs";
import { PROJECT_VIEW_LABELS, type ProjectViewName } from "./projectViews";

const VIEW_ICONS: Record<ProjectViewName, LucideIcon> = {
  overview: LayoutDashboardIcon,
  workstreams: GitBranchIcon,
  conversations: MessagesSquareIcon,
  timeline: HistoryIcon,
  computers: FolderGit2Icon,
  repositories: FolderGit2Icon,
  setup: SlidersHorizontalIcon,
};

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
  readonly children: ReactNode;
}) {
  return (
    <LibraryTabs
      label="Project views"
      tabs={views.map((view) => ({
        value: view,
        label: PROJECT_VIEW_LABELS[view],
        icon: VIEW_ICONS[view],
        count: count(view),
      }))}
      selected={selected}
      onSelect={onSelect}
    >
      {children}
    </LibraryTabs>
  );
}
