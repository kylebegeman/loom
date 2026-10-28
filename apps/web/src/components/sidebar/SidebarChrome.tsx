import {
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  FolderKanbanIcon, // fork: project-home
  GlobeIcon, // fork: sites-navigation
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { usePullRequestsSupported } from "../../state/environments";
import { LoomWordmark } from "../LoomWordmark"; // fork: brand
import { useBotsFooterEntry } from "../../fork/bots/BotsFooterEntry"; // fork: bots
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { useNavigateToMainApp } from "./mainAppLocation"; // fork: bots
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode,
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <div
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 pr-3",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 ml-[calc(var(--workspace-controls-left)+1px-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant={backdropVariant ? "media-navigation" : "ghost"}
          className="relative top-auto translate-y-0"
          aria-label="Toggle main sidebar"
        />
      </div>
      <div className="relative z-10 flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden py-0.5">
        <SidebarBrand onBackdrop={backdropVariant !== null} />
        {pillLabel ? (
          <div className="ml-1 flex h-7 items-center">
            <Badge data-environment-identification="pill" size="sm" variant="secondary">
              {pillLabel}
            </Badge>
          </div>
        ) : null}
      </div>
    </div>
  );
});

export function SidebarBrandWidthProbe({
  onWidthChange,
}: {
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-3"
      ref={observeWidth}
    >
      <div className="ml-[var(--workspace-titlebar-content-left)] flex">
        <SidebarBrandMark onBackdrop={false} />
      </div>
    </div>
  );
}

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <Link
      aria-label="Go to threads"
      className={cn(
        "relative z-10 ml-[var(--workspace-titlebar-content-left)] hidden h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset md:flex",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      <SidebarBrandMark onBackdrop={onBackdrop} />
    </Link>
  );
}

function SidebarBrandMark({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1 text-sm font-medium tracking-tight">
      {/* fork: brand */}
      <LoomWordmark className={onBackdrop ? "text-white" : "text-foreground"} />
    </span>
  );
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
  active = false, // fork: bots
}: {
  active?: boolean; // fork: bots
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            // fork: bots
            <SidebarMenuButton
              aria-label={label}
              aria-current={active ? "page" : undefined}
              isActive={active}
              onClick={onClick}
              size="icon"
            >
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

// fork: sites-navigation - exported for the fork's destination navigation tests.
export const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const pathname = useLocation({ select: (location) => location.pathname }); // fork: sites-navigation
  const { isMobile, setOpenMobile } = useSidebar();
  // fork: bots -- isOnUtilityPage became the pathname check below
  const pullRequestsSupported = usePullRequestsSupported();
  const botsEntry = useBotsFooterEntry(); // fork: bots
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };

  // fork: project-home
  const handleProjectsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/projects" });
  };

  const handleUsageClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  };

  // fork: bots -- Projects, Sites and Bots keep the destination row; Settings and Usage are modals.
  if (/^\/pull-requests(?:\/|$)/.test(pathname))
    return (
      <SidebarMenu className="flex-row items-center">
        <SidebarMenuItem className="min-w-0 flex-1">
          {/* fork: bots */}
          <SidebarMenuButton
            onClick={() => {
              closeMobileSidebar();
              void navigateToMainApp();
            }}
          >
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarUpdatePill />
      </SidebarMenu>
    );

  // fork: bots - Projects, Sites and Bots keep the destination row visible.
  return (
    <SidebarMenu className="flex-row items-center">
      <SidebarUtilityItem
        icon={<SettingsIcon />}
        label="Settings"
        active={/^\/settings(?:\/|$)/.test(pathname)} // fork: bots
        onClick={handleSettingsClick}
      />
      {pullRequestsSupported ? (
        <SidebarUtilityItem
          icon={<PullRequestGlyph.pullRequest />}
          label="Pull requests"
          active={/^\/pull-requests(?:\/|$)/.test(pathname)} // fork: bots
          onClick={handlePullRequestsClick}
        />
      ) : null}
      <SidebarUtilityItem
        icon={<ChartNoAxesColumnIcon />}
        label="Usage"
        active={/^\/usage(?:\/|$)/.test(pathname)} // fork: bots
        onClick={handleUsageClick}
      />
      {/* fork: project-home */}
      <SidebarUtilityItem
        icon={<FolderKanbanIcon />}
        label="Projects"
        active={/^\/(?:projects|library)(?:\/|$)/.test(pathname)}
        onClick={handleProjectsClick}
      />
      {/* fork: sites-navigation */}
      <SidebarUtilityItem
        icon={<GlobeIcon />}
        label="Sites"
        active={/^\/sites(?:\/|$)/.test(pathname)}
        onClick={() => {
          closeMobileSidebar();
          void navigate({ to: "/sites" });
        }}
      />
      {/* fork: bots */}
      <SidebarUtilityItem
        icon={botsEntry.icon}
        label={botsEntry.label}
        active={/^\/loom\/bots(?:\/|$)/.test(pathname)}
        onClick={() => {
          closeMobileSidebar();
          void navigate({ to: "/loom/bots" });
        }}
      />
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter({
  showUndoNotice = false,
}: {
  showUndoNotice?: boolean;
}) {
  return (
    <SidebarFooter>
      {showUndoNotice ? <SidebarThreadUndoNotice /> : null}
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
