import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { scrollToSettingsTarget } from "~/components/settings/settingsLayout";
import { validateSettingsScopeSearch } from "~/components/settings/settingsScope";
import {
  revealSettingsSearchTarget,
  searchSettings,
  SETTINGS_NAV_GROUPS,
  SETTINGS_SECTION_LABELS,
  type SettingsPath,
  type SettingsSearchItem,
} from "~/components/settings/settingsSearch";
import { useAvailableSettingsSearchItems } from "~/components/settings/useAvailableSettingsSearchItems";
import { useSettingsSectionNavigation } from "~/components/settings/useSettingsSectionNavigation";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import {
  SidebarFooter,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";
import { workspaceAreaProps } from "~/lib/workspaceFocus";

const T3ConnectSidebarSignIn = lazy(() =>
  import("~/components/clerk/T3ConnectSidebarSignIn").then((module) => ({
    default: module.T3ConnectSidebarSignIn,
  })),
);
const T3ConnectSidebarAvatar = lazy(() =>
  import("~/components/clerk/T3ConnectSidebarSignIn").then((module) => ({
    default: module.T3ConnectSidebarAvatar,
  })),
);

const DETAIL_PAGE_PARENTS: Readonly<Record<string, SettingsPath>> = {
  "/settings/diagnostics": "/settings/maintenance",
  "/settings/open-source-licenses": "/settings/about",
  "/settings/project-files": "/settings/projects",
};

function revealResult(element: HTMLLIElement | null) {
  element?.scrollIntoView({ block: "nearest" });
}

export function LoomSettingsNavigation({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const hash = useLocation({ select: (location) => location.hash });
  const search = useLocation({ select: (location) => location.search });
  const searchableItems = useAvailableSettingsSearchItems(validateSettingsScopeSearch(search));
  const activePath = DETAIL_PAGE_PARENTS[pathname] ?? pathname;
  const paths = SETTINGS_NAV_GROUPS.flatMap((group) => group.paths);
  const currentSection =
    paths.find((path) => activePath === path || activePath.startsWith(`${path}/`)) ??
    paths[0] ??
    "/settings/general";
  const sections = useSettingsSectionNavigation(currentSection);
  const navRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const resultsId = `${id}-results`;
  const categoriesId = `${id}-categories`;
  const [query, setQuery] = useState("");
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const results = searchSettings(query, searchableItems);
  const isSearching = query.trim().length > 0;
  const maxResultIndex = Math.max(results.length - 1, 0);
  if (activeResultIndex > maxResultIndex) setActiveResultIndex(maxResultIndex);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronize Settings search shortcuts with window keyboard events
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const find =
        event.key.toLowerCase() === "f" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey;
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!find && !slash) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        ((slash &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)) ||
          target.closest(
            '[role="dialog"]:not([data-app-modal]), [aria-modal="true"]:not([data-app-modal]), [data-slot$="popup"]:not([data-app-modal]), [data-keybinding-capture]',
          ) !== null)
      )
        return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    const dismissOutside = (event: Event) => {
      if (
        window.matchMedia("(max-width: 767px)").matches &&
        event.target instanceof Node &&
        !navRef.current?.contains(event.target)
      ) {
        setMobileExpanded(false);
        setQuery("");
        setActiveResultIndex(0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("focusin", dismissOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("focusin", dismissOutside);
    };
  }, []);

  const clearSearch = () => {
    setQuery("");
    setActiveResultIndex(0);
  };
  const openSection = (to: SettingsPath) => {
    setMobileExpanded(false);
    if (window.matchMedia("(max-width: 767px)").matches) {
      browseRef.current?.focus({ preventScroll: true });
    }
    void navigate({ to, hash: "", replace: true, hashScrollIntoView: false });
  };
  const openResult = (item: SettingsSearchItem) => {
    clearSearch();
    setMobileExpanded(false);
    const targetId = item.targetId ?? item.id;
    revealSettingsSearchTarget(targetId);
    if (pathname === item.to && hash.replace(/^#/, "") === targetId) {
      scrollToSettingsTarget(targetId);
      return;
    }
    void navigate({
      to: item.to,
      hash: targetId,
      replace: true,
      hashScrollIntoView: false,
      state: { settingsTargetHighlight: true },
    });
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && (isSearching || mobileExpanded)) {
      event.preventDefault();
      event.stopPropagation();
      if (isSearching) clearSearch();
      else {
        setMobileExpanded(false);
        browseRef.current?.focus();
      }
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveResultIndex((activeResultIndex + direction + results.length) % results.length);
    } else if (event.key === "Enter") {
      const result = results[activeResultIndex];
      if (result) {
        event.preventDefault();
        openResult(result);
      }
    }
  };

  return (
    <nav
      {...workspaceAreaProps("settings-nav", 0, "Settings navigation")}
      ref={navRef}
      role="navigation"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          (mobileExpanded || isSearching) &&
          window.matchMedia("(max-width: 767px)").matches
        ) {
          event.preventDefault();
          event.stopPropagation();
          clearSearch();
          setMobileExpanded(false);
          browseRef.current?.focus();
        }
      }}
      className="relative z-10 flex w-full min-w-0 shrink-0 flex-col border-b border-sidebar-border bg-sidebar text-sidebar-foreground md:w-60 md:min-h-0 md:border-e md:border-b-0"
    >
      <div className="flex shrink-0 flex-col gap-3 p-3 md:p-4">
        <div className="hidden text-base font-semibold text-sidebar-foreground md:block">
          Settings
        </div>
        <div className="md:hidden">
          <Button
            ref={browseRef}
            variant="ghost"
            size="sm"
            aria-expanded={mobileExpanded}
            aria-controls={categoriesId}
            onClick={() => {
              clearSearch();
              setMobileExpanded(!mobileExpanded);
            }}
          >
            Browse settings
            <span className="truncate text-muted-foreground">
              {SETTINGS_SECTION_LABELS[currentSection]}
            </span>
            <ChevronDownIcon aria-hidden />
          </Button>
        </div>
        <div className="flex min-h-9 min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-2.5 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
          <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <SidebarInput
            ref={searchRef}
            nativeInput
            className="min-w-0 flex-1"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setActiveResultIndex(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search settings"
            aria-label="Search settings"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isSearching && results.length > 0}
            aria-controls={isSearching && results.length > 0 ? resultsId : undefined}
            aria-activedescendant={
              isSearching && results[activeResultIndex]
                ? `${id}-result-${results[activeResultIndex].id}`
                : undefined
            }
          />
          {isSearching ? (
            <Button
              variant="ghost-muted"
              size="icon-micro"
              aria-label="Clear settings search"
              onClick={() => {
                clearSearch();
                searchRef.current?.focus();
              }}
            >
              <XIcon aria-hidden />
            </Button>
          ) : (
            <span className="hidden md:inline-flex">
              <Kbd>/</Kbd>
            </span>
          )}
        </div>
      </div>
      <div
        className={cn(
          "min-h-0 overflow-y-auto overscroll-contain px-3 pb-4 md:flex-1 md:px-3",
          "max-md:absolute max-md:inset-x-0 max-md:top-full max-md:max-h-[55dvh] max-md:rounded-b-xl max-md:border-b max-md:border-sidebar-border max-md:bg-sidebar max-md:shadow-lg",
          !mobileExpanded && !isSearching && "max-md:hidden",
        )}
      >
        {isSearching ? (
          results.length > 0 ? (
            <SidebarMenu id={resultsId} role="listbox" aria-label="Settings search results">
              {results.map((item, index) => (
                <SidebarMenuItem
                  key={item.id}
                  role="presentation"
                  ref={index === activeResultIndex ? revealResult : undefined}
                >
                  <SidebarMenuButton
                    id={`${id}-result-${item.id}`}
                    role="option"
                    aria-selected={index === activeResultIndex}
                    tabIndex={-1}
                    size="lg"
                    isActive={index === activeResultIndex}
                    onMouseMove={() => setActiveResultIndex(index)}
                    onClick={() => openResult(item)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-sidebar-foreground">
                        {item.title}
                      </span>
                      <span className="block truncate text-xs text-sidebar-muted-foreground">
                        {SETTINGS_SECTION_LABELS[item.to]}
                      </span>
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          ) : (
            <p role="status" className="px-2 py-6 text-sm text-sidebar-muted-foreground">
              No settings found. Try another search.
            </p>
          )
        ) : (
          <div
            {...sections.containerProps}
            id={categoriesId}
            role="tree"
            aria-label="Settings sections"
            className="flex flex-col gap-5"
          >
            {SETTINGS_NAV_GROUPS.map((group, index) => (
              <div
                key={group.heading ?? index}
                role="group"
                aria-label={group.heading ?? undefined}
                className="space-y-1.5"
              >
                {group.heading ? (
                  <h3
                    aria-hidden="true"
                    className="px-2 text-xs font-medium text-sidebar-muted-foreground"
                  >
                    {group.heading}
                  </h3>
                ) : null}
                <SidebarMenu role="presentation">
                  {group.paths.map((to) => {
                    const active = currentSection === to;
                    return (
                      <SidebarMenuItem key={to} role="presentation">
                        <SidebarMenuButton
                          data-settings-section={to}
                          role="treeitem"
                          tabIndex={sections.tabIndexFor(to)}
                          aria-selected={active}
                          aria-current={active ? "page" : undefined}
                          isActive={active}
                          onClick={() => openSection(to)}
                        >
                          <span>{SETTINGS_SECTION_LABELS[to]}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="hidden md:block">
        <SidebarFooter>
          <Suspense fallback={null}>
            <T3ConnectSidebarSignIn />
          </Suspense>
          <Suspense fallback={null}>
            <T3ConnectSidebarAvatar />
          </Suspense>
        </SidebarFooter>
      </div>
    </nav>
  );
}
