import { Tabs } from "@base-ui/react/tabs";
import { useLocation } from "@tanstack/react-router";
import {
  WorkflowIcon,
  HardDriveIcon,
  LibraryBigIcon,
  NetworkIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { SettingsPageContainer } from "~/components/settings/settingsLayout";

const VIEWS = [
  {
    id: "computers",
    label: "Computers",
    icon: HardDriveIcon,
    description: "Start work on a computer or pick up where you left off.",
  },
  {
    id: "supervisor",
    label: "Upstream supervisor",
    icon: WorkflowIcon,
    description: "Let your Grok chief manage upstream integrations.",
  },
  {
    id: "library",
    label: "Library",
    icon: LibraryBigIcon,
    description: "Keep your projects, conversations, and computers together across devices.",
  },
  {
    id: "updates",
    label: "Updates",
    icon: RefreshCwIcon,
    description: "Review Loom and provider updates across your computers.",
  },
  {
    id: "workers",
    label: "Command workers",
    icon: NetworkIcon,
    description: "Run command jobs on computers connected over SSH.",
  },
] as const;

type ComputersView = (typeof VIEWS)[number]["id"];

function viewForTarget(hash: string): ComputersView {
  const target = hash.replace(/^#/, "");
  if (target.startsWith("loom-upstream-supervisor")) return "supervisor";
  if (target.startsWith("loom-mini-offload")) return "workers";
  if (target.startsWith("fleet-updates")) return "updates";
  if (target.startsWith("library-")) return "library";
  return "computers";
}

export function ComputersSettingsPage({
  children,
  actions,
  supervisor,
  library,
  updates,
  workers,
}: {
  children: ReactNode;
  actions?: ReactNode;
  supervisor?: ReactNode;
  library?: ReactNode;
  updates?: ReactNode;
  workers?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hash = useLocation({ select: (location) => location.hash });
  const [active, setActive] = useState<ComputersView>(() => viewForTarget(hash));
  const [seenHash, setSeenHash] = useState(hash);
  if (hash !== seenHash) {
    setSeenHash(hash);
    if (hash) setActive(viewForTarget(hash));
  }
  const panels = { computers: children, supervisor, library, updates, workers };
  const view = VIEWS.find((entry) => entry.id === active)!;

  return (
    <Tabs.Root
      ref={rootRef}
      value={active}
      onValueChange={(value) => {
        const view = VIEWS.find((entry) => entry.id === value);
        if (view) {
          setActive(view.id);
          const scroll = rootRef.current?.querySelector<HTMLElement>("[data-settings-page-scroll]");
          if (scroll) scroll.scrollTop = 0;
        }
      }}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="shrink-0 space-y-5 px-5 pt-6 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{view.label}</h1>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {view.description}
            </p>
          </div>
          {actions ? (
            <div hidden={active !== "computers"} className="shrink-0">
              {actions}
            </div>
          ) : null}
        </div>
        <div className="pb-4">
          <Tabs.List
            aria-label="Computer settings"
            className="grid grid-cols-2 items-stretch gap-1 sm:flex sm:flex-wrap sm:items-center"
          >
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <Tabs.Tab
                key={id}
                value={id}
                className={`inline-flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-active:bg-secondary data-active:text-secondary-foreground sm:shrink-0 sm:py-0 sm:whitespace-nowrap ${id === "workers" ? "max-sm:col-span-2" : ""}`}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </div>
      </div>
      <SettingsPageContainer width="wide" scopePresentation="none" className="pt-3 sm:px-7">
        {VIEWS.map(({ id }) => (
          <Tabs.Panel key={id} value={id} keepMounted className="min-w-0 space-y-7 outline-none">
            {panels[id]}
          </Tabs.Panel>
        ))}
      </SettingsPageContainer>
    </Tabs.Root>
  );
}
