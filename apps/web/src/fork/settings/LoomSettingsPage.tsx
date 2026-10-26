import { Activity, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowRightIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import {
  SettingsPageContainer,
  useSettingsSearchTarget,
} from "~/components/settings/settingsLayout";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon } from "~/components/ui/input-group";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import {
  filterLoomSettingsSections,
  LOOM_SETTINGS_GROUPS,
  resolveLoomSettingsSection,
} from "./navigation";
import { FORK_SETTINGS_SECTIONS, type ForkSettingsSection } from "./registry";

export function LoomSettingsPage() {
  const search = useSearch({ from: "/_chat/settings/loom" });
  const navigate = useNavigate();
  const selected = resolveLoomSettingsSection(FORK_SETTINGS_SECTIONS, search.section);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [visited, setVisited] = useState<readonly string[]>([selected.id]);
  // Retain unfinished forms across topic changes. Hidden topics pause their effects.
  if (!visited.includes(selected.id)) setVisited([...visited, selected.id]);
  const searching = query.trim().length > 0;
  const matching = filterLoomSettingsSections(FORK_SETTINGS_SECTIONS, query);
  const selectSection = (section: string) => {
    setQuery("");
    void navigate({
      to: "/settings/loom",
      search: (current) => ({ ...current, section }),
      hash: `loom-${section}`,
      state: { settingsTargetHighlight: false },
      resetScroll: false,
    });
  };

  return (
    <SettingsPageContainer
      width="expanded"
      scopePresentation={
        selected.scope === "device" ? "none" : selected.scope === "project" ? "full" : "computer"
      }
      className="@container/loom-settings"
    >
      <div className="flex min-w-0 flex-col gap-5 border-b border-border/60 pb-6 @min-[40rem]/loom-settings:flex-row @min-[40rem]/loom-settings:items-center @min-[40rem]/loom-settings:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Loom settings</h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Shape your workspace, connect your tools, and manage access.
          </p>
        </div>
        <div className="w-full @min-[40rem]/loom-settings:w-72 @min-[40rem]/loom-settings:shrink-0">
          <InputGroup size="lg">
            <InputGroupAddon>
              <SearchIcon aria-hidden className="size-4" />
            </InputGroupAddon>
            <Input
              ref={searchRef}
              type="search"
              aria-label="Find Loom settings"
              aria-controls={searching ? "loom-settings-results" : undefined}
              placeholder="Find a topic…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery("");
                }
                if (event.key === "Enter" && searching && matching.length > 0) {
                  event.preventDefault();
                  selectSection(matching[0]!.id);
                }
                if (event.key === "ArrowDown" && searching) {
                  event.preventDefault();
                  document.querySelector<HTMLAnchorElement>("#loom-settings-results a")?.focus();
                }
              }}
            />
            {query ? (
              <InputGroupAddon align="inline-end">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Clear settings search"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                >
                  <XIcon aria-hidden />
                </Button>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </div>
      </div>
      <div className="grid min-w-0 items-start gap-7 @min-[52rem]/loom-settings:grid-cols-[13.5rem_minmax(0,1fr)] @min-[52rem]/loom-settings:gap-10">
        <nav
          aria-label="Loom settings topics"
          className="min-w-0 @min-[52rem]/loom-settings:sticky @min-[52rem]/loom-settings:top-4 @min-[52rem]/loom-settings:max-h-[calc(100dvh-var(--workspace-topbar-height)-2rem)] @min-[52rem]/loom-settings:overflow-y-auto @min-[52rem]/loom-settings:overscroll-contain"
        >
          <div className="@min-[52rem]/loom-settings:hidden">
            <Select
              value={selected.id}
              onValueChange={(value) => {
                if (value) selectSection(value);
              }}
              items={FORK_SETTINGS_SECTIONS.map((section) => ({
                value: section.id,
                label: section.title,
              }))}
            >
              <SelectTrigger aria-label="Settings topic">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {LOOM_SETTINGS_GROUPS.map((group) => (
                  <SelectGroup key={group.id}>
                    <SelectGroupLabel>{group.title}</SelectGroupLabel>
                    {FORK_SETTINGS_SECTIONS.filter((section) => section.group === group.id).map(
                      (section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.title}
                        </SelectItem>
                      ),
                    )}
                  </SelectGroup>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="hidden space-y-6 @min-[52rem]/loom-settings:block">
            {LOOM_SETTINGS_GROUPS.map((group) => (
              <div key={group.id} className="space-y-2">
                <h2 className="px-3 text-xs font-medium text-muted-foreground">{group.title}</h2>
                <ul className="space-y-0.5">
                  {FORK_SETTINGS_SECTIONS.filter((section) => section.group === group.id).map(
                    (section) => {
                      const Icon = section.icon ?? SlidersHorizontalIcon;
                      return (
                        <li key={section.id}>
                          <Link
                            to="/settings/loom"
                            search={(current) => ({ ...current, section: section.id })}
                            hash={`loom-${section.id}`}
                            state={{ settingsTargetHighlight: false }}
                            resetScroll={false}
                            onClick={() => setQuery("")}
                            aria-current={
                              !searching && selected.id === section.id ? "page" : undefined
                            }
                            className={cn(
                              "flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm leading-snug outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              !searching && selected.id === section.id
                                ? "bg-accent font-medium text-accent-foreground"
                                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                          >
                            <Icon aria-hidden className="size-4 shrink-0" />
                            <span className="min-w-0">{section.title}</span>
                          </Link>
                        </li>
                      );
                    },
                  )}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0">
          {searching ? (
            <div id="loom-settings-results" className="min-w-0">
              <header className="mb-5 space-y-1.5">
                <h2 className="text-lg font-semibold tracking-tight">Search results</h2>
                <p role="status" className="text-sm text-muted-foreground">
                  {matching.length === 0
                    ? `No topics match “${query.trim()}”. Try a tool or connection name.`
                    : `${matching.length} ${matching.length === 1 ? "topic" : "topics"} matching “${query.trim()}”`}
                </p>
              </header>
              {matching.length === 0 ? (
                <div className="flex min-w-0 flex-col items-start gap-4 rounded-xl border border-dashed border-border p-6">
                  <SearchIcon aria-hidden className="size-5 text-muted-foreground" />
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Try “GitHub”, “storage”, or “simulator”. All topics are still available in
                    navigation.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                  >
                    Clear search
                  </Button>
                </div>
              ) : (
                <ul className="overflow-hidden rounded-xl border border-border/70 bg-card divide-y divide-border/60">
                  {matching.map((section) => {
                    const Icon = section.icon ?? SlidersHorizontalIcon;
                    const group = LOOM_SETTINGS_GROUPS.find((group) => group.id === section.group);
                    return (
                      <li key={section.id}>
                        <Link
                          to="/settings/loom"
                          search={(current) => ({ ...current, section: section.id })}
                          hash={`loom-${section.id}`}
                          state={{ settingsTargetHighlight: false }}
                          resetScroll={false}
                          onClick={() => setQuery("")}
                          className="flex min-w-0 items-start gap-4 p-4 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
                        >
                          <Icon
                            aria-hidden
                            className="mt-1 size-5 shrink-0 text-muted-foreground"
                          />
                          <span className="min-w-0 flex-1 space-y-1">
                            <span className="block text-sm font-semibold">{section.title}</span>
                            <span className="block text-sm leading-relaxed text-muted-foreground">
                              {section.description}
                            </span>
                            <span className="block pt-1 text-xs text-muted-foreground">
                              {group?.title}
                            </span>
                          </span>
                          <ArrowRightIcon
                            aria-hidden
                            className="mt-1 size-4 shrink-0 text-muted-foreground"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
          {FORK_SETTINGS_SECTIONS.filter((section) => visited.includes(section.id)).map(
            (section) => (
              <Activity
                key={section.id}
                mode={!searching && section.id === selected.id ? "visible" : "hidden"}
              >
                <LoomSettingsPane section={section} onSelect={selectSection} />
              </Activity>
            ),
          )}
        </div>
      </div>
    </SettingsPageContainer>
  );
}

function LoomSettingsPane({
  section,
  onSelect,
}: {
  section: ForkSettingsSection;
  onSelect: (id: string) => void;
}) {
  const { id, title, description, Component } = section;
  const Icon = section.icon ?? SlidersHorizontalIcon;
  const targetId = `loom-${id}`;
  const targetRef = useSettingsSearchTarget<HTMLElement>(targetId);
  const group = LOOM_SETTINGS_GROUPS.find((group) => group.id === section.group);
  const related = FORK_SETTINGS_SECTIONS.filter((candidate) =>
    section.related?.includes(candidate.id),
  );
  return (
    <section
      id={targetId}
      ref={targetRef}
      tabIndex={-1}
      aria-labelledby={`${targetId}-title`}
      className="min-w-0 outline-none"
    >
      <header data-settings-scroll-target className="mb-6 space-y-4">
        <div className="flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground">
          <span>{group?.title}</span>
          {section.scope === "device" ? <Badge variant="secondary">This device</Badge> : null}
        </div>
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card">
            <Icon aria-hidden className="size-5 text-foreground/80" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <h2 id={`${targetId}-title`} className="text-xl font-semibold tracking-tight">
              {title}
            </h2>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        {section.scope === "mixed" ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Preview preferences stay on this device. Tool configuration applies to the selected
            computer.
          </p>
        ) : null}
      </header>
      <div className="min-w-0 wrap-anywhere">
        <Component />
      </div>
      {related.length > 0 ? (
        <aside
          aria-label="Related settings"
          className="mt-7 space-y-3 border-t border-border/60 pt-5"
        >
          <h3 className="text-xs font-medium text-muted-foreground">Related settings</h3>
          <div className="flex min-w-0 flex-wrap gap-2">
            {related.map((candidate) => (
              <Button
                key={candidate.id}
                variant="outline"
                size="sm"
                onClick={() => onSelect(candidate.id)}
              >
                {candidate.title}
                <ArrowRightIcon aria-hidden />
              </Button>
            ))}
          </div>
        </aside>
      ) : null}
    </section>
  );
}
