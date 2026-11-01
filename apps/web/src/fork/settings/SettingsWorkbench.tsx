import { useRef, type ReactNode } from "react";
import { AppRouteModal, AppRouteModalClose } from "~/components/AppRouteModal";
import { SETTINGS_SECTION_LABELS } from "~/components/settings/settingsSearch";
import { workspaceAreaProps } from "~/lib/workspaceFocus";
import { LoomSettingsNavigation } from "./SettingsNavigation";
import { LoomSettingsOutline } from "./SettingsOutline";

const PAGE_TITLES: Readonly<Record<string, string>> = {
  ...SETTINGS_SECTION_LABELS,
  "/settings/diagnostics": "Diagnostics",
  "/settings/open-source-licenses": "Open source licenses",
};

const PAGE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "/settings/general": "Choose everyday defaults and notifications.",
  "/settings/appearance": "Make your workspace comfortable to read and use.",
  "/settings/chat": "Adjust conversations, messages and the composer.",
  "/settings/diffs": "Choose how to read changes and pull requests.",
  "/settings/keybindings": "Find and customize keyboard shortcuts.",
  "/settings/providers": "Connect the agents and accounts you work with.",
  "/settings/threads": "Manage conversation behavior and background work.",
  "/settings/browser": "Configure browsing and agent access to pages.",
  "/settings/devices": "Set up devices, simulators and testing tools.",
  "/settings/scheduled-tasks": "Review recurring work and when it runs.",
  "/settings/tools": "Manage skills and the tools available to agents.",
  "/settings/projects": "Choose defaults for projects and their checkouts.",
  "/settings/source-control": "Manage source control accounts and repository defaults.",
  "/settings/worktrees": "Control checkouts, lanes and their disk usage.",
  "/settings/connections": "Connect computers and manage where work runs.",
  "/settings/access": "Control who can connect and what they can do.",
  "/settings/vault": "Manage saved connections and access for agents.",
  "/settings/maintenance": "Keep your computers healthy and up to date.",
  "/settings/archived": "Find and restore archived work.",
};

export function LoomSettingsWorkbench({
  pathname,
  actions,
  children,
}: {
  pathname: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const contentArea = workspaceAreaProps("settings", 1, "Settings content");
  const pagePath = pathname.replace(/\/+$/, "");
  const title = PAGE_TITLES[pagePath] ?? "Settings";
  const description = PAGE_DESCRIPTIONS[pagePath];
  return (
    <AppRouteModal label="Settings">
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <LoomSettingsNavigation pathname={pathname} />
        <section {...contentArea} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-5 py-4 sm:px-6">
            <div className="min-w-0 space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              {description ? (
                <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              {actions}
              <AppRouteModalClose />
            </div>
          </header>
          <LoomSettingsOutline contentRef={contentRef} key={pagePath} />
          <div ref={contentRef} className="flex min-h-0 flex-1 flex-col">
            {children}
          </div>
        </section>
      </div>
    </AppRouteModal>
  );
}
