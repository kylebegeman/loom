import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChartNoAxesColumnIcon,
  FolderKanbanIcon, // fork: project-home
  GlobeIcon, // fork: sites-navigation
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useAtomValue } from "@effect/atom-react";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  navigateHistory,
  useCanNavigateHistory,
  type HistoryDirection,
} from "../../navigationHistory";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { cn } from "../../lib/utils";
import { usePullRequestsSupported } from "../../state/environments";
import { LoomWordmark } from "../LoomWordmark"; // fork: brand
import { BOTS_NAVIGATION_VISIBLE } from "@t3tools/client-runtime/fork"; // fork: bots
import { useBotsFooterEntry } from "../../fork/bots/BotsFooterEntry"; // fork: bots
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
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
        <div className="flex shrink-0 items-center gap-1">
          <SidebarBrand onBackdrop={backdropVariant !== null} />
          {isElectron ? (
            <div className="hidden items-center md:flex">
              <HistoryNavigationButton direction="back" onBackdrop={backdropVariant !== null} />
              <HistoryNavigationButton direction="forward" onBackdrop={backdropVariant !== null} />
            </div>
          ) : null}
        </div>
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
  isElectron,
  onWidthChange,
}: {
  isElectron: boolean;
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
      <div className="ml-[var(--workspace-titlebar-content-left)] flex gap-1">
        <SidebarBrandMark onBackdrop={false} />
        {isElectron ? <div className="w-[calc(2*var(--workspace-titlebar-control-size))]" /> : null}
      </div>
    </div>
  );
}

function HistoryNavigationButton({
  direction,
  onBackdrop,
}: {
  direction: HistoryDirection;
  onBackdrop: boolean;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const enabled = useCanNavigateHistory(direction);
  const label = direction === "back" ? "Go back" : "Go forward";
  const shortcutLabel = shortcutLabelForCommand(
    keybindings,
    direction === "back" ? "navigation.back" : "navigation.forward",
  );
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className={cn(
              "[-webkit-app-region:no-drag]",
              onBackdrop && "relative top-auto translate-y-0",
            )}
            disabled={!enabled}
            onClick={() => navigateHistory(direction)}
            size="icon-sm"
            variant={onBackdrop ? "media-navigation" : "ghost"}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {label}
        {shortcutLabel ? ` (${shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <Link
      aria-label="Loom home" // fork: brand
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
        <SidebarThreadUndoNotice />
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
      {BOTS_NAVIGATION_VISIBLE ? (
        <SidebarUtilityItem
          icon={botsEntry.icon}
          label={botsEntry.label}
          active={/^\/loom\/bots(?:\/|$)/.test(pathname)}
          onClick={() => {
            closeMobileSidebar();
            void navigate({ to: "/loom/bots" });
          }}
        />
      ) : null}
      <SidebarThreadUndoNotice />
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter>
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
