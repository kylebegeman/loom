import { FolderClosedIcon, MessageSquareTextIcon } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { ProjectNavigationView } from "./preference";

const VIEWS = ["threads", "projects"] as const;

export function projectNavigationViewForKey(
  view: ProjectNavigationView,
  key: string,
): ProjectNavigationView | null {
  if (key === "Home") return "threads";
  if (key === "End") return "projects";
  if (key === "ArrowLeft" || key === "ArrowRight") {
    return view === "threads" ? "projects" : "threads";
  }
  return null;
}

export function ProjectNavigationSwitch({
  view,
  onViewChange,
}: {
  view: ProjectNavigationView;
  onViewChange: (view: ProjectNavigationView) => void;
}) {
  const threadTab = useRef<HTMLButtonElement>(null);
  const projectTab = useRef<HTMLButtonElement>(null);
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const nextView = projectNavigationViewForKey(view, event.key);
    if (nextView === null) return;
    event.preventDefault();
    onViewChange(nextView);
    (nextView === "threads" ? threadTab : projectTab).current?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Project navigation"
      className="relative isolate mb-2 inline-grid w-max self-start grid-cols-2 rounded-full bg-sidebar-row-hover p-1"
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-sidebar shadow-xs transition-transform duration-200 ease-out motion-reduce:transition-none",
          view === "projects" && "translate-x-full",
        )}
      />
      {VIEWS.map((option) => {
        const Icon = option === "threads" ? MessageSquareTextIcon : FolderClosedIcon;
        const label = option === "threads" ? "Threads" : "Projects";
        return (
          <Tooltip key={option}>
            <TooltipTrigger
              render={
                <button
                  ref={option === "threads" ? threadTab : projectTab}
                  id={`loom-navigation-${option}-tab`}
                  type="button"
                  role="tab"
                  aria-label={label}
                  aria-selected={view === option}
                  aria-controls="loom-project-navigation-panel"
                  tabIndex={view === option ? 0 : -1}
                  onKeyDown={handleKeyDown}
                  onClick={() => onViewChange(option)}
                  className={cn(
                    "relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    view === option ? "text-sidebar-foreground" : "text-sidebar-muted-foreground",
                  )}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.5} />
                </button>
              }
            />
            <TooltipPopup>{label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}
